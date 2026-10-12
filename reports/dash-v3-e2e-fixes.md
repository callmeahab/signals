# Dashboard v3 end-to-end fixes

Fixes the two findings in `evidence/collector/reports/e2e-v3.md` — blocker 1 (the
activation funnel replaced counted steps with the whole-chart empty state) and
should-fix 1 (Sessions, WAU, MAU and stickiness had no per-bucket series to draw) —
against the two amendments dated 2026-10-12 in `briefs/v2/analytics-api.md`.

Branch `vuk88/dash-v2`, starting from collector main `c4b3967`.

## What changed, by file

### 1. Funnel null step

- `web/packages/ui/src/charts/index.tsx`
  - `Funnel` falls back to the whole-chart empty state only when the step array is
    empty or its **first** step has no count. Any later `count: null` is painted as a
    null step inside the chart. The table twin renders `—` for a null `count` and a
    null/absent `dropoff_pct`, so chart and twin agree.
  - `Conversion` plots only up to the last step that has a count, so the curve spans
    the full plot and ends at `five_calls` instead of trailing into empty space. The
    table twin still lists every step, with `—` for the ones it cannot plot.
- `web/packages/ui/src/charts/renderers.js` — `funnel()`
  - A step with `count == null` renders as its own row: a dashed empty track
    (`rect.nullstep`, `--viz-track` fill, `--viz-ghost` dashes) with the step label,
    the caption `Waiting · <eligible> eligible`, and `—` in the value column. It does
    not scale the painted bars and no drop-off wedge is drawn across it.
  - The drop-off figure is now rendered only where the response actually carries
    `dropoff_pct`. Overview's funnel has no `dropoff_pct` per the contract, so it used
    to print a false `−0%` on every step after the first.

### 2. Collector adoption trend series

- `crates/signals-store/src/analytics.rs`
  - New `Data::rolling_identities(f, span, ends)`: distinct identities in the
    `span`-day window ending at each bucket end. One `selected()` pass over the widest
    span any bucket needs, then a two-pointer slide over the already-sorted facts, so
    a 90-bucket series costs the same two passes as a 7-bucket one. It adds no SQL, so
    the analytics read still never touches raw `events` partitions.
  - `Data::adoption` now emits `sessions`, `wau` and `mau` on every `active.points[]`
    entry. `sessions` attributes each distinct session to the bucket holding its first
    selected event, which makes the per-bucket counts sum to the Overview sessions
    tile by construction; the whole series is `null` when no selected event carries a
    session id. `wau`/`mau` use the same identity model as the headline `dau`/`wau`/
    `mau`, end at the bucket end clamped to the window end, and therefore satisfy
    `mau >= wau >= users` for their own bucket.
  - New unit test `adoption_trend_series` covers the three fields, the sum identity,
    the rolling windows reaching behind the window start, the clamped final bucket
    matching the headline totals, and the null-session case.
- `crates/signals-server/src/openapi.rs` — `AnalyticsAdoption.active.points[]` gains
  the three nullable integers.
- `crates/signals-server/tests/analytics.rs` — the ignored three-day contract test now
  asserts the three fields, the sum identity and the ordering invariants.
- `docs/analytics.md` — new "Adoption trend series" section, plus the funnel null-step
  rendering rule added to the funnel definition.

### 3. Dashboard tiles and demo data

- `web/packages/ui/src/analytics-types.ts`, `web/scripts/analytics-shapes.mjs` —
  `sessions`, `wau` and `mau` are required (nullable) on an adoption point, not
  optional additions. `TilesV3`, the Adoption tiles and the Sessions-page tile already
  read `points[].sessions`, `p.wau`, `p.mau` and `p.users / p.mau * 100`; `Sparkline`
  already shows "Waiting for trend" only when every sample is null, so those read real
  series now that the collector sends them.
- `web/apps/dashboard/src/demo-analytics.ts`, `demo.ts`, `main.tsx` — third demo
  project `demo-fresh` ("Northwind MCP · first week"): same numbers, but
  `returned_day_7` is `{count: null, dropoff_pct: null, eligible: 0}` and `d7`/`d30`
  retention are null, which is what a window younger than a week can actually measure.
  The demo adoption points already carried `sessions`, `wau` and `mau`.

### 4. Checks

- `web/scripts/visual-qa.mjs` — per theme and width, selects `demo-fresh` and asserts
  the Overview funnel paints four bars plus exactly one `rect.nullstep`, shows no
  empty state, carries the `Waiting · 0 eligible` caption, and reads
  `returned_day_7/ — / —` in its table twin; then that the Adoption conversion curve
  has four points, never labels `returned day 7`, and shows `—` in its twin. Contrast
  and clipping are scanned on both, and both are captured
  (`artifacts/v3/funnel-null-overview-*.png`, `funnel-null-adoption-*.png`).
- `web/scripts/backend-qa.mjs` — against real ingested collector data: funnel counts
  `[1,1,1,1,null]` with `eligible 0` on both routes, four painted bars and one null
  step on screen, every adoption point carrying integer `sessions`/`wau`/`mau` with
  `mau >= wau >= users`, the session sum equalling the sessions tile, the last bucket
  equalling the headline `wau`/`mau`, and the Sessions / WAU / MAU / Stickiness tiles
  drawing sparklines instead of "Waiting for trend".
- `web/scripts/spec-qa.mjs` — shape validation now covers all three demo projects, and
  asserts the fresh project's day-7 null step on both routes.
- `scripts/analytics-review-probe.py` — `expect_adoption` reproduces `sessions`, `wau`
  and `mau` independently in Python (so the existing route diff covers them), a new
  `adoption_trend` check asserts the three fields exist and are integers or null with
  `wau >= users` and `mau >= wau` on every bucket, and a new block compares the summed
  per-bucket `sessions` with the Overview sessions tile for every window and filter.

## Verification

All commands were run from the worktree `/home/vuk/orca/workspaces/signals-collector/dash-v2`
with `PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH`. The database for every Rust and
integrated run was a dedicated container `dash-v3e2e-pg` (`postgres:18.6-bookworm`,
`--shm-size=1g`, host port `127.0.0.1:25482`), created for this task and removed at the
end. Ports used: 23340 (static demo server), 25482 (Postgres), 25483 (conformance
collector), 25484/25485 (review probe), 25486 (adoption timing collector).

### Rust

```sh
cargo fmt --all --check
```
```text
(no output, exit 0)
```

```sh
cargo run --locked -p signals-xtask -- --check
```
```text
Official schemas parsed; runtime validation replaces generated wire types
```

```sh
cargo clippy --locked --workspace --all-targets -- -D warnings
```
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.58s
(exit 0)
```

```sh
cargo test --locked --workspace
```
```text
28 passed, 0 failed, 9 ignored across all targets (exit 0)
test analytics::tests::adoption_trend_series ... ok
test analytics::tests::funnel_and_cohorts ... ok
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

```sh
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25482/signals
cargo build --locked --bin signals && target/debug/signals migrate
docker exec -i dash-v3e2e-pg psql -U postgres -d signals -v ON_ERROR_STOP=1 < .sqlx/dev.sql
```
```text
Migrations applied
CREATE TABLE
```

```sh
cargo sqlx prepare --check --workspace -- --all-targets
```
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.40s
(exit 0; no query data changes)
```

```sh
export TEST_DATABASE_URL=postgres://postgres:signals@127.0.0.1:25482/signals
cargo test --locked -p signals-server --test integration --test rollup_properties \
  --test histogram_eligibility --test analytics --test v11 -- --ignored --test-threads=1
```
```text
test three_day_analytics_contract_and_idempotence ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.23s
test histogram_eligibility_avoids_raw_partitions_and_tracks_late_arrivals ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.37s
test collector_replays_late_rollups_tenant_isolation_and_keys ... ok
test migration_comment_cleanup_preserves_existing_databases ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.79s
test random_lateness_matches_brute_force_sql ... ok
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 27.51s
test v11_storage_protocol_and_delivery ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.17s
(exit 0)
```

### Web

```sh
cd web && bun run check && bun run build
```
```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
(exit 0)
dist/assets/index-6N3-vexo.js   346.36 kB │ gzip: 105.72 kB
✓ built in 171ms
```

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium bun run test
```
```text
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges × 3 demo projects (complete, truncated catalogue, fresh window), all session timelines, missing/extra keys and type-drift guards.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
review-r1 probe passed
review-r2 probe passed
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
(exit 0)
```

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium bun run test:next
```
```text
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
(exit 0)
```

### Performance gate

Served the built demo (`VITE_DEMO=1 bun run build`) statically on 23340 with
`python3 -m http.server 23340 --bind 127.0.0.1 --directory dist`.

```sh
cd web && BASE_URL=http://127.0.0.1:23340 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs
```
```text
Run 1 overview → adoption: 110.15 ms aggregate (informational); longest task 14.71 ms (budget < 50 ms)
(exit 0)
```

```sh
cd web && BASE_URL=http://127.0.0.1:23340 PERFORMANCE_TRACE_STEP=8 PLAYWRIGHT_CHANNEL=chromium \
  bun scripts/performance-qa.mjs --walk
```
```text
Run 1 overview → adoption: 93.73 ms aggregate (informational); longest task 9.79 ms (budget < 50 ms)
…30 transitions over 3 runs…
Run 3 adoption → reliability: 106.37 ms aggregate (informational); longest task 5.92 ms (budget < 50 ms)
(exit 0; worst longest task across all 30 transitions 22.27 ms, budget 50 ms)
```

Regenerated evidence: `web/artifacts/v3/performance.json`, `performance-walk.json`,
`tab-switch-trace.json`.

### Deterministic screenshots

Two serial runs against the same static demo server, hashing the 72 top-level PNGs
visual-qa writes (the 44 files under `artifacts/v3/mock/` are reference captures it
never touches).

```sh
cd web && BASE_URL=http://127.0.0.1:23340 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
find artifacts/v3 -maxdepth 1 -name '*.png' | sort | xargs sha256sum > shots-1.txt
# repeat, then: diff shots-1.txt shots-2.txt
```
```text
Visual QA passed: … (both runs exit 0)
BYTE-IDENTICAL: 72 screenshots
```

All 64 previously committed v3 captures came back byte-identical to the versions in
`c4b3967` — `git status` reports no change to any tracked PNG — so nothing on the
approved screens moved. The eight new captures are the `demo-fresh` funnel and
conversion states at both themes and both widths.

### Integrated harness

```sh
mkdir -p /var/tmp/dash-v3e2e-tmp
TMPDIR=/var/tmp/dash-v3e2e-tmp \
DATABASE_URL=postgres://postgres:signals@127.0.0.1:25482/signals \
ANALYTICS_PG_CONTAINER=dash-v3e2e-pg SIGNALS_URL=http://127.0.0.1:25483 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:25484 ANALYTICS_REVIEW_PROBE_PORT=25485 \
SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium \
python3 scripts/ci-conformance.py
```
```text
identity: 52/52 valid fixtures matched
identity: 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched
gzip: 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v3 analytics, painted funnel with a null day-7 step, adoption session/WAU/MAU trend series, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
…
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
CI_CONFORMANCE_EXIT=0
```

The review probe's new session-sum check, in every window and under every filter:

```text
sessions sum ?range=24h 18 tile 18
sessions sum ?range=7d 50 tile 50
sessions sum ?range=30d 75 tile 75
sessions sum ?range=90d 75 tile 75
sessions sum ?from=2026-10-12T02:05:00.000Z&to=2026-10-12T07:05:00.000Z 17 tile 17
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T05:24:41.000Z&client=Claude 53 tile 53
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T05:24:41.000Z&tool=get_product 72 tile 72
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T05:24:41.000Z&caller=user-strong-00 5 tile 5
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T05:24:41.000Z&transport=stdio 4 tile 4
```

The probe reproduces `sessions`, `wau` and `mau` independently in Python and diffs them
against the response for all seven query shapes and all seven routes — `MISMATCHES 0`
covers the new fields as well as the old ones. The 31-populated-partition fixture and
the executed-plan check both passed (`populated daily partition fixture 31`, no
`explain-events` finding), so the new series did not add a query that reads raw event
partitions.

Route latency on the probe's isolated 100k-event project (budget 900 ms):

```text
Latency budget: 900 ms; warmup then median of three
BENCH overview: median 149.04 ms; samples [151.05, 143.79, 149.04]
BENCH adoption: median 253.56 ms; samples [266.13, 253.15, 253.56]
BENCH tools: median 130.8 ms; samples [130.56, 133.01, 130.8]
BENCH reliability: median 112.66 ms; samples [112.66, 115.38, 110.36]
BENCH cost: median 137.16 ms; samples [144.63, 137.16, 132.79]
BENCH protocol: median 74.33 ms; samples [79.19, 74.33, 73.38]
BENCH digest: median 167.26 ms; samples [165.42, 176.18, 167.26]
BENCH alerts: median 0.99 ms; samples [0.99, 0.85, 1.01]
BENCH timeline: median 8.0 ms; samples [9.73, 8.0, 7.05]
```

### Cost of the new series

Measured A/B on the same 100k-event project left behind by the probe, with a release
collector on port 25486 reading the same database. `crates/signals-store/src/analytics.rs`
was reverted to `c4b3967` for the baseline and restored byte-identically afterwards
(`sha256sum -c`, then `cargo test -p signals-store --lib analytics` green again).

```text
baseline adoption range=7d: median 218.3 ms, samples [218.3, 214.6, 220.2], point keys ['by_kind', 'new', 'returning', 't', 'users']
baseline adoption range=30d: median 214.7 ms
baseline adoption range=90d: median 216.4 ms

adoption range=7d: median 254.8 ms, samples [254.8, 252.1, 256.8], buckets 2, sessions sum 200, last wau/mau 100/100 vs headline 100/100
adoption range=30d: median 241.4 ms, buckets 2, sessions sum 200, last wau/mau 100/100 vs headline 100/100
adoption range=90d: median 248.2 ms, buckets 2, sessions sum 200, last wau/mau 100/100 vs headline 100/100
```

About 36 ms (~17%) for the two extra passes over 100k facts, against a 900 ms budget,
and flat across 7d/30d/90d. The route issues no additional SQL.

## Not fixed / divergences found

- **`read_performance` fails on this box, independently of this change.** The ignored,
  non-CI test `signals-server --test read_performance` asserts p95 < 50 ms for the v1
  dashboard reads and failed here: `overview` p95 133.8 ms, `timeseries` 147.0 ms,
  `tools` 123.2 ms (read from the run's `bench/artifacts/reads.json`, deleted with
  `target/` during cleanup). It measures
  `crates/signals-store/src/read.rs`, which this change does not touch — that file is
  byte-identical to `c4b3967` — and the analytics module it does touch is not on that
  path. CI does not include this test in its ignored-test run list
  (`.github/workflows/signals.yml` runs `--test integration --test rollup_properties
  --test histogram_eligibility`); the box was running the deployed e2e stack and ~20
  other containers at the time. Not investigated further.
- **Overview's funnel printed a false `−0%`.** `overview.funnel[]` carries no
  `dropoff_pct` by contract (`briefs/v2/analytics-api.md` line 54 against line 76), but
  the renderer defaulted the missing field to `0` and drew `−0%` on every step after
  the first — so the real 50% drop at `five_calls` read as `−0%` on the deployed
  Overview. The renderer now draws the figure only where the response carries one. The
  Adoption funnel and the demo data are unaffected (both always carry `dropoff_pct`).
  This was not in the brief; it is the same class of defect as the filed blocker (a
  null rendered as a measured zero) and sits in the lines the fix already touched.
- **`adoption.active.points[]` is still sparse**, one entry per UTC day that has
  events, as before this change. The amendment's "buckets with no activity carry `0`
  for `sessions`" is satisfied for any bucket that is emitted; emitting empty buckets
  would change the length of the existing `users`/`new`/`returning` series, which the
  brief did not ask for. The session sum identity holds either way, because a session's
  first event always falls in a bucket that exists.
- **`adoption.active.bucket` is always `"day"`,** including for 24-hour windows where
  Overview uses hourly buckets. Pre-existing; out of scope here.

## Cleanup

Collector and Vite/static processes started for this task were stopped, the
`dash-v3e2e-pg` container was removed, and `target/`, `crates/signals-server/bench/`
and `/var/tmp/dash-v3e2e-tmp` were deleted. Nothing was pushed. The deployed
`signals-signals-1` collector, the egg containers and their checkouts were not touched.
