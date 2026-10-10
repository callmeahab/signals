#!/usr/bin/env python3
"""Dependency-free static integration checks; see README.md for runtime setup."""
import ast
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
python_source = (root / "python/server.py").read_text()
ast.parse(python_source)
assert "Signals.from_env()" in python_source
assert "signals.instrument(mcp)" in python_source
assert "signals.asgi(mcp.streamable_http_app())" in python_source
assert "atexit.register(signals.close)" in python_source
print("PASS Python syntax, SDK instrumentation, ASGI identity wrapper and shutdown hook (static)")
node_path = root / "node/server.mjs"
subprocess.run(["node", "--check", str(node_path)], check=True)
node_source = node_path.read_text()
assert "Signals.fromEnv()" in node_source
assert node_source.index("signals.instrument(server)") < node_source.index("server.connect(transport)")
assert "app.use(signals.express())" in node_source
assert "await signals.close()" in node_source
print("PASS Node syntax, instrument-before-connect, Express identity middleware and shutdown hook (static)")
print("Runtime HTTP/collector interoperability requires local SDK installs; see examples/README.md")
