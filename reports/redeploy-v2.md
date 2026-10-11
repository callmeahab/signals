# v2 redeployment on rtxbox — 2026-10-11

Deployed collector checkout 932b99e and rebuilt egg-node d5a9387 and egg-python dc9c24c. The existing signals_pgdata18 volume is retained and Postgres shared memory is 1 GiB. Dashboard login works and both historical projects remain visible. All runtime checks passed; the display distinction below is recorded without changing source code.

## Changes

- Runtime: rebuilt `signals`, `egg-node`, and `egg-python`; restarted all eight containers in those projects, preserving published ports and environment files.
- Project settings: explicit SLO classes for all catalogue/observed tools, read target 99.5%, mutate target 98.0%, divisor 4; alerts enabled with volume=3, latency=2, errors=5, destructive enabled, burn=6. Catalogue `read_only_hint` determines classes; `get_delivery_quote` is mutate as advertised. Unadvertised tool names use mutate.
- Weekly digest remains **disabled** for both projects because no webhook receiver was supplied.
- Repository: this report and `reports/redeploy-v2/` evidence only. `browser.mjs` captures/asserts the live UI; `mcp.py` exercises real MCP sessions; `settings.py` patches and checks settings; `restart.py` restarts and verifies readiness. Logs, analytics JSON, and twelve PNG screenshots capture the results. No application source changed.

## Verification commands and results

```sh
git log -1 --oneline
git -C /home/vuk/mcpramen-egg-node log -1 --oneline
git -C /home/vuk/mcpramen-egg-python log -1 --oneline
```
```text
932b99e Record passing merged v1.1 harness and resource cleanup
d5a9387 Record re-vendor commit verification
dc9c24c Record Signals re-vendor commit verification
```

```sh
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml up -d --build
```
```text
Finished release profile [optimized] target(s) in 1m 29s
signals Built
Container signals-postgres-1 Healthy
Container signals-signals-1 Started
```

```sh
docker inspect signals-postgres-1 --format 'shm_size={{.HostConfig.ShmSize}} volume={{range .Mounts}}{{.Name}}{{end}}'
```
```text
shm_size=1073741824 volume=signals_pgdata18
```

```sh
curl -s -w '\nHTTP %{http_code}\n' http://10.8.0.11:8300/readyz
```
```text
ready
HTTP 200
```

```sh
(cd web && /home/vuk/.bun/bin/bun install --frozen-lockfile)
node --check reports/redeploy-v2/browser.mjs
node reports/redeploy-v2/browser.mjs --initial
```
```text
167 packages installed
JavaScript syntax check exited 0
PASS dashboard login; both historical projects present
PASS live dashboard pages; no browser exceptions
```

```sh
(cd /home/vuk/mcpramen-egg-node && docker compose -p egg-node up -d --build)
```
```text
#26 [app] resolving provenance for metadata file
#26 DONE 0.0s
 app  Built
 Container egg-node-app-1  Recreate
 Container egg-node-app-1  Recreated
 Container egg-node-app-1  Starting
 Container egg-node-app-1  Started
```

```sh
(cd /home/vuk/mcpramen-egg-python && docker compose -p egg-python up -d --build)
```
```text
#25 [app] resolving provenance for metadata file
#25 DONE 0.0s
 app  Built
 Container egg-python-app-1  Recreate
 Container egg-python-app-1  Recreated
 Container egg-python-app-1  Starting
 Container egg-python-app-1  Started
```

```sh
python3 deploy/compose/verify-rtxbox.py
```
```text
POST /v1/auth/login 200 vuk@rtxbox.local
GET /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b/events 200 events= 100 tool.called= 68 sdk= node
GET /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd/events 200 events= 100 tool.called= 72 sdk= python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
```

```sh
docker exec -i egg-python-app-1 python - < reports/redeploy-v2/mcp.py
```
```text
egg-node initialize {'name': 'mcpramen-egg-node', 'title': None, 'version': '1.0.0', 'description': None, 'website_url': None, 'icons': None} advertised 15
egg-node search_products Mug is_error False
egg-node search_products Shirt is_error False
egg-node search_products Sticker is_error False
egg-node unknown-tool MCPError Unknown tool
egg-python initialize {'name': 'MCP Ramen Egg', 'title': None, 'version': '4.0.10', 'description': None, 'website_url': None, 'icons': None} advertised 15
egg-python search_products Mug is_error False
egg-python search_products Shirt is_error False
egg-python search_products Sticker is_error False
egg-python unknown-tool is_error True
```

```sh
python3 reports/redeploy-v2/settings.py
```
```text
PATCH /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b egg-node 200 {"slo_classes": {"book_ticket": "mutate", "create_order": "mutate", "echo": "mutate", "get_delivery_quote": "mutate", "get_menu": "read", "get_product": "read", "get_room_options": "read", "get_seat_map": "read", "get_ticket_options": "read", "place_food_order": "mutate", "redeploy_v2_unknown_tool": "mutate", "reserve_room": "mutate", "reserve_tickets": "mutate", "search_events": "read", "search_flights": "read", "search_hotels": "read", "search_products": "read"}, "slo_targets": {"read": 99.5, "mutate": 98.0}, "token_divisor": 4, "digest": {"enabled": false}, "alerts": [{"id": "volume", "enabled": true, "threshold": 3}, {"id": "latency", "enabled": true, "threshold": 2}, {"id": "errors", "enabled": true, "threshold": 5}, {"id": "destructive", "enabled": true}, {"id": "burn", "enabled": true, "threshold": 6}]}
PATCH /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd egg-python 200 {"slo_classes": {"book_ticket": "mutate", "create_order": "mutate", "echo": "mutate", "get_delivery_quote": "mutate", "get_menu": "read", "get_product": "read", "get_room_options": "read", "get_seat_map": "read", "get_ticket_options": "read", "place_food_order": "mutate", "redeploy_v2_unknown_tool": "mutate", "reserve_room": "mutate", "reserve_tickets": "mutate", "search_events": "read", "search_flights": "read", "search_hotels": "read", "search_products": "read"}, "slo_targets": {"read": 99.5, "mutate": 98.0}, "token_divisor": 4, "digest": {"enabled": false}, "alerts": [{"id": "volume", "enabled": true, "threshold": 3}, {"id": "latency", "enabled": true, "threshold": 2}, {"id": "errors", "enabled": true, "threshold": 5}, {"id": "destructive", "enabled": true}, {"id": "burn", "enabled": true, "threshold": 6}]}
PASS settings persisted; digest disabled because no receiver supplied
```

```sh
node reports/redeploy-v2/browser.mjs
```
```text
PASS dashboard login; both historical projects present
PASS live dashboard pages; no browser exceptions
```

The final browser run asserted 15 advertised tools, a dead-list array, the unknown tool visible in Reliability, positive cost tokens, and two network identities per project. It captured Overview, Tools, Reliability, Cost, and Adoption for each project, plus initial historical Overview screenshots. Full responses are in the project JSON and dashboard.log.

- egg-node: historical tool calls 77; final tool calls 83; estimated tokens 8195; identities {'key': 0, 'network': 2, 'strong': 0}; catalogue advertised 15, dead [].
- egg-python: historical tool calls 76; final tool calls 82; estimated tokens 8828; identities {'key': 0, 'network': 2, 'strong': 0}; catalogue advertised 15, dead [].

```sh
python3 reports/redeploy-v2/restart.py
```
```text
$ docker restart signals-signals-1
signals-signals-1
GET /readyz 200 after 0.9 seconds
$ docker restart signals-postgres-1
signals-postgres-1
GET /readyz 200 after 0.47 seconds
$ docker restart egg-node-app-1
egg-node-app-1
GET /readyz 200 after 0.29 seconds
$ docker restart egg-python-app-1
egg-python-app-1
GET /readyz 200 after 0.66 seconds
$ docker restart egg-node-issuer-1
egg-node-issuer-1
GET /readyz 200 after 10.36 seconds
$ docker restart egg-node-proxy-1
egg-node-proxy-1
GET /readyz 200 after 0.41 seconds
$ docker restart egg-python-bootstrap-app-1
egg-python-bootstrap-app-1
GET /readyz 200 after 2.49 seconds
$ docker restart egg-python-proxy-1
egg-python-proxy-1
GET /readyz 200 after 0.34 seconds
/signals-signals-1 restart=unless-stopped ports={"8300/tcp":[{"HostIp":"10.8.0.11","HostPort":"8300"}]}
/signals-postgres-1 restart=unless-stopped ports={}
/egg-node-app-1 restart=unless-stopped ports={"8001/tcp":[{"HostIp":"10.8.0.11","HostPort":"8001"}]}
/egg-python-app-1 restart=unless-stopped ports={"8000/tcp":[{"HostIp":"10.8.0.11","HostPort":"8000"}]}
/egg-node-issuer-1 restart=unless-stopped ports={"8002/tcp":[{"HostIp":"127.0.0.1","HostPort":"8002"}]}
/egg-node-proxy-1 restart=unless-stopped ports={"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8444"}]}
/egg-python-bootstrap-app-1 restart=unless-stopped ports={"8000/tcp":[{"HostIp":"127.0.0.1","HostPort":"18082"}]}
/egg-python-proxy-1 restart=unless-stopped ports={"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8443"}]}
$ docker inspect <eight task containers> --format restart/ports
```

```sh
python3 deploy/compose/verify-rtxbox.py  # after all restarts
```
```text
POST /v1/auth/login 200 vuk@rtxbox.local
GET /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b/events 200 events= 100 tool.called= 61 sdk= node
GET /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd/events 200 events= 100 tool.called= 66 sdk= python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
```

```sh
docker exec signals-postgres-1 psql -U signals -d signals -c "SELECT p.slug,e.source->>'sdk' AS sdk,e.source->>'sdk_version' AS version,count(*) FROM events e JOIN projects p ON p.id=e.project_id WHERE e.ts > '2026-10-11 18:51:50+00' AND e.type='tool.called' GROUP BY 1,2,3 ORDER BY 1"
```
```text
slug    |  sdk   | version | count 
------------+--------+---------+-------
 egg-node   | node   | 0.2.0   |     1
 egg-python | python | 0.2.0   |     1
(2 rows)
```

```sh
docker exec signals-postgres-1 psql -U signals -d signals -c "SELECT p.slug,e.type,e.source->>'sdk_version' AS sdk_version,e.attrs FROM events e JOIN projects p ON p.id=e.project_id WHERE e.attrs->>'tool'='redeploy_v2_unknown_tool' ORDER BY e.ts"
```
```text
slug    |    type     | sdk_version |                                                                                                                                                       attrs                                                                                                                                                       
------------+-------------+-------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 egg-node   | tool.called | 0.2.0       | {"tool": "redeploy_v2_unknown_tool", "is_error": true, "cancelled": false, "error_code": -32602, "error_kind": "unknown_tool", "request_id": "6", "duration_ms": 0, "input_bytes": 2, "output_bytes": 40, "output_chars": 0, "output_items": 0, "output_kinds": [], "error_message": "Unknown tool"}
 egg-python | tool.called | 0.2.0       | {"tool": "redeploy_v2_unknown_tool", "is_error": true, "cancelled": false, "error_kind": "unknown_tool", "request_id": "6", "duration_ms": 1, "input_bytes": 2, "output_bytes": 67, "output_chars": 40, "output_items": 1, "output_kinds": ["text"], "error_message": "Unknown tool: 'redeploy_v2_unknown_tool'"}
(2 rows)
```

## Differences and remaining work

No receiver was supplied, so digest delivery was intentionally not enabled or exercised. No host reboot was attempted; container restart safety was tested.

Both SDKs emit `error_kind: unknown_tool`. Node rejects with MCP protocol code -32602 and Reliability displays `-32602 · unknown_tool`; Python returns an `is_error` tool result without a numeric code, so Reliability displays the tool name under Hallucinated tools while its Error codes panel remains empty. Thus the literal `unknown_tool` label is not displayed in Python's Error codes panel, though the classified event is persisted and counted by Reliability. This existing presentation difference was not changed under the read-only source scope.

The dead lists are empty because historical traffic already exercised every advertised tool. Tools reports 17 used names versus 15 advertised because it includes the historical `echo` unknown call and this run's `redeploy_v2_unknown_tool`; no catalogue data was fabricated to produce dead entries. Adoption's two identities are network identities, not authenticated subjects.

All eight task containers publish only VPN/loopback addresses or no ports, and have `unless-stopped`. Container-internal listeners use their existing wildcard addresses; no new wildcard host bindings were introduced. No credentials are included in the artifacts.

## Artifact verification and commit

```text
Configured-secret scan: PASS, no configured secret values in report/non-image artifacts
PNG screenshots: 12
git diff --check: exited 0
git commit -m 'Record v2 redeployment and live dashboard verification': b7909a2
git status --porcelain: empty after initial evidence commit
```

Verification logs are explicitly tracked despite the repository's global log ignore rule.
