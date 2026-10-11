# Collector dashboard: Signals spec v1.0.15

## Result

Implemented the dashboard/examples migration within `web/` and `examples/`.
Check, build, demo browser QA, packed Next host QA and static example smoke passed.
Live collector QA was deliberately not run: the task brief says this worktree's Rust
backend still implements the old ingest contract. The updated backend QA is syntax
checked and reviewed against the spec, but awaits the ingest worker's changes.

## Changes by file

- `web/packages/ui/src/types.ts`: ten spec event names; typed nested attrs, client
  metadata and batch source; sessions also expose nested client information.
- `web/packages/ui/src/dashboard.tsx`: read nested attrs/client fields, display log
  messages/resource URIs/prompt names/request methods, add errors and log views
  inside the existing Live screen, and provide all ten event type filters.
  Setup now shows real Python/Node SDK integration, base `SIGNALS_URL`,
  `SIGNALS_KEY`, and a complete custom-event HTTP batch with a generated UUIDv7.
- `web/apps/dashboard/src/demo.ts` and `examples/next-host/app/fixture.ts`:
  all ten event types with required attrs, UUIDv7 IDs, client/source metadata,
  error/tool/search filtering, and nested session clients.
- `web/packages/ui/package.json`: repository set to
  `https://github.com/callmeahab/signals`; package name unchanged.
- `examples/node/server.mjs`: real MCP/Signals SDKs, Express caller middleware,
  instrumentation before stateless transport connection, finite-number add tool,
  and shutdown flush.
- `examples/python/server.py`: real MCPServer/Signals SDKs, ASGI caller wrapper,
  finite-number add tool and exit flush.
- `examples/README.md`: local checkout installation instructions, environment,
  HTTP endpoints and explicit smoke-test scope.
- `examples/smoke.py`: dependency-free Python/Node syntax and static SDK integration
  checks. The former handwritten stdio protocol is no longer the examples' API.
- `web/scripts/backend-qa.mjs`: spec envelopes/source, UUIDv7 IDs, nested attrs and
  client metadata; replay acceptance now expects all replayed events to count as
  accepted, as required by `ingest.openapi.yaml`.
- `web/scripts/spec-qa.mjs`: fixtures cover all ten types and required attrs,
  UUIDv7 IDs, client/source metadata and working error/tool/search filters.
- `web/scripts/test.mjs`: run fixture QA before browser QA; test port 23330.
- `web/scripts/visual-qa.mjs`: verify SDK snippets, raw batch shape/UUIDv7,
  logs/errors/resources, and capture all three Setup tabs in both themes/sizes.
- `web/scripts/next-host-qa.mjs`: verify SDK setup in the packaged host.
- `web/scripts/test-next-host.mjs`: configurable port, default 23331, propagated
  to its browser check.
- `web/artifacts/setup-python-1440-light.png`,
  `web/artifacts/setup-node-1440-light.png`,
  `web/artifacts/setup-curl-1440-light.png`: committed Setup screenshots.
  Additional mobile/dark screenshots remain generated in `web/artifacts/`.

## Verification commands and output

Commands are from the worktree root unless noted. Bun is 1.4.2.

### Dependencies and recovery

Initial accidental invocation at the root:

```text
$ ~/.bun/bin/bun install --frozen-lockfile
error: Bun could not find a package.json file to install from
```

Correct invocation in `web/` initially failed because the host root filesystem
was full. This was escalated to the coordinator; no outside files were deleted.

```text
$ cd web && ~/.bun/bin/bun install --frozen-lockfile
error: ENOSPC extracting tarball ...
77 packages installed [972.00ms]
Failed to install 90 packages
$ df -h . /tmp
/dev/mapper/ubuntu--vg-ubuntu--lv   98G   93G     0 100% /
$ df -i .
/dev/mapper/ubuntu--vg-ubuntu--lv 6553600 2259338 4294262 35% /
```

After space recovered, regular install succeeded, but the earlier partial cached
native package still broke the build. Force reinstall alone did not repair it.

```text
$ cd web && ~/.bun/bin/bun install --frozen-lockfile
84 packages installed [38.00ms]
$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run build
ResolveMessage: [lightningcss minify] Cannot find module '../lightningcss.linux-x64-gnu.node'
error: script "build" exited with code 1
$ cd web && ~/.bun/bin/bun install --frozen-lockfile --force
167 packages installed [59.00ms]
$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run build
ResolveMessage: [lightningcss minify] Cannot find module '../lightningcss.linux-x64-gnu.node'
error: script "build" exited with code 1
```

Moved only this worktree's incomplete install aside and used a fresh local cache:

```text
$ mkdir -p web/artifacts
$ mv web/node_modules web/artifacts/incomplete-node_modules
$ cd web && ~/.bun/bin/bun install --frozen-lockfile --cache-dir artifacts/install-cache
167 packages installed [1382.00ms]
```

### Check, build, tests

```text
$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run check
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
(exit 0)

$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run build
dist/assets/index-DoKKUJNP.css  36.65 kB | gzip: 11.40 kB
dist/assets/index-iESOMJ4J.js  273.88 kB | gzip: 84.26 kB
✓ built in 2.42s
(exit 0)

$ ~/.bun/bin/bun web/scripts/spec-qa.mjs
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.

$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run test
error: launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
error: script "test" exited with code 1

$ cd web && PATH="$HOME/.bun/bin:$PATH" PLAYWRIGHT_CHANNEL=chromium bun run test
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
VITE v8.3.2 ready in 97 ms
Local: http://127.0.0.1:23330/
Visual QA passed: 7 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
(exit 0)

$ cd web && PATH="$HOME/.bun/bin:$PATH" PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR="$PWD/artifacts/install-cache" bun run test:next
✓ Compiled successfully in 1960ms
✓ Generating static pages using 4 workers (3/3) in 202ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
(exit 0)

$ node --check web/scripts/backend-qa.mjs
(no output; exit 0)

$ python3 examples/smoke.py
PASS Python syntax, SDK instrumentation, ASGI identity wrapper and shutdown hook (static)
PASS Node syntax, instrument-before-connect, Express identity middleware and shutdown hook (static)
Runtime HTTP/collector interoperability requires local SDK installs; see examples/README.md
(exit 0)
```

The browser test starts Vite with `VITE_DEMO=1`; screenshots were captured from
that demo run. The desktop Python screenshot was also opened and visually checked.

### Installed Python SDK check

Read `README.md` and `llms.txt` in both local SDK checkouts and
`events.schema.json` in the local spec checkout. Inspecting the installed
`MCPServer` signatures showed `stateless_http` is an app-factory option, not a
constructor option; the example was corrected to the brief's plain constructor.

```sh
PYTHONDONTWRITEBYTECODE=1 /home/vuk/orca/projects/signals-python/.venv/bin/python - <<'PY'
import inspect
from mcp.server.mcpserver import MCPServer
print('MCPServer:', inspect.signature(MCPServer))
print('streamable_http_app:', inspect.signature(MCPServer.streamable_http_app))
PY
```

Output included `streamable_http_app: (self, *, streamable_http_path: 'str' = '/mcp',
json_response: 'bool' = False, stateless_http: 'bool' = False, ...) -> 'Starlette'`.

```sh
PYTHONDONTWRITEBYTECODE=1 /home/vuk/orca/projects/signals-python/.venv/bin/python - <<'PY'
import runpy
example=runpy.run_path('examples/python/server.py')
assert example['add'](2,3)==5
assert callable(example['app'])
try:
 example['add'](float('inf'),3)
except ValueError:
 pass
else:
 raise AssertionError('nonfinite input accepted')
print('PASS Python example imports with installed MCP/Signals SDKs, creates ASGI app, and add validates finite results')
PY
```

```text
PASS Python example imports with installed MCP/Signals SDKs, creates ASGI app, and add validates finite results
```

### Installed Node SDK HTTP check

Used ignored dependency symlinks inside `examples/node/node_modules` pointing to
existing local SDK/dependency checkouts; no external checkout was modified.

```sh
python3 - <<'PY'
from pathlib import Path
import json, os, subprocess, time, urllib.request
modules=Path('examples/node/node_modules');modules.mkdir(exist_ok=True)
sdk=Path('/home/vuk/orca/projects/signals-node')
for name,target in [('express',sdk/'node_modules/express'),('zod',sdk/'node_modules/zod'),('@modelcontextprotocol/sdk',sdk/'node_modules/@modelcontextprotocol/sdk'),('@mcpramen/signals',sdk)]:
 link=modules/name;link.parent.mkdir(parents=True,exist_ok=True)
 if not link.exists():link.symlink_to(target,target_is_directory=True)
env={k:v for k,v in os.environ.items() if not k.startswith(('SIGNALS_','MCPRAMEN_SIGNALS_'))};env['PORT']='23019'
server=subprocess.Popen(['node','examples/node/server.mjs'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
try:
 for _ in range(100):
  if server.poll() is not None:raise RuntimeError(server.stderr.read())
  try:
   req=urllib.request.Request('http://127.0.0.1:23019/mcp',data=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'add','arguments':{'a':2,'b':3}}}).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'})
   with urllib.request.urlopen(req,timeout=5) as response:body=response.read().decode()
   break
  except ConnectionError:time.sleep(.1)
  except urllib.error.URLError as e:
   if isinstance(e,urllib.error.HTTPError):raise
   time.sleep(.1)
 else:raise RuntimeError('server not ready')
 result=json.loads(next(line[6:] for line in body.splitlines() if line.startswith('data: ')))
 assert result['result']['content'][0]['text']=='5',result
 print('PASS Node SDK example serves tools/call over stateless HTTP and returns 5')
finally:
 server.terminate()
 try:server.wait(timeout=10)
 except subprocess.TimeoutExpired:server.kill();server.wait()
 print('Node example server stopped')
PY
```

```text
PASS Node SDK example serves tools/call over stateless HTTP and returns 5
Node example server stopped
```

### Contract inspection and final hygiene

```text
$ grep -n -A4 -B3 'duplicate\|accepted' /home/vuk/orca/projects/signals-spec/ingest.openapi.yaml | head -75
53: already-stored events (same `ts` and `id`) count as accepted.
267: description: Number of events stored or recognised as replays.
$ git diff --check
(no output; exit 0)
```

```sh
python3 - <<'PY'
import pathlib, re, socket, subprocess
files=subprocess.check_output(['git','ls-files','web','examples'],text=True).splitlines()
pattern=re.compile(r'''(?:tool\.call|session\.start|session\.end)["']|SIGNALS_API_KEY|client_name''')
for name in files:
 p=pathlib.Path(name)
 if p.suffix=='.png':continue
 assert not pattern.search(p.read_text()),name
print('PASS obsolete event names and flat client/environment fields absent from web/ and examples/')
assert not subprocess.check_output(['git','diff','3a20aaf^','--','web/bun.lock','examples/next-host/bun.lock'])
print('PASS dependency lockfiles unchanged')
for port in [23019,23330,23331]:
 with socket.socket() as sock:
  assert sock.connect_ex(('127.0.0.1',port))!=0,port
print('PASS test servers stopped on ports 23019, 23330, 23331')
PY
```

```text
PASS obsolete event names and flat client/environment fields absent from web/ and examples/
PASS dependency lockfiles unchanged
PASS test servers stopped on ports 23019, 23330, 23331
```

## Remaining integration boundary

- No live ingest/SSE/rollup assertion is claimed: run `bun run qa:backend` after
  the backend migration lands, against a configured collector.
- `SignalEvent` now consumes `attrs` and `client`; the `Session` read model also
  expects `client.{name,version,protocol_version}`. This backend expectation was
  explicitly sent to the coordinator for the parallel Rust worker. There is no
  legacy flat-field compatibility adapter.
- Source is exposed in expandable event JSON. No new screens or source-filter
  API were invented.
- The Node check exercised MCP HTTP handling with telemetry disabled, and the
  Python check exercised SDK imports/app construction and the tool function.
  Neither proves delivery to the new collector. Default `examples/smoke.py`
  intentionally remains a portable static check, as permitted by the task.
- Chrome is absent on this host; all successful browser runs used the supported
  `PLAYWRIGHT_CHANNEL=chromium` override.
- Nothing was pushed or published; no dependency or lockfile changes were needed.

## Fix pass r1

Addressed review S1 with these changes:

- `web/packages/ui/src/types.ts`: `SignalEvent.caller` now declares the four
  stored-form keys, including `ip_hash?: string | null`; raw `ip` is not declared.
- `web/apps/dashboard/src/demo.ts` and `examples/next-host/app/fixture.ts`:
  network callers' events carry a deterministic 64-character `caller.ip_hash`
  matching the network row's label prefix, without a raw IP address.
- `web/packages/ui/src/dashboard.tsx`: the existing network caller details panel
  shows a Network hash row, read from the caller's loaded events when available.
  This uses the existing event response rather than adding a summary API field.
- `web/scripts/spec-qa.mjs`: checks both fixtures' network events have stored
  hashes and no raw IP field.
- `web/scripts/visual-qa.mjs`: opens the network caller and checks that its full
  hash is visible in the details panel, in the existing mobile/desktop and
  light/dark browser runs.

Verification commands and final output (all exited 0):

```text
$ node reports/review-r1/field-audit-probe.mjs
PASS field audit: every attrs/client/caller/source field read by web/ and examples/ is spec-defined
  attrs keys read:  duration_ms, error_message, is_error, level, message, method, name, prompt, tool, uri
  client keys read: name, protocol_version, version
  caller keys read: ip_hash
  source keys read: instance_id, sdk
EventType is exactly the spec enum (10 types).
SignalEvent.caller declares [key_id, subject, ip_hash, user_agent]; stored-form keys not declared: [none]

$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run check
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs

$ cd web && PATH="$HOME/.bun/bin:$PATH" bun run build
dist/assets/index-DoKKUJNP.css  36.65 kB | gzip: 11.40 kB
dist/assets/index-CKjSEsWH.js   274.09 kB | gzip: 84.31 kB
✓ built in 1.49s

$ cd web && PATH="$HOME/.bun/bin:$PATH" PLAYWRIGHT_CHANNEL=chromium bun run test
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
VITE v8.3.2 ready in 99 ms
Local: http://127.0.0.1:23330/
Visual QA passed: 7 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.

$ git diff --check
(no output)
```

No requested fix remains. The original live-backend verification boundary remains
unchanged. Demo events are stored read-model data: `caller.ip_hash` is not an
allowed wire-ingest caller key. Inspection of
`cat reports/review-r1/demo-fixture-probe.mjs` shows that the historical review
probe removes only `caller_id` and `source` before ingesting fixtures; it would
need to remove the stored-only hash too if reused. That review artifact was not
modified or rerun in this fix pass; the requested field audit and web suite above
verify the stored form instead.

## E2E fix pass

Merged local `main` first with `git merge main`: fast-forward from `eb53107` to
`1b9012e`, no conflicts and no manual conflict resolution. The brief's referenced
`reports/e2e-rtxbox.md` and capture script were absent at that revision
(`git ls-files 'reports/e2e*'` returned no output); the supplied brief and merged
read API source provided the reproduction requirements.

Changes:

- `web/packages/ui/src/snippet-id.ts`: non-throwing display UUIDv7 helper using
  `crypto.getRandomValues`, the current millisecond timestamp, version 7 and RFC
  variant bits; returns a valid static example ID if crypto is absent or throws.
- `web/packages/ui/src/dashboard.tsx`: Setup uses that helper; Sessions, Overview
  recent sessions, and the session drawer all prefer `client_name`, with the
  existing nested `client?.name` retained as a fallback.
- `web/packages/ui/src/types.ts`: Session now declares the actual read API's
  required `client_name` string. This supersedes the earlier report's request for
  a nested session client API and its blanket ban on this name in read models.
- `web/apps/dashboard/src/demo.ts` and `examples/next-host/app/fixture.ts`: session
  fixtures use the real API's flat `client_name`; event clients remain nested.
- `web/scripts/snippet-id-qa.mjs`: runs the helper with `randomUUID` deleted,
  verifies timestamp/version/variant and randomness, and tests missing crypto,
  missing `getRandomValues`, and a throwing randomness provider.
- `web/scripts/test.mjs` and `web/scripts/spec-qa.mjs`: include helper QA and
  require the real session fixture shape.
- `web/scripts/e2e-insecure-qa.mjs`: reproducible real-collector Playwright test
  using disposable Postgres, CI bootstrap credentials, non-localhost HTTP,
  Setup tab captures, spec ingest, session rollup wait, and read-screen checks;
  shuts down its collector and removes its disposable database container.

Read API audit: inspected `crates/signals-server/src/openapi.rs` and
`crates/signals-store/src/read.rs` (the brief's server `read.rs` path does not
exist). Session `client_name` affected three UI locations and all were corrected.
Tool fields (`tool`, calls/errors, percentile values, last_called, trend) and
caller summary fields (id/kind/label, counts, clients, first_seen/last_seen) match
those screens' reads. Events/session events include nested attrs, source, client
and caller as consumed by Live/event rows, plus unused legacy flat aliases.
No additional field-name mismatch was found in those screens.

Verification commands and outputs:

```text
$ PATH="$HOME/.bun/bin:$PATH" bun run --cwd web check
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
(exit 0, including final repeat after adding the E2E runner)

$ PATH="$HOME/.bun/bin:$PATH" bun run --cwd web build
dist/assets/index-DoKKUJNP.css  36.65 kB | gzip: 11.40 kB
dist/assets/index-zi5q0FG8.js   274.39 kB | gzip: 84.45 kB
✓ built in 528ms
(exit 0)

$ PATH="$HOME/.bun/bin:$PATH" PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Visual QA passed: 7 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
(exit 0)

$ PATH="$HOME/.cargo/bin:$PATH" CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=4 cargo build --locked --bin signals > web/artifacts/e2e-cargo-build.log 2>&1
$ tail -3 web/artifacts/e2e-cargo-build.log
Compiling signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-dashboard/crates/signals-store)
Compiling signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-dashboard/crates/signals-server)
Finished `dev` profile [unoptimized] target(s) in 49.19s
(exit 0)
```

The first E2E attempt exited 1 because Postgres's initialization socket answered
`pg_isready` before its final TCP listener started; the collector log reported
`Connection reset by peer (os error 104)`. The runner now waits for TCP readiness.
The second attempt verified all three insecure-origin Setup snippets, then exited
1 because it read Sessions before the asynchronous rollup had created a row.
The runner now polls Sessions for up to 90 seconds, covering the existing
60-second worker interval. Both failed attempts cleaned up their processes and
containers.

The third E2E attempt reached the populated Sessions API, then timed out on an
exact button-name selector: the client avatar contributes its initial to the
accessible name. The runner now locates the session row button by its displayed
client text. The final attempt passed:

```text
$ PATH="$HOME/.bun/bin:$PATH" PLAYWRIGHT_CHANNEL=chromium bun run --cwd web scripts/e2e-insecure-qa.mjs
PASS insecure origin http://10.8.0.11:23441: secureContext=false, randomUUID absent, all three Setup snippets render
Waiting for the session rollup
PASS live collector: spec batch accepted; Sessions, session drawer, Overview, Tools, Callers and Live show read API values
Stopped collector and disposable Postgres container
(exit 0)

$ PATH="$HOME/.bun/bin:$PATH" bun --cwd web --bun eslint scripts/e2e-insecure-qa.mjs
(no output; exit 0)

$ docker ps --filter name=signals-dashboard-e2e --format '{{.Names}}'
(no output)
$ git diff --check
(no output; exit 0)
```

Additional teardown verification:

```sh
python3 - <<'PY'
import socket
for host,port in [('10.8.0.11',23441),('127.0.0.1',23442),('127.0.0.1',23330)]:
 with socket.socket() as s:
  assert s.connect_ex((host,port))!=0,(host,port)
print('PASS collector, disposable Postgres and demo test ports are closed')
PY
```

```text
PASS collector, disposable Postgres and demo test ports are closed
```

Committed captures from the successful real HTTP collector run:

- `web/artifacts/e2e-http-setup-python.png`
- `web/artifacts/e2e-http-setup-node.png`
- `web/artifacts/e2e-http-setup-curl.png`
- `web/artifacts/e2e-http-sessions.png`

The Python Setup and Sessions images were also opened for visual inspection.
The session row reads “Insecure HTTP MCP Client”, with one call and no errors.
No requested fix or verification remains. No backend source, dependency manifest,
or lockfile was edited by this fix; backend changes came only from the instructed
main merge. Nothing was pushed or published.
