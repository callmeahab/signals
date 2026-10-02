# Development API

All project routes require either a local dashboard session belonging to the tenant or a `read` key for exactly that project. Writes to project settings, users, and keys require an owner dashboard session. The admin token provisions tenants/projects/keys/users and reads collector health; it cannot read project events.

| Method / route | Behavior |
|---|---|
| `POST /v1/events` | Ingest a batch with an `ingest` key. |
| `GET /v1/whoami` | Key’s project and key UUID. Requires `ingest`. |
| `POST /v1/auth/login` | `{email,password}` → user/projects and signed session cookie. |
| `POST /v1/auth/logout` | Delete session and clear cookie. |
| `GET /v1/auth/me` | User and tenant’s projects. |
| `GET /v1/projects/{id}/overview` | Counts, error rate, merged p50/p95/p99, top five tools, unique identities/sessions, client split, deltas. |
| `GET /v1/projects/{id}/timeseries` | Dense, zero-filled metric points. Optional `metric` and `bucket=1h|1d`. |
| `GET /v1/projects/{id}/tools` | Calls, errors, percentiles, trend, last called. |
| `GET /v1/projects/{id}/tool-timeseries?tool=…` | Dedicated tool activity and latency series. |
| `GET /v1/projects/{id}/callers/{caller}/timeseries` | Caller activity history; daily rollups beyond two-day ranges. |
| `GET /v1/projects/{id}/callers` | Caller details from complete daily rollups plus raw boundary days. |
| `GET /v1/projects/{id}/sessions` | 50-item keyset pages. Optional `caller`, `client`, `cursor`. |
| `GET /v1/projects/{id}/sessions/{session}/events` | Chronological 200-item keyset pages; pass `cursor` until `next_cursor` is null. |
| `GET /v1/projects/{id}/events` | 100-item keyset pages; filters `type`, `tool`, `caller`, `q`, `since`, `is_error`, `cursor`. |
| `GET /v1/projects/{id}/live` | SSE `signal` events; optional `type`, `tool`. 15-second heartbeat. A `gap` event means the consumer lagged and should refresh recent events. |
| `GET/POST /v1/projects/{id}/keys` | List / mint keys. Creation returns `{key,secret}` once. |
| `DELETE /v1/projects/{id}/keys/{key}` | Revoke a project key. |
| `PATCH /v1/projects/{id}` | `{name,retention_days,rate_events_per_min,rate_bytes_per_min}`. |
| `GET/POST /v1/projects/{id}/users` | Owners list/create users for the project’s tenant. Creation body `{email,password,role}`. |
| `POST /v1/admin/tenants` | `{slug,name,external_id?}`. |
| `POST /v1/admin/projects` | `{tenant_id,slug,name}`. |
| `POST /v1/admin/keys` | `{project_id,label,scopes}`. |
| `POST /v1/admin/users` | `{tenant_id,email,password,role}`. |
| `GET /v1/admin/health` | Rollup lag, partition status, pool size/idle. |
| `GET /healthz` | Process liveness. |
| `GET /readyz` | Database/schema readiness. |
| `GET /metrics` | Prometheus counters/gauges. |

Overview/time series/tools/callers accept `range=24h|7d|30d` or explicit UTC `from`/`to` up to 400 days. Arbitrary explicit boundaries use raw events for partial buckets; complete buckets come from rollups. Points are UTC aligned and zero-filled. Use hour-aligned historical ranges (day-aligned caller ranges) outside raw retention because old partial buckets cannot be reconstructed. Default ranges include the current hour. Error rates exclude session lifecycle events. `tool.call` is a completed call containing its measured duration/error state in this development contract. Deltas are percentages against the previous equal-length period, or null when no prior denominator exists. Histogram p50/p95/p99 are estimates, not exact percentiles.

Events use the immutable `(project_id, ts, id)` replay key. A development batch is `{sent_at,events}` and returns 202 `{accepted,duplicates,rejected:[{index,id,reason}]}` after commit. Reasons include `schema_invalid`, `ts_future`, `ts_too_old`, `duplicate_in_batch`, and per-row `storage_invalid`. The timestamp is retained unchanged. An unavailable database returns an error; the SDK must retry without rewriting IDs or timestamps.

See the schema in `spec/events.schema.json` and the live Setup screen for examples. This schema and these ingestion responses are provisional until the official `signals-spec` contract is provided. The generated read document is served at `/v1/openapi.json`; the ingest document and schema are at `/v1/ingest.openapi.yaml` and `/v1/events.schema.json`. The official ingest document will be served verbatim after review/import.
