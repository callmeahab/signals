use axum::{http::header, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ErrorDocument {
    pub error: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct EventDocument {
    pub id: uuid::Uuid,
    pub ts: chrono::DateTime<chrono::Utc>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: Option<String>,
    pub caller_id: Option<String>,
    pub tool: Option<String>,
    pub duration_ms: Option<i32>,
    pub is_error: bool,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub attrs: serde_json::Value,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct EventPage {
    pub items: Vec<EventDocument>,
    pub next_cursor: Option<String>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Point {
    pub ts: chrono::DateTime<chrono::Utc>,
    pub requests: i64,
    pub errors: i64,
    pub sessions: usize,
    pub callers: usize,
    pub latency_p50: f64,
    pub latency_p95: f64,
    pub latency_p99: f64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct MetricPoint {
    pub ts: chrono::DateTime<chrono::Utc>,
    pub value: f64,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum Timeseries {
    Complete(Vec<Point>),
    Metric(Vec<MetricPoint>),
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Identity {
    pub project: ProjectDocument,
    pub key_id: uuid::Uuid,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreatedResource {
    pub id: uuid::Uuid,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Health {
    pub rollup_lag_seconds: f64,
    pub partitions: i64,
    pub default_partition_rows: i64,
    pub db_pool_size: u32,
    pub db_pool_idle: usize,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ClientSplit {
    pub name: String,
    pub count: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Tool {
    pub tool: String,
    pub calls: i64,
    pub errors: i64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub last_called: chrono::DateTime<chrono::Utc>,
    pub trend: Vec<i64>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Overview {
    pub requests: i64,
    pub tool_calls: i64,
    pub errors: i64,
    pub error_rate: f64,
    pub sessions: usize,
    pub unique_callers: usize,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub top_tools: Vec<Tool>,
    pub clients: Vec<ClientSplit>,
    pub deltas: std::collections::BTreeMap<String, Option<f64>>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Caller {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub calls: i64,
    pub errors: i64,
    pub sessions: usize,
    pub clients: Vec<String>,
    pub first_seen: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Session {
    pub session_id: String,
    pub client_name: String,
    pub caller_label: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    pub calls: i64,
    pub errors: i64,
    pub transport: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct SessionPage {
    pub items: Vec<Session>,
    pub next_cursor: Option<String>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct KeyDocument {
    pub id: uuid::Uuid,
    pub project_id: uuid::Uuid,
    pub key_id: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct MintedKey {
    pub key: KeyDocument,
    pub secret: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct UserDocument {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub email: String,
    pub role: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProjectDocument {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub name: String,
    pub slug: String,
    pub retention_days: i32,
    pub rate_events_per_min: i32,
    pub rate_bytes_per_min: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Account {
    pub user: UserDocument,
    pub projects: Vec<ProjectDocument>,
}

#[derive(OpenApi)]
#[openapi(info(title="Signals read and provisioning API",version="0.1.0",description="UTC times. Dashboard sessions and project-scoped read keys authorize reads. Project writes require an owner session. Admin keys provision resources. The ingest contract is served separately."),paths(
crate::handlers::login,crate::handlers::logout,crate::handlers::me,crate::handlers::whoami,
crate::handlers::overview,crate::handlers::timeseries,crate::handlers::tools,crate::handlers::tool_timeseries,crate::handlers::callers,crate::handlers::caller_timeseries,crate::handlers::sessions,crate::handlers::session_events,crate::handlers::events,crate::handlers::live,crate::handlers::keys,crate::handlers::create_key,crate::handlers::revoke_key,crate::handlers::update_project,crate::handlers::project_users,crate::handlers::project_create_user,crate::handlers::create_tenant,crate::handlers::create_project,crate::handlers::admin_key,crate::handlers::create_user,crate::handlers::admin_health
),components(schemas(ErrorDocument,EventDocument,EventPage,Point,MetricPoint,Timeseries,Identity,CreatedResource,Health,Tool,Caller,Session,SessionPage,KeyDocument,MintedKey,Overview,ProjectDocument,UserDocument,Account,crate::handlers::Login,crate::handlers::Settings,crate::handlers::KeyInput,crate::handlers::TenantInput,crate::handlers::ProjectInput,crate::handlers::AdminKeyInput,crate::handlers::UserInput,crate::handlers::ProjectUserInput)),modifiers(&Security))]
pub struct ReadApi;
struct Security;
impl utoipa::Modify for Security {
    fn modify(&self, api: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::*;
        let c = api.components.as_mut().unwrap();
        c.add_security_scheme(
            "ingestKey",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        c.add_security_scheme(
            "readKey",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        c.add_security_scheme(
            "adminToken",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        c.add_security_scheme(
            "session",
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("signals_session"))),
        );
    }
}
pub async fn read_document() -> Json<utoipa::openapi::OpenApi> {
    Json(ReadApi::openapi())
}
#[derive(rust_embed::RustEmbed)]
#[folder = "../../spec/"]
struct Spec;
pub async fn ingest_document() -> impl IntoResponse {
    let official = Spec::get("ingest.openapi.yaml");
    let is_official = official.is_some();
    let asset = official
        .or_else(|| Spec::get("development.ingest.openapi.yaml"))
        .expect("development OpenAPI bundled");
    (
        [
            (header::CONTENT_TYPE, "application/yaml"),
            (
                header::HeaderName::from_static("x-signals-contract"),
                if is_official {
                    "signals-spec"
                } else {
                    "provisional"
                },
            ),
        ],
        asset.data.into_owned(),
    )
}
pub async fn event_schema() -> impl IntoResponse {
    let asset = Spec::get("events.schema.json").expect("event schema bundled");
    (
        [(header::CONTENT_TYPE, "application/schema+json")],
        asset.data.into_owned(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_covers_read_routes_and_models() {
        let v = serde_json::to_value(ReadApi::openapi()).unwrap();
        for p in [
            "/v1/projects/{project}/overview",
            "/v1/projects/{project}/tool-timeseries",
            "/v1/projects/{project}/sessions/{session}/events",
            "/v1/admin/users",
        ] {
            assert!(v["paths"][p].is_object(), "{p}");
        }
        assert!(v["components"]["schemas"]["Overview"]["properties"]["p99"].is_object());
    }
}
