use crate::Store;
use crate::{checked_query, checked_query_scalar};
use anyhow::Result;
use bytes::{BufMut, BytesMut};
use chrono::{DateTime, NaiveDate, Utc};
use signals_core::{Event, INGEST_LOCK, PARTITION_LOCK};
use sqlx::{Acquire, Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub struct EnrichedEvent {
    pub event: Event,
    pub caller_id: i64,
}
#[derive(Default)]
pub struct IngestOutcome {
    pub accepted: usize,
    pub duplicates: usize,
    pub rejected: Vec<(Uuid, String)>,
}
/// The common path does not take the partition DDL lock. Missing partitions are
/// checked again under the lock so two replicas cannot create the same child.
pub async fn ensure_partition(tx: &mut Transaction<'_, Postgres>, date: NaiveDate) -> Result<()> {
    let name = format!("events_{}", date.format("%Y_%m_%d"));
    if checked_query_scalar!(<_, bool>"SELECT to_regclass($1) IS NOT NULL AS exists" ,&name)
        .fetch_one(&mut **tx)
        .await?
    {
        return Ok(());
    }
    checked_query!("SELECT pg_advisory_xact_lock($1)", PARTITION_LOCK)
        .execute(&mut **tx)
        .await?;
    if !checked_query_scalar!(<_, bool>"SELECT to_regclass($1) IS NOT NULL AS exists" ,&name)
        .fetch_one(&mut **tx)
        .await?
    {
        let end = date.succ_opt().expect("valid date");
        checked_query!("LOCK TABLE events IN ACCESS EXCLUSIVE MODE")
            .execute(&mut **tx)
            .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TABLE {name} (LIKE events INCLUDING DEFAULTS INCLUDING CONSTRAINTS)"
        )))
        .execute(&mut **tx)
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!("WITH moved AS (DELETE FROM events_default WHERE ts >= '{date}'::date AND ts < '{end}'::date RETURNING *) INSERT INTO {name} SELECT * FROM moved"))).execute(&mut **tx).await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE events ATTACH PARTITION {name} FOR VALUES FROM ('{date}') TO ('{end}')"
        )))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
fn field(buf: &mut BytesMut, bytes: Option<&[u8]>) {
    match bytes {
        Some(b) => {
            buf.put_i32(b.len() as i32);
            buf.extend_from_slice(b);
        }
        None => buf.put_i32(-1),
    }
}
fn text(buf: &mut BytesMut, value: Option<&str>) {
    field(buf, value.map(str::as_bytes));
}
fn timestamp(buf: &mut BytesMut, value: DateTime<Utc>) {
    field(
        buf,
        Some(&(value.timestamp_micros() - 946_684_800_000_000).to_be_bytes()),
    );
}
pub fn copy_binary(
    project: Uuid,
    received: DateTime<Utc>,
    events: &[EnrichedEvent],
) -> Result<BytesMut> {
    let mut b = BytesMut::new();
    b.extend_from_slice(b"PGCOPY\n\xff\r\n\0");
    b.put_i32(0);
    b.put_i32(0);
    for row in events {
        let e = &row.event;
        b.put_i16(13);
        field(&mut b, Some(project.as_bytes()));
        timestamp(&mut b, e.ts);
        timestamp(&mut b, received);
        field(&mut b, Some(e.id.as_bytes()));
        text(&mut b, Some(&e.event_type));
        text(&mut b, e.session_id.as_deref());
        field(&mut b, Some(&row.caller_id.to_be_bytes()));
        text(&mut b, e.tool.as_deref());
        match e.duration_ms {
            Some(v) => field(&mut b, Some(&v.to_be_bytes())),
            None => field(&mut b, None),
        }
        field(&mut b, Some(&[u8::from(e.is_error)]));
        text(&mut b, e.client_name.as_deref());
        text(&mut b, e.client_version.as_deref());
        let mut json = vec![1];
        json.extend(serde_json::to_vec(&e.attrs)?);
        field(&mut b, Some(&json));
    }
    b.put_i16(-1);
    Ok(b)
}
fn data_error(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|e| e.code())
        .is_some_and(|c| c.starts_with("22") || matches!(c.as_ref(), "23514" | "23502" | "54000"))
}
async fn copy_insert(
    tx: &mut Transaction<'_, Postgres>,
    project: Uuid,
    received: DateTime<Utc>,
    events: &[EnrichedEvent],
) -> Result<Vec<(Uuid, DateTime<Utc>)>, sqlx::Error> {
    checked_query!(
        "CREATE TEMP TABLE ingest_stage (LIKE events INCLUDING DEFAULTS) ON COMMIT DROP"
    )
    .execute(&mut **tx)
    .await?;
    let payload =
        copy_binary(project, received, events).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    let mut copy=tx.copy_in_raw("COPY ingest_stage(project_id,ts,received_at,id,type,session_id,caller_id,tool,duration_ms,is_error,client_name,client_version,attrs) FROM STDIN WITH (FORMAT binary)").await?;
    copy.send(payload.freeze()).await?;
    copy.finish().await?;
    let rows=checked_query!("INSERT INTO events SELECT * FROM ingest_stage ON CONFLICT(project_id,ts,id) DO NOTHING RETURNING id,ts").fetch_all(&mut **tx).await?;
    Ok(rows.iter().map(|r| (r.get("id"), r.get("ts"))).collect())
}
impl Store {
    pub async fn ingest(
        &self,
        project: Uuid,
        events: Vec<(Event, String, String, String)>,
    ) -> Result<IngestOutcome> {
        if events.is_empty() {
            return Ok(IngestOutcome::default());
        }
        let mut tx = self.pool.begin().await?;
        checked_query!("SELECT pg_advisory_xact_lock_shared($1)", INGEST_LOCK)
            .execute(&mut *tx)
            .await?;
        for date in events
            .iter()
            .map(|r| r.0.ts.date_naive())
            .collect::<BTreeSet<_>>()
        {
            ensure_partition(&mut tx, date).await?;
        }
        let received: DateTime<Utc> = checked_query_scalar!("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        // Resolve distinct identities in bulk; cache only committed caller IDs.
        let mut identities = BTreeMap::new();
        for (e, k, x, l) in &events {
            identities
                .entry((k.clone(), x.clone()))
                .and_modify(|v: &mut (String, DateTime<Utc>, DateTime<Utc>)| {
                    v.1 = v.1.min(e.ts);
                    v.2 = v.2.max(e.ts);
                })
                .or_insert((l.clone(), e.ts, e.ts));
        }
        let mut ids = BTreeMap::new();
        let now = std::time::Instant::now();
        {
            let mut cache = self.caller_cache.lock().await;
            cache.retain(|_, (_, t)| now.duration_since(*t).as_secs() < 300);
            if cache.len() > 8192 {
                cache.clear();
            }
            for identity in identities.keys() {
                if let Some((id, _)) = cache.get(&(project, identity.0.clone(), identity.1.clone()))
                {
                    ids.insert(identity.clone(), *id);
                }
            }
        }
        let missing: Vec<_> = identities
            .iter()
            .filter(|(k, _)| !ids.contains_key(*k))
            .collect();
        if !missing.is_empty() {
            let kinds: Vec<_> = missing.iter().map(|(k, _)| k.0.clone()).collect();
            let externals: Vec<_> = missing.iter().map(|(k, _)| k.1.clone()).collect();
            let labels: Vec<_> = missing.iter().map(|(_, v)| v.0.clone()).collect();
            let first: Vec<_> = missing.iter().map(|(_, v)| v.1).collect();
            let last: Vec<_> = missing.iter().map(|(_, v)| v.2).collect();
            for row in checked_query!("INSERT INTO callers(project_id,kind,external_id,label,first_seen,last_seen) SELECT $1,u.* FROM unnest($2::text[],$3::text[],$4::text[],$5::timestamptz[],$6::timestamptz[]) u ON CONFLICT(project_id,kind,external_id) DO UPDATE SET first_seen=LEAST(callers.first_seen,EXCLUDED.first_seen),last_seen=GREATEST(callers.last_seen,EXCLUDED.last_seen) RETURNING id,kind,external_id" ,project,&kinds,&externals,&labels,&first,&last).fetch_all(&mut *tx).await? {ids.insert((row.get("kind"),row.get("external_id")),row.get::<i64,_>("id"));}
        }
        let cached: Vec<_> = identities
            .iter()
            .filter(|(k, _)| !missing.iter().any(|(m, _)| *m == *k))
            .collect();
        if !cached.is_empty() {
            let caller_ids: Vec<_> = cached.iter().map(|(k, _)| ids[*k]).collect();
            let first: Vec<_> = cached.iter().map(|(_, v)| v.1).collect();
            let last: Vec<_> = cached.iter().map(|(_, v)| v.2).collect();
            checked_query!("UPDATE callers c SET first_seen=LEAST(c.first_seen,u.first_seen),last_seen=GREATEST(c.last_seen,u.last_seen) FROM unnest($1::bigint[],$2::timestamptz[],$3::timestamptz[]) u(id,first_seen,last_seen) WHERE c.id=u.id" ,&caller_ids,&first,&last).execute(&mut *tx).await?;
        }
        let enriched: Vec<_> = events
            .into_iter()
            .map(|(event, k, x, _)| EnrichedEvent {
                event,
                caller_id: ids[&(k, x)],
            })
            .collect();
        let mut inserted = Vec::new();
        let mut rejected = Vec::new();
        let mut fallback = false;
        for attempt in 0..2 {
            let mut savepoint = tx.begin().await?;
            match copy_insert(&mut savepoint, project, received, &enriched).await {
                Ok(rows) => {
                    inserted = rows;
                    savepoint.commit().await?;
                    break;
                }
                Err(e) if data_error(&e) => {
                    savepoint.rollback().await?;
                    if attempt == 1 {
                        fallback = true;
                    } else {
                        for date in enriched
                            .iter()
                            .map(|r| r.event.ts.date_naive())
                            .collect::<BTreeSet<_>>()
                        {
                            ensure_partition(&mut tx, date).await?;
                        }
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        if fallback {
            for row in &enriched {
                let e = &row.event;
                let mut sp = tx.begin().await?;
                let result=checked_query!("INSERT INTO events(project_id,ts,received_at,id,type,session_id,caller_id,tool,duration_ms,is_error,client_name,client_version,attrs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(project_id,ts,id) DO NOTHING RETURNING id,ts" ,project,e.ts,received,e.id,&e.event_type,e.session_id.as_deref(),row.caller_id,e.tool.as_deref(),e.duration_ms,e.is_error,e.client_name.as_deref(),e.client_version.as_deref(),serde_json::json!(e.attrs)).fetch_optional(&mut *sp).await;
                match result {
                    Ok(row) => {
                        if let Some(row) = row {
                            inserted.push((row.get("id"), row.get("ts")));
                        }
                        sp.commit().await?;
                    }
                    Err(err) if data_error(&err) => {
                        sp.rollback().await?;
                        rejected.push((e.id, "storage_invalid".into()));
                    }
                    Err(err) => return Err(err.into()),
                }
            }
        }
        for chunk in inserted.chunks(50) {
            let notice = serde_json::json!({"project":project,"events":chunk.iter().map(|(id,ts)|serde_json::json!({"id":id,"ts":ts})).collect::<Vec<_>>()});
            checked_query!("SELECT pg_notify('signals_live',$1)", notice.to_string())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        {
            let mut cache = self.caller_cache.lock().await;
            for ((k, x), id) in ids {
                cache.insert((project, k, x), (id, now));
            }
        }
        Ok(IngestOutcome {
            accepted: inserted.len(),
            duplicates: enriched.len() - inserted.len() - rejected.len(),
            rejected,
        })
    }
}
