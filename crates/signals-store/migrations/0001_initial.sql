CREATE TABLE tenants (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, external_id text UNIQUE, ip_salt bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE projects (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), slug text NOT NULL, name text NOT NULL,
 retention_days int NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 365),
 rate_events_per_min int NOT NULL DEFAULT 600 CHECK(rate_events_per_min > 0),
 rate_bytes_per_min bigint NOT NULL DEFAULT 5242880 CHECK(rate_bytes_per_min > 0),
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, UNIQUE(tenant_id,slug)
);
CREATE TABLE api_keys (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), key_id text UNIQUE NOT NULL, secret_hash bytea NOT NULL,
 scopes text[] NOT NULL CHECK(scopes <@ ARRAY['ingest','read']::text[] AND cardinality(scopes)>0), label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz);
CREATE TABLE users (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), email text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','viewer')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE dashboard_sessions (secret_hash bytea PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE callers (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), kind text NOT NULL CHECK(kind IN ('key','subject','network')),
 external_id text NOT NULL, label text NOT NULL, first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, UNIQUE(project_id,kind,external_id));
CREATE TABLE events (
 project_id uuid NOT NULL REFERENCES projects(id), ts timestamptz NOT NULL, received_at timestamptz NOT NULL, id uuid NOT NULL, type text NOT NULL,
 session_id text, caller_id bigint REFERENCES callers(id), tool text, duration_ms int, is_error boolean NOT NULL DEFAULT false,
 client_name text, client_version text, attrs jsonb NOT NULL, UNIQUE(project_id,ts,id)
) PARTITION BY RANGE(ts);
CREATE TABLE events_default PARTITION OF events DEFAULT;
CREATE INDEX ON events(project_id,ts DESC,id DESC);
CREATE INDEX ON events(project_id,type,ts DESC);
CREATE INDEX ON events(project_id,received_at);
CREATE INDEX ON events(project_id,session_id,ts) WHERE session_id IS NOT NULL;
CREATE INDEX ON events(project_id,tool,ts DESC) WHERE tool IS NOT NULL;
CREATE TABLE rate_windows (key_id uuid NOT NULL REFERENCES api_keys(id), window_start timestamptz NOT NULL, events bigint NOT NULL, bytes bigint NOT NULL, PRIMARY KEY(key_id,window_start));
CREATE TABLE rollup_project_hourly (
 project_id uuid NOT NULL REFERENCES projects(id), hour timestamptz NOT NULL, requests bigint NOT NULL, errors bigint NOT NULL, tool_calls bigint NOT NULL,
 session_ids text[] NOT NULL, caller_ids bigint[] NOT NULL, by_client jsonb NOT NULL, duration_hist bigint[] NOT NULL, PRIMARY KEY(project_id,hour)
);
CREATE TABLE rollup_tool_hourly (
 project_id uuid NOT NULL REFERENCES projects(id), hour timestamptz NOT NULL, tool text NOT NULL, calls bigint NOT NULL, errors bigint NOT NULL,
 duration_sum bigint NOT NULL, duration_max int NOT NULL, duration_hist bigint[] NOT NULL, last_called timestamptz NOT NULL, PRIMARY KEY(project_id,hour,tool)
);
CREATE TABLE rollup_caller_daily (
 project_id uuid NOT NULL REFERENCES projects(id), day date NOT NULL, caller_id bigint NOT NULL REFERENCES callers(id), calls bigint NOT NULL, errors bigint NOT NULL,
 session_ids text[] NOT NULL, clients text[] NOT NULL, last_seen timestamptz NOT NULL, PRIMARY KEY(project_id,day,caller_id)
);
CREATE TABLE sessions (
 project_id uuid NOT NULL REFERENCES projects(id), session_id text NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz, last_seen timestamptz NOT NULL,
 caller_id bigint REFERENCES callers(id), client_name text NOT NULL, client_version text, calls bigint NOT NULL, errors bigint NOT NULL, transport text NOT NULL,
 PRIMARY KEY(project_id,session_id)
);
CREATE INDEX ON sessions(project_id,started_at DESC,session_id DESC);
CREATE TABLE rollup_cursor(name text PRIMARY KEY, received_at_watermark timestamptz NOT NULL);
INSERT INTO rollup_cursor VALUES('hourly','1970-01-01');
