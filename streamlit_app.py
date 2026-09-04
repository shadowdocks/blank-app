from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import signal
import shutil
import subprocess
import sys
import tarfile
import threading
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
RQBIT_VERSION = "9.0.1"
LAUNCHER_VERSION = "rqbit-v1"
RQBIT_PORT = 3030
HAWK_PORT = 9000
HAWK_PID_FILE = Path("/tmp/hawk-backend.pid")
RQBIT_PID_FILE = Path("/tmp/hawk-rqbit.pid")
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


@dataclass
class HawkRuntime:
    backend: subprocess.Popen[bytes]
    rqbit: subprocess.Popen[bytes]


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


def install_rqbit() -> Path:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "linux" and machine in {"x86_64", "amd64"}:
        asset = "rqbit-linux-amd64"
        digest = "82ed2c23f4c7b91bb2c92eaab92e4a850d386cdf337bcdf9e0971c8ce3da4335"
    elif system == "linux" and machine in {"arm64", "aarch64"}:
        asset = "rqbit-linux-arm64"
        digest = "9ac50a7d1917cd458111265a12346a924b4f7cea7520327782ed5bd6f423b561"
    elif system == "darwin":
        asset = "rqbit-osx-universal"
        digest = "de8b957b2927dc5bf911506bf3c24c8e77e24a6d21ecd80f6fcffd2db30eb672"
    else:
        raise RuntimeError(f"rqbit {RQBIT_VERSION} has no supported binary for {system}/{machine}")

    cache = Path.home() / ".cache" / "hawk" / f"rqbit-v{RQBIT_VERSION}-{system}-{machine}"
    binary = cache / "rqbit"
    if binary.exists() and hashlib.sha256(binary.read_bytes()).hexdigest() == digest:
        return binary

    cache.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/ikatson/rqbit/releases/download/v{RQBIT_VERSION}/{asset}"
    print(f"event=hawk_rqbit_install version={RQBIT_VERSION} system={system} arch={machine}", flush=True)
    with urlopen(url, timeout=120) as response:
        payload = response.read()
    actual = hashlib.sha256(payload).hexdigest()
    if actual != digest:
        raise RuntimeError(f"rqbit checksum mismatch: expected {digest}, got {actual}")
    temporary = binary.with_suffix(".tmp")
    temporary.write_bytes(payload)
    temporary.chmod(0o755)
    temporary.replace(binary)
    return binary


def start_nookwire() -> None:
    nookwire = Path(sys.executable).with_name("nookwire")
    started = subprocess.run(
        [nookwire, "start", str(ROOT), "--accept", "--batch"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=90,
    )
    output = started.stdout.strip()
    if started.returncode == 0:
        status = subprocess.run(
            [nookwire, "status", "--json"],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
        )
        output = "\n\n".join(part for part in (output, status.stdout.strip()) if part)
    print(output, flush=True)


def stop_existing_hawk() -> None:
    """Stop an orphaned backend left behind by a Streamlit hot reload."""
    proc = Path("/proc")
    if not proc.is_dir():
        for pid_file in (HAWK_PID_FILE, RQBIT_PID_FILE):
            try:
                pid_file.unlink()
            except FileNotFoundError:
                pass
        return
    entries = list(proc.iterdir())

    killed_groups: set[int] = set()
    for entry in entries:
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if proc.is_dir():
            try:
                command = (entry / "cmdline").read_bytes().replace(b"\0", b" ")
                cwd = (entry / "cwd").resolve()
            except (FileNotFoundError, PermissionError, OSError):
                continue
            is_backend = b"node" in command and b"tsx" in command and b"src/server.ts" in command
            is_rqbit = b"rqbit" in command and b"server" in command and b"start" in command
            if cwd != ROOT or not (is_backend or is_rqbit):
                continue
        try:
            pgid = os.getpgid(pid)
        except (ProcessLookupError, PermissionError, OSError):
            continue
        if pgid <= 1 or pgid == os.getpgrp() or pgid in killed_groups:
            continue
        killed_groups.add(pgid)
        print(f"event=hawk_stale_process pid={pid}", flush=True)
        try:
            os.killpg(pgid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            continue
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                reaped, _ = os.waitpid(pid, os.WNOHANG)
                if reaped:
                    break
            except ChildProcessError:
                try:
                    os.kill(pid, 0)
                    if proc.is_dir() and (entry / "stat").read_text().split(") ", 1)[1].startswith("Z"):
                        break
                except (ProcessLookupError, PermissionError, FileNotFoundError, OSError):
                    break
            except (ProcessLookupError, PermissionError, OSError):
                break
            time.sleep(0.1)
        else:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass


def repository_revision() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, timeout=5
    ).strip()


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass


def stop_runtime(runtime: HawkRuntime) -> None:
    stop_process(runtime.backend)
    stop_process(runtime.rqbit)


def start_hawk(
    cancel: threading.Event | None = None,
    replace: HawkRuntime | None = None,
) -> HawkRuntime:
    node = install_node()
    bun = install_bun()
    rqbit = install_rqbit()
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
    if cancel is not None and cancel.is_set():
        raise RuntimeError("Hawk reload cancelled")
    print("event=hawk_frontend_build", flush=True)
    subprocess.run([bun, "run", "build"], cwd=ROOT, env=env, check=True, timeout=120)

    if cancel is not None and cancel.is_set():
        raise RuntimeError("Hawk reload cancelled")
    if replace is not None:
        stop_runtime(replace)
    stop_existing_hawk()
    download_dir = Path("/tmp/hawk-downloads")
    shutil.rmtree(download_dir, ignore_errors=True)
    download_dir.mkdir(parents=True, exist_ok=True)
    rqbit_env = env | {"RUST_LOG": "warn"}
    rqbit_process: subprocess.Popen[bytes] | None = None
    process: subprocess.Popen[bytes] | None = None
    try:
        rqbit_process = subprocess.Popen(
            [
                rqbit,
                "--http-api-listen-addr", f"127.0.0.1:{RQBIT_PORT}",
                "--single-thread-runtime",
                "--peer-limit", "128",
                "--disable-dht-persistence",
                "--disable-upnp-port-forward",
                "--disable-lsd",
                "--ipv4-only",
                "--listen-port", "0",
                "--trackers-filename", str(ROOT / "rqbit-trackers.txt"),
                "server", "start", "--disable-persistence", str(download_dir),
            ],
            cwd=ROOT,
            env=rqbit_env,
            start_new_session=True,
        )
        RQBIT_PID_FILE.write_text(f"{rqbit_process.pid}\n")
        rqbit_deadline = time.monotonic() + 15
        while time.monotonic() < rqbit_deadline:
            if cancel is not None and cancel.is_set():
                raise RuntimeError("Hawk reload cancelled")
            if rqbit_process.poll() is not None:
                raise RuntimeError(f"rqbit exited during startup with code {rqbit_process.returncode}")
            try:
                with urlopen(f"http://127.0.0.1:{RQBIT_PORT}/", timeout=1) as response:
                    payload = json.loads(response.read().decode())
                    if response.status == 200 and payload.get("version") == RQBIT_VERSION:
                        print(f"event=hawk_rqbit_ready port={RQBIT_PORT} version={RQBIT_VERSION}", flush=True)
                        break
            except (OSError, ValueError):
                time.sleep(0.1)
        else:
            raise TimeoutError("rqbit did not become healthy within 15 seconds")

        env.update(
            {
                "PORT": str(HAWK_PORT),
                "HAWK_REVISION": repository_revision(),
                "RQBIT_URL": f"http://127.0.0.1:{RQBIT_PORT}",
            }
        )
        process = subprocess.Popen(
            [node, ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs", "src/server.ts"],
            cwd=ROOT,
            env=env,
            start_new_session=True,
        )
        HAWK_PID_FILE.write_text(f"{process.pid}\n")
        runtime = HawkRuntime(backend=process, rqbit=rqbit_process)

        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if cancel is not None and cancel.is_set():
                raise RuntimeError("Hawk reload cancelled")
            if process.poll() is not None:
                raise RuntimeError(f"Hawk exited during startup with code {process.returncode}")
            if rqbit_process.poll() is not None:
                raise RuntimeError(f"rqbit exited during startup with code {rqbit_process.returncode}")
            try:
                with urlopen(f"http://127.0.0.1:{HAWK_PORT}/health", timeout=1) as response:
                    payload = json.loads(response.read().decode())
                    if response.status == 200 and payload.get("revision") == env["HAWK_REVISION"]:
                        print(f"event=hawk_ready port={HAWK_PORT}", flush=True)
                        return runtime
            except (OSError, ValueError):
                time.sleep(0.25)
        raise TimeoutError("Hawk did not become healthy within 30 seconds")
    except BaseException:
        if process is not None:
            stop_process(process)
        if rqbit_process is not None:
            stop_process(rqbit_process)
        raise


async def watch_deployment(application: Starlette) -> None:
    """Replace Hawk after a Git update or an unexpected child-process exit."""
    revision = repository_revision()
    replacement: asyncio.Task[HawkRuntime] | None = None
    cancel = threading.Event()
    try:
        while True:
            await asyncio.sleep(3)
            try:
                current = await asyncio.to_thread(repository_revision)
            except Exception as error:
                print(f"event=hawk_revision_error error={error!r}", flush=True)
                continue

            failure: str | None = None
            runtime_to_replace: HawkRuntime | None = None
            hawk_task: asyncio.Task[HawkRuntime] = application.state.hawk_task
            if hawk_task.done() and not hawk_task.cancelled():
                try:
                    runtime = hawk_task.result()
                    runtime_to_replace = runtime
                    if runtime.backend.poll() is not None:
                        failure = f"backend:{runtime.backend.returncode}"
                    elif runtime.rqbit.poll() is not None:
                        failure = f"rqbit:{runtime.rqbit.returncode}"
                except Exception as error:
                    failure = f"startup:{error!r}"

            if current == revision and failure is None:
                continue

            if current != revision:
                print(f"event=hawk_revision_changed from={revision} to={current}", flush=True)
            else:
                print(f"event=hawk_runtime_failed component={failure}", flush=True)
            replacement = asyncio.create_task(
                asyncio.to_thread(start_hawk, cancel, runtime_to_replace)
            )
            try:
                await asyncio.shield(replacement)
            except Exception as error:
                print(f"event=hawk_reload_error revision={current} error={error!r}", flush=True)
                replacement = None
                continue
            application.state.hawk_task = replacement
            replacement = None
            revision = current
            print(f"event=hawk_reloaded revision={revision}", flush=True)
    finally:
        cancel.set()
        if replacement is not None:
            try:
                started = await asyncio.shield(replacement)
            except (Exception, asyncio.CancelledError):
                pass
            else:
                await asyncio.to_thread(stop_runtime, started)


@asynccontextmanager
async def lifespan(application: Starlette):
    print(f"event=hawk_launcher version={LAUNCHER_VERSION}", flush=True)
    nookwire_task = asyncio.create_task(asyncio.to_thread(start_nookwire))
    hawk_task = asyncio.create_task(asyncio.to_thread(start_hawk))
    application.state.hawk_task = hawk_task
    application.state.client = httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{HAWK_PORT}", timeout=None
    )
    deployment_task = asyncio.create_task(watch_deployment(application))
    try:
        yield
    finally:
        deployment_task.cancel()
        try:
            await deployment_task
        except asyncio.CancelledError:
            pass
        await application.state.client.aclose()
        hawk_task = application.state.hawk_task
        hawk: HawkRuntime | None = None
        if hawk_task.done() and not hawk_task.cancelled():
            try:
                hawk = hawk_task.result()
            except Exception:
                pass
        else:
            def stop_after_start(task: asyncio.Task[HawkRuntime]) -> None:
                try:
                    stop_runtime(task.result())
                except (Exception, asyncio.CancelledError):
                    pass

            hawk_task.add_done_callback(stop_after_start)
        if hawk is not None:
            await asyncio.to_thread(stop_runtime, hawk)
            try:
                if HAWK_PID_FILE.read_text().strip() == str(hawk.backend.pid):
                    HAWK_PID_FILE.unlink()
            except FileNotFoundError:
                pass
            try:
                if RQBIT_PID_FILE.read_text().strip() == str(hawk.rqbit.pid):
                    RQBIT_PID_FILE.unlink()
            except FileNotFoundError:
                pass
        if not nookwire_task.done():
            nookwire_task.cancel()


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


async def proxy(request: Request) -> Response:
    hawk_task: asyncio.Task[HawkRuntime] = request.app.state.hawk_task
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
