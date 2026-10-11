# End-to-end review of the rtxbox Signals deployment

VERDICT: changes required

Review only. No source, config, `.env`, or running container was edited. Restarts below used `docker restart` on the three app containers. `docker compose down` was not used. Credentials were read and not printed; the login email in the author's script output is redacted as `<bootstrap-email>`.

## Blockers

### 1. Setup blanks the dashboard on the deployed origin

The brief requires the Setup screen to show the SDK snippets. Opening Setup at `http://10.8.0.11:8300/#setup` throws and leaves a blank page, so none of the Python, Node, or cURL snippets render.

Command:

```sh
node reports/e2e/capture.mjs /home/vuk/orca/workspaces/signals-collector/collector-dashboard/web/node_modules/.bun/playwright@1.63.0/node_modules/playwright/index.mjs
```

Observed (after a successful sign-in, with Live, Tools, Sessions, and the Live errors filter already captured for both projects):

```text
setup-links 1 hrefs [ '#setup' ]
crypto {"isSecureContext":false,"randomUUID":"undefined","getRandomValues":"function"}
pageerror crypto.randomUUID is not a function
setup-url http://10.8.0.11:8300/#setup
setup-body-empty true
setup-has-python-snippet false
setup-has-node-snippet false
setup-has-curl-snippet false
```

`reports/e2e/setup-crash.png` is an empty page. Chromium on this origin reports `isSecureContext: false`, so `crypto.randomUUID` is absent while `crypto.getRandomValues` exists. `SetupScreen` calls `crypto.randomUUID()` while building the sample cURL batch (`web/packages/ui/src/dashboard.tsx`, the `useState` initializer in `SetupScreen`). That throw unmounts the React tree. Expected: the Setup screen shows the Python, Node.js, and cURL SDK snippets. This violates brief check 5.

## Should-fix

### 1. Sessions list shows every client as Unknown

The Client column is hardcoded to `s.client?.name`, but `GET /v1/projects/{id}/sessions` returns `client_name` and no `client` object. Every row therefore renders Unknown even when the stored name is present.

Dashboard session after sign-in, both projects:

```text
egg-node sessions 7 shows-e2e-rtxbox false shows-Unknown true
egg-python sessions 7 shows-e2e-rtxbox false shows-Unknown true
```

Read API for egg-node (keys and the client field only):

```text
sessions 7 status ok
keys ['caller_label', 'calls', 'client_name', 'ended_at', 'errors', 'session_id', 'started_at', 'transport']
client_name e2e-rtxbox
client None
distinct client_name ['e2e-rtxbox', 'mcp']
```

Expected: the Client column shows `e2e-rtxbox` / `mcp`, which the API already returns as `client_name`. The UI reads `s.client?.name` in `SessionsScreen` (`web/packages/ui/src/dashboard.tsx`). Screenshots: `reports/e2e/egg-node-sessions.png`, `reports/e2e/egg-python-sessions.png`.

## Verified claims

Author acceptance script re-run from this checkout. Exit 0. Both eggs answered `initialize` and `search_products` (`total == 1`). Both SDK sources were visible through the dashboard read API. Full redacted output is below.

| Check | Result |
|---|---|
| `deploy/compose/verify-rtxbox.py` | PASS, exit 0 |
| 15 tools on each egg, valid example arguments | 15/15 listed. 14/15 valid calls `ok: true` on both eggs. Node `book_ticket` with example `seat_10a` returned `OUT_OF_STOCK` because that seat was already `available: false` (one existing flight booking). A same-shaped call with free `seat_10b` returned `ok: true`. Python `book_ticket` with `seat_10a` returned `ok: true`. `place_food_order` used the quote id returned by `get_delivery_quote` (contract note). Idempotency keys were the example shape with a unique `e2e-…` suffix so prior demos were not replayed. |
| Two invalid calls per egg | `get_product` unknown id → `is_error`, `NOT_FOUND`. `search_flights` SFO→SFO → `is_error`, `VALIDATION_ERROR` ("Origin and destination must differ"). |
| Each call stored once | Client version `tools-20261011005925`: every tool name count matches the calls made (15 valid + 2 invalid + 1 absent `echo`). Burst version `burst-20261011005925`: `search_products` count 50 on each egg. No duplicates. |
| `duration_ms`, `input_bytes`, `output_bytes` on tool calls | Present on every `tool.called` row for those versions. `session.started` and `mcp.initialize` omit `duration_ms`, which the event schema does not require. |
| `caller.ip_hash`, no raw `caller.ip` | All 223 events have a 64-hex `caller.ip_hash`. Zero events have `caller.ip`. Zero event `attrs` contain an `"ip"` key. Read API sample of this run's `tool.called` rows: `missing_hash 0`, `raw_ip 0` on both projects. |
| Session lifecycle | One stateful session per egg (`tools-20261011005925`) has `session.started` (`transport: streamable-http`), `mcp.initialize`, and `session.ended` (`reason: client`) on one session id. Close was the MCP client's session DELETE. |
| Spec scenario `basic.json` | Not feasible on these servers. They do not implement `echo`, `fail`, `slow`, or `demo://hello`. `echo` was unknown on both (one `tool.called` `is_error` each). `resources/read demo://hello` was `resource.read` `is_error`. No cancellation step was run because there is no slow tool. Instead, each egg did initialize, `tools/list`, the 15 tools, two invalid calls, `resources/read ui://mcpramen/shop.html` (879360 chars, `is_error: false`), and session DELETE. |
| Dashboard Live, Tools, Sessions, Errors | Captured for both projects under `reports/e2e/`. There is no Errors route. Errors is the Live filter `All errors` (`value=errors`): egg-node 5 rows, egg-python 4 rows. Tools listed 16 rows per project (15 contract tools plus `echo`). |
| Setup snippets | Failed. See Blockers. |
| Restart collector | `docker restart signals-signals-1`. `/readyz` 200 at t=2s (`ready`). A following `search_products` was stored (`collector-20261011010724`, five events including `tool.called`). |
| Restart eggs | `docker restart egg-node-app-1` then `egg-python-app-1`. Initialize plus `search_products` succeeded in 0.095s (node) and 0.408s (python), both inside 60s. New `session.started`, `mcp.initialize`, `tool.called`, and `session.ended` `reason: client` rows appeared for `node-restart-20261011010724` and `python-restart-20261011010724`. Containers were healthy afterward. |
| Reachability | `10.8.0.11:8300`, `:8000`, `:8001` `/healthz` returned 200. `ss` shows those listeners on `10.8.0.11` only. `192.168.22.23` and `0.0.0.0` refused all three, and `:8300` also refused on `127.0.0.1`. Postgres is not published (`docker port signals-postgres-1` empty; `:5432` refused on `127.0.0.1` and `10.8.0.11`). |
| Rate limit | Admin login projects and `projects.rate_events_per_min` are both 5000 for `egg-node` and `egg-python`. Burst of 50 `search_products` was not limited: node 0.152s, python 1.154s, 0 client errors, 50 stored calls each. The `00:59` rate window recorded 79 events per project (the whole probe), under 5000. |

Deployed auth profile on both eggs is `none`, so the MCP client used no Authorization header, matching `verify-rtxbox.py`.

## Probes committed

- `reports/review-e2e/probe_e2e.py` — 15 tools, two invalid calls, absent spec primitives, shop resource, 50-call burst. Run id `20261011005925`.
- `reports/review-e2e/restart_probe.py` — initialize plus one `search_products`, retried until a deadline.
- `reports/e2e/capture.mjs` — Playwright capture.
- `reports/e2e/egg-node-live.png`, `egg-node-tools.png`, `egg-node-sessions.png`, `egg-node-errors.png`
- `reports/e2e/egg-python-live.png`, `egg-python-tools.png`, `egg-python-sessions.png`, `egg-python-errors.png`
- `reports/e2e/setup-crash.png`

## Commands and output

### 1. Author script

```sh
python3 deploy/compose/verify-rtxbox.py
```

```text
GET /healthz 200 ok
GET /readyz 200 ready
egg-node GET /v1/whoami 200 {"label": "egg-node", "project": "e34d7589-4578-4549-83fd-a061dc41e65b", "scopes": ["ingest"]}
egg-python GET /v1/whoami 200 {"label": "egg-python", "project": "d1fe4dc3-415d-436b-aca5-a4409b6831cd", "scopes": ["ingest"]}
$ docker exec egg-node-app-1 node -e 'fetch('"'"'http://10.8.0.11:8300/healthz'"'"').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})'
200 ok
$ docker exec egg-python-app-1 python -c 'import urllib.request; r=urllib.request.urlopen('"'"'http://10.8.0.11:8300/healthz'"'"'); print(r.status,r.read().decode())'
200 ok
egg-node initialize {'name': 'mcpramen-egg-node', 'version': '1.0.0', ...}
egg-node search_products ok total 1
egg-python initialize {'name': 'MCP Ramen Egg', 'version': '4.0.10', ...}
egg-python search_products ok total 1
POST /v1/auth/login 200 <bootstrap-email>
GET /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b/events 200 events= 20 tool.called= 4 sdk= node
GET /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd/events 200 events= 25 tool.called= 5 sdk= python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
EXIT:0
```

The grouped event counts at that moment were 4 of each lifecycle type for egg-node and 5 for egg-python, sdk `node` / `python`.

### 2. Tool probe

```sh
docker exec -i egg-python-app-1 python - < reports/review-e2e/probe_e2e.py
```

Exit 0. Run `20261011005925`. Both eggs listed the same 15 contract tools. Node also listed resource `ui://egg/app.html` plus the five `ui://mcpramen/*.html` resources. Python listed those five. Shop resource read was 879360 characters on both. `demo://hello` was unknown on both. Node `echo` raised `MCPError: Unknown tool` and was still stored once as `tool.called` `is_error`. Python `echo` returned `is_error` text `Unknown tool: 'echo'`.

Valid-call failures were only node `book_ticket` (`OUT_OF_STOCK`, seat already sold). Follow-up from the host venv:

```text
{"is_error": false, "ok": true, "error_code": null}
```

against node `book_ticket` with `seat_id` `seat_10b`.

Burst: `{"egg": "egg-node", "phase": "burst-done", "calls": 50, "client_errors": 0, "seconds": 0.152}` and `{"egg": "egg-python", "phase": "burst-done", "calls": 50, "client_errors": 0, "seconds": 1.154}`.

Census (trimmed to the columns that matter; full query grouped by slug, client_version, type, tool):

```text
egg-node   tools-20261011005925  session.started 1, mcp.initialize 1, mcp.request 2, resource.read 2 (1 error), session.ended 1
egg-node   tools-20261011005925  tool.called: each of the 15 tools once, plus a second get_product and search_flights (the invalid calls), plus echo once
egg-node   burst-20261011005925  search_products 50, plus session.started / mcp.initialize / mcp.request tools/list / session.ended
egg-python same counts
missing duration/input_bytes/output_bytes on tool.called: 0
missing ip_hash: 0
raw caller.ip: 0
```

The extra `tools/list` on the burst session is the MCP Python client refreshing the output-schema cache on the first successful `call_tool` (`mcp/client/session.py`, `validate_tool_result`), not a second copy of a tool call.

Session rows for `tools-20261011005925` and `burst-20261011005925`, both eggs: `session.ended.reason = client`, `session.started.transport = streamable-http`, one session id per version.

### 3. Read API and rate

Login `200`, two projects. `egg-node` and `egg-python` both `rate_events_per_min 5000`, retention 30. `GET /v1/projects/{id}/events?type=tool.called` matched 68 `e2e-rtxbox` events ending in `20261011005925` on each project (18 census tool calls + 50 burst), `missing_hash 0`, `raw_ip 0`, `missing_dur 0`, `missing_bytes 0`.

```text
 egg-python | 2026-10-11 00:59:00+00 |     79 | 36155 |                5000
 egg-node   | 2026-10-11 00:59:00+00 |     79 | 36153 |                5000
```

79 = 25 lifecycle/tool/resource events + 54 burst-session events. Final table after the restart probes:

```text
 events | caller_ip | ip_hash | hex64 | attrs_ip
    223 |         0 |     223 |   223 |        0
```

### 4. Reachability

```text
10.8.0.11:8300/healthz -> 200 ok
10.8.0.11:8000/healthz -> 200 {"status":"ok","implementation":"python","contract_version":"1.0.0"}
10.8.0.11:8001/healthz -> 200 {"status":"ok","implementation":"node","contract_version":"1.0.0"}
192.168.22.23:8300 -> connection refused
192.168.22.23:8000 -> connection refused
192.168.22.23:8001 -> connection refused
192.168.22.23:5432 -> connection refused
0.0.0.0:8300, :8000, :8001 -> connection refused
127.0.0.1:8300 -> connection refused
127.0.0.1:5432 -> connection refused
10.8.0.11:5432 -> connection refused
```

`ss -ltn` listeners for these ports:

```text
LISTEN 10.8.0.11:8300
LISTEN 10.8.0.11:8001
LISTEN 10.8.0.11:8000
```

`docker port signals-postgres-1` printed nothing.

### 5. Dashboard capture

Same Playwright command as section 1 of this report. Exit 0 on the run that recorded the Setup crash.

```text
signed-in
egg-node live 100
egg-node tools 16
egg-node sessions 7 shows-e2e-rtxbox false shows-Unknown true
egg-node errors 5 filter errors
egg-python live 100
egg-python tools 16
egg-python sessions 7 shows-e2e-rtxbox false shows-Unknown true
egg-python errors 4 filter errors
```

A `401` on the console before sign-in is `GET` of the session while logged out. It did not persist after sign-in.

### 6. Restarts

```text
STAMP 20261011010724
events before collector restart: 208
docker restart signals-signals-1   (returned in 0s)
t=1s readyz=000 connection refused
t=2s readyz=200 ready
post-restart search_products: {"ok": true, "port": 8001, "version": "collector-20261011010724", "seconds": 0.137, "server": "mcpramen-egg-node", "is_error": false}
stored: session.started, mcp.initialize, mcp.request, tool.called search_products, session.ended; ip_hash true; raw ip false

docker restart egg-node-app-1
{"ok": true, "port": 8001, "version": "node-restart-20261011010724", "seconds": 0.095, "server": "mcpramen-egg-node", "is_error": false}

docker restart egg-python-app-1   (restart command returned in 1s)
{"ok": true, "port": 8000, "version": "python-restart-20261011010724", "seconds": 0.408, "server": "MCP Ramen Egg", "is_error": false}

both restart versions stored session.started (streamable-http), mcp.initialize, tool.called, session.ended reason=client
egg-node-app-1 Up (healthy)
egg-python-app-1 Up (healthy)
signals-signals-1 Up
```

Host client for the restart probes: `/tmp/e2e-mcp-venv` with `mcp==2.3.0`, outside either egg container.
