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
