# Acceptance evidence

Local measurements on 2026-10-02. These reports use disposable fixtures and the provisional Signals contract. They establish the tested behavior; they are not official SDK conformance or a public 1.0 release.

## Environment

Docker Engine's Linux VM reported aarch64, 16 CPUs and 8,318,709,760 bytes of memory. Ingest collectors were limited to **2 CPUs each**. PostgreSQL 16.15 ran in a separate container, with shared_buffers=128 MB, synchronous_commit=on and fsync=on. A second collector, nginx, Prometheus and the OTLP receiver were active. PostgreSQL and the load generator did not share the collector's CPU limit.

The read measurement uses an optimized native Rust test executable over localhost to that PostgreSQL container, with warmed data after VACUUM ANALYZE. It does not include HTTP/auth/JSON serialization or enforce a 2-CPU limit on the native test. Ten measured samples follow one warmup per method; the reported p95 is the largest of those ten. This is a small reproducible capacity fixture, not a sustained production read-load guarantee.

## Ingest

[k6 raw report](evidence/k6.json): 100 events/batch, 50 batches/s scheduled for 60 seconds. **300,000 events accepted**, 3,000 requests, zero failed requests, rejected batches or dropped iterations. p99 request latency **10.87 ms**; p95 **6.71 ms**. All 6,000 acceptance checks passed. That meets the plan's scheduled 5,000 events/s and p99 <50 ms target on the 2-CPU collector.

## Dashboard reads

[Read timings and EXPLAIN/BUFFERS plans](evidence/reads.json): one million rows distributed over 30 UTC days, with 20 tools, 100 callers and 200 application sessions in each hour. Before measurement the test asserts all one million requests are present in the rollup overview and all 20 tools are returned. Raw and rollup data are populated; empty summaries cannot pass this fixture.

| Read method | Median ms | Sample p95 ms |
|---|---:|---:|
| caller_history | 1.58 | 2.42 |
| callers | 17.32 | 19.59 |
| events | 3.32 | 4.17 |
| overview | 28.16 | 34.06 |
| session_events | 5.29 | 8.94 |
| sessions | 1.54 | 1.69 |
| timeseries | 31.25 | 32.3 |
| tool_timeseries | 3.83 | 4.2 |
| tools | 25.96 | 27.55 |

All nine methods passed the measured <50 ms target. The populated fixture first exposed a 76 ms overview; direct range merging, concurrent independent reads and fetching detail only for the top five tools reduced its sample p95 to 34.06 ms.

Representative actual plan nodes are below. These are source SQL probes saved with ANALYZE and BUFFERS; complete endpoint timings are above.

| Source SQL probe | Actual node types | Execution ms |
|---|---|---:|
| caller_rollup | Bitmap Heap Scan, Bitmap Index Scan | 0.38 |
| project_rollup | Bitmap Heap Scan, Bitmap Index Scan, Sort | 0.32 |
| raw_page | Append, Index Scan, Limit | 0.07 |
| session_page | Index Scan, Limit | 0.04 |
| tool_rollup | Seq Scan | 2.84 |

**The literal “index-only reads for every dashboard query” gate does not pass.** The planner uses heap-backed indexed reads where appropriate. Raw event JSON and exact unique session/caller sets are unbounded; putting every field in a B-tree covering index can exceed PostgreSQL's tuple-size limit. No planner flags were forced, and an Index Scan is not labeled as an Index Only Scan. The indexes support measured latency while retaining complete event data.

## Durability, replicas and operations

[Runtime QA report](evidence/runtime-qa.json): two replicas behind nginx; a proxy live stream received commits from both. Revocation on one replica denied the key on the other immediately. A deterministic commit-barrier gate held ingest transactions while PostgreSQL was killed. All 100 pre-fault acknowledged event IDs survived; 39 batches were unacknowledged during the fault; retrying the original 40 immutable batches converged to exactly 4,000 distinct rows. The script checks IDs, counts and replay behavior.

Stopping one collector preserved proxy ingest on its peer. Measured collector shutdown was 0.239 s. Prometheus reported the collector up after recovery. The OTLP receiver recorded an HTTP span with the tested request ID and no test API key or password. These are controlled local faults, not prolonged production failover certification. SSE reconnects do not replay disconnected intervals.

## Correctness and frontend

The database suite passes randomized late-delivery comparisons with brute-force SQL, coordinator exclusion, COPY row fallback, replay and tenant/scope/limit/revocation checks, 1,202-event timeline pagination, retained boundary reads and caller history after raw expiry. Raw deletion retains the partial UTC day internally to keep late daily recomputation complete; reads and validation still enforce rolling retention.

Browser checks pass for all seven screens in light/dark themes, 320/390/1440px layouts, font loading, drawer charts, live controls and key flows. A built npm tarball passes a Next.js 16.3.3 host build and browser check, including host-style preservation. Actual collector browser checks exercise local auth, HTTP ingest/replay, read routes, cross-replica SSE, settings/users, CSRF denial and logout. Node/Python examples pass the MCP 2026-07-28 per-request protocol smoke test.

Generated types, SQLx metadata, Rust formatting/tests/Clippy, TypeScript/ESLint, frontend production build and actionlint pass. Docker production build and actual image runtime checks pass. Remote GitHub release execution is not claimed.

## Gates awaiting inputs or external review

- Official Plan 1 schema, ingest OpenAPI, conformance fixtures and published Node/Python SDK snippets are unavailable. Development contract and fixtures are explicitly provisional.
- GitHub/npm publishing remains unconfigured by request; no public image/package/binaries or 1.0 tag is claimed.
- A cold source-build quickstart is not certified under five minutes; an independent developer's quickstart review remains pending.
- Historical partial buckets older than raw retention require UTC-aligned hour/day ranges. Exact partial historical reconstruction requires the expired raw data.
- Literal index-only plans for every field/query remain a deliberate difference, described above.

See [validation](validation.md) and [plan status](status.md). Re-run acceptance measurements after changing hardware, storage, schema or retention; these numbers are not universal limits.
