# Private Docker Compose deployment

Postgres uses `shm_size: 1g` in both Compose files. Analytics parallel queries can
exceed Docker’s default 64 MB `/dev/shm`; standalone test containers must also use
`docker run --shm-size=1g`.

Run from the repository root. Docker and Compose are required. The runtime image
is built by `docker/Dockerfile` and tagged `signals-collector:local`.

Create `/home/vuk/signals-deploy/.env` with mode `0600`, using the secret generation
in `scripts/init-env.sh`. That script normally writes to the checkout; the rtxbox
installation ran its contents with only its working-directory line redirected to
`/home/vuk/signals-deploy`, feeding the email and generated 24-character password
through stdin without displaying them. The deployment environment contains:

```dotenv
SIGNALS_BIND_ADDRESS=10.8.0.11
SIGNALS_PUBLIC_URL=http://10.8.0.11:8300
SIGNALS_CORS_ORIGINS=http://10.8.0.11:8300
SIGNALS_BOOTSTRAP_EMAIL=vuk@rtxbox.local
# Generate these; do not use literal placeholders:
SIGNALS_BOOTSTRAP_PASSWORD=<24-character random password>
SIGNALS_ADMIN_TOKEN=<random 32-byte hex token>
SIGNALS_SESSION_SECRET=<random 32-byte hex secret>
POSTGRES_PASSWORD=<random 24-byte hex password>
```

Keep credentials outside version control. Use a hexadecimal Postgres password so
it is safe to interpolate into the database URL. Never use `0.0.0.0` or `::` for
`SIGNALS_BIND_ADDRESS`: choose loopback (the default) or a private VPN address.
The process listens on all interfaces **inside its isolated container**; only the
specified host address publishes port 8300. Postgres has no published port and
stores data in the `signals_pgdata18` named volume at `/var/lib/postgresql`.

```sh
chmod 600 /home/vuk/signals-deploy/.env
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml config --quiet
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml up -d --build
curl --fail http://10.8.0.11:8300/healthz
curl --fail http://10.8.0.11:8300/readyz
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml exec signals /signals --help
docker compose -p signals --env-file /home/vuk/signals-deploy/.env -f deploy/compose/compose.yaml restart
```

Postgres has a `pg_isready` healthcheck and the collector waits for it. The
distroless collector contains no shell, curl, or wget, and its binary has no
healthcheck subcommand, so check `/healthz` and `/readyz` externally. Both services
use `init: true` and `restart: unless-stopped`. Enable Docker at boot and ensure
the configured VPN address is available when Docker starts. Do not run
`down --volumes` unless intentionally deleting persisted data.

Provision tenants, projects and ingest-only keys with `/v1/admin/{tenants,projects,keys}`
or the container CLI. The bootstrap owner initially belongs to `default`; the
rtxbox deployment moves that owner to `mcpramen` in Postgres so the dashboard can
see both eggs. Log in at `/v1/auth/login`, then use the session and matching Origin
with `PATCH /v1/projects/{id}` to set `rate_events_per_min=5000` and
`rate_bytes_per_min=33554432` (plus name and retention_days).

The existing egg environments receive `SIGNALS_URL`, their own `SIGNALS_KEY`, and
`SIGNALS_SERVICE_NAME`. Their persisted auth profiles and existing auxiliary
containers are preserved. Rebuild each main application from its own checkout:

```sh
(cd /home/vuk/mcpramen-egg-node && docker compose -p egg-node up -d --build)
(cd /home/vuk/mcpramen-egg-python && docker compose -p egg-python up -d --build)
```

Use `docker inspect` to verify existing issuer/proxy/bootstrap containers retain
their original bindings. The deployment found the Node issuer and both proxies
with restart disabled and applied `docker update --restart unless-stopped
egg-node-issuer-1 egg-node-proxy-1 egg-python-proxy-1`. Repeat that update if these
auxiliary containers are recreated; their upstream Compose files do not declare
the policy. The credentials file `/home/vuk/signals-deploy/credentials.md` (mode 0600) holds
the bootstrap password and both ingest keys. The committed report is sanitized.
Run `python3 deploy/compose/verify-rtxbox.py` to repeat the live acceptance checks
(this sends one read-only `search_products` call to each egg).
