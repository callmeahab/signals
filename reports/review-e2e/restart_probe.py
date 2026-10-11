#!/usr/bin/env python3
"""One initialize plus one search_products. Prints JSON. No secrets."""
import asyncio
import json
import sys
import time

from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Implementation


async def main():
    port = int(sys.argv[1])
    version = sys.argv[2]
    deadline = time.monotonic() + float(sys.argv[3]) if len(sys.argv) > 3 else time.monotonic() + 60
    last = None
    while True:
        started = time.monotonic()
        try:
            async with streamable_http_client("http://10.8.0.11:%d/mcp" % port) as streams:
                async with ClientSession(
                    streams[0],
                    streams[1],
                    client_info=Implementation(name="e2e-rtxbox", version=version),
                ) as client:
                    init = await client.initialize()
                    result = await client.call_tool("search_products", {"query": "Mug", "limit": 1})
                    info = init.server_info
                    print(json.dumps({
                        "ok": True,
                        "port": port,
                        "version": version,
                        "seconds": round(time.monotonic() - started, 3),
                        "server": getattr(info, "name", None),
                        "is_error": bool(result.is_error),
                    }), flush=True)
                    return
        except Exception as exc:
            last = "%s: %s" % (type(exc).__name__, exc)
            if time.monotonic() >= deadline:
                print(json.dumps({"ok": False, "port": port, "version": version, "error": last[:400]}), flush=True)
                sys.exit(1)
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())
