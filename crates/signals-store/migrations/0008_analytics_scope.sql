-- Empty tool names are legal in v1.0: never use one as the project-total sentinel.
ALTER TABLE analytics_hourly ADD COLUMN is_project boolean NOT NULL DEFAULT false;
UPDATE analytics_hourly SET is_project=true WHERE tool='';
ALTER TABLE analytics_hourly DROP CONSTRAINT analytics_hourly_pkey;
ALTER TABLE analytics_hourly ADD PRIMARY KEY(project_id,hour,tool,is_project);
UPDATE rollup_cursor SET received_at_watermark='1970-01-01' WHERE name='analytics';
