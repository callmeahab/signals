//! Calls the collector's public delivery clock (`queue(now)`) against a local database.
use anyhow::Context;
use chrono::{DateTime, Utc};
use serde_json::json;
use signals_server::delivery;
use signals_store::Store;
use sqlx::Row;
use std::env;
use std::fs;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = env::var("DATABASE_URL")?;
    let webhook = env::var("WEBHOOK_URL")?;
    let fail_flag = env::var("WEBHOOK_FAIL_FLAG")?;
    let store = Store::connect(&url).await?;
    let tenant = store
        .tenant(&Uuid::new_v4().to_string(), "review-delivery", None)
        .await?;
    let project = store
        .project(tenant, "digest", "<script>&\"probe")
        .await?;
    sqlx::query("UPDATE projects SET analytics_settings = analytics_settings || $2::jsonb WHERE id = $1")
        .bind(project.id)
        .bind(json!({
            "probe_key": "super-secret-probe-key",
            "digest": {
                "enabled": true,
                "timezone": "UTC",
                "recipient": "owner@example.test",
                "webhook_url": webhook
            }
        }))
        .execute(&store.pool)
        .await?;
    let monday: DateTime<Utc> = "2026-10-12T07:00:00Z".parse().unwrap();
    delivery::queue(&store, monday).await.context("digest queue")?;
    delivery::queue(&store, monday).await.context("digest queue again")?;
    delivery::flush(&store).await.context("digest flush")?;

    sqlx::query("INSERT INTO alerts_log(project_id, rule, state, details) VALUES ($1, 'errors', 'firing', '{\"note\":\"transition\"}')")
        .bind(project.id)
        .execute(&store.pool)
        .await?;
    delivery::queue(&store, monday).await?;
    delivery::flush(&store).await.context("alert firing flush")?;
    delivery::queue(&store, monday).await?;
    delivery::flush(&store).await.context("alert firing flush again")?;

    sqlx::query("INSERT INTO alerts_log(project_id, rule, state, details) VALUES ($1, 'errors', 'ok', '{\"note\":\"recovered\"}')")
        .bind(project.id)
        .execute(&store.pool)
        .await?;
    delivery::queue(&store, monday).await?;
    delivery::flush(&store).await.context("alert resolved flush")?;

    // Both channels fail. queue/flush must return rather than panic.
    fs::write(&fail_flag, b"1")?;
    let saved_smtp = env::var("SIGNALS_SMTP_URL")?;
    env::set_var("SIGNALS_SMTP_URL", "smtp://127.0.0.1:1");
    sqlx::query("INSERT INTO alerts_log(project_id, rule, state, details) VALUES ($1, 'latency', 'firing', '{}')")
        .bind(project.id)
        .execute(&store.pool)
        .await?;
    delivery::queue(&store, monday).await.context("failure queue")?;
    delivery::flush(&store).await.context("failure flush")?;
    env::set_var("SIGNALS_SMTP_URL", &saved_smtp);
    fs::remove_file(&fail_flag).ok();
    sqlx::query("UPDATE notification_outbox SET next_attempt_at = now() WHERE project_id = $1 AND delivered_at IS NULL")
        .bind(project.id)
        .execute(&store.pool)
        .await?;
    delivery::flush(&store).await.context("recovery flush")?;

    let rows = sqlx::query(
        "SELECT dedupe_key, channel, attempts, delivered_at IS NOT NULL AS delivered FROM notification_outbox WHERE project_id = $1 ORDER BY id",
    )
    .bind(project.id)
    .fetch_all(&store.pool)
    .await?;
    let outbox: Vec<_> = rows
        .iter()
        .map(|r| {
            json!({
                "dedupe_key": r.get::<String, _>("dedupe_key"),
                "channel": r.get::<String, _>("channel"),
                "attempts": r.get::<i32, _>("attempts"),
                "delivered": r.get::<bool, _>("delivered"),
            })
        })
        .collect();
    println!(
        "{}",
        json!({"project_id": project.id, "outbox": outbox})
    );
    Ok(())
}
