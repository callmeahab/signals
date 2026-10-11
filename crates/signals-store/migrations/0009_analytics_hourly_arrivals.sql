-- Eligibility metadata is independent of raw-event partitions and retention.
-- Statement-level capture records the newest committed arrival for each hour.
CREATE TABLE analytics_hourly_arrivals (
 project_id uuid NOT NULL REFERENCES projects(id),
 hour timestamptz NOT NULL,
 received_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,hour)
);
INSERT INTO analytics_hourly_arrivals
 SELECT project_id,date_trunc('hour',ts,'UTC'),max(received_at)
 FROM events GROUP BY project_id,date_trunc('hour',ts,'UTC');
CREATE FUNCTION analytics_record_arrivals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO analytics_hourly_arrivals AS a
 SELECT project_id,date_trunc('hour',ts,'UTC'),max(received_at)
 FROM arrived_events GROUP BY project_id,date_trunc('hour',ts,'UTC')
 ON CONFLICT(project_id,hour) DO UPDATE
 SET received_at=greatest(a.received_at,EXCLUDED.received_at);
 RETURN NULL;
END $$;
CREATE TRIGGER analytics_record_arrivals AFTER INSERT ON events
 REFERENCING NEW TABLE AS arrived_events FOR EACH STATEMENT
 EXECUTE FUNCTION analytics_record_arrivals();
