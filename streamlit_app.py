from pathlib import Path
import subprocess
import sys

import streamlit as st


@st.cache_resource
def start_nookwire() -> tuple[int, str]:
    root = Path(__file__).resolve().parent
    start = subprocess.run(
        [sys.executable, "-m", "nookwire_ssh.cli", "start", str(root), "--accept"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=90,
    )
    output = start.stdout.strip()

    if start.returncode == 0:
        connect = subprocess.run(
            [sys.executable, "-m", "nookwire_ssh.cli", "connect"],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
        )
        output = "\n\n".join(part for part in (output, connect.stdout.strip()) if part)

    print(output, flush=True)
    return start.returncode, output


ssh_status, ssh_info = start_nookwire()

st.title("🎈 My new app")
st.write(
    "Let's start building! For help and inspiration, head over to [docs.streamlit.io](https://docs.streamlit.io/)."
)

st.subheader("SSH access")
if ssh_status == 0:
    st.warning("Authentication is disabled. Anyone with these connection details can connect.")
else:
    st.error("Nookwire SSH failed to start.")
st.code(ssh_info or "Nookwire SSH produced no output.", language="text")
