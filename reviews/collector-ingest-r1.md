# Review: collector ingest migration to spec v1.0.15

VERDICT: changes required

Reviewed `main..HEAD` at `c1811a7` in this worktree. The spec reference is
`/home/vuk/orca/projects/signals-spec` tag `v1.0.15` (`8cdcccb`),
`conformance/src/lib/ingest.mjs`. The coordinator had already passed
`scripts/spec-conformance.py` (39/39 valid, 49/49 invalid, identity and gzip)
and `scripts/transport-conformance.py`. This review did not re-run those two
drivers. It looked for what they do not prove.

## Blockers

### 1. Event size follows serde_json number spelling, not JSON.stringify

CONTRACT.md, opening units paragraph: "Serialised" means the compact (no
whitespace) UTF-8 JSON encoding of a value. §4 and §5 measure the 16 KB event
cap, and the `args` / `fields` / `props` caps, as that serialised size, reason
`too_large`. The reference is `serialisedBytes` in `conformance/src/lib/ingest.mjs`:
`Buffer.byteLength(JSON.stringify(value), "utf8")`. `JSON.stringify` emits `1`
for a whole number. `crates/signals-core/src/lib.rs` measures
`serde_json::to_vec(&value)`, which keeps the f64 lexical form, so eight `1.0`
tokens are sixteen extra bytes.

An event whose `JSON.stringify` size is exactly 16384, with eight numbers
spelled `1.0` on the wire, is accepted by the reference and rejected by the
collector. The same event spelled with `1` is accepted by both. One extra
canonical byte is `too_large` on both. The Python SDK encoder
(`mcpramen_signals/redact.py` `encode`) uses
`json.dumps(..., separators=(",", ":"))`, which writes `1.0` for floats, so a
near-cap event an SDK counted as legal can be rejected. The same divergence
applies to the `args`, `fields`, and `props` caps.

Command (collector on 127.0.0.1:29151, ingest key, timestamps rewritten to now):

```sh
SIGNALS_API_KEY=... python3 reports/review-r1/probe.py --url http://127.0.0.1:29151
```

Observed:

```text
FAIL wire_1_0_js_16384
collector: 202 accepted 0 rejected [{"index": 0, "reason": "too_large"}]
reference: 202 accepted 1 rejected []
jsEventBytes: 16384
PASS canonical_16384
collector and reference: 202 accepted 1 rejected []  jsEventBytes 16384
PASS canonical_16385
collector and reference: 202 accepted 0 rejected [{"index": 0, "reason": "too_large"}]
jsEventBytes 16385
```

Expected: the `1.0` wire body is accepted, matching `JSON.stringify` at 16384
bytes. The probe exits 1 until this matches.

### 2. Invalid UTF-8 NDJSON is counted before UTF-8 validation

CONTRACT.md §1: "After decompression, a body that is not valid UTF-8 fails the
whole batch with `400 malformed_body`, before JSON/NDJSON parsing (after the
body-size limit)." The reference `parseBody` decodes with
`TextDecoder("utf-8", { fatal: true })` before it counts NDJSON lines. SDK
reaction table: 400 is dropped and not retried; 413 is retried. A status-code
difference is a contract violation.

`parse_batch` in `crates/signals-core/src/lib.rs` counts non-blank lines with
`String::from_utf8_lossy` and returns `too_many_events` before
`str::from_utf8`. A body of `0xFF` plus 1001 non-blank `{}` lines is HTTP 413
`{"error":"too_many_events","message":"too many events"}` from the collector
and 400 `malformed_body` from the reference. A short invalid UTF-8 JSON body
is 400 on both. Valid UTF-8 with 1001 lines and a bad envelope is 413 on both.

The author task brief explicitly ordered whole-batch precedence as decoded
size, then event count, then UTF-8. The implementation matches that sentence
and diverges from CONTRACT.md §1 and `ingest.mjs`. Recorded as a blocker so
the coordinator can decide which side moves. It is not treated as acceptable
just because the task sentence said count-before-UTF-8.

Same command as blocker 1. Observed:

```text
FAIL utf8 invalid ndjson over event count
collector: 413 too_many_events keys ["error", "message"]
reference: 400 malformed_body
body: {"error":"too_many_events","message":"too many events"}
ndjson_lines: 1002
PASS utf8 invalid short json
collector and reference: 400 malformed_body
```

Expected: 400 `malformed_body` with a JSON body, before the NDJSON line count.
The earlier hand probe of the same bytes (recorded in the session log, not
re-posted here) returned `Content-Type: application/json`.

The committed probe's last lines were `3 passed, 2 failed` and exit 1, naming
only these two cases.

## Should-fix

None.

## Verified claims

Toolchain for the Rust commands:
`PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH`, `CARGO_PROFILE_DEV_DEBUG=0`,
`CARGO_INCREMENTAL=0`. Postgres `postgres:18.6-bookworm` as
`signals-review-r1-pg` on `127.0.0.1:29150`. Collector
`target/debug/signals serve` on `127.0.0.1:29151` with
`SIGNALS_CONFORMANCE_CLOCK=sent_at` and retention 30 days. Hand comparisons
used `node` against `conformance/src/lib/ingest.mjs` (`receivedAtMs: null`,
`retentionDays: 30`).

### Driver fidelity

`scripts/spec-conformance.py` posts every `spec/fixtures/{valid,invalid}`
json and ndjson body as identity and gzip. NDJSON uses
`Content-Type: application/x-ndjson`. For 202 it requires
`set(data) == {"accepted", "rejected"}` and, when the expected file has
`rejected`, the full list (index, reason, order) via `actual == expected`.
Error bodies require `message` to be a string. They do not reject extra keys.
CONTRACT.md allows an optional `details` array, and the error bodies observed
in this review were exactly `{"error","message"}`. The driver does not check
replays or stored row counts. Those were probed by hand (idempotency below).
Not re-running the 39/49 driver: the coordinator already passed it, and the
gaps above are what this review covered.

### Precedence

`validate_batch` in `crates/signals-core/src/lib.rs` follows CONTRACT.md §5,
not a fixture coincidence: `type` string else `schema`; closed type set else
`unknown_type`; depth and jsonschema else `schema`; timestamp else `schema`;
record the lower-cased id; `too_large` (event, then args/fields/props);
`ts_future`; `ts_too_old`; `duplicate_in_batch` only if that id was recorded.
The seen-set is updated after step 3 and before `too_large`, matching
`checkEvent`.

Five invalid fixtures matched both `expected.json` and the reference,
including `reason-precedence.json`. Its reference analysis:

```text
index 0 type nope extra true reason unknown_type
index 1 type custom bytes 16385 over true future true reason too_large
index 2 future reason ts_future
index 3 duplicate_in_batch
index 4 extra true reason schema
index 5 accepted
collector rejected list equalled that expected file
```

Also matched: `mixed-rejections.json`, `reason-duplicate-in-batch.json`,
`reason-too-large.json`, `reason-unknown-type.json`.

Adversarial batches not in the fixtures, collector equal to the reference:

- First event `too_large`, second event the same id:
  `rejected [{0, too_large}, {1, duplicate_in_batch}]`, accepted 0.
- NDJSON envelope line containing `events`: 400 `malformed_envelope`.
- 1001-event NDJSON with an invalid envelope line: 413 `too_many_events`
  on both (valid UTF-8).
- Schema-invalid first event (extra key), then a valid event with the same
  id: `schema` then accept. Duplicate does not apply, because the first event
  never passed step 3.
- `ts_future` wins over a later duplicate of that id.
- `unknown_type` wins over an extra key, an oversized blob, and a future `ts`
  on the same event.

### Limits and robustness

- Gzip compressed 902937 bytes, decoded 2097152: 413
  `{"error":"body_too_large","message":"body too large"}`,
  `Content-Type: application/json`.
- Identity body over 1 MiB: the same 413 JSON body.
- Stored gzip larger than the decoded limit, decoded body under it
  (pad 12597, decoded 1048546, compressed 1048649, both checks true):
  `status 202 body b'{"accepted":80,"rejected":[]}'`. The first attempt at
  this case stopped at decoded 1000786 and compressed 1000884, both under
  1048576, so that 202 was correct and is not a finding.
- 64 MiB of zeros, gzipped to 292863 bytes: 413 `body_too_large` in 0.006s.
  VmHWM stayed 48920 KB (delta 0). `/healthz` stayed 200.
- A 10000-level nested event beside a valid sibling: 202
  `{"accepted":1,"rejected":[{"index":0,"reason":"schema"}]}` in 0.081s.
  `/healthz` 200. Not a whole-batch 400.
- NUL batch: 202 `{"accepted":2,"rejected":[]}`. Stored text was `a\ufffdb`
  and the key was `nul\ufffdkey`. The sibling attrs kept `marker: clean-sibling`
  and had no U+FFFD.

`handlers.rs` reads a gzip body with `to_bytes` (no cap) and then
`MultiGzDecoder.take(MAX_BODY + 1)` with `MAX_BODY = 1_048_576`. The bounded
decode and the over-decoded 413 above are that path.

### Storage

```text
cargo test --locked -p signals-server --test integration --test rollup_properties -- --ignored --test-threads=1
test result: ok. 2 passed; 0 failed; finished in 0.79s
test result: ok. 3 passed; 0 failed; finished in 19.63s
IGNORED_EXIT:0
```

`cargo sqlx prepare --check --workspace -- --all-targets` after
`signals migrate` only: exit 1, `relation "ingest_stage" does not exist` at
`crates/signals-store/src/ingest.rs:128`. `ingest_stage` is a transaction-local
temporary table. `.sqlx/dev.sql` creates the permanent stand-in, and
`.github/workflows/signals.yml` applies that file before `prepare --check`.
After `docker exec -i signals-review-r1-pg psql ... < .sqlx/dev.sql`:

```text
CREATE TABLE
SQLX_DEVSQL_EXIT:0
Finished `dev` profile [unoptimized] target(s) in 2.08s
DROP TABLE
```

The stand-in was then dropped. Not a product defect.

`crates/signals-store/migrations/0003_spec_v1.sql` rewrites
`tool.call`, `session.start`, `session.end`, and `request` on `events`.
`events` is partitioned by `ts`. A January 2020 partition
`events_review_2020` was created, the four old names were inserted, and the
same `CASE` left:

```text
tool.called|events_review_2020
session.started|events_review_2020
session.ended|events_review_2020
mcp.request|events_review_2020
```

`information_schema` shows no `type` or `event_type` column on the rollup or
sessions tables, so there is no second copy of the old names to migrate.

`source` is `jsonb`. `source->>'server_name'` returned 100 rows.
Raw `caller.ip` does not reach a column or JSONB: text search for the posted
address was 0, `caller ? 'ip'` was 0, `callers` raw-IP matches were 0, and
106 rows had a 64-character `caller.ip_hash`. The ingest path hashes with the
tenant `ip_salt` and removes `ip` before insert.

### Idempotency

The same two-event batch posted three times:

```text
{"runs": [[202, 2, []], [202, 2, []], [202, 2, []]], "rows_for_first_id": "1"}
```

`accepted` stayed equal to the event count. One stored row for that id.

A second post of the same id with a different RFC3339 spelling of the same
instant (`Z` versus `+00:00`): 202 accepted 1, `rows` 1, `distinct_ts` 1.
The reference key is the literal `ts` string. The collector stores
`timestamptz` and conflicts on `(project_id, ts, id)`. Equivalent spellings
collapse. `docs/storage-normalization.md` records this, and the author brief
allows that deviation when it is documented. A different instant
(`...T20:00:01.000Z`) for the same id stored a second row (`rows` 2, accepted
1). Not a finding.

### Read API and rollups

All ten fixture types stored in one batch: 202 accepted 10, types
`custom`, `error`, `log`, `mcp.initialize`, `mcp.request`, `prompt.get`,
`resource.read`, `session.ended`, `session.started`, `tool.called`.

`GET /v1/projects/{id}/events?since=2026-10-10T00:00:00Z`: 200, `missing []`,
`problems []`, `hash_ok true`. Every stored type carried `attrs`, `client`,
`source`, and `caller`, none carried raw `caller.ip`, and at least one
`caller.ip_hash` was 64 hex characters. `source.server_name` matched the batch.

`GET .../events?type=error`: 200, n 1, type `error`.
`GET .../events?type=tool.called`: 200, n 7, tool `search_orders`.
`GET .../sessions`: 200, the fixture session was present.
`GET .../sessions/{id}/events`: 200, types included `session.started`,
`session.ended`, `tool.called`, `mcp.request`, `error`, `log`, `custom`,
`prompt.get`, `resource.read`, `mcp.initialize`. Keys included `attrs`,
`caller`, `client`, `source`.
`GET .../tools?range=24h`: 200, tool `search_orders`.

The rollup worker runs once at server startup. The cursor was reset to
`1970-01-01`, the server was restarted, and `log_statement=all` was on.
A first needle search reported `session.end` and `tool.call` only because
those strings are prefixes of `session.ended` and `tool.called`. A
negative-lookahead scan of that log window printed:

```text
no bare tool.call
no bare session.end
no bare session.start
tool.called 12 session.ended 4 session.started 1
```

The two `'request'` lines were the migration probe's own
`WHEN 'request' THEN 'mcp.request'` and its INSERT, not rollup SQL.

### Build and image

```text
cargo fmt --all --check
FMT_EXIT:0
```

```text
cargo clippy --locked --workspace --all-targets -- -D warnings
CLIPPY_EXIT:0
```

```text
cargo test --locked --workspace
signals-core: 4 passed
TEST_EXIT:0
```

```text
cargo run --locked -p signals-xtask -- --check
Official schemas parsed; runtime validation replaces generated wire types
XTASK_EXIT:0
```

```text
docker build -f docker/Dockerfile -t signals-review:r1 .
Successfully built 52f7e1d2337e
Successfully tagged signals-review:r1
```

The image is removed after this report (`docker rmi signals-review:r1`).

```text
python3 scripts/release-check.py
```

The only failure is the expected one:

```text
File ".../scripts/release-check.py", line 10, in <module>
    assert package.get("repository"), "Configure the publishing repository..."
AssertionError: Configure the publishing repository and npm namespace ownership first
```

The asserts above that line (`mode`, `conformance_verified`, provenance, and
the three schema hashes) passed, because a failing earlier assert would have
been the traceback line.

### Manifest honesty

`spec/manifest.json` is `mode: official`, `conformance_verified: true`,
tag `v1.0.15`, commit `8cdcccbcd38841acfb8aad29eb493c0c9c7aa9e0`. Every
`sha256` entry matched the vendored file and
`git -C /home/vuk/orca/projects/signals-spec show v1.0.15:<path>`:

```text
entries=142 mismatches=[]
```

Served `GET /v1/ingest.openapi.yaml` and `GET /v1/events.schema.json` were
byte-equal to `spec/` (`openapi_len=13661`, `schema_len=22376`,
`provisional=False`).

### Not claimed here

This review did not re-run the wall-clock-off smoke, HTTP 429, or HTTP 503.
The author report covers them, and the coordinator's transport run was not
repeated.

## Probes committed

- `reports/review-r1/probe.py`
- `reports/review-r1/reference.mjs`

```sh
SIGNALS_API_KEY=... python3 reports/review-r1/probe.py --url http://127.0.0.1:PORT
```

Exit 1 on this tree: the two blockers above. The three controls pass.
`SIGNALS_SPEC` defaults to `/home/vuk/orca/projects/signals-spec`.
