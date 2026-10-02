# Validation

Run checks from the repository root. Database and browser tests write fixture tenants, keys and events; use the isolated QA stack, never a production database.

## Source and frontend checks

```sh
cargo fmt --all --check
cargo run --locked -p signals-xtask -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
python3 examples/smoke.py
cd web
npm ci
npm run check
npm run build
npm test
npm run test:next
```

The default Rust tests skip database fixtures. The packed Next.js host test builds and installs an actual npm tarball, checks all seven screens, chart dialogs and preservation of host styles, and shuts its own server down. Browser checks use local Chrome; CI installs Chromium and sets `PLAYWRIGHT_CHANNEL=chromium`.

## Checked SQL and database correctness

```sh
export DATABASE_URL=postgres://signals:signals@127.0.0.1:18432/signals_test
export TEST_DATABASE_URL="$DATABASE_URL"
cargo run --locked --bin signals -- migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f .sqlx/dev.sql
cargo sqlx prepare --check --workspace -- --all-targets
cargo test --locked -p signals-server --test integration --test rollup_properties -- --ignored --test-threads=1
```

SQLx CLI 0.9.0 is required. The development SQL creates the compile-time COPY staging relation; ingest uses a transaction-local temporary relation. Committed `.sqlx` metadata supports offline builds.

Integration tests cover concurrent replay, late buckets, repeated worker ticks, caller/session uniqueness, scopes and tenant isolation, per-event rejection, limits and immediate key revocation. Property tests compare random late deliveries to brute-force SQL after convergence. Additional fixtures force COPY row fallback, paginate a 1,202-event timeline, hold the worker coordinator lock, check partial UTC boundaries, and verify daily caller history and late updates across raw retention.

## Actual collector and operational checks

```sh
docker compose -p signals-qa -f docker/qa.compose.yml up --build -d
python3 scripts/runtime-qa.py
SIGNALS_URL=http://127.0.0.1:8352 SIGNALS_REPLICA_URL=http://127.0.0.1:8351 npm --prefix web run qa:backend
```

Runtime QA verifies compressed schema fixtures, body limits, request IDs, CORS, two replicas behind nginx, live events from both, immediate cross-replica revocation, a deterministic Postgres kill while transactions wait at the ingest barrier, acknowledged-row survival and immutable-envelope retry, collector failover, bounded shutdown, Prometheus scrapes and OTLP HTTP spans. It restricts destructive actions to a named `signals-…qa` Compose project. CI runs the same script against its disposable stack.

`web/scripts/backend-qa.mjs` uses `owner@signals.test` / `signals-test-password` by default. Override `SIGNALS_URL`, `SIGNALS_TEST_EMAIL`, and `SIGNALS_TEST_PASSWORD` for an isolated test instance. It creates keys/users, writes events and renames its first project.

`python3 scripts/ci-conformance.py` starts the built debug binary, provisions a fixture project, runs the active manifest's fixtures and performs backend browser checks. It uses port 8350 by default; set `SIGNALS_URL` to another localhost port when the Docker fixture is running.

## Performance and release gates

See [benchmark commands](../bench/README.md) and [acceptance evidence](acceptance-evidence.md) for measured capacity, read timings, actual plans and limits. Source checks, database fixtures, browser checks, Docker runtime faults and workflow lint have passed locally; this does not claim the unconfigured GitHub workflow has run remotely.

[Plan status](status.md) distinguishes implementation from external gates. Official Plan 1 conformance, public artifacts, independent quickstart review and the literal all-query index-only requirement remain open. The examples implement the MCP 2026-07-28 request model; Signals SDK conformance is separate and awaits Plan 1.
