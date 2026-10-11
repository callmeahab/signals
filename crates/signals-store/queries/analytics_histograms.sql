SELECT r.hour,r.tool,r.is_project,r.metrics->'latency_hist' AS "hist!"
FROM analytics_hourly r
WHERE r.project_id=$1 AND r.hour>=$2 AND r.hour+interval '1 hour'<=$3
AND NOT EXISTS (
 SELECT 1 FROM analytics_hourly_arrivals a
 WHERE a.project_id=r.project_id AND a.hour=r.hour AND a.received_at>$4
)
