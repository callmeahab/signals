# Review: dashboard UX pass v4, round 3

VERDICT: changes required

Reviewed `e9dafce` on `vuk88/dash-v2`, the commits since review `d44c017`. No product source was edited. The two round-2 blockers and the should-fix are closed. The walk's 60 ms exception holds and nothing else in that walk crossed 50 ms. The single performance gate does not.

## Blockers

### 1. The single performance gate exits 1 on a transition that is not the exception

The fix brief allows one documented exception, `protocol → live` at 60 ms, and keeps 50 ms for every other transition. `reports/dash-v4-ux.md` lists `PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs` as exit 0, with `overview → adoption` at 32.17–40.17 ms and the exception used on no row. A claim that does not survive the re-run is a blocker.

Re-run, from `web/`, `PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:23353 PERFORMANCE_REPEATS=15`. Fourteen runs were 32.39–41.67 ms. Run 12 was not:

```
Run 12 overview → adoption: 153.46 ms aggregate (informational); longest task 55.96 ms (budget < 50 ms)
```

The script then exited 1:

```
AssertionError: Longest task exceeded 50 ms: {"run":12,"step":1,"transition":"overview → adoption","mainThreadMs":153.457,"longestTaskMs":55.958,"recalcStyleMs":21.829,"nodes":3070,"listeners":395,"longestTaskBudgetMs":50}
```

`overview → adoption` is not in `longestTaskExceptionsMs`. The walk, run immediately afterwards, kept that same transition at 33.15 / 33.36 / 36.70 ms and exited 0, so the host can do the switch inside the budget. This sample of the gate the report calls green does not.

## Should-fix

None.

## Verified claims

Round-2 calls-by-client copy. On live project `fd4787b7-8951-4551-943a-2108b1d2c29e`, after calls on 2026-10-13, 2026-10-12 23:30Z, 2026-10-10 and 2026-10-03 (23 accepted, 0 rejected):

| range | points | gaps | table rows | subtitle |
| --- | --- | --- | --- | --- |
| 24h | `2026-10-12`, `2026-10-13` | 24 h | 2 | `Daily tool calls · UTC` |
| 7d | `10-10`, `10-12`, `10-13` | 48 h, 24 h | 3 | same |
| 30d and 90d | `10-03`, `10-10`, `10-12`, `10-13` | 168 h, 48 h, 24 h | 4 | same |

`buckets` was `day` on every range. The open popover on all four ranges was: "The collector emits one point per UTC date that has calls and leaves out the dates with none, so a 24-hour window can span two dates and a 90-day window has as many columns as it has days with calls." It does not say one column or ninety. Fresh variant, the demo at the frozen clock: 24h is 1 row, 7d is 5 (not 7), 90d is 77 (not 90), same subtitle and the same popover. Adoption's popover still says buckets are UTC days on every range and does not claim a filled grid.

Round-2 walk. `bun scripts/performance-qa.mjs --walk` against the same demo server exited 0. The exception printed on all three Live rows:

```
Run 1 protocol → live: longest task 52.69 ms (budget < 60 ms, documented exception against the 50 ms every other transition keeps: the pre-existing Live mount)
Run 2 protocol → live: longest task 40.48 ms (budget < 60 ms, documented exception …)
Run 3 protocol → live: longest task 43.74 ms (budget < 60 ms, documented exception …)
```

The written artifact records `longestTaskExceptionsMs` as `{ "protocol → live": 60 }` and `longestTaskBudgetMs` 50. The other 27 rows were 13.17–49.94 ms, all under 50. The highest was `adoption → tools` run 2 at 49.94 ms. Nothing else used the table, and no Live row reached 60.

Round-2 explanations. Saving `{read:80, mutate:80}` returned HTTP 200 with that body. The Tools tile read `0` / `read 80% · mutate 80%`, and the Below SLO popover was "80% for read tools, 80% for mutating ones" with no `99.5%`. The Overview tool-success popover and the tool-drawer Success popover both said 80% as well, and the Overview caption was `0 tools below SLO`. Restoring `{read:99.5, mutate:98}` returned the tile to `2` / `read 99.5% · mutate 98%`, and all three popovers quoted 99.5% and 98%. `backend-qa` inside `ci-conformance.py` also passed its check that the Below SLO popover contains `80%` and not `99.5%`.

Earlier closed findings, still closed. Live 24h p95 readout `Date: 02:00 p95 latency: No data yet`; 7d `Date: 10/07 p95 latency: No data yet`. No `Bucket` or `Value` header. Project cards, three of them: 1440 and 1280 were one row, `flex-direction: row`; 390 was three rows, `flex-direction: column`. `bun run test` passed visual QA (crosshair, gauge label, card rows, contrast), live QA (skeleton held 200/400 ms) and the reload series. Ordinary reload CLS 0.0015; hard reload 0.0543 from the webfont swap (`NAV`, `FOOTER.app-footer`). The strip-height line now says the strip holds once the webfonts have loaded.

Author suites, re-run from `web/` with `PLAYWRIGHT_CHANNEL=chromium`:

- `bun run check` exit 0.
- `bun run test` exit 0. Snippet, spec, demo shapes, truncated catalogue, analytics, client share, review-r1, review-r2, visual QA, live QA, reload series.
- `bun run test:next` exit 0. "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles."

Performance single did not survive (blocker 1). The walk did.

Contrast and clip. Four serial visual runs call `contrastAndClip` and exit 1 on any failure; all four exited 0. A separate 1440×900 pass, explanation open on Calls by client and again inside the tool drawer:

```
light overviewPopover {failures:[], clipped:[], overflow:[1440,1440]} drawer {failures:[], clipped:[], overflow:[1440,1440]} inViewport true
dark  overviewPopover {failures:[], clipped:[], overflow:[1440,1440]} drawer {failures:[], clipped:[], overflow:[1440,1440]} inViewport true
```

Four serial `visual-qa.mjs` runs against `http://127.0.0.1:23353`, each exit 0. All 160 tracked `web/artifacts/v3/*.png` files. The sha256 of each run's sha256 list was `1358a81f587822d34e3c63124eb036d19c536fcee36ce4170e7b2735c49778a5`, the four lists were byte-identical, and `git status` showed no png diff against `HEAD`. The report's "116" is not the number of pngs in that directory; the identity it was proving holds for the whole set.

Integrated harness. `python3 scripts/ci-conformance.py` from the repo root, `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:25492/signals`, `ANALYTICS_PG_CONTAINER=dash-v4-ux-r3b-pg`, `SIGNALS_URL=http://127.0.0.1:25493`, `ANALYTICS_REVIEW_URL=http://127.0.0.1:25494`, `ANALYTICS_REVIEW_PROBE_PORT=25495`, `SIGNALS_PROBE_LATENCY_BUDGET_MS=900`, `TMPDIR=/var/tmp/v4-ux-r3`. Exit 0. Identity and gzip 52/52 valid and 54/54 invalid, transport PASS, backend browser QA passed, release probe `FINDINGS 0 MISMATCHES 0`. 100k-event medians were inside 900 ms: overview 147.2, adoption 245.15, tools 126.78, reliability 108.43, cost 134.26, protocol 71.49, digest 159.39, alerts 0.81, timeline 11.19. `web/dist` was the build from 01:29 UTC, after the product commit `737c8e1` and before the report-only commit `e9dafce`. It was not rebuilt and not committed.

## Probes committed

None. The probes need the throwaway collector and stayed under `/tmp`.
