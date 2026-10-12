# Dashboard v3 e2e review, round 1

VERDICT: approve

Reviewed `vuk88/dash-v2` at `c1478a5` ("Paint counted funnel steps and serve the adoption trend series"), the one commit since `c4b3967`. Compared against `briefs/v3/fix-dash-v3-e2e.md`, the 2026-10-12 amendments at the end of `briefs/v2/analytics-api.md`, `reports/dash-v3-e2e-fixes.md`, and `evidence/collector/reports/e2e-v3.md`. Product source, configs, docs, and existing tests were not edited.

The funnel paints the counted steps and a dashed day-7 null step, on the demo and on ingested data with `eligible 0`, in both themes at 1440 and 390, and the table twin agrees. `sessions`, `wau`, and `mau` on each adoption point match an independent recompute of a dataset this review ingested. Session totals equal the overview tile, including under filters and when a session's first selected event moves it to the next UTC day. Rolling windows end at the bucket end and use the same identity precedence as the headline counts. Histogram and fact plans do not execute a raw `events` partition scan. The author's Rust, sqlx, web, performance, screenshot, and integrated-harness claims survived this run.

Postgres was `postgres:18.6-bookworm`, `--shm-size=1g`, container `dash-v3-review-pg` on `127.0.0.1:25532`, removed after the harness. Ports: 23330 (Vite UI suite), 23340 (static demo), 25540 (probe collector, stopped before the harness), 25541 (conformance collector), 25542 / 25543 (analytics review probe). `TMPDIR=/var/tmp/dash-v3-review-tmp`. Deployed containers on 8300 and 25470 were not touched.

## Blockers

None.

## Should-fix

None.

## Trend series

Contract, amendment dated 2026-10-12: `adoption.active.points[]` gains nullable `sessions`, `wau`, and `mau`. A session belongs to the UTC day of its first selected event. The sum of `points[].sessions` equals `tiles.sessions.value` for the same window and filters. The series is null on every point when no selected event has a session id; a day with activity and no new session is 0. `wau` is distinct identities in the 7 days ending at the bucket end, `mau` in the 30 days. Identity precedence matches the headline counts. The new fields add no query of `events`.

Independent probe, against a collector this review started, after ingesting known identities across midnight:

```sh
SIGNALS_URL=http://127.0.0.1:25540 \
ANALYTICS_PG_CONTAINER=dash-v3-review-pg \
python3 reports/review-r1/trend_probe.py
```

Exit 0. `FAILURES 0`.

Stored identities were `strong` alice, early-only, carol, shared, dave, mau-only, ghost; `key` k-out, k-bob, shared; one network hash `b21a23dea718…`. Alice's four facts keep `key_id` and `ip_hash` and collapse to one `strong` identity. A `subject_kind` header with no subject does not become strong. The raw IP is not stored.

Unfiltered window `[2026-10-04T00:00:00Z, 2026-10-11T00:00:00Z)`. The API matched this series, recomputed in Python from `analytics_facts`:

| Day | users | sessions | wau | mau |
|---|---:|---:|---:|---:|
| 2026-10-04 | 2 | 3 | 3 | 5 |
| 2026-10-05 | 2 | 1 | 3 | 6 |
| 2026-10-06 | 1 | 1 | 4 | 7 |
| 2026-10-07 | 2 | 2 | 6 | 9 |
| 2026-10-08 | 0 | 1 | 6 | 9 |
| 2026-10-09 | 1 | 0 | 6 | 9 |
| 2026-10-10 | 1 | 2 | 7 | 10 |

Headline `wau` 7, `mau` 10, active users 7, `by_kind` strong 5 / key 2 / network 0. Session sum 10 equals the overview tile. Oct 8 is a day with activity and sessions 0. `window.to` is exactly midnight, so the last bucket is clamped and matches the headline.

Partial window ending `2026-10-10T15:00:00Z`: last bucket clamped to 15:00, the 23:59 event is excluded, session sum 9, last point `wau`/`mau` 7/10 equals the headline.

Gap window ending `2026-10-11T15:00:00Z`, with no events on the partial day: the last emitted bucket is Oct 10 and is not clamped. Printed line: `last bucket end 2026-10-11T00:00:00+00:00 clamped=False matches_headline=False point=7/10 headline=6/10`. `mau` stays 10/10. Session sum stays 10. That is the amendment: the rolling window ends at the bucket end, and a quiet partial day emits no bucket to clamp. `docs/analytics.md` says the final bucket of a window ending now reports exactly the headline `wau` and `mau`. That sentence holds when the last bucket is clamped (activity on the day that contains `window.to`, or `window.to` exactly at midnight). It does not hold in the gap above. The code matches the amendment, so this is recorded and not filed.

`tool=get_item` moves session `s-cross` from its Oct 4 `session.started` onto the Oct 5 `get_item`. Filtered sessions are Oct 4 = 2 and Oct 5 = 1. Sum 8 equals the tile. `caller=alice` sum 2 and `transport=streamable-http` sum 1 equal their tiles. Headline kinds follow the filter.

A fresh project whose day-7 return falls outside the window: funnel counts `[1, 1, 1, 1, null]`, `eligible 0`, adoption day-7 `dropoff_pct` null, sessions point 1.

A project with two `tool.called` events and no session id: every `points[].sessions` is null, the sessions tile is 0, `wau`/`mau` are 1.

Thirty-one daily `events` partitions, one event per day from 2026-09-01 through 2026-10-01. A two-day control `EXPLAIN` names `events_2026_10_01` and `events_default` and does not name a September partition. The fact read is an index scan of `analytics_facts`. The histogram plan executes no `events` scan. The OpenAPI adoption point schema contains `sessions`, `wau`, and `mau`.

The author's integrated probe also recomputes the three fields. On this run every window and filter matched the tile:

```text
sessions sum ?range=24h 17 tile 17
sessions sum ?range=7d 50 tile 50
sessions sum ?range=30d 75 tile 75
sessions sum ?range=90d 75 tile 75
sessions sum ?from=2026-10-12T03:05:00.000Z&to=2026-10-12T08:05:00.000Z 17 tile 17
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T06:20:33.000Z&client=Claude 53 tile 53
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T06:20:33.000Z&tool=get_product 72 tile 72
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T06:20:33.000Z&caller=user-strong-00 5 tile 5
sessions sum ?from=2026-10-02T00:30:00.000Z&to=2026-10-12T06:20:33.000Z&transport=stdio 4 tile 4
```

The author's report shows 18 for `range=24h`. The probe builds that window from wall-clock `now`, so the absolute count moves. Both runs match the tile. `FINDINGS 0 MISMATCHES 0`.

## Funnel and sparklines

Contract, funnel amendment dated 2026-10-12: a step with `count: null` renders as a null step with the waiting caption and does not blank the counted steps. "Waiting for trend" shows only when every sample in the series is null. Stickiness is `users / mau * 100`, null when `mau` is 0 or null.

Demo, both static visual-qa runs (`demo-fresh`, light and dark, 1440 and 390): "Visual QA passed: … painted funnel with a null day-7 step and a conversion curve that ends at the last counted step". Exit 0 both times. 72 screenshots, byte-identical across the two runs. Tracked PNGs were unchanged against `HEAD` after the runs. The Vite suite (`bun run test`) rewrote 14 tracked 390-wide PNGs; those were restored with `git checkout` before the static runs and are not a product change.

Real data, `reports/review-r1/ui_probe.mjs` against the collector on 25540, project with funnel counts `[1, 1, 1, 1, null]` and `eligible 0`. Exit 0. For light and dark at 1440 and 390 the probe recorded four painted steps, one `rect.nullstep`, caption text ending `returned day 7 / Waiting · 0 eligible / —`, table twin `returned_day_7 / — / —`, conversion ending at the last counted step with the same twin, and Sessions, WAU, MAU, and Stickiness sparklines drawn on Overview and the sessions page. A series that is null on every point shows "Waiting for trend" and draws no sparkline. Zeros draw. Stickiness waits when every `mau` is 0. WAU still draws when `sessions` is null.

`web/scripts/backend-qa.mjs`, inside the harness below, passed the same real-data assertions: painted funnel with a null day-7 step, and Sessions / WAU / MAU / Stickiness sparklines.

## Verified claims

Author commands from `reports/dash-v3-e2e-fixes.md`, re-run from this worktree with `PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH`. Database `postgres://postgres:signals@127.0.0.1:25532/signals` after `sqlx migrate run` (10 migrations) and `.sqlx/dev.sql`.

| Claim | Result |
|---|---|
| `cargo fmt --all --check` | exit 0 |
| `cargo run --locked -p signals-xtask -- --check` | exit 0. "Official schemas parsed; runtime validation replaces generated wire types" |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | exit 0 |
| `cargo test --locked --workspace` | exit 0. `analytics::tests::adoption_trend_series` ok |
| `cargo sqlx prepare --check --workspace -- --all-targets` | exit 0 |
| ignored DB tests, `--test-threads=1` | exit 0 (`integration`, `rollup_properties`, `histogram_eligibility`, `analytics`, `v11`) |
| `cd web && bun run check && bun run build` | exit 0. `dist/assets/index-6N3-vexo.js` 346.36 kB |
| `PLAYWRIGHT_CHANNEL=chromium bun run test` | exit 0 |
| `PLAYWRIGHT_CHANNEL=chromium bun run test:next` | exit 0 |
| `performance-qa.mjs` single | exit 0. overview → adoption longest task 10.78 ms (budget < 50 ms). Aggregate 109.17 ms is informational |
| `performance-qa.mjs --walk` | exit 0. 30 transitions, worst longest task 28.62 ms. Aggregate 268.31 ms is informational |
| two serial static `visual-qa.mjs` runs | both exit 0, `BYTE_IDENTICAL`, 72 screenshots |
| `python3 scripts/ci-conformance.py` | exit 0. See below |

The non-demo bundle above is what `bun run check && bun run build` emits. `VITE_DEMO=1 bun run build` emits a different file, `index-Ce1fWIy8.js` (358.65 kB). The author's report cites the non-demo hash and then rebuilds with `VITE_DEMO=1` for the static server. That split is real. A debug binary linked after the demo build embeds the demo shell and never shows the login heading "Follow the signal." Rebuilding without `VITE_DEMO` and relinking made `/` reference `index-6N3-vexo.js`. The harness result below used that binary.

Integrated harness, third invocation. The first two exits were this environment: the demo bundle embedded in `target/debug/signals`, then `SIGNALS_ADMIN_TOKEN=review-admin-token-32-characters` inherited by `bun` while the server uses `ci-isolated-admin-token-32-characters` (`POST /v1/admin/projects` returned 401). Neither is product behaviour. The surviving command unsets those variables:

```sh
env -u SIGNALS_ADMIN_TOKEN -u SIGNALS_SESSION_SECRET -u SIGNALS_PUBLIC_URL -u SIGNALS_BIND \
  TMPDIR=/var/tmp/dash-v3-review-tmp \
  DATABASE_URL=postgres://postgres:signals@127.0.0.1:25532/signals \
  ANALYTICS_PG_CONTAINER=dash-v3-review-pg \
  SIGNALS_URL=http://127.0.0.1:25541 \
  ANALYTICS_REVIEW_URL=http://127.0.0.1:25542 \
  ANALYTICS_REVIEW_PROBE_PORT=25543 \
  SIGNALS_PROBE_LATENCY_BUDGET_MS=900 \
  PLAYWRIGHT_CHANNEL=chromium \
  python3 scripts/ci-conformance.py
```

Exit 0. Spec identity 52/52 and 54/54, gzip the same, auth-before-body passed. Login style QA passed. Backend browser QA passed, including the painted null day-7 step and the adoption trend sparklines. Release probe: 525 events accepted, rollup idempotence ok, restart aggregates stable, late hour 62 → 63, `populated daily partition fixture 31`, `perf facts 100000`, `FINDINGS 0 MISMATCHES 0`.

Latency budget 900 ms, median of three after warmup:

| Route | Median |
|---|---:|
| overview | 149.76 ms |
| adoption | 249.28 ms |
| tools | 120.90 ms |
| reliability | 115.65 ms |
| cost | 143.47 ms |
| protocol | 80.52 ms |
| digest | 155.60 ms |
| alerts | 0.99 ms |
| timeline | 8.62 ms |

`git diff --stat c4b3967 -- crates/signals-store/src/read.rs` is empty. The ignored `read_performance` test was not re-run. The author already reported it fails on this machine and that CI does not run it. The file is unchanged, so that report is not a false claim about this commit.

## Probes committed

- `reports/review-r1/trend_probe.py` — ingest, identity precedence, golden series, partial and gap windows, filter shift, fresh funnel, null sessions, partition `EXPLAIN`.
- `reports/review-r1/ui_probe.mjs` — real-data funnel and sparkline paint at both themes and both widths, plus the all-null and zero-value sparkline cases.

Screenshots stayed in `/tmp/dash-v3-review-ui` and were not committed.
