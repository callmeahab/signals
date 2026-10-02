# Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | Required | Postgres connection string. Compose supplies the internal hostname. |
| `SIGNALS_BIND` | `0.0.0.0:8300` | Collector listener. |
| `SIGNALS_PUBLIC_URL` | `http://localhost:<listener port>` | Expected browser origin; HTTPS enables Secure session cookies. |
| `SIGNALS_ADMIN_TOKEN` | Required, 32+ characters | Admin provisioning routes. Does not grant access to project data. |
| `SIGNALS_SESSION_SECRET` | Required, 32+ characters | HMAC signing key for dashboard cookies. Changing it logs out existing sessions. |
| `SIGNALS_BOOTSTRAP_EMAIL` | Unset | Create the initial owner/tenant/project when this email does not already exist. |
| `SIGNALS_BOOTSTRAP_PASSWORD` | Required for bootstrap, 12+ characters | Initial owner password. Not a password-reset mechanism. |
| `SIGNALS_MIGRATE` | `true` | `false` disables migrations at server startup. `signals migrate` always applies migrations; provisioning calls the running admin API. |
| `SIGNALS_USER_PASSWORD` | Unset | Password for `signals user create`. |
| `RUST_LOG` | `signals_server=info` | tracing-subscriber filter. Use `signals=info,signals_server=info` to include binary startup messages. |
| `VITE_DEMO` | Unset | Frontend development adapter when set to `1`; baked into the frontend build. |
| `SIGNALS_URL` | `http://localhost:8300` | CLI admin API base URL. |
| `SIGNALS_CORS_ORIGINS` | Unset | Comma-separated additional HTTP(S) browser origins. Credentials are allowed only for listed origins. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Unset | Enable tracing export; gRPC default or HTTP/protobuf according to protocol. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Unset | Trace-specific endpoint override. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` / `_TRACES_PROTOCOL` | `grpc` | `grpc` or `http/protobuf`. |
| `OTEL_SERVICE_NAME` | `signals` | Exported service name. |
| `OTEL_RESOURCE_ATTRIBUTES` | Unset | Standard SDK resource attributes. |
| `OTEL_TRACES_SAMPLER` / `_ARG` | SDK default | Standard SDK sampler configuration. |
| `OTEL_EXPORTER_OTLP_HEADERS`, timeout, compression and TLS variables | SDK defaults | Standard SDK exporter configuration; trace-specific variants take precedence. |
| `OTEL_BSP_*` | SDK defaults | Standard batch span processor queue/batch/delay settings. |

Compose forwards variables from `.env` into the collector and overrides `DATABASE_URL` with the internal Postgres hostname. Add CORS and standard OTEL settings there when using Compose.

The local environment template and setup script allow both `http://localhost:8300` (the public URL) and `http://127.0.0.1:8300` (an explicit additional origin). Browser login and cookie-authenticated writes require an exact allowed origin, including scheme and port. If you use another hostname or a separate development frontend, add its origin to `SIGNALS_CORS_ORIGINS`; an “Origin is not allowed” response means it is missing from this list. The collector does not trust arbitrary Host or forwarded headers to expand the list.

All replicas must share the same database and session secret. Each project starts with 30-day raw retention, 600 events/min/key, and 5,242,880 bytes/min/key. Owners can update these settings in the dashboard.

Ingest has a 1 MiB decompressed body limit, 1,000-event batch limit, and 10-second HTTP timeout. Oversize batches return 413; per-key budget exhaustion returns 429 with `Retry-After: 60`. The raw peer IP is converted to a tenant-salted HMAC; forwarded headers are not trusted. Deployments using a proxy should understand that anonymous network identities will correspond to the proxy unless trusted-proxy handling is added. Prefer SDK-supplied key or subject identities.

Rollups tick every 60 seconds. Partition/retention maintenance runs on startup and every 10 minutes. Dashboard sessions last seven days. Prometheus counters reset when a collector process restarts; storage/partition/lag gauges come from Postgres. Tracing writes structured console logs and exports OTLP when configured. No bodies, credentials, or peer IPs are attached to request spans.
