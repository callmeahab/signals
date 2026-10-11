-- Analytics is additive: legacy dashboard rollups retain their existing meaning.
ALTER TABLE projects ADD COLUMN analytics_settings jsonb NOT NULL DEFAULT '{"slo_classes":{},"slo_targets":{"read":99.5,"mutate":98.0},"token_divisor":4,"digest":{"enabled":false,"recipient":null,"webhook_url":null},"alerts":[{"id":"volume","enabled":true,"threshold":3},{"id":"latency","enabled":true,"threshold":2},{"id":"errors","enabled":true,"threshold":5},{"id":"destructive","enabled":true},{"id":"burn","enabled":true,"threshold":6}],"probe_url":null,"probe_key":null}';
CREATE FUNCTION analytics_identity(c jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN c->>'subject' IS NOT NULL AND (c->>'subject_kind' IS NULL OR c->>'subject_kind'='oauth') THEN ARRAY['strong',c->>'subject'] WHEN c->>'key_id' IS NOT NULL THEN ARRAY['key',c->>'key_id'] WHEN c->>'ip_hash' IS NOT NULL THEN ARRAY['network',c->>'ip_hash'] END
$$;
CREATE TABLE identities(project_id uuid NOT NULL REFERENCES projects(id),kind text NOT NULL CHECK(kind IN ('strong','key','network')),identity_key text NOT NULL,first_seen timestamptz NOT NULL,last_seen timestamptz NOT NULL,calls bigint NOT NULL DEFAULT 0,errors bigint NOT NULL DEFAULT 0,PRIMARY KEY(project_id,kind,identity_key));
CREATE TABLE tool_catalog(project_id uuid NOT NULL REFERENCES projects(id),tool text NOT NULL,annotations jsonb,schema_hash text,first_seen timestamptz NOT NULL,last_seen timestamptz NOT NULL,catalog_hash text,PRIMARY KEY(project_id,tool));
CREATE TABLE catalog_snapshots(project_id uuid PRIMARY KEY REFERENCES projects(id),ts timestamptz NOT NULL,catalog_hash text,tools text[] NOT NULL);
ALTER TABLE sessions ADD COLUMN identity_key text, ADD COLUMN identity_kind text, ADD COLUMN had_error boolean NOT NULL DEFAULT false, ADD COLUMN depth bigint NOT NULL DEFAULT 0, ADD COLUMN first_tool text, ADD COLUMN last_tool text;
CREATE TABLE analytics_hourly(project_id uuid NOT NULL REFERENCES projects(id),hour timestamptz NOT NULL,tool text NOT NULL,metrics jsonb NOT NULL,PRIMARY KEY(project_id,hour,tool));
CREATE TABLE analytics_daily(project_id uuid NOT NULL REFERENCES projects(id),day date NOT NULL,metrics jsonb NOT NULL,PRIMARY KEY(project_id,day));
CREATE TABLE analytics_identity_daily(project_id uuid NOT NULL REFERENCES projects(id),day date NOT NULL,kind text NOT NULL,identity_key text NOT NULL,calls bigint NOT NULL,errors bigint NOT NULL,tokens bigint,PRIMARY KEY(project_id,day,kind,identity_key));
CREATE TABLE analytics_paths(project_id uuid NOT NULL REFERENCES projects(id),day date NOT NULL,sequence text[] NOT NULL,calls bigint NOT NULL,PRIMARY KEY(project_id,day,sequence));
CREATE TABLE alerts_log(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),rule text NOT NULL,state text NOT NULL CHECK(state IN ('ok','firing','disabled','no_data')),ts timestamptz NOT NULL DEFAULT now(),details jsonb NOT NULL);
CREATE INDEX ON alerts_log(project_id,rule,ts DESC);
CREATE TABLE probes(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),ts timestamptz NOT NULL DEFAULT now(),ok boolean NOT NULL,latency_ms bigint NOT NULL,advertised_tools int,error text);
CREATE INDEX ON probes(project_id,ts DESC);
INSERT INTO rollup_cursor VALUES('analytics','1970-01-01');
CREATE FUNCTION analytics_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ident text[]; t jsonb;
BEGIN
 ident:=analytics_identity(NEW.caller);
 IF ident IS NOT NULL THEN
  INSERT INTO identities VALUES(NEW.project_id,ident[1],ident[2],NEW.ts,NEW.ts,(NEW.type='tool.called')::int,(NEW.type='tool.called' AND NEW.is_error)::int)
  ON CONFLICT(project_id,kind,identity_key) DO UPDATE SET first_seen=least(identities.first_seen,EXCLUDED.first_seen),last_seen=greatest(identities.last_seen,EXCLUDED.last_seen),calls=identities.calls+EXCLUDED.calls,errors=identities.errors+EXCLUDED.errors;
 END IF;
 IF NEW.type='tools.listed' AND jsonb_typeof(NEW.attrs->'tools')='array' THEN
  FOR t IN SELECT value FROM jsonb_array_elements(NEW.attrs->'tools') LOOP
   IF jsonb_typeof(t->'name')='string' THEN
    INSERT INTO tool_catalog VALUES(NEW.project_id,t->>'name',t->'annotations',t->>'schema_hash',NEW.ts,NEW.ts,NEW.attrs->>'catalog_hash')
    ON CONFLICT(project_id,tool) DO UPDATE SET first_seen=least(tool_catalog.first_seen,EXCLUDED.first_seen),last_seen=greatest(tool_catalog.last_seen,EXCLUDED.last_seen),annotations=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.annotations ELSE tool_catalog.annotations END,schema_hash=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.schema_hash ELSE tool_catalog.schema_hash END,catalog_hash=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.catalog_hash ELSE tool_catalog.catalog_hash END;
   END IF;
  END LOOP;
  INSERT INTO catalog_snapshots VALUES(NEW.project_id,NEW.ts,NEW.attrs->>'catalog_hash',ARRAY(SELECT value->>'name' FROM jsonb_array_elements(NEW.attrs->'tools') WHERE jsonb_typeof(value->'name')='string'))
  ON CONFLICT(project_id) DO UPDATE SET ts=EXCLUDED.ts,catalog_hash=EXCLUDED.catalog_hash,tools=EXCLUDED.tools WHERE EXCLUDED.ts>=catalog_snapshots.ts;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER analytics_capture AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION analytics_capture();
-- Existing events predate the trigger. The unique key keeps migration backfill exact.
INSERT INTO identities SELECT project_id,(analytics_identity(caller))[1],(analytics_identity(caller))[2],min(ts),max(ts),count(*) FILTER(WHERE type='tool.called'),count(*) FILTER(WHERE type='tool.called' AND is_error) FROM events WHERE analytics_identity(caller) IS NOT NULL GROUP BY project_id,analytics_identity(caller);
