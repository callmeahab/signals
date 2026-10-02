# Self-hosting and upgrading

Run `bash scripts/init-env.sh` once, then `docker compose up --build`. Postgres stores every durable piece of state. Stop/restart the collector freely; confirmed event writes and rollup watermarks remain in Postgres. To run multiple collectors, point them at the same database and session secret. Worker advisory locks serialize aggregation/maintenance; committed notifications travel through Postgres to each listener.

For upgrades, back up Postgres, build the new image, and restart the collector. Migrations are forward-only and run at startup unless `SIGNALS_MIGRATE=false`. Take a backup before migration and verify readiness after deployment. The release pipeline is prepared; image/package publishing remains unconfigured by request.

Example backup:

```sh
docker compose exec -T postgres pg_dump -U signals -Fc signals > signals.backup
```

Keep backups outside the container volume. Restore into a separate database first and validate it before switching the collector’s `DATABASE_URL`.

The Compose configuration binds ports to localhost. Add your own TLS proxy for public access, configure `SIGNALS_PUBLIC_URL` to match the browser origin, and restrict `/metrics` and admin routes to operators. Browser clients use same-origin APIs; the development Vite proxy allows frontend work without enabling broad CORS. The collector does not currently trust forwarded IP headers.

To benchmark, install k6, create an ingest key, set the project limits above 300,000 events/min/key and enough bytes/min/key, then run `SIGNALS_API_KEY=… k6 run bench/ingest.js`. The script submits 100-event batches at 50 batches/s. Its thresholds express the plan’s target; they are not evidence that the target has been achieved. Run it with a 2-vCPU collector allocation and record the database hardware and resource limits.

Documentation is served at `/docs/`. Use the optional `monitoring` and `tracing` Compose profiles; see [maintenance](maintenance.md). Raw storage expires whole UTC days so a partial day remains available for exact late-arrival recomputation (up to one extra day internally); ingest and raw read endpoints still enforce the configured rolling retention window.
