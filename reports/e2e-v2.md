# Wave 4: dashboard v2 end-to-end review on rtxbox

VERDICT: changes required

Review only. No product source, container config, or `.env` was edited. The collector and both eggs were `docker restart`ed (not `docker compose down`) and recovered. Analytics settings were changed to prove a round-trip and restored to read 99.5 / mutate 98.0 on both projects.

Deployed collector image created 2026-10-11T18:50:29Z, code commit `932b99ea22fa0eb7a1ffdaa11702b2440e18f51e`. Eggs: node `d5a9387` on `10.8.0.11:8001`, python `dc9c24c` on `10.8.0.11:8000`. Dashboard `http://10.8.0.11:8300`. Projects `egg-node` (`e34d7589-4578-4549-83fd-a061dc41e65b`) and `egg-python` (`d1fe4dc3-415d-436b-aca5-a4409b6831cd`). Screenshots under `reports/e2e-v2/` include the workspace account and a key id; those values are not transcribed here.

## Blockers

### 1. A call to an unknown tool is a Tools row, and the same names are Settings SLO rows

Reproduce: `python3 reports/e2e-v2/tools_probe.py` called `e2e_v2_unknown_tool` once per egg at 2026-10-11T19:08:09Z (node raised `MCPError` "Unknown tool"; python returned `is_error: true`). Then open Tools and Settings, or `GET /v1/projects/{id}/analytics/tools?range=7d` and the Settings SLO class list. Saved responses: `reports/e2e-v2/egg-node-analytics.json`, `reports/e2e-v2/egg-python-analytics.json`. Screenshots: `reports/e2e-v2/egg-node-light-tools.png`, `reports/e2e-v2/egg-node-light-settings.png` (dark and egg-python copies match).

Observed: both projects report `catalog.advertised` 15, `catalog.used` 18, `catalog.dead` `[]`. The Tools table has 18 rows, including `e2e_v2_unknown_tool` (1 call, 0% success), `echo` (1 call, 0%), and `redeploy_v2_unknown_tool` (1 call, 0%). The Settings "SLO class" list has the same three names, each set to Mutate. Reliability does list them: `hallucinated_tools.names` is those three names on both eggs.

Expected: the unknown call is not a row. Unknown tools belong on Reliability.

Contract: brief item 3, "the unknown call is not a row".

Cause: `tools()` seeds the map from the catalogue and then inserts every called name (`crates/signals-store/src/analytics.rs`, the loop at lines 518-521). `used` counts any non-empty group (line 523). The Settings class list is that same tool set.

## Should-fix

### 1. Protocol Progress shows "long calls 0" instead of the waiting empty state

Reproduce: `reports/e2e-v2/egg-node-light-protocol.png` (7 day range) and `progress` in both analytics JSON files. Python's protocol screenshot is `reports/e2e-v2/egg-python-light-protocol.png`.

Observed: Sampling, Elicitation, and Tasks render "No data yet · Waiting for SDK events". Progress renders a table: long calls `0`, with progress pct "No data yet". Both JSON payloads are `{"long_calls":0,"with_progress_pct":null}`. No `progress` SDK events were sent. Sampling, elicitation, and tasks requests are null.

Expected: protocol events show the waiting empty state unless the opt-in events are on.

Contract: brief item 3, protocol events "waiting" unless opt-in is on.

Cause: `protocol()` sets `long_calls` to `Some(0)` whenever any call has a duration (`analytics.rs` line 875: `events.iter().any(|e| e.call() && e.duration_ms.is_some()).then_some(long.len())`). `ProtocolScreen` shows `NoData` only when every value is null or an empty array (`web/packages/ui/src/analytics.tsx` line 39). A zero fails that check, so the card becomes a table.

## Not filed

- Brief "unknown_tool count 1". This run stored exactly one `e2e_v2_unknown_tool` per egg (`is_error`, `error_kind=unknown_tool`; node also `error_code=-32602`). The 7 day window also contains one `echo` per egg (2026-10-11 00:59Z, `is_error`, empty `error_kind`, not in the catalogue) and one `redeploy_v2_unknown_tool` per egg (18:51Z, `error_kind=unknown_tool`). `hallucinated_tools.count` is 3 because the filter is `error_kind == unknown_tool` OR a called name absent from a known, non-truncated catalogue (`analytics.rs` lines 754-764). That is the window's history, not a second copy of this probe.
- Paths. The automated check required `search_products` and `get_product` inside one path string, and failed. The top 20 still contains the catalogue walk as consecutive pairs on both eggs: `get_product → create_order`, `create_order → search_flights`, `create_order → search_flights → get_seat_map`, `book_ticket → search_hotels`, `book_ticket → search_hotels → get_room_options`, `get_menu → get_delivery_quote`, plus `get_seat_map → book_ticket` and `get_delivery_quote → place_food_order` further down the screenshot. `search_products → get_product` is outside the top 20 because the burst pair dominates (`search_products → search_products`, 101 calls, 38%).
- Timeline text check. `browser.mjs --timeline` failed "timeline has five tool calls" because the open drawer is scrolled to the start and the visible text has one `TOOL.CALLED`. The timeline API has five `search_products` calls. egg-node offsets ms: 6, 300025, 600022, 900026, 1200014. egg-python: 127, 300104, 600108, 900093, 1200103. Both sessions end `reason=client` at about 1,200,022 ms and 1,200,134 ms. `analytics_facts` has five `tool.called` rows and one `session.ended` per egg.
- Settings reload timeout. After save, `page.reload()` kept `#settings`, and the probe waited for an Overview heading. The screenshot taken on that timeout (`egg-*-light-error.png`) is the Settings page with read SLO 99.4. The value had persisted. `restore-settings.mjs` put both projects back to 99.5 and the reloaded input stayed 99.5.
- Availability is null and the Reliability screen says no synthetic prober is connected. `probe_url` is unset, so that is the specified waiting state.
- Overview deltas say "No prior data". The previous 7 day window has 0 `tool.called` rows on both projects.
- Settings alert badges (volume and error-budget burn showing firing). The brief does not accept or reject alert firing. Rate limit on the page is 5000 events/min; the burst of 50 was not limited.

## Verified claims

### 1. `deploy/compose/verify-rtxbox.py` passes

Command, from this checkout: `python3 deploy/compose/verify-rtxbox.py` (stdout `reports/e2e-v2/verify-rtxbox.txt`). Exit 0. Last lines:

```
POST /v1/auth/login 200 <redacted>
GET /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b/events 200 events= 100 tool.called= 50 sdk= node
GET /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd/events 200 events= 100 tool.called= 58 sdk= python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
```

Not re-run after the later probes. A second run would add events. An earlier redaction pass in that file rewrote service-name substrings; the PASS line and the project ids above are intact.

### 2. Real MCP client against both eggs

Client is the `mcp` package inside `egg-python-app-1` (`docker exec -i egg-python-app-1 python -u -`). Host Python has no `mcp` module. Auth profile is none. Streamable HTTP does not expose a session id to this client (`session` prints `None`); sessions are identified by `client_name` / `client_version`.

Catalogue, invalid args, unknown tool, and a 50-call burst: `python3 reports/e2e-v2/tools_probe.py`, log `reports/e2e-v2/tools-probe.txt`, stamp `20261011190809`. Exit 0. Both eggs, all 15 catalogue tools `ok: true`, `is_error: false`. `book_ticket` used a free seat (`seat_1a` on node, `seat_10b` on python) because the example seat was already taken. Invalid `get_product` returned `NOT_FOUND` / `is_error true`. Invalid `search_flights` (same origin and destination) returned `VALIDATION_ERROR` / `is_error true`. Burst: node 50 calls, 0 errors, 0.171s; python 50 calls, 0 errors, 1.476s.

`analytics_facts` for `client_version=tools-20261011190809` matches that shape on both eggs: one success per catalogue tool, a second `is_error` row for `get_product` and `search_flights`, and one `is_error` row for `e2e_v2_unknown_tool`. Burst `burst-20261011190809` is 50 successful `search_products` per egg. Every one of those `tool.called` rows has `duration_ms`, `caller.ip_hash`, and `attrs.input_bytes`. `caller` keys on the `e2e-v2` calls are `ip_hash` and `subject_kind`. Raw `caller.ip` count is 0.

An earlier probe at 19:06:40Z (`tools-20261011190640`) died on a list-index bug in the probe (`examples` is a list) after initialize and tools/list. It stored 0 `tool.called` rows. The 19:08:09Z run is the one above.

20-minute session: `python3 reports/e2e-v2/long_session.py`, client `e2e-v2-long` version `long-20261011190322`. Held both eggs, `search_products` at elapsed 0, 300, 600, 900, and 1200 seconds, then closed. Tail of `reports/e2e-v2/long-session.txt`:

```
2026-10-11T19:23:22Z 8001 call 4 elapsed_s 1200.0 is_error False
2026-10-11T19:23:22Z 8001 closing held_s 1200.0 session None
2026-10-11T19:23:22Z 8001 closed
2026-10-11T19:23:22Z 8000 call 4 elapsed_s 1200.0 is_error False
2026-10-11T19:23:22Z 8000 closing held_s 1200.0 session None
2026-10-11T19:23:22Z 8000 closed
2026-10-11T19:23:22Z PASS long sessions closed
```

The 19:08:22Z line for port 8000 was spliced onto `sleep 299.` by an in-place rewrite while the process still had the file open. The database is the source of truth: both eggs have `session.started`, `mcp.initialize`, `tools.listed`, `mcp.request`, five `tool.called` `search_products` from 19:03:22Z through 19:23:22Z, and `session.ended` with `attrs.reason=client`. Timeline API JSON: `reports/e2e-v2/egg-node-timeline.json`, `reports/e2e-v2/egg-python-timeline.json`. Screenshots: `reports/e2e-v2/egg-*-light-sessions-timeline.png`.

### 3. Dashboard, both projects, both themes

`TMPDIR=/var/tmp/e2e-v2-playwright node reports/e2e-v2/browser.mjs` (chromium). Exit 1 because the assertion list recorded findings; page errors were none. Log `reports/e2e-v2/browser.txt`. Screenshots `{egg-node,egg-python}-{light,dark}-{overview,adoption,tools,reliability,sessions,callers,cost,protocol,settings}.png`.

Analytics responses were captured at 2026-10-11T19:10:15Z (egg-node) and 19:10:54Z (egg-python), range 7d. SQL against `analytics_facts` for those windows:

```
    slug    | node_window | python_window | prev
 egg-node   |         154 |           154 |    0
 egg-python |         153 |           153 |    0
```

Tiles match: egg-node tool calls 154 prev 0, success 94.8%, sessions 19, p95 8 ms, tokens 14068. egg-python tool calls 153 prev 0, success 95.4%, sessions 18, p95 10 ms, tokens 15315. The UI delta text is "No prior data" because prev is 0. Later long-session calls landed after this `to`, so live counts are higher than the screenshots. The equality is for the screenshot window.

Adoption, both projects: DAU 2, identity network 2 / key 0 / strong 0, funnel connected 2, listed_tools 2, first_call 2, five_calls 1, returned_day_7 null. Client mix includes `e2e-v2` (`tools-20261011190809`, 18 calls; `burst-20261011190809`, 50 calls) and `e2e-v2-long`.

Tools: advertised 15, dead list empty, per-tool success and p95 present (probe checked `search_products`, `get_product`, `book_ticket`, `place_food_order`, `reserve_tickets`). The unknown-row failure is Blocker 1.

Reliability: error split present, sessions with errors 3 (15.8% node, 16.7% python), handshake success 100%, availability waiting because the prober is off. The count of 3 is explained under Not filed.

Callers shows a network identity. Cost tokens are greater than 0 and "Tokens by tool" is populated (divisor 4, estimates). Protocol capability matrix: node 3 server capabilities (extensions, resources, tools) over 19 sessions; python 4 (logging, prompts, resources, tools) over 18 sessions. Sampling, elicitation, and tasks are waiting. Progress is Should-fix 1.

Settings round-trip. The browser run set read SLO from 99.5 to 99.4 and saved. The reload screenshot `egg-*-light-error.png` still shows read 99.4 and mutate 98. `TMPDIR=/var/tmp/e2e-v2-playwright node reports/e2e-v2/restore-settings.mjs` then restored both projects. `reports/e2e-v2/restore-settings.txt`:

```
egg-node before-restore 99.4
egg-node after-reload 99.5
egg-python before-restore 99.4
egg-python after-reload 99.5
```

Exit 0. Restored screenshots: `egg-*-light-settings-restored.png` (read 99.5, "Analytics settings saved"). Digest left disabled. Token divisor left at 4.

Dark theme: `documentElement` class `dark` applied, both projects present, the six analytics routes returned 200, page errors none (`browser.txt` lines 116-130).

### 4. Restart safety

`python3 reports/e2e-v2/restart.py`, log `reports/e2e-v2/restart.txt`. Exit 0. Containers restarted, in order: `signals-signals-1`, `egg-node-app-1`, `egg-python-app-1`. No other container. Tail:

```
2026-10-11T19:27:12Z version restart-20261011192712
2026-10-11T19:27:13Z GET http://10.8.0.11:8300/readyz 200 ready after 0.52
2026-10-11T19:27:13Z GET http://10.8.0.11:8001/healthz 200 {"status":"ok","implementation":"node","contract_version":"1.0.0"} after 0.51
initialize mcpramen-egg-node seconds 0.192 is_error False
2026-10-11T19:27:18Z GET http://10.8.0.11:8000/healthz 200 {"status":"ok","implementation":"python","contract_version":"1.0.0"} after 2.5
initialize MCP Ramen Egg seconds 0.493 is_error False
2026-10-11T19:27:28Z login 200
2026-10-11T19:27:28Z egg-node events 100 name_hits 6 version_hits 6
2026-10-11T19:27:28Z egg-python events 100 name_hits 6 version_hits 6
2026-10-11T19:27:28Z PASS restart
```

`analytics_facts` for `client_name=e2e-v2-restart` / `client_version=restart-20261011192712` on each egg: `session.started`, `mcp.initialize`, `tool.called search_products` (`is_error` false), `tools.listed`, `mcp.request`, `session.ended`. Initialize was under 60 seconds on both eggs.

### 5. Reachability

`bash reports/e2e-v2/reachability.sh`, log `reports/e2e-v2/reachability.txt`. Listeners are only `10.8.0.11:8300`, `:8001`, and `:8000`. VPN `healthz` is 200 on all three. LAN `192.168.22.23`, `0.0.0.0`, and `127.0.0.1` return HTTP 000 on all three. Postgres `10.8.0.11:5432`, `192.168.22.23:5432`, and `127.0.0.1:5432` return 000. Inspect: `signals-postgres-1` `ports={}`. Published bindings are `10.8.0.11` only, restart policy `unless-stopped`. One `docker port` echo in that file collapsed the empty postgres line onto the egg-node line; the inspect section is the binding evidence.

### 6. Remote CI at the deployed commits

`gh run list --commit <full sha>` for the five deployed sources, plus the spec. Log `reports/e2e-v2/ci-deployed.txt`. A short SHA `932b99e` returns an empty list; the full SHA does not. All of these are `completed` / `success`:

| Repo | Commit | Run |
| --- | --- | --- |
| callmeahab/signals | `932b99ea22fa0eb7a1ffdaa11702b2440e18f51e` | 38164143874 Signals checks |
| vuk88/signals-node | `e983faa7d3faae19ae487ab970ce6ad46b31a722` | 38163981223 CI |
| vuk88/signals-python | `0c94d6653888be7bc1cbf6e50de7e2afbf361565` | 38154878917 CI |
| vuk88/mcpramen-egg-node | `d5a9387ee552603ba6298050fcd2cd48e106ab6b` | 38165357619 test |
| vuk88/mcpramen-egg-python | `dc9c24c6fa504a56d7cef2fc062875b80093b01f` | 38160490428 test |
| vuk88/signals-spec | `a32f922beb302853863b39aa27edf2286f5881a7` | 38134876050 and 38134874794 ci |

Worktree commits `09c1e78` and `b7909a2` are report commits made after the image build. They are not the running collector, and they have no Actions runs. `reports/e2e-v2/ci.txt` is an earlier over-redacted copy; `ci-deployed.txt` is the evidence.

## What changed

Added `reports/e2e-v2.md` and the probes, logs, analytics JSON, and screenshots under `reports/e2e-v2/`. No other files.

## Unfinished

Nothing. The review is complete.

## Probes committed

`reports/e2e-v2/tools_probe.py`, `long_session.py`, `restart.py`, `compare.py`, `browser.mjs`, `restore-settings.mjs`, `reachability.sh`, and the `.txt` / `.json` / `.png` evidence those commands wrote. `compare.py` was not executed; the browser pass saved the analytics JSON that a comparison would have fetched. `__pycache__` is gitignored.
