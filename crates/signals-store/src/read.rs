use crate::Store;
use crate::{checked_query, checked_query_scalar};
use anyhow::Result;
use chrono::{DateTime, Duration, Timelike, Utc};
use serde_json::{json, Value};
use signals_core::{histogram, percentile};
use sqlx::Row;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub struct EventQuery<'a> {
    pub kind: Option<&'a str>,
    pub tool: Option<&'a str>,
    pub q: Option<&'a str>,
    pub caller: Option<i64>,
    pub is_error: Option<bool>,
    pub cursor: Option<(DateTime<Utc>, Uuid)>,
    pub since: DateTime<Utc>,
}
#[derive(Default)]
pub struct Summary {
    pub requests: i64,
    pub calls: i64,
    pub errors: i64,
    pub sessions: BTreeSet<String>,
    pub callers: BTreeSet<i64>,
    pub clients: BTreeMap<String, i64>,
    pub hist: Vec<i64>,
}
impl Summary {
    pub fn error_rate(&self) -> f64 {
        if self.requests == 0 {
            0.0
        } else {
            self.errors as f64 / self.requests as f64 * 100.0
        }
    }
    fn add(&mut self, row: &sqlx::postgres::PgRow) {
        self.requests += row.get::<i64, _>("requests");
        self.calls += row.get::<i64, _>("tool_calls");
        self.errors += row.get::<i64, _>("errors");
        self.sessions
            .extend(row.get::<Vec<String>, _>("session_ids"));
        self.callers.extend(row.get::<Vec<i64>, _>("caller_ids"));
        let clients: Value = row.get("by_client");
        if let Some(map) = clients.as_object() {
            for (k, v) in map {
                *self.clients.entry(k.clone()).or_default() += v.as_i64().unwrap_or(0);
            }
        }
        self.hist.resize(24, 0);
        for (i, v) in row
            .get::<Vec<i64>, _>("duration_hist")
            .iter()
            .enumerate()
            .take(24)
        {
            self.hist[i] += v;
        }
    }
    fn raw(&mut self, row: &sqlx::postgres::PgRow) {
        if let Some(id) = row.get::<Option<String>, _>("session_id") {
            self.sessions.insert(id);
        }
        if let Some(id) = row.get::<Option<i64>, _>("caller_id") {
            self.callers.insert(id);
        }
        if !row.get::<String, _>("type").starts_with("session.") {
            self.requests += 1;
            self.errors += i64::from(row.get::<bool, _>("is_error"));
            self.calls += i64::from(row.get::<String, _>("type") == "tool.call");
            *self
                .clients
                .entry(
                    row.get::<Option<String>, _>("client_name")
                        .unwrap_or_else(|| "Unknown".into()),
                )
                .or_default() += 1;
            self.hist.resize(24, 0);
            if let Some(v) = row.get::<Option<i32>, _>("duration_ms") {
                for (a, b) in self.hist.iter_mut().zip(histogram([v])) {
                    *a += b;
                }
            }
        }
    }
}
fn delta(current: f64, prev: f64) -> Value {
    if prev == 0.0 {
        Value::Null
    } else {
        json!((current - prev) / prev * 100.0)
    }
}
fn bucket_start(v: DateTime<Utc>, daily: bool) -> DateTime<Utc> {
    if daily {
        v.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc()
    } else {
        v.with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap()
            .with_nanosecond(0)
            .unwrap()
    }
}
fn full_bounds(
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    daily: bool,
) -> (DateTime<Utc>, DateTime<Utc>) {
    let step = if daily {
        Duration::days(1)
    } else {
        Duration::hours(1)
    };
    let start = if from == bucket_start(from, daily) {
        from
    } else {
        bucket_start(from, daily) + step
    };
    (start, bucket_start(to, daily).max(start))
}
#[derive(Default)]
struct ToolBucket {
    calls: i64,
    errors: i64,
    hist: Vec<i64>,
    last: Option<DateTime<Utc>>,
}
impl ToolBucket {
    fn merge(&mut self, other: &Self) {
        self.calls += other.calls;
        self.errors += other.errors;
        self.hist.resize(24, 0);
        for (a, b) in self.hist.iter_mut().zip(&other.hist) {
            *a += b;
        }
        self.last = self.last.into_iter().chain(other.last).max();
    }
}
type ToolBuckets = BTreeMap<String, BTreeMap<DateTime<Utc>, ToolBucket>>;
impl Store {
    async fn summary_rows(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<BTreeMap<DateTime<Utc>, Summary>> {
        let floor = |v: DateTime<Utc>| {
            v.with_minute(0)
                .unwrap()
                .with_second(0)
                .unwrap()
                .with_nanosecond(0)
                .unwrap()
        };
        let full_from = if from == floor(from) {
            from
        } else {
            floor(from) + Duration::hours(1)
        };
        let full_to = floor(to).max(full_from);
        let mut map = BTreeMap::new();
        for row in checked_query!("SELECT * FROM rollup_project_hourly WHERE project_id=$1 AND hour>=$2 AND hour<$3 ORDER BY hour" ,project,full_from,full_to).fetch_all(&self.pool).await? {map.entry(row.get("hour")).or_insert_with(Summary::default).add(&row);}
        if from < full_from || full_to < to {
            for row in checked_query!("SELECT ts,type,is_error,duration_ms,session_id,caller_id,client_name FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 AND (ts<$4 OR ts>=$5)" ,project,from,to,full_from,full_to).fetch_all(&self.pool).await? {map.entry(floor(row.get("ts"))).or_insert_with(Summary::default).raw(&row);}
        }
        Ok(map)
    }
    pub async fn summary(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Summary> {
        let (full_from, full_to) = full_bounds(from, to, false);
        let mut total = Summary::default();
        for row in checked_query!("SELECT * FROM rollup_project_hourly WHERE project_id=$1 AND hour>=$2 AND hour<$3 ORDER BY hour",project,full_from,full_to).fetch_all(&self.pool).await? {
            total.add(&row);
        }
        if from < full_from || full_to < to {
            for row in checked_query!("SELECT ts,type,is_error,duration_ms,session_id,caller_id,client_name FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 AND (ts<$4 OR ts>=$5)",project,from,to,full_from,full_to).fetch_all(&self.pool).await? {
                total.raw(&row);
            }
        }
        Ok(total)
    }
    pub async fn overview(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value> {
        let watermark_query = checked_query_scalar!(
            "SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly'"
        );
        let (current, prev, tools, watermark): (_, _, _, DateTime<Utc>) = tokio::try_join!(
            self.summary(project, from, to),
            self.summary(project, from - (to - from), from),
            self.top_tools(project, from, to),
            async { Ok::<_, anyhow::Error>(watermark_query.fetch_one(&self.pool).await?) }
        )?;
        let top_tools = tools
            .as_array()
            .unwrap()
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>();
        Ok(
            json!({"requests":current.requests,"tool_calls":current.calls,"errors":current.errors,"error_rate":current.error_rate(),"sessions":current.sessions.len(),"unique_callers":current.callers.len(),"p50":percentile(&current.hist,0.5),"p95":percentile(&current.hist,0.95),"p99":percentile(&current.hist,0.99),"top_tools":top_tools,"updated_at":watermark,
          "clients":current.clients.iter().map(|(name,count)|json!({"name":name,"count":count})).collect::<Vec<_>>(),
          "deltas":{"tool_calls":delta(current.calls as f64,prev.calls as f64),"errors":delta(current.errors as f64,prev.errors as f64),"sessions":delta(current.sessions.len() as f64,prev.sessions.len() as f64),"p50":delta(percentile(&current.hist,0.5),percentile(&prev.hist,0.5)),"p99":delta(percentile(&current.hist,0.99),percentile(&prev.hist,0.99)),"requests":delta(current.requests as f64,prev.requests as f64),"error_rate":delta(current.error_rate(),prev.error_rate()),"p95":delta(percentile(&current.hist,0.95),percentile(&prev.hist,0.95)),"unique_callers":delta(current.callers.len() as f64,prev.callers.len() as f64)}}),
        )
    }
    pub async fn timeseries(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        daily: bool,
    ) -> Result<Value> {
        let step = if daily {
            Duration::days(1)
        } else {
            Duration::hours(1)
        };
        let mut map = BTreeMap::<DateTime<Utc>, Summary>::new();
        for (hour, s) in self.summary_rows(project, from, to).await? {
            let target = map.entry(bucket_start(hour, daily)).or_default();
            target.requests += s.requests;
            target.calls += s.calls;
            target.errors += s.errors;
            target.sessions.extend(s.sessions);
            target.callers.extend(s.callers);
            target.hist.resize(24, 0);
            for (a, b) in target.hist.iter_mut().zip(s.hist) {
                *a += b;
            }
        }
        let mut points = Vec::new();
        let mut ts = bucket_start(from, daily);
        while ts < to {
            let s = map.remove(&ts).unwrap_or_default();
            points.push(json!({"ts":ts,"requests":s.requests,"errors":s.errors,"sessions":s.sessions.len(),"callers":s.callers.len(),"latency_p50":percentile(&s.hist,0.5),"latency_p95":percentile(&s.hist,0.95),"latency_p99":percentile(&s.hist,0.99)}));
            ts += step;
        }
        Ok(json!(points))
    }
    async fn tool_buckets(
        &self,
        project: Uuid,
        selected: Option<&[String]>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<ToolBuckets> {
        let (full_from, full_to) = full_bounds(from, to, false);
        let mut tools = ToolBuckets::new();
        for row in checked_query!("SELECT tool,hour,calls,errors,duration_hist,last_called FROM rollup_tool_hourly WHERE project_id=$1 AND ($2::text[] IS NULL OR tool=ANY($2)) AND hour>=$3 AND hour<$4",project,selected,full_from,full_to).fetch_all(&self.pool).await? {
            let name:String=row.get("tool");
            let b=tools.entry(name).or_default().entry(row.get("hour")).or_default();
            b.merge(&ToolBucket{calls:row.get("calls"),errors:row.get("errors"),hist:row.get("duration_hist"),last:Some(row.get("last_called"))});
        }
        if from < full_from || full_to < to {
            for row in checked_query!("SELECT tool,ts,is_error,duration_ms FROM events WHERE project_id=$1 AND ($2::text[] IS NULL OR tool=ANY($2)) AND tool IS NOT NULL AND type='tool.call' AND ts>=$3 AND ts<$4 AND (ts<$5 OR ts>=$6)",project,selected,from,to,full_from,full_to).fetch_all(&self.pool).await? {
                let ts:DateTime<Utc>=row.get("ts");
                let b=tools.entry(row.get("tool")).or_default().entry(bucket_start(ts,false)).or_default();
                b.merge(&ToolBucket{calls:1,errors:i64::from(row.get::<bool,_>("is_error")),hist:histogram(row.get::<Option<i32>,_>("duration_ms")),last:Some(ts)});
            }
        }
        Ok(tools)
    }
    pub async fn tools(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value> {
        self.tools_selected(project, None, from, to).await
    }
    async fn top_tools(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value> {
        let (full_from, full_to) = full_bounds(from, to, false);
        let selected: Vec<String> = checked_query_scalar!("SELECT tool FROM (SELECT tool,calls FROM rollup_tool_hourly WHERE project_id=$1 AND hour>=$4 AND hour<$5 UNION ALL SELECT tool,1 AS calls FROM events WHERE project_id=$1 AND type='tool.call' AND tool IS NOT NULL AND ts>=$2 AND ts<$3 AND (ts<$4 OR ts>=$5)) totals GROUP BY tool ORDER BY sum(calls) DESC,tool LIMIT 5",project,from,to,full_from,full_to).fetch_all(&self.pool).await?;
        self.tools_selected(project, Some(&selected), from, to)
            .await
    }
    async fn tools_selected(
        &self,
        project: Uuid,
        selected: Option<&[String]>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value> {
        let mut result = Vec::new();
        for (name, buckets) in self.tool_buckets(project, selected, from, to).await? {
            let mut total = ToolBucket::default();
            for b in buckets.values() {
                total.merge(b);
            }
            let mut ts = bucket_start(from, false);
            let mut trend = Vec::new();
            while ts < to {
                trend.push(buckets.get(&ts).map_or(0, |b| b.calls));
                ts += Duration::hours(1);
            }
            if total.calls > 0 {
                result.push(json!({"tool":name,"calls":total.calls,"errors":total.errors,"p50":percentile(&total.hist,0.5),"p95":percentile(&total.hist,0.95),"p99":percentile(&total.hist,0.99),"last_called":total.last,"trend":trend}));
            }
        }
        result.sort_by_key(|v| std::cmp::Reverse(v["calls"].as_i64().unwrap_or(0)));
        Ok(json!(result))
    }
    pub async fn tool_timeseries(
        &self,
        project: Uuid,
        tool: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        daily: bool,
    ) -> Result<Value> {
        let mut buckets = BTreeMap::<DateTime<Utc>, ToolBucket>::new();
        let selected = vec![tool.to_owned()];
        if let Some(hours) = self
            .tool_buckets(project, Some(&selected), from, to)
            .await?
            .remove(tool)
        {
            for (hour, b) in hours {
                buckets
                    .entry(bucket_start(hour, daily))
                    .or_default()
                    .merge(&b);
            }
        }
        let step = if daily {
            Duration::days(1)
        } else {
            Duration::hours(1)
        };
        let mut ts = bucket_start(from, daily);
        let mut points = Vec::new();
        while ts < to {
            let b = buckets.remove(&ts).unwrap_or_default();
            points.push(json!({"ts":ts,"requests":b.calls,"errors":b.errors,"sessions":0,"callers":0,"latency_p50":percentile(&b.hist,0.5),"latency_p95":percentile(&b.hist,0.95),"latency_p99":percentile(&b.hist,0.99)}));
            ts += step;
        }
        Ok(json!(points))
    }
    pub async fn callers(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value> {
        let day = |v: DateTime<Utc>| v.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
        let full_from = if from == day(from) {
            from
        } else {
            day(from) + Duration::days(1)
        };
        let full_to = day(to).max(full_from);
        let rows=checked_query!("SELECT caller_id,calls,errors,session_ids,clients FROM rollup_caller_daily WHERE project_id=$1 AND day>=$4::timestamptz::date AND day<$5::timestamptz::date UNION ALL SELECT caller_id,count(*) FILTER(WHERE type NOT LIKE 'session.%') AS calls,count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error) AS errors,coalesce(array_agg(DISTINCT session_id) FILTER(WHERE session_id IS NOT NULL),'{}') AS session_ids,coalesce(array_agg(DISTINCT client_name) FILTER(WHERE client_name IS NOT NULL),'{}') AS clients FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 AND (ts<$4 OR ts>=$5) AND caller_id IS NOT NULL GROUP BY caller_id" ,project,from,to,full_from,full_to).fetch_all(&self.pool).await?;
        let mut facts = BTreeMap::<i64, (i64, i64, BTreeSet<String>, BTreeSet<String>)>::new();
        for row in rows {
            let f = facts.entry(row.get("caller_id")).or_default();
            f.0 += row.get::<i64, _>("calls");
            f.1 += row.get::<i64, _>("errors");
            f.2.extend(row.get::<Vec<String>, _>("session_ids"));
            f.3.extend(row.get::<Vec<String>, _>("clients"));
        }
        let ids: Vec<_> = facts.keys().copied().collect();
        let mut result = Vec::new();
        for row in checked_query!("SELECT id,kind,label,first_seen,last_seen FROM callers WHERE project_id=$1 AND id=ANY($2) ORDER BY last_seen DESC" ,project,&ids).fetch_all(&self.pool).await?{let id:i64=row.get("id");let f=&facts[&id];result.push(json!({"id":id.to_string(),"kind":row.get::<String,_>("kind"),"label":row.get::<String,_>("label"),"calls":f.0,"errors":f.1,"sessions":f.2.len(),"clients":f.3,"first_seen":row.get::<DateTime<Utc>,_>("first_seen"),"last_seen":row.get::<DateTime<Utc>,_>("last_seen")}));}
        Ok(json!(result))
    }
    pub async fn caller_timeseries(
        &self,
        project: Uuid,
        caller: i64,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value> {
        let daily = to - from > Duration::days(2);
        let step = if daily {
            Duration::days(1)
        } else {
            Duration::hours(1)
        };
        let (full_from, full_to) = if daily {
            full_bounds(from, to, true)
        } else {
            (to, to)
        };
        let rows=checked_query!("SELECT day::timestamptz AS bucket,calls,errors,cardinality(session_ids)::bigint AS sessions FROM rollup_caller_daily WHERE $5 AND project_id=$1 AND caller_id=$2 AND day>=$6::timestamptz::date AND day<$7::timestamptz::date UNION ALL SELECT date_trunc(CASE WHEN $5 THEN 'day' ELSE 'hour' END,ts) AS bucket,count(*) FILTER(WHERE type NOT LIKE 'session.%') AS calls,count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error) AS errors,count(DISTINCT session_id) AS sessions FROM events WHERE project_id=$1 AND caller_id=$2 AND ts>=$3 AND ts<$4 AND (NOT $5 OR ts<$6 OR ts>=$7) GROUP BY bucket",project,caller,from,to,daily,full_from,full_to).fetch_all(&self.pool).await?;
        let mut buckets = BTreeMap::new();
        for row in rows {
            buckets.insert(
                row.get::<DateTime<Utc>, _>("bucket"),
                (
                    row.get::<i64, _>("calls"),
                    row.get::<i64, _>("errors"),
                    row.get::<i64, _>("sessions"),
                ),
            );
        }
        let mut ts = bucket_start(from, daily);
        let mut points = Vec::new();
        while ts < to {
            let (calls, errors, sessions) = buckets.remove(&ts).unwrap_or_default();
            points.push(json!({"ts":ts,"requests":calls,"errors":errors,"sessions":sessions,"callers":i64::from(calls>0),"latency_p50":0,"latency_p95":0,"latency_p99":0}));
            ts += step;
        }
        Ok(json!(points))
    }
    pub async fn events(&self, project: Uuid, query: EventQuery<'_>) -> Result<Value> {
        let EventQuery {
            kind,
            tool,
            q,
            caller,
            is_error,
            cursor,
            since,
        } = query;
        let (ts, id) = cursor.unwrap_or((Utc::now() + Duration::minutes(6), Uuid::max()));
        let rows=checked_query!("SELECT ts,id,jsonb_build_object('id',id,'ts',ts,'type',type,'session_id',session_id,'caller_id',caller_id::text,'tool',tool,'duration_ms',duration_ms,'is_error',is_error,'client_name',client_name,'client_version',client_version,'attrs',attrs) AS event FROM events WHERE project_id=$1 AND ts>=$2 AND (ts,id)<($3,$4) AND ($5::text IS NULL OR type=$5) AND ($6::text IS NULL OR tool=$6) AND ($7::text IS NULL OR tool ILIKE '%'||$7||'%' OR attrs->>'message' ILIKE '%'||$7||'%' OR attrs->>'error_message' ILIKE '%'||$7||'%') AND ($8::bigint IS NULL OR caller_id=$8) AND ($9::boolean IS NULL OR is_error=$9) ORDER BY ts DESC,id DESC LIMIT 101" ,project,since,ts,id,kind,tool,q,caller,is_error).fetch_all(&self.pool).await?;
        let next = if rows.len() > 100 {
            let r = &rows[99];
            Some(format!(
                "{}|{}",
                r.get::<DateTime<Utc>, _>("ts").to_rfc3339(),
                r.get::<Uuid, _>("id")
            ))
        } else {
            None
        };
        Ok(
            json!({"items":rows.iter().take(100).map(|r|r.get::<Value,_>("event")).collect::<Vec<_>>(),"next_cursor":next}),
        )
    }
    pub async fn sessions(
        &self,
        project: Uuid,
        cursor: Option<(DateTime<Utc>, String)>,
        caller: Option<i64>,
        client: Option<&str>,
    ) -> Result<Value> {
        let (ts, id) = cursor.unwrap_or((Utc::now() + Duration::minutes(6), String::from("~")));
        let rows=checked_query!("SELECT s.started_at,s.session_id,jsonb_build_object('session_id',s.session_id,'client_name',s.client_name,'caller_label',coalesce(c.label,'Unknown'),'started_at',s.started_at,'ended_at',s.ended_at,'calls',s.calls,'errors',s.errors,'transport',s.transport) AS session FROM sessions s LEFT JOIN callers c ON c.id=s.caller_id WHERE s.project_id=$1 AND (s.started_at,s.session_id)<($2,$3) AND ($4::bigint IS NULL OR s.caller_id=$4) AND ($5::text IS NULL OR s.client_name=$5) ORDER BY s.started_at DESC,s.session_id DESC LIMIT 51" ,project,ts,id,caller,client).fetch_all(&self.pool).await?;
        let next = if rows.len() > 50 {
            let r = &rows[49];
            Some(format!(
                "{}|{}",
                r.get::<DateTime<Utc>, _>("started_at").to_rfc3339(),
                r.get::<String, _>("session_id")
            ))
        } else {
            None
        };
        Ok(
            json!({"items":rows.iter().take(50).map(|r|r.get::<Value,_>("session")).collect::<Vec<_>>(),"next_cursor":next}),
        )
    }
    pub async fn session_events(
        &self,
        project: Uuid,
        session: &str,
        since: DateTime<Utc>,
        cursor: Option<(DateTime<Utc>, Uuid)>,
    ) -> Result<Value> {
        let (ts, id) = cursor.unwrap_or((since, Uuid::nil()));
        let rows=checked_query!("SELECT ts,id,jsonb_build_object('id',id,'ts',ts,'type',type,'session_id',session_id,'caller_id',caller_id::text,'tool',tool,'duration_ms',duration_ms,'is_error',is_error,'client_name',client_name,'client_version',client_version,'attrs',attrs) AS event FROM events WHERE project_id=$1 AND session_id=$2 AND ts>=$3 AND (ts,id)>($4,$5) ORDER BY ts,id LIMIT 201" ,project,session,since,ts,id).fetch_all(&self.pool).await?;
        let next = if rows.len() > 200 {
            let r = &rows[199];
            Some(format!(
                "{}|{}",
                r.get::<DateTime<Utc>, _>("ts").to_rfc3339(),
                r.get::<Uuid, _>("id")
            ))
        } else {
            None
        };
        Ok(
            json!({"items":rows.iter().take(200).map(|r|r.get::<Value,_>("event")).collect::<Vec<_>>(),"next_cursor":next}),
        )
    }
    pub async fn live_event(
        &self,
        project: Uuid,
        id: Uuid,
        ts: DateTime<Utc>,
    ) -> Result<Option<Value>> {
        Ok(checked_query_scalar!("SELECT jsonb_build_object('id',id,'ts',ts,'type',type,'session_id',session_id,'caller_id',caller_id::text,'tool',tool,'duration_ms',duration_ms,'is_error',is_error,'client_name',client_name,'client_version',client_version,'attrs',attrs) FROM events WHERE project_id=$1 AND id=$2 AND ts=$3" ,project,id,ts).fetch_optional(&self.pool).await?)
    }
}
