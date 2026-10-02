use crate::{ingest::IngestOutcome, read::EventQuery};
use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use signals_core::Event;
use uuid::Uuid;

/// Event storage and all rollup reads are independent of the HTTP transport.
/// Postgres remains the tenant/auth control plane when another event backend is used.
#[async_trait]
pub trait EventStore: Send + Sync {
    async fn ingest(
        &self,
        project: Uuid,
        events: Vec<(Event, String, String, String)>,
    ) -> Result<IngestOutcome>;
    async fn overview(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value>;
    async fn timeseries(
        &self,
        project: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        daily: bool,
    ) -> Result<Value>;
    async fn tools(&self, project: Uuid, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Value>;
    async fn tool_timeseries(
        &self,
        project: Uuid,
        tool: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        daily: bool,
    ) -> Result<Value>;
    async fn callers(&self, project: Uuid, from: DateTime<Utc>, to: DateTime<Utc>)
        -> Result<Value>;
    async fn caller_timeseries(
        &self,
        project: Uuid,
        caller: i64,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Value>;
    async fn events(&self, project: Uuid, query: EventQuery<'_>) -> Result<Value>;
    async fn sessions(
        &self,
        project: Uuid,
        cursor: Option<(DateTime<Utc>, String)>,
        caller: Option<i64>,
        client: Option<&str>,
    ) -> Result<Value>;
    async fn session_events(
        &self,
        project: Uuid,
        session: &str,
        since: DateTime<Utc>,
        cursor: Option<(DateTime<Utc>, Uuid)>,
    ) -> Result<Value>;
    async fn live_event(&self, project: Uuid, id: Uuid, ts: DateTime<Utc>)
        -> Result<Option<Value>>;
}

#[async_trait]
impl EventStore for crate::Store {
    async fn ingest(
        &self,
        p: Uuid,
        e: Vec<(Event, String, String, String)>,
    ) -> Result<IngestOutcome> {
        self.ingest(p, e).await
    }
    async fn overview(&self, p: Uuid, f: DateTime<Utc>, t: DateTime<Utc>) -> Result<Value> {
        self.overview(p, f, t).await
    }
    async fn timeseries(
        &self,
        p: Uuid,
        f: DateTime<Utc>,
        t: DateTime<Utc>,
        d: bool,
    ) -> Result<Value> {
        self.timeseries(p, f, t, d).await
    }
    async fn tools(&self, p: Uuid, f: DateTime<Utc>, t: DateTime<Utc>) -> Result<Value> {
        self.tools(p, f, t).await
    }
    async fn tool_timeseries(
        &self,
        p: Uuid,
        n: &str,
        f: DateTime<Utc>,
        t: DateTime<Utc>,
        d: bool,
    ) -> Result<Value> {
        self.tool_timeseries(p, n, f, t, d).await
    }
    async fn callers(&self, p: Uuid, f: DateTime<Utc>, t: DateTime<Utc>) -> Result<Value> {
        self.callers(p, f, t).await
    }
    async fn caller_timeseries(
        &self,
        p: Uuid,
        c: i64,
        f: DateTime<Utc>,
        t: DateTime<Utc>,
    ) -> Result<Value> {
        self.caller_timeseries(p, c, f, t).await
    }
    async fn events(&self, p: Uuid, q: EventQuery<'_>) -> Result<Value> {
        self.events(p, q).await
    }
    async fn sessions(
        &self,
        p: Uuid,
        c: Option<(DateTime<Utc>, String)>,
        a: Option<i64>,
        n: Option<&str>,
    ) -> Result<Value> {
        self.sessions(p, c, a, n).await
    }
    async fn session_events(
        &self,
        p: Uuid,
        s: &str,
        f: DateTime<Utc>,
        c: Option<(DateTime<Utc>, Uuid)>,
    ) -> Result<Value> {
        self.session_events(p, s, f, c).await
    }
    async fn live_event(&self, p: Uuid, i: Uuid, t: DateTime<Utc>) -> Result<Option<Value>> {
        self.live_event(p, i, t).await
    }
}
