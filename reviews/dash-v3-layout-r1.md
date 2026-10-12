# Review: dashboard v3 layout and client share

Reviewed `aa6f89003bdea1695e21170e7df7972b5c518c04` on `vuk88/dash-v2` (commits since `422b22f`). Author brief `briefs/v3/dash-v3-layout.md`, contract amendment "client share" in `briefs/v2/analytics-api.md`, author report `reports/dash-v3-layout.md`.

VERDICT: changes required

## Blockers

### 1. Sessions table still shares a row with the fixed client donut

The session list is a per-entity table (12 body rows, one per demo session) and sits beside the fixed-height "Sessions by client" donut at 1280 and 1440, in both themes. The replay card is already on its own row. `web/packages/ui/DESIGN.md` item 6 says the opposite of what is on screen: "Sessions' replay and session table already occupy separate rows."

Command:

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27680 bun ../reports/review-dash-v3-layout/layout.mjs
```

Observed (exit 1, four failures, nothing else):

```text
sessions/1280/light: per-entity list shares a row {"titles":["The story of a connection","Sessions by client"],"widths":[687,485],"heights":[780,310],"covered":1172,"entities":["The story of a connection"]}
sessions/1280/dark: per-entity list shares a row {"titles":["The story of a connection","Sessions by client"],"widths":[687,485],"heights":[780,310],"covered":1172,"entities":["The story of a connection"]}
sessions/1440/light: per-entity list shares a row {"titles":["The story of a connection","Sessions by client"],"widths":[687,485],"heights":[780,310],"covered":1172,"entities":["The story of a connection"]}
sessions/1440/dark: per-entity list shares a row {"titles":["The story of a connection","Sessions by client"],"widths":[687,485],"heights":[780,310],"covered":1172,"entities":["The story of a connection"]}
```

The table headers are Client, Caller, Started, Duration, Depth, Errors, Outcome, Transport, Reason, with 12 body rows. `SessionsScreen` in `web/packages/ui/src/dashboard.tsx` puts that table in `<Panel className="s7">` and the donut in `<Card span={5}>` inside the same `.grid`. At 390 both cards are full width and stacked (tops 2158 and 2721). At 768 the max-width 820 rule also stacks them. The author's `visual-qa.mjs` full-width title list does not include this card, so the green visual-qa log does not cover it.

Expected: author brief section 2, "a card whose height is data-driven and unbounded (a list/table with one row per entity) gets its own full-width row; a fixed-height chart may only sit beside another fixed-height chart," and "Sessions ... audit for the same pattern (any card with a per-entity list beside a fixed chart) and apply the rule." The 310px donut is a fixed chart. The table must occupy its own full-width row at 1280 and 1440.

## Should-fix

None.

## Verified claims

| Claim | Result |
| --- | --- |
| `cargo fmt --all --check` | Passed. Empty diff. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed. Finished dev profile in 31.37s. |
| `cargo test --workspace` | Passed. `analytics::tests::client_share_measures_calls_not_sessions` ok. Ignored tests stayed ignored. |
| Release ignored DB tests, no `SIGNALS_BENCH_REUSE` | Passed. `cargo test --release --workspace -- --ignored --test-threads=1` against Postgres on `127.0.0.1:27710` (`--shm-size=1g`). `thirty_day_dashboard_measurements` ok in 607.11s on 1,000,000 rows, project `a0d96580-43ff-4781-a644-5340271c6618`, window 2026-09-12 to 2026-10-12. p95 ms: overview 35.91, timeseries 37.70, tools 25.26, callers 17.61, session_events 15.23, tool_timeseries 12.88, events 7.68, sessions 2.27, caller_history 1.92. All under 50. |
| `bun run --cwd web check` | Passed (`build:ui`, tsc, eslint). |
| Production bundle | Built with the dashboard Vite config to `/tmp/dash-layout-r1/demo` in 194ms. CSS `index-Dp9XnY0Z.css`, JS `index-BjcZIOmK.js` 359.38 kB. Same CSS hash the author reported. Served at `http://127.0.0.1:27680`. |
| `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test` | Passed on `SIGNALS_TEST_UI_PORT=27830`. Includes "Client share QA passed: 27 clients, repeated versions, coherent calls/sessions and null shares without calls." |
| `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test:next` | Passed on `SIGNALS_NEXT_PORT=27831`. "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles." |
| Tile grid, check (1) | Layout probe, 1440 and 1280, light: Overview, Adoption, Tools, Reliability, Sessions, Cost, Protocol are all 3 columns × 2 rows. 768 is 2 × 3. 390 is 1 × 6. Overview spark SVGs are 108px tall, plot range `viewBoxHeight - 10` = 98px, width delta 0 against the tile. Tile min heights are 240–248. Tools, Reliability, and Protocol tiles have no spark because those tiles have no `values`; the grid is still the shared one. |
| Count-up and stagger | Motion probe exit 0. Tile delays exactly 130, 185, 240, 295, 350, 405 ms, duration 520, easing `cubic-bezier(0.2, 0.8, 0.3, 1)`. Count-up spans start at 0 and run 574–641 ms. Reduced motion is `[]`. Histogram is 60 bars, 520 ms, delay step 12 ms through 708. A scrolled card carries delay 640. |
| Full-width entity lists other than Sessions, check (2) | At 1440 and 1280, Calls by client, Client mix, Tools needing attention, Clients, Transport and protocol, Tool health, Tool performance, Top tool paths, By tenant, and Billing periods are full width. Funnel (485×381) shares with weekly retention (687×280). Latency shares with Catalogue. Treemap shares with payload. Active identities share with identity quality. Live Event mix shares its row with two fixed cards (384/384/384); the brief allows that bounded set. No lone fixed card was left beside an empty column. 390 is a single column. |
| 27-client legend | 27 rows, 26 arcs, 1 zero-call client omitted, nothing beside the mix. Legend columns: 3 at 1280 and 1440, 1 at 390 and 768. Worst arc-length share versus call share is 0.0013 (Client 01). |
| Adoption shows the same share | Headers are Client, Share of calls, %, Sessions, Calls, Capabilities. Overview legend percents match the Adoption % column for the 3-client demo (46/34/20) and the 27-client demo. |
| Ingested `clients[].pct`, check (3) | `python3 scripts/ci-conformance.py` exit 0. `FINDINGS 0 MISMATCHES 0`. The probe asserts each `pct` equals calls/total×100 at one decimal and that the shares sum to 100±0.1. Harness screen medians (budget 900 ms, not the 50 ms read gate): overview 144.68, adoption 262.64, tools 128.8, reliability 105.33, cost 131.59, protocol 72.67. Donut arc lengths above were measured on the demo renderer, which is the same `donut()` the live screen uses, fed `value: c.calls`. |
| Contrast and clip | 70 scans, 0 contrast failures, 0 clipped. |
| Performance gate | Production preview, quiet machine. 15 separate `bun scripts/performance-qa.mjs` processes, all exit 0. Longest task 8.88–19.68 ms (max 19.68), aggregate max 124.49 ms. One `bun scripts/performance-qa.mjs --walk` (3 repeats × 10 steps): longest task max 19.981 ms, none ≥ 50. |
| Deterministic screenshots | Two serial `BASE_URL=http://127.0.0.1:27680 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs` runs, both exit 0. 116 PNGs byte-identical to each other and to the committed `web/artifacts/v3` tree. Artifacts restored after the runs. |
| `cargo sqlx prepare --workspace --check` | Passed against the migrated database on port 27710. Finished dev profile in 5.56s. No stale-query error. |

Not filed:

- The author's debug-mode million-row p95 over 50 ms. The gate is the release serial run, which passed here without `SIGNALS_BENCH_REUSE`.
- The author's development-server walk over 50 ms. The production walk stayed under the gate.
- One-decimal shares that cannot always sum to 100±0.1. The author documented that edge. The ingested harness fixture satisfied the probe.
- Tiles with no sparkline where the screen does not pass `values`. The brief asks for the same tile grid.
- Live Event mix sharing a row. The brief allows it.

The motion probe is the r3 evidence script plus one scroll: after opening Tools it calls `scrollIntoViewIfNeeded` on `.chart-histogram` before waiting for the SVG. Tiles at 240px put the histogram below the first viewport, and the chart paints on intersection. The timing assertions are unchanged. The first run timed out in the wait; the second run exited 0. That is a probe adaptation, not a product motion defect.

## Probes committed

- `reports/review-dash-v3-layout/layout.mjs` and `layout.json` (the four Sessions failures and the passing measurements).
- `reports/review-dash-v3-layout/motion.mjs` and `motion.json` (exit 0, with the histogram scroll noted above).

Postgres containers `dash-v3-layout-r1-pg` and `dash-v3-layout-r1-ci`, and the preview on port 27680, were removed after these runs. Nothing was pushed.
