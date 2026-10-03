# Signals

Self-hosted MCP event collector and dashboard.

## Run

Requires Docker Compose and Python 3.

```sh
bash scripts/init-env.sh
docker compose up --build
```

Open http://localhost:8300 and sign in with the credentials you entered.
Create an ingest key in **Settings**, then follow **Setup** to send events.

## Develop

Requires Node 24+, Python 3, and the Rust toolchain in `rust-toolchain.toml`.

```sh
bash scripts/init-env.sh
docker compose up -d postgres
npm --prefix web ci
npm --prefix web run build
bash scripts/dev.sh
```

Build the frontend before compiling Rust. Configuration is in `.env`.
For a frontend demo with hot reload: `VITE_DEMO=1 npm --prefix web run dev`
(http://127.0.0.1:3300).

## Test

```sh
npm --prefix web run check
npm --prefix web test
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo run --locked -p signals-xtask -- --check
```

Browser tests use installed Chrome; set `PLAYWRIGHT_CHANNEL=chromium` to use
Playwright's Chromium instead.

Run database tests against a separate test database:

```sh
docker compose exec postgres createdb -U signals signals_test
TEST_DATABASE_URL=postgres://signals:signals@127.0.0.1:8432/signals_test \
  cargo test --locked -p signals-server --test integration --test rollup_properties -- --ignored --test-threads=1
```
