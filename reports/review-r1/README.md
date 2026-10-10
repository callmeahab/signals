# Review round 1 probes — collector dashboard + examples

Read-only probes written for `reviews/collector-dashboard-r1.md`. They add no
project tests and change no source; each one is runnable on its own. All of them
take `PROBE_OUT` (a scratch directory for captured artefacts, default
`/tmp/review-r1-out`) and pick ports above 23000.

| Probe | What it proves | How to run |
|---|---|---|
| `setup-snippets-probe.mjs` | The Setup screen's three snippets, captured from the running demo UI; the raw-HTTP batch validates against `batch.schema.json` + `events.schema.json`, passes the conformance ingest pipeline, and the copied `curl` command is accepted `202 {"accepted":1,"rejected":[]}` by the spec's mock collector. | `cd web && PLAYWRIGHT_CHANNEL=chromium node ../reports/review-r1/setup-snippets-probe.mjs` |
| `node-sdk-probe.mjs` | The Setup Node snippet imports, starts and answers MCP `initialize`; `examples/node/server.mjs` serves `tools/call` and its events reach the spec's mock collector. `PROBE_EXAMPLE_DIR` reruns the example from an install made exactly as `examples/README.md` documents. | `node reports/review-r1/node-sdk-probe.mjs` (needs `setup-snippets-probe.mjs` output first) |
| `setup_python_snippet_probe.py` | The Setup Python snippet imports, starts under uvicorn and answers MCP `initialize`. | `/home/vuk/orca/projects/signals-python/.venv/bin/python reports/review-r1/setup_python_snippet_probe.py` |
| `python_example_probe.py` | `examples/python/server.py` serves `tools/call` and its events reach the spec's mock collector with `source.sdk = python`. | `/home/vuk/orca/projects/signals-python/.venv/bin/python reports/review-r1/python_example_probe.py` |
| `backend-qa-batch-probe.mjs` | The batch literals inside `web/scripts/backend-qa.mjs` are spec-valid, and the reference collector answers `202 accepted=25` for both the first post and the replay, storing 25 events — the expectation the script asserts. | `node reports/review-r1/backend-qa-batch-probe.mjs` |
| `demo-fixture-probe.mjs` | Every event `web/apps/dashboard/src/demo.ts` and `examples/next-host/app/fixture.ts` serve is spec-valid (all ten types, UUIDv7, required attrs) and accepted by the mock collector. | `cd web && bun ../reports/review-r1/demo-fixture-probe.mjs` |
| `field-audit-probe.mjs` | Every `attrs` / `client` / `caller` / `source` field read anywhere in `web/` and `examples/` is defined by the spec or by the documented stored form, and `EventType` is exactly the spec enum. | `node reports/review-r1/field-audit-probe.mjs` |

The spec checkout (`/home/vuk/orca/projects/signals-spec`), the SDK checkouts and
the mock collector are referenced by absolute path; nothing outside this
repository is modified.
