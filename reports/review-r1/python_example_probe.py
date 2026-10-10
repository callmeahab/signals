#!/usr/bin/env python3
"""Review round 1 probe: start the shipped examples/python/server.py with the local
SDK checkouts, drive one tool call with the real MCP client, and assert the events
reach the spec's mock collector.

  PROBE_OUT=... /home/vuk/orca/projects/signals-python/.venv/bin/python \
      reports/review-r1/python_example_probe.py
"""
import asyncio
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get("PROBE_OUT", "/tmp/review-r1-out"))
OUT.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("PROBE_PY_EXAMPLE_PORT", "23365"))
MOCK_PORT = int(os.environ.get("PROBE_MOCK_PORT", "23366"))
SPEC = "/home/vuk/orca/projects/signals-spec/conformance/src/serve.mjs"
record = OUT / "python-example-record.ndjson"
record.write_text("")

mock = subprocess.Popen(["node", SPEC, "--port", str(MOCK_PORT), "--record", str(record),
                         "--key", "sgk_test_x", "--quiet"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
env = dict(os.environ, SIGNALS_URL=f"http://127.0.0.1:{MOCK_PORT}", SIGNALS_KEY="sgk_test_x",
           PYTHONDONTWRITEBYTECODE="1")
server = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(PORT)],
                          cwd=str(REPO / "examples/python"), env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def wait(url, tries=200):
    for _ in range(tries):
        if server.poll() is not None:
            raise SystemExit("example server exited:\n" + server.stderr.read())
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.2)
    return False


async def drive():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    async with streamable_http_client(f"http://127.0.0.1:{PORT}/mcp") as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("add", {"a": 2, "b": 3})
            return [t.name for t in tools.tools], result


try:
    for _ in range(150):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{MOCK_PORT}/healthz", timeout=2).read()
            break
        except Exception:
            time.sleep(0.1)
    assert wait(f"http://127.0.0.1:{PORT}/mcp"), "example server did not start"
    names, result = asyncio.run(drive())
    text = result.content[0].text
    (OUT / "python-example-call.json").write_text(json.dumps({"tools": names, "text": text}, indent=2))
    assert names == ["add"], names
    assert text.strip() in {"5", "5.0"}, text
    print(f"PASS examples/python/server.py: tools {names}, add(2,3) -> {text.strip()}")
finally:
    server.terminate()
    try:
        server.wait(timeout=15)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
    deadline = time.time() + 10
    while time.time() < deadline and not record.read_text().strip():
        time.sleep(0.2)
    lines = [json.loads(line) for line in record.read_text().splitlines() if line.strip()]
    (OUT / "python-example-events.json").write_text(json.dumps(lines, indent=2))
    types = [line["event"]["type"] for line in lines]
    print(f"Recorded {len(lines)} events: {sorted(set(types))}")
    if lines:
        print("source:", json.dumps(lines[0]["source"]))
    mock.terminate()
    try:
        mock.wait(timeout=10)
    except subprocess.TimeoutExpired:
        mock.kill()
        mock.wait()
    assert lines, "no events reached the mock collector; server stderr:\n" + server.stderr.read()
    assert "tool.called" in types, types
    call = next(line for line in lines if line["event"]["type"] == "tool.called")
    assert call["event"]["attrs"]["tool"] == "add", call
    assert call["source"]["sdk"] == "python", call
    print("PASS python example events reached the spec mock collector with sdk=python and tool=add")
