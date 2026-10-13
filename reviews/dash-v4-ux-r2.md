# Review: dashboard UX pass v4, round 2

VERDICT: changes required

Reviewed `889f2a8` on `vuk88/dash-v2`, the commits since review `fbfdfb1`. No product source was edited. Suites, contrast, the four static captures, and `scripts/ci-conformance.py` held. Two round-1 claims do not.

## Blockers

### 1. Calls-by-client copy says the collector draws one column at 24 hours and ninety at 90 days

The fix brief says the collector is the source of truth, and that calls by client are UTC day buckets on every range. `crates/signals-store/src/analytics.rs` keys `calls_by_client` by `e.ts.date_naive()` and emits a point only for a date that has calls (`"buckets":"day"`). Empty days are absent. A 24-hour window is one column only when every call falls on a single UTC date, and a 90-day window is ninety only when all ninety dates have calls.

`reports/dash-v4-ux.md` says the opposite: "A 24-hour window is one column and a 90-day window is ninety, exactly as the collector answers." `overview.card.calls-by-client` repeats it: "The collector serves this series by day on every range, so a 24-hour window is one column and a 90-day window is ninety." The demo implements that sentence. `demo-analytics.ts` sets `count` to `ceil((to - from) / one day)`, so the frozen demo end draws exactly one point at 24 hours and ninety at 90 days.

Against the live collector, project `bdb93e99-ad50-43d7-9e22-0af1d8fe87bc`:

| range | `calls_by_client` points | shape |
| --- | --- | --- |
| 24h, before the extra event | 1 (`2026-10-12`) | the clock was still inside 12 Oct, so `now - 23h` had not crossed a date |
| 24h, after one accepted call at `2026-10-11T23:59:34.018Z` (age 23.98 h) | 2 (`2026-10-11`, `2026-10-12`) | a 24-hour window is not one column |
| 7d, before that call | 3 (`2026-10-06`, `2026-10-09`, `2026-10-12`) | gaps of 72 h, not seven columns |
| 90d, before that call | 4 (`2026-09-22`, `2026-10-06`, `2026-10-09`, `2026-10-12`) | a 336 h gap, not ninety columns |
| 90d, Calls-by-client table after the extra day | 5 rows | still not ninety |

The open popover on that project, at 24 hours, 7 days and 90 days, was the one-column / ninety sentence above. The card subtitle on all three ranges was `Daily tool calls · UTC`, which is the part of round 1 that closed. Adoption's popover says buckets are UTC days on every range and does not claim ninety. The tool-trend popover says a day with no calls is absent. Latency was `hour` with 25 points at 24 hours and `day` with 8 and 91 points at 7 and 90 days.

Expected: the popover, the report, and the demo describe the series the collector returns — one point per UTC date that has calls, days with none left out. Observed: all three say a 24-hour window is one column and a 90-day window is ninety, and the live series above is 2 and 5.

### 2. The performance walk is reported green and exits 1

`reports/dash-v4-ux.md` lists `bun scripts/performance-qa.mjs --walk` as exit 0, and says the walk was 30 of 30 rows under 50 ms, with `protocol → live` at 45.02 / 47.19 / 42.03 ms, "under budget in all three runs this time." A claim that does not survive the re-run is a blocker.

Re-run, from `web/`, `PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:23342`:

```
Run 1 protocol → live: longest task 53.87 ms (budget < 50 ms)
Run 2 protocol → live: longest task 41.31 ms (budget < 50 ms)
Run 3 protocol → live: longest task 45.50 ms (budget < 50 ms)
```

The script then failed its own assert and exited 1:

```
AssertionError: Longest task exceeded 50 ms: {"run":1,"step":7,"transition":"protocol → live","mainThreadMs":189.73,"longestTaskMs":53.87,...,"longestTaskBudgetMs":50}
```

No other row crossed 50 ms. The highest was `adoption → tools` run 3 at 46.70 ms. The single gate, `PERFORMANCE_REPEATS=15` of `overview → adoption`, exited 0 with longest tasks 31.54–37.25 ms.

The fix brief accepts the pre-existing Live mount and asks that nothing else regress. Nothing else did. What does not survive is the report's claim that this walk is now under the budget and that the command exits 0.

## Should-fix

### The Below SLO explanation still quotes 99.5% and 98% after the saved targets move

The fix brief's named check holds. After saving `slo_targets` `{read:80, mutate:80}` on the same project, the Tools tile read `0`, its meta read `read 80% · mutate 80%`, the Tool health subtitle and the Overview attention caption both carried `read 80% · mutate 80%`, the overview caption was `0 tools below SLO`, and `tools_below_slo` was 0. Restoring `{read:99.5, mutate:98}` returned the tile to `2` and the meta to `read 99.5% · mutate 98%` (`PATCH` 200, then the reliability route and the tile). Ribbon sr-only cells followed the saved target.

The About popover on that tile did not. With the meta already at 80/80, `tools.tile.below-slo` still opened as: "Tools whose success rate in the window is under their class target: 99.5% for read tools, 98% for mutating ones." The same hardcoded pair is still the body of `overview.tile.tool-success`, `overview.card.attention`, `tools.card.health`, and `tool.tile.success`. `settings.card.analytics-settings` does not hardcode the numbers, and the subtitles that go through `targetsText()` did move.

Expected: the explanation a reader opens from the tile states the targets that tile is using. Observed: the tile says 80/80 and its explanation says 99.5/98.

## Verified claims

Round-1 bucket copy, apart from the one-column / ninety sentence in blocker 1. Subtitle `Daily tool calls · UTC` at 24 hours, 7 days and 90 days. Adoption popover: "Buckets are UTC days on every range; only the latency series on Reliability changes with the window." Tool popover: "A tool's trend is grouped by day whatever the range, and a day with no calls is simply absent." Latency bucket `hour` at 24 hours and `day` at 7 days.

Round-1 SLO tile. The 80/80 and restore round trip above. The acceptance line (tile `0`, meta `read 80% · mutate 80%`) held. The explanation is the should-fix.

Round-1 p95 readout. On the live 24-hour overview, keyboard ArrowRight on the p95 sparkline produced `Date: 22:00 p95 latency: 281 ms` and `Date: 23:00 p95 latency: 441 ms`, with empty hours reading `Date: 01:00 p95 latency: No data yet` through `08:00`. No header was `Bucket` or `Value`. The fresh variant, 7 days, read `Date: 10/09 p95 latency: 179 ms`, `Date: 10/11 p95 latency: 143 ms`, `Date: 10/12 p95 latency: 441 ms`. The sparkline length matched `latency_over_time.points` (25, 8, 91), not the calls series.

Round-1 determinism. Four serial `PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:23342 bun scripts/visual-qa.mjs` runs, each exit 0, 160 pngs. The sha256 of each run's sha256 list was `57e4a338811babe2e2ce5a6671c9a93e840d8242e01c2e12ea5e309930fedfd0`. The four lists were byte-identical to each other, and `git status` showed no png diff against `HEAD`, so they also match the tree. The three files named in round 1 matched the author's recorded hashes: `adoption-390-light.png` `59f87fc1…3a07e2`, `tool-drawer-1280-light.png` `e665bbb6…c7ac1e`, `tools-390-light.png` `0d690fd8…66164c`.

Round-1 crosshair. `visual-qa.mjs` no longer has `||true`. It asserts `.chart-stacked-area .tip` count is 1, hover adds `on` with text, and `.xh` opacity is 1. On the demo that readout was `10/08 ChatGPT 1,622 Claude 3,731 Cursor 2,758 total 8,111`, one tip before hover. Fresh variant, the live one-client project renders `data-chart="area"` rather than `stacked-area`: one `.tip`, one `.xh`, hover text `10/11 Review client 1 total 1`.

Round-1 project cards. Live, two cards: 1440 and 1280 were `flex-direction: row`, one row; 390 was `flex-direction: column`, two rows. `visual-qa` asserts one row at 1280 and 1440 and one row per card at 390, and that suite passed inside `bun run test`.

Round-1 skeleton. The committed test delays only `analytics/overview`, samples `.loading-state` every 20 ms, and asserts an unthrottled load paints with no skeleton before 600 ms, and a 300 ms delay shows the skeleton at or after 180 ms and holds it at least 380 ms. `bun run test` and the backend QA inside `ci-conformance.py` both exited 0 with that assertion. Measured on this host as well: unthrottled, 73 samples, skeleton never, content at 263 ms; 150 ms twice, skeleton never, content at 386 ms and 393 ms; 300 ms, skeleton at 382 ms, content and clear at 803 ms, hold 421 ms. The brief's 150 ms case was dropped because it sat on the 200 ms gate, and the product behaviour of that gate held, so it is not re-filed.

Round-1 gauge. Saving burn `3` then `6` both returned HTTP 200. The reliability subtitle changed from "red tick is the 3× alert line" to "the 6× alert line". `visual-qa` asserts the demo gauge label is `3×` after that save, and all four capture runs plus `bun run test` passed that assert. The live SVG text node was not read (the wait timed out after the SLO restore); the subtitle and the passing suite assertion cover the check. Tick-line angles are fractions of the scale and are not supposed to move.

Author suites, re-run from `web/` with `PLAYWRIGHT_CHANNEL=chromium`:

- `bun run check` exit 0.
- `bun run test` exit 0. Snippet, spec, demo shapes, truncated catalogue, analytics, client share, review-r1, review-r2, visual QA, live QA (skeleton held 200/400 ms), reload series. Ordinary reload CLS 0.0015; hard reload 0.0526 from the webfont swap (`NAV`, `FOOTER.app-footer`, `SPAN.nav-thumb`).
- `bun run test:next` exit 0. "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles."

Performance single, as above, exit 0, 31.54–37.25 ms. The author's "every run under 50 ms" claim for the single gate survived. The walk claim did not (blocker 2).

Contrast and clip. `contrastAndClip` returns `{failures, clipped, overflow}` and `visual-qa` fails the run on any entry in the first two. Four serial visual runs and the suite run exited 0, which includes an explanation open on every screen and both drawers, light and dark, 390/1280/1440. A separate 1440×900 pass against the demo, explanation open on Calls by client and again inside the tool drawer:

```
light overviewPopover {failures:[], clipped:[], overflow:[1440,1440]} drawerPopover {failures:[], clipped:[], overflow:[1440,1440]} inViewport true
dark  overviewPopover {failures:[], clipped:[], overflow:[1440,1440]} drawerPopover {failures:[], clipped:[], overflow:[1440,1440]} inViewport true
```

Integrated harness. `python3 scripts/ci-conformance.py` from the repo root, `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:25482/signals`, `ANALYTICS_PG_CONTAINER=dash-v4-ux-r2-pg`, `SIGNALS_URL=http://127.0.0.1:25483`, `ANALYTICS_REVIEW_URL=http://127.0.0.1:25484`, `ANALYTICS_REVIEW_PROBE_PORT=25485`, `SIGNALS_PROBE_LATENCY_BUDGET_MS=900`, `TMPDIR=/var/tmp/v4-ux-r2`. Exit 0. Identity and gzip 52/52 valid and 54/54 invalid, transport PASS, backend browser QA passed (including the saved-SLO tile and the hour-stamped p95 readout), release probe `FINDINGS 0 MISMATCHES 0`. 100k-event medians were all inside 900 ms, overview 147.69 ms through alerts 1.9 ms. `web/dist` was the build from 22:43 UTC, which is after the product commit `ba7c33a` and before `889f2a8` (tests and the report only); it was not rebuilt and not committed.

## Probes committed

None. The probes need the throwaway collector and stayed under `/tmp`.
