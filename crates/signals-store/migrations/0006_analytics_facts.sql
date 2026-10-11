-- Keep the minimum event-time facts needed for arbitrary analytics filters after
-- raw payload retention. Arguments, log fields, custom props and source are excluded.
CREATE TABLE analytics_facts (
 project_id uuid NOT NULL REFERENCES projects(id), ts timestamptz NOT NULL, id uuid NOT NULL,
 type text NOT NULL, session_id text, tool text, duration_ms int, is_error boolean NOT NULL,
 client_name text, client_version text, attrs jsonb NOT NULL, client jsonb, caller jsonb,
 PRIMARY KEY(project_id,ts,id)
);
CREATE INDEX ON analytics_facts(project_id,session_id,ts) WHERE session_id IS NOT NULL;
CREATE FUNCTION analytics_metric_attrs(a jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(a)
 WHERE key=ANY(ARRAY['transport','method','uri','prompt','reason','tool','duration_ms','is_error','error_kind','error_code','input_bytes','output_bytes','output_chars','output_kinds','cancelled','input_schema_valid','output_schema_valid','requested_protocol_version','client_capabilities','server_capabilities','where'])
$$;
CREATE FUNCTION analytics_caller_metadata(c jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN c IS NULL OR c='null'::jsonb THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('subject',c->'subject','subject_kind',c->'subject_kind','key_id',c->'key_id','ip_hash',c->'ip_hash')) END
$$;
CREATE FUNCTION analytics_fact_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO analytics_facts VALUES(NEW.project_id,NEW.ts,NEW.id,NEW.type,NEW.session_id,NEW.tool,NEW.duration_ms,NEW.is_error,NEW.client_name,NEW.client_version,analytics_metric_attrs(NEW.attrs),NEW.client,analytics_caller_metadata(NEW.caller)) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER analytics_fact_capture AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION analytics_fact_capture();
INSERT INTO analytics_facts SELECT project_id,ts,id,type,session_id,tool,duration_ms,is_error,client_name,client_version,analytics_metric_attrs(attrs),client,analytics_caller_metadata(caller) FROM events ON CONFLICT DO NOTHING;
CREATE TRIGGER analytics_facts_deleted AFTER DELETE ON analytics_facts REFERENCING OLD TABLE AS changed_events FOR EACH STATEMENT EXECUTE FUNCTION analytics_changed();
-- Rebuild existing aggregates using the complete retained metric history.
UPDATE rollup_cursor SET received_at_watermark='1970-01-01' WHERE name='analytics';
UPDATE projects SET analytics_revision=analytics_revision+1;
