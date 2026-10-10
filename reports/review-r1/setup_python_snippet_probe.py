#!/usr/bin/env python3
"""Review round 1 probe: run the Setup screen's Python snippet verbatim.

The snippet is read from the captured Setup screen text (PROBE_OUT/setup-python.txt,
written by setup-snippets-probe.mjs), written to a module, and started with uvicorn
from the local signals-python checkout's environment. The probe then speaks MCP over
HTTP to prove the server came up.

  /home/vuk/orca/projects/signals-python/.venv/bin/python \
      reports/review-r1/setup_python_snippet_probe.py
"""
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

OUT = pathlib.Path(os.environ.get("PROBE_OUT", "/tmp/review-r1-out"))
SNIPPET = (OUT / "setup-python.txt").read_text()
PORT = int(os.environ.get("PROBE_PY_PORT", "23360"))
MOCK_PORT = int(os.environ.get("PROBE_MOCK_PORT", "23361"))
SPEC = "/home/vuk/orca/projects/signals-spec/conformance/src/serve.mjs"

assert "Signals.from_env()" in SNIPPET, SNIPPET
module_dir = OUT / "python-snippet"
module_dir.mkdir(parents=True, exist_ok=True)
(module_dir / "snippet_app.py").write_text(SNIPPET)

record = OUT / "python-snippet-record.ndjson"
mock = subprocess.Popen(
    ["node", SPEC, "--port", str(MOCK_PORT), "--record", str(record), "--key", "sgk_test_x", "--quiet"],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
)
env = dict(os.environ, SIGNALS_URL=f"http://127.0.0.1:{MOCK_PORT}", SIGNALS_KEY="sgk_test_x",
           PYTHONPATH=str(module_dir), PYTHONDONTWRITEBYTECODE="1")
server = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "snippet_app:app", "--host", "127.0.0.1", "--port", str(PORT)],
    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=str(module_dir),
)


def wait(url, tries=150):
    for _ in range(tries):
        if server.poll() is not None:
            raise SystemExit("snippet server exited:\n" + server.stderr.read())
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.2)
    return False


try:
    assert wait(f"http://127.0.0.1:{PORT}/mcp"), "snippet server did not start"
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "review-r1", "version": "1.0"}},
    }).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/mcp", data=body,
        headers={"Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream",
                 "MCP-Protocol-Version": "2025-06-18"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        text = response.read().decode()
    (OUT / "python-snippet-initialize.txt").write_text(text)
    assert "serverInfo" in text, text
    print("PASS Setup Python snippet: imports, starts under uvicorn and answers MCP initialize")
    print(text.strip().splitlines()[-1][:200])
finally:
    for process in (server, mock):
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
