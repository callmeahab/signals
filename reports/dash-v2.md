# Dashboard v2 report

The eleven-screen mcpramen restyle is implemented. All four required verification commands pass. Nothing was pushed or published.

## Changes by file

- `web/packages/ui/src/analytics-types.ts`: typed contracts, metadata, nullability, filters, settings, alerts and timeline.
- `web/packages/ui/src/analytics.tsx`: exported Overview, Adoption, Tools, Reliability, Cost and Protocol components; tiles, charts, payload histogram, retention grid, status/empty states, tool drawer, timeline, tenant usage and editable analytics settings.
- `web/packages/ui/src/dashboard.tsx`: analytics routing with legacy-client compatibility; caller first/last seen, error rates and favourite tools; session transport/outcome/reason and timeline; preserved Live, SDK snippets, keys and users.
- `web/packages/ui/src/types.ts`, `index.ts`: optional analytics client extension, 90-day range, expanded screen union and exports.
- `web/packages/ui/src/styles.css`, `charts.tsx`: exact source light/dark palettes, visualization tokens, radius/easing scale, Krona typography, hairline tile grid, panels/tables/pills, ink magnitude charts and reduced-motion rules.
- `web/apps/dashboard/src/main.tsx`, `shell.css`: sticky 60px wordmark top bar, responsive section navigation, 1180px container, 20px gutters, segmented range and themes; sidebar and old branding removed.
- `web/apps/dashboard/src/client.ts`: authenticated analytics GETs, timeline GET, alert PUT; project PATCH carries analytics settings.
- `web/apps/dashboard/src/demo.ts`, `demo-analytics.ts`: all eight named analytics routes plus timeline, consistent aggregate calls/tokens/client shares/histograms, null telemetry, configurable token estimates and alert edits; existing legacy fixtures remain available.
- `web/apps/dashboard/public/mcpramen-wordmark.svg`, `mcpramen-mark.svg`, `favicon.svg`: copied artwork; inline wordmark letters inherit currentColor.
- `web/apps/dashboard/index.html`, `web/package.json`, `web/bun.lock`: gold theme hint and offline-safe Fontsource Urbanist/Krona/IBM Plex Mono.
- `web/scripts/analytics-qa.mjs`, `test.mjs`: route/range arithmetic, nulls, filters, timeline ordering, token divisor and alert persistence.
- `web/scripts/visual-qa.mjs`, `login-styles.mjs`: eleven screens, two themes, 390/1440px; all fonts loaded; wordmark present; screenshots; drawers, Live, settings, keys and snippets; 320px/reduced-motion checks.
- `web/scripts/test-next-host.mjs`: temporary packed hosts now use ignored workspace scratch storage and are removed in finally, including failed installs.
- `web/artifacts/v2/*-1440-*.png`: 22 desktop screenshots; existing tracked light desktop Setup screenshots refreshed.

## Verification commands and output

Commands ran from `web/` with `PATH=$HOME/.bun/bin:$PATH`. Logs remain locally under ignored `web/artifacts`; terminal excerpts follow.

### BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run check

Result: exit 0.

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

### BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run build

Result: exit 0.

```text
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-DYsDlOSW.css                                     32.94 kB │ gzip:  7.19 kB
dist/assets/index-B8fNLMYM.js                                     299.58 kB │ gzip: 91.75 kB

✓ built in 246ms
```

### PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test

Result: exit 0.

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.

  VITE v8.3.2  ready in 97 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

### PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test:next

Result: exit 0.

```text

▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23331
- Network:       http://127.0.0.1:23331
✓ Ready in 54ms
✓ Running next.config.mjs took 11ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

Additional commands ran from the worktree root:

```sh
git diff --check
```

Exit 0, no output.

```sh
if git grep -n -E 'Unbounded|Manrope|ff5a36' -- web; then exit 1; else echo 'Old fonts and accent: no matches in tracked web sources'; fi
```

```text
Old fonts and accent: no matches in tracked web sources
```

Source palette comparison:

```sh
python3 - <<'PY'
from pathlib import Path
import re
ref=Path('/home/vuk/orca/workspaces/mcpramen/stickleback/services/web/src/app/globals.css').read_text();actual=Path('web/packages/ui/src/styles.css').read_text()
for selector in [':root','.dark']:
 pattern=re.escape(selector)+r' \{(.*?)\n\}'
 expected=dict(re.findall(r'(--[\w-]+):\s*([^;]+);',re.sub(r'/\*.*?\*/','',re.search(pattern,ref,re.S)[1],flags=re.S)))
 result=dict(re.findall(r'(--[\w-]+):\s*([^;]+);',re.search(pattern,actual,re.S)[1]))
 assert expected==result
 print(selector+': all '+str(len(expected))+' source palette tokens match exactly')
ref=Path('/home/vuk/orca/workspaces/mcpramen/stickleback/services/web/src/app/admin/admin-viz.css').read_text()
assert ref in actual
print('Complete admin visualization tokens and forced-colors fallback copied exactly')
PY
```

```text
:root: all 35 source palette tokens match exactly
.dark: all 34 source palette tokens match exactly
Complete admin visualization tokens and forced-colors fallback copied exactly
```

Screenshot inventory:

```sh
python3 - <<'PY'
from pathlib import Path
screens=['overview','adoption','tools','reliability','sessions','callers','cost','protocol','live','setup','settings']
for screen in screens:
 for theme in ['light','dark']:
  p=Path(f'web/artifacts/v2/{screen}-1440-{theme}.png')
  assert p.exists() and p.stat().st_size>10000,p
print('Screenshot inventory passed: 11 screens × 2 themes = 22 desktop PNGs')
PY
```

```text
Screenshot inventory passed: 11 screens × 2 themes = 22 desktop PNGs
```

Opened generated Overview light/dark desktop, Overview dark mobile, and Adoption light desktop screenshots for visual inspection. Browser QA checks overflow, fonts and wordmarks on all screens; it does not compare pixel baselines.

## Failures resolved

- Initial install from the repository root had no package manifest; rerunning from `web/` with the required cache succeeded.
- 320px top-bar and dead-tool-label overflow were fixed; full browser QA passed afterward.
- A filtered tool-array expression widened a TypeScript literal; an explicit result annotation fixed it.
- Overlapping Next package build and browser testing triggered Vite HMR; final runs were sequential.
- Repeated Next fixture installs hit shared `/tmp` EDQUOT. Removed only this dispatch's own generated fixture directories and changed the harness to clean workspace scratch storage. A trial browser TMPDIR override exceeded Chromium's Unix socket path limit and was reverted. The final Next/browser runs passed.

## Contract notes and remaining integration

- No frontend screen is left unfinished. Tests use demo data and the packed Next fixture; the parallel Rust backend was not run here. Coordinator verification against that backend remains after integration.
- Adoption's contract provides daily users/new/returning history and current DAU/WAU/MAU totals, but no weekly/monthly history per point. Demo points include optional `wau` and `mau` fields for the requested three-series chart. Real responses without these fields show DAU history plus a missing-history explanation, while retaining current WAU/MAU totals. These histories are never synthesized by summing daily unique counts.
- The brief omits complete alerts/digest/timeline-envelope and digest-settings schemas. The explicit frontend expectations are `{rules: [...]}` for alert reads/PUT, `{session, events}` for timelines, and `digest_enabled` / `digest_recipient` on project PATCH; reconcile with the collector implementation during integration.
- Previous context-token totals are optional because the supplied overview contract has no token `prev`; absence says “No prior data.” Missing favourite tools, session reasons, SDK error classifications, schema validation and probes remain unknown.
- Valid SDK code intentionally retains `signals.instrument`, `signals.asgi` and `signals.express`; test fixture email domains also retain their existing names. A broad literal `signals.` grep therefore finds code and fixtures, while the obsolete visible brand is removed. The old fonts and old accent have no tracked-web-source matches.
- The existing Next example's seven-screen client verifies backward compatibility, packed ESM/types/CSS and host style isolation; the eleven-screen Vite suite exercises the new analytics client.


## Fix pass r1

Addressed both blockers and all seven should-fixes from `reviews/dash-v2-r1.md`.

Changes by file:

- `web/packages/ui/src/time.ts`, `index.ts`: shared range-to-bucket mapping and timestamp-based duration formatter (seconds, minutes/seconds, hours/minutes).
- `web/apps/dashboard/src/demo-analytics.ts`: hourly 24h, daily 7d/30d and weekly 90d buckets; timestamps advance by the declared interval; weighted distribution preserves integer totals, including the final partial bucket; all catalogue dead tools are overview attention rows.
- `web/apps/dashboard/src/client.ts`: derives request bucket from range for analytics and time-series requests.
- `web/packages/ui/src/analytics.tsx`: subtitles and time axes use response bucket metadata; null SLO budgets omit progress entirely; handshake waiting copy depends on absent rate/p95; nullable bars omit numeric tracks instead of drawing zero. Audited screen `?? 0` expressions: no matches remain. Missing keys in the non-nullable sparse by-client count map still mean no calls for that client, not a null measurement.
- `web/packages/ui/src/table-scroll.tsx`, `dashboard.tsx`: shared table wrapper with an overflow hint and keyboard-focusable desktop scroll region; mobile rows present every field as a divided, labeled list, preserving table semantics. Sessions use the shared timestamp formatter.
- `web/packages/ui/src/styles.css`, `web/apps/dashboard/src/shell.css`: mobile list presentation, fixed 400 weight and no synthesis on every Krona element (including avatars and detail metrics), and 10.5px eyebrows/pills at all widths.
- `web/apps/dashboard/index.html`: theme-color uses bowl yellow `#FBC118`.
- `web/scripts/visual-qa.mjs`, `web/apps/dashboard/src/demo.ts`: fixed browser clock, seeded random/crypto, UTC and reduced-motion screenshots; visual QA holds demo live arrivals steady. Font readiness precedes every screenshot. Added per-screen assertions for Krona weight/synthesis, label sizes, unclipped mobile fields and desktop scroll affordances.
- `web/test/review-r1/probe.mjs`, `web/scripts/test.mjs`: review probe now runs in `bun run test`; expanded checks cover exact bucket spacing/counts, rendered bucket subtitles/axes and duration boundaries, with the original dead-tool/null-budget/handshake assertions retained. Corrected the probe's hard-coded all-daily expectation to the fix brief's hourly/day/week mapping, and replaced its copied old duration formula with assertions against the formatter actually used by the screen.
- `web/artifacts/v2/` and the three existing Setup PNGs: committed the final deterministic screenshot set. A subsequent full test run left every tracked screenshot byte-identical and the worktree clean.

Verification (from `web/`, with Bun on PATH):

`BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run check` — exit 0.

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

`BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run build` — exit 0.

```text
dist/assets/index-Db3vLRZa.js                                     301.08 kB │ gzip: 92.33 kB

✓ built in 335ms
```

`PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test` — exit 0.

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
review-r1 probe passed

  VITE v8.3.2  ready in 93 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

`PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test:next` — exit 0.

```text

▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23331
- Network:       http://127.0.0.1:23331
✓ Ready in 66ms
✓ Running next.config.mjs took 7ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

Additional executed checks:

```sh
bun test/review-r1/probe.mjs
```

```text
review-r1 probe passed
```

After committing screenshots, ran the full `bun run test` again and then `git status --porcelain`:

```text
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
TEST_EXIT:0
```

`git status --porcelain` emitted no output. `git diff --check` also emitted no output.

```sh
grep -R -n -E '\?\? ?0' web/packages/ui/src --include='*.tsx'
```

No matches (grep exit 1). Viewed the regenerated 390px Sessions screenshot to verify the divided list and the `8 s` duration visually; all eleven screens also pass the automated layout assertions in both themes.

During implementation, lint caught imports placed before a client directive and a browser-only `window` reference in the QA script; moved the directive back to the first line and used `globalThis`. Final checks above are green. No r1 findings remain open; the original report's backend-integration notes remain applicable.


## Fix pass r2

Fixed the blocker and both should-fixes in `reviews/dash-v2-r2.md`. The contract remains unchanged: analytics bucket metadata is response-only. This supersedes the r1 report's statement that analytics requests derive and send a bucket.

Changes by file:

- `web/apps/dashboard/src/client.ts`: removed the injected analytics `bucket` parameter; analytics retains the requested range, including 90d. Legacy reads clamp 90d to 30d, and legacy time-series requests use only 1h/1d buckets. The same legacy range bound applies to caller history, overview, tools and callers.
- `web/apps/dashboard/src/demo-analytics.ts`: attention rows sort by status (error, warn, dead, ok), then descending calls within each band. Existing server-selected demo buckets and response-driven screen labels remain intact.
- `web/scripts/analytics-shapes.mjs`: independent, compact JSON-shape descriptions for all eight analytics route responses and session timelines; validates nested required/optional keys, arrays, maps, nullability, primitive types and integer counts, rejecting unexpected keys. Previously documented optional frontend additions are explicitly listed, and the incomplete prose-only alerts/digest/timeline envelopes remain identified as UI expectations rather than a changed backend contract.
- `web/scripts/spec-qa.mjs`: validates serialized demo responses against those shapes for all four ranges and every demo session timeline; negative fixtures prove missing keys, extra keys and wrong types are rejected.
- `web/scripts/test.mjs`: includes both review probes in the standard test command.
- `web/test/review-r2/probe.mjs`: retained all original checks and added legacy range validation; restored fetch/location after the request spy so server readiness and later tests use the real fetch implementation. Used explicit globalThis references to satisfy the existing lint configuration.
- `web/artifacts/v2/overview-1440-{light,dark}.png`: regenerated and committed the two changed screenshots showing descending attention-call counts; all other screenshots stayed unchanged.

Verification commands ran from `web/` with Bun on PATH:

`BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run check` — exit 0.

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

`BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run build` — exit 0.

```text
dist/assets/index-D1xdhruj.js                                     300.99 kB │ gzip: 92.28 kB

✓ built in 430ms
```

`PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test` — exit 0.

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges, all session timelines, missing/extra keys and type-drift guards.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
review-r1 probe passed
review-r2 probe passed

  VITE v8.3.2  ready in 94 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

`PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test:next` — exit 0.

```text

▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23331
- Network:       http://127.0.0.1:23331
✓ Ready in 69ms
✓ Running next.config.mjs took 7ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

After committing the screenshot changes, ran:

```sh
PLAYWRIGHT_CHANNEL=chromium BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test
git status --porcelain
```

The full rerun passed, including both probes and shape checks:

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges, all session timelines, missing/extra keys and type-drift guards.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
review-r1 probe passed
review-r2 probe passed

  VITE v8.3.2  ready in 100 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
REPEAT_EXIT:0
```

`git status --porcelain` produced no output after that run. `git diff --check` also produced no output. Earlier in this pass, lint flagged undeclared runtime globals in the new checks and imported review probe; explicit globalThis references resolved them before the final successful checks.

No round-two findings remain open. The original backend integration notes remain applicable; legacy 90-day requests intentionally fall back to the collector's supported 30-day maximum, while analytics continues to support 90 days.


## Integration

Merged `main` first: fast-forward from `9cc578d` to `f00e64b`, without conflicts.
Built the real Rust collector and dashboard, migrated an isolated PostgreSQL 16
container (`dash-v2-integration-pg`, host port 25460, 1 GiB shared memory), and ran
the browser against localhost port 25461 with Chromium using `/var/tmp/dash-int`.

### Integration findings and changes

- Replaced the stale backend browser QA with an isolated-project scenario: real
  sign-in/project switching, UI key mint/revoke, 29 spec-valid events and replay,
  exact 25 tool calls / one identity / one session / 96% success / 250 estimated
  tokens, all eleven screens, the analytics timeline, legacy caller/session
  rollups, SSE, settings persistence, rejected PATCH feedback, CSRF and logout.
  The legacy caller count includes MCP requests and initialize events (27), while
  analytics tool calls count only the 25 tool events. QA waits for the legacy
  minute-based rollup rather than assuming immediate session materialization.
- Timeline client/identity are structured objects, lifecycle output kinds can be
  null, and day-seven funnel counts can be null with an optional eligible count.
  Updated types, rendering, demo timeline shapes, and the existing header
  assertion to inspect client name and identity key without reducing test scope.
- Settings use the real nested `digest` document. Alert labels come from stable
  rule IDs when names are absent; threshold/window controls appear only when
  those fields exist. Existing demo alert editor coverage remains in place.
  The request helper displays the server's explanatory message for 4xx responses.
  PATCH serializes writable fields so read-only project metadata is not sent back.
- Charts collect client names across all response buckets, render one-bucket
  data visibly, and show an empty state for an empty series.

### Backend contract escalation

The initial backend returned only legacy project fields from `auth::account`
(`GET /auth/me`) and offered PATCH but no GET at `/v1/projects/{id}`. Therefore a
reload lost SLO settings, digest preferences and token divisor, despite successful
PATCH persistence. Escalated this exact read-path gap through Orca ask, without
changing Rust or manufacturing frontend defaults to conceal persisted settings.
The coordinator amended `analytics-api.md` with **Settings read**: GET project
and `/auth/me` carry safe analytics settings, PATCH returns the same document,
and the secret is redacted to `probe_key_set`. The backend author owns that fix;
the frontend now reads GET project when loading Settings.

Merged backend commit `71cc3d4` via merge `8cc1007` (see Git history for merge
identity), then rebuilt the collector. Settings now saves SLO classes, alert rules,
digest and token divisor in one PATCH. Live QA confirmed those fields in the
PATCH response and after browser reload; token cost changed from 260 to 130 after
the divisor changed from 4 to 8 (including the additional Live event).

### Verification

Environment and commands used (all services isolated to localhost):

```sh
export PATH=/var/tmp/dash-int/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 TMPDIR=/var/tmp/dash-int
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:25460/signals
export SIGNALS_URL=http://127.0.0.1:25461 PLAYWRIGHT_CHANNEL=chromium
export ANALYTICS_REVIEW_URL=http://127.0.0.1:25462 ANALYTICS_REVIEW_PROBE_PORT=25463
# /var/tmp/dash-int/bin/psql delegates to docker exec -i
# dash-v2-integration-pg psql, rewriting host port 25460 to 5432.
cd web
BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun install --frozen-lockfile
bun run check
bun run build
BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test
BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache bun run test:next
cd ..
cargo build --locked --bin signals
target/debug/signals migrate
docker exec -i dash-v2-integration-pg psql -U postgres -d signals < .sqlx/dev.sql
python3 scripts/ci-conformance.py
```

Install reported `Checked 171 installs across 193 packages (no changes)`.
The final check, build, demo and Next-host commands all exited 0; tails:


`web/artifacts/integration-check.log`:

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

`web/artifacts/integration-build.log`:

```text
dist/assets/urbanist-latin-ext-wght-normal-Bdxck5Au.woff2          16.60 kB
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-Bxil6BQb.css                                     34.64 kB │ gzip:  7.53 kB
dist/assets/index-CZafG21I.js                                     302.09 kB │ gzip: 92.62 kB

✓ built in 292ms
```

`web/artifacts/integration-demo.log`:

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges, all session timelines, missing/extra keys and type-drift guards.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
review-r1 probe passed
review-r2 probe passed

  VITE v8.3.2  ready in 104 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

`web/artifacts/integration-next.log`:

```text
▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23331
- Network:       http://127.0.0.1:23331
✓ Ready in 75ms
✓ Running next.config.mjs took 7ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

Committed real-data captures: `web/artifacts/v2-live/overview.png`,
`tools.png`, and `cost.png`. These came from the successful browser QA against
the real collector, before the additional Live event and settings changes; they
show 25 calls and 250 estimated tokens. All three were visually inspected.
The full demo visual run also regenerated its tracked screenshots without drift.

### Complete conformance result and cleanup

`python3 scripts/ci-conformance.py` exited **0**. This ran the spec sweep,
transport probes, login-style QA, the rewritten real-backend browser QA, the
release build, and the independent analytics review probe. Selected literal
output and the final tail from `web/artifacts/integration-ci.log`:

```text
identity: 39/39 valid fixtures matched
identity: 49/49 invalid fixtures matched
gzip: 39/39 valid fixtures matched
gzip: 49/49 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v2 analytics, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
perf facts 100000

]
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

The probe result was preserved before deleting `target/`:

```json
{
  "findings": [],
  "mismatches": [],
  "mismatch_count": 0,
  "timings": {
    "overview": 188.86,
    "adoption": 256.27,
    "tools": 139.05,
    "reliability": 120.81,
    "cost": 150.77,
    "protocol": 45.87,
    "digest": 167.12,
    "alerts": 1.86,
    "timeline": 9.79
  }
}
```

All required acceptance commands passed. No backend deviation remains unresolved:
the settings-read gap was fixed by its author and verified through real GET,
PATCH, `/auth/me`, and browser reload behavior. Rust source was imported through
the backend author's merge rather than edited in this dashboard task.

Stopped and removed only the owned `dash-v2-integration-pg` container. Both
collector processes were stopped by their test runners; the initial manual
collector was stopped before conformance. Removed the owned `target/` directory
and `/var/tmp/dash-int`; preserved useful logs under ignored `web/artifacts/`.
The demo/Next test runners also stopped their Vite/Next servers and cleaned their
temporary host package. No deployment or push was performed.


## Truncated catalogue

Merged `main` first with `git merge main` (exit 0), fast-forwarding
`94d5102..932b99e`. Implementation commit: `141a876`.

Changes by file:

- `web/packages/ui/src/analytics-types.ts`: requires `catalog.complete: boolean`
  and allows `catalog.dead: string[] | null`.
- `web/packages/ui/src/analytics.tsx`: Tools guards nullable dead values and shows
  “Catalogue truncated, coverage unknown”; Overview fetches the tools catalogue
  alongside overview data, shows the same notice, and suppresses dead attention
  rows unless the catalogue is known and complete. Settings offers tool class
  selectors only for a known, complete catalogue.
- `web/apps/dashboard/src/demo-analytics.ts`: complete catalogues remain the
  default; truncated catalogues have null dead data, preserve called tools, and
  omit dead attention rows.
- `web/apps/dashboard/src/demo.ts` and `main.tsx`: selectable `demo-truncated`
  project; project updates preserve the selected project's identity.
- `web/scripts/analytics-shapes.mjs`: amended independent wire shape.
- `web/scripts/spec-qa.mjs`: both catalogue states across all four ranges,
  required completeness/type guards, null dead data, retained called tools, and
  rendered Tools/Overview regression checks (including stale dead attention).
- `web/scripts/visual-qa.mjs`: switches projects in the browser and checks the
  truncated notice, absent dead rows, retained called tool, absent unverified SLO
  selectors, and restored selectors after switching back to the complete project.

`grep -nE 'catalog|dead' web/scripts/backend-qa.mjs` returned no matches (exit 1),
so no backend QA dead-list assertion needed changing. Backend integration was not
rerun for this frontend-only amendment.

Verification commands were run from `web` with
`PATH="$HOME/.bun/bin:$PATH"`. Final successful output excerpts:

`bun run check` — exit 0.

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

`bun run build` — exit 0.

```text
dist/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2          14.70 kB
dist/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2          14.88 kB
dist/assets/urbanist-latin-ext-wght-normal-Bdxck5Au.woff2          16.60 kB
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-Bxil6BQb.css                                     34.64 kB │ gzip:  7.53 kB
dist/assets/index-FFgZzShf.js                                     302.94 kB │ gzip: 92.81 kB

✓ built in 588ms
```

`export PLAYWRIGHT_CHANNEL=chromium; bun run test:next` — exit 0.

```text
○  (Static)  prerendered as static content

▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23331
- Network:       http://127.0.0.1:23331
✓ Ready in 56ms
✓ Running next.config.mjs took 11ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

Earlier attempts and resolution:

- The first `bun run check` exited 1 because the new QA used unqualified
  `structuredClone` twice (`'structuredClone' is not defined  no-undef`). Changed
  both references to `globalThis.structuredClone`; the check then passed.
- The first `PLAYWRIGHT_CHANNEL=chromium bun run test` exited 1 in the round-2
  browser probe with `Cannot read properties of undefined (reading
  'querySelectorAll')`. It ran concurrently with Next's UI-package rebuild and
  logged repeated React root reload warnings. Sequential execution passed the
  same round-2 probe without a code change; a concurrent rebuild is the suspected
  cause, not a proven application defect.
- The first `bun run test:next` exited 1 because the default browser was absent:
  `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`.
  Exporting `PLAYWRIGHT_CHANNEL=chromium` used the installed browser; Next passed.

Contract/design note: completeness exists on the tools route only, so Overview
now makes one additional analytics request to obtain authoritative catalogue
metadata. No new overview wire fields were invented. No unresolved contract
change was found in this task's scope.

`PLAYWRIGHT_CHANNEL=chromium bun run test` — exit 0.

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges × 2 catalogue states, all session timelines, missing/extra keys and type-drift guards.
Truncated catalogue QA passed: nullable dead, required completeness, retained calls and safe Tools/Overview rendering.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
review-r1 probe passed
review-r2 probe passed

  VITE v8.3.2  ready in 94 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

Restored 25 tracked QA screenshots with `git restore -- <tracked PNG paths>` after the visual run. All four acceptance commands passed; nothing remains unfinished in this task.

Final `git diff --check` exited 0 with no output. After committing the report,
`git status --porcelain` exited 0 with no output (clean working tree).
