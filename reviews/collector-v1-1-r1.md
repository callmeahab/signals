# Review round 1: collector spec v1.1.0 and digest delivery

VERDICT: approve

Reviewed `main..HEAD` at `4e5a885` on `vuk88/collector-v1-1`. Spec reference is
`/home/vuk/orca/projects/signals-spec` tag `v1.1.0` (`a32f922`). No blockers.
No should-fixes.

## Blockers

None.

## Should-fix

None.

## Verified claims

Vendoring. `spec/manifest.json` is `mode: official`, `conformance_verified: true`,
tag `v1.1.0`, commit `a32f922beb302853863b39aa27edf2286f5881a7`. All 165
`sha256` entries match both the files in `spec/` and
`git -C /home/vuk/orca/projects/signals-spec show v1.1.0:<path>`.
`spec/fixtures/valid` has 52 fixtures (48 json, 4 ndjson). `spec/fixtures/invalid`
has 54 fixtures. `scripts/spec-conformance.py` walks both directories and both
encodings.

Fixture and cap verdicts, against `conformance/src/lib/ingest.mjs` via
`reports/review-v11-r1/ref.mjs` with `received_at_ms: null` (the reference clock
is the envelope `sent_at`, matching `SIGNALS_CONFORMANCE_CLOCK=sent_at`):

- Vendored v1.1.0 fixtures, identity and gzip: 212 cases, 0 mismatches.
- v1.0.15 fixtures (`git archive v1.0.15 fixtures`) against the same v1.1
  reference and this collector: 176 cases, 0 mismatches.
- Crafted caps, enums, and cross-field rules (tools.listed 500/501, name and
  annotation caps, catalog/schema hashes, subject_kind including `none` with a
  subject, derived vs transport, every error_kind, request_id, output counts,
  initialize capabilities, elicitation, sampling, task status, auth reason):
  160 cases, 0 mismatches.

`python3 scripts/ci-conformance.py` on `collector-v11-r1-pg` printed:

```text
identity: 52/52 valid fixtures matched
identity: 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched
gzip: 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v2 analytics, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
```

Storage mapping. Node and Python v1.1 artifact recordings were ingested after
dropping `caller.ip_hash`. That key is not in `events.schema.json`; both this
collector and `ingest.mjs` reject it, and the wire caller object uses `ip`.
With that key removed, six recordings (stateful, extra, auth, Python basic,
live, auth) were 202 with `rejected []` and 62 events stored. A schema-valid
supplement covered the fields those recordings do not all carry. Observed:

- `analytics_facts` kept `output_chars` 100, `output_items` 2, `error_kind`
  `timeout`, `error_code` -32000, schema flags, and progress fields.
- `error_code` 9007199254740993 was stored as the decimal text
  `9007199254740993`.
- `tool_catalog` stored `listed_tool`, annotation `readOnly`, `schema_hash`,
  and `catalog_hash`.
- `identities` were `(strong, user-oauth)`, `(key, kid_api)`, and
  `(key, kid_header)`. `user-apikey` and `user-header` were not strong.
- `mcp.initialize` rows had `duration_ms` 42 with `is_error` false, and
  `duration_ms` 80 with `is_error` true.
- Analytics routes returned 200. Handshake success rate 50 and p95 80.
  Timeouts, error split (`timeout` 1), schema failures (input 1, output 1),
  discovery, sampling, elicitation, tasks, and long calls were numbers.
  Auth reasons present: expired, invalid, missing, other, scope.
  `session.ended` reason `client` was not an auth reason.
- A project whose only call had `output_chars` 100 and `output_bytes` 4
  reported `total_tokens_est` 25.

Catalogue, on its own project, after each step:

- `source: list` of alpha and beta, then a call to alpha: snapshot
  `[alpha, beta]`, dead `[beta]`.
- `is_error: true` with `duration_ms` and no catalogue fields: snapshot
  unchanged, hash still `a`*64, dead still `[beta]`.
- `source: list_changed` of alpha and delta: snapshot `[alpha, delta]`, dead
  `[delta]`, beta gone.
- Truncated `list_changed` advertising 9 tools but listing only alpha, plus a
  call to `not_in_truncated`: dead `[]`, snapshot tools `[alpha]`, truncated
  true, advertised 9. Hallucinated count was null and the unlisted names were
  absent.

Delivery. `delivery::queue` at `2026-10-12T07:00:00Z` against an SMTP sink on
`127.0.0.1:26114` and a webhook on `127.0.0.1:26113`. One digest email and one
digest webhook for week `2026-W41`. The HTML part is inline stone/gold
(`#fafaf9`, `#ca8a04`), heading font `Krona One` with Arial fallback, brand
text `mcpramen signals`, no external stylesheet, script, image, or `url(`.
The project name `<script>&"probe` was escaped. `probe_key`
`super-secret-probe-key` and the admin token were absent. The text part was
non-empty. Alert webhook pairs `(errors, firing)`, `(errors, ok)`, and
`(latency, firing)` each appeared once. Digest outbox rows stayed at one
attempt. A webhook 503 and `SIGNALS_SMTP_URL=smtp://127.0.0.1:1` made the
latency alert record two attempts and still finish delivered after the sink
recovered. `GET /readyz` stayed 200.

Compose. With `.env` copied from `.env.example` (the file `env_file` already
required on `main`) and the documented variables set,
`docker compose -f docker-compose.yml config` exited 0 and rendered
`shm_size: "1073741824"`. `docker compose -f deploy/compose/compose.yaml config`
did the same. `deploy/compose/README.md` documents `shm_size: 1g` and the 64 MB
default.

Author commands re-run with `CARGO_TARGET_DIR=/var/tmp/collector-v11-r1/target`
unless noted. Postgres was `collector-v11-r1-pg` on `127.0.0.1:26111` with
`--shm-size=1g`, except the clean analytics rerun.

- `cargo fmt --all --check`: exit 0, no output.
- `cargo clippy --locked --workspace --all-targets -- -D warnings`: exit 0.
  Last line: `Finished dev profile [unoptimized] target(s) in 15.66s`.
- `cargo test --locked --workspace`: exit 0. Last crate summary included
  `test result: ok. 7 passed; 0 failed; 0 ignored`.
- `cargo run --locked -p signals-xtask -- --check`: exit 0.
  `Official schemas parsed; runtime validation replaces generated wire types`.
- `SQLX_OFFLINE=false cargo sqlx prepare --check --workspace -- --all-targets`:
  exit 0. `Finished dev profile [unoptimized] target(s) in 2.88s`.
- `.sqlx/dev.sql` then
  `cargo test --locked -p signals-server --test integration --test rollup_properties --test analytics --test v11 -- --ignored --test-threads=1`:
  exit 0. Integration `3 passed` in 28.83s; v11 `1 passed` in 0.89s.
- `python3 scripts/release-check.py`: `Official contract release gate passed`.
- Release ignored tests other than the million-row bench: exit 0, including
  rollup `3 passed` in 70.89s and v11 `1 passed`.
- `cargo test --locked --release -p signals-server --test read_performance -- --ignored --test-threads=1`
  seeded 1,000,000 rows and passed. p95 milliseconds: caller_history 2.09,
  callers 22.49, events 13.79, overview 33.43, session_events 10.64,
  sessions 1.45, timeseries 45.51, tool_timeseries 3.36, tools 26.21.
  All under the 50 ms gate. `SIGNALS_BENCH_REUSE=true` on this empty database
  looked up the previous artifact's project and stopped at `0/1000000`; that
  flag assumes the seed is already in the same database. The seeded run is
  the gate.
- `docker build -f docker/Dockerfile .`: exit 0. `Successfully built 1bc9e58c7e5e`.
- `ci-conformance.py` fixture, transport, and browser sections passed as quoted
  above. Its analytics probe then reported `perf-overview` 775.16 ms
  (should-fix threshold 300 ms) because that Postgres also held the million-row
  bench. The same probe on a fresh `postgres:18` container
  `collector-v11-r1-ci` (`127.0.0.1:26121`, `--shm-size=1g`) printed
  `FINDINGS 0 MISMATCHES 0`. Overview 175.32 ms, adoption 218.97, tools 158.30,
  reliability 94.45, cost 132.03, protocol 68.87, digest 181.21, alerts 0.98,
  timeline 9.67. `subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0}`.

## Probes committed

- `reports/review-v11-r1/probe.py`
- `reports/review-v11-r1/ref.mjs`
- `reports/review-v11-r1/probe-result.json`
- `reports/review-v11-r1/delivery_probe/` (`Cargo.toml`, `Cargo.lock`, `src/main.rs`)

Run `python3 reports/review-v11-r1/probe.py` against a Postgres 18 container
named `collector-v11-r1-pg` on `127.0.0.1:26111` and the debug binaries named
in the script. The result file from this run has 0 findings and 44 verified
checks.
