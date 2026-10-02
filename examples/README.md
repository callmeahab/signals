# MCP example servers

Node 22+ and Python 3.9+ stdio servers expose one `add` tool, measure success/error calls, and emit each request’s client identity to the collector. No dependencies are required:

```sh
SIGNALS_URL=http://localhost:8300 SIGNALS_API_KEY=sgk_... node examples/node/server.mjs
SIGNALS_URL=http://localhost:8300 SIGNALS_API_KEY=sgk_... python3 examples/python/server.py
```

Configure one of those commands and environment variables in your MCP client. They implement the MCP 2026-07-28 stateless stdio/tool subset; responses alone go to stdout. Telemetry delivery uses the explicit **provisional** local HTTP envelope, with immutable IDs/timestamps across retries. These are small demonstration servers, not official Signals SDK replacements or a durable offline spool. When Plan 1 arrives, replace the emission helper with the published SDK and verify its fixtures.

`python3 examples/smoke.py` exercises both through a real subprocess. Without a key it checks protocol behavior only; with `SIGNALS_URL` / `SIGNALS_API_KEY` it also emits real example telemetry. See the [MCP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) and [tool](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) specifications.

Requests carry protocol version and capabilities in `params._meta`; `server/discover` is supported, and complete results include `resultType` and server identity. The examples require no initialization handshake and do not infer a conversation/session from the process. Notifications receive no reply. Legacy clients receive a diagnostic naming the supported revision.
