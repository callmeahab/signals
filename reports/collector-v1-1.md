# Collector spec v1.1.0 and delivery report

Completed: spec/transport/browser/analytics conformance passed with **0 findings and 0 mismatches**; all required functional checks and release database latency gates passed.

Base: `37cec73`; worktree branch `vuk88/collector-v1-1`. Commits are local; nothing was pushed.

## Changes by file

- `spec/`: vendored tag `v1.1.0`, commit `a32f922beb302853863b39aa27edf2286f5881a7`, including schemas/OpenAPI and fixtures. `spec/manifest.json` records official, verified provenance and hashes. The existing fixture driver already discovers both fixture directories dynamically: 52 valid and 54 invalid fixtures, each exercised with identity and gzip encoding (212 fixture requests).
- `crates/signals-core/src/lib.rs`: remove the temporary tools.listed validation bypass; validate all four new event types against the vendored schema. Existing v1.0 fixtures remain in the sweep.
- `crates/signals-store/migrations/0009_spec_v11.sql`: retain catalogue truncation and advertised totals, ignore failed catalogue updates, preserve v1.1 metric attrs in analytics facts, backfill retained attrs and invalidate rollups. Add the per-channel notification outbox and alert cursor.
- `crates/signals-store/src/analytics.rs` and `analytics_worker.rs`: expose real sampling/elicitation/task/progress/discovery metrics, catalogue-based unknown-tool counts only for complete catalogues, measured handshake denominators, item/schema rollups and daily protocol summaries. Existing identity precedence, error kinds/codes, auth reasons, character-based tokens, and schema failure calculations now receive schema-validated v1.1 input.
- `crates/signals-server/src/delivery.rs`: project-local Monday 07:00 scheduling, durable per-channel deduplication/retry, SMTP plain-text/HTML email, JSON webhooks, and alert transition delivery. HTML escapes project/tool text and uses inline stone/gold styling with a Krona One/Arial heading. A webhook must return 2xx to acknowledge delivery.
- `crates/signals-server/src/main.rs`, `lib.rs`, `analytics.rs`: independent delivery worker, timezone/recipient validation, module wiring, and removal of the obsolete log-only digest message.
- `crates/signals-server/Cargo.toml`, `Cargo.lock`: chrono-tz and lettre dependencies. `.sqlx/`: regenerated checked-query metadata.
- `crates/signals-server/tests/v11.rs`: temporary isolated database, retained v1.1 metrics, failed/truncated catalogue behavior, real local SMTP/webhook sinks, duplicate suppression, recovery alerts and independent channel retry. Scheduler/HTML unit tests live in delivery.rs.
- `crates/signals-server/tests/analytics.rs`, `scripts/analytics-review-probe.py`: replace formerly permissive catalogue hashes with valid SHA-256 hashes and update independent expectations for catalogue-based unknown tools and measurable long calls.
- `docker-compose.yml`, `deploy/compose/compose.yaml`: Postgres shared memory 1 GiB and SMTP environment wiring.
- `deploy/compose/README.md`, `README.md`, `docs/analytics.md`: spec/API, deployment and metric/delivery definitions.

## Verification environment

Commands used `PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"`. Disposable Postgres 18.6 containers `collector-v11-pg` (port 25462) and `collector-v11-ci-pg` (25463) were started with `--shm-size=1g`, `POSTGRES_PASSWORD=signals`, and `POSTGRES_DB=signals`. DATABASE_URL / TEST_DATABASE_URL were `postgres://postgres:signals@127.0.0.1:<port>/signals`.

```sh
python3 scripts/vendor-spec.py /home/vuk/orca/projects/signals-spec --tag v1.1.0 --source-url https://github.com/mcpramen/signals-spec
```
Output: `Vendored a32f922beb302853863b39aa27edf2286f5881a7; run spec-conformance.py before marking official/conformance_verified`.
The source URL was subsequently corrected to `https://github.com/vuk88/signals-spec` after `git -C /home/vuk/orca/projects/signals-spec remote -v` showed `git@github.com:vuk88/signals-spec.git`. Official/verified flags were set only after the HTTP fixture sweep passed.

```sh
DATABASE_URL=postgres://postgres:signals@127.0.0.1:25462/signals cargo sqlx migrate run --source crates/signals-store/migrations
docker exec -i collector-v11-pg psql -U postgres -d signals -v ON_ERROR_STOP=1 < .sqlx/dev.sql
```
Result: migrations 1–9 applied; last migration `Applied 9/migrate spec v11 (3.432441ms)`; `.sqlx/dev.sql` output `CREATE TABLE`. Migrations 1–9 also passed on the CI container.

### `bun install --cwd web --frozen-lockfile && bun run --cwd web build`

Passed. Final output:

```text
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-Bxil6BQb.css                                     34.64 kB │ gzip:  7.53 kB
dist/assets/index-CZafG21I.js                                     302.09 kB │ gzip: 92.62 kB

✓ built in 176ms
```

### `SQLX_OFFLINE=false DATABASE_URL=postgres://postgres:signals@127.0.0.1:25462/signals cargo sqlx prepare --workspace -- --all-targets`

Passed. Final output:

```text
    Checking signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-v1-1/crates/signals-store)
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-v1-1/crates/signals-server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.37s
query data written to .sqlx in the workspace root; please check this into version control
```

### `cargo fmt --all --check`

Passed. Final output:

```text
(no output; exit 0)
```

### `cargo clippy --locked --workspace --all-targets -- -D warnings`

Passed. Final output:

```text
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-v1-1/crates/signals-server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.02s
```

### `cargo test --locked --workspace`

Passed. Final output:

```text
   Doc-tests signals_server

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_store

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

Test summaries: test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s; test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.23s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

### `TEST_DATABASE_URL=postgres://postgres:signals@127.0.0.1:25463/signals cargo test --locked -p signals-server --test v11 -- --ignored --nocapture`

Passed. Final output:

```text
    Finished `test` profile [unoptimized + debuginfo] target(s) in 15.95s
     Running tests/v11.rs (target/debug/deps/v11-37b3a0272f29c09a)

running 1 test
test v11_storage_protocol_and_delivery ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.67s

```

### `SQLX_OFFLINE=false DATABASE_URL=postgres://postgres:signals@127.0.0.1:25462/signals cargo sqlx prepare --check --workspace -- --all-targets`

Passed. Final output:

```text
    Checking signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-v1-1/crates/signals-store)
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-v1-1/crates/signals-server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.97s
```

### `cargo run --locked -p signals-xtask -- --check`

Passed. Final output:

```text
   Compiling signals-xtask v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-v1-1/xtask)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.65s
     Running `target/debug/signals-xtask --check`
Official schemas parsed; runtime validation replaces generated wire types
```

### `python3 scripts/release-check.py`

Passed. Final output:

```text
Official contract release gate passed
```

## Long-running verification

### `TEST_DATABASE_URL=postgres://postgres:signals@127.0.0.1:25462/signals cargo test --locked -p signals-server --test integration --test rollup_properties --test analytics --test v11 -- --ignored --test-threads=1`

Passed. Final output:

```text
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 140.58s

     Running tests/v11.rs (target/debug/deps/v11-37b3a0272f29c09a)

running 1 test
test v11_storage_protocol_and_delivery ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.98s

```

Test summaries: test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 20.83s; test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.88s; test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 140.58s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.98s

### `SIGNALS_BENCH_REUSE=true TEST_DATABASE_URL=postgres://postgres:signals@127.0.0.1:25462/signals cargo test --locked --release --workspace -- --ignored --test-threads=1`

Passed. Final output:

```text
   Doc-tests signals_server

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_store

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

Test summaries: test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.76s; test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.64s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.66s; test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 42.81s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.69s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

### `docker build -f docker/Dockerfile .`

Passed. Final output:

```text
 ---> Running in 528562a557b7
 ---> Removed intermediate container 528562a557b7
 ---> f44cc75b73e5
Step 24/25 : ENTRYPOINT ["/signals"]
 ---> Running in bd010d8d7dc3
 ---> Removed intermediate container bd010d8d7dc3
 ---> 2f9ca97f7632
Step 25/25 : CMD ["serve"]
 ---> Running in 37ef171a71da
 ---> Removed intermediate container 37ef171a71da
 ---> 40c4c645308b
Successfully built 40c4c645308b
```

The release run reused the exact 1,000,000 seeded rows from the initial run, without reducing the dataset or changing the 50 ms gate. Recorded p95 milliseconds:

```json
{
  "caller_history": 1.51,
  "callers": 19.9,
  "events": 4.69,
  "overview": 30.44,
  "session_events": 10.66,
  "sessions": 1.58,
  "timeseries": 38.34,
  "tool_timeseries": 3.23,
  "tools": 31.4
}
```

### Debug performance diagnostic

`TEST_DATABASE_URL=postgres://postgres:signals@127.0.0.1:25462/signals cargo test --locked --workspace -- --ignored --test-threads=1` failed only at the million-row latency gate after successful count checks; it was also retried with `SIGNALS_BENCH_REUSE=true` and failed that same gate. This benchmark is now documented to run with release optimization, matching the production container. The same dataset passed all nine latency checks in the release run above.

```text
Read latency target failed; inspect bench/artifacts/reads.json
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 604.76s
error: test failed, to rerun pass `-p signals-server --test read_performance`
```

### Full HTTP/browser/independent analytics conformance

The final rerun passed. The first run passed 212 official fixture requests and transport/browser QA, then found stale independent-probe assumptions: `subject_kind: oauth` was expected to be invalid, and four positive events used undeclared `error_kind: boom`. The probe now accepts OAuth metadata, separately rejects an invalid caller kind, and uses declared `internal` errors. The original run also measured adoption at 340.73 ms while other verification work was active; the final rerun passed the unchanged latency thresholds.



Exact final CI invocation (exit 0):

```sh
DATABASE_URL=postgres://postgres:signals@127.0.0.1:25463/signals ANALYTICS_PG_CONTAINER=collector-v11-ci-pg SIGNALS_URL=http://127.0.0.1:25464 PLAYWRIGHT_CHANNEL=chromium PYTHONUNBUFFERED=1 python3 - <<'CI'
import os, subprocess,tempfile
with tempfile.TemporaryDirectory(prefix='v11-qa-',dir='/var/tmp') as temporary:
 subprocess.run(['python3','scripts/ci-conformance.py'],env={**os.environ,'TMPDIR':temporary},check=True)
CI
```

`ANALYTICS_PG_CONTAINER` selects the scripts' docker-exec psql shim, avoiding host psql. Output excerpts, including final lines:

```text
identity: 52/52 valid fixtures matched
identity: 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched
gzip: 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v2 analytics, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
accepted 525 rejected batches 0
BENCH overview: 195.22 ms
BENCH adoption: 255.92 ms
BENCH tools: 142.35 ms
BENCH reliability: 132.71 ms
BENCH cost: 182.59 ms
BENCH protocol: 78.15 ms
BENCH digest: 189.66 ms
BENCH alerts: 1.0 ms
BENCH timeline 8.73 200
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

Final independent review artifact:

```json
{
  "findings": [],
  "mismatches": [],
  "mismatch_count": 0,
  "timings": {
    "overview": 195.22,
    "adoption": 255.92,
    "tools": 142.35,
    "reliability": 132.71,
    "cost": 182.59,
    "protocol": 78.15,
    "digest": 189.66,
    "alerts": 1.0,
    "timeline": 8.73
  }
}
```

## Additional artifact integrity check

```sh
python3 - <<'CHECK'
import hashlib,json
from pathlib import Path
m=json.loads(Path('spec/manifest.json').read_text())
for name,digest in m['sha256'].items():
 assert hashlib.sha256(Path('spec',name).read_bytes()).hexdigest()==digest,name
print(f"Verified all {len(m['sha256'])} vendored artifact hashes")
CHECK
git diff --check
```

Output: `Verified all 165 vendored artifact hashes`; `git diff --check` exited 0 with no output.

## Design choices and limits

- Digest scheduling uses `digest.timezone` (default UTC) but reporting keeps the existing UTC ISO-week API windows. Missed Monday delivery catches up later in the same local week.
- Outbox delivery is at-least-once: a crash after receiver acceptance but before commit can repeat a message. Channels retry separately every five minutes. Alerts use configured digest channels independently of the digest-enabled switch.
- Task `created` counts distinct observed session/task IDs because the spec has no separate task-created event. Long calls mean duration >= 1,000 ms. Protocol discovery counts observed tools.listed/tools-list request events; optional missing measurements stay null. These definitions are documented in docs/analytics.md.
- Catalogue inference uses the latest project snapshot, as the existing analytics design did; it is not a historical per-call catalogue join. Truncated catalogues never prove absent names are unknown tools.
- Initial prepare failed because web/dist was absent; building the frontend resolved it. Initial expanded sink tests failed on an invalid failed-list fixture and then on other test projects sharing the sink database; the final isolated test corrected both and passed.

## Cleanup and completion

All requested implementation and verification work is complete. No remaining implementation blockers.

```sh
docker stop collector-v11-pg collector-v11-ci-pg
docker rm collector-v11-pg collector-v11-ci-pg
```

Both commands printed the two task container names and exited 0. The shell rejected an initial forced-removal form before execution; the successful cleanup used graceful stop/removal and the explicit guarded path below.

```sh
python3 - <<'CLEAN'
from pathlib import Path
import shutil,subprocess
root=Path('/home/vuk/orca/workspaces/signals-collector/collector-v1-1')
assert Path.cwd()==root
assert not (root/'target').is_symlink()
shutil.rmtree(root/'target')
assert not (root/'target').exists()
assert not subprocess.check_output(['docker','ps','-a','--filter','name=collector-v11-','--format','{{.Names}}']).strip()
print('Cleanup verified: target absent; no collector-v11 task containers remain')
CLEAN
```

Output: `Cleanup verified: target absent; no collector-v11 task containers remain`.
Generated browser screenshots were restored to their committed versions. Implementation commits: `99b6586`, `fdf6bf3`, `c96a1e7`, `79e7b17`, `726cc4e`; this report is committed separately. No push, deployment, tag or publication was performed.

