# Dashboard v6 polish

## Changes

- `web/packages/ui/src/info.tsx`, `copy/explanations.ts`, `styles.css`: all 89
  explanations have title/body/computed/action fields; hover waits 120 ms, focus and
  click pin the card, Escape restores focus, and outside/second clicks dismiss it.
  Top-layer placement clamps desktop cards and anchors mobile sheets to the bottom.
  Urbanist body typography explicitly resets the inherited tile-label styling.
  Buttons use 40 px targets and 24/20 px card/tile icons; tile units appear as chips.
- `web/apps/dashboard/src/project-status.ts`, `client.ts`, `main.tsx`, `shell.css`:
  project dots/icons observe existing successful and failed reads without new requests.
  Overview active identities establish whether any events occurred in the window;
  projects without an observed active window stay gold, and demo stays muted.
  Theme/sign-out/mobile icons use 22 px artwork, with 40 px targets.
  The workspace freshness text and pulse are removed; polling is retained.
- `web/packages/ui/src/dashboard.tsx`, `analytics-v3.tsx`: retain previously painted
  values after refresh/dependency errors, suppress subsequent initial skeletons, and
  keep project changes out of the navigation fade. Supporting analytics requests run
  independently so the primary overview can paint while client mix holds its frame.
  Pending trend slots use a quiet shimmer with the same 108/38 px chart height;
  nested card loaders use that surface as well. Sessions waits for its initial skeleton
  hold before mounting tiles, preventing content and initial loader from overlapping.
- `web/apps/dashboard/index.html`: inline html/body backgrounds, color-scheme,
  scheme-specific theme-color metadata and blocking stored-theme selection before
  the external bundle. Stored light overrides a dark OS preference. The html/body
  background also covers Safari's initial canvas and overscroll; Safari itself was
  not measured here.
- `web/scripts/v6-qa.mjs`, `test.mjs`, `visual-qa.mjs`, `live-qa.mjs`,
  `choreography-qa.mjs`, `web/test/review-r2/probe.mjs`: integrated v6 assertions,
  delayed supporting reads, skeleton lifecycle observation, 100 ms screenshot series,
  pixel checks for white frames, hover typography/geometry and mobile sheets, project
  states and icon sizes. Count-up duration checks read scheduled 640 ms values;
  sampled headlines still verify a visible monotonic climb.
- `web/packages/ui/DESIGN.md`: notes 27–33 document the seven requested changes.

## Verification

The final code was checked with:

```sh
cd web && bun run check
```
```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

```sh
cd web && bun run build
```
```text
dist/assets/index-DoXFxP3v.js                                     395.10 kB │ gzip: 122.07 kB

✓ built in 210ms
```

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium bun run test:next
```
```text
- Network:       http://127.0.0.1:23331
✓ Ready in 54ms
✓ Running next.config.mjs took 7ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

Additional final gate outputs are appended below.

## Findings and limits

The initial info surface inherited uppercase, no-wrap tile styling. The sequential
analytics query also waited for all supporting routes, while dependency failures
could clear a displayed value and permit another skeleton; the Sessions screen
could mount its tiles during the minimum skeleton hold. These paths are corrected.
Project status uses already observed overview activity; it never invents activity for
an unvisited project or adds a request to determine it. All original metric prose was
preserved while splitting its sections; no analytics contract fields were added.

Early verification attempts found a legacy yellow theme-color assertion (updated for
the requested theme backgrounds), missing Chrome in the Next test (rerun explicitly
with Chromium), and a Chromium UNIX socket path too long under the initial TMPDIR.
The final-build backend pass also exposed a count-up/null transition race: a queued
frame could overwrite React’s null label before effect cleanup, leaving a percentage
on an empty project; the null/reduced-motion effect now explicitly restores its text,
and v6 QA injects a null success metric during a project switch. The first new
regression assertion incorrectly assumed the young demo project was empty; its
fixture has traffic, so the test now explicitly supplies the null metric. One test overlapped a package rebuild, triggering Vite HMR and a drawer-chart failure;
subsequent builds and browser runs are serialized. A screenshot inspection caught
an overly broad button rule displaying the mobile menu on desktop; its visibility
is now explicitly asserted.

No push or remote CI run is requested. Local acceptance checks and captured evidence
are the verification for this branch; Safari-specific coverage is limited to the
prepaint CSS/script design described above.

The first 15-switch performance sample ran concurrently with static captures and
failed the unchanged gate: median 38.696 ms, p90 58.229 ms, with two outliers at
60.751 and 58.229 ms. Final performance samples are run without concurrent browser
capture jobs; the 50 ms budget, documented 60 ms Live exception, and one-outlier
ceiling of 70 ms are unchanged.


## Evidence

`web/artifacts/v6/evidence.json` records the sampled background colours, corner
pixels, skeleton episodes, content state and actual capture timestamps for cold
loads, project switches and hard reloads in both themes. The 108 corresponding PNGs
use `cold-*`, `switch-*`, and `reload-*` names. `info-light.png`, `info-dark.png` and
`info-mobile-*.png` show the hover card and bottom sheet. The final delayed-load test
requires exactly one cold-load skeleton, at most one episode per navigation, and zero
skeleton episodes after the first content paint; an initial-error retry is also tested.

The Vite test interception matches versioned module URLs as well as bare URLs, so
hot-reload query strings cannot silently bypass the deliberately staggered data.


## Final browser and backend results

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium bun run test
```
```text
Visual QA passed: v3 chart SVG/table twins on every screen with nothing scrolled, no unpainted card in any capture, unmasked drawer captures, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440 widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
Live QA passed: 60000 ms refresh observed on the active screen, skeleton held 200/400 ms, nothing while the tab is hidden, an immediate refresh on return and on a range change, no dim, no replayed entrance, no count-up from zero, no freshness badge, and no polling under __SIGNALS_VISUAL_QA__.
Choreography QA passed: tiles at 130+55i ms, cards at 300+85i ms capped at 1100 ms, every chart's draw-in 180 ms behind its own card or tile, every tile headline climbing from zero over 640 ms from its own entrance on a cold load and on every navigation, one run per navigation with nothing on scroll or resize, a 18-frame 100 ms series in artifacts/v5/choreography/, and the finished page at once under reduced motion.
Reload series passed: no Connecting or Reading text screen, no login card, the shell and heading arrive with the content, the workspace strip holds its height once the webfonts have loaded, and an ordinary reload reports zero layout shift.
v6 QA passed: corner geometry, hover/sticky card fields, typography, unit, mobile sheet, project states, icon size, badge absence, skeleton <=1 and none after content, cold/switch/reload 100 ms series in both themes with no white frames.
```

The visual pass includes contrast/clip scanning: zero failures at 390/1280/1440 px,
light and dark, including open info surfaces and unmasked drawers.

```sh
PLAYWRIGHT_CHANNEL=chromium \
DATABASE_URL=postgres://postgres:signals@127.0.0.1:25576/signals \
ANALYTICS_PG_CONTAINER=dash-v6-qa-pg \
SIGNALS_URL=http://127.0.0.1:25577 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:25578 \
ANALYTICS_REVIEW_PROBE_PORT=25579 SIGNALS_PROBE_LATENCY_BUDGET_MS=900 \
TMPDIR=/tmp/dash-v6-qa python3 scripts/ci-conformance.py
```

For this final run `/tmp/dash-v6-qa` was a short symlink to the worktree's on-disk
temporary directory, avoiding Chromium's UNIX socket path limit. `df -T` reported
`/dev/mapper/ubuntu--vg-ubuntu--lv ext4`. PostgreSQL was started as:

```sh
docker run -d --name dash-v6-qa-pg --shm-size=1g \
  -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals \
  -p 127.0.0.1:25576:5432 postgres:17
```

Final conformance output:

```text
identity: 52/52 valid fixtures matched
identity: 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched
gzip: 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Backend browser QA passed: real v3 analytics, project cards that survive a reload, a 60-second refresh of the active screen alone that stops while the tab is hidden, a skeleton held back 200 ms and kept 400 ms, painted funnel with a null day-7 step, adoption session/WAU/MAU trend series, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings that carry saved SLO targets into the Tools tile and the overview caption, hour-stamped sparkline readouts on a 24-hour window, 400 message, CSRF, logout.
BENCH overview: median 155.49 ms; samples [155.49, 163.49, 146.17]
BENCH adoption: median 277.89 ms; samples [284.61, 277.89, 256.04]
BENCH tools: median 144.86 ms; samples [153.69, 117.26, 144.86]
BENCH reliability: median 109.61 ms; samples [108.96, 115.03, 109.61]
BENCH cost: median 145.94 ms; samples [137.62, 145.94, 175.8]
BENCH protocol: median 85.28 ms; samples [95.08, 85.28, 75.37]
BENCH digest: median 152.52 ms; samples [152.52, 147.67, 161.84]
BENCH alerts: median 0.71 ms; samples [0.91, 0.71, 0.63]
BENCH timeline: median 8.11 ms; samples [7.95, 8.11, 9.55]
FINDINGS 0 MISMATCHES 0
```

`web/artifacts/v6/conformance-findings.json` records zero findings/mismatches and
all latency samples. The isolated container was removed with
`docker rm -f -v dash-v6-qa-pg` (output `dash-v6-qa-pg`), and its TMPDIR symlink and
backing directory were removed after the process returned exit 0.


The last pending-surface correction preserves 108 px overview/adoption trend frames
and 38 px compact trend frames while their data is pending, and uses the same quiet
shimmer inside nested card loaders. The final full browser suite and Next host were
rerun after this correction; the backend conformance result above precedes only this
pending-surface CSS and Cost placeholder change, with no backend/API changes.


## Static capture and performance gates

```sh
cd web
STATIC_BASELINE=1 BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun scripts/v6-static-qa.mjs
```

The baseline is the completed integrated visual run; the command performs the next
three runs serially and compares every PNG's SHA-256 against it.

```text
Static capture run 1: 116 PNGs.
Static capture run 2: 116 PNGs byte-identical to run 1.
Static capture run 3: 116 PNGs byte-identical to run 1.
Static capture run 4: 116 PNGs byte-identical to run 1.
Four serial static capture runs passed, including the full contrast/clip and unmasked drawer gates.
```

```sh
BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium PERFORMANCE_REPEATS=15 \
  bun scripts/performance-qa.mjs
BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun scripts/performance-qa.mjs --walk
```
```text
15 repeats of adoption: longest task median 37.26 ms, p90 42.97 ms, range 34.52–42.97 ms; 0 over budget (1 tolerated under 70 ms)
Walk, 30 rows: longest task median 35.29 ms, p90 47.73 ms, range 17.05–53.03 ms; 0 over budget (1 tolerated under 70 ms)
```

No budgets or outlier rules were relaxed. The walk's largest task is within the
existing `protocol → live` exception; no transition exceeded its applicable budget.

## Project status request regression

Validation, missing-resource and rate-limit responses are reachable-server errors,
not evidence of an unreachable collector. The final request observer preserves the
known state for these, while 401/403, server failures and network failures mark it
unreachable; successful existing overview reads recover it. This frontend-only
classification is covered by an added test imported by `bun run test`:

```sh
cd web && bun scripts/v6-status-qa.mjs
```
```text
Project status QA passed: existing reads drive active/quiet/error states; validation, missing resources and rate limits do not falsely mark the collector unreachable; auth, server and network failures do; recovery and range scoping work.
```

This last classification change does not run on demo capture or tab-performance paths.
The full browser suite is rerun afterward and its captures compared with the four-run
baseline before completion.


## Earlier verification failures retained for review

- `bun run check`: the first new browser script had four browser globals that ESLint
  required to be qualified with `globalThis`; these were corrected.
- `PLAYWRIGHT_CHANNEL=chromium bun run test`: the old theme-colour assertion expected
  `#FBC118`; it now checks the requested light document background. One overlapping
  package rebuild produced `tools drawer: no trend chart`; later builds and browser
  suites were serialized.
- `bun run test:next`: `Chromium distribution 'chrome' is not found`; rerunning with
  `PLAYWRIGHT_CHANNEL=chromium` passed.
- `python3 scripts/ci-conformance.py`: the first TMPDIR path triggered Chromium's
  `Socket path too long`; a short symlink to disk solved it. A later backend test
  caught `Expected: No data yet / Received: 92.6%`, exposing the fixed count-up race.
- `bun scripts/v6-qa.mjs`: `waitForFunction: Timeout 30000ms exceeded` exposed a test
  assumption that the first-week demo had no traffic and a route pattern that did
  not match Vite cache-busting URLs; the test now injects the null explicitly and
  matches versioned module URLs.
- The initial concurrent performance sample failed at `p90 58.229 ms`; the final
  isolated samples above passed the original budgets without exceptions being added.

These failures were investigated; no gate was disabled or its budget increased.


## Completion checks

The final `PLAYWRIGHT_CHANNEL=chromium bun run test` returned exit 0, including the
new request/status regression. A SHA-256 comparison after that final run reported:

```text
Final confirmation captures: 116 PNGs byte-identical to all four frozen runs.
```

The hashes are saved in `web/artifacts/v6/static-final-confirmation.json`. This fifth
matching set confirms that the final reachable-server error classification did not
change any static surface.

The manual Vite server was stopped. The command

```sh
ss -ltn '( sport = :23330 or sport = :23331 or sport = :23336 or sport = :25576 or sport = :25577 or sport = :25578 or sport = :25579 )'
```

returned only its header, with no listening test ports. `git diff --check` returned
exit 0 with no output. The PostgreSQL container and the identified temporary directory
are removed; the existing shared build cache/target directory is retained. No push,
tag, deployment or remote CI action was performed. Safari runtime measurement remains
outside the available Chromium evidence; there is no other unfinished requested work.
