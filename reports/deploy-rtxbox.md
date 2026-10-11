# rtxbox deployment report

Collector and both eggs deployed on 2026-10-11 UTC. Collector source: c4c5f81;
Node egg main: 2ff72ab; Python egg main: cba23f2.

## Files and runtime changes

- `deploy/compose/compose.yaml`: parameterized loopback/VPN publish, local collector
  image, Postgres 18.6, private database network, named volume, init and restart policies.
- `deploy/compose/README.md`: operational commands, environment and healthcheck notes.
- `deploy/compose/verify-rtxbox.py`: reproducible real MCP, whoami, database and dashboard
  read API acceptance checks. Reads secrets into memory without printing them.
- `deploy/compose/screenshot-rtxbox.mjs`: real browser login and screenshot capture.
- `reports/deploy-rtxbox-egg-{node,python}.png`: deployed dashboard evidence.
- `/home/vuk/signals-deploy/.env`: generated using `scripts/init-env.sh` with its cwd
  redirected outside the repo; mode 0600; random 24-character bootstrap password,
  random admin/session secrets and database password; public URL and CORS match VPN URL.
- `/home/vuk/mcpramen-egg-{node,python}/.env`: added only SIGNALS_URL, SIGNALS_KEY and
  SIGNALS_SERVICE_NAME; mode 0600. No egg source or Compose files changed.
- `/home/vuk/signals-deploy/credentials.md`: mode 0600, bootstrap email/password and
  both ingest keys. **Coordinator explicitly directed credentials here instead of
  the committed report. No credential values are included in this report.**

## Build and provisioning commands/results

```sh
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml up -d --build
# Finished release profile [optimized] target(s) in 1m 22s
# signals Built; signals-postgres-1 Healthy; signals-signals-1 Started
(cd /home/vuk/mcpramen-egg-node && docker compose -p egg-node up -d --build)
# app Built; egg-node-app-1 Recreated; egg-node-app-1 Started
(cd /home/vuk/mcpramen-egg-python && docker compose -p egg-python up -d --build)
# app Built; egg-python-app-1 Recreated; egg-python-app-1 Started
```

Provisioning used Python urllib with admin Bearer token read from the external
.env, never placed in command arguments. Exact HTTP operations and safe results:

```text
POST /v1/admin/tenants {"slug":"mcpramen","name":"mcpramen"}
=> 200 id=5eb89b86-9b54-4927-8789-44095b2fd9d1
POST /v1/admin/projects {"tenant_id":"5eb89b86-9b54-4927-8789-44095b2fd9d1","slug":"egg-node","name":"egg-node"}
=> 200 id=e34d7589-4578-4549-83fd-a061dc41e65b
POST /v1/admin/projects {"tenant_id":"5eb89b86-9b54-4927-8789-44095b2fd9d1","slug":"egg-python","name":"egg-python"}
=> 200 id=d1fe4dc3-415d-436b-aca5-a4409b6831cd
POST /v1/admin/keys {"project_id":<respective UUID>,"label":<egg name>,"scopes":["ingest"]}
=> 200 for each; secret saved directly to the corresponding egg .env and private credentials file
POST /v1/auth/login {email/password from external .env}
=> 200 vuk@rtxbox.local
PATCH /v1/projects/<respective UUID> (authenticated owner session, matching Origin)
{"name":<egg name>,"retention_days":30,"rate_events_per_min":5000,"rate_bytes_per_min":33554432}
=> 200 for both projects with the requested limits
```

The collector initially creates the bootstrap owner in `default`. To give that
same user dashboard access to the requested `mcpramen` tenant, ran:

```sh
docker exec -i signals-postgres-1 psql -U signals -d signals -v ON_ERROR_STOP=1 <<'SQL'
UPDATE users SET tenant_id='5eb89b86-9b54-4927-8789-44095b2fd9d1'
WHERE email='vuk@rtxbox.local' RETURNING email,tenant_id,role;
SQL
```

```text
vuk@rtxbox.local | 5eb89b86-9b54-4927-8789-44095b2fd9d1 | owner
UPDATE 1
```

## Initial acceptance

```sh
python3 deploy/compose/verify-rtxbox.py
```

```text
GET /healthz 200 ok
GET /readyz 200 ready
egg-node GET /v1/whoami 200 {"label":"egg-node","project":"e34d7589-4578-4549-83fd-a061dc41e65b","scopes":["ingest"]}
egg-python GET /v1/whoami 200 {"label":"egg-python","project":"d1fe4dc3-415d-436b-aca5-a4409b6831cd","scopes":["ingest"]}
Both container-to-VPN GET /healthz: 200 ok
Both real MCP client initialize calls succeeded.
Both search_products({"query":"Mug"}) returned ok=true, total=1, is_error=false.
Database tool.called: egg-node/source.sdk=node count=1; egg-python/source.sdk=python count=2.
POST /v1/auth/login 200 vuk@rtxbox.local
Node dashboard GET events 200 events=5 tool.called=1 sdk=node
Python dashboard GET events 200 events=10 tool.called=2 sdk=python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
```

Auth profile is persisted in each egg database (no auth-profile override was
present in either .env); both are `none`. Inspected Python settings.auth_profile
and Node objects(settings/auth).config.profile without changing either.
The first exploratory Node SQLite query assumed a settings table and failed;
using the actual objects table resolved that inspection error.

## Restart acceptance

```sh
docker restart signals-signals-1
```

```text
signals-signals-1
GET /readyz 200 within 0.61s from restart command start
```

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
MCP client source:
import asyncio
from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
async def run():
 for name, port in [('egg-node',8001),('egg-python',8000)]:
  async with streamable_http_client(f'http://10.8.0.11:{port}/mcp') as streams:
   async with ClientSession(streams[0],streams[1]) as client:
    init=await client.initialize()
    print(name,'initialize',init.server_info.model_dump())
    result=await client.call_tool('search_products',{'query':'Mug'})
    print(name,'search_products',result.structured_content)
    assert not result.is_error
    assert result.structured_content['data']['total'] == 1
asyncio.run(run())

$ docker exec -i egg-python-app-1 python -
egg-node initialize {'name': 'mcpramen-egg-node', 'title': None, 'version': '1.0.0', 'description': None, 'website_url': None, 'icons': None}
egg-node search_products {'ok': True, 'data': {'items': [{'id': 'prd_mug', 'name': 'Ramen Mug', 'category': 'home', 'description': 'Ceramic ramen mug', 'price': {'amount': 1800, 'currency': 'USD'}, 'stock': 17}], 'total': 1, 'limit': 20, 'offset': 0}, 'error': None, 'meta': {'request_id': 'req_bff8beab533e4397a245ccb2', 'auth_epoch': 27, 'replayed': False}}
egg-python initialize {'name': 'MCP Ramen Egg', 'title': None, 'version': '4.0.10', 'description': None, 'website_url': None, 'icons': None}
egg-python search_products {'ok': True, 'data': {'items': [{'id': 'prd_mug', 'name': 'Ramen Mug', 'category': 'home', 'description': 'Ceramic ramen mug', 'price': {'amount': 1800, 'currency': 'USD'}, 'stock': 17}], 'total': 1, 'limit': 20, 'offset': 0}, 'error': None, 'meta': {'request_id': 'req_34b50c680ae86bb569613772', 'auth_epoch': 3, 'replayed': False}}
$ docker exec signals-postgres-1 psql -U signals -d signals -c 'SELECT p.slug,e.type,e.source->>'"'"'sdk'"'"' AS sdk,count(*) FROM events e JOIN projects p ON p.id=e.project_id GROUP BY 1,2,3 ORDER BY 1,2;'
slug    |      type       |  sdk   | count 
------------+-----------------+--------+-------
 egg-node   | mcp.initialize  | node   |     2
 egg-node   | mcp.request     | node   |     2
 egg-node   | session.ended   | node   |     2
 egg-node   | session.started | node   |     2
 egg-node   | tool.called     | node   |     2
 egg-python | mcp.initialize  | python |     3
 egg-python | mcp.request     | python |     3
 egg-python | session.ended   | python |     3
 egg-python | session.started | python |     3
 egg-python | tool.called     | python |     3
(10 rows)
POST /v1/auth/login 200 vuk@rtxbox.local
GET /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b/events 200 events= 10 tool.called= 2 sdk= node
GET /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd/events 200 events= 15 tool.called= 3 sdk= python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
```

```sh
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml restart
```

```text
 Container signals-postgres-1  Restarting
 Container signals-signals-1  Restarting
 Container signals-signals-1  Started
 Container signals-postgres-1  Started
GET /readyz 200 within 0.85s from restart command start
```

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
MCP client source:
import asyncio
from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
async def run():
 for name, port in [('egg-node',8001),('egg-python',8000)]:
  async with streamable_http_client(f'http://10.8.0.11:{port}/mcp') as streams:
   async with ClientSession(streams[0],streams[1]) as client:
    init=await client.initialize()
    print(name,'initialize',init.server_info.model_dump())
    result=await client.call_tool('search_products',{'query':'Mug'})
    print(name,'search_products',result.structured_content)
    assert not result.is_error
    assert result.structured_content['data']['total'] == 1
asyncio.run(run())

$ docker exec -i egg-python-app-1 python -
egg-node initialize {'name': 'mcpramen-egg-node', 'title': None, 'version': '1.0.0', 'description': None, 'website_url': None, 'icons': None}
egg-node search_products {'ok': True, 'data': {'items': [{'id': 'prd_mug', 'name': 'Ramen Mug', 'category': 'home', 'description': 'Ceramic ramen mug', 'price': {'amount': 1800, 'currency': 'USD'}, 'stock': 17}], 'total': 1, 'limit': 20, 'offset': 0}, 'error': None, 'meta': {'request_id': 'req_fdae69480eb59871f3d04daf', 'auth_epoch': 27, 'replayed': False}}
egg-python initialize {'name': 'MCP Ramen Egg', 'title': None, 'version': '4.0.10', 'description': None, 'website_url': None, 'icons': None}
egg-python search_products {'ok': True, 'data': {'items': [{'id': 'prd_mug', 'name': 'Ramen Mug', 'category': 'home', 'description': 'Ceramic ramen mug', 'price': {'amount': 1800, 'currency': 'USD'}, 'stock': 17}], 'total': 1, 'limit': 20, 'offset': 0}, 'error': None, 'meta': {'request_id': 'req_883bdc72234fec9ee0bf4679', 'auth_epoch': 3, 'replayed': False}}
$ docker exec signals-postgres-1 psql -U signals -d signals -c 'SELECT p.slug,e.type,e.source->>'"'"'sdk'"'"' AS sdk,count(*) FROM events e JOIN projects p ON p.id=e.project_id GROUP BY 1,2,3 ORDER BY 1,2;'
slug    |      type       |  sdk   | count 
------------+-----------------+--------+-------
 egg-node   | mcp.initialize  | node   |     3
 egg-node   | mcp.request     | node   |     3
 egg-node   | session.ended   | node   |     3
 egg-node   | session.started | node   |     3
 egg-node   | tool.called     | node   |     3
 egg-python | mcp.initialize  | python |     4
 egg-python | mcp.request     | python |     4
 egg-python | session.ended   | python |     4
 egg-python | session.started | python |     4
 egg-python | tool.called     | python |     4
(10 rows)
POST /v1/auth/login 200 vuk@rtxbox.local
GET /v1/projects/e34d7589-4578-4549-83fd-a061dc41e65b/events 200 events= 15 tool.called= 3 sdk= node
GET /v1/projects/d1fe4dc3-415d-436b-aca5-a4409b6831cd/events 200 events= 20 tool.called= 4 sdk= python
PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.
```

## Final runtime verification

```sh
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml config --quiet
```

```text
(no output; exit 0)
```

```sh
curl --fail -sS -w '
HTTP %{http_code}
' http://10.8.0.11:8300/readyz
```

```text
ready
HTTP 200
```

```sh
systemctl is-enabled docker
```

```text
enabled
```

```sh
ip -4 addr show tun0
```

```text
4: tun0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    inet 10.8.0.11/24 brd 10.8.0.255 scope global tun0
       valid_lft forever preferred_lft forever
```

```sh
stat -c '%a %n' /home/vuk/signals-deploy/.env /home/vuk/signals-deploy/credentials.md /home/vuk/mcpramen-egg-node/.env /home/vuk/mcpramen-egg-python/.env
```

```text
600 /home/vuk/signals-deploy/.env
600 /home/vuk/signals-deploy/credentials.md
600 /home/vuk/mcpramen-egg-node/.env
600 /home/vuk/mcpramen-egg-python/.env
```

```sh
docker ps --format '{{.Names}} {{.Status}}'
```

```text
egg-node-app-1 Up 3 minutes (healthy)
egg-python-app-1 Up 3 minutes (healthy)
signals-signals-1 Up About a minute
signals-postgres-1 Up About a minute (healthy)
egg-node-issuer-1 Up 7 days (healthy)
egg-python-bootstrap-app-1 Up 7 days (healthy)
egg-node-proxy-1 Up 7 days
egg-python-proxy-1 Up 7 days
mcpramen-e2e-t9-api-1 Up 10 days
mcpramen-e2e-t9-postgres-1 Up 11 days (healthy)
mcpramen-e2e-t9-caddy-1 Up 11 days
mcpramen-e2e-t9-redis-1 Up 11 days (healthy)
unpackerr Up 13 days
jellyseerr Up 13 days
flaresolverr Up 13 days
jellyfin Up 13 days
qbittorrent Up 13 days
prowlarr Up 13 days
radarr Up 13 days
bazarr Up 13 days
sonarr Up 13 days
```

```sh
docker inspect signals-signals-1 signals-postgres-1 egg-node-app-1 egg-python-app-1 egg-node-issuer-1 egg-node-proxy-1 egg-python-bootstrap-app-1 egg-python-proxy-1 --format '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} ports={{json .HostConfig.PortBindings}}'
```

```text
/signals-signals-1 restart=unless-stopped ports={"8300/tcp":[{"HostIp":"10.8.0.11","HostPort":"8300"}]}
/signals-postgres-1 restart=unless-stopped ports={}
/egg-node-app-1 restart=unless-stopped ports={"8001/tcp":[{"HostIp":"10.8.0.11","HostPort":"8001"}]}
/egg-python-app-1 restart=unless-stopped ports={"8000/tcp":[{"HostIp":"10.8.0.11","HostPort":"8000"}]}
/egg-node-issuer-1 restart=unless-stopped ports={"8002/tcp":[{"HostIp":"127.0.0.1","HostPort":"8002"}]}
/egg-node-proxy-1 restart=unless-stopped ports={"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8444"}]}
/egg-python-bootstrap-app-1 restart=unless-stopped ports={"8000/tcp":[{"HostIp":"127.0.0.1","HostPort":"18082"}]}
/egg-python-proxy-1 restart=unless-stopped ports={"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8443"}]}
```

```sh
docker exec signals-postgres-1 psql -U signals -d signals -c 'SELECT slug,rate_events_per_min,rate_bytes_per_min FROM projects WHERE slug IN ('"'"'egg-node'"'"','"'"'egg-python'"'"') ORDER BY slug;'
```

```text
    slug    | rate_events_per_min | rate_bytes_per_min 
------------+---------------------+--------------------
 egg-node   |                5000 |           33554432
 egg-python |                5000 |           33554432
(2 rows)

```

```sh
docker inspect signals-postgres-1 --format '{{json .Mounts}}'
```

```text
[{"Type":"volume","Name":"signals_pgdata18","Source":"/var/lib/docker/volumes/signals_pgdata18/_data","Destination":"/var/lib/postgresql","Driver":"local","Mode":"rw","RW":true,"Propagation":""}]
```

```sh
git -C /home/vuk/mcpramen-egg-node log -1 --oneline
```

```text
2ff72ab Record final SDK re-vendor verification
```

```sh
git -C /home/vuk/mcpramen-egg-python log -1 --oneline
```

```text
cba23f2 Record Signals integration review round 1
```

```sh
git -C /home/vuk/mcpramen-egg-node status --porcelain
```

```text
(no output; exit 0)
```

```sh
git -C /home/vuk/mcpramen-egg-python status --porcelain
```

```text
(no output; exit 0)
```

## Dashboard browser evidence

```sh
node deploy/compose/screenshot-rtxbox.mjs /home/vuk/orca/workspaces/signals-collector/collector-dashboard/web/node_modules/.bun/playwright@1.63.0/node_modules/playwright/index.mjs
```

```text
egg-node dashboard tool.called search_products visible; screenshot saved
egg-python dashboard tool.called search_products visible; screenshot saved
```

Playwright used the real login form and bootstrap credentials read directly from
the external environment file. Selected each project, opened Live, filtered to
`tool.called`, and expanded a `search_products` payload. Screenshots:

- [Node egg](deploy-rtxbox-egg-node.png)
- [Python egg](deploy-rtxbox-egg-python.png)

Two exploratory browser selectors timed out (a hidden project option and treating
the Live link as a button); corrected selectors succeeded as recorded above.

## Divergences and operational notes

- No collector Docker healthcheck: the distroless image has no HTTP client or shell.
  Postgres pg_isready gates startup; all external health/readiness checks passed.
- No host route workaround was necessary. Both containers reached 10.8.0.11 directly.
- The all-interface listen address exists only inside the collector container;
  Docker publishes exclusively 10.8.0.11:8300. Postgres is not published anywhere.
- The existing Node issuer and both proxies had restart=no, contrary to a broad
  reading of the brief's reboot-safety assumption. Applied the following runtime
  fix without editing egg source/Compose files or recreating auxiliary services:

```sh
docker update --restart unless-stopped egg-node-issuer-1 egg-node-proxy-1 egg-python-proxy-1
```

```text
egg-node-issuer-1
egg-node-proxy-1
egg-python-proxy-1
```

  Their future recreation from upstream Compose definitions will reset these
  auxiliary policies unless the update is repeated or upstream adds the policies.
  Main apps and both Signals services declare unless-stopped in Compose.
- Docker is enabled at boot; container/Compose restarts were tested, not a host
  reboot. The VPN interface must be available when Docker restores published ports.
- Existing unrelated services were untouched, including their pre-existing public
  bindings. No new host all-interface bindings were introduced.
- No publishing, pushing, or tagging was performed. Both egg tracked working trees
  remain clean. Deployment services intentionally remain running as requested.
- No requested acceptance check remains unfinished.
