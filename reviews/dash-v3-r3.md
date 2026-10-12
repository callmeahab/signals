# Dashboard v3 review, round 3

VERDICT: approve

Reviewed `vuk88/dash-v2` at `c66edc7` (commits since the round-2 review commit `a481fe7`: `0e17eb8` chart cleanup and bounded entrances, `c06d503` explicit browser global, `0896712` passing r2 probes, `57cc9b7` and `1c47dbc` static captures, `c66edc7` the round-2 report). Compared against `reviews/dash-v3-r2.md`, `briefs/v3/fix-dash-v3-r2.md`, `briefs/v3/dash-v3-implement.md`, the approved mock `briefs/v3/dashboard-v3.html`, its design notes, and the "Round 2 fixes" section of `reports/dash-v3.md`. Product source was not edited. The motion-restore experiment below was applied only in the working tree, measured, and reverted before this commit; `git diff` of tracked source is empty apart from this review.

**Round-2 blocker 1 closes, round-2 blocker 2 closes, and the tile-label should-fix closes.** Each was reproduced with the round-2 probe and with one fresh variant. The ten-step walk stays under 100 ms on the untraced instrument (maximum 74.424 ms of 30) and on the fresh orders, the 20-step walk, and dark theme (maximum 84.595 ms of 110). One traced `performance-qa.mjs --walk` invocation, run immediately after those browser sessions, exited 1 on a single step at 105.477 ms; two later isolated invocations of the same command exited 0 (maximum 80.10 ms and 88.05 ms). That outlier is recorded under Verified claims. Style recalculation stays near 9–16 ms while the node counters still climb and then collect. Drawer contrast is above 4.5:1 at 1440, 1280, 390, and 320. Tile labels at 320 px wrap, and the longest line sits inside the label box.

The demo bundle under test was the author's static build, `index-BB9Gtj0K.css` (69.29 kB) and `index-DJIeRmm6.js` (356.22 kB), served at `http://127.0.0.1:27110`. Ports used: 27110 (static), 27111 (restored-motion static, stopped after the walk), 27130 (UI suite), 27140 (Next host), 27150–27153 (harness). Postgres was `postgres:18.6-bookworm`, `--shm-size=1g`, container `dash-v3-r3-pg` on `127.0.0.1:27150`. `docker stop` and `docker rm` each printed `dash-v3-r3-pg`. After this review, `target/`, `t-r3/`, and the temporary demo directories are removed.

## Blockers

None.

## Should-fix

None.

## Round-2 findings

### Blocker 1, session switch cost, closed

Contract, from `briefs/v3/dash-v3-implement.md` and the round-2 fix brief: a tab switch stays under 100 ms of main-thread work on the demo data, for every step of the ten-step walk, three repeats, and the single-switch median has margin (target ≤ 85 ms).

Round-2 method, untraced (`reports/review-r2/perf-sequence.mjs`: CDP `Performance.getMetrics` `TaskDuration` delta around a CDP-dispatched nav click, 750 ms settle, 250 ms gap, `__SIGNALS_VISUAL_QA__`, 1440×1000, no tracing):

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27110 \
  bun ../reports/review-r2/perf-sequence.mjs 3
```

Exit 0. `over budget: 0 of 30`. Minimum 41.105 ms, maximum 74.424 ms. `RecalcStyleDuration` stayed between 8.456 ms and 14.079 ms. The printed run order (`reports/review-r3/perf-sequence.json`; `byStep.runs` in that file is sorted ascending, so this table is the probe stdout):

| step | transition | run 1 | run 2 | run 3 |
|---|---|---:|---:|---:|
| 1 | overview → adoption | 58.53 | 64.29 | 65.84 |
| 2 | adoption → tools | 58.69 | 64.17 | 74.42 |
| 3 | tools → reliability | 60.13 | 56.23 | 74.26 |
| 4 | reliability → sessions | 70.70 | 63.18 | 69.97 |
| 5 | sessions → cost | 58.15 | 56.65 | 58.99 |
| 6 | cost → protocol | 41.10 | 51.24 | 59.71 |
| 7 | protocol → live | 43.87 | 53.40 | 57.38 |
| 8 | live → overview | 62.83 | 69.71 | 70.38 |
| 9 | overview → adoption | 51.11 | 61.62 | 69.08 |
| 10 | adoption → reliability | 62.41 | 59.05 | 60.27 |

The two transitions that were 133–151 ms in round 2, live → overview and adoption → reliability, are 60–70 ms here.

Root-cause check, same session shape, `reports/review-r2/perf-retention.mjs` (exit 0):

```
 → adoption        61.32 ms  style   8.941 ms  nodes   2285  layoutObjects   2066  listeners  193  liveDOM 578
 → tools          57.895 ms  style  12.005 ms  nodes   3771  layoutObjects   3553  listeners  214  liveDOM 971
 → reliability    51.496 ms  style   9.563 ms  nodes   4308  layoutObjects   4044  listeners  220  liveDOM 368
 → sessions       55.962 ms  style   8.891 ms  nodes   5053  layoutObjects   4776  listeners  240  liveDOM 481
 → cost           61.563 ms  style  12.513 ms  nodes   5685  layoutObjects   5340  listeners  246  liveDOM 411
 → protocol       40.417 ms  style   8.788 ms  nodes   6267  layoutObjects   5928  listeners  252  liveDOM 537
 → live           42.645 ms  style   8.944 ms  nodes   7935  layoutObjects   7146  listeners  298  liveDOM 879
 → overview       75.098 ms  style  14.614 ms  nodes   9215  layoutObjects   8323  listeners  306  liveDOM 820
after GC:  Nodes 1359, LayoutObjects 1253, JSEventListeners 181, Documents 1, liveDOM 820
post-GC adoption: 50.429 ms, style 8.452, nodes 2233, layout 2046, listeners 191, liveDOM 578
after 2nd GC: Nodes 973, LayoutObjects 879, JSEventListeners 181, liveDOM 578
```

The author's claim survives. Counters still climb between collections, attached `liveDOM` stays in the hundreds, and a forced GC returns to the author's second-GC baseline exactly (973 / 879 / 181). Style on the return to Overview is 14.614 ms, where round 2 measured 63.004 ms. The post-GC switch is 50.429 ms. The growth is collectible detached DOM, and the walk no longer pays the round-2 style bill. The author already disclosed that the counters are not constant.

Fresh variants, `reports/review-r3/perf-variants.mjs` (same instrument, plus Nodes / LayoutObjects / JSEventListeners). Exit 0. `over budget: 0 of 110`. The default scenario list also ran one extra light ten-step walk (`ten`), because that scenario is in the file and the default filter keeps it.

| scenario | repeats | steps | min | median | max | max style | nodes start → end |
|---|---:|---:|---:|---:|---:|---:|---|
| order, light | 3 | 30 | 46.145 | 57.371 | 84.595 | 16.500 | 1992 → 12153 |
| walk20, light | 2 | 40 | 38.499 | 61.061 | 82.762 | 15.371 | 2896 → 748 |
| dark, round-2 order | 3 | 30 | 41.765 | 59.899 | 81.561 | 15.831 | 2295 → 10630 |
| ten, light (extra) | 1 | 10 | 44.808 | 63.521 | 69.891 | 13.774 | 2285 → 10620 |

Order was `protocol, sessions, live, overview, adoption, reliability, cost, tools, live, overview`. The worst step was live → overview at 84.595 ms (run 1 step 10, style 16.500, 12149 nodes). The 20-step order was `tools, cost, protocol, live, overview, reliability, sessions, adoption, tools, live, overview, cost, adoption, reliability, protocol, sessions, live, overview, tools, cost`. On both repeats, step 15 sat at about 16261 nodes and cost about 50–52 ms; step 16 dropped to 865 nodes / 193 listeners, and step 20 ended near 750 nodes / 179 listeners. Task time does not track the pending-GC counters.

Single-switch acceptance, 15 separate processes:

```sh
cd web && PERFORMANCE_SCREEN=adoption PERFORMANCE_THEME=light \
  PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:27110 \
  bun scripts/performance-qa.mjs
```

All 15 exited 0: 64.31, 70.99, 66.29, 61.56, 60.62, 63.78, 61.32, 59.72, 64.17, 60.14, 82.18, 66.19, 59.16, 64.45, 64.39. Sorted median (8th of 15) is 64.17 ms. Maximum is 82.18 ms. Every run is under the 85 ms margin target. Recorded in `reports/review-r3/single-serial.json`.

Traced walk, the author's command:

```sh
cd web && BASE_URL=http://127.0.0.1:27110 PLAYWRIGHT_CHANNEL=chromium \
  bun scripts/performance-qa.mjs --walk
```

The first invocation, started right after the variant suite, exited 1. It wrote `reports/review-r3/performance-walk.json` and then asserted. Run 2 step 5, sessions → cost, was 105.477 ms, with `recalcStyleMs` 16.202, 5689 nodes, and 246 listeners. The other 29 steps of that invocation were under 100 ms (highest of those, 92.75 ms). Two isolated reruns then exited 0: maximum 80.10 ms and 88.05 ms (`reports/review-r3/performance-walk-2.json`, `performance-walk-3.json`). Across the 140 untraced steps above, nothing exceeded 84.595 ms, and style did not climb toward the round-2 63 ms. The systematic over-budget walk did not reproduce. The author's "exit 0, maximum 94.278 ms" claim holds on the two quiet reruns; the one noisy invocation is the exception, and it is not the round-2 defect.

### Blocker 2, session-drawer pill contrast, closed

Round-2 method, `reports/review-r2/drawer-contrast.mjs` (shared `contrast-clip.mjs`, both drawers, 1440 and 390, both themes). Exit 0. `failures: 0 clipped: 0`. Dark `.status-pill.ok` ink is now `oklch(0.76 0.1 186)`. The 10% tint behind it is still `--chart-3` (`oklch(0.6619 0.1088 186.28 / 0.1)`). Light ink stays `oklch(0.44 0.075 189)`.

Fresh widths, `reports/review-r3/drawer-widths.mjs`, both drawers at 1280 and 320, both themes, with the pill ratio computed by the same backdrop walk as `contrast-clip.mjs`. Exit 0.

```
1280 light: contrast failures so far 0, clipped 0
320 light: contrast failures so far 0, clipped 0
1280 dark: contrast failures so far 0, clipped 0
320 dark: contrast failures so far 0, clipped 0
failures: 0, clipped: 0
```

Session-drawer `.status-pill.ok` (six pills: `session.started`, `mcp.initialize`, `mcp.request`, `tool.called`): light 6.083:1, dark 6.372:1, at both 1280 and 320. The tool drawer has no `.status-pill.ok` and contributed zero contrast failures. Contract was ≥ 4.5:1 on every measured surface.

### Should-fix, tile labels at 320 px, closed

`reports/review-r3/tile-labels.mjs` at 320, 359, and 390, both themes, on overview, adoption, tools, reliability, sessions, cost, protocol, live, and the session drawer. Exit 0. 288 labels, 0 hits. A hit is ellipsis, scroll-size clipping, an ancestor clipper, label/value overlap, or a line box wider than the label by more than 1 px.

At 320 px light, protocol "Client capabilities" and "Server capabilities" are `white-space: normal`, two line boxes, text width 85.7 px inside a 109 px box (`textOverflowPx` −23.3). The same pass wraps "Open on this page", "Sessions with errors", and "Hallucinated tools", and each longest line fits. `scrollWidth` equals `clientWidth` (109) because overflow is visible; the line-box measurement is what shows the wrap. Round 2's nowrap "CLIENT CAPABIL…" is gone. `variants.mjs` also reported `overflow: []`.

## Verified claims

Author section "Round 2 fixes" in `reports/dash-v3.md`. Each row is a claim and this run.

| Claim | This run |
|---|---|
| Cause: collectible detached DOM, amplified by repeated entrance work. Final retention: style 9.791 ms on Adoption, 14.647 ms returning to Overview (78.494 ms total); post-GC Adoption 55.405 ms; second GC 973 / 879 / 181. | Holds. This retention walk: Adoption style 8.941 ms, Overview return 75.098 ms with style 14.614 ms, post-GC Adoption 50.429 ms, second GC exactly 973 / 879 / 181. Style does not climb to 63 ms. |
| Fifteen serial single switches: median 65.704 ms, maximum 81.998 ms, 0 failures, margin target ≤ 85 ms. | Holds. 15/15 exit 0, median 64.17 ms, maximum 82.18 ms. |
| `performance-qa.mjs --walk` exit 0, 30/30 under 100 ms, maximum 94.278 ms. | Holds on two isolated reruns (exit 0, maximum 80.10 ms and 88.05 ms). The first invocation in this session exited 1: one step at 105.477 ms, style 16.202 ms. See Blocker 1. |
| `perf-sequence.mjs 3`: `over budget: 0 of 30`. | `over budget: 0 of 30`. Maximum 74.424 ms. |
| `perf-retention.mjs`: no walk or post-GC switch over 100 ms. | Maximum walk step 75.098 ms, post-GC switch 50.429 ms. |
| `drawer-contrast.mjs`: `failures: 0 clipped: 0`. | `failures: 0 clipped: 0`. |
| `variants.mjs`: 0 contrast failures, 0 clips, 0 overflow, no negative count-up frames. Overview and Adoption series nonnegative and monotone. Five fresh-screen switches pass (author maximum 81.216 ms). | `contrast` length 0, `clipped` empty, `overflow: []`, `negativeCountUpFrames: []`. Overview 45 frames × 6 tiles, first `['0','0','0','0%','0 ms','≈ 0']`, last `['48.2K','1,094','6.5K','99.1%','640 ms','≈ 25.2M']`, zero drops. Adoption 48 × 6, nonnegative and monotone; its first sampled frame is already mid-count. Fresh switches: cost 58.065, reliability 62.501, protocol 57.913, live 52.87, sessions 67.145. |
| `bun run check` exit 0. | Exit 0. Last lines: `bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs`, then `tsc --noEmit` and `eslint`. |
| `bun run build` exit 0; `index-DF4i3wFq.js` 344.02 kB; built in 188 ms. | Exit 0. `dist/assets/index-DF4i3wFq.js` 344.02 kB, `index-BB9Gtj0K.css` 69.29 kB, `✓ built in 187ms`. |
| `bun run test` exit 0; review-r1 probe, review-r2 probe, Visual QA. | Exit 0 on `SIGNALS_TEST_UI_PORT=27130`. Last lines: `review-r1 probe passed`, `review-r2 probe passed`, `Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.` |
| `bun run test:next` exit 0. | Exit 0 on `SIGNALS_NEXT_PORT=27140`. Last line: `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` |
| Static demo assets match the performance bundle (`index-BB9Gtj0K.css`, `index-DJIeRmm6.js`). | The served demo directory contains those two hashes. JS is 356,225 bytes (356.22 kB). |
| Two serial static captures, 64 PNGs, 0 changed, tree clean. | After `git checkout -- web/artifacts/v3`, two serial `BASE_URL=http://127.0.0.1:27110 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs` runs. Both exited 0. QA1: `pngs 64 differ 0` against HEAD. QA2: `run2 vs HEAD differ 0`, `png count 64`. `git status --porcelain -- web/artifacts/v3` was empty, so the two runs match each other. |
| `cargo build --locked --bin signals` and migrate. | `Finished dev profile [unoptimized + debuginfo] target(s) in 43.83s` (`CARGO:0`). Migrate `MIGRATE:0`, `Migrations applied`. |
| `ci-conformance.py` exit 0, identity 52/52 and 54/54, gzip the same, backend browser QA, `FINDINGS 0 MISMATCHES 0`. | `HARNESS:0`. Release build inside the harness: `Finished release profile [optimized] target(s) in 1m 26s`. Pass lines: `identity: 52/52 valid fixtures matched`, `identity: 54/54 invalid fixtures matched`, `gzip: 52/52 valid fixtures matched`, `gzip: 54/54 invalid fixtures matched`, `PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing`, `Backend browser QA passed: real v3 analytics, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.` Last lines: `subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200` and `FINDINGS 0 MISMATCHES 0`. |

Harness command:

```sh
PATH="$PWD/target/r3-bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH" \
TMPDIR="$PWD/t-r3" \
DATABASE_URL=postgres://postgres:signals@127.0.0.1:27150/signals \
ANALYTICS_PG_CONTAINER=dash-v3-r3-pg \
SIGNALS_URL=http://127.0.0.1:27151 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:27152 \
ANALYTICS_REVIEW_PROBE_PORT=27153 \
SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium \
python3 scripts/ci-conformance.py
```

The psql shim at `target/r3-bin/psql` strips a leading `postgres…` argument and runs `docker exec -i dash-v3-r3-pg psql -U postgres -d signals`.

Round-1 fidelity probe, re-run because the fix touched charts, cards, tiles, pills, and global CSS (every screen):

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27110 \
  bun ../reports/review-r1/fidelity.mjs
```

Exit 0. `contrast: 0`, `overflow: []`, `clipped: []`. Histogram markers: p50 180 delta 0.4 px, p95 640 delta 0.6 px, p99 2100 delta 0.7 px. First-paint task 36.884 ms, tab-switch task 81.822 ms, trace 892,662 bytes. Copied to `reports/review-r3/fidelity-r3.json`; the round-1 directory was restored afterwards. The fidelity count-up sample reads `48.2K` both before and mid, because it samples after the shortened count-up; the variants 16 ms series is the one that starts at zero.

Round 2 left these in place, and this run still sees them, so they are not reopened: the lamp element's own animation is `none` while `::before` / `::after` still run the 2.4 s ring (delay 0 s and 1.2 s) in both themes, and reduced motion reports `running: []`; the dev-server visual QA inside `bun run test` rewrites `web/artifacts/v3` (checked out before the static determinism pair).

## Motion timing

Ungraded. The coordinator asked for the numbers and will rule. This section is neither a blocker nor a should-fix.

Source of the shipped timings, `web/packages/ui/src/analytics-v3.tsx`: `enter()` is a Web Animations call of 180 ms, opacity 0→1 and `translateY(14px)`→0, easing `cubic-bezier(.2,.8,.3,1)`, fill `backwards`. Cards pass delay 40. The tile row is one animation at delay 0. `Count` divides progress by 400. `web/packages/ui/src/styles.css` sets `.tile__spark` to 240 ms, stacked-area and donut layers to 320 ms, histogram / `.plot.on` / `.growx.on` / `.growy.on` to 240 ms, and `.stroke-draw.on` to 320 ms. The underlying `.tile` and `.card` CSS rise is disabled (computed `animation: none`).

Measured on the shipped demo and on the mock file `briefs/v3/dashboard-v3.html` with `reports/review-r3/motion.mjs`.

Product animations that ran on load, all classified compositor-only (`transform` and/or `opacity` only):

| what | duration | delay | properties |
|---|---:|---:|---|
| `.tiles` row, one animation | 180 ms | 0 | opacity, transform |
| each card (`s7`, `s4`, `s8`, `s5`) | 180 ms | 40 ms, no per-card stagger | opacity, transform |
| `.tile__spark` `v3-spark-reveal` | 240 ms | 0 | opacity, transform |
| stacked-area layer `v3-draw` | 320 ms | 0 | opacity, transform |
| donut layer `v3-rise` | 320 ms | 0 | opacity, transform |
| `v3-grow-x` | 240 ms | 0 | transform |
| `.page-heading` `v3-rise` | 520 ms | 0 | opacity, transform |
| nav thumb | 420 ms | 0 | transform |
| `.signal-dot` ring | 2400 ms | 0 and 1200 ms | opacity, transform |

Computed `.plot.on` and `.stroke-draw.on` are `animation: none`; the parent layer carries the draw. An overview → adoption switch restarted the tile row at 180 ms, the cards at 180 ms delay 40, sparks at 240 ms, and the chart layers at 320 ms. That one switch still cost 72.292 ms of main-thread work (`recalcStyle` 11.038, layout 8.239, script 15.946). The animated properties are compositor-only. Mounting the next screen still does style, layout, and script on the main thread.

Product count-up. The source duration is 400 ms. The motion probe's 16 ms sampler joined about 94 ms in, so the longest observed change window was 319 ms and the last change was at 413 ms (overview tiles already reading `180.6`, `4.1`, `24.3`, `0.3%`, `1.9 ms`, `≈ 75.4K` at the first sample, and `48.2K`, `1,094`, `6.5K`, `99.1%`, `640 ms`, `≈ 25.2M` at the last). The variants sampler, which starts at frame 0, shows the overview series beginning at zero and finishing on those same end values.

Mock, design notes `briefs/v3/dashboard-v3-notes.md` §5: rise 520 ms; tiles 140 ms + 60 ms stagger; cards 260 ms + 80 ms stagger; lines and areas 560 ms `clip-path`; count-up 640 ms.

Mock, computed from the HTML (its own script sets tile `--d` to `130+i*55` and card `--d` to `300+i*85`; the on-page notes match those numbers, which differ from §5):

| what | duration | delays |
|---|---:|---|
| six tiles, `rise` | 520 ms | 130, 185, 240, 295, 350, 405 ms |
| five cards, `rise` | 520 ms | 300, 385, 470, 555, 640 ms |
| context / page head / range segment | 520 ms | 40 / 90 / 140 ms |
| plot | `clip-path` transition 580 ms | 0 |
| some strokes | 620 ms `stroke-dashoffset` | staggered |
| some bars | 520 ms transform | staggered |

The plot's `clip-path` transition is main-thread work. The product draws chart layers with opacity and transform instead. Mock count-up change windows were 562–615 ms long, starting at about 187 ms and then about every 50 ms (`180+i*50`), which matches a 640 ms tween after that start delay.

Restored-timing walk, local only, not committed. The working tree was patched so `enter()` lasted 520 ms, each tile used `130+i*55`, each card used `300+index*85`, `Count` divided by 640, and the four shortened `animation-duration` overrides in `styles.css` were removed (stylesheet defaults: spark and stacked-area 560 ms, donut and stroke 620 ms, histogram and grow 520 ms). The CSS rule that sets `.tile` and `.card` animation to `none` stayed; the WAAPI calls carried the 520 ms rise. Rebuild:

```
artifacts/v3-demo-motion/assets/index-BbLfAhTy.css    69.03 kB
artifacts/v3-demo-motion/assets/index-ZxJO92yJ.js    356.22 kB
✓ built in 174ms
```

The CSS hash differs from the shipped `index-BB9Gtj0K.css`. Served at `http://127.0.0.1:27111`. One ten-step walk, the round-2 order, untraced:

```sh
PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27111 \
  bun ../reports/review-r3/perf-variants.mjs --only ten --repeats 1 --out perf-restored.json
```

Exit 0 from the probe process, and 1 of 10 steps over the 100 ms budget (`reports/review-r3/perf-restored.json`):

| step | transition | ms | style | nodes | listeners |
|---|---|---:|---:|---:|---:|
| 1 | overview → adoption | 74.36 | 12.64 | 2285 | 193 |
| 2 | adoption → tools | 59.44 | 12.78 | 3771 | 214 |
| 3 | tools → reliability | 69.59 | 14.62 | 4308 | 220 |
| 4 | reliability → sessions | 73.51 | 11.47 | 5053 | 240 |
| 5 | sessions → cost | 71.86 | 15.84 | 5685 | 246 |
| 6 | cost → protocol | 43.83 | 9.45 | 6267 | 252 |
| 7 | protocol → live | 42.61 | 8.28 | 7931 | 298 |
| 8 | live → overview | 108.76 | 20.32 | 9210 | 306 |
| 9 | overview → adoption | 81.19 | 14.66 | 10084 | 316 |
| 10 | adoption → reliability | 77.42 | 17.37 | 10620 | 324 |

Minimum 42.613 ms, median 73.507 ms, maximum 108.76 ms, maximum style 20.319 ms. The same live → overview step on the shipped timings was 70.376 ms at most across the three sequence repeats, and 69.891 ms on the extra ten-step walk. Restoring the HTML timings added about 38 ms on that step and put it over 100 ms. Style rose to 20 ms, not to the round-2 63 ms. The patch was then removed with `git checkout -- web/packages/ui/src/analytics-v3.tsx web/packages/ui/src/styles.css`. Source `git diff` was empty after that.

## Probes committed

Under `reports/review-r3/`:

- `perf-variants.mjs` and `perf-variants.json` (order, 20-step, dark, and the extra ten-step walk)
- `perf-sequence.json`, `perf-retention.json` (round-2 probes re-run; copies, so `reports/review-r2/` stays as committed)
- `single-serial.json` (15 single-switch processes)
- `performance-walk.json` (first traced walk, the 105.477 ms invocation), `performance-walk-2.json`, `performance-walk-3.json`
- `performance-single-last.json` (last of the 15 single runs)
- `drawer-widths.mjs`, `drawer-widths.json`, `drawer-contrast.json`
- `tile-labels.mjs`, `tile-labels.json`
- `variants.json` (round-2 `variants.mjs` re-run)
- `fidelity-r3.json`
- `motion.mjs`, `motion.json`, `perf-restored.json`
