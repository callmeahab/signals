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
async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    key: &str,
    value: Value,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {key}"))
        .body(Body::from(value.to_string()))
        .unwrap();
    req.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:54321".parse::<SocketAddr>().unwrap(),
    ));
    let r = app.clone().oneshot(req).await.unwrap();
    let status = r.status();
    (
        status,
        serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap(),
    )
}
#[tokio::test]
#[ignore = "Requires isolated TEST_DATABASE_URL"]
async fn three_day_analytics_contract_and_idempotence() {
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    assert!(url.contains("127.0.0.1"));
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let tenant = store
        .tenant(&Uuid::new_v4().to_string(), "Analytics test", None)
        .await
        .unwrap();
    let project = store
        .project(tenant, "analytics", "Analytics")
        .await
        .unwrap();
    let (_, key) = store
        .create_key(project.id, "test", vec!["ingest".into(), "read".into()])
        .await
        .unwrap();
    sqlx::query(
        "UPDATE projects SET rate_events_per_min=1000000,rate_bytes_per_min=1073741824 WHERE id=$1",
    )
    .bind(project.id)
    .execute(&store.pool)
    .await
    .unwrap();
    let (notices, _) = broadcast::channel(1024);
    let (_stop, shutdown) = watch::channel(false);
    let app_state = App {
        store: store.clone(),
        event_store: Arc::new(store.clone()),
        key_cache: Default::default(),
        allowed_origins: vec![],
        admin_token: "a".repeat(32),
        session_secret: "s".repeat(32),
        public_origin: "http://localhost:8300".into(),
        dummy_password_hash: auth::password_hash("dummy-password-123").unwrap(),
        notices,
        counters: Arc::new(Counters::default()),
        shutdown,
        login_limits: Default::default(),
    };
    let app = router(app_state.clone());
    let from = (Utc::now() - Duration::days(3))
        .date_naive()
        .and_hms_opt(1, 0, 0)
        .unwrap()
        .and_utc();
    let mut events = vec![];
    for day in 0..3 {
        for client in 0..2 {
            let ts = from + Duration::days(day) + Duration::hours(client);
            let session = format!("s-{day}-{client}");
            let caller = if client == 0 {
                json!({"subject":"oauth-user","key_id":"key"})
            } else {
                json!({"key_id":"tenant-key","ip":"203.0.113.4"})
            };
            let c = json!({"name":if client==0{"Claude"}else{"Cursor"},"version":"1.0","protocol_version":"2025-03-26"});
            let event = |kind: &str, seconds: i64, attrs: Value| json!({"id":Uuid::now_v7(),"ts":ts+Duration::seconds(seconds),"type":kind,"session_id":session,"client":c,"caller":caller,"attrs":attrs});
            events.push(event(
                "session.started",
                0,
                json!({"transport":"streamable-http"}),
            ));
            events.push(event("mcp.initialize",1,json!({"requested_protocol_version":"2025-03-26","client_capabilities":["roots"],"server_capabilities":["tools"]})));
            events.push(event("tools.listed",2,json!({"count":3,"tools":[{"name":"get_item","annotations":["readOnly"],"schema_hash":"a"},{"name":"set_item","annotations":["destructive"]},{"name":"dead_tool"}],"catalog_hash":"catalog-1","future_optional":true})));
            for i in 0..6 {
                events.push(event("tool.called",3+i,json!({"tool":if i<3{"get_item"}else{"set_item"},"duration_ms":100+i*10,"is_error":i==0,"input_bytes":100,"output_bytes":400,"output_chars":200,"output_kinds":["text"],"cancelled":false,"args":{"id":1},"private_note":"not-an-analytics-field"})));
            }
            events.push(event(
                "session.ended",
                10,
                json!({"reason":"client","duration_ms":10000}),
            ));
        }
    }
    for (index, chunk) in events.chunks(30).enumerate() {
        let batch = json!({"schema_version":1,"sent_at":Utc::now(),"source":{"sdk":if index%2==0{"node"}else{"python"},"sdk_version":"1.0","server_name":"synthetic","server_version":"1","instance_id":"test"},"events":chunk});
        let (status, result) = call(&app, "POST", "/v1/events", &key, batch.clone()).await;
        assert_eq!(status, StatusCode::ACCEPTED, "{result}");
        assert_eq!(result["accepted"], chunk.len(), "{result}");
        assert_eq!(
            call(&app, "POST", "/v1/events", &key, batch).await.1["rejected"],
            json!([])
        );
    }
    store.rollup().await.unwrap();
    async fn snapshot(store: &Store, p: Uuid) -> Value {
        sqlx::query_scalar("SELECT jsonb_build_object('hourly',(SELECT jsonb_agg(to_jsonb(r) ORDER BY hour,tool) FROM analytics_hourly r WHERE project_id=$1),'daily',(SELECT jsonb_agg(to_jsonb(r) ORDER BY day) FROM analytics_daily r WHERE project_id=$1),'identities',(SELECT jsonb_agg(to_jsonb(r) ORDER BY kind,identity_key) FROM identities r WHERE project_id=$1),'paths',(SELECT jsonb_agg(to_jsonb(r) ORDER BY day,sequence) FROM analytics_paths r WHERE project_id=$1))").bind(p).fetch_one(&store.pool).await.unwrap()
    }
    let before = snapshot(&store, project.id).await;
    store.rollup().await.unwrap();
    assert_eq!(before, snapshot(&store, project.id).await);
    let base = format!("/v1/projects/{}/analytics", project.id);
    let get = |name: &str| format!("{base}/{name}?range=7d");
    let (_, overview) = call(&app, "GET", &get("overview"), &key, Value::Null).await;
    assert_eq!(overview["tiles"]["tool_calls"]["value"], 36, "{overview}");
    assert_eq!(overview["tiles"]["active_users"]["value"], 2);
    assert_eq!(
        overview["tiles"]["active_users"]["by_kind"],
        json!({"strong":1,"key":1,"network":0})
    );
    assert_eq!(overview["tiles"]["sessions"]["value"], 6);
    assert_eq!(overview["tiles"]["success_rate"]["value"], 83.3);
    assert_eq!(overview["tiles"]["context_tokens"]["value"], 1800);
    let (_, adoption) = call(&app, "GET", &get("adoption"), &key, Value::Null).await;
    assert_eq!(adoption["active"]["wau"], 2);
    assert_eq!(adoption["retention"]["daily"]["d1"], 100.0);
    assert_eq!(adoption["retention"]["daily"]["d7"], Value::Null);
    for step in [&overview["funnel"][4], &adoption["funnel"]["steps"][4]] {
        assert_eq!(step["step"], "returned_day_7");
        assert_eq!(step["count"], Value::Null);
        assert_eq!(step["eligible"], 0);
    }
    assert_eq!(adoption["funnel"]["steps"][4]["dropoff_pct"], Value::Null);
    assert_eq!(adoption["clients"].as_array().unwrap().len(), 2);
    assert_eq!(adoption["transports"][0]["sessions"], 6);
    let (_, tools) = call(&app, "GET", &get("tools"), &key, Value::Null).await;
    assert_eq!(tools["catalog"]["advertised"], 3);
    assert_eq!(tools["catalog"]["used"], 2);
    assert_eq!(tools["catalog"]["dead"], json!(["dead_tool"]));
    let get_item = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["tool"] == "get_item")
        .unwrap();
    assert_eq!(get_item["calls"], 18);
    assert_eq!(get_item["retries"]["count"], 6);
    assert_eq!(get_item["retries"]["self_corrected_pct"], 100.0);
    assert_eq!(get_item["errors"]["protocol"], Value::Null);
    assert!(!tools["paths"].as_array().unwrap().is_empty());
    let (_, reliability) = call(&app, "GET", &get("reliability"), &key, Value::Null).await;
    assert_eq!(reliability["sessions_with_errors"]["count"], 6);
    assert_eq!(reliability["handshake"]["attempts"], 6);
    assert_eq!(reliability["handshake"]["success_rate"], Value::Null);
    assert_eq!(reliability["availability"], Value::Null);
    let (_, cost) = call(&app, "GET", &get("cost"), &key, Value::Null).await;
    assert_eq!(cost["total_tokens_est"], 1800);
    assert_eq!(cost["payload_hist"]["input"], json!([36, 0, 0, 0, 0]));
    assert_eq!(cost["by_tenant"].as_array().unwrap().len(), 2);
    let (_, protocol) = call(&app, "GET", &get("protocol"), &key, Value::Null).await;
    assert_eq!(protocol["capabilities"]["sessions"], 6);
    assert_eq!(protocol["capabilities"]["client"][0]["sessions"], 6);
    assert_eq!(protocol["sampling"]["requests"], Value::Null);
    let (_, digest) = call(&app, "GET", &get("digest"), &key, Value::Null).await;
    assert_eq!(digest["new"], 2);
    assert_eq!(digest["dead_tools"], json!(["dead_tool"]));
    store.evaluate_alerts().await.unwrap();
    let (_, alerts) = call(&app, "GET", &get("alerts"), &key, Value::Null).await;
    assert_eq!(alerts["rules"].as_array().unwrap().len(), 5);
    let (_, timeline) = call(
        &app,
        "GET",
        &get("sessions/s-0-0/timeline"),
        &key,
        Value::Null,
    )
    .await;
    assert_eq!(timeline["events"].as_array().unwrap().len(), 10);
    assert_eq!(
        timeline["events"][3]["args_hash"].as_str().unwrap().len(),
        64
    );
    assert_eq!(timeline["session"]["duration_ms"], 10000);
    let (status, invalid) = call(
        &app,
        "GET",
        &format!("{base}/overview?unknown=x"),
        &key,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid["error"], "invalid_filter");
    let exact_url = format!(
        "{base}/overview?from={}&to={}",
        from.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        (from + Duration::hours(1)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    );
    let (status, exact) = call(&app, "GET", &exact_url, &key, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{exact}");
    assert_eq!(exact["tiles"]["latency"]["method"], "exact");
    assert_eq!(exact["tiles"]["latency"]["p50"], 120);
    assert_eq!(exact["tiles"]["latency"]["p95"], 150);
    let (_, filtered) = call(
        &app,
        "GET",
        &format!("{base}/overview?client=Claude"),
        &key,
        Value::Null,
    )
    .await;
    assert_eq!(filtered["tiles"]["tool_calls"]["value"], 18);
    let owner = store
        .create_user(
            tenant,
            &format!("{}@analytics.test", Uuid::new_v4()),
            &auth::password_hash("test-password-123").unwrap(),
            "owner",
        )
        .await
        .unwrap();
    let secret = "analytics-test-session";
    sqlx::query("INSERT INTO dashboard_sessions(secret_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour') ON CONFLICT(secret_hash) DO UPDATE SET user_id=EXCLUDED.user_id,expires_at=EXCLUDED.expires_at").bind(signals_store::hash(secret)).bind(owner).execute(&store.pool).await.unwrap();
    for (method, suffix, body) in [
        ("PATCH", "", json!({"slo_classes":{"get_item":"write"}})),
        ("PATCH", "", json!({"retention_days":0})),
        ("PATCH", "", json!({"token_divisor":0})),
        ("PATCH", "", json!([])),
        (
            "PUT",
            "/alerts",
            json!({"rules":[{"id":"unknown","enabled":true}]}),
        ),
    ] {
        let request = Request::builder()
            .method(method)
            .uri(format!("/v1/projects/{}{suffix}", project.id))
            .header("content-type", "application/json")
            .header(
                "cookie",
                format!(
                    "signals_session={}",
                    auth::signed_cookie(&app_state, secret)
                ),
            )
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let error: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(error["error"], "invalid_settings");
        assert!(!error["message"].as_str().unwrap().is_empty());
    }
    let request=Request::builder().method("PATCH").uri(format!("/v1/projects/{}",project.id)).header("content-type","application/json").header("cookie",format!("signals_session={}",auth::signed_cookie(&app_state,secret))).body(Body::from(json!({"id":Uuid::new_v4(),"tenant_id":Uuid::new_v4(),"slug":"ignored-read-only","token_divisor":2,"slo_classes":{"get_item":"mutate"},"digest":{"enabled":true,"recipient":"owner@example.test"},"probe_key":"secret"}).to_string())).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let settings: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(settings["token_divisor"], 2.0);
    assert_eq!(settings["id"], project.id.to_string());
    assert_eq!(settings["tenant_id"], tenant.to_string());
    assert_eq!(settings["slug"], project.slug);
    assert!(settings.get("probe_key").is_none());
    let (_, cost_after) = call(&app, "GET", &get("cost"), &key, Value::Null).await;
    assert_eq!(cost_after["total_tokens_est"], 3600);
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/v1/projects/{}", project.id),
            &key,
            json!({"token_divisor":8})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut retained = std::collections::BTreeMap::new();
    for route in [
        "overview",
        "adoption",
        "tools",
        "reliability",
        "cost",
        "protocol",
        "digest",
    ] {
        let (_, mut value) = call(
            &app,
            "GET",
            &format!("{base}/{route}?range=90d"),
            &key,
            Value::Null,
        )
        .await;
        value.as_object_mut().unwrap().remove("range");
        value.as_object_mut().unwrap().remove("generated_at");
        retained.insert(route, value);
    }
    let leaked:i64=sqlx::query_scalar("SELECT count(*) FROM analytics_facts WHERE project_id=$1 AND (attrs ? 'args' OR attrs ? 'private_note')").bind(project.id).fetch_one(&store.pool).await.unwrap();
    assert_eq!(leaked, 0);
    sqlx::query("DELETE FROM events WHERE project_id=$1")
        .bind(project.id)
        .execute(&store.pool)
        .await
        .unwrap();
    for (route, expected) in retained {
        let (_, mut actual) = call(
            &app,
            "GET",
            &format!("{base}/{route}?range=90d"),
            &key,
            Value::Null,
        )
        .await;
        actual.as_object_mut().unwrap().remove("range");
        actual.as_object_mut().unwrap().remove("generated_at");
        assert_eq!(actual, expected, "{route} changed after raw retention");
    }
    let (_, retained_timeline) = call(
        &app,
        "GET",
        &get("sessions/s-0-0/timeline"),
        &key,
        Value::Null,
    )
    .await;
    assert_eq!(retained_timeline["events"].as_array().unwrap().len(), 10);
    assert_eq!(retained_timeline["events"][3]["args_hash"], Value::Null);
    println!("PASS 90-day metric responses survive raw retention; argument bodies and arbitrary attributes are excluded from analytics facts");
    let empty_project = store
        .project(tenant, "empty-tool", "Empty tool")
        .await
        .unwrap();
    let (_, empty_key) = store
        .create_key(
            empty_project.id,
            "test",
            vec!["ingest".into(), "read".into()],
        )
        .await
        .unwrap();
    let mut empty_event = events[3].clone();
    empty_event["id"] = json!(Uuid::now_v7());
    empty_event["ts"] = json!(Utc::now());
    empty_event["attrs"]["tool"] = json!("");
    let batch = json!({"schema_version":1,"sent_at":Utc::now(),"source":{"sdk":"test","sdk_version":"1","server_name":"test","server_version":"1","instance_id":"test"},"events":[empty_event.clone()]});
    let (status, accepted) = call(&app, "POST", "/v1/events", &empty_key, batch).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(accepted["accepted"], 1);
    store.rollup().await.unwrap();
    let totals:Vec<(bool,i64)>=sqlx::query_as("SELECT is_project,(metrics->>'calls')::bigint FROM analytics_hourly WHERE project_id=$1 ORDER BY is_project").bind(empty_project.id).fetch_all(&store.pool).await.unwrap();
    assert_eq!(totals, vec![(false, 1), (true, 1)]);
    println!("PASS empty tool names have distinct tool and project aggregate scopes");
    empty_event["ts"] = json!(Utc::now() + Duration::milliseconds(1));
    empty_event["attrs"]["args"] = json!({"id":2});
    let second = json!({"schema_version":1,"sent_at":Utc::now(),"source":{"sdk":"test","sdk_version":"1","server_name":"test","server_version":"1","instance_id":"test"},"events":[empty_event]});
    assert_eq!(
        call(&app, "POST", "/v1/events", &empty_key, second).await.1["accepted"],
        1
    );
    let (_, hashes) = call(
        &app,
        "GET",
        &format!(
            "/v1/projects/{}/analytics/sessions/s-0-0/timeline",
            empty_project.id
        ),
        &empty_key,
        Value::Null,
    )
    .await;
    assert_eq!(
        hashes["events"][0]["args_hash"],
        hex::encode(signals_store::hash("{\"id\":1}"))
    );
    assert_eq!(
        hashes["events"][1]["args_hash"],
        hex::encode(signals_store::hash("{\"id\":2}"))
    );

    if std::env::var("SIGNALS_ANALYTICS_BENCH").as_deref() == Ok("1") {
        sqlx::query("INSERT INTO events(project_id,ts,received_at,id,type,session_id,tool,duration_ms,is_error,client_name,client_version,attrs,client,caller) SELECT $1,$2+(g%250000)*interval '2 seconds',clock_timestamp(),gen_random_uuid(),'tool.called','bench-'||(g%100),'get_item',(g%6000)::int,g%97=0,CASE WHEN g%2=0 THEN 'Claude' ELSE 'Cursor' END,'1.0',jsonb_build_object('input_bytes',100,'output_bytes',400,'output_chars',200,'cancelled',false),jsonb_build_object('name',CASE WHEN g%2=0 THEN 'Claude' ELSE 'Cursor' END,'version','1.0'),jsonb_build_object('subject','bench-'||(g%100)) FROM generate_series(1,100000) g").bind(project.id).bind(from).execute(&store.pool).await.unwrap();
        store.rollup().await.unwrap();
        for route in [
            "overview",
            "adoption",
            "tools",
            "reliability",
            "cost",
            "protocol",
            "digest",
            "alerts",
            "sessions/s-0-0/timeline",
        ] {
            let start = std::time::Instant::now();
            let (status, result) = call(&app, "GET", &get(route), &key, Value::Null).await;
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(status, StatusCode::OK, "{route}: {result}");
            println!("BENCH {route}: {ms:.2} ms");
            assert!(ms < 300.0, "{route} exceeded 300 ms: {ms}");
        }
    }
    println!("PASS all nine analytics routes, both SDK source shapes, identities, retries, paths, nulls, filtering, replay and rollup idempotence");
}
