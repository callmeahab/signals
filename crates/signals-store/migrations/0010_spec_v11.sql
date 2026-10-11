-- Preserve catalogue completeness and v1.1 metrics across raw-event retention.
ALTER TABLE tool_catalog ADD COLUMN truncated boolean NOT NULL DEFAULT false;
ALTER TABLE catalog_snapshots ADD COLUMN truncated boolean NOT NULL DEFAULT false,
 ADD COLUMN advertised_count bigint;
CREATE OR REPLACE FUNCTION analytics_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ident text[]; t jsonb;
BEGIN
 ident:=analytics_identity(NEW.caller);
 IF ident IS NOT NULL THEN
  INSERT INTO identities VALUES(NEW.project_id,ident[1],ident[2],NEW.ts,NEW.ts,(NEW.type='tool.called')::int,(NEW.type='tool.called' AND NEW.is_error)::int)
  ON CONFLICT(project_id,kind,identity_key) DO UPDATE SET first_seen=least(identities.first_seen,EXCLUDED.first_seen),last_seen=greatest(identities.last_seen,EXCLUDED.last_seen),calls=identities.calls+EXCLUDED.calls,errors=identities.errors+EXCLUDED.errors;
 END IF;
 IF NEW.type='tools.listed' AND NOT NEW.is_error AND jsonb_typeof(NEW.attrs->'tools')='array' THEN
  FOR t IN SELECT value FROM jsonb_array_elements(NEW.attrs->'tools') LOOP
   IF jsonb_typeof(t->'name')='string' THEN
    INSERT INTO tool_catalog VALUES(NEW.project_id,t->>'name',t->'annotations',t->>'schema_hash',NEW.ts,NEW.ts,NEW.attrs->>'catalog_hash',coalesce((NEW.attrs->>'truncated')::boolean,false))
    ON CONFLICT(project_id,tool) DO UPDATE SET first_seen=least(tool_catalog.first_seen,EXCLUDED.first_seen),last_seen=greatest(tool_catalog.last_seen,EXCLUDED.last_seen),annotations=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.annotations ELSE tool_catalog.annotations END,schema_hash=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.schema_hash ELSE tool_catalog.schema_hash END,truncated=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.truncated ELSE tool_catalog.truncated END,catalog_hash=CASE WHEN EXCLUDED.last_seen>=tool_catalog.last_seen THEN EXCLUDED.catalog_hash ELSE tool_catalog.catalog_hash END;
   END IF;
  END LOOP;
  INSERT INTO catalog_snapshots VALUES(NEW.project_id,NEW.ts,NEW.attrs->>'catalog_hash',ARRAY(SELECT value->>'name' FROM jsonb_array_elements(NEW.attrs->'tools') WHERE jsonb_typeof(value->'name')='string'),coalesce((NEW.attrs->>'truncated')::boolean,false),(NEW.attrs->>'count')::bigint)
  ON CONFLICT(project_id) DO UPDATE SET ts=EXCLUDED.ts,catalog_hash=EXCLUDED.catalog_hash,tools=EXCLUDED.tools,truncated=EXCLUDED.truncated,advertised_count=EXCLUDED.advertised_count WHERE EXCLUDED.ts>=catalog_snapshots.ts;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION analytics_metric_attrs(a jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(a)
 WHERE key=ANY(ARRAY['transport','method','uri','prompt','reason','tool','duration_ms','is_error','error_kind','error_code','input_bytes','output_bytes','output_chars','output_kinds','cancelled','input_schema_valid','output_schema_valid','requested_protocol_version','client_capabilities','server_capabilities','where','request_id','output_items','derived','progress_events','first_progress_ms','model','max_tokens','stop_reason','rejected','mode','action','task_id','status','poll_count','count','truncated','catalog_hash'])
$$;
UPDATE analytics_facts f SET attrs=analytics_metric_attrs(e.attrs) FROM events e
 WHERE f.project_id=e.project_id AND f.ts=e.ts AND f.id=e.id;
UPDATE rollup_cursor SET received_at_watermark='1970-01-01' WHERE name='analytics';
UPDATE projects SET analytics_revision=analytics_revision+1;
-- One durable delivery per channel: successful channels are never retried because
-- another channel failed. Pending messages survive restarts (at-least-once).
CREATE TABLE notification_outbox(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id), dedupe_key text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('smtp','webhook')), destination text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, attempts int NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,dedupe_key,channel)
);
CREATE TABLE notification_alert_cursor(project_id uuid PRIMARY KEY REFERENCES projects(id),last_id bigint NOT NULL);
