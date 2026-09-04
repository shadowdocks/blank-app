from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit_app import (  # noqa: E402
    HAWK_PORT,
    NODE_VERSION,
    ROOT,
    RQBIT_PORT,
    RQBIT_VERSION,
    install_bun,
    install_node,
    install_rqbit,
    rqbit_command,
    stop_process,
)


def log_line(service: str, label: str, message: str) -> None:
    colors = {"api": 94, "rqbit": 95, "web": 36}
    enabled = sys.stdout.isatty() and "NO_COLOR" not in os.environ

    def paint(code: int, value: str) -> str:
        return f"\033[{code}m{value}\033[0m" if enabled else value

    def bold_paint(code: int, value: str) -> str:
        return f"\033[1;{code}m{value}\033[0m" if enabled else value

    def timestamp_paint(value: str) -> str:
        return f"\033[2;37m{value}\033[0m" if enabled else value

    timestamp = time.strftime("%H:%M:%S")
    service_label = f"[{service}]".ljust(9)
    status_label = label.upper().rjust(4)
    print(
        f"{timestamp_paint(timestamp)} {bold_paint(colors.get(service, 37), service_label)} "
        f"{paint(36, status_label)} {message}",
        flush=True,
    )


def wait_for_json(url: str, process: subprocess.Popen[bytes], expected: dict[str, object], seconds: int) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{process.args[0]} exited during startup with code {process.returncode}")
        try:
            with urlopen(url, timeout=1) as response:
                payload = json.loads(response.read().decode())
            if response.status == 200 and all(payload.get(key) == value for key, value in expected.items()):
                if process.poll() is not None:
                    raise RuntimeError(f"{process.args[0]} exited during startup with code {process.returncode}")
                return
        except (OSError, ValueError):
            time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for {url}")


def interrupt(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def main() -> int:
    signal.signal(signal.SIGTERM, interrupt)
    node = install_node()
    bun = install_bun()
    rqbit = install_rqbit()
    downloads = Path("/tmp/hawk-dev-downloads")
    shutil.rmtree(downloads, ignore_errors=True)
    downloads.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["PATH"] = f"{node.parent}:{bun.parent}:{env.get('PATH', '')}"
    rqbit_process: subprocess.Popen[bytes] | None = None
    backend: subprocess.Popen[bytes] | None = None
    vite: subprocess.Popen[bytes] | None = None
    try:
        rqbit_process = subprocess.Popen(
            rqbit_command(rqbit, downloads),
            cwd=ROOT,
            env=env | {"RUST_LOG": "warn"},
            start_new_session=True,
        )
        wait_for_json(
            f"http://127.0.0.1:{RQBIT_PORT}/",
            rqbit_process,
            {"version": RQBIT_VERSION},
            15,
        )
        log_line("rqbit", "ready", f"version={RQBIT_VERSION} url=http://127.0.0.1:{RQBIT_PORT}")

        backend_env = env | {
            "PORT": str(HAWK_PORT),
            "HAWK_REVISION": "dev",
            "LANG": "en_GB.UTF-8",
            "LC_TIME": "en_GB.UTF-8",
            "RQBIT_URL": f"http://127.0.0.1:{RQBIT_PORT}",
        }
        backend = subprocess.Popen(
            [
                node,
                ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs",
                "watch",
                "--clear-screen=false",
                "src/server.ts",
            ],
            cwd=ROOT,
            env=backend_env,
            start_new_session=True,
        )
        wait_for_json(
            f"http://127.0.0.1:{HAWK_PORT}/health",
            backend,
            {"status": "ok", "revision": "dev"},
            30,
        )
        log_line("api", "ready", f"node={NODE_VERSION} url=http://127.0.0.1:{HAWK_PORT}")
        vite = subprocess.Popen(
            [bun, "run", "vite", *sys.argv[1:]],
            cwd=ROOT,
            env=env,
            start_new_session=True,
        )
        return vite.wait()
    except KeyboardInterrupt:
        return 130
    finally:
        for process in (vite, backend, rqbit_process):
            if process is not None:
                stop_process(process)
        shutil.rmtree(downloads, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
