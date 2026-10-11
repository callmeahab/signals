# Collector analytics v2 implementation report

Branch: `vuk88/analytics-v2`; base: `85a73a2`. Initial implementation commit:
`2229759` (subsequent verification and fixes are committed on the same branch).
No push, publication, or changes to tracked `web/`, `spec/`, or `deploy/` files.

## Changes by file

- `crates/signals-store/migrations/0004_analytics.sql`: identities and catalogue
  capture/backfill; project analytics settings; extended sessions; hourly, daily,
  identity-daily and path tables; alert transitions and probes.
- `crates/signals-store/migrations/0005_analytics_revision.sql`: statement-level
  insert/delete revisions for cross-process read-cache invalidation.
- `crates/signals-store/migrations/0006_analytics_facts.sql`: allowlisted event-time
  metric facts, backfilled from existing events and retained independently of raw
  payloads for 400 days; exact filtered/cohort history survives raw retention.
- `crates/signals-store/migrations/0007_alert_pending.sql`: durable pending breaches
  for the error-rate rule's fifteen-minute sustained threshold.
- `crates/signals-store/migrations/0008_analytics_scope.sql`: separates project
  totals from tools with legal empty names and requests a metric-fact backfill.
- `crates/signals-core/src/lib.rs`: narrowly accepts `tools.listed` with existing
  envelope/depth/size validation and open attrs; other v1.0 acceptance is preserved.
- `crates/signals-store/src/analytics.rs`: identity precedence, histograms and exact
  percentiles, filters, funnel/cohorts, retry/path definitions, costs, SLOs, all read
  calculations, bounded project snapshot cache, and stored/fact-derived histogram merging.
- `crates/signals-store/src/analytics_worker.rs`: incremental cursor-based rollups,
  session-derived fields, five default alert evaluations with sustained error breaches, transition-only logging,
  and probe availability reads; late arrivals dirty related session buckets.
- `crates/signals-store/src/{lib,workers}.rs`: module registration and existing worker
  integration without replacing legacy dashboard aggregates.
- `crates/signals-server/src/analytics.rs`: all nine analytics GET routes, common
  validation/error shape, timestamp-plus-ID timeline hashing, alert-rule PUT, settings validation and
  persistence. Digest computation logs that delivery is log-only.
- `crates/signals-server/src/handlers.rs`: owner-authenticated partial PATCH with
  atomic legacy/analytics settings updates and redacted probe key responses.
- `crates/signals-server/src/{lib,main}.rs`: route/CORS registration and minute-worker
  integration for alerts and optional probing.
- `crates/signals-server/src/prober.rs`: bounded initialize/initialized/tools-list
  streamable-HTTP probing with session/protocol headers, JSON/SSE, pagination,
  disabled redirects, cleanup, and a local MCP mock test.
- `crates/signals-server/src/openapi.rs`: every analytics route and nested response
  model, filters, errors, alert PUT, and a route-coverage test.
- `crates/signals-server/tests/analytics.rs`: ignored three-day wire-ingest test
  using both SDK source shapes, several clients, errors/retries, every route's key
  numbers, exact short-window percentiles, retention, replay/rollup idempotence,
  settings authorization/persistence, raw-retention independence, and optional
  100k-call performance extension.
- `.sqlx/`: regenerated checked-query metadata.
- `docs/analytics.md`: definitions, rollups, precision, settings, workers and limits.
- `scripts/analytics-conformance.py`: disposable-server conformance harness that
  uses `docker exec` instead of host psql and shuts down its server in `finally`.
- `reports/collector-analytics.md`: this report.

## Verification environment

```sh
export PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25439/signals
export TEST_DATABASE_URL=$DATABASE_URL
# Online checked-query validation and metadata preparation:
export SQLX_OFFLINE=false
```

Owned database: `postgres:18.6-bookworm`, container `signals-analytics-v2-pg`, host
port 25439. Conformance server used port 25483. No host psql was used.

## Commands and results

### Embedded web assets (no source edits)

```sh
cd web
export BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache
bun install --frozen-lockfile && bun run build
```

Exit 0; final output:

```text
167 packages installed
✓ 1899 modules transformed.
dist/assets/index-zi5q0FG8.js  274.39 kB │ gzip: 84.45 kB
✓ built in 843ms
```

### Migrations and query metadata

```sh
cargo sqlx migrate run --source crates/signals-store/migrations
cargo sqlx prepare --workspace -- --all-targets
cargo sqlx prepare --workspace --check -- --all-targets
```

Exit 0. Migration output included:

```text
Applied 4/migrate analytics (8.831698ms)
Applied 5/migrate analytics revision (2.583538ms)
```

Preparation/check final output:

```text
Finished `dev` profile [unoptimized] target(s) in 17.63s
query data written to .sqlx in the workspace root; please check this into version control
```

```text
Checking signals-store v0.1.0
Checking signals-server v0.1.0
Finished `dev` profile [unoptimized] target(s) in 4.32s
```

For online compilation the existing temporary-ingest-table query also needs the
prepare-only relation (same pattern as the repository's existing checked queries):

```sh
docker exec signals-analytics-v2-pg psql -U postgres -d signals \
  -c 'CREATE TABLE ingest_stage (LIKE events INCLUDING DEFAULTS)'
```

Output: `CREATE TABLE`. Runtime ingestion still creates a transaction-local table.

### Formatting, strict linting, unit tests, schema check

```sh
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo run -p signals-xtask -- --check
git diff --check
```

All exit 0. Formatting/diff checks had no output. Clippy final output:

```text
Checking signals-store v0.1.0
Checking signals-server v0.1.0
Finished `dev` profile [unoptimized] target(s) in 6.04s
```

Tests: 9 core, 5 server, and 5 store unit tests passed; 7 DB tests are ignored by the
ordinary workspace command and were run separately below. Relevant output:

```text
test openapi::tests::document_covers_read_routes_and_models ... ok
test prober::tests::streamable_http_preserves_session_and_paginates_sse ... ok
test analytics::tests::identity_precedence ... ok
test analytics::tests::retry_and_path_boundaries ... ok
test analytics::tests::funnel_and_cohorts ... ok
test analytics::tests::percentile_error_bound ... ok
test analytics_worker::tests::errors_require_continuous_evidence ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Schema-check output:

```text
Official schemas parsed; runtime validation replaces generated wire types
```

### All ignored database tests, release profile

```sh
SIGNALS_BENCH_ROWS=100000 cargo test --locked --release --workspace \
  -- --ignored --test-threads=1
```

Exit 0. All seven ignored tests passed:

```text
test three_day_analytics_contract_and_idempotence ... ok
test collector_replays_late_rollups_tenant_isolation_and_keys ... ok
test migration_comment_cleanup_preserves_existing_databases ... ok
test thirty_day_dashboard_measurements ... ok
test random_lateness_matches_brute_force_sql ... ok
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok
```

The three-day test compares serialized durable rollup/identity/path data before
and after a second worker run; it also replays every ingested batch. The legacy
30-day read benchmark passed its stricter 50 ms p95 requirement in release mode.
Its generated `crates/signals-server/bench/artifacts/reads.json` reported p95 values
from 0.86 ms (sessions) to 30.32 ms (tools), at 100,000 rows.

The earlier debug-profile invocation of the same ignored suite failed only the
legacy read-performance test's 50 ms threshold. Its final output was:

```text
thread 'thirty_day_dashboard_measurements' panicked:
Read latency target failed; inspect bench/artifacts/reads.json
test result: FAILED. 0 passed; 1 failed
```

No thresholds were relaxed; the release-profile run above passed.

### Analytics route performance and expanded contract assertions

```sh
SIGNALS_ANALYTICS_BENCH=1 cargo test --locked --release -p signals-server \
  --test analytics -- --ignored --nocapture
```

Final run exit 0. This adds 100,000 calls distributed over three UTC days to the
60-event wire dataset and measures authenticated routes after the worker has
populated its read snapshot. Final output, with the Docker build finished:

```text
BENCH overview: 173.85 ms
BENCH adoption: 214.16 ms
BENCH tools: 117.68 ms
BENCH reliability: 85.70 ms
BENCH cost: 125.66 ms
BENCH protocol: 40.64 ms
BENCH digest: 150.20 ms
BENCH alerts: 1.60 ms
BENCH sessions/s-0-0/timeline: 3.18 ms
PASS all nine analytics routes, both SDK source shapes, identities, retries, paths, nulls, filtering, replay and rollup idempotence
test three_day_analytics_contract_and_idempotence ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 28.23s
```

An initial implementation measured overview at 406.60 ms; unnecessary calculations
were removed. A later run overlapping the Docker release build measured 677.41 ms
and failed its assertion; the final run above used the same final implementation
without that build and passed. These are warmed single-request measurements, not
cold-cache or sustained-concurrency latency guarantees.

### Wire and transport conformance

```sh
cargo build --locked --bin signals
ANALYTICS_PG_CONTAINER=signals-analytics-v2-pg \
  python3 scripts/analytics-conformance.py
```

The harness runs the exact required scripts with isolated provisioned keys:

```sh
python3 scripts/spec-conformance.py --url http://127.0.0.1:25483
python3 scripts/transport-conformance.py --url http://127.0.0.1:25483
```

Exit 0; output:

```text
identity: 39/39 valid fixtures matched
identity: 49/49 invalid fixtures matched
gzip: 39/39 valid fixtures matched
gzip: 49/49 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
```

### Container build

```sh
docker build -f docker/Dockerfile .
```

Final exit 0, using regenerated offline metadata:

```text
Step 25/25 : CMD ["serve"]
 ---> a5934b9c6bdd
Successfully built a5934b9c6bdd
```

### Ownership check

```sh
git diff 85a73a2 --name-only -- web spec deploy
```

Exit 0, no output: no tracked changes in those trees.

## Limitations and design details requiring reviewer attention

- An additional compact per-event metric projection is retained alongside the
  requested aggregates. This supports exact arbitrary filters and session/cohort
  history after raw payload retention, instead of attempting to reconstruct those
  dimensions from lossy totals. Arguments and arbitrary attributes are excluded;
  timeline argument hashes become null after their raw arguments expire.
- The 300 ms result covers the worker-warmed synthetic dataset. Cold snapshots scan
  retained project metric facts, and snapshots consume memory (32 cached projects, 60 s
  maximum lifetime, plus project-revision invalidation). No cold-cache or concurrent
  load guarantee was established; the concurrent-build failure is recorded above.
- `subject_kind` precedence is implemented and unit-tested for stored metadata, but
  the frozen v1.0 caller schema remains closed. Only the requested `tools.listed`
  type is accepted ahead of the spec bump; optional attrs remain open.
- Histogram error bounds apply within 1–600,000 ms; overflow/underflow clamps to the
  endpoint. Filtered histograms are reconstructed from matching retained events.
- The error rule now measures each trailing minute and requires a continuous
  15-minute breach. Gaps over 90 seconds, missing samples and rule changes reset
  pending state. Digest/alerts JSON fields follow the prose contract where it does
  not supply a complete example schema.
- Probe `healthy_tools` is null: initialize plus listing cannot establish whether
  individual tools execute successfully. Protocol fields the SDKs do not emit stay
  null. Delivery is intentionally compute/log-only, as requested.


## Retention and sustained-alert follow-up

Final review found and fixed a raw-retention gap before handoff. Migration 0006
adds the metric projection described above, and migration 0007 makes the default
error alert require sustained evidence. These additions were checked with:

```sh
cargo sqlx migrate run --source crates/signals-store/migrations
cargo test --locked -p signals-server --test analytics -- --ignored --nocapture
cargo sqlx prepare --workspace -- --all-targets
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo test --locked --release --workspace --no-run
```

Migration/retention-test output:

```text
Applied 6/migrate analytics facts (2.821358ms)
Applied 7/migrate alert pending (3.029661ms)
PASS 90-day metric responses survive raw retention; argument bodies and arbitrary attributes are excluded from analytics facts
PASS all nine analytics routes, both SDK source shapes, identities, retries, paths, nulls, filtering, replay and rollup idempotence
test three_day_analytics_contract_and_idempotence ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.97s
```

The retention test compares all seven metric routes at `range=90d` before and
after deleting the project's raw events, checks timeline continuity, and verifies
that argument bodies/arbitrary properties never entered the retained facts.

Additional compatibility regressions passed with the retention test: a legal empty
tool name has separate tool/project totals, and repeated UUIDs at different event
timestamps retain the correct distinct argument hashes. Output:

```text
Applied 8/migrate analytics scope (3.785381ms)
PASS 90-day metric responses survive raw retention; argument bodies and arbitrary attributes are excluded from analytics facts
PASS empty tool names have distinct tool and project aggregate scopes
PASS all nine analytics routes, both SDK source shapes, identities, retries, paths, nulls, filtering, replay and rollup idempotence
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.20s
```

