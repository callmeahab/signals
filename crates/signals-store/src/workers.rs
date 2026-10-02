use crate::{checked_query, checked_query_scalar};
use crate::{ingest::ensure_partition, Store};
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use signals_core::INGEST_LOCK;
use sqlx::Row;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

const WORKER_LOCK: i64 = 0x53494703;
impl Store {
    pub async fn rollup(&self) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        if !checked_query_scalar!(<_, bool>"SELECT pg_try_advisory_xact_lock($1)" ,WORKER_LOCK)
            .fetch_one(&mut *tx)
            .await?
        {
            return Ok(());
        }
        let watermark: DateTime<Utc> = checked_query_scalar!(
            "SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly' FOR UPDATE"
        )
        .fetch_one(&mut *tx)
        .await?;
        // A short commit barrier ensures every older received_at is durable.
        // Release it before aggregation, so ingest continues while rollups run.
        let mut barrier = self.pool.begin().await?;
        checked_query!("SELECT pg_advisory_xact_lock($1)", INGEST_LOCK)
            .execute(&mut *barrier)
            .await?;
        let cutoff: DateTime<Utc> = checked_query_scalar!("SELECT clock_timestamp()")
            .fetch_one(&mut *barrier)
            .await?;
        barrier.commit().await?;
        let dirty=checked_query!("SELECT DISTINCT project_id,date_trunc('hour',ts) AS hour FROM events WHERE received_at>$1 AND received_at<=$2" ,watermark,cutoff).fetch_all(&mut *tx).await?;
        let mut days = BTreeSet::new();
        for bucket in dirty {
            let project: Uuid = bucket.get("project_id");
            let hour: DateTime<Utc> = bucket.get("hour");
            let end = hour + Duration::hours(1);
            days.insert((project, hour.date_naive()));
            let base=checked_query!("SELECT count(*) FILTER(WHERE type NOT LIKE 'session.%') AS requests,count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error) AS errors,count(*) FILTER(WHERE type='tool.call') AS calls,coalesce(array_agg(DISTINCT session_id) FILTER(WHERE session_id IS NOT NULL),'{}') AS session_ids,coalesce(array_agg(DISTINCT caller_id) FILTER(WHERE caller_id IS NOT NULL),'{}') AS caller_ids FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3" ,project,hour,end).fetch_one(&mut *tx).await?;
            let mut clients = BTreeMap::new();
            for r in checked_query!("SELECT coalesce(client_name,'Unknown') AS client,count(*) AS n FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 AND type NOT LIKE 'session.%' GROUP BY client_name" ,project,hour,end).fetch_all(&mut *tx).await?{clients.insert(r.get::<String,_>("client"),r.get::<i64,_>("n"));}
            let mut hist = vec![0i64; 24];
            for r in checked_query!("SELECT LEAST(width_bucket(duration_ms-1,ARRAY[1,2,3,5,8,13,21,34,55,89,144,233,377,610,987,1597,2584,4181,6765,10946,17711,28657,46368,60000]),23) AS bucket,count(*) AS n FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 AND type NOT LIKE 'session.%' AND duration_ms IS NOT NULL GROUP BY bucket" ,project,hour,end).fetch_all(&mut *tx).await?{hist[r.get::<i32,_>("bucket") as usize]=r.get("n");}
            let sessions: Vec<String> = base.get("session_ids");
            let callers: Vec<i64> = base.get("caller_ids");
            checked_query!("INSERT INTO rollup_project_hourly VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(project_id,hour) DO UPDATE SET requests=EXCLUDED.requests,errors=EXCLUDED.errors,tool_calls=EXCLUDED.tool_calls,session_ids=EXCLUDED.session_ids,caller_ids=EXCLUDED.caller_ids,by_client=EXCLUDED.by_client,duration_hist=EXCLUDED.duration_hist" ,project,hour,base.get::<i64,_>("requests"),base.get::<i64,_>("errors"),base.get::<i64,_>("calls"),&sessions,&callers,json!(clients),&hist).execute(&mut *tx).await?;
            let rows=checked_query!("SELECT tool,CASE WHEN duration_ms IS NULL THEN -1 ELSE LEAST(width_bucket(duration_ms-1,ARRAY[1,2,3,5,8,13,21,34,55,89,144,233,377,610,987,1597,2584,4181,6765,10946,17711,28657,46368,60000]),23) END AS bucket,count(*) AS calls,count(*) FILTER(WHERE is_error) AS errors,coalesce(sum(duration_ms),0)::bigint AS duration_sum,coalesce(max(duration_ms),0) AS duration_max,max(ts) AS last_called FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 AND type='tool.call' AND tool IS NOT NULL GROUP BY tool,bucket" ,project,hour,end).fetch_all(&mut *tx).await?;
            let mut tools =
                BTreeMap::<String, (i64, i64, i64, i32, Vec<i64>, DateTime<Utc>)>::new();
            for r in rows {
                let tool: String = r.get("tool");
                let v = tools.entry(tool).or_insert((0, 0, 0, 0, vec![0; 24], hour));
                v.0 += r.get::<i64, _>("calls");
                v.1 += r.get::<i64, _>("errors");
                v.2 += r.get::<i64, _>("duration_sum");
                v.3 = v.3.max(r.get("duration_max"));
                v.5 = v.5.max(r.get("last_called"));
                let b: i32 = r.get("bucket");
                if b >= 0 {
                    v.4[b as usize] += r.get::<i64, _>("calls");
                }
            }
            for (tool, (calls, errors, sum, max, hist, last)) in tools {
                checked_query!("INSERT INTO rollup_tool_hourly VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(project_id,hour,tool) DO UPDATE SET calls=EXCLUDED.calls,errors=EXCLUDED.errors,duration_sum=EXCLUDED.duration_sum,duration_max=EXCLUDED.duration_max,duration_hist=EXCLUDED.duration_hist,last_called=EXCLUDED.last_called" ,project,hour,tool,calls,errors,sum,max,&hist,last).execute(&mut *tx).await?;
            }
            if !sessions.is_empty() {
                checked_query!("INSERT INTO sessions SELECT project_id,session_id,min(ts),max(ts) FILTER(WHERE type='session.end'),max(ts),min(caller_id),coalesce(max(client_name),'Unknown'),max(client_version),count(*) FILTER(WHERE type NOT LIKE 'session.%'),count(*) FILTER(WHERE is_error),coalesce(max(attrs->>'transport'),'streamable-http') FROM events WHERE project_id=$1 AND session_id=ANY($2) GROUP BY project_id,session_id ON CONFLICT(project_id,session_id) DO UPDATE SET started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,last_seen=EXCLUDED.last_seen,caller_id=EXCLUDED.caller_id,client_name=EXCLUDED.client_name,client_version=EXCLUDED.client_version,calls=EXCLUDED.calls,errors=EXCLUDED.errors,transport=EXCLUDED.transport" ,project,&sessions).execute(&mut *tx).await?;
            }
        }
        for (project, day) in days {
            checked_query!("INSERT INTO rollup_caller_daily SELECT project_id,ts::date,caller_id,count(*) FILTER(WHERE type NOT LIKE 'session.%'),count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error),coalesce(array_agg(DISTINCT session_id) FILTER(WHERE session_id IS NOT NULL),'{}'),coalesce(array_agg(DISTINCT client_name) FILTER(WHERE client_name IS NOT NULL),'{}'),max(ts) FROM events WHERE project_id=$1 AND ts>=$2::timestamptz AND ts<$2::timestamptz+interval '1 day' AND caller_id IS NOT NULL GROUP BY project_id,ts::date,caller_id ON CONFLICT(project_id,day,caller_id) DO UPDATE SET calls=EXCLUDED.calls,errors=EXCLUDED.errors,session_ids=EXCLUDED.session_ids,clients=EXCLUDED.clients,last_seen=EXCLUDED.last_seen" ,project,day.and_hms_opt(0,0,0).unwrap().and_utc()).execute(&mut *tx).await?;
        }
        checked_query!("UPDATE sessions SET ended_at=last_seen WHERE ended_at IS NULL AND last_seen<clock_timestamp()-interval '30 minutes'").execute(&mut *tx).await?;
        checked_query!(
            "UPDATE rollup_cursor SET received_at_watermark=$1 WHERE name='hourly'",
            cutoff
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn maintain(&self) -> Result<()> {
        let mut guard = self.pool.begin().await?;
        if !checked_query_scalar!(<_, bool>"SELECT pg_try_advisory_xact_lock($1)" ,WORKER_LOCK)
            .fetch_one(&mut *guard)
            .await?
        {
            return Ok(());
        }
        let today = Utc::now().date_naive();
        let mut tx = self.pool.begin().await?;
        for offset in 0..=3 {
            ensure_partition(&mut tx, today + Duration::days(offset)).await?;
        }
        let dates: Vec<chrono::NaiveDate> =
            checked_query_scalar!("SELECT DISTINCT ts::date FROM events_default")
                .fetch_all(&mut *tx)
                .await?;
        for date in dates {
            ensure_partition(&mut tx, date).await?;
        }
        tx.commit().await?;
        // Each chunk commits independently. The coordinator lock prevents a
        // second worker, while ingest remains free to commit during retention.
        let projects = checked_query!("SELECT id,retention_days FROM projects")
            .fetch_all(&self.pool)
            .await?;
        for project in projects {
            let id: Uuid = project.get("id");
            let days: i32 = project.get("retention_days");
            loop {
                let deleted=checked_query!("WITH doomed AS (SELECT tableoid,ctid FROM events WHERE project_id=$1 AND ts<date_trunc('day',clock_timestamp()-make_interval(days=>$2)) LIMIT 10000) DELETE FROM events e USING doomed d WHERE e.tableoid=d.tableoid AND e.ctid=d.ctid" ,id,days).execute(&self.pool).await?.rows_affected();
                if deleted < 10000 {
                    break;
                }
            }
            loop {
                let deleted=checked_query!("WITH doomed AS (SELECT ctid FROM sessions WHERE project_id=$1 AND started_at<clock_timestamp()-make_interval(days=>$2) LIMIT 10000) DELETE FROM sessions s USING doomed d WHERE s.ctid=d.ctid" ,id,days).execute(&self.pool).await?.rows_affected();
                if deleted < 10000 {
                    break;
                }
            }
        }
        let oldest: i32 =
            checked_query_scalar!("SELECT coalesce(max(retention_days),30) FROM projects")
                .fetch_one(&self.pool)
                .await?;
        let partitions:Vec<String>=checked_query_scalar!("SELECT c.relname FROM pg_inherits i JOIN pg_class c ON i.inhrelid=c.oid WHERE i.inhparent='events'::regclass AND c.relname LIKE 'events_2%'").fetch_all(&self.pool).await?;
        for name in partitions {
            if let Ok(date) =
                chrono::NaiveDate::parse_from_str(name.trim_start_matches("events_"), "%Y_%m_%d")
            {
                if date < today - Duration::days(i64::from(oldest) + 1) {
                    sqlx::query(sqlx::AssertSqlSafe(format!("DROP TABLE {name}")))
                        .execute(&self.pool)
                        .await?;
                }
            }
        }
        checked_query!(
            "DELETE FROM rollup_project_hourly WHERE hour<clock_timestamp()-interval '400 days'"
        )
        .execute(&self.pool)
        .await?;
        checked_query!(
            "DELETE FROM rollup_tool_hourly WHERE hour<clock_timestamp()-interval '400 days'"
        )
        .execute(&self.pool)
        .await?;
        checked_query!("DELETE FROM rollup_caller_daily WHERE day<current_date-400")
            .execute(&self.pool)
            .await?;
        checked_query!("DELETE FROM rate_windows WHERE window_start<now()-interval '2 minutes'")
            .execute(&self.pool)
            .await?;
        checked_query!("DELETE FROM dashboard_sessions WHERE expires_at<now()")
            .execute(&self.pool)
            .await?;
        guard.commit().await?;
        Ok(())
    }
}
