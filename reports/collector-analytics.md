# Collector analytics v2 implementation report

Branch: `vuk88/analytics-v2`; base: `85a73a2`. Initial implementation commit:
`2229759`; final implementation commit: `59e22a7` (verification/report commits follow).
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
from 1.96 ms (caller history) to 28.08 ms (timeseries), at 100,000 rows.

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
BENCH overview: 205.12 ms
BENCH adoption: 251.56 ms
BENCH tools: 115.85 ms
BENCH reliability: 109.46 ms
BENCH cost: 138.81 ms
BENCH protocol: 63.11 ms
BENCH digest: 184.45 ms
BENCH alerts: 2.11 ms
BENCH sessions/s-0-0/timeline: 6.77 ms
PASS all nine analytics routes, both SDK source shapes, identities, retries, paths, nulls, filtering, replay and rollup idempotence
test three_day_analytics_contract_and_idempotence ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 34.34s
```

An initial implementation measured overview at 406.60 ms; unnecessary calculations
were removed. A later run overlapping the Docker release build measured 677.41 ms
and failed its assertion; an isolated rerun passed, as did the final implementation
run above without a concurrent build. These are warmed single-request measurements, not
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
 ---> 8c298fa3a5e1
Successfully built 8c298fa3a5e1
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


## Final verification pass

After the retention, sustained-alert, empty-tool and timeline-hash fixes, the
format, strict clippy, workspace unit, schema and SQLx checks above were repeated
and passed. Final log tails:

```text
# cargo clippy --locked --workspace --all-targets -- -D warnings
Finished `dev` profile [unoptimized] target(s) in 3.41s
# cargo sqlx prepare --workspace --check -- --all-targets
Finished `dev` profile [unoptimized] target(s) in 5.86s
# cargo test --locked --release --workspace --no-run
Finished `release` profile [optimized] target(s) in 2m 50s
```

The final seven ignored database tests and the separate 100k analytics benchmark
also passed; the timings in the sections above are from that final run. The final
Docker image is `8c298fa3a5e1`. No requested implementation work remains; known
measurement limits and design details are listed above.

The final `cargo build --locked --bin signals` and
`ANALYTICS_PG_CONTAINER=signals-analytics-v2-pg python3 scripts/analytics-conformance.py`
rerun also exited 0: 39/39 valid and 49/49 invalid fixtures matched for both identity
and gzip, followed by the transport PASS shown above.

## Cleanup and handoff

```sh
docker stop signals-analytics-v2-pg
docker rm -v signals-analytics-v2-pg
rm -r /home/vuk/orca/workspaces/signals-collector/analytics-v2/target
test ! -e /home/vuk/orca/workspaces/signals-collector/analytics-v2/target
docker ps -a --filter name=signals-analytics-v2-pg --format '{{.Names}}'
git diff --check
git diff 85a73a2 --name-only -- web spec deploy
```

All exited 0. Stop/remove each printed `signals-analytics-v2-pg`; the remaining
commands produced no output. The temporary database/container and local `target/`
were removed, and the conformance harness terminated its server. Changes are
committed on the task branch without pushing.

## Fix pass r1

Review baseline: `05705be`; implementation commit: `91eea5e`. The original review
artifacts remain unchanged. This pass addresses all three requested findings:

- `crates/signals-store/src/analytics.rs`: the returned-day-seven funnel step now
  includes `eligible` and returns null count when no selected new identity can be
  observed seven days later. Adoption drop-off is null in that case. Eligibility
  is strict at the half-open window end. D1/D7/D30 eligibility now begins at the
  midnight immediately following the UTC anniversary date. Unit regressions cover
  24-hour/seven-day windows, mixed eligible and young identities, and the review's
  late-clock miss at all three retention offsets, just before and at midnight.
- `crates/signals-server/src/{analytics,handlers}.rs`: settings validation on PATCH
  and alert PUT returns 400 with stable `invalid_settings` and a message; query
  errors retain `invalid_filter`, and authentication/server errors retain their
  existing behavior.
- `crates/signals-server/src/openapi.rs`: optional funnel eligibility and nullable
  counts/drop-off are documented, as are both settings routes' error schemas.
- `crates/signals-server/tests/analytics.rs`: database assertions cover both funnel
  routes and invalid SLO, divisor, legacy settings, non-object settings and rules.
- `docs/analytics.md`: documents the corrected definitions, error response and CI
  regression commands.
- `scripts/analytics-review-probe.py`: preserves the independent review dataset and
  comparisons, with expected funnel/retention/settings values updated to the amended
  contract. It fails on findings or mismatches, accepts a configurable isolated
  database/ports, and manages only its own collector process.
- `scripts/ci-conformance.py`: invokes that probe after the existing sweep, building
  the release collector for the latency checks; supports container psql locally.

The first test iteration exposed Utoipa's inability to deserialize the existing
project response's empty `{}` schema when replacing its whole path. Updating only
the 400 response fixed it. A subsequent test compile caught a missing qualification
on the JSON macro in the new schema assertion; that was fixed before validation.

Verification uses the same toolchain flags as above, with `DATABASE_URL` and
`TEST_DATABASE_URL` set to `postgres://postgres:signals@127.0.0.1:25439/signals`.
The isolated PostgreSQL container was created and prepared with:

```sh
docker run -d --name signals-analytics-fix-r1-pg --shm-size=1g \
  -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals \
  -p 127.0.0.1:25439:5432 postgres:18.6-bookworm
cargo sqlx migrate run --source crates/signals-store/migrations
docker exec -i signals-analytics-fix-r1-pg psql -U postgres -d signals \
  -v ON_ERROR_STOP=1 < .sqlx/dev.sql
```

All migrations and `.sqlx/dev.sql` succeeded; final output:

```text
Applied 8/migrate analytics scope (1.505572ms)
CREATE TABLE
```

Commands completed successfully:

```sh
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --bin signals
cargo test --locked --release --workspace --no-run
SQLX_OFFLINE=false cargo sqlx prepare --workspace --check -- --all-targets
cargo run --locked -p signals-xtask -- --check
SIGNALS_BENCH_ROWS=100000 cargo test --locked --release --workspace -- --ignored --test-threads=1
python3 -m py_compile scripts/analytics-review-probe.py scripts/ci-conformance.py
```

Formatting and Python compilation had no output. Selected final output:

```text
    Finished `dev` profile [unoptimized] target(s) in 14.84s
    Finished `dev` profile [unoptimized] target(s) in 5.00s
    Finished `release` profile [optimized] target(s) in 2m 52s
    Finished `dev` profile [unoptimized] target(s) in 2.97s
    Finished `dev` profile [unoptimized] target(s) in 1.55s
Official schemas parsed; runtime validation replaces generated wire types
test analytics::tests::day_seven_funnel_requires_observable_identities ... ok
test analytics::tests::retention_uses_completed_utc_anniversary_day ... ok
test three_day_analytics_contract_and_idempotence ... ok
test collector_replays_late_rollups_tenant_isolation_and_keys ... ok
test migration_comment_cleanup_preserves_existing_databases ... ok
test thirty_day_dashboard_measurements ... ok
test random_lateness_matches_brute_force_sql ... ok
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok
```

Workspace tests passed: 9 core, 5 server and 7 store unit tests. All seven ignored
database tests passed in release mode; the existing read-performance limit was
not changed. SQLx metadata still matches because the fix introduces no query or
storage schema changes.

The first `scripts/ci-conformance.py` attempt passed the fixture/transport sweeps
but stopped at dashboard QA because its default Chrome binary was absent:

```text
error: launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
error: script "qa:backend" exited with code 1
```

The retry uses `PLAYWRIGHT_CHANNEL=chromium`, as the existing CI workflow does.
Before retrying, the disposable database was reset to avoid reusing fixture slugs:

```sh
docker exec signals-analytics-fix-r1-pg dropdb -U postgres signals
docker exec signals-analytics-fix-r1-pg createdb -U postgres signals
cargo sqlx migrate run --source crates/signals-store/migrations
docker exec -i signals-analytics-fix-r1-pg psql -U postgres -d signals \
  -v ON_ERROR_STOP=1 < .sqlx/dev.sql
```

Reset/migration commands exited 0; drop/create had no output and preparation ended
with `CREATE TABLE`.

The first Chromium run crashed at the settings page. A diagnostic retry reached
the PATCH call and returned HTTP 400, exposing a compatibility issue beyond the
three review findings: the existing dashboard round-trips read-only project fields
(`id`, `tenant_id`, `slug`) that the former typed settings extractor ignored. The
handler now ignores those same fields, and the database test sends conflicting
values and verifies they cannot change project identity or slug. No web code was
changed. CI fixture tenant slugs are now unique so the complete script can be rerun
against its isolated database without resetting it. All checks below were rerun
after this compatibility correction.

Final Rust validation after commit `47d3a15` passed using the same commands above.
Selected final tails:

```text
    Finished `dev` profile [unoptimized] target(s) in 3.13s
    Finished `test` profile [unoptimized] target(s) in 6.93s
test tests::histogram_merges_and_empty_percentile_is_zero ... ok
test tests::measurement_uses_ecmascript_numbers_and_json_escaping ... ok
test tests::utf8_precedes_ndjson_count_but_count_precedes_envelope ... ok
test tests::source_uses_ecmascript_whitespace ... ok
test tests::overflowing_numbers_become_null_and_finite_numbers_stay_exact ... ok
test tests::object_caps_use_the_same_measurement ... ok
test tests::rejects_arbitrary_depth_without_recursive_drop ... ok
test tests::event_cap_uses_json_stringify_without_changing_stored_floats ... ok
test tests::official_fixtures_match_reference ... ok
test auth::upgrade_tests::preserves_hmac_sha256_identity ... ok
test analytics::tests::ranges_reject_unknown ... ok
test openapi::tests::document_covers_read_routes_and_models ... ok
test prober::tests::streamable_http_preserves_session_and_paginates_sse ... ok
test auth::upgrade_tests::verifies_existing_argon2_05_password_hashes ... ok
test analytics::tests::identity_precedence ... ok
test analytics_worker::tests::errors_require_continuous_evidence ... ok
test analytics::tests::funnel_and_cohorts ... ok
test analytics::tests::retry_and_path_boundaries ... ok
test analytics::tests::day_seven_funnel_requires_observable_identities ... ok
test analytics::tests::retention_uses_completed_utc_anniversary_day ... ok
test analytics::tests::percentile_error_bound ... ok
    Finished `dev` profile [unoptimized] target(s) in 2.69s
    Finished `dev` profile [unoptimized] target(s) in 5.31s
    Finished `release` profile [optimized] target(s) in 1m 49s
test three_day_analytics_contract_and_idempotence ... ok
test collector_replays_late_rollups_tenant_isolation_and_keys ... ok
test migration_comment_cleanup_preserves_existing_databases ... ok
test thirty_day_dashboard_measurements ... ok
test random_lateness_matches_brute_force_sql ... ok
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok
```

Subsequent browser retries crashed at different steps (screenshot and logout)
under Chromium and headless-shell. A disk-backed temporary directory inside the
worktree initially exceeded Chromium's Unix socket path limit; a short directory
under `/var/tmp` succeeded with the unchanged browser QA. The complete CI command
is therefore run with that short disk-backed `TMPDIR`, rather than the host's
heavily occupied `/tmp` tmpfs. No browser assertions or web sources were changed.
A separately started analytics probe was interrupted during its late-event wait
(exit 130, owned collector cleaned up) so the whole entrypoint could be run once
with the working browser environment.

```sh
export PLAYWRIGHT_CHANNEL=chromium
export ANALYTICS_PG_CONTAINER=signals-analytics-fix-r1-pg
export SIGNALS_URL=http://127.0.0.1:25483 PYTHONUNBUFFERED=1
python3 - <<'PY'
import os, subprocess, tempfile
with tempfile.TemporaryDirectory(prefix='ar1-',dir='/var/tmp') as temporary:
    subprocess.run(['python3','scripts/ci-conformance.py'],
                   env={**os.environ,'TMPDIR':temporary},check=True)
PY
```

The first complete run reached the end with zero response mismatches and all nine
latency measurements under 300 ms, but exited 1 on an EXPLAIN-text false positive.
The probe flagged sequential-scan plan nodes for empty future partitions. Running
its same query with `EXPLAIN (ANALYZE, FORMAT JSON)` showed all four flagged nodes
were runtime-pruned:

```text
events_2026_10_12 loops= 0 rows= 0 removed= 0
events_2026_10_13 loops= 0 rows= 0 removed= 0
events_2026_10_14 loops= 0 rows= 0 removed= 0
events_default loops= 0 rows= 0 removed= 0
```

That diagnostic executed the probe's query against project
`6613e3e2-66b7-4dbe-b033-72b00bdc333a` through `docker exec ... psql`:

```sql
EXPLAIN (ANALYZE, FORMAT JSON)
SELECT r.hour FROM analytics_hourly r
WHERE project_id='6613e3e2-66b7-4dbe-b033-72b00bdc333a'
  AND hour>=now()-interval '7 days' AND hour+interval '1 hour'<=now()
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.project_id=r.project_id
    AND e.ts>=r.hour AND e.ts<r.hour+interval '1 hour'
    AND e.received_at>'1970-01-01');
```

Commit `6ec58b6` makes the probe inspect executed JSON plans and flag sequential
scans that actually visit event rows, including rows removed by a filter. Empty or
pruned nodes no longer produce findings. It also preserves timing evidence when
exiting with a finding. No API query or performance threshold changed. A Python
import harness exercised empty, pruned, returned-row and filtered-row plan nodes
and the real captured plan:

```sh
python3 - <<'PY'
import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('probe','scripts/analytics-review-probe.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
empty={'Node Type':'Seq Scan','Relation Name':'events_empty','Actual Loops':1,'Actual Rows':0}
pruned={**empty,'Actual Loops':0,'Actual Rows':100}
live={**empty,'Relation Name':'events_live','Actual Rows':1}
filtered={**empty,'Relation Name':'events_filtered','Rows Removed by Filter':100}
assert p.executed_event_scans({'Plans':[empty,pruned,live,filtered]})==['events_live','events_filtered']
assert not p.executed_event_scans(json.loads(Path('/tmp/analytics-r1-explain.json').read_text())[0]['Plan'])
print('PASS executed-plan guard rejects populated scans and ignores empty/runtime-pruned partitions')
PY
```

Result:

```text
PASS executed-plan guard rejects populated scans and ignores empty/runtime-pruned partitions
```

`python3 -m py_compile scripts/analytics-review-probe.py scripts/ci-conformance.py`
and `git diff --check` then exited 0 with no output. The complete CI command above
was rerun after this probe correction.

Final complete CI run: **exit 0**. Selected output:

```text
identity: 39/39 valid fixtures matched
identity: 49/49 invalid fixtures matched
gzip: 39/39 valid fixtures matched
gzip: 49/49 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: login, project, key mint/revoke, ingest/replay, read routes, SSE, settings, CSRF, logout.
generated 525 events
accepted 525 rejected batches 0
identities {'strong': 13, 'key': 6, 'network': 4} distinct 23
rollup idempotence ok
restart aggregates stable
late hour 2026-10-01 00:00:00+00:00 62 -> 63
explicit overview method exact span 5:00:00
24h funnel connected 4 returned_day_7 None
d1 api 85.7 expected 85.7 anniversary-ended 85.7 eligible 7
errors after sustained backdate firing
probe row true 2
perf facts 100000
BENCH overview: 169.15 ms
BENCH adoption: 227.08 ms
BENCH tools: 141.77 ms
BENCH reliability: 104.98 ms
BENCH cost: 151.36 ms
BENCH protocol: 50.14 ms
BENCH digest: 212.57 ms
BENCH alerts: 1.02 ms
BENCH timeline 11.31 200
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

Final probe result (persisted here before removing `target/`):

```json
{
  "findings": [],
  "mismatches": [],
  "mismatch_count": 0,
  "timings": {
    "overview": 169.15,
    "adoption": 227.08,
    "tools": 141.77,
    "reliability": 104.98,
    "cost": 151.36,
    "protocol": 50.14,
    "digest": 212.57,
    "alerts": 1.02,
    "timeline": 11.31
  }
}
```

All three review findings are fixed, with the amended optional funnel denominator.
The full sweep also verified the dashboard compatibility fix. No requested work
remains unfinished and no API-contract divergence is left from this pass. The
probe-only executed-plan correction and browser TMPDIR requirement are documented
above; the earlier implementation report's cold-cache/concurrent-load limits still
apply. Final source/probe commits are `91eea5e`, `47d3a15`, `2caf23e`, and `6ec58b6`.

Final cleanup and ownership checks:

```sh
docker stop signals-analytics-fix-r1-pg
docker rm -v signals-analytics-fix-r1-pg
rm -r /home/vuk/orca/workspaces/signals-collector/analytics-v2/target
test ! -e /home/vuk/orca/workspaces/signals-collector/analytics-v2/target
docker ps -a --filter name=signals-analytics-fix-r1-pg --format '{{.Names}}'
ss -ltnp '( sport = :25439 or sport = :25448 or sport = :25449 or sport = :25483 )'
git diff --check
git diff 05705be --name-only -- web spec deploy
git status --porcelain
```

Stop/remove each printed `signals-analytics-fix-r1-pg`. The socket check printed
only its header; target-existence, container-list, diff, protected-tree and final
working-tree checks produced no output. The temporary database, all task listeners
and `target/` are gone. All changes are committed on the original task branch;
nothing was pushed.

## Settings read

Merged main before implementation with `git merge main`:

```text
Updating 71e29ca..f00e64b
Fast-forward
57 files changed, 1795 insertions(+), 140 deletions(-)
```

Post-merge baseline: `f00e64b`; settings-read implementation: `71cc3d4`.

Changes by file:

- `crates/signals-server/src/auth.rs`: one explicit safe project serializer, used
  by the account/session payload builder (`account` in this checkout). Account
  queries fetch settings with projects in one query, preserving tenant/deletion
  filtering and avoiding per-project queries. Only the six documented setting
  fields and derived `probe_key_set` are copied; the credential is never copied.
- `crates/signals-server/src/handlers.rs`: adds session-only project GET with
  membership enforcement; PATCH uses the same serializer and ignores the derived
  read-only flag on document round-trips.
- `crates/signals-server/src/analytics.rs`: returns stored settings internally to
  that serializer so it can derive key presence for PATCH without exposing the key.
- `crates/signals-server/src/lib.rs`: registers project GET alongside PATCH.
- `crates/signals-server/src/openapi.rs`: documents the GET route, session-only
  security, and safe project shape shared by GET/PATCH/account. Keeps the unchanged
  admin provisioning response in its own base-project schema.
- `crates/signals-server/tests/analytics.rs`: extends the ignored integration test
  with default settings, non-default PATCH/GET/auth-me equality, credential
  redaction/clearing, safe document round-trips, missing sessions/API-key-only
  rejection, cross-tenant denial, missing projects, and viewer read/write checks.
- `.sqlx/`: regenerated metadata for the two project reads and settings update.
- `docs/analytics.md`: documents the read contract, authorization, clearing and
  derived flag behavior.

The first build caught a missing `sqlx::Row` import in the new GET handler; adding
it fixed compilation before the validation runs below. No storage migration was
needed.

Verification environment:

```sh
export PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 SQLX_OFFLINE=false
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25439/signals
export TEST_DATABASE_URL=postgres://postgres:signals@127.0.0.1:25439/signals
docker run -d --name signals-settings-read-pg --shm-size=1g \
  -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals \
  -p 127.0.0.1:25439:5432 postgres:18.6-bookworm
cargo sqlx migrate run --source crates/signals-store/migrations
docker exec -i signals-settings-read-pg psql -U postgres -d signals \
  -v ON_ERROR_STOP=1 < .sqlx/dev.sql
```

Migrations and preparation exited 0, ending in `CREATE TABLE`. Embedded assets were
rebuilt from merged main without editing web sources:

```sh
cd web
export BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache
bun install --frozen-lockfile && bun run build
```

Exit 0; final output:

```text
dist/assets/index-D1xdhruj.js  300.99 kB │ gzip: 92.28 kB
✓ built in 209ms
```

Targeted integration validation:

```sh
cargo test --locked -p signals-server --test analytics -- --ignored --nocapture
```

Exit 0; final output:

```text
PASS settings PATCH/GET/auth-me round-trip, key redaction and clearing, session membership and viewer access
PASS 90-day metric responses survive raw retention; argument bodies and arbitrary attributes are excluded from analytics facts
PASS empty tool names have distinct tool and project aggregate scopes
PASS all nine analytics routes, both SDK source shapes, identities, retries, paths, nulls, filtering, replay and rollup idempotence
test three_day_analytics_contract_and_idempotence ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.21s
```

Final Rust and query-metadata verification commands:

```sh
cargo sqlx prepare --workspace -- --all-targets
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo sqlx prepare --workspace --check -- --all-targets
cargo run --locked -p signals-xtask -- --check
cargo build --locked --bin signals
SIGNALS_BENCH_ROWS=100000 cargo test --locked --release --workspace -- --ignored --test-threads=1
```

All exited 0; formatting produced no output. Selected final output:

```text
    Finished `dev` profile [unoptimized] target(s) in 3.95s
query data written to .sqlx in the workspace root; please check this into version control
    Finished `dev` profile [unoptimized] target(s) in 2.33s
    Finished `test` profile [unoptimized] target(s) in 3.11s
    Finished `dev` profile [unoptimized] target(s) in 3.22s
    Finished `dev` profile [unoptimized] target(s) in 1.88s
Official schemas parsed; runtime validation replaces generated wire types
    Finished `dev` profile [unoptimized] target(s) in 7.77s
    Finished `release` profile [optimized] target(s) in 2m 35s
test three_day_analytics_contract_and_idempotence ... ok
test collector_replays_late_rollups_tenant_isolation_and_keys ... ok
test migration_comment_cleanup_preserves_existing_databases ... ok
test thirty_day_dashboard_measurements ... ok
test random_lateness_matches_brute_force_sql ... ok
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok
```

Workspace unit tests passed (9 core, 5 server, 7 store), and all seven ignored
database tests passed in release mode with the existing latency threshold intact.

Conformance and browser QA:

```sh
PLAYWRIGHT_CHANNEL=chromium ANALYTICS_PG_CONTAINER=signals-settings-read-pg \
  SIGNALS_URL=http://127.0.0.1:25483 PYTHONUNBUFFERED=1 python3 - <<'PY'
import os, subprocess, tempfile
with tempfile.TemporaryDirectory(prefix='settings-', dir='/var/tmp') as tmp:
    subprocess.run(['python3', 'scripts/ci-conformance.py'],
                   env={**os.environ, 'TMPDIR': tmp}, check=True)
PY
```

The combined command exited 1 at the existing browser QA selector, after the spec,
transport and login-style checks passed:

```text
identity: 39/39 valid fixtures matched
identity: 49/49 invalid fixtures matched
gzip: 39/39 valid fixtures matched
gzip: 49/49 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
TimeoutError: waitFor: Timeout 30000ms exceeded.
- waiting for getByRole('heading', { name: 'Overview.', exact: true }) to be visible
```

Merged dashboard v2 uses `Overview` instead. The coordinator confirmed in message
`msg_1c7c757a0f4f` that its author is rewriting `web/scripts/backend-qa.mjs` in the
dash-v2 worktree, instructed this worker not to edit `web/`, and accepted separate
Rust/database/SQLx/spec/transport verification for this task. Browser QA remains
that worker's responsibility; no web source was changed here.

The spec and transport scripts were then run separately from browser QA, reusing
the existing harness's isolated collector/provisioning/finally-cleanup code:

```sh
export PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25439/signals
export ANALYTICS_PG_CONTAINER=signals-settings-read-pg SIGNALS_URL=http://127.0.0.1:25483 PYTHONUNBUFFERED=1
python3 - <<'PY'
from pathlib import Path
p = Path('scripts/ci-conformance.py').resolve()
source = p.read_text().split('# Run the independent analytics review probe')[0]
source = '\n'.join(line for line in source.splitlines() if '"qa:backend"' not in line)
exec(compile(source, str(p), 'exec'), {'__file__': str(p), '__name__': '__main__'})
PY
```

Exit 0, with the same 39/39 valid and 49/49 invalid results for both identity and
gzip, and the transport PASS line above. This runs the original spec and transport
scripts without modifying any assertions or tracked harness files.

Independent analytics review probe:

```sh
export PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25439/signals SQLX_OFFLINE=false
cargo build --locked --release --bin signals
ANALYTICS_PG_CONTAINER=signals-settings-read-pg PYTHONUNBUFFERED=1 python3 scripts/analytics-review-probe.py
```

Build exited 0; probe exited 1 with zero semantic mismatches and one latency
finding. All other checks, including executed query-plan guards, passed. Final
output was `FINDINGS 1 MISMATCHES 0`; the complete findings artifact is preserved
below before target cleanup:

```json
{
  "findings": [
    {
      "severity": "should-fix",
      "id": "perf-reliability",
      "detail": "447.28 ms"
    }
  ],
  "mismatches": [],
  "mismatch_count": 0,
  "timings": {
    "overview": 175.53,
    "adoption": 265.83,
    "tools": 132.46,
    "reliability": 447.28,
    "cost": 139.07,
    "protocol": 49.64,
    "digest": 191.19,
    "alerts": 2.03,
    "timeline": 13.93
  }
}
```

Repeated the same warmup plus three timing samples on the existing 100k-event
project, using a freshly started release server and the probe's request helper:

```sh
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25439/signals ANALYTICS_PG_CONTAINER=signals-settings-read-pg
python3 - <<'PYCODE'
import importlib.util,time,json
spec=importlib.util.spec_from_file_location('probe','scripts/analytics-review-probe.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
try:
 p.restart_server(); c=p.Client()
 project=p.psql("SELECT id FROM projects WHERE slug='perf' ORDER BY created_at DESC LIMIT 1").strip()
 key=c.admin('keys',{'project_id':project,'label':'timing repeat','scopes':['read']})['secret']
 for route in ('overview','adoption','tools','reliability','cost','protocol','digest','alerts'):
  url=f'/v1/projects/{project}/analytics/{route}?range=7d'
  c.request('GET',url,key=key)
  samples=[]
  for _ in range(3):
   started=time.perf_counter();status,_,_=c.request('GET',url,key=key);assert status==200
   samples.append(round((time.perf_counter()-started)*1000,2))
  print(route,json.dumps(samples),flush=True)
finally:p.stop_server()
PYCODE
```

Exit 0; all repeated measurements were below 300 ms:

```text
overview [179.09, 174.76, 175.15]
adoption [256.17, 221.88, 227.97]
tools [135.89, 167.04, 138.63]
reliability [94.1, 97.65, 106.54]
cost [154.22, 146.75, 146.13]
protocol [46.53, 45.26, 46.49]
digest [177.01, 162.07, 183.25]
alerts [1.96, 1.92, 1.99]
```

The coordinator accepted finalization with both the 447.28 ms measurement and
94–107 ms repeat recorded, explicitly requiring no fresh full probe. The
coordinator also confirmed that the integration branch (`dash-v2`) already merged
the settings-read implementation commit `71cc3d4`. No analytics query changes or
threshold relaxation were made for this settings task. Remaining external work is
the dashboard worker's browser QA update noted above; no settings-read work remains.

Cleanup and ownership checks:

```sh
docker stop signals-settings-read-pg
docker rm -v signals-settings-read-pg
rm -r /home/vuk/orca/workspaces/signals-collector/analytics-v2/target
test ! -e /home/vuk/orca/workspaces/signals-collector/analytics-v2/target
docker ps -a --filter name=signals-settings-read-pg --format '{{.Names}}'
ss -ltnp '( sport = :25439 or sport = :25448 or sport = :25449 or sport = :25483 )'
git diff f00e64b --name-only -- web spec deploy
git diff --check
```

All exited 0: stop/remove each printed `signals-settings-read-pg`; no matching
container remained, socket output was header-only, target was absent, ownership
diff and whitespace check were empty. Changes are committed locally; no push.
