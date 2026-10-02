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


## PostgreSQL 16 to 18

The Compose database now uses `postgres:18.6-bookworm` and mounts the new `pgdata18` volume at `/var/lib/postgresql`. PostgreSQL 18's image stores data under `/var/lib/postgresql/18/docker`. The original PostgreSQL 16 `pgdata` volume cannot be opened directly by PostgreSQL 18; retain it for recovery.

Before updating an existing installation, stop every collector/replica and other writer, save the old Compose file, and take a consistent logical backup. The following example assumes the standard single-database Compose installation. Custom roles, additional databases, extensions and PostgreSQL configuration need their own backup/restore steps. Keep backups private because they include password hashes and API key hashes.

```sh
# Run with the old Compose file and database still in place.
cp docker-compose.yml docker-compose.postgres16.backup
docker compose -p signals stop signals
docker compose -p signals exec -T postgres pg_dump -U signals -Fc signals > signals.backup
# Update the repository to the PostgreSQL 18 configuration, then:
docker compose -p signals up -d --no-deps postgres
docker compose -p signals exec -T postgres pg_restore -U signals --exit-on-error -d signals < signals.backup
docker compose -p signals exec -T postgres vacuumdb -U signals --analyze-in-stages signals
docker compose -p signals up -d --build signals
curl --fail http://localhost:8300/readyz
```

Restore into an empty database, check restore errors, and compare row counts (including users, keys, events and summaries) before starting writers. Rehearse against a disposable PostgreSQL 18 instance first. A failed restore must be repaired or restarted against another empty database; do not run the collector against a partial restore.

To revert before PostgreSQL 18 has accepted new writes, stop the collector and use `docker compose -p signals -f docker-compose.postgres16.backup up -d postgres signals` with the previous application image. The old `signals_pgdata` volume remains intact. After new writes have occurred, returning to that volume would lose those writes: use a reconciled backup/restore migration instead. Never delete either volume during the migration.

Official references: [PostgreSQL major upgrades](https://www.postgresql.org/docs/18/upgrading.html) and [PostgreSQL Docker volume layout](https://hub.docker.com/_/postgres).
