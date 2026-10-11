# Dashboard v3 review, round 1

VERDICT: changes required

Reviewed `web/` on `vuk88/dash-v2` at `34777aa`, against the approved mock `briefs/v3/dashboard-v3.html`, the design notes, `briefs/v3/dash-v3-implement.md`, and `reports/dash-v3.md`. Product source was not edited.

## Blockers

### 1. A tab switch stays over 100 ms of main-thread work

Command:

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:26110 bun scripts/performance-qa.mjs
```

Observed: `Chromium tab switch main-thread work: 144.43 ms (budget < 100 ms)` and `AssertionError: Tab switch exceeded 100 ms: 144.427` (`PERF_EXIT:1`). An independent Chromium trace in `reports/review-r1/fidelity.mjs` (overview to tools) recorded `TaskDuration` 170.284 ms. First paint on the same trace was 74.072 ms.

Expected: under 100 ms. The implement brief says "a tab switch stays under 100 ms of main-thread work on the demo data."

The author's committed `web/artifacts/v3/performance.json` is 136.069 ms on overview to adoption, and `reports/dash-v3.md` reports that miss. The failure claim survives. The acceptance item is still missing, so this remains a blocker. This review's `performance-qa.mjs` run was restored with `git checkout` so the committed 136.069 artifact is unchanged.

### 2. The tools latency histogram draws extra markers, including visible "NaN"

Command: `PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26110 bun reports/review-r1/fidelity.mjs` against `VITE_DEMO=1`. Shot: `reports/review-r1/shots/product-tools-1440-light.png`.

Observed marker labels on the Tools histogram: `p50 180` (x 187.9, expected 187.5, delta 0.4 px), `prev_p95 610` (delta 0.6), `p95 640` (delta 0.6), `p99 2,100` (delta 0.7), `method NaN`, `sparkline NaN`. The table twin is the 60 bins (`Lower ms`, `Upper ms`, `Calls`) and does not contain those pills.

`Tools` passes `markers={o.tiles.latency}` (`web/packages/ui/src/analytics-v3.tsx`). `Histogram` keeps every non-null field (`web/packages/ui/src/charts/index.tsx`), and `latencyHist` labels every entry (`web/packages/ui/src/charts/renderers.js`). `method` is the string `"histogram"` and `sparkline` is an array, so `Math.log` of those values is NaN.

Expected: the mock calls `latencyHist({ buckets: LAT_HIST, markers: { p50: 180, p95: 640, p99: 2100 } })`. Review check 2 requires p50/p95/p99 at the right x and a table twin that matches the drawn numbers. The three percentiles land on the log scale. The other three pills are a different chart, and the NaN pills disagree with the table.

The 60 bars match the contract histogram: 60 bins, and the bin with count 5,680 is 147.7 px, the expected height. That part is fine. The marker set is the defect.

### 3. Adoption does not use the mock's charts or tiles

Same fidelity probe, 1440 light, plus `reports/review-r1/shots/product-adoption-1440-light.png`. Mock authority is `screenAdoption()` in `dashboard-v3.html` (the probe's mock DOM inventory accumulates previous tabs and is not used).

Observed product: tiles DAU, WAU, MAU, D1 retention, D7 retention, D30 retention. Charts: three tile sparklines, a stacked area, a donut labelled "DAU / WAU / MAU" (the stickiness rings), grouped bars for "Identity quality" (`data-chart="histogram"`), grouped bars for "Transport and protocol", a funnel, and a weekly heatmap.

The mock's adoption screen is: tiles DAU, WAU, MAU, Stickiness, New users, D7 retention; a stacked area; an identity-quality donut (`ad-idq`, centre "75% / strong identity"); a client share table; transport and protocol-version bars; a conversion curve (`ad-conv`). It has no weekly heatmap and no funnel on this screen.

Expected: the same charts and the same tile set. Notes section 8 does not replace the donut or the curve. The implement brief says "Match them: same layout, same charts, same motion, same copy." Review check 1 makes a missing or differently drawn chart a blocker. The author report already says adoption "retains its contract-derived funnel/cohort presentation" and that the gallery diffs "are not all approved deviations."

### 4. Cost is missing its sparkline, three tiles, the mock title, and the payload colours

Same probe. `geometry.cost.sparks` is 0. Tiles are Context tokens, Per call, and Tools. The focal title is "Context by tool". Payload series fills are `var(--chart-1)` and `var(--chart-2)`. Shot: `reports/review-r1/shots/product-cost-1440-light.png`.

The mock (`screenCost`) has six tiles (Context tokens with spark `co-spark`, Per call, Heaviest tool, Tenants, Largest payload, Billing period), the title "Where the context goes", and a payload legend of Input `var(--chart-3)` and Output `var(--chart-1)`.

`Cost` in `analytics-v3.tsx` passes no `values` into the tiles, so no spark is drawn. Review check 1: a missing sparkline is a missing chart. The client-stack colour exception in the design notes is the teal, gold, flame order for Cursor, Claude, and ChatGPT. It does not recolour this payload series.

The treemap and the tenant bars themselves match the demo numbers. See Verified claims.

### 5. Protocol has no tiles, and server dots use the client colour

Same probe, plus `bun reports/review-r1/countup.mjs`. Shot: `reports/review-r1/shots/product-protocol-1440-light.png`.

Observed: zero tiles. Two dot grids. Both on-dots use `fill="var(--chart-1)"`, computed `oklch(0.8 0.155 80)`. Client off-dots use `var(--viz-track)`. Server circles in that sample were all `var(--chart-1)` (150 of 150). `DotGrid` in `charts/index.tsx` hardcodes `var(--chart-1)` for every filled dot.

The mock (`screenProtocol`) has six tiles (Sessions, Client capabilities, Server capabilities, Sampling, Elicitation, Tasks) and a legend of client `var(--chart-1)` and server `var(--chart-3)`. Server dots use class `s`, which is `--chart-3`.

The design notes say a series keeps its colour on every screen, and `--chart-3` is the teal series. Review check 1. The empty states for Sampling, Elicitation, Tasks, and Progress are present ("No data yet" / "Waiting for … SDK events") and are not part of this defect.

### 6. Live draws an area and a donut, and the lamp emits no rings

Same fidelity probe. Shot: `reports/review-r1/shots/product-live-1440-light.png`.

Observed charts: an area labelled "Live event rate" and a donut labelled "Live event mix", plus one tile, "Recent errors". `LiveScreen` in `web/packages/ui/src/dashboard.tsx` renders those two charts. The live lamp is `<i className="signal-dot"/>` in `web/apps/dashboard/src/main.tsx`. Computed animation is `lamp`, 2.4s, infinite. `::before` animation-name is `none`. `@keyframes lamp` changes opacity and box-shadow. The mock's `.lamp::before` / `.lamp::after` `@keyframes ring` rules in `styles.css` are not applied to `.signal-dot`.

The mock (`screenLive`) is an event-rate sparkline (`lv-rate`), event-mix bars, an error sparkline (`lv-err`), and a `.lamp` with two expanding rings. Notes row 26 is "Event-rate sparkline + breathing lamp". Review check 1 treats the missing sparkline, the missing bars, and the missing rings as a blocker. Reduced motion does turn the dot off (see Verified claims).

### 7. Text on muted surfaces is below 4.5:1

Same fidelity probe. `contrastAndClip` composites each element's colour over the opaque ancestor background on a canvas and applies the WCAG relative-luminance ratio. It skips `.sr-only`, `aria-hidden`, `display: none`, `visibility: hidden`, and opacity 0. Both themes, 1440 and 390. 169 hits, 38 unique pairs, all under 4.5.

The pairs a person can see:

- Dark `oklch(0.45 0.02 70)` at 10.5px: "SIGNALS / northwind" 2.51, "Current window" 2.29 and 2.51, delta chips ("▲ 8.1% vs prior" and the sibling chips) 2.29 to 2.51. Same token at 12px: "0% of budget left", "39.4% of budget left", and the "Waiting for …" captions at 2.29.
- Light `oklch(0.66 0.02 72)`: the same copy at 2.55 to 2.77.
- Light `oklch(0.62 0.2 34)` at 10.5px: the "Error" pill and the Settings "firing" pill at 3.10.
- One dark sessions glyph "1" at 13.5px measured 4.49.

Expected: review check 5, contrast of text on every surface at least 4.5:1. These are the eyebrow, chip, note, and empty-state colours on both themes.

The probe also recorded "Skip to content" at 1.39 in dark. That link is `position: fixed; top: -80px` until focus (`shell.css`), so it is off-screen and is not part of this finding.

### 8. Card text is clipped at 1440 and at 390

Same probe. An element counts when it is inside `#main`, is not inside `.table-scroll`, `pre`, `.copy-block`, or `.sr-only`, has `overflow-x` of `hidden` or `clip` or `text-overflow: ellipsis`, and `scrollWidth > clientWidth + 2`. `documentElement` never overflowed the viewport (the overflow list is empty at 1440 and 390, both themes), so the page itself does not scroll sideways.

Visible clips, both themes:

- Tools, 1440 and 390: "cancel_booking · refund · archive_order", scrollWidth 201 against 157 (1440) and 144 (390). The 1440 light shot ellipsizes this line.
- Tools, 390: "same tool, same session, < 30 s", 157 against 144.
- Tools, 390: the histogram label strip, 383 against 328, including `prev_p95` and the NaN pills.
- Tools, 390: sankey names "search_products get_product add_to_cart …", 480 against 328.
- Reliability, 1440 and 390: "6,480 attempts · waiting for init outcomes", 210 against 157 / 144, and "waiting for unknown-tool events", 163 against 157 / 144.
- Sessions, 390: the gantt, 501 against 328, and the heading "The story of a connection …", 789 against 356.
- Settings, 390: "Project keys …", 513 against 356.

Rows whose `innerText` is a chart plus its hidden table ("Tool success trend BUCKET VALUE …", and the 390 axis dumps that continue into "DATE …") are the sr-only twin widening an `overflow: hidden` figure. Those are left out of this finding.

Expected: review check 5, no clipped text. The design notes say a wide table scrolls inside the card. These nodes are not inside `.table-scroll`.

## Should-fix

### 1. The tool-calls count-up paints "-1.2K" on the way to 48.2K

Command: `bun reports/review-r1/countup.mjs` against the demo server, sampling `.tile__value strong` every 40 ms from `waitUntil: 'commit'`.

Observed, one poll: `48.2K`, `-1.2K`, `12.6K`, `23.5K`, `23.5K`, `32K`, `38.2K`, `38.2K`, `42.6K`, `42.6K`, `45.5K`, `47.2K`, `47.2K`, `48K`, `48.2K`, `48.2K`.

The count-up does run (about 640 ms, inside the 700 ms budget). A single frame shows a negative compact value before the climb. The implement brief asks for count-ups with tabular numerals. A negative flash on the headline tile will be seen.

### 2. Visual QA encodes the product's chart kinds, so the mismatches above stay green

`web/scripts/visual-qa.mjs` expects `adoption: ['stacked-area','donut','histogram','funnel','heatmap']`, `cost: ['treemap','bars','histogram']`, `live: ['area','donut']`, and `protocol: ['dot-grid']`. Grouped bars satisfy `histogram`, and the stickiness rings satisfy `donut`. Both serial static runs printed `Visual QA passed` (see Verified claims) while blockers 3 through 6 were on screen. That pass does not check the mock's chart kinds. This is a verification gap.

## Verified claims

Author report `reports/dash-v3.md`. Each claim was re-run in this worktree. Ports were above 20000. Postgres was `postgres:18.6-bookworm` with `--shm-size=1g`, container `dash-v3-r1-pg`, host `127.0.0.1:26120`. The container was removed after the run.

- `cd web && bun run check` — pass, `CHECK_EXIT:0` (`/tmp/r1-web-suites.log`).
- `cd web && bun run build` — pass. `dist/assets/index-CsDbzMu9.css` 65.93 kB and `dist/assets/index-D1tOBpZj.js` 338.70 kB, built in 192 ms. Hashes match the author report (`/tmp/r1-web-build.log`).
- `cd web && PLAYWRIGHT_CHANNEL=chromium SIGNALS_TEST_UI_PORT=26140 SIGNALS_R2_PORT=26141 bun run test` — pass, `TEST_EXIT:0`. The log includes `review-r1 probe passed`, `review-r2 probe passed`, and `Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.`
- `cd web && SIGNALS_NEXT_PORT=26150 PLAYWRIGHT_CHANNEL=chromium bun run test:next` — pass, `NEXT_EXIT:0`. `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.`
- `python3 scripts/ci-conformance.py` with `TMPDIR=$PWD/t-r1`, `DATABASE_URL=postgres://postgres:signals@127.0.0.1:26120/signals`, `ANALYTICS_PG_CONTAINER=dash-v3-r1-pg`, `SIGNALS_URL=http://127.0.0.1:26121`, `ANALYTICS_REVIEW_URL=http://127.0.0.1:26122`, `ANALYTICS_REVIEW_PROBE_PORT=26123`, `SIGNALS_PROBE_LATENCY_BUDGET_MS=900`, `PLAYWRIGHT_CHANNEL=chromium`. The log (`/tmp/r1-ci.log`) contains `PASS auth-before-body…`, then `Backend browser QA passed: real v3 analytics, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, …`, and ends `FINDINGS 0 MISMATCHES 0`. `ci-conformance.py` runs that probe with `check=True` and has nothing after it. No traceback. The catalogue scenarios the implement brief requires are in that QA line.
- Performance failure — the author's 136.069 ms miss is real (blocker 1). They did not claim the budget passed.
- Screenshot determinism — pass when run the way the author describes. `VITE_DEMO=1` build to `/tmp/r1-demo-dist` (`index-DxYwVDYX.js` 350.70 kB), served by `python3 -m http.server 26160`. Two serial `bun scripts/visual-qa.mjs` runs exited 0 (`/tmp/r1-vis1.log`, `/tmp/r1-vis2.log`). All 64 PNGs were byte-identical across the two runs and identical to `HEAD` (sha256 lists `/tmp/r1-vis1.sha` and `/tmp/r1-vis2.sha`). A Vite dev-server visual run dirties a few 390 PNGs; that is a different command from the author's static rerun, and the static rerun put those bytes back.
- `git status` at the author's final commit is clean apart from this review's new files. `web/artifacts/v3/performance.json` is still the committed 136.069 record.
- Status "acceptance incomplete" matches what the suites and the screen comparison show. It is not a false pass.

Chart geometry that passed, demo data, 1440 light:

- Activation funnel widths are proportional to 312, 274, 190, 137, 84 (319, 280.1, 194.3, 140.1, 85.9 px). Drawn drop-offs −12.2%, −30.7%, −27.9%, −38.7% match the table twin 12.2, 30.7, 27.9, 38.7. Keyboard tooltip count for the funnel is 1.
- Histogram bin heights match the counts (above). Keyboard tooltip count is 1.
- Heatmap colours are monotone. `followup.mjs` reads composited fills: distance to `--chart-3` is 37 at 100%, 175 at 50% and 47% and 44% and 41%, then 192, 202, 206 as the percent falls through 37, 35, 33, 30, 29, 27. Inversions: 0. `fidelity.json` `geometry.heatmapMono.inversions` is 10 only because `Number("100%")` is NaN. Ignore that field.
- Sankey node rectangles, not path bounding boxes. Right-hand heights 89.1, 68.1, 44.8 against path counts 812, 621, 408 (ratios 0.1097, 0.1097, 0.1098). Left-hand `search_products` 143.1 against 812+408=1220 (0.1173) and `get_customer` 72.9 against 621 (0.1174). Proportional within each column. `fidelity.json` `sankey.pathHeights` is the bezier box and is not a measurement.
- Treemap labelled cells: get_product 24.6% of tokens and 25% of area, search_products 16.4 / 16.6, list_orders 12.3 / 12.4, get_customer 9.9 / 9.9, fetch_document 6.9 / 6.8, add_to_cart 6.6 / 6.6, submit_order 5.1 / 5.1, create_ticket 4.6 / 4.5. Smaller cells omit their labels; the area check above is the labelled set. Tenant bars are 346, 242, 104 px against 12,587,070, 8,810,949, 3,776,121, exactly proportional. Keyboard tooltip count for the treemap is 1.
- Stacked-area crosshair text: `10/08 ChatGPT 1,622 Claude 3,731 Cursor 2,758 total 8,111`.

Motion and layout that passed:

- Tile entrance computed `0.52s v3-rise`. After settle, the only animation still running on Overview is `lamp`. Nothing else observed over 700 ms.
- Hover on the first card: `matrix(1, 0, 0, 1, -2, -2)` and a hard shadow (`followup.mjs`).
- `prefers-reduced-motion`: running animations `[]`, `.signal-dot` animation-name `none`, count-up stays on `48.2K`, live dot duration `0s`.
- Cumulative layout shift after load and a tab switch: 0.
- Page h1 is Krona One, 40px, weight 400, on every screen inventoried.
- No horizontal page scroll at 1440 or 390, light or dark.

Left in place, because the brief or the notes allow them:

- Setup keeps the shipping Python, Node, and cURL snippets. `visual-qa.mjs` asserts those SDK snippets. The mock's `withSignals(server)` string is not a product API. The author report records the coordinator's approval.
- Client stack order is teal, gold, flame (Cursor `--chart-3`, Claude `--chart-1`, ChatGPT `--chart-2`), which is the design-notes series rule. The mock sample order differs. The crosshair above shows that order.
- The tool drawer is a single-scale stacked area (`Calls and errors trend`) plus a per-tool histogram and an error-kind donut. The implement brief requires one scale per chart, so the mock's dual-axis `comboChart` is not required. Null error kinds stay in the drawer table.
- The session swimlane is one lane per target. Notes section 8 records that change. The gantt is present. The tile says "Open on this page" where the mock says "Open now" with a sample value of 18. The product does not invent a global open count.
- Demo histograms use the 60-bin contract from 1 ms. The mock's sample histogram is a different binning. The three percentile positions are correct (blocker 2 is the extra pills).
- Settings still has account, keys, users, and alert rules, which the implement brief keeps by telling the screens to read the client the way v2 does.
- Card stagger is a flat 0.14s delay against the notes' 260+80 ms steps. That timing delta is style and is left out.

## Probes committed

- `reports/review-r1/fidelity.mjs` — inventories, geometry, motion, contrast, clip, a tab-switch `TaskDuration`. Run: `PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:<port> bun reports/review-r1/fidelity.mjs` with `VITE_DEMO=1`.
- `reports/review-r1/fidelity.json` — the run against `http://127.0.0.1:26110`. Ignore `geometry.heatmapMono.inversions` and `geometry.tools.sankey.pathHeights` (see the header of `fidelity.mjs`).
- `reports/review-r1/followup.mjs` — sankey rect heights, heatmap distances, hover transform.
- `reports/review-r1/countup.mjs` — 40 ms count-up samples and protocol dot fills.
- `reports/review-r1/shots/product-*-1440-light.png` — the eight product screens cited above.

The 1.9 MB trace and the mock screenshots were not committed. The trace's times are in blocker 1. The mock-adoption shot was taken mid count-up and is not evidence. The harness temp directory was removed after the run.
