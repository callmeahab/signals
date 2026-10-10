# SPDX-License-Identifier: Apache-2.0
# Review round 2, check 5: drive one MCP tool call against the Python SDK
# example over streamable HTTP. Runs inside the signals-python uv environment:
#
#   uv run --project /home/vuk/orca/projects/signals-python \
#       python reports/review-r2/sdk_client.mcp.py http://127.0.0.1:PORT/mcp
import asyncio
import sys

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main(url):
    async with streamable_http_client(url) as streams:
        async with ClientSession(*streams) as client:
            init = await client.initialize()
            print("initialized:", init.server_info.name, init.server_info.version)
            tools = await client.list_tools()
            print("tools:", sorted(t.name for t in tools.tools))
            result = await client.call_tool("add", {"a": 2, "b": 3})
            print("call_tool add(2,3) is_error:", result.is_error)
            print("content:", [getattr(c, "text", c) for c in result.content])
            await asyncio.sleep(0.2)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
