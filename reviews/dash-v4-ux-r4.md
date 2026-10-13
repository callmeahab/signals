# Review: dashboard UX pass v4, round 4

VERDICT: approve

Reviewed `9dc1811` on `vuk88/dash-v2`, the commits since review `eaf869f` (`ecfcb8a` and the report commit). No product source was edited. The statistical single gate, the walk, and the pointer-click check hold. Earlier findings stay closed.

## Blockers

None.

## Should-fix

None.

## Verified claims

Round-3 gate. The fix brief says single mode asserts the median and the 90th percentile of the repeats under 50 ms, allows one run over 50 ms if it stays under 70 ms and is printed as an outlier, and fails a second outlier or any run at or above 70 ms. The walk keeps the 50 ms budgets and the documented `protocol → live` exception at 60 ms, and applies that same one-outlier rule across its 30 rows. `web/scripts/performance-qa.mjs` and item 20 of `web/packages/ui/DESIGN.md` say that. Re-run from `web/` against `http://127.0.0.1:23354` (`VITE_DEMO=1`), `PLAYWRIGHT_CHANNEL=chromium`.

First `PERFORMANCE_REPEATS=15`, exit 0. Run 3 was the only row over 50 ms, and it was under 70:

```
Run 3 overview → adoption: longest task 52.92 ms (budget < 50 ms) — OUTLIER, over its 50 ms budget; 1 is tolerated under 70 ms
15 repeats of adoption: longest task median 35.21 ms, p90 41.21 ms, range 33.07–52.92 ms; 1 over budget (1 tolerated under 70 ms)
```

Second `PERFORMANCE_REPEATS=15`, exit 0, no outlier:

```
15 repeats of adoption: longest task median 36.26 ms, p90 37.18 ms, range 32.59–43.41 ms; 0 over budget (1 tolerated under 70 ms)
```

Walk, exit 0. The exception printed on each Live row, and each of those rows was under 60 ms. Nothing else was over its budget. The highest non-excepted row was `reliability → sessions` run 1 at 47.25 ms.

```
Run 1 protocol → live: longest task 50.63 ms (budget < 60 ms, documented exception against the 50 ms every other transition keeps: the pre-existing Live mount)
Run 2 protocol → live: longest task 43.69 ms (budget < 60 ms, documented exception …)
Run 3 protocol → live: longest task 43.90 ms (budget < 60 ms, documented exception …)
Walk, 30 rows: longest task median 34.07 ms, p90 43.94 ms, range 14.12–50.63 ms; 0 over budget (1 tolerated under 70 ms)
```

An earlier walk, started while another checkout on this host began compiling, exited 1: `adoption → tools` run 2 at 74.77 ms, `reliability → sessions` run 3 at 143.41 ms, and `adoption → reliability` run 3 at 66.70 ms, so the ceiling and the one-outlier rule both fired. That sample is not the one above. The quiet re-run is.

The author's other-way exercise, `PERFORMANCE_SCREEN=live PERFORMANCE_REPEATS=5`, still fails when p90 is over 50 even though the single outlier is under 70. Exit 1:

```
5 repeats of live: longest task median 49.54 ms, p90 50.60 ms, range 48.65–50.60 ms; 1 over budget (1 tolerated under 70 ms)
AssertionError: 90th-percentile longest task 50.60 ms is not under 50 ms
```

Pointer click. Item 21 of `DESIGN.md` and `charts/index.tsx` make a document `pointerdown`/`keydown` flag the authority, and consult `:focus-visible` only while that flag is still unset. `visual-qa.mjs` moves the pointer off the plot, waits one frame, and asserts both `.chart-key-tooltip` and the keyboard readout are absent. Three serial runs with one busy loop per core (16), load 16.20 during the first run and 18.95 / 19.85 at the start of the next two, each exited 0. The failure text "a pointer click opened the chart readout" did not appear in any log.

Earlier findings, still closed. Demo at the frozen clock, Calls by client: 24h is 1 row, 7d is 5, 90d is 77, subtitle `Daily tool calls · UTC` on each, headers `Date` plus the client names, and the popover is the sparse sentence ("one point per UTC date that has calls…"). It does not say one column or ninety. Adoption's popover still says buckets are UTC days on every range. `bun run test` passed visual QA, which checks project cards (one row at 1280 and 1440, stacked at 390), the gauge's saved burn mark, the Below SLO popover quoting 80% and not 99.5% after a saved read target, and contrast. Live QA: skeleton held 200/400 ms. Ordinary reload CLS 0.0015; hard reload 0.0534 from the webfont swap (`NAV`, `FOOTER.app-footer`). `ci-conformance.py` passed the live Below SLO round-trip (tile, meta, popover without `99.5%`, overview caption) and the hour-stamped 24-hour p95 readout. No chart column was `Bucket` or `Value`.

Four serial capture runs, hashing all 160 tracked pngs under `web/artifacts/v3`. Each exited 0. The four sha256 lists were identical. The digest of that list was `1358a81f587822d34e3c63124eb036d19c536fcee36ce4170e7b2735c49778a5`, the same digest round 3 recorded, and `git diff` showed no png change against `HEAD`.

Author suites, from `web/`, `PLAYWRIGHT_CHANNEL=chromium`:

- `bun run check` exit 0.
- `bun run test` exit 0. Snippet, spec, demo shapes, truncated catalogue, analytics, client share, review-r1, review-r2, visual QA, live QA, reload series.
- `bun run test:next` exit 0. "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles."

Integrated harness. `python3 scripts/ci-conformance.py` from the repo root, after `cargo build --locked --bin signals` so `target/debug/signals` existed. `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:25497/signals`, `ANALYTICS_PG_CONTAINER=dash-v4-ux-r4-pg`, `SIGNALS_URL=http://127.0.0.1:25520`, `ANALYTICS_REVIEW_URL=http://127.0.0.1:25521`, `ANALYTICS_REVIEW_PROBE_PORT=25522`, `SIGNALS_PROBE_LATENCY_BUDGET_MS=900`, `TMPDIR=/var/tmp/v4-ux-r4`. Exit 0. Identity and gzip 52/52 valid and 54/54 invalid, transport PASS, backend browser QA passed, release probe `FINDINGS 0 MISMATCHES 0`. 100k-event medians were inside 900 ms: overview 143.01, adoption 251.32, tools 132.15, reliability 109.91, cost 138.63, protocol 84.94, digest 165.25, alerts 2.04, timeline 8.45. `web/dist/index.html` is the build from 03:14 UTC, after the product commit `ecfcb8a` (02:32 UTC) and before the report-only commit `9dc1811`. It was not rebuilt for this review and not committed.

## Probes committed

None. The demo copy check stayed under `/tmp`.
