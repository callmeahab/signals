# Signals

Self-hosted MCP observability: a Rust collector, Postgres, and a React dashboard served by the same binary. This standalone project lives in `~/signals` and uses mcpflux’s **Live Signal** design system: its exact light/dark color tokens, Unbounded headings, Manrope UI, IBM Plex Mono technical text, and rounded surfaces.

This is a working development implementation of [the collector plan](docs/collector-plan.html). The official `signals-spec` / Plan 1 has not been supplied yet. The bundled [development event schema](spec/events.schema.json) is explicitly provisional. Do not treat it as the published Signals SDK contract.

## Run with Docker

From this directory:

```sh
bash scripts/init-env.sh
docker compose up --build
```

Open **http://localhost:8300** and sign in with the email and password you supplied. A fresh database gets a default tenant, a project, and an owner. The database is exposed on localhost port **8432** for development. Both ports are separate from mcpflux’s existing services.

Create an ingest key in **Settings**, save the secret in `SIGNALS_API_KEY`, and use the **Setup** screen to send your first event. The **Live** view shows committed events immediately; summaries and sessions update within 60 seconds.

Keep `.env` private. For a public installation, set `SIGNALS_PUBLIC_URL` to its HTTPS origin and put a TLS reverse proxy in front of Signals. Bootstrap credentials create the first owner only; changing them later does not reset an existing user.

## Develop locally

Node 22+, a current stable Rust toolchain, and Postgres 16+ are required.

```sh
cd web
npm ci
npm run build
cd ..
bash scripts/dev.sh
```

`scripts/dev.sh` reads `.env`. Build the frontend before compiling Rust because the embedded assets come from `web/dist`. For frontend hot reload, start the collector with `SIGNALS_PUBLIC_URL=http://127.0.0.1:3300`, then run `npm run dev` in `web`. Vite serves port 3300 and proxies `/v1` to port 8300.

To explore the UI without a database:

```sh
cd web
VITE_DEMO=1 npm run dev
```

Demo mode is explicitly labeled; it uses a separate in-memory adapter. Normal builds use the real collector and require login.

## What works

- Ingest with project-scoped keys, SHA-256 secret hashes, immediate revocation, Postgres-backed per-key minute limits, per-event validation, timestamp checks, and partial rejection.
- Binary COPY through a transaction-local staging table, then `ON CONFLICT DO NOTHING`; replayed or concurrent batches cannot double-count a committed event. Acknowledgment follows commit.
- Daily event partitions, an on-demand partition manager, a drained default partition, per-project raw retention, and 400-day summary retention.
- Received-time watermark rollups for hourly project/tool metrics and daily caller summaries. Late events recompute their original time buckets. Histogram percentiles merge across hours; unique caller/session sets are deduplicated across buckets.
- Local Argon2 users, signed HttpOnly session cookies, tenant isolation, owner/viewer roles, origin checks for cookie-authenticated writes, and login throttling.
- Overview, Tools, Callers, Sessions, Live, Settings, and Setup screens. Tool detail, caller detail, session timelines, live search/type filters, pause/resume, key reveal/revoke, retention/rate settings, and owner-managed users.
- Postgres LISTEN/NOTIFY fan-out to SSE, advisory-locked workers, health/readiness, Prometheus metrics, structured tracing, and graceful process shutdown.
- CLI provisioning, Compose packaging, and a reusable `@mcpramen/signals-ui` workspace package. UI screens take a typed adapter; routing, HTTP transport, login, and project selection belong to the dashboard shell.

## CLI

`serve` and `migrate` read `DATABASE_URL`. Provisioning subcommands call the running admin API using `SIGNALS_URL` (default `http://localhost:8300`) and `SIGNALS_ADMIN_TOKEN`; they do not need database credentials.

```sh
signals migrate
signals tenant create --slug acme --name 'Acme'
signals project create --tenant TENANT_UUID --slug production --name 'Production'
signals key create --project PROJECT_UUID --label 'Server' --scopes ingest
SIGNALS_USER_PASSWORD='a long password' signals user create --tenant TENANT_UUID --email owner@example.com
signals serve
```

Key creation prints its secret once. Prefer `SIGNALS_USER_PASSWORD` to putting passwords into command-line arguments.

## Checks

```sh
cd web
npm run check
npm run build
cd ..
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
TEST_DATABASE_URL=postgres://signals:signals@127.0.0.1:8432/signals_test \
  cargo test -p signals-server --test integration --test rollup_properties -- --ignored --test-threads=1
```

The database integration test must use an isolated local test database. It covers concurrent replay, late-arrival rollups, unique counts, partial rejection, tenant isolation, scopes, rate limits, and key revocation. It is marked ignored in the default unit run so development tests do not accidentally use an application database.

With a demo Vite server running, `npm run qa` checks all seven screens, light/dark themes, 320/390/1440px overflow, loaded fonts, dialogs, live controls, and key management using installed Chrome. Set `PLAYWRIGHT_CHANNEL=chromium` if using Playwright’s bundled browser. `npm run qa:backend` exercises login → provisioning → ingest/replay → reads → SSE → settings → logout against an isolated running collector; see [validation](docs/validation.md) for its test credentials and overrides.

## Contract and release status

Apache-2.0 is selected. Publishing remains unconfigured: no GitHub remote, npm namespace ownership, public release, or 1.0 tag is assumed. The release workflow is prepared and blocked until official spec conformance, publishing metadata and acceptance review are supplied.

The [plan status](docs/status.md) records implementation, measured evidence and remaining gates. Types are generated by typify and checked for drift; SQLx metadata is committed and checked against Postgres; read OpenAPI is at `/v1/openapi.json`, provisional ingest OpenAPI at `/v1/ingest.openapi.yaml`, and the active event schema at `/v1/events.schema.json`. [Spec import instructions](spec/README.md) preserve official files verbatim once available.

## Operational and package checks

```sh
cd web
npm test                 # seven screens, themes, phone widths and interactions
npm run test:next        # packed ESM/types/CSS in a Next.js host
cd ..
cargo run -p signals-xtask -- --check
# Disposable metadata DB: migrate it, then create .sqlx/dev.sql before prepare.
cargo sqlx prepare --check --workspace -- --all-targets
```

`docker/qa.compose.yml` starts a separate disposable database, two 2-CPU collectors, a proxy on 8352, Prometheus on 19090 and an OTLP receiver. `scripts/runtime-qa.py` verifies live delivery, immediate revocation, limits, tracing, scrape recovery, shutdown and forced DB failure. It kills only an explicitly named QA stack. See [validation](docs/validation.md) and [bench instructions](bench/README.md) before running it.

The 60-second load run acknowledged 300,000 events with p99 10.87 ms and no failed/dropped requests. It is one measured local 2-CPU container run, not a universal capacity guarantee. [Acceptance evidence](docs/acceptance-evidence.md) records hardware and limits.

Node/Python [MCP example servers](examples/README.md) implement the 2026-07-28 per-request model and emit the provisional Signals envelope. The official SDK setup snippets remain pending Plan 1.

Documentation is built into the binary at `/docs/`. See [configuration](docs/config.md), [API](docs/api.md), [self-hosting](docs/self-hosting.md), [upgrading](docs/upgrading.md), and [maintenance](docs/maintenance.md).
