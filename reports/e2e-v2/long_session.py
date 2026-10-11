#!/usr/bin/env python3
"""Hold one MCP session per egg open for 20 minutes, with a call every 5 minutes."""
import asyncio
import time
from datetime import datetime, timezone

from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Implementation

INTERVAL = 300
CALLS = 5  # t=0, 5, 10, 15 and 20 minutes


def stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def hold(port):
    url = f"http://10.8.0.11:{port}/mcp"
    version = "long-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    print(stamp(), "open", port, "client", "e2e-v2-long", version, flush=True)
    async with streamable_http_client(url) as streams:
        get_session_id = streams[2] if len(streams) > 2 else None
        async with ClientSession(
            streams[0],
            streams[1],
            client_info=Implementation(name="e2e-v2-long", version=version),
        ) as client:
            init = await client.initialize()
            sid = get_session_id() if callable(get_session_id) else None
            print(
                stamp(),
                port,
                "initialize",
                init.server_info.name,
                init.server_info.version,
                "session",
                sid,
                flush=True,
            )
            started = time.monotonic()
            for i in range(CALLS):
                delay = i * INTERVAL - (time.monotonic() - started)
                if delay > 0:
                    print(stamp(), port, "sleep", round(delay, 1), flush=True)
                    await asyncio.sleep(delay)
                result = await client.call_tool("search_products", {"query": "Mug", "limit": 1})
                elapsed = round(time.monotonic() - started, 1)
                print(
                    stamp(),
                    port,
                    "call",
                    i,
                    "elapsed_s",
                    elapsed,
                    "is_error",
                    bool(result.is_error),
                    flush=True,
                )
                if result.is_error:
                    raise SystemExit(f"{port} call {i} returned is_error")
            held = round(time.monotonic() - started, 1)
            print(stamp(), port, "closing", "held_s", held, "session", sid, flush=True)
    print(stamp(), port, "closed", flush=True)


async def main():
    results = await asyncio.gather(hold(8000), hold(8001), return_exceptions=True)
    failed = False
    for result in results:
        if isinstance(result, BaseException):
            failed = True
            print(stamp(), "FAIL", type(result).__name__, result, flush=True)
    if failed:
        raise SystemExit(1)
    print(stamp(), "PASS long sessions closed", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
