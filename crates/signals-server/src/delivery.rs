//! Durable, per-channel digest and alert delivery. Network failures retry independently.
use anyhow::Result;
use chrono::{DateTime, Datelike, Duration, Utc};
use chrono_tz::Tz;
use lettre::{message::MultiPart, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde_json::{json, Value};
use signals_store::{
    analytics::{Filters, Window},
    checked_query, Store,
};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// Latest completed ISO week, due Monday 07:00 in the project's timezone.
/// The reporting window is UTC, matching GET digest?week=YYYY-Www.
pub fn due_week(now: DateTime<Utc>, timezone: Tz) -> Option<Window> {
    let local = now.with_timezone(&timezone);
    let monday = local.date_naive() - Duration::days(local.weekday().num_days_from_monday().into());
    let due = monday
        .and_hms_opt(7, 0, 0)?
        .and_local_timezone(timezone)
        .earliest()?;
    if local < due {
        return None;
    }
    let to = monday.and_hms_opt(0, 0, 0)?.and_utc();
    Some(Window {
        from: to - Duration::weeks(1),
        to,
    })
}

async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    project: Uuid,
    key: &str,
    settings: &Value,
    payload: Value,
) -> Result<()> {
    for (channel, field) in [("smtp", "recipient"), ("webhook", "webhook_url")] {
        if let Some(destination) = settings["digest"][field].as_str() {
            checked_query!("INSERT INTO notification_outbox(project_id,dedupe_key,channel,destination,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,dedupe_key,channel) DO NOTHING",project,key,channel,destination,&payload).execute(&mut **tx).await?;
        }
    }
    Ok(())
}

pub async fn queue(store: &Store, now: DateTime<Utc>) -> Result<()> {
    let projects =
        checked_query!("SELECT id,name,analytics_settings FROM projects WHERE deleted_at IS NULL")
            .fetch_all(&store.pool)
            .await?;
    for row in projects {
        let project: Uuid = row.get("id");
        let name: String = row.get("name");
        let settings: Value = row.get("analytics_settings");
        let mut tx = store.pool.begin().await?;
        checked_query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,1397311240))",
            project.to_string()
        )
        .execute(&mut *tx)
        .await?;
        if settings["digest"]["enabled"] == true {
            let timezone = settings["digest"]["timezone"]
                .as_str()
                .unwrap_or("UTC")
                .parse::<Tz>()?;
            if let Some(window) = due_week(now, timezone) {
                let week = window.from.format("%G-W%V").to_string();
                let data = store.analytics_data(project, now).await?;
                enqueue(&mut tx,project,&format!("digest:{week}"),&settings,json!({"type":"digest","project_id":project,"project":name,"week":week,"range":window.json(),"data":data.digest(window,&Filters::default())})).await?;
            }
        }
        let alerts=checked_query!("SELECT id,rule,state,ts,details FROM alerts_log WHERE project_id=$1 AND id>coalesce((SELECT last_id FROM notification_alert_cursor WHERE project_id=$1),0) ORDER BY id",project).fetch_all(&mut *tx).await?;
        for alert in alerts {
            let id: i64 = alert.get("id");
            enqueue(&mut tx,project,&format!("alert:{id}"),&settings,json!({"type":"alert","project_id":project,"project":name,"rule":alert.get::<String,_>("rule"),"state":alert.get::<String,_>("state"),"changed_at":alert.get::<DateTime<Utc>,_>("ts"),"details":alert.get::<Value,_>("details")})).await?;
            checked_query!("INSERT INTO notification_alert_cursor VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET last_id=EXCLUDED.last_id",project,id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
    }
    Ok(())
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn render(payload: &Value) -> (String, String, String) {
    let project = payload["project"].as_str().unwrap_or("Signals");
    let subject = if payload["type"] == "digest" {
        format!(
            "{project} · weekly digest {}",
            payload["week"].as_str().unwrap_or("")
        )
    } else {
        format!(
            "{project} · {}: {}",
            payload["rule"].as_str().unwrap_or("alert"),
            payload["state"].as_str().unwrap_or("")
        )
    };
    let mut text = format!("{subject}\n\n");
    if payload["type"] == "digest" {
        let data = &payload["data"];
        for change in data["changes"].as_array().into_iter().flatten() {
            text.push_str(change.as_str().unwrap_or(""));
            text.push('\n');
        }
        text.push_str("\nTool | Calls (previous; change %) | Success % | p95 ms\n");
        for tool in data["tools"].as_array().into_iter().flatten() {
            text.push_str(&format!(
                "{} | {} ({}; {}) | {} | {}\n",
                tool["tool"].as_str().unwrap_or(""),
                tool["calls"],
                tool["prev"],
                tool["delta_pct"],
                tool["success_rate"],
                tool["p95"]
            ));
        }
        text.push_str(&format!(
            "\nError kinds: {}\nDead tools: {}\nNew identities: {}; returning: {}\n",
            data["top_error_kinds"], data["dead_tools"], data["new"], data["returning"]
        ));
    } else {
        text.push_str(&format!(
            "Changed at: {}\n{}\n",
            payload["changed_at"], payload["details"]
        ));
    }
    let html=format!("<!doctype html><html><body style=\"margin:0;background:#fafaf9;color:#292524;font-family:Arial,sans-serif\"><div style=\"max-width:640px;margin:32px auto;padding:28px;border:1px solid #e7e5e4;border-top:4px solid #ca8a04;background:#fff\"><h1 style=\"font-family:'Krona One',Arial,sans-serif;font-size:22px;color:#a16207\">mcpramen signals</h1><h2 style=\"font-size:18px\">{}</h2><pre style=\"white-space:pre-wrap;overflow-wrap:anywhere;font-family:Arial,sans-serif;line-height:1.6\">{}</pre><p style=\"color:#78716c;font-size:12px\">Null measurements mean no data. Token counts are estimates.</p></div></body></html>",escape(&subject),escape(&text));
    (subject, text, html)
}
async fn deliver(channel: &str, destination: &str, payload: &Value) -> Result<()> {
    if channel == "webhook" {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()?
            .post(destination)
            .json(payload)
            .send()
            .await?
            .error_for_status()?;
    } else {
        let (subject, text, html) = render(payload);
        let message = Message::builder()
            .from(std::env::var("SIGNALS_SMTP_FROM")?.parse()?)
            .to(destination.parse()?)
            .subject(subject)
            .multipart(MultiPart::alternative_plain_html(text, html))?;
        let smtp =
            AsyncSmtpTransport::<Tokio1Executor>::from_url(&std::env::var("SIGNALS_SMTP_URL")?)?
                .timeout(Some(std::time::Duration::from_secs(20)))
                .build();
        smtp.send(message).await?;
    }
    Ok(())
}
pub async fn flush(store: &Store) -> Result<()> {
    // Each transaction holds one row lock during its bounded send, so multiple
    // collector workers cannot concurrently send the same message.
    for _ in 0..100 {
        let mut tx = store.pool.begin().await?;
        let row=checked_query!("SELECT n.id,n.channel,n.destination,n.payload FROM notification_outbox n JOIN projects p ON p.id=n.project_id WHERE n.delivered_at IS NULL AND n.next_attempt_at<=now() AND p.deleted_at IS NULL ORDER BY n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED").fetch_optional(&mut *tx).await?;
        let Some(row) = row else { break };
        let id: i64 = row.get("id");
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            deliver(
                &row.get::<String, _>("channel"),
                &row.get::<String, _>("destination"),
                &row.get::<Value, _>("payload"),
            ),
        )
        .await;
        let success = matches!(result, Ok(Ok(())));
        if !success {
            tracing::warn!(
                notification_id = id,
                "notification delivery failed; retry scheduled"
            );
        }
        checked_query!("UPDATE notification_outbox SET attempts=attempts+1,delivered_at=CASE WHEN $2 THEN now() ELSE NULL END,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",id,success).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    Ok(())
}
pub async fn run(store: &Store) -> Result<()> {
    queue(store, Utc::now()).await?;
    flush(store).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_monday_and_dst() {
        let zone: Tz = "America/New_York".parse().unwrap();
        assert!(due_week("2026-03-09T10:59:59Z".parse().unwrap(), zone).is_none());
        let w = due_week("2026-03-09T11:00:00Z".parse().unwrap(), zone).unwrap();
        assert_eq!(w.from.to_rfc3339(), "2026-03-02T00:00:00+00:00");
        assert!(due_week("2026-11-02T11:59:59Z".parse().unwrap(), zone).is_none());
        assert!(due_week("2026-11-02T12:00:00Z".parse().unwrap(), zone).is_some());
    }
    #[test]
    fn email_escapes_untrusted_text() {
        let (_, text, html) =
            render(&json!({"type":"alert","project":"<script>&","rule":"errors","state":"firing"}));
        assert!(text.contains("<script>"));
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;&amp;"));
    }
}
