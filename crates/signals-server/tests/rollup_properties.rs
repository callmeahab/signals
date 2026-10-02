use chrono::{Duration, Timelike, Utc};
use proptest::{
    prelude::*,
    test_runner::{Config, TestRunner},
};
use signals_core::{CallerIdentity, Event};
use signals_store::Store;
use sqlx::Row;
use uuid::Uuid;

#[test]
#[ignore = "Requires isolated TEST_DATABASE_URL"]
fn random_lateness_matches_brute_force_sql() {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
    assert!(url.contains("127.0.0.1") || url.contains("localhost"));
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let store = runtime.block_on(async {
        let s = Store::connect(&url).await.unwrap();
        s.migrate().await.unwrap();
        s
    });
    let strategy = prop::collection::vec(
        (
            0u16..600,
            0u8..20,
            0u8..30,
            0i32..120000,
            any::<bool>(),
            0u8..6,
        ),
        1..180,
    );
    let mut runner = TestRunner::new(Config {
        cases: 32,
        failure_persistence: None,
        ..Config::default()
    });
    runner.run(&strategy,|input|runtime.block_on(async{
        let tenant=store.tenant(&Uuid::new_v4().simple().to_string(),"Property test",None).await.unwrap();let p=store.project(tenant,"server","Property server").await.unwrap();
        let now=Utc::now().with_minute(0).unwrap().with_second(0).unwrap().with_nanosecond(0).unwrap();
        for (batch_no,chunk) in input.chunks(13).enumerate(){
            let events=chunk.iter().map(|(hours,caller,session,duration,error,kind)|{let identity=format!("caller-{caller}");let event=Event{id:Uuid::new_v4(),ts:now-Duration::hours(i64::from(*hours)),event_type:if *kind==0{"session.start".into()}else if *kind==1{"request".into()}else{"tool.call".into()},session_id:Some(format!("session-{session}")),caller:Some(CallerIdentity{key_id:None,subject:Some(identity.clone())}),tool:Some(format!("tool-{}",caller%4)),duration_ms:Some(*duration),is_error:*error,client_name:Some(format!("client-{}",caller%3)),client_version:None,attrs:Default::default()};(event,"subject".into(),identity.clone(),identity)}).collect();
            let result=store.ingest(p.id,events).await.unwrap();prop_assert_eq!(result.accepted,chunk.len());if batch_no%2==0{store.rollup().await.unwrap();}
        }
        store.rollup().await.unwrap();store.rollup().await.unwrap();
        let raw=sqlx::query("SELECT count(*) FILTER(WHERE type NOT LIKE 'session.%') AS requests,count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error) AS errors,count(*) FILTER(WHERE type='tool.call') AS calls,count(DISTINCT session_id) AS sessions,count(DISTINCT caller_id) AS callers FROM events WHERE project_id=$1").bind(p.id).fetch_one(&store.pool).await.unwrap();
        let summary=store.overview(p.id,now-Duration::days(30),now+Duration::hours(1)).await.unwrap();
        for (api,column)in [("requests","requests"),("errors","errors"),("tool_calls","calls"),("sessions","sessions"),("unique_callers","callers")]{prop_assert_eq!(summary[api].as_i64().unwrap(),raw.get::<i64,_>(column),"metric {}",api);}
        let drift:i64=sqlx::query_scalar("SELECT count(*) FROM rollup_project_hourly r WHERE r.project_id=$1 AND (r.requests,r.errors,r.tool_calls)!=(SELECT count(*) FILTER(WHERE e.type NOT LIKE 'session.%'),count(*) FILTER(WHERE e.type NOT LIKE 'session.%' AND e.is_error),count(*) FILTER(WHERE e.type='tool.call') FROM events e WHERE e.project_id=r.project_id AND e.ts>=r.hour AND e.ts<r.hour+interval '1 hour')").bind(p.id).fetch_one(&store.pool).await.unwrap();prop_assert_eq!(drift,0);
        let durations:Vec<i32>=sqlx::query_scalar("SELECT duration_ms FROM events WHERE project_id=$1 AND type NOT LIKE 'session.%' AND duration_ms IS NOT NULL").bind(p.id).fetch_all(&store.pool).await.unwrap();
        let hist=signals_core::histogram(durations);prop_assert_eq!(summary["p95"].as_f64().unwrap(),signals_core::percentile(&hist,0.95));
        let callers=store.callers(p.id,now-Duration::days(30),now+Duration::hours(1)).await.unwrap();let calls:i64=callers.as_array().unwrap().iter().map(|v|v["calls"].as_i64().unwrap()).sum();prop_assert_eq!(calls,raw.get::<i64,_>("requests"));
        Ok(())
    })).unwrap();
}

#[tokio::test]
#[ignore = "Requires isolated TEST_DATABASE_URL"]
async fn copy_fallback_and_unlimited_session_history() {
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    assert!(url.contains("127.0.0.1") || url.contains("localhost"));
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let tenant = store
        .tenant(&Uuid::new_v4().simple().to_string(), "Fallback test", None)
        .await
        .unwrap();
    let project = store
        .project(tenant, "server", "Fallback server")
        .await
        .unwrap();
    let constraint = format!("fallback_{}", project.id.simple());
    let ddl=format!("ALTER TABLE events ADD CONSTRAINT {constraint} CHECK(project_id <> '{}'::uuid OR duration_ms <> 13) NOT VALID",project.id);
    sqlx::query(sqlx::AssertSqlSafe(ddl))
        .execute(&store.pool)
        .await
        .unwrap();
    let now = Utc::now();
    let event = |duration| Event {
        id: Uuid::new_v4(),
        ts: now,
        event_type: "tool.call".into(),
        session_id: Some("long-session".into()),
        caller: None,
        tool: Some("test".into()),
        duration_ms: Some(duration),
        is_error: false,
        client_name: None,
        client_version: None,
        attrs: Default::default(),
    };
    let outcome = store
        .ingest(
            project.id,
            vec![
                (event(12), "subject".into(), "one".into(), "One".into()),
                (event(13), "subject".into(), "one".into(), "One".into()),
                (event(14), "subject".into(), "one".into(), "One".into()),
            ],
        )
        .await
        .unwrap();
    assert_eq!(outcome.accepted, 2);
    assert_eq!(outcome.rejected.len(), 1);
    assert_eq!(outcome.duplicates, 0);
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "ALTER TABLE events DROP CONSTRAINT {constraint}"
    )))
    .execute(&store.pool)
    .await
    .unwrap();
    for _ in 0..3 {
        let rows = (0..400)
            .map(|_| (event(42), "subject".into(), "one".into(), "One".into()))
            .collect();
        assert_eq!(store.ingest(project.id, rows).await.unwrap().accepted, 400);
    }
    let mut cursor = None;
    let mut ids = std::collections::BTreeSet::new();
    loop {
        let page = store
            .session_events(project.id, "long-session", now - Duration::days(1), cursor)
            .await
            .unwrap();
        for e in page["items"].as_array().unwrap() {
            assert!(ids.insert(e["id"].as_str().unwrap().to_owned()));
        }
        if let Some(next) = page["next_cursor"].as_str() {
            let (ts, id) = next.split_once('|').unwrap();
            cursor = Some((ts.parse().unwrap(), id.parse().unwrap()));
        } else {
            break;
        }
    }
    assert_eq!(ids.len(), 1202);
}

#[tokio::test]
#[ignore = "Requires isolated TEST_DATABASE_URL"]
async fn worker_exclusion_partial_ranges_and_retained_caller_history() {
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    assert!(url.contains("127.0.0.1") || url.contains("localhost"));
    let store = Store::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let tenant = store
        .tenant(&Uuid::new_v4().simple().to_string(), "Boundary test", None)
        .await
        .unwrap();
    let project = store
        .project(tenant, "server", "Boundary server")
        .await
        .unwrap();
    sqlx::query("UPDATE projects SET retention_days=1 WHERE id=$1")
        .bind(project.id)
        .execute(&store.pool)
        .await
        .unwrap();
    let cutoff = Utc::now() - Duration::days(1);
    let day = cutoff.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let old = day + (cutoff - day) / 2;
    let late = cutoff + (day + Duration::days(1) - cutoff) / 2;
    let make = |ts| {
        (
            Event {
                id: Uuid::new_v4(),
                ts,
                event_type: "tool.call".into(),
                session_id: Some("boundary".into()),
                caller: None,
                tool: Some("boundary-tool".into()),
                duration_ms: Some(42),
                is_error: true,
                client_name: Some("Fixture".into()),
                client_version: None,
                attrs: Default::default(),
            },
            "subject".into(),
            "boundary-caller".into(),
            "Boundary".into(),
        )
    };
    store.ingest(project.id, vec![make(old)]).await.unwrap();
    store.rollup().await.unwrap();
    store.maintain().await.unwrap();
    store.ingest(project.id, vec![make(late)]).await.unwrap();
    let before: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    let mut coordinator = store.pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(0x53494703_i64)
        .execute(&mut *coordinator)
        .await
        .unwrap();
    let (a, b) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(store.rollup(), store.maintain())
    })
    .await
    .unwrap();
    a.unwrap();
    b.unwrap();
    let after: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(before, after);
    coordinator.commit().await.unwrap();
    let (a, b) = tokio::join!(store.rollup(), store.rollup());
    a.unwrap();
    b.unwrap();
    store.rollup().await.unwrap();
    let overview = store
        .overview(project.id, day, day + Duration::days(1))
        .await
        .unwrap();
    assert_eq!(
        overview["requests"], 2,
        "Retention must preserve the partial UTC day while late arrivals can still recompute it"
    );
    let from = late - Duration::seconds(1);
    let to = late + Duration::seconds(1);
    let partial = store.overview(project.id, from, to).await.unwrap();
    assert_eq!(partial["requests"], 1);
    let tools = store.tools(project.id, from, to).await.unwrap();
    assert_eq!(tools[0]["calls"], 1);
    let points = store
        .tool_timeseries(project.id, "boundary-tool", from, to, false)
        .await
        .unwrap();
    assert_eq!(points[0]["requests"], 1);
    assert_eq!(
        points[0]["ts"],
        serde_json::json!(late
            .with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap()
            .with_nanosecond(0)
            .unwrap())
    );
    let callers = store
        .callers(project.id, day, day + Duration::days(1))
        .await
        .unwrap();
    assert_eq!(callers[0]["calls"], 2);
    let caller = callers[0]["id"].as_str().unwrap().parse::<i64>().unwrap();
    sqlx::query("DELETE FROM events WHERE project_id=$1")
        .bind(project.id)
        .execute(&store.pool)
        .await
        .unwrap();
    let history = store
        .caller_timeseries(
            project.id,
            caller,
            day - Duration::days(2),
            day + Duration::days(1),
        )
        .await
        .unwrap();
    assert_eq!(
        history
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["requests"].as_i64().unwrap())
            .sum::<i64>(),
        2,
        "Daily history must survive raw expiry"
    );
}
