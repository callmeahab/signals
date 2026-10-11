use chrono::{Duration, Timelike, Utc};
use serde_json::Value;
use signals_store::{analytics::Window, ingest::ensure_partition, Store};
use uuid::Uuid;

const ELIGIBILITY: &str = include_str!("../../signals-store/queries/analytics_histograms.sql");

fn raw_event_relations(plan: &Value, relations: &mut Vec<String>) {
    if let Some(name) = plan["Relation Name"]
        .as_str()
        .filter(|name| name.starts_with("events"))
    {
        relations.push(name.to_owned());
    }
    if let Some(children) = plan["Plans"].as_array() {
        for child in children {
            raw_event_relations(child, relations);
        }
    }
}

#[tokio::test]
#[ignore = "Requires isolated TEST_DATABASE_URL; creates 31 populated daily partitions"]
async fn histogram_eligibility_avoids_raw_partitions_and_tracks_late_arrivals() {
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    assert!(url.contains("127.0.0.1") || url.contains("localhost"));
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let tenant = store
        .tenant(&Uuid::new_v4().to_string(), "Histogram plan", None)
        .await
        .unwrap();
    let project = store
        .project(tenant, "histogram-plan", "Histogram plan")
        .await
        .unwrap()
        .id;
    let to = Utc::now()
        .with_minute(0)
        .unwrap()
        .with_second(0)
        .unwrap()
        .with_nanosecond(0)
        .unwrap();
    let from = to - Duration::days(31);
    let mut tx = store.pool.begin().await.unwrap();
    for day in 0..31 {
        ensure_partition(&mut tx, (from + Duration::days(day)).date_naive())
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO events(project_id,ts,received_at,id,type,tool,duration_ms,is_error,attrs) SELECT $1,$2+g*interval '1 day',clock_timestamp(),gen_random_uuid(),'tool.called','read_item',100,false,'{}'::jsonb FROM generate_series(0,30) g")
        .bind(project).bind(from).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let partitions: i64 =
        sqlx::query_scalar("SELECT count(DISTINCT tableoid) FROM events WHERE project_id=$1")
            .bind(project)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(partitions, 31);
    store.rollup_analytics().await.unwrap();
    let watermark: chrono::DateTime<Utc> = sqlx::query_scalar(
        "SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'",
    )
    .fetch_one(&store.pool)
    .await
    .unwrap();
    let clean = sqlx::query(ELIGIBILITY)
        .bind(project)
        .bind(from)
        .bind(to)
        .bind(watermark)
        .fetch_all(&store.pool)
        .await
        .unwrap();
    assert_eq!(clean.len(), 62); // project and tool scope for each hour
    sqlx::query("ANALYZE events")
        .execute(&store.pool)
        .await
        .unwrap();
    sqlx::query("ANALYZE analytics_hourly")
        .execute(&store.pool)
        .await
        .unwrap();
    for cursor in [chrono::DateTime::<Utc>::UNIX_EPOCH, watermark] {
        let plan: Value = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {ELIGIBILITY}"
        )))
        .bind(project)
        .bind(from)
        .bind(to)
        .bind(cursor)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        let mut raw = Vec::new();
        raw_event_relations(&plan[0]["Plan"], &mut raw);
        assert!(
            raw.is_empty(),
            "Raw-event relations in eligibility plan: {raw:?}: {plan}"
        );
    }
    // A late arrival dirties both scopes for exactly one already-rolled hour.
    let hour = from + Duration::days(15);
    sqlx::query("INSERT INTO events(project_id,ts,received_at,id,type,tool,duration_ms,is_error,attrs) VALUES($1,$2,clock_timestamp(),$3,'tool.called','read_item',10000,false,'{}'::jsonb)")
        .bind(project).bind(hour + Duration::minutes(1)).bind(Uuid::new_v4()).execute(&store.pool).await.unwrap();
    let dirty = sqlx::query(ELIGIBILITY)
        .bind(project)
        .bind(from)
        .bind(to)
        .bind(watermark)
        .fetch_all(&store.pool)
        .await
        .unwrap();
    assert_eq!(dirty.len(), 60);
    let window = Window {
        from: hour,
        to: hour + Duration::hours(1),
    };
    let data = store.analytics_data(project, to).await.unwrap();
    let fallback = store
        .analytics_histograms(project, window, &data)
        .await
        .unwrap();
    assert!(fallback[&None]["p95"].as_i64().unwrap() > 1000);
    // A rolled-back arrival must not make metadata dirty.
    let arrived: chrono::DateTime<Utc> = sqlx::query_scalar(
        "SELECT received_at FROM analytics_hourly_arrivals WHERE project_id=$1 AND hour=$2",
    )
    .bind(project)
    .bind(hour)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    let mut tx = store.pool.begin().await.unwrap();
    sqlx::query("INSERT INTO events(project_id,ts,received_at,id,type,tool,duration_ms,is_error,attrs) VALUES($1,$2,clock_timestamp(),$3,'tool.called','read_item',1,false,'{}'::jsonb)")
        .bind(project).bind(hour + Duration::minutes(2)).bind(Uuid::new_v4()).execute(&mut *tx).await.unwrap();
    tx.rollback().await.unwrap();
    let after: chrono::DateTime<Utc> = sqlx::query_scalar(
        "SELECT received_at FROM analytics_hourly_arrivals WHERE project_id=$1 AND hour=$2",
    )
    .bind(project)
    .bind(hour)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(arrived, after);
    store.rollup_analytics().await.unwrap();
    assert_eq!(
        fallback,
        store
            .analytics_histograms(project, window, &data)
            .await
            .unwrap()
    );
    // Retention may remove every raw row without losing eligibility information.
    sqlx::query("DELETE FROM events WHERE project_id=$1")
        .bind(project)
        .execute(&store.pool)
        .await
        .unwrap();
    let data = store.analytics_data(project, to).await.unwrap();
    assert_eq!(
        fallback,
        store
            .analytics_histograms(project, window, &data)
            .await
            .unwrap()
    );
    sqlx::query("INSERT INTO analytics_hourly_arrivals VALUES($1,$2,$3)")
        .bind(project)
        .bind(to - Duration::days(401))
        .bind(to)
        .execute(&store.pool)
        .await
        .unwrap();
    store.maintain().await.unwrap();
    let retained: i64 =
        sqlx::query_scalar("SELECT count(*) FROM analytics_hourly_arrivals WHERE project_id=$1")
            .bind(project)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(retained, 31);
    println!("PASS 31 populated daily partitions: no raw-event plan nodes, late-arrival fallback, rollback atomicity, raw retention and metadata cleanup");
}
