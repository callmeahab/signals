use crate::{auth, App, Error, Result};
use axum::{
    body::{Body, Bytes},
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{
        sse::{Event as SseEvent, KeepAlive},
        IntoResponse, Response, Sse,
    },
    Json,
};
use chrono::{DateTime, Duration, Utc};
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::{json, Value};
use signals_core::{validate_batch, Batch, MAX_EVENTS};
use signals_store::{checked_query, checked_query_as, checked_query_scalar};
use signals_store::{hash, random_secret, Project};
use std::{convert::Infallible, net::SocketAddr, sync::atomic::Ordering};
use uuid::Uuid;

pub async fn ingest(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse> {
    let key = auth::key(&app, &headers, "ingest").await?;
    let batch: Batch =
        serde_json::from_slice(&body).map_err(|_| Error::bad("Invalid batch envelope"))?;
    if batch.events.len() > MAX_EVENTS {
        return Err(Error {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "A batch can contain at most 1000 events".into(),
        });
    }
    let events = batch.events.len() as i64;
    let bytes = body.len() as i64;
    if events > i64::from(key.project.rate_events_per_min) || bytes > key.project.rate_bytes_per_min
    {
        return Err(Error {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "Project key rate limit exceeded".into(),
        });
    }
    let limited=checked_query!("INSERT INTO rate_windows(key_id,window_start,events,bytes) VALUES($1,date_trunc('minute',clock_timestamp()),$2,$3) ON CONFLICT(key_id,window_start) DO UPDATE SET events=rate_windows.events+EXCLUDED.events,bytes=rate_windows.bytes+EXCLUDED.bytes WHERE rate_windows.events+EXCLUDED.events<=$4 AND rate_windows.bytes+EXCLUDED.bytes<=$5 RETURNING events" ,key.id,events,bytes,i64::from(key.project.rate_events_per_min),key.project.rate_bytes_per_min).fetch_optional(&app.store.pool).await?;
    if limited.is_none() {
        return Err(Error {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "Project key rate limit exceeded".into(),
        });
    }
    app.counters.skew_seconds.store(
        (Utc::now() - batch.sent_at).num_seconds(),
        Ordering::Relaxed,
    );
    let indices: std::collections::HashMap<String, usize> = batch
        .events
        .iter()
        .enumerate()
        .filter_map(|(i, e)| e["id"].as_str().map(|id| (id.to_owned(), i)))
        .collect();
    let (valid, mut rejected) =
        validate_batch(batch.events, Utc::now(), key.project.retention_days);
    let network = auth::network_identity(&key.salt, &peer.ip().to_string());
    let enriched = valid
        .into_iter()
        .map(|e| {
            let identity = if let Some(id) = e.caller.as_ref().and_then(|c| c.key_id.as_ref()) {
                ("key".to_owned(), id.clone(), id.clone())
            } else if let Some(id) = e.caller.as_ref().and_then(|c| c.subject.as_ref()) {
                ("subject".to_owned(), id.clone(), id.clone())
            } else {
                (
                    "network".into(),
                    format!("{network}:{}", user_agent_family(&headers)),
                    format!("Network {}", &network[..8]),
                )
            };
            (e, identity.0, identity.1, identity.2)
        })
        .collect();
    let outcome = app.event_store.ingest(key.project.id, enriched).await?;
    for (id, reason) in outcome.rejected {
        rejected.push(signals_core::Rejected {
            index: indices[&id.to_string()],
            id: Some(id.to_string()),
            reason,
        });
    }
    let accepted = outcome.accepted;
    let duplicates = outcome.duplicates;
    {
        let mut reasons = app.counters.rejections.lock().unwrap();
        for r in &rejected {
            *reasons.entry(r.reason.clone()).or_default() += 1;
        }
    }
    app.counters.batches.fetch_add(1, Ordering::Relaxed);
    app.counters
        .accepted
        .fetch_add(accepted as u64, Ordering::Relaxed);
    app.counters
        .rejected
        .fetch_add(rejected.len() as u64, Ordering::Relaxed);
    app.counters
        .duplicates
        .fetch_add(duplicates as u64, Ordering::Relaxed);
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"accepted":accepted,"duplicates":duplicates,"rejected":rejected})),
    ))
}
fn user_agent_family(headers: &HeaderMap) -> &'static str {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ua.contains("claude") {
        "claude"
    } else if ua.contains("cursor") {
        "cursor"
    } else if ua.contains("python") {
        "python"
    } else if ua.contains("node") || ua.contains("undici") {
        "node"
    } else if ua.contains("curl") {
        "curl"
    } else if ua.contains("mozilla") {
        "browser"
    } else {
        "unknown"
    }
}
#[utoipa::path(get,path="/v1/whoami",responses((status=200,description="Success",body=crate::openapi::Identity), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("ingestKey"=[])))]
pub async fn whoami(State(app): State<App>, headers: HeaderMap) -> Result<Json<Value>> {
    let k = auth::key(&app, &headers, "ingest").await?;
    Ok(Json(json!({"project":k.project,"key_id":k.id})))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct Login {
    email: String,
    password: String,
}
#[utoipa::path(post,path="/v1/auth/login",request_body=Login,responses((status=200,description="Success",body=crate::openapi::Account), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")))]
pub async fn login(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Result<Response> {
    auth::check_origin(&app, &headers)?;
    if input.email.len() > 254 || input.password.len() > 1024 {
        return Err(Error::bad("Invalid credentials"));
    }
    {
        let mut limits = app.login_limits.lock().await;
        let now = std::time::Instant::now();
        limits.retain(|_, (start, _)| now.duration_since(*start).as_secs() < 60);
        let entry = limits
            .entry(hash(&peer.ip().to_string()))
            .or_insert((now, 0));
        entry.1 += 1;
        if entry.1 > 10 {
            return Err(Error {
                status: StatusCode::TOO_MANY_REQUESTS,
                message: "Too many sign-in attempts".into(),
            });
        }
    }
    let u = auth::verify_login(&app, &input.email, &input.password).await?;
    let secret = random_secret();
    checked_query!("INSERT INTO dashboard_sessions(secret_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')" ,hash(&secret),u.id).execute(&app.store.pool).await?;
    let mut response = Json(auth::account(&app, u).await?).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        auth::cookie(&app, &auth::signed_cookie(&app, &secret), 604800)
            .parse()
            .unwrap(),
    );
    Ok(response)
}
#[utoipa::path(post,path="/v1/auth/logout",responses((status=204,description="Success"), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("session"=[])))]
pub async fn logout(State(app): State<App>, headers: HeaderMap) -> Result<Response> {
    auth::check_origin(&app, &headers)?;
    if let Some(secret) = auth::session_secret(&app, &headers) {
        checked_query!(
            "DELETE FROM dashboard_sessions WHERE secret_hash=$1",
            hash(&secret)
        )
        .execute(&app.store.pool)
        .await?;
    }
    let mut r = StatusCode::NO_CONTENT.into_response();
    r.headers_mut().insert(
        header::SET_COOKIE,
        auth::cookie(&app, "", 0).parse().unwrap(),
    );
    Ok(r)
}
#[utoipa::path(get,path="/v1/auth/me",responses((status=200,description="Success",body=crate::openapi::Account), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn me(State(app): State<App>, headers: HeaderMap) -> Result<Json<Value>> {
    let u = auth::user(&app, &headers).await?;
    Ok(Json(auth::account(&app, u).await?))
}
#[derive(Default, Deserialize, utoipa::ToSchema)]
pub struct RangeQuery {
    range: Option<String>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    bucket: Option<String>,
    metric: Option<String>,
}
fn range(q: &RangeQuery) -> Result<(DateTime<Utc>, DateTime<Utc>)> {
    let to = q.to.unwrap_or_else(Utc::now);
    let days = match q.range.as_deref().unwrap_or("24h") {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        _ => return Err(Error::bad("Range must be 24h, 7d, or 30d")),
    };
    let from = q.from.unwrap_or(to - Duration::days(days));
    if from >= to || to - from > Duration::days(400) {
        return Err(Error::bad("Invalid time range (maximum 400 days)"));
    }
    Ok((from, to))
}
#[utoipa::path(get,path="/v1/projects/{project}/overview",params(("project"=uuid::Uuid,Path,description="Project UUID"),("range"=Option<String>,Query,description="24h, 7d or 30d"),("from"=Option<chrono::DateTime<Utc>>,Query),("to"=Option<chrono::DateTime<Utc>>,Query)),responses((status=200,description="Success",body=crate::openapi::Overview), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn overview(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let (from, to) = range(&q)?;
    Ok(Json(app.event_store.overview(p, from, to).await?))
}
#[utoipa::path(get,path="/v1/projects/{project}/timeseries",params(("project"=uuid::Uuid,Path,description="Project UUID"),("range"=Option<String>,Query,description="24h, 7d or 30d"),("from"=Option<chrono::DateTime<Utc>>,Query),("to"=Option<chrono::DateTime<Utc>>,Query),("bucket"=Option<String>,Query,description="1h or 1d"),("metric"=Option<String>,Query,description="Optional single metric; omitting it returns complete points")),responses((status=200,description="Success",body=crate::openapi::Timeseries), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn timeseries(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let (from, to) = range(&q)?;
    let daily = match q.bucket.as_deref().unwrap_or("1h") {
        "1h" => false,
        "1d" => true,
        _ => return Err(Error::bad("Bucket must be 1h or 1d")),
    };
    let value = app.event_store.timeseries(p, from, to, daily).await?;
    if let Some(metric) = q.metric {
        let name = match metric.as_str() {
            "requests" | "errors" | "sessions" | "callers" | "latency_p50" | "latency_p95"
            | "latency_p99" => metric,
            _ => return Err(Error::bad("Invalid metric")),
        };
        Ok(Json(json!(value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| json!({"ts":v["ts"],"value":v[&name]}))
            .collect::<Vec<_>>())))
    } else {
        Ok(Json(value))
    }
}
#[utoipa::path(get,path="/v1/projects/{project}/tools",params(("project"=uuid::Uuid,Path,description="Project UUID"),("range"=Option<String>,Query,description="24h, 7d or 30d"),("from"=Option<chrono::DateTime<Utc>>,Query),("to"=Option<chrono::DateTime<Utc>>,Query)),responses((status=200,description="Success",body=[crate::openapi::Tool]), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn tools(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let (from, to) = range(&q)?;
    Ok(Json(app.event_store.tools(p, from, to).await?))
}
#[utoipa::path(get,path="/v1/projects/{project}/callers",params(("project"=uuid::Uuid,Path,description="Project UUID"),("range"=Option<String>,Query,description="24h, 7d or 30d"),("from"=Option<chrono::DateTime<Utc>>,Query),("to"=Option<chrono::DateTime<Utc>>,Query)),responses((status=200,description="Success",body=[crate::openapi::Caller]), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn callers(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let (from, to) = range(&q)?;
    Ok(Json(app.event_store.callers(p, from, to).await?))
}
#[derive(Default, Deserialize, utoipa::ToSchema)]
pub struct Filter {
    cursor: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    tool: Option<String>,
    q: Option<String>,
    since: Option<DateTime<Utc>>,
    caller: Option<String>,
    client: Option<String>,
    is_error: Option<bool>,
}
#[utoipa::path(get,path="/v1/projects/{project}/events",params(("project"=uuid::Uuid,Path,description="Project UUID"),("cursor"=Option<String>,Query),("type"=Option<String>,Query),("tool"=Option<String>,Query),("caller"=Option<String>,Query),("q"=Option<String>,Query),("since"=Option<chrono::DateTime<Utc>>,Query),("is_error"=Option<bool>,Query)),responses((status=200,description="Success",body=crate::openapi::EventPage), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn events(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<Filter>,
) -> Result<Json<Value>> {
    let project = auth::read(&app, &headers, p, false).await?;
    let oldest = Utc::now() - Duration::days(i64::from(project.retention_days));
    Ok(Json(
        app.event_store
            .events(
                p,
                signals_store::read::EventQuery {
                    kind: q.kind.as_deref(),
                    tool: q.tool.as_deref(),
                    q: q.q.as_deref(),
                    caller: q
                        .caller
                        .as_deref()
                        .map(str::parse)
                        .transpose()
                        .map_err(|_| Error::bad("Invalid caller"))?,
                    is_error: q.is_error,
                    cursor: auth::parse_event_cursor(q.cursor.as_deref())?,
                    since: q.since.unwrap_or(oldest).max(oldest),
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/v1/projects/{project}/sessions",params(("project"=uuid::Uuid,Path,description="Project UUID"),("cursor"=Option<String>,Query),("caller"=Option<String>,Query),("client"=Option<String>,Query)),responses((status=200,description="Success",body=crate::openapi::SessionPage), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn sessions(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<Filter>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let cursor = q
        .cursor
        .as_deref()
        .map(|v| {
            let (ts, id) = v
                .split_once('|')
                .ok_or_else(|| Error::bad("Invalid cursor"))?;
            Ok::<_, Error>((
                ts.parse()
                    .map_err(|_| Error::bad("Invalid cursor timestamp"))?,
                id.to_owned(),
            ))
        })
        .transpose()?;
    let caller = q
        .caller
        .as_deref()
        .map(str::parse)
        .transpose()
        .map_err(|_| Error::bad("Invalid caller"))?;
    Ok(Json(
        app.event_store
            .sessions(p, cursor, caller, q.client.as_deref())
            .await?,
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ToolRangeQuery {
    #[serde(flatten)]
    range: RangeQuery,
    tool: String,
}
#[utoipa::path(get,path="/v1/projects/{project}/tool-timeseries",params(("project"=uuid::Uuid,Path,description="Project UUID"),("range"=Option<String>,Query,description="24h, 7d or 30d"),("from"=Option<chrono::DateTime<Utc>>,Query),("to"=Option<chrono::DateTime<Utc>>,Query),("bucket"=Option<String>,Query,description="1h or 1d"),("tool"=String,Query)),responses((status=200,description="Success",body=[crate::openapi::Point]), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn tool_timeseries(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<ToolRangeQuery>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let (from, to) = range(&q.range)?;
    if !matches!(q.range.bucket.as_deref(), None | Some("1h") | Some("1d")) {
        return Err(Error::bad("Bucket must be 1h or 1d"));
    }
    Ok(Json(
        app.event_store
            .tool_timeseries(
                p,
                &q.tool,
                from,
                to,
                q.range.bucket.as_deref() == Some("1d"),
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/v1/projects/{project}/callers/{caller}/timeseries",params(("project"=uuid::Uuid,Path,description="Project UUID"),("caller"=i64,Path),("range"=Option<String>,Query,description="24h, 7d or 30d"),("from"=Option<chrono::DateTime<Utc>>,Query),("to"=Option<chrono::DateTime<Utc>>,Query)),responses((status=200,description="Success",body=[crate::openapi::Point]), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn caller_timeseries(
    State(app): State<App>,
    Path((p, caller)): Path<(Uuid, i64)>,
    headers: HeaderMap,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    let (from, to) = range(&q)?;
    Ok(Json(
        app.event_store
            .caller_timeseries(p, caller, from, to)
            .await?,
    ))
}
#[utoipa::path(get,path="/v1/projects/{project}/sessions/{session}/events",params(("project"=uuid::Uuid,Path,description="Project UUID"),("session"=String,Path),("cursor"=Option<String>,Query)),responses((status=200,description="Success",body=crate::openapi::EventPage), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn session_events(
    State(app): State<App>,
    Path((p, session)): Path<(Uuid, String)>,
    headers: HeaderMap,
    Query(q): Query<Filter>,
) -> Result<Json<Value>> {
    let project = auth::read(&app, &headers, p, false).await?;
    let cursor = auth::parse_event_cursor(q.cursor.as_deref())?;
    Ok(Json(
        app.event_store
            .session_events(
                p,
                &session,
                Utc::now() - Duration::days(i64::from(project.retention_days)),
                cursor,
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/v1/projects/{project}/keys",params(("project"=uuid::Uuid,Path,description="Project UUID")),responses((status=200,description="Success",body=[crate::openapi::KeyDocument]), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn keys(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, false).await?;
    Ok(Json(json!(app.store.keys(p).await?)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct KeyInput {
    label: String,
    scopes: Vec<String>,
}
fn validate_key(input: &KeyInput) -> Result<()> {
    if input.label.is_empty()
        || input.label.len() > 100
        || input.scopes.is_empty()
        || !input.scopes.iter().all(|s| s == "ingest" || s == "read")
    {
        Err(Error::bad("Invalid key label or scopes"))
    } else {
        Ok(())
    }
}
#[utoipa::path(post,path="/v1/projects/{project}/keys",params(("project"=uuid::Uuid,Path,description="Project UUID")),request_body=KeyInput,responses((status=200,description="Success",body=crate::openapi::MintedKey), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("session"=[])))]
pub async fn create_key(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<KeyInput>,
) -> Result<Json<Value>> {
    auth::read(&app, &headers, p, true).await?;
    validate_key(&input)?;
    let (key, secret) = app.store.create_key(p, &input.label, input.scopes).await?;
    Ok(Json(json!({"key":key,"secret":secret})))
}
#[utoipa::path(delete,path="/v1/projects/{project}/keys/{key}",params(("project"=uuid::Uuid,Path,description="Project UUID"),("key"=uuid::Uuid,Path)),responses((status=204,description="Success"), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("session"=[])))]
pub async fn revoke_key(
    State(app): State<App>,
    Path((p, k)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    auth::read(&app, &headers, p, true).await?;
    let n = checked_query!(
        "UPDATE api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE project_id=$1 AND id=$2",
        p,
        k
    )
    .execute(&app.store.pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(Error::not_found("Key not found"));
    }
    app.key_cache.lock().await.retain(|_, v| v.auth.id != k);
    checked_query!("SELECT pg_notify('signals_keys',$1)", k.to_string())
        .execute(&app.store.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct Settings {
    pub name: String,
    pub retention_days: i32,
    pub rate_events_per_min: i32,
    pub rate_bytes_per_min: i64,
}
#[utoipa::path(patch,path="/v1/projects/{project}",params(("project"=uuid::Uuid,Path,description="Project UUID")),request_body=Settings,responses((status=200,description="Success",body=crate::openapi::ProjectDocument), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("session"=[])))]
pub async fn update_project(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<Settings>,
) -> Result<Json<Project>> {
    auth::read(&app, &headers, p, true).await?;
    if input.name.trim().is_empty()
        || input.name.len() > 100
        || !(1..=365).contains(&input.retention_days)
        || !(1..=10_000_000).contains(&input.rate_events_per_min)
        || input.rate_bytes_per_min < 1
    {
        return Err(Error::bad("Invalid project settings"));
    }
    let p=checked_query_as!("UPDATE projects SET name=$2,retention_days=$3,rate_events_per_min=$4,rate_bytes_per_min=$5 WHERE id=$1 RETURNING id,tenant_id,slug,name,retention_days,rate_events_per_min,rate_bytes_per_min" ,p,input.name,input.retention_days,input.rate_events_per_min,input.rate_bytes_per_min).fetch_one(&app.store.pool).await?;
    Ok(Json(p))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct TenantInput {
    pub slug: String,
    pub name: String,
    pub external_id: Option<String>,
}
fn validate_name(slug: &str, name: &str) -> Result<()> {
    if slug.is_empty()
        || slug.len() > 64
        || !slug
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || name.is_empty()
        || name.len() > 100
    {
        Err(Error::bad("Invalid slug or name"))
    } else {
        Ok(())
    }
}
#[utoipa::path(post,path="/v1/admin/tenants",request_body=TenantInput,responses((status=200,description="Success",body=crate::openapi::CreatedResource), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("adminToken"=[])))]
pub async fn create_tenant(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<TenantInput>,
) -> Result<Json<Value>> {
    auth::admin(&app, &headers)?;
    validate_name(&input.slug, &input.name)?;
    Ok(Json(
        json!({"id":app.store.tenant(&input.slug,&input.name,input.external_id.as_deref()).await?}),
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ProjectInput {
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
}
#[utoipa::path(post,path="/v1/admin/projects",request_body=ProjectInput,responses((status=200,description="Success",body=crate::openapi::ProjectDocument), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("adminToken"=[])))]
pub async fn create_project(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<ProjectInput>,
) -> Result<Json<Project>> {
    auth::admin(&app, &headers)?;
    validate_name(&input.slug, &input.name)?;
    Ok(Json(
        app.store
            .project(input.tenant_id, &input.slug, &input.name)
            .await?,
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct AdminKeyInput {
    project_id: Uuid,
    #[serde(flatten)]
    key: KeyInput,
}
#[utoipa::path(post,path="/v1/admin/keys",request_body=AdminKeyInput,responses((status=200,description="Success",body=crate::openapi::MintedKey), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("adminToken"=[])))]
pub async fn admin_key(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<AdminKeyInput>,
) -> Result<Json<Value>> {
    auth::admin(&app, &headers)?;
    validate_key(&input.key)?;
    let (key, secret) = app
        .store
        .create_key(input.project_id, &input.key.label, input.key.scopes)
        .await?;
    Ok(Json(json!({"key":key,"secret":secret})))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct UserInput {
    pub tenant_id: Uuid,
    pub email: String,
    pub password: String,
    pub role: String,
}
#[utoipa::path(post,path="/v1/admin/users",request_body=UserInput,responses((status=200,description="Success",body=crate::openapi::CreatedResource), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("adminToken"=[])))]
pub async fn create_user(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<UserInput>,
) -> Result<Json<Value>> {
    auth::admin(&app, &headers)?;
    if !["owner", "viewer"].contains(&input.role.as_str())
        || !input.email.contains('@')
        || input.email.len() > 254
    {
        return Err(Error::bad("Invalid user email or role"));
    }
    let hash = tokio::task::spawn_blocking(move || auth::password_hash(&input.password))
        .await
        .map_err(Error::internal)?
        .map_err(|_| Error::bad("Password must have at least 12 characters"))?;
    Ok(Json(
        json!({"id":app.store.create_user(input.tenant_id,&input.email,&hash,&input.role).await?}),
    ))
}
#[utoipa::path(get,path="/v1/projects/{project}/users",params(("project"=uuid::Uuid,Path,description="Project UUID")),responses((status=200,description="Success",body=[crate::openapi::UserDocument]), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn project_users(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let p = auth::read(&app, &headers, p, true).await?;
    let users: Vec<auth::User> = checked_query_as!(
        "SELECT id,tenant_id,email,role FROM users WHERE tenant_id=$1 ORDER BY email",
        p.tenant_id
    )
    .fetch_all(&app.store.pool)
    .await?;
    Ok(Json(json!(users)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ProjectUserInput {
    email: String,
    password: String,
    role: String,
}
#[utoipa::path(post,path="/v1/projects/{project}/users",params(("project"=uuid::Uuid,Path,description="Project UUID")),request_body=ProjectUserInput,responses((status=200,description="Success",body=crate::openapi::UserDocument), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("session"=[])))]
pub async fn project_create_user(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<ProjectUserInput>,
) -> Result<Json<Value>> {
    let p = auth::read(&app, &headers, p, true).await?;
    if !["owner", "viewer"].contains(&input.role.as_str())
        || !input.email.contains('@')
        || input.email.len() > 254
        || input.password.len() > 1024
    {
        return Err(Error::bad("Invalid email, role, or password"));
    }
    let hash = tokio::task::spawn_blocking(move || auth::password_hash(&input.password))
        .await
        .map_err(Error::internal)?
        .map_err(|_| Error::bad("Password must have at least 12 characters"))?;
    let exists: bool = checked_query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)",
        input.email.to_lowercase()
    )
    .fetch_one(&app.store.pool)
    .await?;
    if exists {
        return Err(Error::bad("Email is already in use"));
    }
    let id = app
        .store
        .create_user(p.tenant_id, &input.email, &hash, &input.role)
        .await?;
    Ok(Json(
        json!({"id":id,"tenant_id":p.tenant_id,"email":input.email.to_lowercase(),"role":input.role}),
    ))
}
pub async fn ready(State(app): State<App>) -> Result<&'static str> {
    if !app.store.migrations_current().await? {
        return Err(Error {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "Database migrations are not current".into(),
        });
    }
    Ok("ready")
}
#[utoipa::path(get,path="/v1/admin/health",responses((status=200,description="Success",body=crate::openapi::Health), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("adminToken"=[])))]
pub async fn admin_health(State(app): State<App>, headers: HeaderMap) -> Result<Json<Value>> {
    auth::admin(&app, &headers)?;
    Ok(Json(health_data(&app).await?))
}
async fn health_data(app: &App) -> Result<Value> {
    let lag:f64=checked_query_scalar!("SELECT extract(epoch from clock_timestamp()-received_at_watermark)::float8 FROM rollup_cursor WHERE name='hourly'").fetch_one(&app.store.pool).await?;
    let partitions: i64 = checked_query_scalar!(
        "SELECT count(*) FROM pg_inherits WHERE inhparent='events'::regclass"
    )
    .fetch_one(&app.store.pool)
    .await?;
    let default_rows: i64 = checked_query_scalar!("SELECT count(*) FROM events_default")
        .fetch_one(&app.store.pool)
        .await?;
    Ok(
        json!({"rollup_lag_seconds":lag,"partitions":partitions,"default_partition_rows":default_rows,"db_pool_size":app.store.pool.size(),"db_pool_idle":app.store.pool.num_idle()}),
    )
}
pub async fn metrics(State(app): State<App>) -> Result<Response> {
    let health = health_data(&app).await?;
    let mut text = String::new();
    text.push_str(&format!("# TYPE signals_ingest_requests_total counter\nsignals_ingest_requests_total {}\n# TYPE signals_ingest_in_flight gauge\nsignals_ingest_in_flight {}\n# TYPE signals_broadcast_queue_depth gauge\nsignals_broadcast_queue_depth {}\n# TYPE signals_ingest_clock_skew_seconds gauge\nsignals_ingest_clock_skew_seconds {}\n",app.counters.requests.load(Ordering::Relaxed),app.counters.active.load(Ordering::Relaxed),app.notices.len(),app.counters.skew_seconds.load(Ordering::Relaxed)));
    text.push_str("# TYPE signals_ingest_rejections_total counter\n# TYPE signals_ingest_responses_total counter\n");
    for (reason, count) in app.counters.rejections.lock().unwrap().iter() {
        text.push_str(&format!(
            "signals_ingest_rejections_total{{reason=\"{reason}\"}} {count}\n"
        ));
    }
    for (status, count) in app.counters.statuses.lock().unwrap().iter() {
        text.push_str(&format!(
            "signals_ingest_responses_total{{status=\"{status}\"}} {count}\n"
        ));
    }
    for (name, value) in [
        (
            "ingest_batches_total",
            app.counters.batches.load(Ordering::Relaxed),
        ),
        (
            "ingest_events_total",
            app.counters.accepted.load(Ordering::Relaxed),
        ),
        (
            "ingest_rejected_total",
            app.counters.rejected.load(Ordering::Relaxed),
        ),
        (
            "ingest_duplicates_total",
            app.counters.duplicates.load(Ordering::Relaxed),
        ),
    ] {
        text.push_str(&format!(
            "# TYPE signals_{name} counter\nsignals_{name} {value}\n"
        ));
    }
    for (k, v) in health.as_object().unwrap() {
        text.push_str(&format!("# TYPE signals_{k} gauge\nsignals_{k} {v}\n"));
    }
    Ok(([(header::CONTENT_TYPE, "text/plain; version=0.0.4")], text).into_response())
}
#[utoipa::path(get,path="/v1/projects/{project}/live",params(("project"=uuid::Uuid,Path,description="Project UUID"),("type"=Option<String>,Query),("tool"=Option<String>,Query)),responses((status=200,description="Success",body=String,content_type="text/event-stream"), (status=400,description="Invalid request",body=crate::openapi::ErrorDocument),(status=401,description="Invalid credentials"),(status=403,description="Scope or tenant denied")),security(("readKey"=[]),("session"=[])))]
pub async fn live(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<impl IntoResponse> {
    auth::read(&app, &headers, p, false).await?;
    let mut receiver = app.notices.subscribe();
    let mut shutdown = app.shutdown.clone();
    let stream = async_stream::stream! {
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            tokio::select! {
                notice = receiver.recv() => {
                    match notice {
                        Ok(notice) => {
                            if notice["project"].as_str() != Some(p.to_string().as_str()) { continue; }
                            if let Some(events) = notice["events"].as_array() {
                                for item in events {
                                    let row=match (item["id"].as_str().and_then(|id|Uuid::parse_str(id).ok()),item["ts"].as_str().and_then(|ts|ts.parse::<DateTime<Utc>>().ok())){(Some(id),Some(ts))=>app.event_store.live_event(p,id,ts).await,_=>continue};
                                    if let Ok(Some(row)) = row {
                                        if filter.kind.as_deref().is_some_and(|t|row["type"].as_str()!=Some(t)) || filter.tool.as_deref().is_some_and(|t|row["tool"].as_str()!=Some(t)) { continue; }
                                        yield Ok::<_, Infallible>(SseEvent::default().event("signal").id(item["id"].as_str().unwrap_or("")).data(row.to_string()));
                                    }
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => yield Ok(SseEvent::default().event("gap").data("Refresh recent events")),
                        Err(_) => break,
                    }
                }
                _ = heartbeat.tick() => { if auth::read(&app,&headers,p,false).await.is_err() { break; } }
                _ = shutdown.changed() => break,
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("heartbeat"),
    ))
}
#[derive(RustEmbed)]
#[folder = "../../web/dist/"]
struct Assets;
pub async fn assets(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("v1/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error":"Route not found"})),
        )
            .into_response();
    }
    let path = if path.is_empty() { "index.html" } else { path };
    match Assets::get(path).or_else(|| {
        if !path.contains('.') {
            Assets::get("index.html")
        } else {
            None
        }
    }) {
        Some(asset) => {
            let mime = mime_guess::from_path(if path.contains('.') {
                path
            } else {
                "index.html"
            })
            .first_or_octet_stream();
            let mut response = Body::from(asset.data.into_owned()).into_response();
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, mime.as_ref().parse().unwrap());
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                if path.starts_with("assets/") {
                    "public, max-age=31536000, immutable"
                } else {
                    "no-cache"
                }
                .parse()
                .unwrap(),
            );
            response
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
