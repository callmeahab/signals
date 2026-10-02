use crate::App;
use axum::{
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
};
use std::sync::{atomic::Ordering, Arc};
use tracing::Instrument;

struct Active(Arc<crate::Counters>);
impl Drop for Active {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::Relaxed);
    }
}
pub async fn observe(State(app): State<App>, mut request: Request, next: Next) -> Response {
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| uuid::Uuid::parse_str(v).ok())
        .unwrap_or_else(uuid::Uuid::new_v4)
        .to_string();
    request
        .headers_mut()
        .insert("x-request-id", request_id.parse().unwrap());
    let ingest = request.uri().path() == "/v1/events";
    let active = if ingest {
        app.counters.requests.fetch_add(1, Ordering::Relaxed);
        app.counters.active.fetch_add(1, Ordering::Relaxed);
        Some(Active(app.counters.clone()))
    } else {
        None
    };
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str())
        .unwrap_or("/assets");
    let span = tracing::info_span!("http.request",http.request.method=%request.method(),http.route=route,request_id=%request_id);
    let start = std::time::Instant::now();
    let mut response = next.run(request).instrument(span.clone()).await;
    response
        .headers_mut()
        .insert("x-request-id", request_id.parse().unwrap());
    if ingest {
        *app.counters
            .statuses
            .lock()
            .unwrap()
            .entry(response.status().as_u16())
            .or_default() += 1;
    }
    tracing::info!(parent:&span,status=response.status().as_u16(),duration_ms=start.elapsed().as_millis() as u64,"request completed");
    drop(active);
    response
}
