# Layout: dashboard v3

Completed: shared layout amendment and tool-call client shares, committed on
`vuk88/dash-v2`. All required validation passed; ignored DB tests use release mode
and serial execution, with the original million rows and 50ms latency gate.
The independent analytics harness reports zero findings and zero mismatches.

## Changes

- `web/packages/ui/src/analytics-v3.tsx`, `styles.css`: shared three-column desktop
  tile grid, 108px sparklines, independent full-width entity cards, and responsive
  client legend. Overview pairs funnel/retention; Tools pairs latency/catalogue;
  Cost pairs treemap/payload. Adoption splits transport/protocol from conversion.
- `web/packages/ui/src/analytics.tsx`: Settings tool overrides and alerts occupy
  separate rows. `web/packages/ui/DESIGN.md` records the audit of all screens.
- `crates/signals-store/src/analytics.rs`: call-based client share and regression
  coverage for equal sessions, unequal calls, zero-call clients and empty totals.
- `scripts/analytics-review-probe.py`: independent call-based expectations plus
  per-client formula and aggregate share assertions.
- `crates/signals-server/src/openapi.rs`, `docs/analytics.md`,
  `web/packages/ui/src/analytics-types.ts`: updated call-share meaning and nullable
  zero-denominator handling. Adoption labels the bar “Share of calls”.
- `web/packages/ui/src/charts/renderers.js`: omit zero-value donut arcs;
  Overview supplies raw calls rather than rounded shares.
- `web/apps/dashboard/src/demo-analytics.ts`, `demo.ts`, `main.tsx`: computed demo
  call shares and a selectable 27-client variant with uneven calls and zero calls.
- `web/scripts/analytics-qa.mjs`, `analytics-shapes.mjs`, `visual-qa.mjs`: call-share, desktop layout,
  sparkline size, full-row cards and 27-client legend/zero-arc assertions.
- `web/scripts/backend-qa.mjs`: scroll the lower Reliability band into view before
  checking its lazily painted SVG after the tile row grows.

## Contract edge case

Independent one-decimal rounding cannot guarantee that arbitrarily many client
shares sum to 100 ± 0.1: for example, 27 equal clients give 27 × 3.7 = 99.9,
while 24 equal clients give 24 × 4.2 = 100.8. Per-client formula takes precedence
in the collector; the requested probe also checks the aggregate tolerance for its
fixtures. No residual percentage is assigned to a client because that would break
the requested per-client formula. This limitation is documented, not hidden.

## Verification

Commands and observed output follow below. An initial browser
review probe encountered a navigation-context race; the unchanged probe was rerun.
An initial integrated harness started during the ignored DB performance test and
timed out waiting for the migration advisory lock; the harness was moved to a second isolated database. A too-long on-disk TMPDIR
exceeded Chromium’s Unix socket path limit; the shorter worktree `.tmp` path fixed
that environment failure. Backend QA then needed to scroll the now-lower band
into view; its strict SVG assertion remains unchanged.

The development-server interaction walk exceeded the 50ms gate on two Live
transitions (50.53 and 54.57ms). Production-build single and walk runs passed the
same unmodified gate (14.73ms single, 48.10ms maximum over 30 walk transitions).

## Screenshots

Before (preserved from the starting worktree):
[light](../web/artifacts/v3/layout-before-overview-1440-light.png),
[dark](../web/artifacts/v3/layout-before-overview-1440-dark.png).

After:
[light](../web/artifacts/v3/overview-1440-light.png),
[dark](../web/artifacts/v3/overview-1440-dark.png).

Stress fixture:
[27 clients](../web/artifacts/v3/many-clients-overview-1440-light.png).

## Completed command evidence

Commands using web scripts run from `web/`; other commands run from the worktree root.

### `cargo fmt --all --check`

```text
(no output; exit 0)
```

### `cargo clippy --workspace --all-targets -- -D warnings`

```text
    Checking signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-store)
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.29s
```

### `cargo test --workspace`

```text

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_server

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests signals_store

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

### `cargo build --bin signals`

```text
   Compiling signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-store)
   Compiling signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 5.93s
```

### `bun run --cwd web check`

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

### `bun run --cwd web build`

```text
dist/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2          14.70 kB
dist/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2          14.88 kB
dist/assets/urbanist-latin-ext-wght-normal-Bdxck5Au.woff2          16.60 kB
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-Dp9XnY0Z.css                                     70.27 kB │ gzip:  13.97 kB
dist/assets/index-Dz1GoUGC.js                                     346.53 kB │ gzip: 105.78 kB

✓ built in 468ms
```

### `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test`

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges × 3 demo projects (complete, truncated catalogue, fresh window), all session timelines, missing/extra keys and type-drift guards.
Truncated catalogue QA passed: nullable dead, required completeness, retained calls and safe Tools/Overview rendering.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
Client share QA passed: 27 clients, repeated versions, coherent calls/sessions and null shares without calls.
review-r1 probe passed
review-r2 probe passed

  VITE v8.3.2  ready in 108 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440 widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

### `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test:next`

```text


○  (Static)  prerendered as static content

▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23331
- Network:       http://127.0.0.1:23331
✓ Ready in 77ms
✓ Running next.config.mjs took 8ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

### `VITE_DEMO=1 bun --bun vite build --config apps/dashboard/vite.config.ts --outDir ../../artifacts/layout-demo`

```text
artifacts/layout-demo/assets/urbanist-latin-ext-wght-normal-Bdxck5Au.woff2          16.60 kB
artifacts/layout-demo/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
artifacts/layout-demo/assets/index-Dp9XnY0Z.css                                     70.27 kB │ gzip:  13.97 kB
artifacts/layout-demo/assets/index-BjcZIOmK.js                                     359.38 kB │ gzip: 110.82 kB

✓ built in 651ms
```

### `BASE_URL=http://127.0.0.1:25577 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs`

```text
Run 1 overview → adoption: 196.52 ms aggregate (informational); longest task 14.73 ms (budget < 50 ms)
```

### `BASE_URL=http://127.0.0.1:25577 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs --walk`

```text
Run 1 overview → adoption: 160.25 ms aggregate (informational); longest task 16.48 ms (budget < 50 ms)
Run 1 adoption → tools: 136.43 ms aggregate (informational); longest task 22.10 ms (budget < 50 ms)
Run 1 tools → reliability: 154.75 ms aggregate (informational); longest task 7.48 ms (budget < 50 ms)
Run 1 reliability → sessions: 150.34 ms aggregate (informational); longest task 20.18 ms (budget < 50 ms)
Run 1 sessions → cost: 169.40 ms aggregate (informational); longest task 7.59 ms (budget < 50 ms)
Run 1 cost → protocol: 152.68 ms aggregate (informational); longest task 7.16 ms (budget < 50 ms)
Run 1 protocol → live: 67.65 ms aggregate (informational); longest task 12.95 ms (budget < 50 ms)
Run 1 live → overview: 209.44 ms aggregate (informational); longest task 15.73 ms (budget < 50 ms)
Run 1 overview → adoption: 197.95 ms aggregate (informational); longest task 9.28 ms (budget < 50 ms)
Run 1 adoption → reliability: 205.97 ms aggregate (informational); longest task 9.09 ms (budget < 50 ms)
Run 2 overview → adoption: 153.88 ms aggregate (informational); longest task 11.33 ms (budget < 50 ms)
Run 2 adoption → tools: 140.98 ms aggregate (informational); longest task 14.51 ms (budget < 50 ms)
Run 2 tools → reliability: 136.69 ms aggregate (informational); longest task 7.69 ms (budget < 50 ms)
Run 2 reliability → sessions: 154.82 ms aggregate (informational); longest task 12.22 ms (budget < 50 ms)
Run 2 sessions → cost: 161.77 ms aggregate (informational); longest task 9.26 ms (budget < 50 ms)
Run 2 cost → protocol: 122.34 ms aggregate (informational); longest task 4.88 ms (budget < 50 ms)
Run 2 protocol → live: 91.37 ms aggregate (informational); longest task 25.04 ms (budget < 50 ms)
Run 2 live → overview: 210.60 ms aggregate (informational); longest task 13.00 ms (budget < 50 ms)
Run 2 overview → adoption: 208.25 ms aggregate (informational); longest task 10.24 ms (budget < 50 ms)
Run 2 adoption → reliability: 263.10 ms aggregate (informational); longest task 12.62 ms (budget < 50 ms)
Run 3 overview → adoption: 163.86 ms aggregate (informational); longest task 9.10 ms (budget < 50 ms)
Run 3 adoption → tools: 133.53 ms aggregate (informational); longest task 13.72 ms (budget < 50 ms)
Run 3 tools → reliability: 149.07 ms aggregate (informational); longest task 6.60 ms (budget < 50 ms)
Run 3 reliability → sessions: 238.01 ms aggregate (informational); longest task 26.44 ms (budget < 50 ms)
Run 3 sessions → cost: 220.27 ms aggregate (informational); longest task 18.35 ms (budget < 50 ms)
Run 3 cost → protocol: 168.68 ms aggregate (informational); longest task 5.95 ms (budget < 50 ms)
Run 3 protocol → live: 67.50 ms aggregate (informational); longest task 18.15 ms (budget < 50 ms)
Run 3 live → overview: 212.98 ms aggregate (informational); longest task 12.78 ms (budget < 50 ms)
Run 3 overview → adoption: 271.24 ms aggregate (informational); longest task 16.02 ms (budget < 50 ms)
Run 3 adoption → reliability: 611.51 ms aggregate (informational); longest task 48.10 ms (budget < 50 ms)
```

Preserved before images were byte-compared to `git show 422b22f075342e3768c237962f9d67f6fb5c0cdf:web/artifacts/v3/overview-1440-{light,dark}.png`; both matched.

## Database and integrated harness setup

```sh
docker run -d --name dash-layout-qa-pg --shm-size=1g \
  -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals \
  -p 127.0.0.1:25570:5432 postgres:17
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25570/signals
export TEST_DATABASE_URL=$DATABASE_URL
target/debug/signals migrate
docker exec -i dash-layout-qa-pg psql -U postgres -d signals -v ON_ERROR_STOP=1 < .sqlx/dev.sql
cargo test --workspace -- --ignored
```

The debug ignored suite passed its functional DB tests but failed the million-row
read benchmark after 658.99s: overview p95 131.24ms, timeseries 153.44ms and tools
125.92ms exceeded the existing 50ms gate. The same seeded million-row dataset is
reused for release verification; neither row count nor latency threshold changes.

```sh
export SIGNALS_BENCH_REUSE=true
cargo test --release --workspace -- --ignored --test-threads=1
cargo sqlx prepare --workspace --check
```

The integrated harness uses a second disposable Postgres 17 container to avoid
waiting for the benchmark’s migration/ingest locks:

```sh
docker run -d --name dash-layout-ci-pg --shm-size=1g \
  -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals \
  -p 127.0.0.1:25575:5432 postgres:17
export DATABASE_URL=postgres://postgres:signals@127.0.0.1:25575/signals
export TEST_DATABASE_URL=$DATABASE_URL
export TMPDIR=/home/vuk/orca/workspaces/signals-collector/dash-v2/.tmp
export ANALYTICS_PG_CONTAINER=dash-layout-ci-pg
export SIGNALS_URL=http://127.0.0.1:25571
export ANALYTICS_REVIEW_URL=http://127.0.0.1:25572
export ANALYTICS_REVIEW_PROBE_PORT=25573
export SIGNALS_PROBE_LATENCY_BUDGET_MS=900
export PLAYWRIGHT_CHANNEL=chromium
target/debug/signals migrate
docker exec -i dash-layout-ci-pg psql -U postgres -d signals -v ON_ERROR_STOP=1 < .sqlx/dev.sql
python3 scripts/ci-conformance.py
```

## Screenshot reproduction

Production preview serves the demo build at `http://127.0.0.1:25577`:

```sh
# From web/
bun --bun vite preview --config apps/dashboard/vite.config.ts \
  --outDir ../../artifacts/layout-demo --host 127.0.0.1 --port 25577
BASE_URL=http://127.0.0.1:25577 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
# Hash every web/artifacts/v3/*.png with Python hashlib.sha256.
BASE_URL=http://127.0.0.1:25577 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
# Compare every file with the preceding manifest, asserting no changed hashes.
```

The scripts fix time to 2026-10-12, seed randomness, await fonts/chart paint and
use reduced motion. Both passes run serially with light/dark screenshots at
390, 1280 and 1440, plus 320px overflow/contrast checks.

`migrate.log` observed output:

```text
Migrations applied
CREATE TABLE
```

`ci-migrate.log` observed output:

```text
Migrations applied
CREATE TABLE
```

`client-final.log` observed output:

```text
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
Client share QA passed: 27 clients, repeated versions, coherent calls/sessions and null shares without calls.
```

The first release ignored-suite run passed the million-row benchmark but its
parallel rollup property test saw 0 rather than 8 requests while another test
held the shared worker lock. The complete suite passed when run serially with
`--test-threads=1`. The initial workspace-root SQLx command required the CLI’s
`--workspace` option; the final command includes it.

`db-tests-serial.log` observed output:

```text

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.96s

     Running tests/v11.rs (target/release/deps/v11-5d8347fb74e77d4b)

running 1 test
test v11_storage_protocol_and_delivery ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.98s

     Running unittests src/lib.rs (target/release/deps/signals_store-379284d026ca758c)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s

     Running unittests src/main.rs (target/release/deps/signals_xtask-ed7a2212c5d3c92a)

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

`static-one.log` observed output:

```text
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440 widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

`static-two.log` observed output:

```text
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440 widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

`determinism.log` observed output:

```text
116 PNG files compared; changed: []
```

Release read benchmark, same 1000000 rows, unchanged p95 <50ms gate:

```json
{
  "caller_history": 1.778,
  "callers": 18.612,
  "events": 16.933,
  "overview": 28.583,
  "session_events": 16.069,
  "sessions": 0.957,
  "timeseries": 37.605,
  "tool_timeseries": 5.019,
  "tools": 27.339
}
```

The committed `web/artifacts/v3/layout-sha256.json` records all 116 hashes: 114 regenerated captures plus two preserved before images.

`DATABASE_URL=postgres://postgres:signals@127.0.0.1:25570/signals cargo sqlx prepare --workspace --check`:

```text
    Checking opentelemetry-http v0.33.0
    Checking opentelemetry-otlp v0.33.0
    Checking sqlx v0.9.0
    Checking signals-core v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-core)
    Checking signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-store)
    Checking signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 5.83s
```

Ignored-suite totals (`grep "test result" web/artifacts/layout-logs/db-tests-serial.log`):

```text
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.65s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.44s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.40s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 33.96s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.98s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Final-head `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test`:

```text
$ bun scripts/test.mjs
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges × 3 demo projects (complete, truncated catalogue, fresh window), all session timelines, missing/extra keys and type-drift guards.
Truncated catalogue QA passed: nullable dead, required completeness, retained calls and safe Tools/Overview rendering.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
Client share QA passed: 27 clients, repeated versions, coherent calls/sessions and null shares without calls.
review-r1 probe passed
review-r2 probe passed

  VITE v8.3.2  ready in 109 ms

  ➜  Local:   http://127.0.0.1:23330/
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440 widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

The final dev-server test also passed; its captures were replaced by the committed production captures, then all 116 files were checked again against `layout-sha256.json` with zero mismatches.

## Integrated harness result

`python3 scripts/ci-conformance.py` (environment above), exit 0:

```text
UPDATE 1
identity: 52/52 valid fixtures matched
identity: 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched
gzip: 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
$ bun scripts/backend-qa.mjs
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v3 analytics, painted funnel with a null day-7 step, adoption session/WAU/MAU trend series, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
   Compiling signals-store v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-store)
   Compiling signals-server v0.1.0 (/home/vuk/orca/workspaces/signals-collector/dash-v2/crates/signals-server)
…
  }
]
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

`target/analytics-review/findings.json` before cleanup:

```json
{
  "findings": [],
  "mismatch_count": 0,
  "timings": {
    "overview": 145.42,
    "adoption": 253.11,
    "tools": 128.98,
    "reliability": 115.8,
    "cost": 136.17,
    "protocol": 74.85,
    "digest": 160.58,
    "alerts": 1.04,
    "timeline": 9.11
  },
  "latency_budget_ms": 900.0,
  "latency_statistic": "median_of_three_after_warmup"
}
```

## Remaining work

None. No push was performed. The independent-rounding contract edge case remains
documented above; all requested fixture assertions passed.

## Cleanup

```text
docker rm -f dash-layout-qa-pg dash-layout-ci-pg
dash-layout-qa-pg
dash-layout-ci-pg
```

A Python `shutil.rmtree` cleanup removed the following exact task paths and
asserted that each no longer exists:

```text
target
.tmp
web/artifacts/layout-tmp
web/artifacts/layout-demo
web/artifacts/layout-logs
crates/signals-server/bench/artifacts
```

Socket checks confirmed task ports 25570, 25571, 25572, 25573, 25575, 25576, 25577, 23330, 23331, 23461 are closed.
`docker ps -a --format "{{.Names}}"` contains neither task Postgres container.
Only committed production screenshots and their SHA-256 manifest are retained.
