# Collector ingest migration report

Migrated the owned collector ingest path to signals-spec v1.0.15, pinned to
`8cdcccbcd38841acfb8aad29eb493c0c9c7aa9e0`. All 39 valid fixtures and all **49** invalid
fixture files match through HTTP in both identity and gzip modes. The brief's 44
invalid count differs from the actual pinned tree; every invalid file was tested.
The normal wall-clock path and a real Python SDK MCP tool call also passed.

## Changes by file

- `spec/events.schema.json`, `spec/batch.schema.json`, `spec/ingest.openapi.yaml`,
  `spec/fixtures/**`, `spec/manifest.json`: immutable official artifacts and SHA-256s;
  official/verified flags enabled only after the HTTP driver passed. Removed the
  two development artifacts. All 142 manifest hashes were checked against git
  objects at the pinned commit.
- `crates/signals-core/src/lib.rs`: full envelope validation; runtime JSON Schema
  event validation; reference rejection precedence; UUIDv7, size, timestamp,
  duplicate, and iterative depth checks; unbounded-depth parser with stack growth
  and iterative disposal; NDJSON; post-validation NUL normalization; handwritten
  storage mapping. Removed generated `src/wire.rs`.
- `crates/signals-server/src/handlers.rs`: authentication before body decoding,
  gzip/identity, media types, spec errors, replay acceptance, opt-in conformance
  clock, source/caller enrichment, scoped ingest and any-valid-key whoami.
- `crates/signals-server/src/auth.rs`: case-insensitive Bearer and whitespace,
  explicit empty scope for whoami. Existing dashboard/session authentication kept.
- `crates/signals-server/src/lib.rs`, `middleware.rs`: separate ingest errors,
  10-second timeout with JSON 503; existing admin/dashboard decompression retained.
- `crates/signals-server/src/openapi.rs`: official ingest OpenAPI and updated
  identity/read metadata models.
- `crates/signals-store/migrations/0003_spec_v1.sql`: queryable source/client/caller
  JSONB columns and old event-type migration; existing migrations untouched.
- `crates/signals-store/src/ingest.rs`: binary COPY metadata, atomic internal errors
  instead of non-contract storage rejections, synchronized partition creation.
- `crates/signals-store/src/read.rs`, `workers.rs`: spec type names, source/client/
  hashed-caller metadata in read output. `.sqlx/query-*.json`: regenerated offline
  query cache with the new schema and queries.
- `crates/signals-server/tests/{integration,rollup_properties,read_performance}.rs`:
  spec envelope/type updates, replay acceptance and atomic storage failure tests.
  Core tests cover all official fixtures plus 10,000-level rejection and exact
  ECMAScript whitespace behavior.
- `Cargo.toml`, `Cargo.lock`, affected crate manifests: serde unbounded depth,
  serde_stacker, flate2, UUIDv7 test generation; removed typify generation deps.
- `xtask/src/main.rs`, `xtask/Cargo.toml`: schema checks replace type regeneration.
- `scripts/spec-conformance.py`: stdlib HTTP fixture driver with readable mismatch
  diffs, both encodings, full response shape checks, wall-clock smoke option.
- `scripts/transport-conformance.py`: authentication/body precedence, gzip and media
  errors, UTF-8, limits, Bearer syntax, replay, whoami, NUL and metadata persistence.
- `scripts/vendor-spec.py`: copies git objects from the dereferenced immutable tag,
  removes stale fixtures, hashes everything, starts unverified.
- `scripts/ci-conformance.py`, `.github/workflows/signals.yml`: official fixture and
  transport drivers; isolated 30-day project with 100,000 events/min and 1 GiB/min.
- `scripts/release-check.py`: also verifies batch schema hash.
- `scripts/conformance.py`: compatibility entry point for normal-clock smoke.
- `scripts/runtime-qa.py`, `bench/ingest.js`: spec envelopes, attributes and IDs.
- `docs/storage-normalization.md`: timestamp/string, NUL, and duration projections.

No tracked files in `web/` or `examples/` were changed. No pushes or publishing.

## Verification

Rust commands used toolchain 1.99.0 with `~/.cargo/bin` on PATH. To limit disk use,
`CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0` were set.
Postgres 18.6 ran in the owned `signals-collector-ingest-postgres` container on
127.0.0.1:28432. The live fixture DB was `signals`; ignored DB tests used the separate
`signals_tests` DB. API keys were generated locally and are intentionally omitted.

### Formatting — passed

```sh
cargo fmt --all --check
```

```text

```

The format command exited 0 with no output.

### Clippy — passed

```sh
cargo clippy --locked --workspace --all-targets -- -D warnings
```

```text
    Checking signals-core v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-core)
    Checking signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-store)
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-server)
    Finished `dev` profile [unoptimized] target(s) in 2.56s
```

### Workspace tests — passed

```sh
cargo test --locked --workspace
```

```text
   Compiling signals-core v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-core)
   Compiling signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-store)
   Compiling signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-server)
    Finished `test` profile [unoptimized] target(s) in 8.28s
     Running unittests src/lib.rs (target/debug/deps/signals_core-8effd1a8a9a4c6cd)

running 4 tests
test tests::histogram_merges_and_empty_percentile_is_zero ... ok
test tests::source_uses_ecmascript_whitespace ... ok
test tests::rejects_arbitrary_depth_without_recursive_drop ... ok
test tests::official_fixtures_match_reference ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s

     Running unittests src/lib.rs (target/debug/deps/signals_server-7147899162c697b9)

running 3 tests
test auth::upgrade_tests::preserves_hmac_sha256_identity ... ok
test openapi::tests::document_covers_read_routes_and_models ... ok
test auth::upgrade_tests::verifies_existing_argon2_05_password_hashes ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.39s

     Running unittests src/main.rs (target/debug/deps/signals-1bf358302572c023)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/integration.rs (target/debug/deps/integration-f8ea8d661263bf5c)

running 2 tests
test collector_replays_late_rollups_tenant_isolation_and_keys ... ignored, Requires an isolated Postgres database in TEST_DATABASE_URL
test migration_comment_cleanup_preserves_existing_databases ... ignored, Requires an isolated Postgres database in TEST_DATABASE_URL

test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/read_performance.rs (target/debug/deps/read_performance-f5d4a339e6c450c5)

running 1 test
test thirty_day_dashboard_measurements ... ignored, Seeds a million rows in disposable TEST_DATABASE_URL; writes bench/artifacts

test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/rollup_properties.rs (target/debug/deps/rollup_properties-a08a74be8f2660be)

running 3 tests
test random_lateness_matches_brute_force_sql ... ignored, Requires isolated TEST_DATABASE_URL
test storage_error_is_atomic_and_unlimited_session_history ... ignored, Requires isolated TEST_DATABASE_URL
test worker_exclusion_partial_ranges_and_retained_caller_history ... ignored, Requires isolated TEST_DATABASE_URL

test result: ok. 0 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/lib.rs (target/debug/deps/signals_store-2598de9109d71521)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/main.rs (target/debug/deps/signals_xtask-a4ce160465a43e59)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_core

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_server

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_store

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

### xtask — passed

```sh
cargo run --locked -p signals-xtask -- --check
```

```text
   Compiling serde_core v1.0.229
   Compiling serde_json v1.0.151
   Compiling signals-xtask v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/xtask)
    Finished `dev` profile [unoptimized] target(s) in 1.29s
     Running `target/debug/signals-xtask --check`
Official schemas parsed; runtime validation replaces generated wire types
```

### Ignored database tests — passed

```sh
TEST_DATABASE_URL=postgres://signals:signals@127.0.0.1:28432/signals_tests cargo test --locked -p signals-server --test integration --test rollup_properties -- --ignored --test-threads=1
```

```text
    Finished `test` profile [unoptimized] target(s) in 0.12s
     Running tests/integration.rs (target/debug/deps/integration-f8ea8d661263bf5c)

running 2 tests
test collector_replays_late_rollups_tenant_isolation_and_keys ... ok
test migration_comment_cleanup_preserves_existing_databases ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.78s

     Running tests/rollup_properties.rs (target/debug/deps/rollup_properties-a08a74be8f2660be)

running 3 tests
test random_lateness_matches_brute_force_sql ... ok
test storage_error_is_atomic_and_unlimited_session_history ... ok
test worker_exclusion_partial_ranges_and_retained_caller_history ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 46.52s

```

### Offline query cache — passed

```sh
DATABASE_URL=postgres://signals:signals@127.0.0.1:28432/signals cargo sqlx prepare --workspace -- --all-targets
DATABASE_URL=postgres://signals:signals@127.0.0.1:28432/signals cargo sqlx prepare --check --workspace -- --all-targets
```

```text
    Checking signals-core v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-core)
    Checking signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-store)
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-server)
    Finished `dev` profile [unoptimized] target(s) in 2.15s
```

### Collector build — passed

```sh
cargo build --locked --bin signals
```

```text
   Compiling signals-core v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-core)
   Compiling signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-store)
   Compiling signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/collector-ingest/crates/signals-server)
    Finished `dev` profile [unoptimized] target(s) in 6.60s
```

### Official HTTP fixtures — passed

```sh
SIGNALS_CONFORMANCE_CLOCK=sent_at DATABASE_URL=postgres://signals:signals@127.0.0.1:28432/signals SIGNALS_BIND=127.0.0.1:28350 target/debug/signals serve
# A locally provisioned ingest/read key was exported as SIGNALS_API_KEY.
python3 scripts/spec-conformance.py --url http://127.0.0.1:28350
```

```text
identity: 39/39 valid fixtures matched
identity: 49/49 invalid fixtures matched
gzip: 39/39 valid fixtures matched
gzip: 49/49 invalid fixtures matched
```

### Normal clock — passed

```sh
# Collector at 28351 ran without SIGNALS_CONFORMANCE_CLOCK.
python3 scripts/spec-conformance.py --url http://127.0.0.1:28351 --wall-clock-smoke
```

```text
identity: 1/1 valid fixtures matched
identity: 0/0 invalid fixtures matched
gzip: 1/1 valid fixtures matched
gzip: 0/0 invalid fixtures matched
```

### Transport and storage smoke — passed

```sh
# SIGNALS_API_KEY and SIGNALS_READ_KEY were local ingest/read and read-only keys.
python3 scripts/transport-conformance.py --url http://127.0.0.1:28351
```

```text
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
```

### Retry behavior — passed

An inline Python urllib/subprocess check temporarily set the isolated project limit
via `UPDATE projects SET rate_events_per_min=1`, POSTed a batch, restored 100,000,
and held `SELECT pg_advisory_lock(1397311233); SELECT pg_sleep(12)` in an independent
connection before POSTing another batch. It asserted the error JSON and header.

### Rate and timeout output

```sh
python3 - <<'PY'
from pathlib import Path
import json, urllib.request, urllib.error, subprocess, time, datetime
key=Path('target/conformance-key').read_text()
pid=Path('target/conformance-project').read_text()
def sql(s):
    return subprocess.check_output(['docker','exec','signals-collector-ingest-postgres',
        'psql','-U','signals','-d','signals','-At','-c',s],text=True).strip()
def post():
    b=json.loads(Path('spec/fixtures/valid/tool-called.json').read_text())
    now=datetime.datetime.now(datetime.timezone.utc).isoformat(); b['sent_at']=now
    for e in b['events']: e['ts']=now
    r=urllib.request.Request('http://127.0.0.1:28351/v1/events',json.dumps(b).encode(),
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try: return urllib.request.urlopen(r,timeout=20)
    except urllib.error.HTTPError as e: return e
sql(f"UPDATE projects SET rate_events_per_min=1 WHERE id='{pid}'")
r=post(); v=json.load(r)
assert r.status==429 and r.headers.get('Retry-After')=='60' and v['error']=='rate_limited'
print('PASS 429 rate_limited with Retry-After: 60')
sql(f"UPDATE projects SET rate_events_per_min=100000 WHERE id='{pid}'")
gate=subprocess.Popen(['docker','exec','signals-collector-ingest-postgres','psql',
    '-U','signals','-d','signals','-c',
    f'SELECT pg_advisory_lock({0x53494701}); SELECT pg_sleep(12)'],stdout=subprocess.DEVNULL)
try:
    for _ in range(100):
        if sql(f"SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid={0x53494701} AND mode='ExclusiveLock' AND granted")!='0': break
        time.sleep(.05)
    start=time.monotonic(); r=post(); v=json.load(r)
    assert r.status==503 and v['error']=='internal'
    print('PASS timeout:',r.status,v,'after',round(time.monotonic()-start,1),'seconds')
finally: gate.wait(timeout=15)
PY
```

```text
PASS 429 rate_limited with Retry-After: 60
PASS timeout: 503 {'error': 'internal', 'message': 'Request timed out; retry the batch'} after 10.0 seconds
```

### Docker build — passed

```sh
docker build -f docker/Dockerfile .
```

```text
 ---> Running in 80eb3a79e568
 ---> Removed intermediate container 80eb3a79e568
 ---> e0bc7316fb51
Step 24/25 : ENTRYPOINT ["/signals"]
 ---> Running in cfcbaf9f078e
 ---> Removed intermediate container cfcbaf9f078e
 ---> cffb63f7c79d
Step 25/25 : CMD ["serve"]
 ---> Running in a33ae9748f89
 ---> Removed intermediate container a33ae9748f89
 ---> 8d70dc469d8b
Successfully built 8d70dc469d8b
```

### Web bundle — passed

Commands run in `web/`:

```sh
bun install --frozen-lockfile
bun run build
# Initial ENOSPC left a damaged cache. Recovery used a worktree-local fresh cache:
bun install --frozen-lockfile --force --cache-dir ../target/bun-cache
bun run build
```

Final output:

```text
167 packages installed [1061.00ms]
✓ 1898 modules transformed.
dist/assets/index-DoKKUJNP.css 36.65 kB │ gzip: 11.40 kB
dist/assets/index-4RA2ZuqS.js 273.35 kB │ gzip: 84.04 kB
✓ built in 530ms
```

### Real Python SDK — passed

```sh
cd /home/vuk/orca/projects/signals-python
UV_PROJECT_ENVIRONMENT=/home/vuk/orca/workspaces/signals-collector/collector-ingest/target/sdk-venv uv sync --locked --extra mcp
# From the collector worktree, using the local SIGNALS_KEY:
SIGNALS_URL=http://127.0.0.1:28351 PORT=28352 SIGNALS_DEBUG=1 target/sdk-venv/bin/python /home/vuk/orca/projects/signals-python/examples/basic_streamable_http/main.py
```

`uv sync` resolved 61 packages, installed 57, including `mcp==2.2.0` and the local
`mcpramen-signals==0.1.0`. The SDK repo's source was not edited. Client command:

```sh
target/sdk-venv/bin/python - <<'PYCLIENT'
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
async def main():
    async with streamable_http_client('http://127.0.0.1:28352/mcp') as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool('add', {'a': 2, 'b': 3})
            print(result.model_dump_json())
asyncio.run(main())
PYCLIENT
```

### SDK client output

```sh
cat /tmp/collector-sdk-client.log
```

```text
{"meta":null,"content":[{"type":"text","text":"5","annotations":null,"meta":null}],"structured_content":{"result":5},"is_error":false,"result_type":"complete"}
```

SDK server log: `HTTP Request: POST http://127.0.0.1:28351/v1/events "HTTP/1.1 202 Accepted"`.

### Stored SDK events

```sh
docker exec signals-collector-ingest-postgres psql -U signals -d signals -c "SELECT type, attrs->>'tool' AS tool, source->>'sdk' AS sdk, source->>'server_name' AS server, caller->>'ip_hash' IS NOT NULL AS hashed_ip, caller ? 'ip' AS raw_ip FROM events WHERE source->>'server_name'='signals-conformance-example' ORDER BY ts"
```

```text
      type       | tool |  sdk   |           server            | hashed_ip | raw_ip
-----------------+------+--------+-----------------------------+-----------+--------
 session.started |      | python | signals-conformance-example | t         | f
 mcp.initialize  |      | python | signals-conformance-example | t         | f
 log             | add  | python | signals-conformance-example | t         | f
 tool.called     | add  | python | signals-conformance-example | t         | f
 mcp.request     |      | python | signals-conformance-example | t         | f
 session.ended   |      | python | signals-conformance-example | t         | f
(6 rows)

```

## Known deviations and remaining integration work

- `ts` remains PostgreSQL timestamptz, so equivalent textual representations share
  an idempotency key, contrary to the spec's literal-string identity. Canonical SDK
  millisecond timestamps are unaffected; explicitly documented as allowed by brief.
- NUL becomes U+FFFD in strings and keys for PostgreSQL compatibility. The duration
  index/rollup projection saturates at i32::MAX; original duration remains in attrs.
- Full runtime fault-injection/benchmark suites and dashboard browser QA were not
  run. Their owned emitters were migrated; UI integration belongs to the other worker.
- The release gate's schema/manifest checks pass, but its pre-existing UI package
  repository assertion fails. The coordinator was notified; no out-of-scope web
  metadata edits were made. This is a publishing metadata gate, not ingest conformance.

### Existing release metadata blocker

```sh
python3 scripts/release-check.py
```

```text
Traceback (most recent call last):
  File "/home/vuk/orca/workspaces/signals-collector/collector-ingest/scripts/release-check.py", line 10, in <module>
    assert package.get("repository"),"Configure the publishing repository and npm namespace ownership first"
           ~~~~~~~~~~~^^^^^^^^^^^^^^
AssertionError: Configure the publishing repository and npm namespace ownership first
```

## Failures encountered and resolved

- Initial `cargo check -p signals-core` and `bun install --frozen-lockfile` failed
  with `No space left on device`; the coordinator freed host space. Own partial
  target artifacts were removed and Bun retried with a fresh local cache.
- Early online query compilation lacked `_sqlx_migrations` because tables had been
  loaded manually. Recreated only the owned test database schema and ran
  `cargo sqlx migrate run --source crates/signals-store/migrations`, then `.sqlx/dev.sql`.
- An initial simultaneous replay test exposed a new-partition race. Partition
  creation now takes the table lock before the second existence check; the test
  passed on a fresh database.
- Running rollup property tests alongside live server workers in the same database
  caused a deadlock. The full ignored suite passed in the separate isolated test DB.
- The first MCP client attempt used the older transport API spelling/tuple arity.
  Reading the installed MCP 2 API and using `streamable_http_client` with two streams
  resolved it; the actual tool call and stored events are shown above.

## Cleanup and commits

```text
Stopped owned collector/SDK process 3946067
Stopped owned collector/SDK process 3945874
Stopped owned collector/SDK process 3907252
Verified no listeners on 28350, 28351, or 28352
signals-collector-ingest-postgres
signals-collector-ingest-postgres
Stopped and removed owned Postgres container and its temporary volume
git diff 090f9a0 -- web examples: empty
```

Implementation commits: `50edab2`, `e3dd000`, `544be25`, `fd08c0d`.

Additional verification: `node --check bench/ingest.js` and `git diff --check` exited 0 with no output; AST parsing passed for all seven modified Python scripts.

### Conformance receipt clock — passed

```sh
docker exec signals-collector-ingest-postgres psql -U signals -d signals -c "SELECT received_at='2026-10-01T12:00:02.000Z'::timestamptz AS clock_matches_sent_at FROM events WHERE project_id='fc5adc4d-ebe3-40d2-b84a-cf1b82976b3c' AND id='01a0f755-f203-7c81-bd6b-2f6a1b4cea6b' AND ts='2026-10-01T12:00:00.003Z'::timestamptz"
```

```text
SELECT received_at='2026-10-01T12:00:02.000Z'::timestamptz AS clock_matches_sent_at FROM events WHERE project_id='fc5adc4d-ebe3-40d2-b84a-cf1b82976b3c' AND id='01a0f755-f203-7c81-bd6b-2f6a1b4cea6b' AND ts='2026-10-01T12:00:00.003Z'::timestamptz
 clock_matches_sent_at
-----------------------
 t
(1 row)


```


The official OpenAPI/schema responses were byte-compared to the vendored files with urllib, and an authenticated gzip POST to `/v1/admin/tenants` returned 200: `PASS official OpenAPI/schema bytes and existing admin gzip support`.

### Spec provenance verification

```sh
python3 scripts/vendor-spec.py /home/vuk/orca/projects/signals-spec --tag v1.0.15 --source-url https://github.com/vuk88/signals-spec.git
```

```text
Vendored 8cdcccbcd38841acfb8aad29eb493c0c9c7aa9e0; run spec-conformance.py before marking official/conformance_verified
```

The driver passed afterward and the manifest was marked official/verified. A Python
loop then compared each manifest SHA-256 and file's bytes against
`git -C /home/vuk/orca/projects/signals-spec show <pinned-commit>:<artifact>`:

```text
PASS: all 142 vendored artifact hashes match pinned commit 8cdcccbcd38841acfb8aad29eb493c0c9c7aa9e0
```
