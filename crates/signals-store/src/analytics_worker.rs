use crate::analytics::{Data, Filters, Metrics, Window};
use crate::{checked_query, checked_query_scalar, Store};
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use signals_core::INGEST_LOCK;
use sqlx::Row;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

impl Store {
    pub async fn rollup_analytics(&self) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        if !checked_query_scalar!(<_,bool>"SELECT pg_try_advisory_xact_lock(1397311236)")
            .fetch_one(&mut *tx)
            .await?
        {
            return Ok(());
        }
        let watermark: DateTime<Utc> = checked_query_scalar!(
            "SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics' FOR UPDATE"
        )
        .fetch_one(&mut *tx)
        .await?;
        let mut barrier = self.pool.begin().await?;
        checked_query!("SELECT pg_advisory_xact_lock($1)", INGEST_LOCK)
            .execute(&mut *barrier)
            .await?;
        let cutoff: DateTime<Utc> = checked_query_scalar!("SELECT clock_timestamp()")
            .fetch_one(&mut *barrier)
            .await?;
        barrier.commit().await?;
        let dirty=checked_query!("WITH changed AS (SELECT project_id,ts,session_id FROM events WHERE received_at>$1 AND received_at<=$2) SELECT DISTINCT e.project_id,date_trunc('hour',e.ts) AS hour FROM events e WHERE EXISTS(SELECT 1 FROM changed c WHERE c.project_id=e.project_id AND (c.session_id=e.session_id OR c.ts=e.ts)) ORDER BY project_id,hour",watermark,cutoff).fetch_all(&mut *tx).await?;
        let mut projects = BTreeMap::<Uuid, BTreeSet<DateTime<Utc>>>::new();
        for r in dirty {
            projects
                .entry(r.get("project_id"))
                .or_default()
                .insert(r.get("hour"));
        }
        for (project, hours) in projects {
            let data = self
                .analytics_data(project, DateTime::<Utc>::MAX_UTC)
                .await?;
            let mut previous = BTreeMap::new();
            let mut retry_ids = BTreeSet::new();
            let mut corrected_ids = BTreeSet::new();
            for e in data.events.iter().filter(|e| e.call()) {
                if let (Some(session), Some(tool)) = (&e.session_id, &e.tool) {
                    if let Some(previous) = previous.insert((session, tool), e) {
                        let previous: &crate::analytics::Fact = previous;
                        if previous.is_error && e.ts - previous.ts <= Duration::seconds(30) {
                            retry_ids.insert(e.id);
                            if !e.is_error {
                                corrected_ids.insert(e.id);
                            }
                        }
                    }
                }
            }
            let mut days = BTreeSet::new();
            for hour in hours {
                days.insert(hour.date_naive());
                let es = data.selected(
                    Window {
                        from: hour,
                        to: hour + Duration::hours(1),
                    },
                    &Filters::default(),
                );
                let mut groups = BTreeMap::from([(String::new(), Vec::new())]);
                for e in es.iter().filter(|e| e.call()) {
                    groups.get_mut("").unwrap().push(*e);
                    if let Some(tool) = &e.tool {
                        groups.entry(tool.clone()).or_default().push(*e);
                    }
                }
                for (tool, events) in groups {
                    let retries = events.iter().filter(|e| retry_ids.contains(&e.id)).count();
                    let corrected = events
                        .iter()
                        .filter(|e| corrected_ids.contains(&e.id))
                        .count();
                    let mut metrics = Metrics::new(events).rollup(data.divisor());
                    metrics["retries"] = json!(retries);
                    metrics["self_corrected"] = json!(corrected);
                    checked_query!("INSERT INTO analytics_hourly VALUES($1,$2,$3,$4) ON CONFLICT(project_id,hour,tool) DO UPDATE SET metrics=EXCLUDED.metrics",project,hour,tool,metrics).execute(&mut *tx).await?;
                }
            }
            for day in days {
                let from = day.and_hms_opt(0, 0, 0).unwrap().and_utc();
                let window = Window {
                    from,
                    to: from + Duration::days(1),
                };
                let events = data.selected(window, &Filters::default());
                let mut metrics = data.adoption(window, &Filters::default());
                let sessions: BTreeSet<_> = events
                    .iter()
                    .filter_map(|e| e.session_id.as_ref())
                    .collect();
                let errors: BTreeSet<_> = events
                    .iter()
                    .filter(|e| e.is_error)
                    .filter_map(|e| e.session_id.as_ref())
                    .collect();
                metrics["sessions"] = json!(sessions.len());
                metrics["sessions_with_errors"] = json!(errors.len());
                metrics["capabilities"] = data.protocol(&events)["capabilities"].clone();
                checked_query!("INSERT INTO analytics_daily VALUES($1,$2,$3) ON CONFLICT(project_id,day) DO UPDATE SET metrics=EXCLUDED.metrics",project,day,metrics).execute(&mut *tx).await?;
                let mut ids = BTreeMap::new();
                for e in &events {
                    if let Some(id) = e.identity() {
                        ids.entry(id).or_insert_with(Vec::new).push(*e);
                    }
                }
                for ((kind, key), es) in ids {
                    let m = Metrics::new(es);
                    checked_query!("INSERT INTO analytics_identity_daily VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id,day,kind,identity_key) DO UPDATE SET calls=EXCLUDED.calls,errors=EXCLUDED.errors,tokens=EXCLUDED.tokens",project,day,kind,key,m.calls.len() as i64,m.errors() as i64,m.tokens(data.divisor())).execute(&mut *tx).await?;
                }
                checked_query!(
                    "DELETE FROM analytics_paths WHERE project_id=$1 AND day=$2",
                    project,
                    day
                )
                .execute(&mut *tx)
                .await?;
                // Attribute each path to its terminal event's day, including cross-midnight paths.
                let mut sequences = BTreeMap::<&str, Vec<String>>::new();
                let mut paths = BTreeMap::new();
                for e in data.events.iter().filter(|e| e.call() && e.ts < window.to) {
                    if let (Some(s), Some(t)) = (e.session_id.as_deref(), e.tool.as_ref()) {
                        let seq = sequences.entry(s).or_default();
                        seq.push(t.clone());
                        for n in [2, 3] {
                            if seq.len() >= n && window.contains(e.ts) {
                                *paths.entry(seq[seq.len() - n..].to_vec()).or_insert(0i64) += 1;
                            }
                        }
                        if seq.len() > 3 {
                            seq.remove(0);
                        }
                    }
                }
                let mut paths: Vec<_> = paths.into_iter().collect();
                paths.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                for (sequence, count) in paths.into_iter().take(200) {
                    checked_query!(
                        "INSERT INTO analytics_paths VALUES($1,$2,$3,$4)",
                        project,
                        day,
                        &sequence,
                        count
                    )
                    .execute(&mut *tx)
                    .await?;
                }
            }
            checked_query!("UPDATE sessions s SET identity_kind=x.kind,identity_key=x.identity_key,had_error=x.had_error,depth=x.depth,first_tool=x.first_tool,last_tool=x.last_tool FROM (SELECT session_id,(array_agg((analytics_identity(caller))[1] ORDER BY ts,id) FILTER(WHERE analytics_identity(caller) IS NOT NULL))[1] AS kind,(array_agg((analytics_identity(caller))[2] ORDER BY ts,id) FILTER(WHERE analytics_identity(caller) IS NOT NULL))[1] AS identity_key,bool_or(is_error) AS had_error,count(*) FILTER(WHERE type='tool.called') AS depth,(array_agg(tool ORDER BY ts,id) FILTER(WHERE type='tool.called'))[1] AS first_tool,(array_agg(tool ORDER BY ts DESC,id DESC) FILTER(WHERE type='tool.called'))[1] AS last_tool FROM events WHERE project_id=$1 AND session_id IS NOT NULL GROUP BY session_id) x WHERE s.project_id=$1 AND s.session_id=x.session_id",project).execute(&mut *tx).await?;
        }
        checked_query!(
            "UPDATE rollup_cursor SET received_at_watermark=$1 WHERE name='analytics'",
            cutoff
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn evaluate_alerts(&self) -> Result<()> {
        let now = Utc::now();
        let projects: Vec<Uuid> =
            checked_query_scalar!("SELECT id FROM projects WHERE deleted_at IS NULL")
                .fetch_all(&self.pool)
                .await?;
        for project in projects {
            let data = self.analytics_data(project, now).await?;
            let states = alert_states(&data, now);
            let mut tx = self.pool.begin().await?;
            checked_query!(
                "SELECT pg_advisory_xact_lock(hashtextextended($1,1397311237))",
                project.to_string()
            )
            .execute(&mut *tx)
            .await?;
            for (rule, state, details) in states {
                checked_query!("INSERT INTO alerts_log(project_id,rule,state,details) SELECT $1,$2,$3,$4 WHERE (SELECT state FROM alerts_log WHERE project_id=$1 AND rule=$2 ORDER BY ts DESC,id DESC LIMIT 1) IS DISTINCT FROM $3",project,rule,state,details).execute(&mut *tx).await?;
            }
            tx.commit().await?;
        }
        Ok(())
    }
    pub async fn analytics_alerts(&self, project: Uuid) -> Result<Value> {
        let settings: Value = checked_query_scalar!(
            "SELECT analytics_settings FROM projects WHERE id=$1",
            project
        )
        .fetch_one(&self.pool)
        .await?;
        let mut rules = settings["alerts"].as_array().cloned().unwrap_or_default();
        for rule in &mut rules {
            let id = rule["id"].as_str().unwrap_or("");
            let row=checked_query!("SELECT state,ts,details FROM alerts_log WHERE project_id=$1 AND rule=$2 ORDER BY ts DESC,id DESC LIMIT 1",project,id).fetch_optional(&self.pool).await?;
            rule["state"] = json!(row
                .as_ref()
                .map(|r| r.get::<String, _>("state"))
                .unwrap_or_else(|| "no_data".into()));
            rule["changed_at"] = json!(row.as_ref().map(|r| r.get::<DateTime<Utc>, _>("ts")));
            rule["details"] = row.map(|r| r.get("details")).unwrap_or(Value::Null);
        }
        Ok(json!({"rules":rules}))
    }
    pub async fn availability(&self, project: Uuid, w: Window) -> Result<Value> {
        let rows=checked_query!("SELECT ts,ok,latency_ms,advertised_tools FROM probes WHERE project_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts",project,w.from,w.to).fetch_all(&self.pool).await?;
        if rows.is_empty() {
            return Ok(Value::Null);
        }
        let last = rows.last().unwrap();
        let failures = rows.iter().rev().find(|r| !r.get::<bool, _>("ok"));
        Ok(
            json!({"uptime_pct":(rows.iter().filter(|r|r.get::<bool,_>("ok")).count() as f64/rows.len() as f64*10000.0).round()/100.0,"last_probe_at":last.get::<DateTime<Utc>,_>("ts"),"last_failure_at":failures.map(|r|r.get::<DateTime<Utc>,_>("ts")),"advertised_tools":last.get::<Option<i32>,_>("advertised_tools"),"healthy_tools":null,"probes":rows.iter().map(|r|json!({"t":r.get::<DateTime<Utc>,_>("ts"),"ok":r.get::<bool,_>("ok"),"latency_ms":r.get::<i64,_>("latency_ms")})).collect::<Vec<_>>()}),
        )
    }
}
fn alert_states(data: &Data, now: DateTime<Utc>) -> Vec<(String, String, Value)> {
    let f = Filters::default();
    let recent = data.selected(
        Window {
            from: now - Duration::hours(1),
            to: now,
        },
        &f,
    );
    let baseline = data.selected(
        Window {
            from: now - Duration::days(7) - Duration::hours(1),
            to: now - Duration::hours(1),
        },
        &f,
    );
    let m = Metrics::new(recent.iter().copied());
    let b = Metrics::new(baseline.iter().copied());
    data.settings["alerts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|rule| {
            let id = rule["id"].as_str().unwrap_or("");
            let threshold = rule["threshold"].as_f64();
            let result = match id {
                "volume" => (!b.calls.is_empty()).then(|| {
                    m.calls.len() as f64 > b.calls.len() as f64 / 168.0 * threshold.unwrap_or(3.0)
                }),
                "latency" => {
                    let es = data.selected(
                        Window {
                            from: now - Duration::hours(25),
                            to: now - Duration::hours(1),
                        },
                        &f,
                    );
                    let base = Metrics::new(es).latency(false);
                    m.latency(false)["p95"]
                        .as_f64()
                        .zip(base["p95"].as_f64())
                        .map(|(p, b)| p > b * threshold.unwrap_or(2.0))
                }
                "errors" => {
                    let es = data.selected(
                        Window {
                            from: now - Duration::minutes(15),
                            to: now,
                        },
                        &f,
                    );
                    let m = Metrics::new(es);
                    crate::analytics::rate(m.errors(), m.calls.len())
                        .map(|rate| rate > threshold.unwrap_or(5.0))
                }
                "destructive" => {
                    let known: BTreeSet<_> = baseline
                        .iter()
                        .filter_map(|e| e.client_name.as_ref())
                        .collect();
                    (!data.catalog.is_empty()).then(|| {
                        m.calls.iter().any(|e| {
                            e.tool.as_ref().is_some_and(|t| {
                                let a = data.catalog.get(t).unwrap_or(&Value::Null);
                                a["destructive"] == true
                                    || a["destructiveHint"] == true
                                    || a.as_array()
                                        .is_some_and(|a| a.iter().any(|v| v == "destructive"))
                            }) && e.client_name.as_ref().is_none_or(|c| !known.contains(c))
                        })
                    })
                }
                "burn" => {
                    let r = data.reliability(
                        Window {
                            from: now - Duration::hours(1),
                            to: now,
                        },
                        &f,
                    );
                    (!m.calls.is_empty()).then(|| {
                        r["slo"].as_array().unwrap().iter().any(|s| {
                            s["burn_rate_1h"]
                                .as_f64()
                                .is_some_and(|r| r > threshold.unwrap_or(6.0))
                        })
                    })
                }
                _ => None,
            };
            let state = if rule["enabled"] == false {
                "disabled"
            } else {
                match result {
                    Some(true) => "firing",
                    Some(false) => "ok",
                    None => "no_data",
                }
            };
            (
                id.into(),
                state.into(),
                json!({"evaluated_at":now,"delivery":"log_only"}),
            )
        })
        .collect()
}
