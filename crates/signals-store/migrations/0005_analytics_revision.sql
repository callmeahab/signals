-- Statement-level invalidation makes cached read snapshots coherent across collectors.
ALTER TABLE projects ADD COLUMN analytics_revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION analytics_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE projects SET analytics_revision=analytics_revision+1 WHERE id IN (SELECT DISTINCT project_id FROM changed_events);
 RETURN NULL;
END $$;
CREATE TRIGGER analytics_changed AFTER INSERT ON events REFERENCING NEW TABLE AS changed_events FOR EACH STATEMENT EXECUTE FUNCTION analytics_changed();
CREATE TRIGGER analytics_deleted AFTER DELETE ON events REFERENCING OLD TABLE AS changed_events FOR EACH STATEMENT EXECUTE FUNCTION analytics_changed();
