# Review: dashboard v5, round 1

VERDICT: approve

Reviewed `7d2eb7e` on `vuk88/dash-v2`, the commits since `c307540` (`2adee4a` through the report commit). No product source was edited. The four review checks hold on the demo and on the real backend, in both themes. One verification gap is filed below; it does not change what the production bundle paints.

## Blockers

None.

## Should-fix

Count-up is part of the approved choreography and is not what the gate measures, and the Vite dev server skips it.

The author brief requires one choreography per navigation that includes count-ups of 640 ms. `DESIGN.md` note 23 lists that timing and says `scripts/choreography-qa.mjs` asserts every timing from the animations themselves. The script sets `COUNT_MS = 640` and writes it into `series.json`. Nothing in the script reads it. The pass line that `bun run test` prints does not mention count-ups, and that run still exits 0.

`Count` in `web/packages/ui/src/analytics-v3.tsx` sets `painted.current = true` and `shown.current = value` (the final value) before the timer, and the cleanup clears the timer. `main.tsx` renders `<StrictMode>`. In development React runs the effect twice, so the second run sees `painted` already true, takes `from` as the final value, and uses a 0 ms wait. The first paint's "0" is replaced by the finished number while the tiles are still rising.

Command, demo Vite on `http://127.0.0.1:23641` (`VITE_DEMO=1`, `PLAYWRIGHT_CHANNEL=chromium`), cold `#overview`, sampling the first tile for 900 ms: the only sample was `"48.2K"`.

The same demo built with `VITE_DEMO=1` and served as static files on `http://127.0.0.1:23642` (no double invoke) does the climb. Cold overview, first tile: `0` at t=0, `1.4K`, `17.5K`, `29.5K`, `37.8K`, `43.2K`, `46.3K`, `47.8K`, `48.2K` at t=696. Navigation overview → tools, the Advertised tile re-queried by label: heading `Tools` and text `"0"` at t=116, then `0.8`, `5.7`, `9.4`, `11.9`, `13.5`, `14.5`, `14.9`, and `"15"` at t=849. That span is the 130 ms tile delay plus the 640 ms ease. Reduced motion on that bundle stayed `"48.2K"`, with no running animations, 19/19 chart SVGs, and `scrollY` 0.

Expected: the suite the report cites as the choreography gate asserts the 640 ms climb, and the server that suite drives shows it. The production bundle already does. Assert the climb against a production build, or make `Count` survive the development double-invoke so the dev server and the gate show the same motion.

## Verified claims

Branch point `c307540`, as `reports/dash-v5.md` names it. Demo server `http://127.0.0.1:23641` unless a command below says otherwise. `PLAYWRIGHT_CHANNEL=chromium`.

### 1. Tab group centred, larger, no overflow, mobile menu intact

Independent probe, both themes, measuring the nav box centre against the bar centre.

| width | delta | label | padding | icon | scrolls | page overflow | brand / actions |
|---|---|---|---|---|---|---|---|
| 1440 | 0 | 15px | 12px | 22×22 | no | no | 188 / 188 |
| 1280 | 0 | 15px | 8px | 22×22 | no | no | 159 / 159 |
| 1024 | 44 | 13px | 6px | 22×22 | no | no | 132 / 44 |
| 390 | 49.1 | 13px | 6px | 22×22 | yes | no | 132 / 34 |

Tab and bar height are 64 px. Ten tabs. The review's measurement points are 1440 and 1280, and both are centred with a 15 px label and a 22 px icon. At 1024 the row does not scroll and the page does not overflow; true centre is only required at ≥ 1280, and the side groups have hit `min-content` (the actions group is the theme toggle alone). At 390 the row scrolls, which the brief allows below 1024.

The active underline at rest on `#tools`, after 700 ms, matches the tab: thumb left 448.125, right 534.125, height 3, against the active tab at 448.1875–534.46875. A measurement at 250 ms is wider because the 420 ms transition uses the bounce ease. That is the ease, not a miss.

Padding is 14 px only at ≥ 1680, 12 px at 1440, and 8 px at 1280. The label is 13 px below 1280. `DESIGN.md` note 22 records that order: ten 15 px tabs cost 699.8 px before padding, and 14 px padding does not fit beside a centred row at 1280. The review's explicit points pass. Not filed.

Mobile menu. The button's computed `display` is `none` at every width measured, from the pre-existing `.mobile-menu{display:none}` rule, which the author reports and does not claim to have changed. Opening the list by clicking the element (the button is not visible to Playwright) adds class `open`: `position: absolute`, `top: 64px`, height 233 px, `flex-wrap: wrap`, 3 rows, 10 links, 0 hidden, no page overflow, `aria-label` "Close navigation". The stacked list hangs off the 64 px bar. Intact in that sense.

### 2. Charts painted with no scroll, choreography, nothing on scroll / resize / poll, longest-task gate

Paint, reduced motion, viewport height 720, `scrollY` 0, light and dark, 1440 and 390, all 11 screens: 44 rows, every chart screen has `svg === charts` and `twin === charts`, below-fold missing 0. Counts at 1440: overview 19 (13 below the fold), adoption 10, tools 14, reliability 5, sessions 3, cost 4, protocol 2, live 3. Callers, Settings, and Setup have 0 charts. No product `IntersectionObserver` remains; the browser still has the constructor.

100 ms series, overview → tools, `scrollY` 0 the whole time. At 78 ms Overview is tiles 6/6, cards 5/5, svg 19/19. Tools at 178 ms is tiles 0/6, cards 0/5, svg 14/14 (charts are built while the cards are still invisible). Tiles then complete 1/6 at 680 ms, 2/6 at 781, 4/6 at 881, 6/6 at 986. Cards complete 1/5 at 881, 2/5 at 986, 3/5 at 1087, 4/5 at 1188, 5/5 at 1289, and hold through 1794 ms. No frame shows a finished card while a tile is unfinished.

Recorded WAAPI delays on Tools: tiles 130, 185, 240, 295, 350, 405 (130 + 55i), duration 520. Cards by sibling index 0@300, 1@385, 2@470, 3@555, 4@640 (300 + 85i, under the 1100 cap), duration 520. Computed shell delays are 0.04 s / 0.09 s / 0.14 s with animation-name `v3-rise`. Those three nodes live in the shell (`main.tsx`) and do not remount on a tab click, so the CSS animation does not replay; `choreography-qa.mjs` asserts the computed delay, which is what was measured. Tile and card entrances do replay on each navigation, and the suite checks that.

Draw-in, navigating to `#cost` while animations were still pending. Tile 0 spark `v3-spark-reveal` delay 310 ms, which is 130 + 180. Card 1 `v3-grow-y` carries `--cd: 526ms` and `--draw-in: 565ms`, which is card delay 385 + 180; the per-bar delays then add `--pd`. Zero running card charts had a zero delay. StrictMode records each entrance twice on the dev server; the delays are the same both times.

Scroll to 900, 2200, and 1600, and a resize to 1100×800: 0 new entrances, 0 running draw-ins, charts still 19/19.

Poll. `page.clock` installed, fast-forward 3 s then 60 s, comparing animation name, target, and start time. Loads 1 → 2. One fresh running animation: `dot-pulse` on `.signal-dot`. No chart, tile, or card animation started. An earlier play-state list that still said "running" after the clock jump was the frozen entrance timeline, not a new run.

Longest task, against the same demo. `PERFORMANCE_REPEATS=15`: median 34.08 ms, p90 40.41 ms, range 32.44–40.58 ms, 0 over budget. Exit 0. `--walk`, 30 rows: median 31.04 ms, p90 44.97 ms, range 17.70–49.58 ms, 0 over budget. The three `protocol → live` rows were 42.15, 48.53, and 49.58 ms, each under the 60 ms Live exception. Exit 0. These two runs rewrote `web/artifacts/v3/performance.json`, `performance-walk.json`, and `tab-switch-trace.json`. Restored before this commit.

### 3. No divider between the drawer tiles and the content

Reduced motion, 1440, both themes, tool `search_products` and the first sessions row. Drawer header `border-bottom-width` is 0 in both. Tool tiles border is 0, three tiles, the next sibling is `section.card` with its own 1 px border, and the gap is the tiles' 20 px margin. The session drawer has no tiles; the next sibling is `p.mono.hint` with `border-top` 0, and a pixel strip of that gap has no full-width run. A first pixel-row detector fired on tile corners and drop shadows. The crops show rounded tile edges, not a rule across the drawer. Not filed.

### 4. No backdrop-filter, scrim colour, sharp page, determinism without the mask

With a drawer open, `backdrop-filter` is `none` on `::backdrop`, on `.topbar`, and on every element (the filtered list is empty). The top bar paints the opaque theme background (light `oklch(0.93 0.012 72)`, dark `oklch(0.188 0.013 70)`).

Light scrim is `oklch(0.22 0.013 70 / 0.28)`, and `--ink-hard` is `oklch(0.220 0.013 70)`. That is the token at 28%. Dark scrim is `oklch(0.22 0.013 70 / 0.4)`. Dark `--ink-hard` is the gold accent `oklch(0.845 0.152 82)`, so a literal `color-mix` of the token would be gold at 40%. Note 25 says the dark rule names the same hard ink the light theme resolves, rather than that accent. The page behind is unfiltered. Not filed.

`git diff c307540 -- web/scripts/visual-qa.mjs` removes `mask: [page.locator('.topbar')]` from the tool and session drawer screenshots and asserts SVG, twin, `scrollY === 0`, and no unpainted card.

Four serial runs against `http://127.0.0.1:23641`:

```
run 1 exit 0  2026-10-13T06:48:08Z  160 pngs
run 2 exit 0  2026-10-13T06:51:06Z  identical to run 1
run 3 exit 0  2026-10-13T06:54:04Z  identical to run 1
run 4 exit 0  2026-10-13T06:57:02Z  identical to run 1
```

Each printed the visual-QA pass line (SVG/table twins, nothing scrolled, no unpainted card, unmasked drawers). Contrast and clip failures are pushed by that script as `Contrast` / `Clip` lines; none appeared, so the count is 0. The sha256 list matches `web/artifacts/v5/static-capture-sha256.txt`, and the 160 blobs match `HEAD`. Digest of the list: `e89a9772eb4a4946d1780ba02912ea52e823a90f3d5acf49843472df62f3e967`.

### Author suites

From `web/`, `PLAYWRIGHT_CHANNEL=chromium`.

- `bun run check` exit 0. `tsc` and eslint produced no output.
- `bun run build` exit 0. `dist/assets/index-3r2kPaR2.js` 387.91 kB, gzip 120.30 kB, built in 516 ms. The author's hash was `index-5Td7uw7u.js` at the same sizes. The bytes differ because this review rebuilt; the size matches. `web/dist` is gitignored and was not committed. `ci-conformance.py` served this build.
- `bun run test` exit 0. Snippet, spec, demo shapes, truncated catalogue, analytics, client share, review-r1, review-r2, visual QA, live QA, choreography QA, reload series. Ordinary reload CLS 0.0020; hard reload 0.0574 from the webfont swap (`NAV`, `FOOTER.app-footer`, `DIV.topbar-actions`). The choreography frames under `web/artifacts/v5/choreography/` changed, which the author report already places outside the byte-identity gate. Restored.
- `bun run test:next` exit 0. "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles."

`python3 -u scripts/ci-conformance.py` from the repo root. `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:25640/signals`, `ANALYTICS_PG_CONTAINER=dash-v5-r1-pg`, `SIGNALS_URL=http://127.0.0.1:25650`, `ANALYTICS_REVIEW_URL=http://127.0.0.1:25651`, `ANALYTICS_REVIEW_PROBE_PORT=25652`, `SIGNALS_PROBE_LATENCY_BUDGET_MS=900`, `TMPDIR=/var/tmp/dash-v5-r1`. Exit 0. Identity and gzip 52/52 valid and 54/54 invalid, transport PASS, backend browser QA passed (real v3 analytics, project cards, 60 s refresh, skeleton 200/400, funnel, SLO round-trip, hour-stamped 24-hour readout, 400, CSRF, logout). Release build finished in 33.84 s. Probe `FINDINGS 0 MISMATCHES 0`. 100k-event medians, all inside 900 ms: overview 146.41, adoption 251.95, tools 117.13, reliability 107.39, cost 136.64, protocol 74.35, digest 166.47, alerts 0.84, timeline 7.53.

## Probes committed

None. The measurement scripts stayed under `/tmp/review-v5` and were not committed.
