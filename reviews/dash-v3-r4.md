# Dashboard v3 review, round 4

VERDICT: approve

Reviewed `vuk88/dash-v2` at `97a2528` (commits since the round-3 review commit `fb7c415`: `7b1ef60` restored motion, `dc2450d` HTML bar layers, `b9b8e3a` grid lines behind bars, `4bc2729` longest-task gate, `97a2528` final captures). Compared against `reviews/dash-v3-r3.md`, `briefs/v3/fix-dash-v3-r3.md`, and the "Round 3 fixes" section of `reports/dash-v3.md`. Product source was not edited.

The restored motion matches the approved timings on light and dark. The longest single main-thread task stays under 50 ms on the author's instrument (15 singles and the ten-step walk, three repeats) and on an independent trace of all four variant scenarios (110 switches). Contrast, clipping, drawers, 320 px labels, chart inventory, and histogram markers stay closed. Check, build, the UI suite, the Next host, the integrated harness, and the static screenshot set passed.

The demo under test was `web/artifacts/v3-demo`, `index-CNzaFLgA.css` (69,337 bytes) and `index-DPKQqWjL.js` (357,720 bytes), served at `http://127.0.0.1:27210`. Ports: 27210 static, 27230 UI suite, 27240 Next host, 27260 review-r2 probe, 27250–27253 harness. Postgres was `postgres:18.6-bookworm`, `--shm-size=1g`, container `dash-v3-r4-pg` on `127.0.0.1:27250`. The trap stopped and removed that container. After this review, `target/`, `t-r4/`, `web/dist/`, and `web/artifacts/v3-demo/` are removed.

## Blockers

None.

## Should-fix

None.

## Motion

Contract, from `briefs/v3/fix-dash-v3-r3.md`: rise 520 ms, easing `cubic-bezier(.2,.8,.3,1)`; tiles `130+i*55`; cards `300+i*85` with the fifth card only after it scrolls into view; context / heading / range 40 / 90 / 140 ms; count-up 640 ms from 0 after the tile delay; sparks and stacked areas 560 ms; donut and stroke 620 ms; histogram and bars 520 ms with the original stagger; funnel bars 520 ms at 0 / 80 / 160 / 240 / 320 ms. Animated properties are opacity, transform, and stroke-dashoffset. Reduced motion leaves `document.getAnimations()` empty.

Light, the author's probe:

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27210 \
  bun ../reports/review-r3/motion.mjs
```

Exit 0. Copy: `reports/review-r4/motion-light.json`. The round-3 JSON was restored afterwards.

| Element | Duration | Delays |
|---|---:|---|
| Six tiles | 520 ms | 130, 185, 240, 295, 350, 405 ms |
| Cards on load, plus the fifth after scroll | 520 ms | 300, 385, 470, 555, and 640 ms |
| Context, heading, range | 520 ms | 40, 90, 140 ms |
| Count-up | sampled change windows 582–636 ms | First changes 144, 196, 248, 316, 371, 422 ms; every span starts at 0 |
| Spark / stacked-area layer | 560 ms | 0 |
| Donut layer | 620 ms | 0 |
| Histogram, 60 bars | 520 ms | 0 through 708 ms, step 12 |
| Funnel bars | 520 ms | 0, 80, 160, 240, 320 ms |
| Nav thumb | 420 ms | spring, unchanged |
| Lamp rings | 2400 ms | 0 and 1200 ms |

Tile and card easing is `cubic-bezier(0.2, 0.8, 0.3, 1)`. Recorded animation properties are opacity and transform. `.plot.on` and `.stroke-draw.on` compute to `animation: none` / `0s`. Count ends `48.2K`, `1,094`, `6.5K`, `99.1%`, `640 ms`, `≈ 25.2M`. Reduced motion: `[]`.

Dark, `reports/review-r4/motion-dark.mjs` (a frame recorder, because finished `fill: backwards` animations drop out of `getAnimations()`):

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27210 \
  bun ../reports/review-r4/motion-dark.mjs
```

Exit 0. Six tiles, card delays 300 / 385 / 470 / 555, scrolled fifth card asserted, 60 histogram bars, spark 0.56s, stacked area 0.56s, donut 0.62s, grow-x 0.52s, count starts at 0, reduced motion `[]`.

## Performance

The binding gate is the final ruling in `briefs/v3/fix-dash-v3-r3.md`: the longest single main-thread task per switch is under 50 ms, in single mode (15 separate processes) and the ten-step walk (three repeats). Aggregate `mainThreadMs`, style, and the first-switch median are recorded with no assertion. The same longest-task bound applies to the four variant scenarios.

Quiet author instrument, after the machine load had fallen, no other browser suite overlapping:

```sh
cd web
BASE_URL=http://127.0.0.1:27210 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs
BASE_URL=http://127.0.0.1:27210 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs --walk
```

The single command was launched 15 times. All exited 0. Aggregate median 102.96 ms, maximum 109.52 ms, longest-task maximum 14.23 ms. `reports/review-r4/single-serial-quiet.json`.

The walk exited 0. Thirty steps, longest-task maximum 21.89 ms, longest-task median 10.70 ms, aggregate median 122.57 ms, aggregate maximum 164.30 ms, first-switch aggregate median 109.90 ms. Live → overview was 160.36 / 8.79, 156.82 / 9.34, and 164.30 / 11.20 (aggregate / longest task). `reports/review-r4/performance-walk-quiet.json`.

An earlier invocation of the same instrument, run while load was near 12 after 220 traced and untraced switches, is not the gate result. Single 14 exited 1 at longest task 56.68 ms (aggregate 374.20 ms). The walk written before that assertion has 8 of 30 steps at or above 50 ms. Those files are `single-serial.json` and `performance-walk.json`. The quiet rerun above replaced them.

Independent trace, `reports/review-r4/longest-task.mjs`. It does not import `performance-qa.mjs`. Categories are `devtools.timeline,toplevel`. The longest task is the maximum complete `RunTask` or `ThreadControllerImpl::RunTask` on `CrRendererMain`. The same four scenarios as `perf-variants.mjs`: order ×3, walk20 ×2, dark ×3, ten ×1.

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27210 \
  bun ../reports/review-r4/longest-task.mjs
```

Exit 0. 110 switches, 0 at or above 50 ms. Longest task minimum 5.355 ms, median 10.356 ms, maximum 20.021 ms. Aggregate minimum 41.491 ms, median 118.698 ms, maximum 176.217 ms. No complete event of any other name outlasted the task filter.

| Scenario | Steps | Longest-task max | Aggregate median | Aggregate max |
|---|---:|---:|---:|---:|
| order, light | 30 | 19.922 ms | 120.274 ms | 176.217 ms |
| walk20, light | 40 | 20.021 ms | 115.193 ms | 172.233 ms |
| dark | 30 | 19.398 ms | 122.825 ms | 163.921 ms |
| ten, light | 10 | 16.779 ms | 121.937 ms | 152.671 ms |

Author's untraced `perf-variants.mjs`, rerun on a quiet machine, exited 0. Above the former 130 ms aggregate sum, informational: 21 of 110 (order 4, walk20 10, dark 5, ten 2). Medians 110.838 / 115.944 / 111.541 / 113.501 ms. The author's own quiet sample was 18 of 110. The count is informational. `reports/review-r4/perf-variants-quiet.json`.

### Live → overview

The author's claim: the cost is repeated entrance rendering (style, layout, paint), the aggregate is many short tasks, and it is not one long Live-unmount script and not a permanent leak.

The independent trace's worst live → overview step (walk20, run 2, step 18) measured aggregate 172.233 ms and longest task 19.334 ms. That task is `ThreadControllerImpl::RunTask`. The sum of those tasks is 170.461 ms, so the aggregate is the sum. On that same window: UpdateLayoutTree max 3.840 / sum 30.751 ms, Layout max 5.980 / sum 23.067 ms, Paint max 2.015 / sum 16.638 ms, FunctionCall max 3.276 / sum 15.504 ms, FireAnimationFrame max 1.440 ms. A MajorGC of 7.356 ms sat inside the sample. CDP deltas for the step: style 30.697 ms, layout 23.956 ms, script 13.053 ms. The trace is `reports/review-r4/live-overview-trace.json.gz`.

## Closed round-1 and round-2 findings

Histogram markers and chart inventory, `reports/review-r4/markers.mjs`. The round-1 fidelity probe still looks for `rect.growy` inside the chart SVG and throws, because bars now live on sibling `svg.growy` layers. The replacement reads layer `left` / `width` / `height` and `svg[role=img] g.popin`.

Exit 0. Markers: p50 180 at x 187.9, expected 187.5, delta 0.4 px; p95 640 delta 0.6 px; p99 2,100 delta 0.7 px. 60 bars, 60 table rows, `heightOff` 0, 4 grid lines. Inventory contains the kinds `visual-qa.mjs` requires: overview stacked-area, donut, funnel, heatmap, ribbon, sparkline; adoption stacked-area, donut, bars, line; tools ribbon, sankey, histogram; reliability gauge, ribbon, band; sessions gantt; cost treemap, bars, sparkline; protocol dot-grid; live sparkline and bars.

`reports/review-r2/variants.mjs` exited 0. Contrast failures 0, clipped 0, overflow `[]`. The tools histogram sums to 48,212, equal to the Calls column. Six opened tool drawers each have 60 bars, 60 bins, no `NaN`, and labels beginning `p50` / `p95` / `p99`.

`reports/review-r2/drawer-contrast.mjs` exited 0: `failures: 0 clipped: 0` at 1440 and 390, both themes.

`reports/review-r3/drawer-widths.mjs` exited 0 at 1280 and 320, both themes: `failures: 0, clipped: 0`. A session-drawer pill sample was 6.083:1.

`reports/review-r3/tile-labels.mjs` exited 0. 288 labels, 0 hits, including 96 at 320 px. Hits at 320, 359, and 390 dark were 0.

Copied into `reports/review-r4/`. The round-1, round-2, and round-3 trees were restored with `git checkout` afterwards.

## Verified claims

Author section "Round 3 fixes" in `reports/dash-v3.md`. Each row is a claim and this run.

| Claim | This run |
|---|---|
| Entrances are 520 ms with the approved delays, count-up 640 ms from 0, sparks/areas 560, donut/stroke 620, bars 520 with stagger, reduced motion empty. | Holds on light (`motion.mjs` exit 0) and dark (`motion-dark.mjs` exit 0). Table above. |
| Longest renderer task under 50 ms. 15 singles: aggregate median 102.440 ms, max 110.778, longest-task max 13.536, 0/15 failures. Walk: aggregate median 120.611, max 166.176, longest-task max 19.844, 0/30. | Holds on a quiet rerun. 15/15 exit 0, aggregate median 102.96 ms, max 109.52, longest-task max 14.23. Walk exit 0, longest-task max 21.89 ms, aggregate median 122.57, max 164.30, first-switch median 109.90. One earlier loaded invocation exceeded 50 ms and is discarded. |
| Live → overview is entrance style/layout/paint, many short tasks, not one long unmount script. | Holds. Worst independent sample 172.233 ms aggregate, longest task 19.334 ms, task sum 170.461 ms, FunctionCall max 3.276 ms. |
| `perf-variants.mjs` exit 0, 110 switches, 18 of 110 above the old 130 ms sum, informational. | Exit 0 on a quiet rerun. 21 of 110 above 130 ms. Independent trace of the same scenarios: 0 of 110 tasks at or above 50 ms, longest-task max 20.021 ms. |
| `bun run check`, `bun run build`, `bun run test`, `bun run test:next` exit 0. | All exit 0. Test tail: `review-r1 probe passed`, `review-r2 probe passed`, `Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.` Next tail: `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` Build: `index-uf_ULB6W.js` 345.52 kB, `index-CNzaFLgA.css` 69.33 kB, built in 560 ms. |
| Two serial static captures, 64 PNGs, nothing changed. | Serial run 1 and serial run 3: `PNGs 64 changed []` against HEAD, both exit 0. Serial run 2 differed on `overview-390-light.png` (6,630 pixels in the spark fill band). Four isolated recaptures of that screen matched HEAD. The mismatch did not reproduce. |
| Harness exit 0: identity 52/52 and 54/54, gzip the same, backend browser QA, `FINDINGS 0 MISMATCHES 0`. | `CARGO:0` in 43.62 s, `MIGRATE:0`, release build `Finished release profile [optimized] target(s) in 1m 26s`, `HARNESS:0`. Pass lines match the claim, including `subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200`. |
| Drawer contrast, variants, and histogram percentiles still clean. | Drawer contrast and widths 0 failures. Variants 0 contrast, 0 clip, 0 overflow. Markers deltas 0.4 / 0.6 / 0.7 px. Tile labels 0 hits of 288. |

## Probes committed

Under `reports/review-r4/`:

- `longest-task.mjs`, `longest-task.json`, `live-overview-trace.json.gz` — independent CDP trace.
- `motion-dark.mjs`, `motion-dark.json`, `motion-light.json` — both themes.
- `markers.mjs`, `markers.json` — histogram geometry after the bar-layer move, plus chart inventory.
- `drawer-contrast.json`, `drawer-widths.json`, `tile-labels.json`, `variants.json` — copies of the closed-finding reruns.
- `single-serial-quiet.json`, `performance-walk-quiet.json` — the gate sample.
- `single-serial.json`, `performance-walk.json`, `performance-single-last.json`, `perf-variants.json` — the loaded-machine sample, not the gate.
- `perf-variants-quiet.json` — quiet untraced variant aggregates.
- `determinism.json` — three full static captures and the isolated overview recaptures.
