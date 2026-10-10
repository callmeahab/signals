# Review round 2: collector ingest migration (after fix pass r1)

VERDICT: approve

Reviewed `main..HEAD` at `e2da69e` in this worktree, concentrating on the fix
pass `67b1798` ("Match ECMAScript size measurement and validate UTF-8 before
NDJSON count") and on the five checks in
`briefs/review-collector-ingest-r2.md`. Reference: `/home/vuk/orca/projects/signals-spec`
at `v1.0.15` (`8cdcccb`), `CONTRACT.md` §1/§4/§5 and
`conformance/src/lib/ingest.mjs`.

Both round-1 blockers are fixed and hold up under a differential fuzzer much
wider than the review's two cases. No blockers. One should-fix, pre-existing
and outside the fixture bar.

Harness for every HTTP result below: Postgres `postgres:18.6-bookworm` as
`signals-review-r2-pg` on `127.0.0.1:29350`; `target/debug/signals serve` on
`127.0.0.1:29351` with `SIGNALS_CONFORMANCE_CLOCK=sent_at` and a
30-day-retention project; a second collector on `127.0.0.1:29352` with the
**normal** clock (no `SIGNALS_CONFORMANCE_CLOCK`) in its own `signals_sdk`
database for check 5. Both were started with `reports/review-r2/setup.sh`.
Rust commands ran with `PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_INCREMENTAL=0`. Key material stayed in the gitignored
`target/review-r2/<port>/`; no key value appears here.

## Blockers

None.

## Should-fix

### 1. serde_json is stricter than `JSON.parse`, so a number outside binary64 fails the whole batch

CONTRACT.md §1 lists `400` for "malformed envelope / JSON" but defines no
numeric range, and the reference is `conformance/`. `JSON.parse` maps a
number whose magnitude leaves the binary64 range to `Infinity` (and
`JSON.stringify` then writes `null`), so the reference accepts such a batch.
`serde_json` rejects the token at parse time, so the collector answers
`400 malformed_json` for the **whole batch**. Per the SDK reaction table a
`400` is dropped and never retried, so one such number discards up to 1000
events.

This is reachable from the Python SDK: `finite()` in
`signals-python/src/mcpramen_signals/redact.py` maps non-finite *floats* to
`None`, but Python `int` is arbitrary precision and passes through
`json.dumps` verbatim:

```sh
cd /home/vuk/orca/projects/signals-python
uv run python -c "
from mcpramen_signals.redact import encode
out = encode({'name':'x','props':{'n': 10**400}})
print('has 401-digit token:', (b'1'+b'0'*400) in out)"
```

```text
has 401-digit token: True
```

So `signals.event('x', {'n': 10**400})` in a real MCP server produces a body
the collector refuses. Minimal reproduction (body as sent, `1e400` in
`attrs.props`):

```json
{"schema_version":1,"source":{"sdk":"node","sdk_version":"0.1.0","server_name":"orders-mcp","server_version":"1.4.2","instance_id":"i_7f3a2c9d1e","hostname":"pod-7"},"sent_at":"2026-10-10T23:33:49.496Z","dropped":0,"events":[{"id":"018f4c2a-7c3e-7a11-8b2d-6e5f4a3b2c01","ts":"2026-10-10T23:33:49.496Z","type":"custom","session_id":"s_01J9X0K3E2","client":{"name":"claude-ai","version":"1.2.0","protocol_version":"2025-06-18"},"caller":{"key_id":"k_8f3a2c","subject":null,"ip":"203.0.113.9","user_agent":"claude-ai/1.2.0"},"attrs":{"name":"checkout_started","props":{"n":1e400}}}]}
```

```sh
curl -s -X POST http://127.0.0.1:29351/v1/events -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' --data-binary @min-1e400.json -w ' [HTTP %{http_code}]'
node reports/review-r2/reference.mjs verdict /home/vuk/orca/projects/signals-spec json < min-1e400.json
```

Observed:

```text
collector: {"error":"malformed_json","message":"malformed json"} [HTTP 400]
reference: {"status":202,"error":null,"accepted":1,"rejected":[],"keys":["accepted","rejected"]}
node sees: props.n = Infinity | JSON.stringify bytes = 352
```

`reports/review-r2/edge_probe.py` reproduces it for `1e400`, `-1e400`,
`1e309` and a 401-digit integer (`1e-400`, which underflows to `0` in both,
matches and is a passing control). The same probe shows one more instance of
the same shape: a `\uD800` lone-surrogate escape, which `JSON.parse` accepts
and `serde_json` rejects as `400 malformed_json`. That one is not reachable
from either SDK — `redact.py` `repair_string` and `signals-node`
`src/redact.ts` `wellFormed` both replace lone surrogates with U+FFFD before
emitting — so it only affects a third-party producer.

```sh
SIGNALS_API_KEY=... python3 reports/review-r2/edge_probe.py --url http://127.0.0.1:29351
```

```text
FAIL number 1e400 -> Infinity
FAIL number -1e400 -> -Infinity
PASS number 1e-400 -> 0
FAIL number 1e309 -> Infinity
FAIL number 401-digit integer
FAIL lone surrogate escape \ud800
11 passed, 5 failed
```

Expected: the reference's verdict, i.e. not a whole-batch `400`. Why this is
not a blocker: RFC 8259 §6 explicitly permits an implementation to limit the
range and precision of numbers and §8.2 permits rejecting unpaired
surrogates; CONTRACT.md scopes reference equality to the fixtures ("must
produce the same `rejected` lists for `fixtures/invalid` and accept
`fixtures/valid` in full") and no fixture carries an out-of-range number; and
the behaviour predates this fix pass. It is the coordinator's call whether the
collector should match `JSON.parse` here (coerce out-of-range to a per-event
`schema` rejection, or to the reference's `Infinity`) or whether the Python
SDK should clamp. The brief's own fuzzer pool is finite binary64 and found
**zero** mismatches (below).

## Verified claims

Every command below was run in this review; outputs are the tails of my own
runs, not copied from `reports/collector-ingest.md`.

### Check 1 — number spelling, exhaustively

`reports/review-r2/number_fuzz.py` builds batches whose numbers are written on
the wire in forms that differ from `JSON.stringify`, solves the pad string so
the measured container lands exactly on `cap` and on `cap + 1` as the
reference's `serialisedBytes` sees it, posts each body to the collector, and
runs the identical bytes through `ingest.mjs`.

Coverage per run: 93 wire tokens × 4 caps (event 16384, `args` 2048,
`fields` 4096, `props` 8192) × {at cap, one over} = 744 single-token isolation
cases, plus 500 random mixed cases of 1–12 tokens drawn from the same pool at
offsets −1/0/+1 against a randomly chosen cap — 1244 posted bodies per seed.
A spelling that is wrong by one byte in either direction flips exactly one of
the at-cap / over-cap verdicts, so the isolation cases localise any token.

The pool contains everything the brief named and more: whole floats (`1.0`,
`2.0`, `-1.0`, `0.0`, `100.0`, `1.00`, `1.000000000000000`, `1.10`, `0.100`,
`1e+2`, `1e2`, `100e-2`, `123.456e3`, `1.5e3`, `0e0`, `5.0e-1`), `-0.0` and
`-0e0` and `-0` (`JSON.stringify(-0)` is `"0"`), the exponent thresholds
(`1e20`, `1e21`, `1e22`, `1E+21`, `9.999999999999999e20`, `1e-6`, `1e-7`,
`0.000001`, `0.0000001`, `1e23`, `6e-7`), integers past 2^53 that serde keeps
exact and JavaScript rounds (`9007199254740993`, `4503599627370497`,
`9223372036854775807`, `-9223372036854775809`, `18446744073709551615`,
`18446744073709551616`, `123456789012345680000`, `1000000000000000100`,
`184467440737095516150`, 39-, 40- and 69-digit integers), the denormal and
magnitude extremes (`5e-324`, `4.9e-324`, `1e-323`,
`2.2250738585072014e-308`, `2.225073858507201e-308`,
`1.7976931348623157e308`, `8.98846567431158e307`, `1.5e300`, `-1.5e-300`,
`1e308`, `1e-308`), and shortest-round-trip corner cases (`0.1`, `0.3`,
`0.30000000000000004`, `1.2345678901234567`, `1.0000000000000002`,
`0.000001000000000000001`, `123456789.12345679`).

```sh
SIGNALS_API_KEY=... python3 reports/review-r2/number_fuzz.py --url http://127.0.0.1:29351 --cases 500
SIGNALS_API_KEY=... python3 reports/review-r2/number_fuzz.py --url http://127.0.0.1:29351 --cases 500 --seed 777
```

```text
1244/1244 cases matched the reference (0 unbuildable)
1244/1244 cases matched the reference (0 unbuildable)
```

Escaped characters measured at the cap match too (`edge_probe.py`, control
characters `\x01 \x02 \x1f \b \f \n \r \t \\ \" \x7f` inside `props` with the
event at exactly 16384 and at 16385):

```text
PASS escaped control chars at 16384
PASS escaped control chars at 16385
```

The author's claim that storage is unchanged holds. Posting
`props:{"whole":1.0,"negzero":-0.0,"bigint":18446744073709551615,"exp":1e21}`
(wire spelling) gave `202 {"accepted":1,"rejected":[]}` and:

```text
stored jsonb: {"exp": 1000000000000000000000, "whole": 1.0, "bigint": 18446744073709551615, "negzero": 0.0}
read API:     {"bigint":18446744073709551615,"exp":1e+21,"negzero":0.0,"whole":1.0}
```

`1.0` keeps its fractional part, and the u64 is stored exactly rather than
rounded to the `18446744073709552000` the measurement uses — the measuring
serialiser does not touch the stored value. (`-0.0` lands as `0.0`: Postgres
`numeric` has no signed zero. Not a measurement path and not a finding.)

The measurement reads `ryu_js::Buffer::format_finite(n.as_f64())`.
`arbitrary_precision` is off, so `as_f64` cannot be `None`, and serde_json
rejects out-of-range literals before this point, so the `expect` is
unreachable; `float_roundtrip` is on (enabled by `jsonschema` 0.58.4), which
is what makes `as_f64` the same double `JSON.parse` produces for long decimal
literals.

### Check 2 — UTF-8 ordering per CONTRACT.md §1

All three placements, plus three controls, against the reference
(`reports/review-r2/edge_probe.py`):

```text
PASS (a) invalid utf8 before envelope line, 1002 lines
  collector 400 malformed_body / reference 400 malformed_body (decodedBytes 374592)
PASS (b) invalid utf8 inside event line 1001
  collector 400 malformed_body / reference 400 malformed_body
PASS (b2) invalid utf8 inside event line, 10 events
  collector 400 malformed_body / reference 400 malformed_body
PASS control valid utf8, 1001 events, bad envelope line
  collector 413 too_many_events / reference 413 too_many_events
PASS (c) invalid utf8 in gzip decoding over 1MB
  collector 413 body_too_large / reference 413 body_too_large (decodedBytes 1107677)
PASS control valid utf8 gzip over 1MB
  collector 413 body_too_large / reference 413 body_too_large
PASS control invalid utf8 gzip under 1MB
  collector 400 malformed_body / reference 400 malformed_body
PASS ndjson crlf line endings
  collector 202 accepted 3 rejected [] / reference 202 accepted 3 rejected []
```

(a) and (b) are `400 malformed_body` as the brief expects, (c) is
`413 body_too_large` because the decoded-size check still runs first, and the
valid-UTF-8 1001-line control still reaches `413 too_many_events` — so the
new order did not flatten the count check. `parse_batch`
(`crates/signals-core/src/lib.rs:85-99`) now reads size → `str::from_utf8` →
line count → parse, which is CONTRACT.md §1 and `parseBody` in `ingest.mjs`.
The round-1 probe is clean:

```sh
SIGNALS_API_KEY=... python3 reports/review-r1/probe.py --url http://127.0.0.1:29351
```

```text
PASS utf8 invalid short json
PASS utf8 invalid ndjson over event count
PASS canonical_16384
PASS canonical_16385
PASS wire_1_0_js_16384
5 passed, 0 failed
```

`scripts/transport-conformance.py` encodes the new order rather than the old
one (`git show 67b1798 -- scripts/transport-conformance.py`): invalid UTF-8
plus 1001 `{}` lines expects `400 malformed_body`, and `bad envelope` plus
1001 lines expects `413 too_many_events`, under both identity and gzip.

### Check 3 — the round-1 checks that fixtures do not prove

`reports/review-r2/storage_probe.py` posts one event of each of the ten spec
types (built from the official fixtures, re-stamped to now, one shared
session, a `caller.ip`) and then checks the read API, idempotency and the
rollup worker. Rollup comparisons recount `events` restricted to
`received_at <= rollup_cursor.received_at_watermark`, so they compare the
same slice the worker owns.

```sh
SIGNALS_API_KEY=... SIGNALS_READ_KEY=... python3 reports/review-r2/storage_probe.py \
  --url http://127.0.0.1:29351 --project <id> --pg-container signals-review-r2-pg
```

```text
PASS ten-type batch accepted: 202 {'accepted': 10, 'rejected': []}
PASS read API events route answers 200: 200
PASS read API returns all ten spec types: ['custom', 'error', 'log', 'mcp.initialize', 'mcp.request', 'prompt.get', 'resource.read', 'session.ended', 'session.started', 'tool.called']
PASS read API returns source for every type: []
PASS source.server_name is the batch's: []
PASS read API returns client for every type: []
PASS read API returns a 64-hex caller.ip_hash for every type: []
PASS read API never returns the raw caller.ip: []
PASS raw caller.ip is absent from the events row: 0
PASS ten rows stored: 10
PASS identical replay is accepted and not stored twice: 202 {'accepted': 10, 'rejected': []} rows=10
PASS replay with a respelled ts stays one row: 202 {'accepted': 1, 'rejected': []} ['1', '1']
PASS a different instant for the same id stores a second row: 202 {'accepted': 1, 'rejected': []} rows=2
PASS rollup_project_hourly matches a brute-force recount over all ten types: rollup=[['39', '3', '6']] events=['39', '3', '6']
PASS rollup_tool_hourly counts only tool.called: rollup=['6'] events=['6']
PASS sessions row counts non-session events and sees session.ended: sessions=[['8', '1', 'true']] events=['8', '1']
PASS the probe events carry one caller_id: [['9']]
PASS rollup_caller_daily matches a brute-force recount up to the watermark: rollup=[['32', '4']] events=['32', '4'] caller_id=9 day=2026-10-10
PASS overview answers 200 with the rolled-up request count: 200
PASS tools route lists the tool.called tool: 200 ['search_orders']
PASS sessions route lists the probe session: 200 1
PASS callers route answers 200: 200
PASS session events route returns all ten types: 200 ['custom', 'error', 'log', 'mcp.initialize', 'mcp.request', 'prompt.get', 'resource.read', 'session.ended', 'session.started', 'tool.called']
OK: 0 failed
```

Idempotency with a changed `ts` string: the same id re-sent with `+00:00`
instead of `Z` for the same instant stays one row with one distinct `ts`
(the timestamptz normalisation that `docs/storage-normalization.md` records),
and the same id at a genuinely different instant stores a second row — both
`accepted: 1`, so `accepted + rejected.len()` still equals the events sent.

Rollups cover all ten spec names behaviourally, not just by grep: the three
rollup tables and `sessions` equal a brute-force recount using
`type NOT LIKE 'session.%'`, `type='tool.called'` and `type='session.ended'`.
`crates/signals-store/src/workers.rs` and `read.rs` contain no occurrence of
the old `tool.call` / `session.start` / `session.end` / `request` names.

`cargo sqlx prepare --check`, run the way `.github/workflows/signals.yml`
runs it (migrate, then apply `.sqlx/dev.sql` for the `ingest_stage`
transaction-local stand-in):

```sh
docker exec -i signals-review-r2-pg psql -U signals -d signals -v ON_ERROR_STOP=1 < .sqlx/dev.sql
DATABASE_URL=postgres://signals:signals@127.0.0.1:29350/signals cargo sqlx prepare --check --workspace -- --all-targets
```

```text
CREATE TABLE
    Finished `dev` profile [unoptimized] target(s) in 2.09s
SQLX_CHECK_EXIT:0
```

The stand-in was dropped afterwards.

```sh
docker build -f docker/Dockerfile -t signals-review:r2 .
```

```text
Successfully built cb46e00d6ca8
Successfully tagged signals-review:r2
```

The image was removed after this report (`docker rmi signals-review:r2`).

### Check 4 — the vendored spec is intact and untouched

```sh
python3 reports/review-r2/manifest_check.py
```

```text
PASS manifest mode is official: official
PASS manifest conformance_verified is true: True
PASS manifest tag/commit are the frozen spec: v1.0.15 8cdcccbcd38841acfb8aad29eb493c0c9c7aa9e0
PASS all 142 manifest hashes match the vendored files: mismatched=[] missing=[]
PASS no vendored file is missing from the manifest: []
PASS all 142 vendored files equal 8cdcccb in the spec checkout: differs=[] absent=[]
PASS spec/ is unchanged in c1811a7..HEAD: 
PASS spec/ is clean in the working tree: 
OK: 0 failed
```

All 142 `sha256` entries match both the file on disk and
`git -C /home/vuk/orca/projects/signals-spec show 8cdcccb:<path>`, no
vendored file is unlisted, and `spec/` is byte-identical to `c1811a7` (the
HEAD round 1 reviewed), so the fix pass touched nothing under `spec/`.

### Check 5 — no regression in the real SDK path

Python SDK example against the collector on `127.0.0.1:29352` with the
**normal** clock (`CLOCK=none`, so `SIGNALS_CONFORMANCE_CLOCK` is unset),
`uv sync --locked --extra mcp` first (`Checked 57 packages`), then
`reports/review-r2/sdk_probe.sh`, which starts
`examples/basic_streamable_http/main.py`, drives one `add` tool call with the
`mcp` streamable-HTTP client, stops the example so the SDK flushes, and reads
the collector back.

```sh
COLLECTOR=http://127.0.0.1:29352 PROJECT=<id> SIGNALS_KEY=... SIGNALS_READ_KEY=... \
  reports/review-r2/sdk_probe.sh
```

```text
HTTP Request: POST http://127.0.0.1:29352/v1/events "HTTP/1.1 202 Accepted"
GET /v1/projects/{id}/events -> 200 9 events
{"ts": "2026-10-10T23:31:03.536+00:00", "type": "log", "tool": "add", ...}
{"ts": "2026-10-10T23:31:03.535+00:00", "type": "tool.called", "tool": "add", ...}
{"ts": "2026-10-10T23:31:03.532+00:00", "type": "mcp.request", ...}
{"ts": "2026-10-10T23:31:03.525+00:00", "type": "mcp.initialize", ...}
{"ts": "2026-10-10T23:31:03.525+00:00", "type": "session.started", ...}
tool.called rows for add: 1
types: ['log', 'mcp.initialize', 'mcp.request', 'session.ended', 'session.started', 'tool.called']
GET /tools -> 200 [{"calls": 1, "errors": 0, ..., "tool": "add", ...}]
RESULT: PASS
```

The stored `tool.called` row carries
`attrs {"args":{"a":2,"b":3},"cancelled":false,"duration_ms":1,"input_bytes":13,"is_error":false,"output_bytes":28,"output_kinds":["text"],"tool":"add"}`,
`source {"hostname":"rtxbox","instance_id":"i_01a12827-…","sdk":"python","sdk_version":"0.1.0","server_name":"signals-conformance-example","server_version":"0.0.0"}`,
`client {"name":"mcp","protocol_version":"2025-11-25","version":"0.1.0"}` and
a 64-hex `caller.ip_hash` with no raw `caller.ip`.

### The author's own verification commands

All re-run here; all pass.

```sh
SIGNALS_API_KEY=... python3 scripts/spec-conformance.py --url http://127.0.0.1:29351
```

```text
identity: 39/39 valid fixtures matched
identity: 49/49 invalid fixtures matched
gzip: 39/39 valid fixtures matched
gzip: 49/49 invalid fixtures matched
SPEC_CONFORMANCE_EXIT:0
```

```sh
SIGNALS_API_KEY=... SIGNALS_READ_KEY=... python3 scripts/transport-conformance.py --url http://127.0.0.1:29351
```

```text
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
TRANSPORT_EXIT:0
```

```text
cargo fmt --all --check                                        FMT_EXIT:0
cargo clippy --locked --workspace --all-targets -- -D warnings CLIPPY_EXIT:0
cargo run --locked -p signals-xtask -- --check                 XTASK_EXIT:0
  Official schemas parsed; runtime validation replaces generated wire types
cargo build --locked --bin signals                             (up to date)
```

```sh
cargo test --locked --workspace
```

```text
signals-core: test result: ok. 8 passed; 0 failed; 0 ignored
  measurement_uses_ecmascript_numbers_and_json_escaping ... ok
  utf8_precedes_ndjson_count_but_count_precedes_envelope ... ok
  object_caps_use_the_same_measurement ... ok
  event_cap_uses_json_stringify_without_changing_stored_floats ... ok
  official_fixtures_match_reference ... ok
signals-server: test result: ok. 3 passed; 0 failed; 0 ignored
TEST_EXIT:0
```

```sh
TEST_DATABASE_URL=postgres://signals:signals@127.0.0.1:29350/signals_tests \
  cargo test --locked -p signals-server --test integration --test rollup_properties -- --ignored --test-threads=1
```

```text
integration:       test result: ok. 2 passed; 0 failed; finished in 0.85s
rollup_properties: test result: ok. 3 passed; 0 failed; finished in 19.50s
IGNORED_EXIT:0
```

### Not claimed here

`scripts/release-check.py` (round 1 recorded its one expected failure, the
publishing-repository assert), the million-row `read_performance` benchmark,
HTTP 429 / 503, the web bundle checks and the host-safety probes from round 1
were not re-run: nothing in the fix pass touches them and the round-2 brief
does not list them.

## Probes committed

Under `reports/review-r2/`, all runnable against any collector with a
30-day-retention project and an ingest key. `SIGNALS_SPEC` defaults to
`/home/vuk/orca/projects/signals-spec`.

- `setup.sh` — starts the collector from this worktree against a disposable
  Postgres and provisions a 30-day project with ingest and read keys into the
  gitignored `target/review-r2/<port>/`. `CLOCK=none` for the wall clock.
- `numbers.mjs`, `number_fuzz.py` — the differential size fuzzer (check 1).
  `python3 reports/review-r2/number_fuzz.py --url <base> [--cases 500] [--seed N]`.
  Exits 0 on this tree.
- `reference.mjs`, `edge_probe.py` — the hand-built contract edge cases
  (check 2, plus the out-of-range-number and lone-surrogate cases of the
  should-fix). `python3 reports/review-r2/edge_probe.py --url <base>`.
  Exits 1 on this tree: the five should-fix cases. The eleven others,
  including every UTF-8 ordering case, pass.
- `storage_probe.py` — read API, idempotency and the rollup worker over all
  ten types (check 3). `--url <base> --project <id> --pg-container <name>`.
  Exits 0 on this tree.
- `manifest_check.py` — manifest hashes and `spec/` immutability (check 4).
  Exits 0 on this tree.
- `sdk_probe.sh`, `sdk_client.mcp.py` — the Python SDK example end to end
  against a wall-clock collector (check 5). Exits 0 on this tree.
