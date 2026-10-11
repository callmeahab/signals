use crate::{auth, App, Error};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, NaiveDate, Utc, Weekday};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use signals_store::{
    analytics::{Filters, Window},
    checked_query, checked_query_scalar,
};
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Debug)]
pub struct AnalyticsError(Error);
impl From<Error> for AnalyticsError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}
impl From<anyhow::Error> for AnalyticsError {
    fn from(e: anyhow::Error) -> Self {
        Self(Error::internal(e))
    }
}
impl From<sqlx::Error> for AnalyticsError {
    fn from(e: sqlx::Error) -> Self {
        Self(Error::internal(e))
    }
}
impl IntoResponse for AnalyticsError {
    fn into_response(self) -> Response {
        if self.0.status == StatusCode::BAD_REQUEST {
            (
                self.0.status,
                Json(json!({"error":"invalid_filter","message":self.0.message})),
            )
                .into_response()
        } else {
            self.0.into_response()
        }
    }
}
/// Settings validation has its own stable code; authentication/internal errors stay unchanged.
#[derive(Debug)]
pub struct SettingsError(Error);
impl From<Error> for SettingsError {
    fn from(error: Error) -> Self {
        Self(error)
    }
}
impl From<sqlx::Error> for SettingsError {
    fn from(error: sqlx::Error) -> Self {
        Self(Error::internal(error))
    }
}
impl IntoResponse for SettingsError {
    fn into_response(self) -> Response {
        if self.0.status == StatusCode::BAD_REQUEST {
            (
                self.0.status,
                Json(json!({"error":"invalid_settings","message":self.0.message})),
            )
                .into_response()
        } else {
            self.0.into_response()
        }
    }
}
type Result<T> = std::result::Result<T, AnalyticsError>;
fn bad(message: &str) -> AnalyticsError {
    Error::bad(message).into()
}
pub fn query(
    q: &BTreeMap<String, String>,
    now: DateTime<Utc>,
    digest: bool,
) -> Result<(Window, Filters)> {
    for key in q.keys() {
        if !matches!(
            key.as_str(),
            "range" | "from" | "to" | "client" | "tool" | "caller" | "transport"
        ) && !(digest && key == "week")
        {
            return Err(bad(&format!("Unknown filter: {key}")));
        }
    }
    let days = match q.get("range").map(String::as_str).unwrap_or("7d") {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        "90d" => 90,
        _ => return Err(bad("range must be 24h, 7d, 30d, or 90d")),
    };
    if q.contains_key("range") && (q.contains_key("from") || q.contains_key("to")) {
        return Err(bad("Use range or from/to, not both"));
    }
    let parse = |key: &str| -> Result<Option<DateTime<Utc>>> {
        q.get(key)
            .map(|v| {
                DateTime::parse_from_rfc3339(v)
                    .map(|t| t.with_timezone(&Utc))
                    .map_err(|_| bad("from/to must be RFC 3339 timestamps"))
            })
            .transpose()
    };
    if q.contains_key("from") != q.contains_key("to") {
        return Err(bad("from and to must be provided together"));
    }
    let to = parse("to")?.unwrap_or(now);
    let from = parse("from")?.unwrap_or(to - Duration::days(days));
    let mut window = Window { from, to };
    if let Some(week) = q.get("week") {
        if q.contains_key("range") || q.contains_key("from") {
            return Err(bad("week cannot be combined with range or from/to"));
        }
        let (year, week) = week
            .split_once("-W")
            .ok_or_else(|| bad("week must use ISO YYYY-Www"))?;
        let start = NaiveDate::from_isoywd_opt(
            year.parse().map_err(|_| bad("Invalid week"))?,
            week.parse().map_err(|_| bad("Invalid week"))?,
            Weekday::Mon,
        )
        .ok_or_else(|| bad("Invalid ISO week"))?
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
        window = Window {
            from: start,
            to: start + Duration::days(7),
        };
    }
    if window.from >= window.to || window.to - window.from > Duration::days(400) {
        return Err(bad("Invalid time window (maximum 400 days)"));
    }
    for key in ["client", "tool", "caller", "transport"] {
        if q.get(key).is_some_and(|s| s.is_empty() || s.len() > 1024) {
            return Err(bad("Filters must be nonempty and at most 1024 bytes"));
        }
    }
    Ok((
        window,
        Filters {
            client: q.get("client").cloned(),
            tool: q.get("tool").cloned(),
            caller: q.get("caller").cloned(),
            transport: q.get("transport").cloned(),
        },
    ))
}
pub async fn read(
    State(app): State<App>,
    Path((project, name)): Path<(Uuid, String)>,
    headers: HeaderMap,
    Query(q): Query<BTreeMap<String, String>>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, project, false).await?;
    if !matches!(
        name.as_str(),
        "overview"
            | "adoption"
            | "tools"
            | "reliability"
            | "cost"
            | "protocol"
            | "digest"
            | "alerts"
    ) {
        return Err(Error::not_found("Analytics route not found").into());
    }
    let now = Utc::now();
    let (w, f) = query(&q, now, name == "digest")?;
    let mut result = if name == "alerts" {
        app.store.analytics_alerts(project).await?
    } else {
        let data = app.store.analytics_data(project, w.to).await?;
        let mut value = match name.as_str() {
            "overview" => data.overview(w, &f),
            "adoption" => data.adoption(w, &f),
            "tools" => data.tools(w, &data.selected(w, &f)),
            "reliability" => {
                let mut v = data.reliability(w, &f);
                v["availability"] = app.store.availability(project, w).await?;
                v
            }
            "cost" => data.cost(&data.selected(w, &f)),
            "protocol" => data.protocol(&data.selected(w, &f)),
            "digest" => {
                tracing::info!(%project,from=%w.from,to=%w.to,"weekly digest computed; delivery is log-only");
                data.digest(w, &f)
            }
            _ => unreachable!(),
        };
        if !w.exact()
            && f.client.is_none()
            && f.tool.is_none()
            && f.caller.is_none()
            && f.transport.is_none()
            && matches!(name.as_str(), "overview" | "tools" | "digest")
        {
            let hist = app.store.analytics_histograms(project, w, &data).await?;
            if name == "overview" {
                if let Some(latency) = hist.get(&None) {
                    value["tiles"]["latency"] = latency.clone();
                }
                let previous = app
                    .store
                    .analytics_histograms(project, w.previous(), &data)
                    .await?;
                value["tiles"]["latency"]["prev_p95"] = previous
                    .get(&None)
                    .map(|v| v["p95"].clone())
                    .unwrap_or(Value::Null);
            } else if let Some(tools) = value["tools"].as_array_mut() {
                for tool in tools {
                    if let Some(latency) = tool["tool"]
                        .as_str()
                        .and_then(|t| hist.get(&Some(t.to_owned())))
                    {
                        if name == "tools" {
                            tool["latency"] = latency.clone();
                        } else {
                            tool["p95"] = latency["p95"].clone();
                        }
                    }
                }
            }
        }
        value
    };
    result["range"] = w.json();
    result["generated_at"] = json!(now);
    Ok(Json(result))
}
pub async fn timeline(
    State(app): State<App>,
    Path((project, session)): Path<(Uuid, String)>,
    headers: HeaderMap,
    Query(q): Query<BTreeMap<String, String>>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, project, false).await?;
    let now = Utc::now();
    let (w, f) = query(&q, now, false)?;
    let data = app
        .store
        .analytics_data(project, DateTime::<Utc>::MAX_UTC)
        .await?;
    let events: Vec<_> = data
        .events
        .iter()
        .filter(|e| e.session_id.as_ref() == Some(&session))
        .collect();
    if events.is_empty() {
        return Err(Error::not_found("Session not found").into());
    }
    let mut argument_hashes = BTreeMap::new();
    for row in checked_query!("SELECT ts,id,attrs->'args' AS args FROM events WHERE project_id=$1 AND session_id=$2 AND attrs ? 'args'",project,&session).fetch_all(&app.store.pool).await? {
        let args:Value=row.get("args");argument_hashes.insert((row.get::<DateTime<Utc>,_>("ts"),row.get::<Uuid,_>("id")),hex::encode(Sha256::digest(serde_json::to_vec(&args).map_err(Error::internal)?)));
    }
    let start = events
        .iter()
        .find(|e| e.event_type == "session.started")
        .unwrap_or(&events[0])
        .ts;
    let end = events.iter().find(|e| e.event_type == "session.ended");
    let client = events.iter().find_map(|e| e.client.clone());
    let identity = events.iter().find_map(|e| e.identity());
    let transport = events.iter().find_map(|e| e.attrs["transport"].as_str());
    let selected = data.selected(w, &f);
    let timeline:Vec<_>=selected.into_iter().filter(|e|e.session_id.as_ref()==Some(&session)).map(|e|{let mut v=json!({"id":e.id,"ts":e.ts,"offset_ms":(e.ts-start).num_milliseconds(),"type":e.event_type,"duration_ms":e.duration_ms,"is_error":e.is_error,"error_kind":e.attrs["error_kind"],"output_kinds":e.attrs["output_kinds"],"input_bytes":e.attrs["input_bytes"],"output_bytes":e.attrs["output_bytes"],"args_hash":argument_hashes.get(&(e.ts,e.id))});for k in ["tool","method","uri","prompt"]{if let Some(value)=e.attrs.get(k){v[k]=value.clone();}}v}).collect();
    Ok(Json(
        json!({"range":w.json(),"generated_at":now,"session":{"session_id":session,"client":client,"identity":identity.map(|(kind,key)|json!({"kind":kind,"key":key})),"transport":transport,"reason":end.and_then(|e|e.attrs.get("reason")),"duration_ms":end.map(|e|e.duration_ms.map(i64::from).unwrap_or((e.ts-start).num_milliseconds()))},"events":timeline}),
    ))
}
pub fn validate_settings(input: &Value) -> crate::Result<()> {
    let Some(object) = input.as_object() else {
        return Err(Error::bad("Settings must be an object"));
    };
    for (key, value) in object {
        match key.as_str() {
            "slo_classes" => {
                if !value
                    .as_object()
                    .is_some_and(|m| m.values().all(|v| v == "read" || v == "mutate"))
                {
                    return Err(Error::bad("slo_classes values must be read or mutate"));
                }
            }
            "slo_targets" => {
                if !value.as_object().is_some_and(|m| {
                    m.iter().all(|(k, v)| {
                        matches!(k.as_str(), "read" | "mutate")
                            && v.as_f64().is_some_and(|n| n > 0.0 && n < 100.0)
                    })
                }) {
                    return Err(Error::bad(
                        "SLO targets must be between 0 and 100, exclusive",
                    ));
                }
            }
            "token_divisor" => {
                if !value
                    .as_f64()
                    .is_some_and(|v| v.is_finite() && v > 0.0 && v <= 1000.0)
                {
                    return Err(Error::bad(
                        "token_divisor must be greater than 0 and at most 1000",
                    ));
                }
            }
            "digest" => {
                if !value.as_object().is_some_and(|m| {
                    m.iter().all(|(k, v)| match k.as_str() {
                        "enabled" => v.is_boolean(),
                        "recipient" => {
                            v.is_null()
                                || v.as_str()
                                    .is_some_and(|v| v.contains('@') && v.len() <= 320)
                        }
                        "webhook_url" => v.is_null() || v.as_str().is_some_and(valid_url),
                        _ => false,
                    })
                }) {
                    return Err(Error::bad("Invalid digest settings"));
                }
            }
            "alerts" => validate_rules(value)?,
            "probe_url" => {
                if !value.is_null() && !value.as_str().is_some_and(valid_url) {
                    return Err(Error::bad("probe_url must be an HTTP(S) URL or null"));
                }
            }
            "probe_key" => {
                if !value.is_null()
                    && !value.as_str().is_some_and(|v| {
                        !v.is_empty() && v.len() <= 4096 && !v.contains(['\r', '\n'])
                    })
                {
                    return Err(Error::bad("Invalid probe key"));
                }
            }
            _ => return Err(Error::bad("Unknown analytics setting")),
        }
    }
    Ok(())
}
fn valid_url(v: &str) -> bool {
    url::Url::parse(v).is_ok_and(|u| {
        matches!(u.scheme(), "http" | "https")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    })
}
fn validate_rules(rules: &Value) -> crate::Result<()> {
    let Some(rules) = rules.as_array() else {
        return Err(Error::bad("alerts must be an array"));
    };
    let mut ids = std::collections::BTreeSet::new();
    for rule in rules {
        let Some(id) = rule["id"].as_str() else {
            return Err(Error::bad("Rule id required"));
        };
        if !matches!(id, "volume" | "latency" | "errors" | "destructive" | "burn")
            || !ids.insert(id)
            || !rule["enabled"].is_boolean()
            || rule
                .get("threshold")
                .is_some_and(|t| !t.as_f64().is_some_and(|v| v > 0.0 && v.is_finite()))
        {
            return Err(Error::bad("Invalid alert rule"));
        }
    }
    Ok(())
}
pub async fn update_rules(
    State(app): State<App>,
    Path(project): Path<Uuid>,
    headers: HeaderMap,
    Json(value): Json<Value>,
) -> std::result::Result<Json<Value>, SettingsError> {
    auth::read(&app, &headers, project, true).await?;
    let rules = value.get("rules").unwrap_or(&value);
    validate_rules(rules)?;
    checked_query!("UPDATE projects SET analytics_revision=analytics_revision+1,analytics_settings=jsonb_set(analytics_settings,'{alerts}',$2) WHERE id=$1",project,rules).execute(&app.store.pool).await?;
    Ok(Json(json!({"rules":rules})))
}
pub async fn save_settings(
    connection: &mut sqlx::PgConnection,
    project: Uuid,
    input: Value,
) -> crate::Result<Value> {
    validate_settings(&input)?;
    // Merge nested maps in SQL under the row lock, avoiding lost updates between owners.
    let result:Value=checked_query_scalar!("UPDATE projects SET analytics_revision=analytics_revision+1,analytics_settings=analytics_settings || $2::jsonb || jsonb_build_object('slo_classes',coalesce(analytics_settings->'slo_classes','{}'::jsonb)||coalesce($2::jsonb->'slo_classes','{}'::jsonb),'slo_targets',coalesce(analytics_settings->'slo_targets','{}'::jsonb)||coalesce($2::jsonb->'slo_targets','{}'::jsonb),'digest',coalesce(analytics_settings->'digest','{}'::jsonb)||coalesce($2::jsonb->'digest','{}'::jsonb)) WHERE id=$1 RETURNING analytics_settings-'probe_key' AS settings",project,input).fetch_one(connection).await?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_reject_unknown() {
        let now = Utc::now();
        assert_eq!(
            query(&BTreeMap::new(), now, false).unwrap().0.to
                - query(&BTreeMap::new(), now, false).unwrap().0.from,
            Duration::days(7)
        );
        assert!(query(&BTreeMap::from([("foo".into(), "bar".into())]), now, false).is_err());
        assert!(query(
            &BTreeMap::from([("from".into(), now.to_rfc3339())]),
            now,
            false
        )
        .is_err());
        assert!(query(
            &BTreeMap::from([("week".into(), "2026-W41".into())]),
            now,
            true
        )
        .is_ok());
    }
}
