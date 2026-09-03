from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import io
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tarfile
import time
from urllib.request import urlopen
import zipfile

import httpx
from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route


ROOT = Path(__file__).resolve().parent
NODE_VERSION = "22.23.2"
BUN_VERSION = "1.4.0"
HAWK_PORT = 9000
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def install_node() -> Path:
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    system = "darwin" if platform.system() == "Darwin" else "linux"
    extension = "tar.gz" if system == "darwin" else "tar.xz"
    cache = Path.home() / ".cache" / "hawk" / f"node-v{NODE_VERSION}-{system}-{arch}"
    binary = cache / "bin" / "node"
    if binary.exists():
        return binary

    cache.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-{system}-{arch}.{extension}"
    print(f"event=hawk_node_install version={NODE_VERSION} system={system} arch={arch}", flush=True)
    with urlopen(url, timeout=120) as response:
        archive = tarfile.open(fileobj=io.BytesIO(response.read()), mode="r:*")
    archive.extractall(cache.parent, filter="data")
    return binary


def install_bun() -> Path:
    machine = platform.machine().lower()
    arch = "aarch64" if machine in {"arm64", "aarch64"} else "x64"
    system = "darwin" if platform.system() == "Darwin" else "linux"
    if system == "darwin" and arch == "aarch64":
        arch = "aarch64"
    cache = Path.home() / ".cache" / "hawk" / f"bun-v{BUN_VERSION}-{system}-{arch}"
    binary = cache / "bun"
    if binary.exists():
        return binary

    cache.mkdir(parents=True, exist_ok=True)
    folder = f"bun-{system}-{arch}"
    url = f"https://github.com/oven-sh/bun/releases/download/bun-v{BUN_VERSION}/{folder}.zip"
    print(f"event=hawk_bun_install version={BUN_VERSION} system={system} arch={arch}", flush=True)
    with urlopen(url, timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
        with archive.open(f"{folder}/bun") as source, binary.open("wb") as target:
            target.write(source.read())
    binary.chmod(0o755)
    return binary


def start_nookwire() -> None:
    started = subprocess.run(
        [sys.executable, "-m", "nookwire_ssh.cli", "start", str(ROOT), "--accept"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=90,
    )
    output = started.stdout.strip()
    if started.returncode == 0:
        connected = subprocess.run(
            [sys.executable, "-m", "nookwire_ssh.cli", "connect"],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
        )
        output = "\n\n".join(part for part in (output, connected.stdout.strip()) if part)
    print(output, flush=True)


def start_hawk() -> subprocess.Popen[bytes]:
    node = install_node()
    bun = install_bun()
    node_bin = node.parent
    env = os.environ.copy()
    env["PATH"] = f"{node_bin}:{bun.parent}:{env.get('PATH', '')}"
    print("event=hawk_dependencies_install", flush=True)
    subprocess.run(
        [bun, "install", "--frozen-lockfile"],
        cwd=ROOT,
        env=env,
        check=True,
        timeout=180,
    )
    print("event=hawk_frontend_build", flush=True)
    subprocess.run([bun, "run", "build"], cwd=ROOT, env=env, check=True, timeout=120)

    env.update({"PORT": str(HAWK_PORT), "DL_DIR": "/tmp/hawk-downloads"})
    process = subprocess.Popen(
        [node, ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs", "src/server.ts"],
        cwd=ROOT,
        env=env,
        start_new_session=True,
    )

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Hawk exited during startup with code {process.returncode}")
        try:
            with urlopen(f"http://127.0.0.1:{HAWK_PORT}/health", timeout=1) as response:
                if response.status == 200:
                    print(f"event=hawk_ready port={HAWK_PORT}", flush=True)
                    return process
        except OSError:
            time.sleep(0.25)
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    raise TimeoutError("Hawk did not become healthy within 30 seconds")


@asynccontextmanager
async def lifespan(application: Starlette):
    nookwire_task = asyncio.create_task(asyncio.to_thread(start_nookwire))
    hawk_task = asyncio.create_task(asyncio.to_thread(start_hawk))
    application.state.hawk_task = hawk_task
    application.state.client = httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{HAWK_PORT}", timeout=None
    )
    try:
        yield
    finally:
        await application.state.client.aclose()
        hawk = None
        if hawk_task.done() and not hawk_task.cancelled():
            try:
                hawk = hawk_task.result()
            except Exception:
                pass
        else:
            def stop_after_start(task: asyncio.Task[subprocess.Popen[bytes]]) -> None:
                try:
                    process = task.result()
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                except (Exception, asyncio.CancelledError):
                    pass

            hawk_task.add_done_callback(stop_after_start)
        if hawk is not None:
            try:
                os.killpg(os.getpgid(hawk.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(asyncio.to_thread(hawk.wait), timeout=5)
            except TimeoutError:
                try:
                    os.killpg(os.getpgid(hawk.pid), signal.SIGKILL)
                except ProcessLookupError:
                    hawk.kill()
        if not nookwire_task.done():
            nookwire_task.cancel()


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


async def proxy(request: Request) -> Response:
    hawk_task: asyncio.Task[subprocess.Popen[bytes]] = request.app.state.hawk_task
    try:
        await asyncio.wait_for(asyncio.shield(hawk_task), timeout=45)
    except TimeoutError:
        return JSONResponse({"error": "Hawk is still starting"}, status_code=503)
    except Exception as error:
        print(f"event=hawk_start_error error={error!r}", flush=True)
        return JSONResponse({"error": "Hawk failed to start"}, status_code=503)
    client: httpx.AsyncClient = request.app.state.client
    target = request.url.path
    if request.url.query:
        target += f"?{request.url.query}"
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in HOP_BY_HOP and key.lower() != "host"
    }
    body = await request.body() if request.method not in ("GET", "HEAD") else None
    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                target,
                headers=headers,
                content=body,
            ),
            stream=True,
        )
    except httpx.HTTPError as error:
        print(f"event=hawk_proxy_error path={target} error={error!r}", flush=True)
        return JSONResponse({"error": "Hawk is unavailable"}, status_code=503)
    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in HOP_BY_HOP
    }
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(upstream.aclose),
    )


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/_stcore/health", health, methods=["GET", "HEAD"]),
        Route("/_stcore/health/", health, methods=["GET", "HEAD"]),
        Route("/healthz", health, methods=["GET", "HEAD"]),
        Route("/health", health, methods=["GET", "HEAD"]),
        Route("/{path:path}", proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    ],
)
