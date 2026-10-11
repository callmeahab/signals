use chrono::{Duration, Utc};
use serde_json::{json, Value};
use signals_server::delivery;
use signals_store::{
    analytics::{Filters, Window},
    Store,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    sync::mpsc,
};
use uuid::Uuid;

#[tokio::test]
#[ignore = "Requires isolated TEST_DATABASE_URL; starts local SMTP and webhook sinks"]
async fn v11_storage_protocol_and_delivery() {
    let store = Store::connect(&std::env::var("TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    store.migrate().await.unwrap();
    let tenant = store
        .tenant(&Uuid::new_v4().to_string(), "v11", None)
        .await
        .unwrap();
    let project = store.project(tenant, "v11", "<v11>").await.unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../spec/fixtures/valid/mixed-v11-attrs.json"
    ))
    .unwrap();
    let now = Utc::now();
    let values = fixture["events"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let mut e = e.clone();
            e["id"] = json!(Uuid::now_v7());
            e["ts"] = json!(now - Duration::seconds(60 - i as i64));
            e
        })
        .collect();
    let (events, rejected) = signals_core::validate_batch(values, now, 30);
    assert!(rejected.is_empty(), "{rejected:?}");
    store
        .ingest(
            project.id,
            events
                .into_iter()
                .map(|e| (e, "key".into(), "fixture".into(), "fixture".into()))
                .collect(),
        )
        .await
        .unwrap();
    store.rollup().await.unwrap();
    let data = store.analytics_data(project.id, now).await.unwrap();
    let w = Window {
        from: now - Duration::hours(1),
        to: now,
    };
    let events = data.selected(w, &Filters::default());
    assert!(data.protocol(&[])["sampling"]["requests"].is_null());
    let protocol = data.protocol(&events);
    assert_eq!(protocol["sampling"]["requests"], 1);
    assert_eq!(protocol["sampling"]["p95"], 310);
    assert_eq!(protocol["sampling"]["rejected_pct"], 0.0);
    assert_eq!(protocol["elicitation"]["accept_pct"], 100.0);
    assert_eq!(protocol["tasks"]["failed"], 1);
    assert_eq!(protocol["discovery"]["duration_ms"], 4);
    let reliability = data.reliability(w, &Filters::default());
    assert_eq!(reliability["handshake"]["success_rate"], 50.0);
    assert_eq!(reliability["handshake"]["p95"], 6);
    assert_eq!(reliability["auth_failures"].as_array().unwrap().len(), 2);
    assert_eq!(data.catalog.len(), 3);
    assert_eq!(data.catalog_info["truncated"], false);
    assert!(data.first.contains_key(&("strong".into(), "u_7f3a".into())));
    assert!(!data.first.contains_key(&("strong".into(), "svc".into())));
    let row: Value = sqlx::query_scalar(
        "SELECT attrs FROM analytics_facts WHERE project_id=$1 AND attrs->>'request_id'='req-17'",
    )
    .bind(project.id)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(row["output_chars"], 940);
    assert_eq!(row["output_items"], 2);
    assert_eq!(row["input_schema_valid"], true);
    assert_eq!(row["progress_events"], 3);

    let smtp = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let smtp_port = smtp.local_addr().unwrap().port();
    let (mail_tx, mut mail_rx) = mpsc::channel(10);
    let smtp_task = tokio::spawn(async move {
        loop {
            let (socket, _) = smtp.accept().await.unwrap();
            let (read, mut write) = socket.into_split();
            write.write_all(b"220 local SMTP\r\n").await.unwrap();
            let mut lines = BufReader::new(read).lines();
            let mut message = String::new();
            let mut body = false;
            while let Some(line) = lines.next_line().await.unwrap() {
                if body && line != "." {
                    message.push_str(&line);
                    message.push('\n');
                    continue;
                }
                let reply = if body {
                    body = false;
                    mail_tx.send(message.clone()).await.unwrap();
                    "250 queued\r\n"
                } else if line.starts_with("EHLO") {
                    "250-localhost\r\n250 8BITMIME\r\n"
                } else if line == "DATA" {
                    body = true;
                    "354 send\r\n"
                } else if line == "QUIT" {
                    write.write_all(b"221 bye\r\n").await.unwrap();
                    break;
                } else {
                    "250 ok\r\n"
                };
                write.write_all(reply.as_bytes()).await.unwrap();
            }
        }
    });
    let hook = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let hook_port = hook.local_addr().unwrap().port();
    let (hook_tx, mut hook_rx) = mpsc::channel(10);
    let fail_hook = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let fail_receiver = fail_hook.clone();
    let app = axum::Router::new().route(
        "/",
        axum::routing::post(move |axum::Json(v): axum::Json<Value>| {
            let sender = hook_tx.clone();
            let fail = fail_receiver.clone();
            async move {
                if fail.load(std::sync::atomic::Ordering::SeqCst) {
                    return axum::http::StatusCode::SERVICE_UNAVAILABLE;
                }
                sender.send(v).await.unwrap();
                axum::http::StatusCode::NO_CONTENT
            }
        }),
    );
    let hook_task = tokio::spawn(async move {
        axum::serve(hook, app).await.unwrap();
    });
    std::env::set_var("SIGNALS_SMTP_URL", format!("smtp://127.0.0.1:{smtp_port}"));
    std::env::set_var("SIGNALS_SMTP_FROM", "signals@example.test");
    sqlx::query("UPDATE projects SET analytics_settings=jsonb_set(analytics_settings,'{digest}',$2),analytics_revision=analytics_revision+1 WHERE id=$1").bind(project.id).bind(json!({"enabled":true,"timezone":"UTC","recipient":"owner@example.test","webhook_url":format!("http://127.0.0.1:{hook_port}/")})).execute(&store.pool).await.unwrap();
    let monday = "2026-10-12T07:00:00Z".parse().unwrap();
    delivery::queue(&store, monday).await.unwrap();
    delivery::queue(&store, monday).await.unwrap();
    delivery::flush(&store).await.unwrap();
    let mail = tokio::time::timeout(std::time::Duration::from_secs(5), mail_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(mail.contains("multipart/alternative"));
    assert!(mail.contains("text/plain"));
    assert!(mail.contains("text/html"));
    let hook = hook_rx.recv().await.unwrap();
    assert_eq!(hook["type"], "digest");
    assert_eq!(hook["week"], "2026-W41");
    assert!(mail_rx.try_recv().is_err());
    assert!(hook_rx.try_recv().is_err());
    sqlx::query(
        "INSERT INTO alerts_log(project_id,rule,state,details) VALUES($1,'errors','firing','{}')",
    )
    .bind(project.id)
    .execute(&store.pool)
    .await
    .unwrap();
    delivery::queue(&store, monday).await.unwrap();
    delivery::flush(&store).await.unwrap();
    assert!(mail_rx
        .recv()
        .await
        .unwrap()
        .contains("multipart/alternative"));
    assert_eq!(hook_rx.recv().await.unwrap()["state"], "firing");
    delivery::queue(&store, monday).await.unwrap();
    delivery::flush(&store).await.unwrap();
    assert!(hook_rx.try_recv().is_err());
    let delivered: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notification_outbox WHERE project_id=$1 AND delivered_at IS NOT NULL",
    )
    .bind(project.id)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(delivered, 4);
    // A failed webhook retries without repeating the successful SMTP channel.
    fail_hook.store(true, std::sync::atomic::Ordering::SeqCst);
    sqlx::query(
        "INSERT INTO alerts_log(project_id,rule,state,details) VALUES($1,'errors','ok','{}')",
    )
    .bind(project.id)
    .execute(&store.pool)
    .await
    .unwrap();
    delivery::queue(&store, monday).await.unwrap();
    delivery::flush(&store).await.unwrap();
    assert!(mail_rx
        .recv()
        .await
        .unwrap()
        .contains("multipart/alternative"));
    assert!(hook_rx.try_recv().is_err());
    let pending:i64=sqlx::query_scalar("SELECT count(*) FROM notification_outbox WHERE project_id=$1 AND delivered_at IS NULL AND attempts=1").bind(project.id).fetch_one(&store.pool).await.unwrap();
    assert_eq!(pending, 1);
    fail_hook.store(false, std::sync::atomic::Ordering::SeqCst);
    sqlx::query("UPDATE notification_outbox SET next_attempt_at=now() WHERE project_id=$1 AND delivered_at IS NULL").bind(project.id).execute(&store.pool).await.unwrap();
    delivery::flush(&store).await.unwrap();
    assert_eq!(hook_rx.recv().await.unwrap()["state"], "ok");
    assert!(mail_rx.try_recv().is_err());
    smtp_task.abort();
    hook_task.abort();
    // Leave no channels for later workers in the same isolated test database.
    sqlx::query("UPDATE projects SET deleted_at=now() WHERE id=$1")
        .bind(project.id)
        .execute(&store.pool)
        .await
        .unwrap();
}
