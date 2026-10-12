# Dashboard v3 implementation report

Current status: **Round 1 acceptance passed**. The original-dispatch sections below are retained as history; the Round 1 section records the current changes and verification.

Original dispatch status: **acceptance incomplete**. Functional web, Next.js, and integrated collector checks pass; the performance budget and exact mock fidelity remain unresolved. Work is on `vuk88/dash-v2`; nothing was pushed. The coordinator requested this report here and will move reports out of the public repository at merge time.

## Changes

- Merged `main` first after preserving inherited dirty v2 screenshots/report in a stash. Merge commit: `c22e4cc`; inherited screenshot preservation: `c3ddee7`. The inherited report is preserved in ignored `web/artifacts/inherited-dash-v2.md` and the original stash remains.
- `web/packages/ui/src/charts/renderers.js` adapts the approved mock's SVG renderers without a chart library. `charts/index.tsx` adds responsive React wrappers, keyboard tooltips, hidden data tables, waiting states, histograms, band charts, rings, ranked bars, and all requested chart families. `index.ts` exports the primitives.
- `analytics-v3.tsx` implements Overview, Adoption, Tools and its drawer, Reliability, Cost, and Protocol against the analytics client. `dashboard.tsx` and `analytics.tsx` connect Sessions, its timeline drawer, Live, and the editable Settings cards while retaining existing account/key/setup behavior.
- `styles.css`, dashboard `shell.css`, and `main.tsx` add the v3 tokens, surfaces, navigation thumb, responsive grid, chart motion, count-ups, mobile table scrolling, and reduced-motion handling. Callers remains available by direct route.
- `analytics-types.ts`, `apps/dashboard/src/demo-analytics.ts`, analytics shape and QA scripts support the coordinator's amended histogram and percentile contract. Histogram edges contain 60 lower bounds plus a final null, with 60 counts; reliability method is a sibling of bucket and points. New fields are optional for collectors not yet shipping the parallel amendment.
- TypeScript configurations enable the mock-derived renderer module; ESLint has a narrow renderer exception. Browser, Next.js, regression, backend, visual, and performance probes exercise the new implementation.
- `backend-qa.mjs` verifies complete catalogue filtering, an advertised dead tool, a hallucinated call, and a separate no-catalogue project with called names visible. The scenario existed after the main merge; selectors and chart assertions now support v3.

## Side-by-side captures

[Open the full comparison gallery](dash-v3-comparison.html). It places approved reference and implementation captures next to one another, including both themes and widths. Missing reference drawer/mobile or Callers images are identified rather than invented.

| Screen | 1440 light | 1440 dark | 390 light | 390 dark |
|---|---|---|---|---|
| overview | [Compare](dash-v3-comparison.html#overview-1440-light) | [Compare](dash-v3-comparison.html#overview-1440-dark) | [Compare](dash-v3-comparison.html#overview-390-light) | [Compare](dash-v3-comparison.html#overview-390-dark) |
| adoption | [Compare](dash-v3-comparison.html#adoption-1440-light) | [Compare](dash-v3-comparison.html#adoption-1440-dark) | [Compare](dash-v3-comparison.html#adoption-390-light) | [Compare](dash-v3-comparison.html#adoption-390-dark) |
| tools | [Compare](dash-v3-comparison.html#tools-1440-light) | [Compare](dash-v3-comparison.html#tools-1440-dark) | [Compare](dash-v3-comparison.html#tools-390-light) | [Compare](dash-v3-comparison.html#tools-390-dark) |
| tool-drawer | [Compare](dash-v3-comparison.html#tool-drawer-1440-light) | [Compare](dash-v3-comparison.html#tool-drawer-1440-dark) | [Compare](dash-v3-comparison.html#tool-drawer-390-light) | [Compare](dash-v3-comparison.html#tool-drawer-390-dark) |
| reliability | [Compare](dash-v3-comparison.html#reliability-1440-light) | [Compare](dash-v3-comparison.html#reliability-1440-dark) | [Compare](dash-v3-comparison.html#reliability-390-light) | [Compare](dash-v3-comparison.html#reliability-390-dark) |
| sessions | [Compare](dash-v3-comparison.html#sessions-1440-light) | [Compare](dash-v3-comparison.html#sessions-1440-dark) | [Compare](dash-v3-comparison.html#sessions-390-light) | [Compare](dash-v3-comparison.html#sessions-390-dark) |
| session-drawer | [Compare](dash-v3-comparison.html#session-drawer-1440-light) | [Compare](dash-v3-comparison.html#session-drawer-1440-dark) | [Compare](dash-v3-comparison.html#session-drawer-390-light) | [Compare](dash-v3-comparison.html#session-drawer-390-dark) |
| cost | [Compare](dash-v3-comparison.html#cost-1440-light) | [Compare](dash-v3-comparison.html#cost-1440-dark) | [Compare](dash-v3-comparison.html#cost-390-light) | [Compare](dash-v3-comparison.html#cost-390-dark) |
| protocol | [Compare](dash-v3-comparison.html#protocol-1440-light) | [Compare](dash-v3-comparison.html#protocol-1440-dark) | [Compare](dash-v3-comparison.html#protocol-390-light) | [Compare](dash-v3-comparison.html#protocol-390-dark) |
| live | [Compare](dash-v3-comparison.html#live-1440-light) | [Compare](dash-v3-comparison.html#live-1440-dark) | [Compare](dash-v3-comparison.html#live-390-light) | [Compare](dash-v3-comparison.html#live-390-dark) |
| setup | [Compare](dash-v3-comparison.html#setup-1440-light) | [Compare](dash-v3-comparison.html#setup-1440-dark) | [Compare](dash-v3-comparison.html#setup-390-light) | [Compare](dash-v3-comparison.html#setup-390-dark) |
| settings | [Compare](dash-v3-comparison.html#settings-1440-light) | [Compare](dash-v3-comparison.html#settings-1440-dark) | [Compare](dash-v3-comparison.html#settings-390-light) | [Compare](dash-v3-comparison.html#settings-390-dark) |
| callers | [Compare](dash-v3-comparison.html#callers-1440-light) | [Compare](dash-v3-comparison.html#callers-1440-dark) | [Compare](dash-v3-comparison.html#callers-390-light) | [Compare](dash-v3-comparison.html#callers-390-dark) |

## Contract and design differences

- Coordinator explicitly approved retaining the shipping Python/Node/cURL Setup snippets: the mock's `withSignals(server)` API does not exist.
- Client stack colors/order follow the design notes (teal, gold, flame), which conflict with the mock's sample order. Axis ceilings are rounded upward to keep data within bounds; the mock's sample peak can exceed its top tick.
- The tool drawer uses a single-scale calls/errors stacked area rather than the sample's dual-axis composition, following the brief's one-scale rule. Session counts are honestly labeled “Open on this page”; no fabricated global count is shown. Sessions use retained real timeline events.
- Demo histograms use the amended 60-bin contract, with counts summing to calls, rather than the mock's 30 sample bins. Production latency charts wait when the optional fields are absent; the parallel collector amendment is needed to populate them.
- Exact visual parity is unfinished: some spacing, tile badges/number formatting, attention-row metadata, administrative controls, and content density differ. Adoption also retains its contract-derived funnel/cohort presentation. The gallery exposes these differences; they are not all approved deviations.
- The Chromium measurement over the full animation window remains above the required 100 ms. The final trace measured 136.069 ms. No threshold was relaxed, motion disabled, or passing result claimed. Further rendering/style work and a repeatable quiet benchmark are needed.

## Verification

Commands were run in this worktree, with Bun/Cargo on PATH. Selected final output is included below. Final web tests followed the UI refinements; the integrated harness preceded those final presentation-only refinements, so the real-backend browser suite was rerun against the final embedded build.

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
dist/assets/urbanist-latin-ext-wght-normal-Bdxck5Au.woff2          16.60 kB
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-CsDbzMu9.css                                     65.93 kB │ gzip:  13.17 kB
dist/assets/index-D1tOBpZj.js                                     338.70 kB │ gzip: 103.57 kB

✓ built in 315ms
```

```sh
cd web && SIGNALS_NEXT_PORT=23332 PLAYWRIGHT_CHANNEL=chromium bun run test:next
```
```text
▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23332
- Network:       http://127.0.0.1:23332
✓ Ready in 63ms
✓ Running next.config.mjs took 8ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium SIGNALS_TEST_UI_PORT=23334 SIGNALS_R2_PORT=23335 bun run test
```
```text
review-r2 probe passed

  VITE v8.3.2  ready in 94 ms

  ➜  Local:   http://127.0.0.1:23334/
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

```sh
cargo build --locked --bin signals
```
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.18s
```

```sh
cd web && SIGNALS_URL=http://127.0.0.1:25472 PLAYWRIGHT_CHANNEL=chromium TMPDIR=/home/vuk/orca/workspaces/signals-collector/dash-v2/t bun run qa:backend
```
```text
$ bun scripts/backend-qa.mjs
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v3 analytics, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
```

```sh
cd web && BASE_URL=http://127.0.0.1:23333 bun scripts/performance-qa.mjs
```
```text
       diff: "simple",
       code: "ERR_ASSERTION"

      at /home/vuk/orca/workspaces/signals-collector/dash-v2/web/scripts/performance-qa.mjs:33:2

Bun v1.4.2 (Linux x64)
```

Integrated run (exit 0): ports were checked with `ss -ltn`; Postgres was a dedicated `dash-v3-qa-pg` container running `postgres:18.6-bookworm` with `--shm-size=1g` and host port 25471. A local executable psql shim stripped DATABASE_URL and invoked `docker exec -i dash-v3-qa-pg psql -U postgres -d signals`. TMPDIR used a short on-disk path to fit Chromium's Unix socket limit.

```sh
PATH="$PWD/target/v3-bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" \
TMPDIR="$PWD/t" DATABASE_URL=postgres://postgres:signals@127.0.0.1:25471/signals \
ANALYTICS_PG_CONTAINER=dash-v3-qa-pg SIGNALS_URL=http://127.0.0.1:25472 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:25473 ANALYTICS_REVIEW_PROBE_PORT=25474 \
SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium \
python3 scripts/ci-conformance.py
```
```text
  }
]
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

The trace and measured result are committed at [tab-switch-trace.json](../web/artifacts/v3/tab-switch-trace.json) and [performance.json](../web/artifacts/v3/performance.json). Screenshot rerun verification and final cleanup are recorded below.

A later visual-only run against the Vite development server timed out while a simultaneous UI-package check rebuilt its watched files. The completed full suite above predates that isolated rerun. Final screenshot determinism is tested serially against the built demo served at port 23333, avoiding development-server reloads.

```sh
cd web
bun run check
# exit 0; build:ui, tsc --noEmit, eslint
BASE_URL=http://127.0.0.1:23333 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
# run twice serially; compare SHA-256 for all 64 PNGs
```

Comparison HTML link validation found 92 image references and zero missing files. Temporary collector/Vite processes and the dedicated `dash-v3-qa-pg` container were stopped, the container removed, and `target/` deleted. The static screenshot server is retained only until the final rerun finishes.

Final static visual result (both serial runs exited 0):

```text
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
Changed []
```

All **64/64 screenshots were byte-identical** on the final rerun; [determinism.json](../web/artifacts/v3/determinism.json) records the result. Both themes, both widths, every screen and both drawers are committed. The static screenshot server was then stopped and the on-disk temporary directory removed.

Implementation commits: `988d5d7` and `38a595d` after the main merge and inherited-artifact preservation. Remaining acceptance work is the sub-100 ms performance target and the exact design differences listed above; this dispatch reports **failed**, despite the passing functional and integrated suites.

Final cleanup verification:

```sh
git status --porcelain
# no output
test ! -e target
# exit 0
ss -ltn | grep -E ':23331|:23333|:25471|:25472'
# no matching listeners
```


## Round 1 fixes

Merged current main first (`f591a5d`), including the collector latency detail amendment. The coordinator corrected two brief ambiguities: `latency_over_time` is the contract object, not an array; overview sparkline length must equal the number of time buckets in the requested window and the reliability series length, not the sparse client-call series length. Those rules are asserted against ingested backend data.

Changes by file: `analytics-v3.tsx` replaces Adoption/Cost/Protocol layouts and clamps count-up progress; `dashboard.tsx` replaces Live area/donut with two sparklines and bars; `charts/index.tsx` provides conversion, series colours, marker filtering, accessible scroll regions and viewport-triggered SVG creation; `charts/renderers.js` preserves null gaps and avoids geometry reads for path normalization; `styles.css`/`shell.css` fix dashboard-specific contrast, wrapping, scrolling, compositor-friendly motion and lamp rings; `demo-analytics.ts` caches derived route data with settings/rules invalidation; `backend-qa.mjs` checks actual latency shapes/counts/window buckets and rendered charts; `visual-qa.mjs` checks the approved chart inventory and shares the reviewer's contrast/clip measurement in `contrast-clip.mjs`; the regression and reviewer probes now inspect the visible data tables and scroll lazy charts into view.

Profiling before changes used the Chromium timeline and CDP CPU profiler (the performance script now accepts `--cpu-profile`). The first profiled run reported 125.75 ms; style recalculation accounted for 37.75 ms, layout 10.49 ms, and paint 13.42 ms. No threshold was raised and motion remains enabled in the performance test. Below-fold SVG work now waits for IntersectionObserver visibility, demo route results are cached, synchronous path-length reads are replaced by normalized SVG path lengths, and area/donut/sparkline entrance motion uses composited HTML layers instead of repeatedly painting SVG geometry. Count-ups start at zero and clamp the rAF timestamp before easing.

Cost has no time-series field in the contract. Its estimated sparkline uses each tool's per-bucket call counts multiplied by that tool's measured estimated tokens per call, as the Overview estimate already did; this is an estimate, not exact per-bucket token accounting. Missing WAU/MAU trend values remain waiting states; unsupported retention trend values are not fabricated. The coordinator's previous Setup exception remains in force.

Final verification results and one observed result per blocker follow below.

| Blocker | Verification command | Observed result |
|---|---|---|
| 1 Performance | `cd web && BASE_URL=http://127.0.0.1:26331 bun scripts/performance-qa.mjs`; repeat with `PERFORMANCE_SCREEN=tools` | Adoption **95.88 ms**, Tools **90.39 ms**, both under the unchanged 100 ms assertion. |
| 2 Histogram markers | `PRODUCT_URL=http://127.0.0.1:26331 bun reports/review-r1/fidelity.mjs` and visual QA | Exactly **3** labels: p50 180, p95 640, p99 2,100; no NaN or extra metadata markers. Maximum marker x-position rounding difference **0.7 px**. |
| 3 Adoption | Same fidelity command; `BASE_URL=http://127.0.0.1:26331 bun scripts/visual-qa.mjs` | **6** approved tiles; stacked area, identity donut, client table, **2** bar charts and conversion line; no funnel or heatmap. |
| 4 Cost | Same fidelity and visual commands | **6** approved tiles, **1** token sparkline, treemap and **2** bar charts; title “Where the context goes”; Input chart-3 / Output chart-1. |
| 5 Protocol | Same fidelity/visual commands and `PRODUCT_URL=http://127.0.0.1:26331 bun reports/review-r1/countup.mjs` | **6** tiles, **2** dot grids, client chart-1 / server chart-3; null feature states retained. |
| 6 Live | Same fidelity/visual commands | **2** sparklines and **1** bar chart; 40-second rate window, 72px sparklines, and **2** expanding lamp rings (2.4s cycle); reduced-motion animations empty. |
| 7 Contrast | Same fidelity command with shared `contrastAndClip` measurement | **0** failing contrast pairs over both themes and both widths, excluding hidden table twins and the unfocused off-screen skip link. |
| 8 Clipping | Same fidelity command; visual QA invokes the same measurement | **0** visible clips and **0** page overflow cases; wide tables, Sankey and Gantt scroll inside their cards. |

The count-up probe sampled `0, 0, 21.7K, …, 48.2K` and asserted non-negative, monotone values. The source no longer permits a negative rAF delta or an initial final-value flash. The fidelity run's separate Tools trace was 111.764 ms while other browser tests were running; the dedicated, serial performance commands above passed without changing their budget or motion settings. First-paint work in that fidelity run was 29.329 ms (previous review: 74.072 ms).

The updated browser QA also directly checks per-tool histogram counts against call counts, 61 edges ending in null, 60 bins, populated latency band points, and overview sparkline length against both the requested window and reliability series. It opens the real tool drawer and asserts its histogram, and checks the real Overview sparkline and Reliability band. Earlier failures during development were a sparse-client-series length comparison (corrected per coordinator ruling) and an ambiguous Cost bar-table selector (narrowed to Tenant share).


Screenshot determinism initially exposed stale widths from card-level `content-visibility`. That shortcut was removed; SVG creation and card entry animations are instead triggered by IntersectionObserver. SVGs now have view boxes, and the mobile ribbon wrapper occupies the full chart grid row. Visual captures scroll lazy charts into view, wait for fonts and animation frames, and reset drawer/table/window scroll positions before capture. The baseline CPU profile is [tab-switch-before.cpuprofile](../web/artifacts/v3/tab-switch-before.cpuprofile); final budget traces are the committed default and Tools trace files.

The Live browser assertion was also made unambiguous: it waits for the newly ingested event ID in its event row, rather than a tool name already present in the batch. Both the standalone real-backend suite and a fresh full harness run use this stronger assertion.

### Round 1 final commands and observed output

The integrated harness exited 0, including the stricter Live event-ID assertion and all new latency assertions. It ran before the final chart-width-only refinement; the final embedded UI was then rebuilt and the same real-backend browser suite rerun successfully against a separate database. Web checks, browser/Next tests, fidelity and the two static capture runs below cover the final rendering changes.

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
dist/assets/index-tYU5kOSR.css                                     68.76 kB │ gzip:  13.68 kB
dist/assets/index-CXdaKMQg.js                                     343.44 kB │ gzip: 104.75 kB

✓ built in 211ms
```

```sh
cd web && SIGNALS_TEST_UI_PORT=26351 R2_PORT=26352 PLAYWRIGHT_CHANNEL=chromium bun run test
```
```text
review-r2 probe passed

  VITE v8.3.2  ready in 92 ms

  ➜  Local:   http://127.0.0.1:26351/
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

```sh
cd web && SIGNALS_NEXT_PORT=26353 PLAYWRIGHT_CHANNEL=chromium bun run test:next
```
```text
- Network:       http://127.0.0.1:26353
✓ Ready in 56ms
✓ Running next.config.mjs took 11ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

```sh
cargo build --locked --bin signals
```
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.12s
```

```sh
cd web && SIGNALS_URL=http://127.0.0.1:26345 PLAYWRIGHT_CHANNEL=chromium TMPDIR=/home/vuk/orca/workspaces/signals-collector/dash-v2/t-r1 bun run qa:backend
```
```text
$ bun scripts/backend-qa.mjs
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v3 analytics, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
```

```sh
cd web && BASE_URL=http://127.0.0.1:26331 bun scripts/performance-qa.mjs
```
```text
Chromium tab switch main-thread work: 95.88 ms (budget < 100 ms)
```

```sh
cd web && PERFORMANCE_SCREEN=tools BASE_URL=http://127.0.0.1:26331 bun scripts/performance-qa.mjs
```
```text
Chromium tab switch main-thread work: 90.39 ms (budget < 100 ms)
```

```sh
cd web && PERFORMANCE_THEME=dark BASE_URL=http://127.0.0.1:26331 bun scripts/performance-qa.mjs
```
```text
Chromium tab switch main-thread work: 95.56 ms (budget < 100 ms)
```

```sh
cd web && PERFORMANCE_THEME=dark PERFORMANCE_SCREEN=tools BASE_URL=http://127.0.0.1:26331 bun scripts/performance-qa.mjs
```
```text
Chromium tab switch main-thread work: 86.47 ms (budget < 100 ms)
```

```sh
# Ports checked with ss -ltn before starting services.
# Dedicated postgres:18.6-bookworm container dash-v3-fix-r1-pg:
# --shm-size=1g -p 127.0.0.1:26341:5432
# target/r1-bin/psql strips DATABASE_URL and delegates to:
# docker exec -i dash-v3-fix-r1-pg psql -U postgres -d signals
PATH="$PWD/target/r1-bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH" \
TMPDIR="$PWD/t-r1" DATABASE_URL=postgres://postgres:signals@127.0.0.1:26341/signals \
ANALYTICS_PG_CONTAINER=dash-v3-fix-r1-pg SIGNALS_URL=http://127.0.0.1:26342 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:26343 ANALYTICS_REVIEW_PROBE_PORT=26344 \
SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium \
python3 scripts/ci-conformance.py
```
```text
  }
]
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

```sh
PRODUCT_URL=http://127.0.0.1:26331 PLAYWRIGHT_CHANNEL=chromium bun reports/review-r1/fidelity.mjs
PRODUCT_URL=http://127.0.0.1:26331 bun reports/review-r1/countup.mjs
```
```text
Contrast failures: 0; visible clips: 0; page overflows: 0
Monotone/non-negative count-up assertion passed; reduced-motion running animations: []
[
  {
    pseudo: "::before",
    name: "ring",
    duration: "2.4s",
    delay: "0s",
  }, {
    pseudo: "::after",
    name: "ring",
    duration: "2.4s",
    delay: "1.2s",
  }
]
```

```sh
cd web
BASE_URL=http://127.0.0.1:26331 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
# Repeated serially; SHA-256 comparison of all artifacts/v3/*.png.
```
```text
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
Deterministic screenshots: 64 changed: []
```

All 64 captures, including both callers-390 files, were committed at `a8099a6` before the rerun finished. The rerun left those PNGs unchanged. The four standalone performance checks passed: light Adoption 95.88 ms / Tools 90.39 ms, dark Adoption 95.56 ms / Tools 86.47 ms. No Round 1 blocker or should-fix remains open. Final cleanup and clean-status verification are recorded below.

Final cleanup completed: the dedicated Postgres container and its anonymous volume were removed; all task listeners on 26331, 26341–26345 and 26351–26353 are gone; `target/`, `t-r1/`, the temporary static build and capture baseline directories were deleted. Only durable reports, traces and screenshots are committed; nothing was pushed.

```sh
git diff --exit-code -- web/artifacts/v3/*.png
# exit 0 after the second static run
test ! -e target && test ! -e t-r1
# exit 0
ss -ltn | grep -E ':26331|:2634[1-5]|:2635[1-3]'
# no matching listeners
docker stop dash-v3-fix-r1-pg
docker rm -v dash-v3-fix-r1-pg
# both returned the container name successfully
```

```sh
git status --porcelain
# no output after the evidence commit
```


## Round 2 fixes

Main (`d8f6123`) was already an ancestor of this worktree; `git merge main` returned `Already up to date.` No API or backend contract changed.

### Cause and implementation

The independent baseline retention probe reproduced the reported pattern: returning to Overview cost 151.539 ms, including 72.784 ms of style recalculation; GC reduced 9,515 nodes to 1,359. This was collectible detached DOM, not evidence of a permanent leak. Explicit listener/observer cleanup alone did not remove the cost. Isolating tile/card entrances reduced a ten-step walk to 33–84 ms, identifying repeated entrance animation work as the major amplification of the session's growing pending-GC state.

- `web/packages/ui/src/charts/index.tsx`: chart lifecycle uses layout-effect cleanup, disconnects both observers, cancels both pending animation frames, detaches renderer handlers before redraw/unmount, rejects disposed paints, and empties its imperative SVG host before removal. Redrawing cancels the previous reveal frame.
- `web/packages/ui/src/charts/renderers.js`: stacked-area pointer handlers now return an explicit remover, breaking the SVG/crosshair/tooltip closure cycle on redraw and unmount.
- `web/packages/ui/src/analytics-v3.tsx`: component-owned entrance handles are cancelled on unmount; only visible cards animate. Six separate tile entrances become one row entrance. Count-up updates reuse their Text node rather than creating a new node each tick.
- `web/apps/dashboard/src/main.tsx`: the font-ready continuation cannot schedule a navigation animation frame after cleanup.
- `web/packages/ui/src/styles.css`: dark success pills use lighter teal ink, preserving their background tint; tile labels wrap below 360 px. Nested chart entry durations are bounded.
- `web/scripts/performance-qa.mjs`: retains the single-switch instrument and adds `--walk` with the exact ten transitions, three sessions, 750 ms measured settling, CDP input, tracing, and an assertion for **every** switch at the unchanged 100 ms budget. `PERFORMANCE_REPEATS` additionally allows repeated fresh contexts; dark theme is explicitly stored.
- `web/scripts/visual-qa.mjs`: the shared contrast/clip scan now covers both drawers and the existing 320 px screen pass, including an explicit complete tile-label assertion.

Motion tuning is a deliberate design timing difference: tile rows and visible cards retain fade/lift but enter in 180 ms (cards delayed 40 ms), instead of independent 520 ms tile/card entrances and their stagger; chart layers enter in 240–320 ms and count-up completes in 400 ms. The live lamp remains 2.4 seconds, and reduced motion skips component-owned animations. These changes preserve the rendered layout, chart kinds, data, and interactions while giving the performance gate margin.

Pending-GC node/listener counters still grow between collections, so this report does not claim those counters are constant. The final retention probe measures 9.791 ms style work on Adoption and 14.647 ms on the return to Overview (78.494 ms total); its post-GC Adoption switch is 55.405 ms, and a second GC returns to 973 nodes / 879 layout objects / 181 listeners. No production forced GC, benchmark-only motion behavior, or budget relaxation was introduced.

### Performance evidence

Fifteen separate serial invocations of the single-switch command passed: median **65.704 ms**, maximum **81.998 ms**, 0 failures. `reports/review-r2/single-serial.json` records every invocation; `web/artifacts/v3/performance.json` is the final single invocation. An earlier exploratory batch reused one browser across 15 contexts and had one 130.38 ms outlier; it is not the claimed 15-process acceptance run.

The committed `web/artifacts/v3/performance-walk.json` records all 30 assertions with tracing enabled:

| Transition | Run 1 ms | Run 2 ms | Run 3 ms |
|---|---:|---:|---:|
| overview → adoption | 67.837 | 61.601 | 91.278 |
| adoption → tools | 69.384 | 68.221 | 74.758 |
| tools → reliability | 71.016 | 63.421 | 72.392 |
| reliability → sessions | 60.275 | 69.095 | 94.278 |
| sessions → cost | 64.050 | 56.274 | 70.336 |
| cost → protocol | 52.862 | 56.934 | 67.078 |
| protocol → live | 52.670 | 47.492 | 57.360 |
| live → overview | 68.801 | 74.468 | 74.422 |
| overview → adoption | 61.443 | 71.272 | 61.106 |
| adoption → reliability | 56.317 | 78.229 | 69.771 |

Independent reviewer probes: `perf-sequence.mjs 3` reports `over budget: 0 of 30`; `perf-retention.mjs` has no walk or post-GC switch over 100 ms; `drawer-contrast.mjs` reports `failures: 0 clipped: 0`; `variants.mjs` reports 0 contrast failures, 0 clips, 0 overflow, and no negative count-up frames. An independent numeric check of its captured Overview (45 frames) and Adoption (48 frames) series also confirmed all six tiles nonnegative and monotone. Its additional five fresh-screen performance variants also pass (maximum 81.216 ms).

### Verification commands and final results

All commands below ran in this worktree; `bun` was resolved from `$HOME/.bun/bin` and Cargo from `$HOME/.cargo/bin`. Browser runs used Chromium. Final static assets matched the performance bundle (`index-BB9Gtj0K.css`, `index-DJIeRmm6.js`).

| Command | Result / last output |
|---|---|
| `git merge main` | `Already up to date.` |
| `cd web && bun run check` | Exit 0; `bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs` (type and lint checks passed). |
| `cd web && bun run build` | Exit 0; `dist/assets/index-DF4i3wFq.js 344.02 kB`; `✓ built in 188ms`. |
| `cd web && SIGNALS_TEST_UI_PORT=26451 R2_PORT=26452 PLAYWRIGHT_CHANNEL=chromium bun run test` | Exit 0; `review-r1 probe passed`, `review-r2 probe passed`, then the Visual QA line below. |
| `cd web && SIGNALS_NEXT_PORT=26453 PLAYWRIGHT_CHANNEL=chromium bun run test:next` | Exit 0; `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` |
| `cd web && BASE_URL=http://127.0.0.1:26431 bun scripts/performance-qa.mjs` (15 separate serial invocations from a Python subprocess loop) | All exit 0; median 65.704, maximum 81.998 ms; last invocation `Run 1 overview → adoption: 62.91 ms (budget < 100 ms)`. |
| `cd web && BASE_URL=http://127.0.0.1:26431 bun scripts/performance-qa.mjs --walk` | Exit 0; 30/30 below 100 ms, maximum 94.278 ms; full table above. |
| `PRODUCT_URL=http://127.0.0.1:26431 bun reports/review-r2/perf-sequence.mjs 3` | `over budget: 0 of 30`. |
| `PRODUCT_URL=http://127.0.0.1:26431 bun reports/review-r2/perf-retention.mjs` | Walk maximum 78.494 ms; post-GC switch 55.405 ms; final counters `Nodes: 973, LayoutObjects: 879, JSEventListeners: 181, liveDom: 578`. |
| `PRODUCT_URL=http://127.0.0.1:26431 PLAYWRIGHT_CHANNEL=chromium bun reports/review-r2/drawer-contrast.mjs` | `failures: 0 clipped: 0`. |
| `PRODUCT_URL=http://127.0.0.1:26431 PLAYWRIGHT_CHANNEL=chromium bun reports/review-r2/variants.mjs` | `contrastFailures: 0`, `clipped: 0`, `overflow: []`, `negativeCountUpFrames: []`; wrote `reports/review-r2/variants.json`. |
| Python numeric assertions over `variants.json` count-up frames (parse K/M/B multipliers, assert nonnegative and sorted per tile) | `overview 45 frames × 6 tiles: nonnegative and monotone`; `adoption 48 frames × 6 tiles: nonnegative and monotone`. |
| `cargo build --locked --bin signals` | `Finished dev profile [unoptimized + debuginfo] target(s) in 56.02s`. |
| `docker run -d --name dash-v3-fix-r2-pg --shm-size=1g -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals -p 127.0.0.1:26441:5432 postgres:18.6-bookworm` then `docker exec dash-v3-fix-r2-pg pg_isready -U postgres` | Created dedicated container; `/var/run/postgresql:5432 - accepting connections`. |
| `DATABASE_URL=postgres://postgres:signals@127.0.0.1:26441/signals target/debug/signals migrate` | Exit 0 (no output). |

Final browser suite output:

```text
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

The first overlapping browser/Next-host run was interrupted by Vite hot reload when the Next-host helper rebuilt the UI package. The final browser suite ran after that build completed and passed. An initial lint failure from bare `localStorage` in the performance script was corrected to `globalThis.localStorage` before the passing check/build.

Static screenshots were generated with the documented commands:

```sh
cd web
VITE_DEMO=1 bun --bun vite build --config apps/dashboard/vite.config.ts --outDir ../../artifacts/v3-demo
# From repository root, separate terminal:
python3 -m http.server 26431 --bind 127.0.0.1 --directory web/artifacts/v3-demo
# From web/, three serial invocations, with SHA-256 captured after each:
BASE_URL=http://127.0.0.1:26431 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
```

All three capture suites passed. The first comparison had one mismatch (`overview-1440-light.png`); the second capture matched that image's original committed baseline. The final consecutive pair (runs 2 and 3) was byte-identical: `Final two serial static captures: 64 PNGs; 0 changed`. Both hash comparisons are retained in `reports/review-r2/determinism-initial.json` and `determinism.json`; the earlier mismatch was not discarded or attributed to an unproven cause. Four committed PNGs changed overall: both dark session drawers and both dark Settings screens, reflecting the success-pill ink fix. `git status --porcelain -- web/artifacts/v3` returned no output after the final capture.

The integrated harness used an on-disk TMPDIR and a psql shim at `target/r2-bin/psql` that strips its leading DATABASE_URL argument and executes `docker exec -i dash-v3-fix-r2-pg psql -U postgres -d signals`:

```sh
PATH="$PWD/target/r2-bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH" \
TMPDIR="$PWD/t-r2" \
DATABASE_URL=postgres://postgres:signals@127.0.0.1:26441/signals \
ANALYTICS_PG_CONTAINER=dash-v3-fix-r2-pg \
SIGNALS_URL=http://127.0.0.1:26442 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:26443 \
ANALYTICS_REVIEW_PROBE_PORT=26444 \
SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium \
python3 scripts/ci-conformance.py
```

The integrated command exited 0. Its pass lines and final output were:

```text
identity: 52/52 valid fixtures matched
identity: 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched
gzip: 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Backend browser QA passed: real v3 analytics, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
Finished `release` profile [optimized] target(s) in 1m 33s
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

The dedicated container was stopped and removed with `docker stop dash-v3-fix-r2-pg && docker rm dash-v3-fix-r2-pg`; both commands printed its name. The owned static HTTP server was terminated, and Python `shutil.rmtree` removed this worktree's `target/`, `t-r2/`, and temporary static demo directory. No other worker's services, data, or pre-existing dependency caches were removed. No requested fix remains; the evidence limitations and motion timing difference are stated above. Final `git diff --check` and clean status are checked after committing this report; nothing is pushed.
