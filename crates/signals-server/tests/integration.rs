use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use chrono::{Duration, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use signals_server::{auth, router, App, Counters};
use signals_store::Store;
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::{broadcast, watch};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
#[ignore = "Requires an isolated Postgres database in TEST_DATABASE_URL"]
async fn migration_comment_cleanup_preserves_existing_databases() {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
    assert!(url.contains("127.0.0.1") || url.contains("localhost"));
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    assert!(store.migrations_current().await.unwrap());
    let checksum: Vec<u8> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=2")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    let legacy = hex::decode("bc172fa86f15bd6da8fae1fe203cef5ace66a50147d371931d16c3f2c496dff11b0a9ed0cfb438437d48502a043e5f79").unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=2")
        .bind(legacy)
        .execute(&store.pool)
        .await
        .unwrap();
    let legacy_current = store.migrations_current().await;
    let legacy_migration = store.migrate().await;
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=2")
        .bind(vec![0_u8; 48])
        .execute(&store.pool)
        .await
        .unwrap();
    let invalid_current = store.migrations_current().await;
    let invalid_migration = store.migrate().await;
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=2")
        .bind(checksum)
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(legacy_current.unwrap());
    legacy_migration.unwrap();
    assert!(!invalid_current.unwrap());
    assert!(invalid_migration.is_err());
    assert!(store.migrations_current().await.unwrap());
    store.migrate().await.unwrap();
}

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    key: Option<&str>,
    value: Value,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(key) = key {
        req = req.header("authorization", format!("Bearer {key}"));
    }
    let mut req = req.body(Body::from(value.to_string())).unwrap();
    req.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:54321".parse::<SocketAddr>().unwrap(),
    ));
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}
#[tokio::test]
#[ignore = "Requires an isolated Postgres database in TEST_DATABASE_URL"]
async fn collector_replays_late_rollups_tenant_isolation_and_keys() {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
    assert!(
        url.contains("127.0.0.1") || url.contains("localhost"),
        "Tests require a local DB"
    );
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let tenant = store
        .tenant(&Uuid::new_v4().simple().to_string(), "Test tenant", None)
        .await
        .unwrap();
    let project = store
        .project(tenant, "server", "Test server")
        .await
        .unwrap();
    let other_tenant = store
        .tenant(&Uuid::new_v4().simple().to_string(), "Other tenant", None)
        .await
        .unwrap();
    let other = store
        .project(other_tenant, "server", "Other server")
        .await
        .unwrap();
    let (_, key) = store
        .create_key(project.id, "test", vec!["ingest".into(), "read".into()])
        .await
        .unwrap();
    let (_, other_key) = store
        .create_key(other.id, "test", vec!["read".into()])
        .await
        .unwrap();
    let (notices, _) = broadcast::channel(1024);
    let (_stop, shutdown) = watch::channel(false);
    let app = router(App {
        store: store.clone(),
        event_store: Arc::new(store.clone()),
        key_cache: Default::default(),
        allowed_origins: vec!["http://localhost:8300".into()],
        admin_token: "a".repeat(32),
        session_secret: "s".repeat(32),
        public_origin: "http://localhost:8300".into(),
        dummy_password_hash: auth::password_hash("dummy-password-123").unwrap(),
        notices,
        counters: Arc::new(Counters::default()),
        shutdown,
        login_limits: Default::default(),
    });
    let now = Utc::now();
    let event = json!({"id":Uuid::new_v4(),"ts":now,"type":"tool.call","tool":"search","duration_ms":42,"session_id":"s1","client_name":"Claude","caller":{"subject":"caller"},"attrs":{}});
    let batch = json!({"sent_at":now,"events":[event.clone()]});
    let (a, b) = tokio::join!(
        call(&app, "POST", "/v1/events", Some(&key), batch.clone()),
        call(&app, "POST", "/v1/events", Some(&key), batch)
    );
    assert_eq!(a.0, StatusCode::ACCEPTED);
    assert_eq!(b.0, StatusCode::ACCEPTED);
    assert_eq!(
        a.1["accepted"].as_u64().unwrap() + b.1["accepted"].as_u64().unwrap(),
        1
    );
    store.rollup().await.unwrap();
    let mut late = Vec::new();
    let mut expected_errors = 0;
    for i in 0..120 {
        let error = i % 9 == 0;
        expected_errors += u64::from(error);
        late.push(json!({"id":Uuid::new_v4(),"ts":now-Duration::hours(1+i%20),"type":"tool.call","tool":"search","duration_ms":i*11,"is_error":error,"session_id":format!("s{}",i%3),"client_name":"Claude","caller":{"subject":"caller"},"attrs":{}}));
    }
    let result = call(
        &app,
        "POST",
        "/v1/events",
        Some(&key),
        json!({"sent_at":now,"events":late}),
    )
    .await;
    assert_eq!(result.0, StatusCode::ACCEPTED);
    assert_eq!(result.1["accepted"], 120);
    store.rollup().await.unwrap();
    store.rollup().await.unwrap();
    let path = format!("/v1/projects/{}/overview?range=24h", project.id);
    let (status, summary) = call(&app, "GET", &path, Some(&key), Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary["requests"], 121);
    assert_eq!(summary["errors"], expected_errors);
    assert_eq!(summary["unique_callers"], 1);
    assert_eq!(summary["sessions"], 3);
    let direct: i64 = sqlx::query_scalar("SELECT count(*) FROM events WHERE project_id=$1")
        .bind(project.id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(direct, 121);
    assert_eq!(
        call(&app, "GET", &path, Some(&other_key), Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "GET", &path, Some(&"a".repeat(32)), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/v1/events",
            Some(&other_key),
            json!({"sent_at":now,"events":[event]})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let result=call(&app,"POST","/v1/events",Some(&key),json!({"sent_at":now,"events":[{}, {"id":Uuid::new_v4(),"ts":now+Duration::minutes(6),"type":"tool.call"}]})).await;
    assert_eq!(result.0, StatusCode::ACCEPTED);
    assert_eq!(result.1["rejected"].as_array().unwrap().len(), 2);
    sqlx::query("UPDATE projects SET rate_events_per_min=1 WHERE id=$1")
        .bind(project.id)
        .execute(&store.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/v1/events",
            Some(&key),
            json!({"sent_at":now,"events":[{},{}]})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    sqlx::query("UPDATE api_keys SET revoked_at=now() WHERE project_id=$1")
        .bind(project.id)
        .execute(&store.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &path, Some(&key), Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
}
