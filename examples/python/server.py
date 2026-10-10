"""Instrumented MCP HTTP server; install and run using ../README.md."""
import atexit
import math
from mcp.server.mcpserver import MCPServer
from mcpramen_signals import Signals

signals = Signals.from_env()
mcp = MCPServer("signals-python-example", stateless_http=True)


@mcp.tool()
def add(a: float, b: float) -> float:
    """Add two finite numbers."""
    if not all(math.isfinite(value) for value in (a, b, a + b)):
        raise ValueError("Expected two finite numbers and a finite sum")
    return a + b


signals.instrument(mcp)
app = signals.asgi(mcp.streamable_http_app())
atexit.register(signals.close)
