# Acceptance measurements

Use a disposable QA stack only. `bench/bootstrap.py` raises its first project's rate limits and writes a private key env file. It uses fixture credentials unless overridden. Never point it at a production collector.

```sh
docker compose -p signals-qa -f docker/qa.compose.yml up --build -d
python3 bench/bootstrap.py
python3 bench/run.py
python3 scripts/runtime-qa.py
```

k6 sends 100 events at 50 batches/s for 60 seconds. Thresholds require at least 300,000 accepted events, zero dropped iterations, every batch accepted, <0.1% request failures and p99 <50 ms. Both collector services are restricted to `cpus: 2`; the database and load generator have separate allocations. k6 measures request latency to the server, excluding the JS event-generation time. Results go to ignored `bench/artifacts/`; copy reviewed evidence into `docs/` when committing an acceptance report. Secrets stay in the private env file and are not printed.

The 30-day query fixture seeds one million rows, 20 tools, 100 callers and 200 application sessions, runs the worker, vacuums, measures every read method in release mode and saves EXPLAIN/BUFFERS JSON:

```sh
TEST_DATABASE_URL=postgres://signals:signals@127.0.0.1:18432/signals_test \
  cargo test --locked --release -p signals-server --test read_performance -- --ignored --nocapture
```

To remeasure an existing fixture without reseeding, add `SIGNALS_BENCH_REUSE=true`; the test still verifies the stored request count and tool population before timing. Rust tests write `reads.json` under `crates/signals-server/bench/artifacts/` because Cargo selects the crate directory as their working directory.

Raw full-event reads and rollups containing unbounded arrays/JSON cannot safely use a B-tree covering index for every returned field. The report distinguishes Index Scan from Index Only Scan. Do not force `enable_seqscan=off` or claim index-only plans when heap reads are present. See [acceptance evidence](../docs/acceptance-evidence.md) for measured timings and the literal plan gate status.
