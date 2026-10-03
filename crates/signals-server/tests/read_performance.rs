use chrono::{Duration, Timelike, Utc};
use serde_json::{json, Value};
use signals_store::{ingest::ensure_partition, read::EventQuery, Store};
use sqlx::Row;
use uuid::Uuid;

#[tokio::test]
#[ignore = "Seeds a million rows in disposable TEST_DATABASE_URL; writes bench/artifacts"]
async fn thirty_day_dashboard_measurements() {
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    assert!(url.contains("127.0.0.1") || url.contains("localhost"));
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let reused = if std::env::var("SIGNALS_BENCH_REUSE").as_deref() == Ok("true") {
        Some(
            serde_json::from_str::<Value>(
                &std::fs::read_to_string("bench/artifacts/reads.json").unwrap(),
            )
            .unwrap(),
        )
    } else {
        None
    };
    let (project, from, to, count, callers) = if let Some(report) = reused {
        let project: Uuid = report["project"].as_str().unwrap().parse().unwrap();
        let from = report["from"].as_str().unwrap().parse().unwrap();
        let to = report["to"].as_str().unwrap().parse().unwrap();
        let count = report["seeded_rows"].as_i64().unwrap();
        let callers =
            sqlx::query_scalar::<_, i64>("SELECT id FROM callers WHERE project_id=$1 ORDER BY id")
                .bind(project)
                .fetch_all(&store.pool)
                .await
                .unwrap();
        (project, from, to, count, callers)
    } else {
        let tenant = store
            .tenant(&Uuid::new_v4().simple().to_string(), "Read benchmark", None)
            .await
            .unwrap();
        let project = store
            .project(tenant, "server", "Read benchmark")
            .await
            .unwrap();
        sqlx::query("UPDATE projects SET retention_days=31 WHERE id=$1")
            .bind(project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        let to = Utc::now()
            .with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap()
            .with_nanosecond(0)
            .unwrap();
        let from = to - Duration::days(30);
        let count: i64 = std::env::var("SIGNALS_BENCH_ROWS")
            .unwrap_or_else(|_| "1000000".into())
            .parse()
            .unwrap();
        let mut tx = store.pool.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock_shared($1)")
            .bind(signals_core::INGEST_LOCK)
            .execute(&mut *tx)
            .await
            .unwrap();
        for day in 0..=30 {
            ensure_partition(&mut tx, (from + Duration::days(day)).date_naive())
                .await
                .unwrap();
        }
        let callers:Vec<i64>=sqlx::query_scalar("INSERT INTO callers(project_id,kind,external_id,label,first_seen,last_seen) SELECT $1,'subject','bench-'||n,'Caller '||n,$2,$3 FROM generate_series(1,100) n RETURNING id").bind(project.id).bind(from).bind(to).fetch_all(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO events SELECT $1,$2+(g-1)%720*interval '1 hour'+((g-1)/720)%3600*interval '1 second',clock_timestamp(),gen_random_uuid(),'tool.call','bench-session-'||(((g-1)/720)%200),($4::bigint[])[1+(((g-1)/720)%100)::int],'bench-tool-'||(((g-1)/720)%20),(g%6000)::int,g%97=0,'Bench client','1','{}'::jsonb FROM generate_series(1,$3::bigint) g").bind(project.id).bind(from).bind(count).bind(&callers).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
        (project.id, from, to, count, callers)
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(180);
    loop {
        store.rollup().await.unwrap();
        let total:i64=sqlx::query_scalar("SELECT coalesce(sum(requests),0)::bigint FROM rollup_project_hourly WHERE project_id=$1")
            .bind(project).fetch_one(&store.pool).await.unwrap();
        if total == count {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Worker did not converge to all seeded rows: {total}/{count}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert_eq!(
        store.overview(project, from, to).await.unwrap()["requests"],
        count
    );
    assert_eq!(
        store
            .tools(project, from, to)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        20
    );
    sqlx::query("VACUUM (ANALYZE) events")
        .execute(&store.pool)
        .await
        .unwrap();
    for table in [
        "rollup_project_hourly",
        "rollup_tool_hourly",
        "rollup_caller_daily",
        "callers",
        "sessions",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!("VACUUM (ANALYZE) {table}")))
            .execute(&store.pool)
            .await
            .unwrap();
    }
    let mut timings = serde_json::Map::new();
    for name in [
        "overview",
        "timeseries",
        "tools",
        "tool_timeseries",
        "callers",
        "caller_history",
        "sessions",
        "session_events",
        "events",
    ] {
        let mut samples = Vec::new();
        for n in 0..11 {
            let started = std::time::Instant::now();
            let result: Value = match name {
                "overview" => store.overview(project, from, to).await.unwrap(),
                "timeseries" => store.timeseries(project, from, to, true).await.unwrap(),
                "tools" => store.tools(project, from, to).await.unwrap(),
                "tool_timeseries" => store
                    .tool_timeseries(project, "bench-tool-0", from, to, true)
                    .await
                    .unwrap(),
                "callers" => store.callers(project, from, to).await.unwrap(),
                "caller_history" => store
                    .caller_timeseries(project, callers[0], from, to)
                    .await
                    .unwrap(),
                "sessions" => store.sessions(project, None, None, None).await.unwrap(),
                "session_events" => store
                    .session_events(project, "bench-session-0", from, None)
                    .await
                    .unwrap(),
                _ => store
                    .events(
                        project,
                        EventQuery {
                            kind: None,
                            tool: None,
                            q: None,
                            caller: None,
                            is_error: None,
                            cursor: None,
                            since: from,
                        },
                    )
                    .await
                    .unwrap(),
            };
            std::hint::black_box(result);
            if n > 0 {
                samples.push(started.elapsed().as_secs_f64() * 1000.0);
            }
        }
        samples.sort_by(f64::total_cmp);
        timings.insert(
            name.into(),
            json!({"median_ms":samples[5],"p95_ms":samples[9],"samples_ms":samples}),
        );
    }
    let queries=[
        ("project_rollup","SELECT * FROM rollup_project_hourly WHERE project_id=$1 AND hour>=$2 AND hour<$3 ORDER BY hour"),
        ("tool_rollup","SELECT tool,hour,calls,errors,duration_hist,last_called FROM rollup_tool_hourly WHERE project_id=$1 AND hour>=$2 AND hour<$3"),
        ("caller_rollup","SELECT caller_id,calls,errors,session_ids,clients FROM rollup_caller_daily WHERE project_id=$1 AND day>=$2::timestamptz::date AND day<$3::timestamptz::date"),
        ("session_page","SELECT s.* FROM sessions s WHERE project_id=$1 AND started_at>=$2 AND started_at<$3 ORDER BY started_at DESC,session_id DESC LIMIT 50"),
        ("raw_page","SELECT * FROM events WHERE project_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts DESC,id DESC LIMIT 100")
    ];
    let mut plans = serde_json::Map::new();
    for (name, query) in queries {
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) {query}"
        )))
        .bind(project)
        .bind(from)
        .bind(to)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        plans.insert(name.into(), row.get::<Value, _>(0));
    }
    let report = json!({"seeded_rows":count,"from":from,"to":to,"project":project,"timings":timings,"plans":plans});
    std::fs::create_dir_all("bench/artifacts").unwrap();
    std::fs::write(
        "bench/artifacts/reads.json",
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        serde_json::to_string_pretty(&report["timings"]).unwrap()
    );
    assert!(
        timings
            .values()
            .all(|v| v["p95_ms"].as_f64().unwrap() < 50.0),
        "Read latency target failed; inspect bench/artifacts/reads.json"
    );
}
