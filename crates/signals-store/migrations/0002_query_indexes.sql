-- Dirty-bucket discovery has a global received-time predicate; project-first
-- indexes cannot serve that scan efficiently.
CREATE INDEX events_received_at_idx ON events(received_at) INCLUDE(project_id,ts);
CREATE INDEX events_caller_time_idx ON events(project_id,caller_id,ts DESC) WHERE caller_id IS NOT NULL;
-- INCLUDE columns let dashboard rollup reads use covering indexes after vacuum.
CREATE INDEX project_rollup_cover_idx ON rollup_project_hourly(project_id,hour)
 INCLUDE(requests,errors,tool_calls,duration_hist);
CREATE INDEX tool_rollup_cover_idx ON rollup_tool_hourly(project_id,hour,tool)
 INCLUDE(calls,errors,duration_sum,duration_max,duration_hist,last_called);
CREATE INDEX caller_rollup_cover_idx ON rollup_caller_daily(project_id,day,caller_id)
 INCLUDE(calls,errors,last_seen);
CREATE INDEX sessions_cover_idx ON sessions(project_id,started_at DESC,session_id DESC)
 INCLUDE(ended_at,caller_id,client_name,client_version,calls,errors,transport);
