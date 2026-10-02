# Upgrading

Database migrations are forward only. Run a backup and test the new binary against a restored database before deploying. Keep the collector version and UI package on matching semver versions; `/v1` identifies the read API's major version. There is no stable 1.0 release yet.

```sh
docker compose exec -T postgres pg_dump -U signals -Fc signals > signals.backup
docker compose build signals
docker compose up -d signals
curl --fail http://localhost:8300/readyz
```

Migrations run at startup. For a managed rollout, run `signals migrate` once with the deployment database URL, then start replicas with `SIGNALS_MIGRATE=false`. Readiness verifies every embedded migration version and checksum, including unexpected additional successful migrations; a binary with stale schema returns 503. Rolling upgrades require migrations that remain compatible with the old binary. Do not roll back across an incompatible schema; restore a tested backup or apply a forward repair.

Replicas share Postgres and the session secret. SIGTERM drains requests for up to 10 seconds, closes SSE streams and aborts workers, releasing their transactional locks. Keep at least a 15-second container stop grace period. Live streams do not replay disconnected events; clients reconnect and refresh recent raw events.

Keep `.env`, volumes and backups when updating the source. Never run `docker compose down -v` against an installation you want to preserve.
