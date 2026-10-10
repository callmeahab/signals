# Instrumented MCP examples

These servers use the Signals SDKs and the MCP SDK transports. Signals reads
`SIGNALS_URL` (the collector base URL, without `/v1/events`) and `SIGNALS_KEY`
(the full `sgk_…` ingest secret). Without either variable telemetry is a no-op.

```sh
export SIGNALS_URL=http://127.0.0.1:8300
export SIGNALS_KEY=sgk_your_ingest_secret
```

The SDKs are currently unpublished; install from local checkouts. Build the Node
SDK in its own checkout following its README before installing it here.

## Node

From `examples/node`:

```sh
npm install /path/to/signals-node
npm install @modelcontextprotocol/sdk express zod
node server.mjs
```

Connect your MCP client to `http://127.0.0.1:23001/mcp` (override with `PORT`).
The Express middleware supplies caller identity; instrumentation runs before
connecting every stateless transport. SIGINT/SIGTERM closes the HTTP listener
and flushes telemetry.

## Python

From `examples/python`:

```sh
uv venv
uv pip install "/path/to/signals-python[mcp]" uvicorn
uv run uvicorn server:app --host 127.0.0.1 --port 23002
```

Connect your MCP client to `http://127.0.0.1:23002/mcp`. The ASGI wrapper supplies
caller identity and forwards the MCP app lifespan. Process exit closes Signals.

## Smoke checks

```sh
python3 examples/smoke.py
```

This dependency-free smoke check validates Python/Node syntax and the static SDK
integration points. The previous smoke test exercised a handwritten stdio protocol;
these examples now delegate protocol handling to real MCP SDKs over HTTP. Runtime
SDK/collector interoperability needs the local SDK installations above and a
collector supporting Signals spec v1.0.15, so it is not claimed by this static check.
The dashboard's spec event fixtures and browser behavior are checked by
`cd web && bun run test`.
