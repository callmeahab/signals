//! Profile an isolated 100k-event analytics project, separating cold loading from
//! overview CPU work and histogram reads. DATABASE_URL must point to a disposable
//! local database. Run with `--seed` once, then PROJECT_ID=<printed UUID> to repeat.
use anyhow::Result;
use chrono::{Duration, Utc};
use signals_store::{
    analytics::{Filters, Window},
    ingest::ensure_partition,
    Store,
};
use std::time::Instant;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::var("DATABASE_URL")?;
    anyhow::ensure!(
        url.contains("127.0.0.1") || url.contains("localhost"),
        "Use an isolated local database"
    );
    let store = Store::connect(&url).await?;
    let project = if std::env::args().any(|arg| arg == "--seed") {
        store.migrate().await?;
        let tenant = store
            .tenant(&Uuid::new_v4().to_string(), "Analytics profile", None)
            .await?;
        let project = store
            .project(tenant, "profile", "Analytics profile")
            .await?
            .id;
        let mut tx = store.pool.begin().await?;
        let start = Utc::now() - Duration::days(3);
        for day in 0..=3 {
            ensure_partition(&mut tx, (start + Duration::days(day)).date_naive()).await?;
        }
        sqlx::query("INSERT INTO events(project_id,ts,received_at,id,type,session_id,tool,duration_ms,is_error,client_name,client_version,attrs,client,caller) SELECT $1,$2+(g%250000)*interval '1 second',clock_timestamp(),gen_random_uuid(),'tool.called','bench-'||(g%200),'get_item',(g%5000)+1,g%97=0,'Claude','1.0',jsonb_build_object('input_bytes',100,'output_bytes',400,'output_chars',200,'cancelled',false),'{\"name\":\"Claude\",\"version\":\"1.0\"}'::jsonb,jsonb_build_object('subject','bench-'||(g%100)) FROM generate_series(1,100000) g")
            .bind(project).bind(start).execute(&mut *tx).await?;
        tx.commit().await?;
        store.rollup_analytics().await?;
        println!("PROJECT_ID={project}");
        return Ok(());
    } else {
        std::env::var("PROJECT_ID")?.parse()?
    };
    let to = Utc::now();
    let w = Window {
        from: to - Duration::days(7),
        to,
    };
    for iteration in 0..4 {
        let start = Instant::now();
        let data = store.analytics_data(project, to).await?;
        let loaded = Instant::now();
        let value = data.overview(w, &Filters::default());
        let computed = Instant::now();
        let current = store.analytics_histograms(project, w, &data).await?;
        let current_done = Instant::now();
        let previous = store
            .analytics_histograms(project, w.previous(), &data)
            .await?;
        let done = Instant::now();
        let selected = data.selected(w, &Filters::default());
        let funnel_start = Instant::now();
        let _ = data.funnel(w, &selected);
        let funnel_done = Instant::now();
        let _ = data.cohorts(w, &Filters::default());
        let cohorts_done = Instant::now();
        let _ = data.by_kind(&selected);
        let kinds_done = Instant::now();
        println!(
            "components {}",
            serde_json::json!({"funnel_ms":(funnel_done-funnel_start).as_secs_f64()*1000.0,"cohorts_ms":(cohorts_done-funnel_done).as_secs_f64()*1000.0,"by_kind_ms":(kinds_done-cohorts_done).as_secs_f64()*1000.0})
        );
        println!(
            "{}",
            serde_json::json!({"iteration":iteration,"facts":data.events.len(),"calls":value["tiles"]["tool_calls"]["value"],"load_ms":(loaded-start).as_secs_f64()*1000.0,"overview_ms":(computed-loaded).as_secs_f64()*1000.0,"current_hist_ms":(current_done-computed).as_secs_f64()*1000.0,"previous_hist_ms":(done-current_done).as_secs_f64()*1000.0,"total_ms":(done-start).as_secs_f64()*1000.0,"current_scopes":current.len(),"previous_scopes":previous.len()})
        );
    }
    Ok(())
}
