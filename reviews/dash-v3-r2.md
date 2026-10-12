# Dashboard v3 review, round 2

VERDICT: changes required

Reviewed `vuk88/dash-v2` at `c70f530` (round 1 reviewed `34777aa`; the review commit is
`52b8e35`; the fix pass is `484f7fc..c70f530` over the `f591a5d` merge of main). Compared against
`reviews/dash-v3-r1.md`, `briefs/v3/fix-dash-v3-r1.md`, `briefs/v3/dash-v3-implement.md`, the
approved mock `briefs/v3/dashboard-v3.html`, and the "Round 1 fixes" section of
`reports/dash-v3.md`. Product source was not edited.

**Round-1 blockers 2 through 8 and both should-fixes close**, each reproduced with the round-1
method and with one fresh variant. Round-1 blocker 1 closes only for the case the author's gate
measures: the first tab switch after a page load is now ~94 ms, but a fresh variant shows most
later switches in the same session still run 101–154 ms, so the budget in the brief is not met.
The second new blocker comes from a surface neither round had measured: text inside the session
drawer is 4.46:1 in dark. One should-fix: tile labels ellipsize at 320 px.

Everything below was run in this worktree. The demo bundle under test was
`VITE_DEMO=1 bun --bun vite build` from `c70f530` (`index-D_PmGhmL.js`, 355.65 kB) served by
`python3 -m http.server 26210`. Ports used: 26210, 26211 (static), 26230, 26240 (suites),
26250–26253 (harness). Postgres was `postgres:18.6-bookworm`, `--shm-size=1g`, container
`dash-v3-r2-pg` on `127.0.0.1:26250`; it was removed after the run, along with `target/` and
`t-r2/`.

## Blockers

### 1. Only the first tab switch after a load is under 100 ms; most later switches are not

The fix pass tuned and measured the first switch from a fresh load, on two destinations. Every
other switch in the same session is over budget.

Command (probe committed at `reports/review-r2/perf-sequence.mjs`; same instrument as
`web/scripts/performance-qa.mjs` — CDP `Performance.getMetrics` `TaskDuration` delta around a
CDP-dispatched nav click with a 750 ms settle, `__SIGNALS_VISUAL_QA__=true`, 1440×1000, demo
build — minus the tracing session, so if anything it undercounts):

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
  bun ../reports/review-r2/perf-sequence.mjs 3
```

Observed, one continuous session per repeat, three repeats (`reports/review-r2/perf-sequence.json`):

| step | transition | run 1 | run 2 | run 3 |
|---|---|---|---|---|
| 1 | overview → adoption | 103.07 | 85.00 | 82.49 |
| 2 | adoption → tools | 85.00 | 87.59 | 95.51 |
| 3 | tools → reliability | **110.73** | **100.95** | **107.03** |
| 4 | reliability → sessions | **101.61** | **104.91** | **104.08** |
| 5 | sessions → cost | **103.28** | **112.28** | **115.80** |
| 6 | cost → protocol | **103.66** | **102.09** | **103.92** |
| 7 | protocol → live | 45.55 | 58.35 | 51.66 |
| 8 | live → overview | **132.58** | **140.93** | **139.44** |
| 9 | overview → adoption | **113.68** | **127.10** | **129.71** |
| 10 | adoption → reliability | **151.38** | **130.59** | **142.05** |

`over budget: 22 of 30`. A second run of the same probe with per-switch metric deltas
(2 repeats) gave `over budget: 11 of 20`, and a third, independent walk inside
`reports/review-r2/perf-retention.mjs` reproduced it again (reliability 103.78, cost 116.33,
overview 135.55).

The instrument is calibrated against the committed numbers. `reports/review-r2/perf-screens.mjs`
measures the same transitions but, like `performance-qa.mjs`, from a fresh context each time:
there every destination passes (adoption 74.78 / 91.48 / 97.13, tools 85.04 / 89.99 / 94.61,
reliability 81.47 / 89.08 / 96.24, sessions 80.42 / 83.75 / 86.28, cost 73.43 / 87.31 / 91.49,
protocol 70.25 / 73.88 / 75.00, live 52.09 / 56.19 / 60.79). My adoption numbers there sit in the
same band as 15 runs of the author's own script (below), so the two instruments agree; the
difference above is the session, not the measurement.

Why it grows, as supporting evidence (`reports/review-r2/perf-retention.mjs`, one walk):

```
 → adoption       91.655 ms  style  27.585 ms  nodes   2375  layoutObjects   2156  listeners  191  liveDOM 578
 → tools          81.504 ms  style  33.014 ms  nodes   3896  layoutObjects   3678  listeners  210  liveDOM 971
 → reliability   103.775 ms  style  42.066 ms  nodes   4457  layoutObjects   4193  listeners  216  liveDOM 368
 → sessions       95.667 ms  style  41.715 ms  nodes   5244  layoutObjects   4967  listeners  236  liveDOM 481
 → cost          116.325 ms  style  56.923 ms  nodes   5924  layoutObjects   5579  listeners  242  liveDOM 411
 → protocol        96.28 ms  style  56.122 ms  nodes   6530  layoutObjects   6191  listeners  248  liveDOM 537
 → live           58.255 ms  style  14.869 ms  nodes   8198  layoutObjects   7409  listeners  294  liveDOM 879
 → overview      135.551 ms  style  63.004 ms  nodes   9525  layoutObjects   8634  listeners  302  liveDOM 820
```

`RecalcStyleDuration` per switch rises from 27.6 ms to 63.0 ms while the attached document stays
between 368 and 971 elements; `Nodes`, `LayoutObjects` and `JSEventListeners` climb monotonically.
A forced `HeapProfiler.collectGarbage` brings the counters back down (Nodes 9525 → 1359,
LayoutObjects 8634 → 1253, listeners 302 → 181), so this is retained garbage rather than a
permanent leak — but the very next switch after that GC still cost **105.96 ms** (style 33.01 ms),
so collecting it does not bring the switch back under budget.

Expected: "a tab switch stays under 100 ms of main-thread work on the demo data"
(`briefs/v3/dash-v3-implement.md`, still in force per the fix brief's opening paragraph; fix brief
blocker 1 repeats the budget). Nothing in either brief limits the budget to the first switch or to
the adoption and tools destinations.

Two further facts, so the scope of this is clear rather than overstated:

- Read narrowly — only the first switch, only the two screens `performance-qa.mjs` supports — the
  fix does hold at a median of ~94 ms, which is a real improvement on the 136–170 ms of round 1.
  But even there the gate is not reliably green. 15 serial runs of the author's own command on an
  idle box (load 0.51 of 16 cores):

  ```sh
  cd web && PERFORMANCE_SCREEN=adoption PERFORMANCE_THEME=light PLAYWRIGHT_CHANNEL=chromium \
    BASE_URL=http://127.0.0.1:26210 bun scripts/performance-qa.mjs
  ```

  `94.80, 91.32, 108.50 (exit 1), 91.76, 91.82, 93.01, 96.16, 96.77, 93.97, 97.18, 91.80, 97.79,
  94.05, 90.87, 96.40`. One run printed
  `AssertionError: Tab switch exceeded 100 ms: 108.50` and exited 1. The first
  `PERFORMANCE_SCREEN=tools PERFORMANCE_THEME=dark` run also exited 1 (the retry was 94.35).
- `performance-qa.mjs` cannot see any of the switches in the table above: it loads the page once
  and measures one click. That is the verification gap that let this through, and the fix brief's
  "the suite must assert it" is therefore only partly satisfied.

Committed artifacts were restored with `git checkout -- web/artifacts/v3/` after each run, so
`performance.json` is still the author's 95.88 record.

### 2. Text in the session drawer is below 4.5:1 in dark, at both widths the brief names

Round 1 scanned ten screens at 1440 and 390 in both themes; it opened both drawers to inventory
them but never measured them. The fix pass inherited that blind spot, and `visual-qa.mjs` inherited
it too.

Command (probe committed at `reports/review-r2/drawer-contrast.mjs`; it imports the author's own
`web/scripts/contrast-clip.mjs`, unmodified, so this is their measurement, not mine):

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
  bun ../reports/review-r2/drawer-contrast.mjs
```

Observed — `failures: 8 clipped: 0`:

```
session-drawer-1440-dark | 4.46 | "session.started" | oklch(0.6619 0.1088 186.28) 10.5px 500
session-drawer-1440-dark | 4.46 | "mcp.initialize"  | oklch(0.6619 0.1088 186.28) 10.5px 500
session-drawer-1440-dark | 4.46 | "mcp.request"     | oklch(0.6619 0.1088 186.28) 10.5px 500
session-drawer-1440-dark | 4.46 | "tool.called"     | oklch(0.6619 0.1088 186.28) 10.5px 500
session-drawer-390-dark  | 4.46 | (the same four)
```

The pair is the timeline event-type pill, `.status-pill.ok` (`packages/ui/src/styles.css`:
`color:var(--chart-3); background:color-mix(in oklch,var(--chart-3) 10%,transparent)`), text
`oklch(0.6619 0.1088 186.28)` (dark `--chart-3`) over its own 10 % tint over the drawer surface
`oklch(0.272 0.016 64)`, composited `rgb(44,50,44)`. Recomputing the WCAG ratio from the raw
channel values by hand gives **4.459**; against the bare drawer surface, without the pill's own
tint, the same text would be 5.129, so it is the tint that pushes it under. Screenshot:
`reports/review-r2/shots/r2-session-drawer-1440-dark-pills.png`.

My own independent scan, written from scratch rather than imported
(`reports/review-r2/variants.mjs`, 1280 and 320 px, both themes, all eleven screens plus both
drawers), flags the same four pills at both of its widths — eight rows, and nothing else anywhere
on any screen. The tool drawer is clean; the light theme is clean.

Expected: fix brief blocker 7, "every visible text colour on every surface level ≥ 4.5:1 in both
themes … until the reviewer's `contrastAndClip` probe reports zero pairs under 4.5". The drawer is
a surface level, and the probe reports eight pairs under 4.5 when pointed at it. The author's
claim of "0 failing contrast pairs over both themes and both widths" is true only for the surfaces
their scan visited.

The regression net has the same hole: in `web/scripts/visual-qa.mjs` the `contrastAndClip` call
sits inside the per-screen loop, while the `tool-drawer-*` and `session-drawer-*` captures are
taken afterwards with no scan. Blocker 7's "make `visual-qa.mjs` run the same measurement so it
cannot regress" is not satisfied for the drawers.

## Should-fix

### 1. Tile labels ellipsize at 320 px

Command (`reports/review-r2/variants.mjs`, 320×740, both themes, every screen and both drawers):

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
  bun ../reports/review-r2/variants.mjs
```

Observed, 12 hits, 6 per theme, all `.tile__label.eyebrow`:

```
reliability-320-light     "SESSIONS WITH ERRORS" 143>109
reliability-320-light     "HALLUCINATED TOOLS"   129>109
sessions-320-light        "OPEN ON THIS PAGE"    121>109
protocol-320-light        "CLIENT CAPABILITIES"  136>109
protocol-320-light        "SERVER CAPABILITIES"  136>109
session-drawer-320-light  "OPEN ON THIS PAGE"    121>109
(the same six at 320 dark)
```

`packages/ui/src/styles.css:335` is
`.tile__label{…white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`. Screenshot of the
rendered result, showing "CLIENT CAPABIL…" and "SERVER CAPABIL…":
`reports/review-r2/shots/r2-protocol-320-tilelabels.png`.

Expected: round-1 blocker 8 ruled that "Ellipsis is not a fix". 320 px is outside the two widths
that blocker named (1440 and 390, both of which are now clean), which is why this is a should-fix
rather than a blocker — but it is a width this product asserts itself, in
`scripts/login-styles.mjs` and in the backend QA line ("light/dark and 320/390/1440px"), and a
reader at 320 px loses the end of five distinct tile labels.

## Verified claims

Every claim in the "Round 1 fixes" section of `reports/dash-v3.md` was re-run here.

| Author claim | Command I ran | Result |
|---|---|---|
| `bun run check` passes | `cd web && bun run check` | pass, `CHECK_EXIT:0` |
| `bun run build` passes, `index-tYU5kOSR.css` 68.76 kB / `index-CXdaKMQg.js` 343.44 kB | `cd web && bun run build` | pass, byte sizes and hashes identical, built in 176 ms |
| `bun run test` passes | `cd web && SIGNALS_TEST_UI_PORT=26230 PLAYWRIGHT_CHANNEL=chromium bun run test` | pass, `TEST_EXIT:0`, including `review-r1 probe passed`, `review-r2 probe passed` and the Visual QA line |
| `bun run test:next` passes | `cd web && SIGNALS_NEXT_PORT=26240 PLAYWRIGHT_CHANNEL=chromium bun run test:next` | pass, `NEXT_EXIT:0`, `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` |
| `cargo build --locked --bin signals` | same, plus `--release` | both pass |
| Integrated harness green with the new latency assertions | `TMPDIR=$PWD/t-r2 DATABASE_URL=… ANALYTICS_PG_CONTAINER=dash-v3-r2-pg SIGNALS_URL=http://127.0.0.1:26251 ANALYTICS_REVIEW_URL=http://127.0.0.1:26252 ANALYTICS_REVIEW_PROBE_PORT=26253 SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium python3 scripts/ci-conformance.py` | pass, `CI_EXIT:0`. Log contains `PASS auth-before-body…`, `Backend browser QA passed: real v3 analytics, latency histogram count sums and window-aligned band/sparkline, …`, ends `FINDINGS 0 MISMATCHES 0`. No traceback. |
| Deterministic screenshots, two serial static runs byte-identical | two serial `BASE_URL=http://127.0.0.1:26210 bun scripts/visual-qa.mjs` against the static demo build | pass. Both runs `Visual QA passed`; sha256 of all 64 PNGs identical between runs **and** identical to `HEAD` — `git status --porcelain -- web/artifacts` was empty after each run. Includes both `callers-390` files. |
| Performance, Adoption 95.88 / Tools 90.39 / dark 95.56 / 86.47 | the same four commands | the numbers reproduce (94.80 / 88.38 / 93.23 / 94.35), but see blocker 1: 1 of 15 default runs exited 1 at 108.50 ms, and the budget is not met for later switches |
| Histogram markers: exactly p50/p95/p99, no NaN | `PRODUCT_URL=… bun reports/review-r1/fidelity.mjs` | pass. `[{"label":"p50 180","x":187.9,"expected":187.5,"delta":0.4},{"label":"p95 640","delta":0.6},{"label":"p99 2,100","delta":0.7}]`. Max rounding delta 0.7 px, as claimed |
| Adoption: 6 approved tiles, stacked area, identity donut, client table, 2 bar charts, conversion line, no funnel or heatmap | fidelity rerun + `reports/review-r2/geometry.mjs` | pass. Charts `[sparkline ×5, stacked-area, donut, bars, bars, line]`; tiles `DAU, WAU, MAU, Stickiness, New users, D7 retention`; H2s `Active identities, Identity quality, Clients, Transport and protocol, Conversion` |
| Cost: 6 tiles, 1 token sparkline, treemap, 2 bars, "Where the context goes", Input `--chart-3` / Output `--chart-1` | fidelity rerun + geometry probe | pass. `sparks: 1`, payload fills `["var(--chart-3)","var(--chart-1)"]`, legend swatches resolve to `oklch(0.44 0.075 189)` and `oklch(0.8 0.155 80)` |
| Protocol: 6 tiles, 2 dot grids, client `--chart-1` / server `--chart-3`, null states kept | `bun reports/review-r1/countup.mjs` + variants probe | pass. Client grid tally `{oklch(0.8 0.155 80): 90, oklch(0.22 0.013 70 / 0.07): 60}`, server grid `{oklch(0.44 0.075 189): 150}`; empty states for Sampling / Elicitation / Tasks / Progress still present |
| Live: 2 sparklines + 1 bar chart, 2 expanding lamp rings at 2.4 s, reduced-motion empty | fidelity rerun + variants probe | pass. Charts `[sparkline "Live event rate" 40 pts, bars "Live event mix", sparkline "Live errors" 40 pts]`, no area or donut; `::before` and `::after` both `ring 2.4s` infinite (delays 0 s / 1.2 s) in light and dark; under `prefers-reduced-motion` all three animation names are `none` and `document.getAnimations()` is `[]` |
| Contrast: 0 failing pairs | `bun reports/review-r1/fidelity.mjs` (the round-1 method, 10 screens × 1440/390 × light/dark) | reproduced: **0**. See blocker 2 for the surfaces this method does not visit |
| Clipping: 0 visible clips, 0 page overflows | same run | reproduced: clipped `0`, overflow `[]`. Also 0 clips inside both drawers at 1440 and 390. See should-fix 1 for 320 px |
| Count-up never negative or non-monotone | `bun reports/review-r1/countup.mjs`, plus a 16 ms / 48-frame / all-six-tiles variant on Overview and Adoption | pass. Round-1 probe: `0, 3K, 3K, 21.4K, …, 48.2K`. Variant: 45 and 48 frames × 6 tiles, `negative=0 nonMonotone=0`, both screens start at `0` |
| `visual-qa.mjs` encodes the mock's chart kinds, so a wrong kind fails | mutation test: copied the static bundle, replaced the single `` kind:`line` `` with `` kind:`area` ``, served it on 26211, ran `BASE_URL=http://127.0.0.1:26211 bun scripts/visual-qa.mjs` | pass — the gate catches it. Output `adoption: line present` ×4 (both widths × both themes), exit 1 |
| Tool drawer histogram asserted | variants probe opens the first six tools | pass. Every drawer histogram has exactly `["p50 …","p95 …","p99 …"]`, 60 bars, 60 table rows, no `NaN`. The Tools-screen aggregate histogram sums its 60 bins to **48,212**, exactly the sum of the `Calls` column |
| `git status --porcelain` empty, nothing untracked | `git status --porcelain` at `c70f530` | empty. `web/scripts/contrast-clip.mjs`, all four `performance*.json`, all four `tab-switch*-trace.json` and `tab-switch-before.cpuprofile` are in `git ls-files` (118 files under `web/artifacts/v3`) |

Round-1 geometry re-measured on the charts the fix pass added or rewired
(`reports/review-r2/geometry.json`):

- Conversion curve: table twin counts `312, 274, 190, 137, 84`; shares `100, 87.8, 60.9, 43.9,
  26.9`; the drawn labels are the same five numbers, and recovering the share from each circle's
  pixel y gives `100, 87.8, 60.9, 43.9, 26.9`. x strictly increasing. These are the same funnel
  counts round 1 verified on Overview.
- Identity donut: rows `strong 821, key 190, network 83`, total 1094, centre text `75%` /
  `strong identity` — the mock's `ad-idq` centre exactly. Legend `strong 821 75% · key 190 17.4% ·
  network 83 7.6%`.
- Transport and protocol bars: `streamable-http 6200 / stdio 280` and `2025-11-25 6200 /
  2025-03-26 280`, widths 548 px and 24.7 px, exactly proportional.
- Cost context-token sparkline: 7 points, `3360180 … 2506340`, no `NaN` in the path.
- Reliability band: 7 points, `p50 ≤ p95 ≤ p99` on every point, no `NaN`, one `M` per path.
- Live: event-rate and error sparklines 40 points each, event-mix bars 10 rows, no `NaN`.

Divergences I found and am **not** reporting as findings, so the next round does not re-litigate
them:

- The product lamp no longer breathes. `shell.css` sets `.signal-dot{…animation:none}` and adds
  the two `ring` pseudo-elements the fix brief asked for; the mock's `.lamp` runs `breathe` on the
  dot *as well as* the two rings, and design-notes row 26 says "breathing lamp". Measured
  `self: "none"` in both themes. The rings are present and correct, so the lamp still reads as
  live; dropping a continuously repainting `box-shadow` is also a plausible part of the
  performance work.
- The conversion curve strokes `--chart-3`; the mock's `ad-conv` strokes `--chart-1`. Single-series
  colour, no colour was specified for this chart in the fix brief.
- The Cost context-token sparkline is an estimate (per-bucket calls × that tool's estimated tokens
  per call) because the contract has no cost time series. The author discloses this in
  `reports/dash-v3.md`.
- A `bun run test` run (Visual QA against the Vite dev server) rewrites 26 of the 390 px PNGs, so
  the tree is dirty after it; the author's documented static rerun puts the exact committed bytes
  back. Round 1 recorded the same behaviour and ruled it a different command.
- Everything round 1 listed under "Left in place" (Setup snippets, client-stack colour order, the
  single-scale tool drawer, the one-lane swimlane, the 60-bin demo histogram, Settings sections,
  card stagger) is unchanged and still allowed.

## Probes committed

Under `reports/review-r2/`. All are read-only against a served demo build.

- `variants.mjs` / `variants.json` — the fresh variant for every round-1 finding: an independently
  written composited-contrast and clip scan (it deliberately does **not** import
  `contrast-clip.mjs`) over 11 screens plus both drawers at 1280 and 320 in both themes; the four
  rewritten screens re-inventoried at 390; resolved dot-grid fills; lamp rings in both themes and
  under reduced motion; per-tool drawer histograms; a 16 ms count-up sampler over all six tiles.
- `drawer-contrast.mjs` / `drawer-contrast.json` — the author's own `contrast-clip.mjs` pointed at
  both drawers at 1440 and 390 in both themes, plus the resolved colour triple behind blocker 2.
- `perf-sequence.mjs` / `perf-sequence.json` — every tab switch in one session (blocker 1).
- `perf-screens.mjs` / `perf-screens.json` — the same transitions from a fresh context each time,
  which calibrates the instrument against `performance-qa.mjs`.
- `perf-retention.mjs` / `perf-retention.json` — the counter growth and the forced-GC control.
- `geometry.mjs` / `geometry.json` — drawn geometry against the sr-only table twin for the charts
  the fix pass added or rewired.
- `fidelity-r2.json` / `fidelity-r2-console.txt` — my run of the round-1 `reports/review-r1/fidelity.mjs`.
  The round-1 probe writes in place, so `reports/review-r1/` was restored with `git checkout`
  afterwards and is unchanged from `c70f530`.
- `shots/` — the five 390 px screens from the variants probe, the 320 px tile-label strips, and the
  dark session-drawer timeline.

Not committed: the 1 MB tab-switch trace the fidelity probe writes (its number is in the table
above), the mock screenshots, and the mutated bundle used for the `visual-qa.mjs` mutation test
(the mutation is one literal: `` kind:`line` `` → `` kind:`area` `` in the built JS).
