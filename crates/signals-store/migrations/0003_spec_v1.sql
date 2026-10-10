-- Preserve SDK/server provenance and complete client/caller context as queryable JSON.
ALTER TABLE events ADD COLUMN source jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN client jsonb;
ALTER TABLE events ADD COLUMN caller jsonb;
UPDATE events SET type = CASE type
 WHEN 'tool.call' THEN 'tool.called'
 WHEN 'session.start' THEN 'session.started'
 WHEN 'session.end' THEN 'session.ended'
 WHEN 'request' THEN 'mcp.request'
 ELSE type END;
