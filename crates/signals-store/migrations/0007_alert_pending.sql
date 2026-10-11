-- A sustained error-rate breach must survive fifteen minute evaluations before firing.
CREATE TABLE analytics_alert_pending (
 project_id uuid PRIMARY KEY REFERENCES projects(id), since timestamptz,
 evaluated_at timestamptz NOT NULL, rule jsonb NOT NULL
);
