pub mod auth;
pub mod handlers;
pub mod middleware;
pub mod openapi;
pub mod telemetry;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use signals_store::Store;
use std::sync::{
    atomic::{AtomicI64, AtomicU64},
    Arc,
};
use tokio::sync::{broadcast, watch};
use tower_http::{
    compression::CompressionLayer, decompression::RequestDecompressionLayer, timeout::TimeoutLayer,
};

pub type LoginLimits =
    Arc<tokio::sync::Mutex<std::collections::HashMap<Vec<u8>, (std::time::Instant, u32)>>>;
#[derive(Clone)]
pub struct App {
    pub store: Store,
    pub event_store: Arc<dyn signals_store::event_store::EventStore>,
    pub key_cache: Arc<tokio::sync::Mutex<std::collections::HashMap<String, auth::CachedKey>>>,
    pub allowed_origins: Vec<String>,
    pub admin_token: String,
    pub session_secret: String,
    pub public_origin: String,
    pub dummy_password_hash: String,
    pub notices: broadcast::Sender<serde_json::Value>,
    pub counters: Arc<Counters>,
    pub shutdown: watch::Receiver<bool>,
    pub login_limits: LoginLimits,
}
#[derive(Default)]
pub struct Counters {
    pub batches: AtomicU64,
    pub accepted: AtomicU64,
    pub rejected: AtomicU64,
    pub duplicates: AtomicU64,
    pub requests: AtomicU64,
    pub active: AtomicU64,
    pub skew_seconds: AtomicI64,
    pub rejections: std::sync::Mutex<std::collections::BTreeMap<String, u64>>,
    pub statuses: std::sync::Mutex<std::collections::BTreeMap<u16, u64>>,
}
pub type Result<T> = std::result::Result<T, Error>;
pub struct Error {
    pub status: StatusCode,
    pub message: String,
}
impl Error {
    pub fn bad(message: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    pub fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: "Invalid credentials".into(),
        }
    }
    pub fn forbidden(message: &str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }
    pub fn not_found(message: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
    pub fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(error=%error,"request failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "Collector request failed".into(),
        }
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        Self::internal(e)
    }
}
impl From<anyhow::Error> for Error {
    fn from(e: anyhow::Error) -> Self {
        Self::internal(e)
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = self.status;
        let mut response = (status, Json(json!({"error":self.message}))).into_response();
        if status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert("retry-after", "60".parse().unwrap());
        }
        response
    }
}
pub fn router(app: App) -> Router {
    use handlers::*;
    let timed = Router::new()
        .route("/v1/events", post(ingest))
        .route("/v1/whoami", get(whoami))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/me", get(me))
        .route(
            "/v1/projects/{project}",
            axum::routing::patch(update_project),
        )
        .route("/v1/projects/{project}/overview", get(overview))
        .route("/v1/projects/{project}/timeseries", get(timeseries))
        .route("/v1/projects/{project}/tools", get(tools))
        .route(
            "/v1/projects/{project}/tool-timeseries",
            get(tool_timeseries),
        )
        .route(
            "/v1/projects/{project}/callers/{caller}/timeseries",
            get(caller_timeseries),
        )
        .route("/v1/projects/{project}/callers", get(callers))
        .route("/v1/projects/{project}/sessions", get(sessions))
        .route(
            "/v1/projects/{project}/sessions/{session}/events",
            get(session_events),
        )
        .route("/v1/projects/{project}/events", get(events))
        .route("/v1/projects/{project}/keys", get(keys).post(create_key))
        .route(
            "/v1/projects/{project}/keys/{key}",
            axum::routing::delete(revoke_key),
        )
        .route(
            "/v1/projects/{project}/users",
            get(project_users).post(project_create_user),
        )
        .route("/v1/admin/tenants", post(create_tenant))
        .route("/v1/admin/projects", post(create_project))
        .route("/v1/admin/keys", post(admin_key))
        .route("/v1/admin/users", post(create_user))
        .route("/v1/admin/health", get(admin_health))
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(ready))
        .route("/metrics", get(metrics))
        .route("/v1/openapi.json", get(openapi::read_document))
        .route("/v1/ingest.openapi.yaml", get(openapi::ingest_document))
        .route("/v1/events.schema.json", get(openapi::event_schema))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_secs(10),
        ));
    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin(
            app.allowed_origins
                .iter()
                .map(|o| o.parse().expect("validated origin"))
                .collect::<Vec<axum::http::HeaderValue>>(),
        )
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-request-id"),
        ])
        .expose_headers([axum::http::HeaderName::from_static("x-request-id")])
        .allow_credentials(true);
    Router::new()
        .merge(timed)
        .route("/v1/projects/{project}/live", get(live))
        .fallback(assets)
        .layer(axum::extract::DefaultBodyLimit::max(signals_core::MAX_BODY))
        .layer(RequestDecompressionLayer::new())
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(axum::middleware::from_fn_with_state(
            app.clone(),
            middleware::observe,
        ))
        .with_state(app)
}
