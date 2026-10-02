# Postgres maintenance and monitoring

Postgres 16 stores all durable state. Use filesystem snapshots or `pg_dump` plus a tested restore; high volume deployments should use physical backups and WAL archiving. Retain backups outside the container host and monitor free space. The collector acknowledges only committed transactions; durability still depends on Postgres fsync, synchronous_commit and the reliability of the storage system.

Raw partitions are created three days ahead and on demand. The default partition is a safety net; maintenance drains it. Raw and session retention commits in 10,000-row chunks. Raw deletes stop at the UTC day boundary of the retention cutoff, retaining at most one extra internal day so daily caller summaries cannot lose prior contributions during late recomputation; raw read and validation cutoffs remain rolling. Rollups remain for 400 days. Maintenance and aggregation share a coordinator advisory lock across replicas; ingestion uses only a short commit barrier when a rollup cutoff is taken.

## Autovacuum

The default server settings are appropriate for the quickstart. At volume, tune daily child partitions after measuring dead tuples and vacuum duration. Apply reloptions to every new partition, or automate this in database administration:

```sql
ALTER TABLE events_2026_10_01 SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000
);
```

Check `pg_stat_user_tables`, `pg_stat_progress_vacuum`, transaction age, WAL growth and index size. Do not disable autovacuum. After an unusually large retention delete, schedule `VACUUM (ANALYZE)` during a quiet period. For measured index bloat, optional weekly `REINDEX INDEX CONCURRENTLY events_2026_10_01_project_id_ts_idx` rebuilds one child index without the blocking parent operation; discover actual names from `pg_indexes`. Concurrent maintenance commands must run outside a transaction.

## Scrape and alert example

```sh
docker compose --profile monitoring up -d
```

Prometheus is on localhost:9090. It scrapes `signals:8300/metrics`; `docker/prometheus/alerts.yml` includes sustained rollup lag, default-partition rows, rejection ratio and collector-down examples. Configure Alertmanager routing yourself; application event alerting remains v2 scope. The default partition should converge to zero. Gauge failures when Postgres is down are visible as scrape failures.

The optional `tracing` profile starts an OTLP debug collector. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel:4317` and `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` in `.env`. HTTP/protobuf uses `http://otel:4318`. Standard OTEL resource, service, sampler, exporter headers/TLS/timeout and batch settings are delegated to the OpenTelemetry SDK. HTTP traces contain request IDs, route/method/status/timing, and never request bodies, passwords, Authorization headers or peer IPs.

Dashboard counts use complete hourly/daily summaries plus raw partial boundary buckets. Partial boundaries older than raw retention cannot be reconstructed exactly; use UTC-aligned historical hours (days for caller summaries). Percentiles are estimates from 24 bounded histogram bins, capped at 60 seconds. Recent raw/session endpoints are constrained to project retention; rollup history may survive beyond it.
