# Docker Compose deployment

A self-contained, restart-safe deployment: the collector built from `docker/Dockerfile`
and Postgres 18 on a named volume. Run every command from the repository root.

## 1. Environment

Create an env file **outside** the repository (for example `~/signals-deploy/.env`,
mode `0600`). `scripts/init-env.sh` generates the secrets; copy its output or write:

```dotenv
SIGNALS_BIND_ADDRESS=127.0.0.1          # the host address that publishes port 8300; never 0.0.0.0
SIGNALS_PUBLIC_URL=http://127.0.0.1:8300
SIGNALS_CORS_ORIGINS=http://127.0.0.1:8300
SIGNALS_BOOTSTRAP_EMAIL=owner@example.com
SIGNALS_BOOTSTRAP_PASSWORD=<24+ random characters>
SIGNALS_ADMIN_TOKEN=<random 32-byte hex>
SIGNALS_SESSION_SECRET=<random 32-byte hex>
POSTGRES_PASSWORD=<random 24-byte hex>      # hex, so it is safe inside the database URL
SIGNALS_SMTP_URL=                            # optional, for digest and alert email
SIGNALS_SMTP_FROM=
```

Bind to loopback or a private (VPN) address. Postgres has no published port; its
data lives in the `pgdata18` volume. Postgres runs with `shm_size: 1g` because the
analytics queries exceed Docker's default 64 MB `/dev/shm`; standalone test
containers need `docker run --shm-size=1g` for the same reason.

## 2. Run

```sh
ENV=~/signals-deploy/.env
docker compose -p signals --env-file $ENV -f deploy/compose/compose.yaml config --quiet
docker compose -p signals --env-file $ENV -f deploy/compose/compose.yaml up -d --build
curl --fail http://127.0.0.1:8300/healthz
curl --fail http://127.0.0.1:8300/readyz
```

Both services use `init: true` and `restart: unless-stopped`; enable Docker at boot.
The distroless collector image has no shell or curl, so check `/healthz` and
`/readyz` from outside. Do not run `down --volumes` unless you mean to delete data.

## 3. Provision

The bootstrap owner, tenant `default` and project `my-server` are created on first
start. Create more tenants, projects and ingest keys with the admin API
(`POST /v1/admin/{tenants,projects,keys}` with `Authorization: Bearer $SIGNALS_ADMIN_TOKEN`)
or the container CLI (`docker compose -p signals exec signals /signals --help`).
Per-project rate limits, retention, SLO classes and alert rules are set in the
dashboard Settings or with `PATCH /v1/projects/{id}` using a logged-in session.

Point your MCP servers at the collector with the SDKs:
`SIGNALS_URL=http://<collector>:8300` and `SIGNALS_KEY=sgk_…`.

## 4. Verify

```sh
SIGNALS_URL=http://127.0.0.1:8300 SIGNALS_KEYS=sgk_a,sgk_b \
SIGNALS_EMAIL=owner@example.com SIGNALS_PASSWORD=… python3 deploy/compose/verify.py
```

The script checks health, `whoami` for every key, dashboard login, and that each
project's analytics overview is readable. It prints no secrets.
