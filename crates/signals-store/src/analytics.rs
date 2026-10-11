//! Shared analytics definitions. Windows are half-open and all calendar buckets are UTC.
use crate::{checked_query, checked_query_as, Store};
use anyhow::Result;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use uuid::Uuid;
type DataCache = BTreeMap<Uuid, (i64, Instant, Arc<Data>)>;
static DATA_CACHE: OnceLock<Mutex<DataCache>> = OnceLock::new();

fn capability_names(value: &Value) -> Vec<&str> {
    match value {
        Value::Array(values) => values.iter().filter_map(Value::as_str).collect(),
        Value::Object(values) => values.keys().map(String::as_str).collect(),
        _ => vec![],
    }
}
pub fn identity(c: &Value) -> Option<(String, String)> {
    if c["subject_kind"].is_null() || c["subject_kind"] == "oauth" {
        if let Some(s) = c["subject"].as_str() {
            return Some(("strong".into(), s.into()));
        }
    }
    for (field, kind) in [("key_id", "key"), ("ip_hash", "network")] {
        if let Some(s) = c[field].as_str() {
            return Some((kind.into(), s.into()));
        }
    }
    None
}
pub fn rate(n: usize, d: usize) -> Option<f64> {
    (d > 0).then(|| (n as f64 / d as f64 * 1000.0).round() / 10.0)
}
pub fn histogram(values: impl IntoIterator<Item = i32>) -> Vec<i64> {
    let mut hist = vec![0; 60];
    for v in values {
        let b = ((v.max(1) as f64).ln() / 600000f64.ln() * 59.0).floor() as usize;
        hist[b.min(59)] += 1;
    }
    hist
}
pub fn percentile(hist: &[i64], q: f64) -> Option<i64> {
    let total: i64 = hist.iter().sum();
    if total == 0 {
        return None;
    }
    let rank = (total as f64 * q).ceil().max(1.0) as i64;
    let mut n = 0;
    for (b, count) in hist.iter().enumerate() {
        n += count;
        if n >= rank {
            return Some((600000f64.powf(b as f64 / 59.0)).round() as i64);
        }
    }
    None
}
#[derive(Clone, Debug, FromRow, Serialize, Deserialize)]
pub struct Fact {
    pub ts: DateTime<Utc>,
    pub id: Uuid,
    pub event_type: String,
    pub session_id: Option<String>,
    pub tool: Option<String>,
    pub duration_ms: Option<i32>,
    pub is_error: bool,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub attrs: Value,
    pub client: Option<Value>,
    pub caller: Option<Value>,
}
impl Fact {
    pub fn identity(&self) -> Option<(String, String)> {
        self.caller.as_ref().and_then(identity)
    }
    pub fn call(&self) -> bool {
        self.event_type == "tool.called"
    }
    pub fn number(&self, key: &str) -> Option<i64> {
        self.attrs[key].as_i64().filter(|n| *n >= 0)
    }
    pub fn tokens(&self, divisor: f64) -> Option<f64> {
        self.number("output_chars")
            .or_else(|| self.number("output_bytes"))
            .map(|n| n as f64 / divisor)
    }
}
#[derive(Clone, Default, Debug)]
pub struct Filters {
    pub client: Option<String>,
    pub tool: Option<String>,
    pub caller: Option<String>,
    pub transport: Option<String>,
}
#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}
impl Window {
    pub fn contains(&self, t: DateTime<Utc>) -> bool {
        t >= self.from && t < self.to
    }
    pub fn previous(&self) -> Self {
        Self {
            from: self.from - (self.to - self.from),
            to: self.from,
        }
    }
    pub fn json(&self) -> Value {
        json!({"from":self.from,"to":self.to,"prev_from":self.previous().from,"prev_to":self.from})
    }
    pub fn exact(&self) -> bool {
        self.to - self.from < Duration::hours(6)
    }
}
#[derive(Default)]
pub struct Metrics<'a> {
    pub calls: Vec<&'a Fact>,
}
impl<'a> Metrics<'a> {
    pub fn new(events: impl IntoIterator<Item = &'a Fact>) -> Self {
        Self {
            calls: events.into_iter().filter(|e| e.call()).collect(),
        }
    }
    pub fn errors(&self) -> usize {
        self.calls.iter().filter(|e| e.is_error).count()
    }
    pub fn success(&self) -> Option<f64> {
        rate(self.calls.len() - self.errors(), self.calls.len())
    }
    pub fn latency(&self, exact: bool) -> Value {
        let mut durations: Vec<_> = self.calls.iter().filter_map(|e| e.duration_ms).collect();
        let hist = histogram(durations.iter().copied());
        if exact {
            durations.sort_unstable();
        }
        let p = |q: f64| {
            if exact {
                (!durations.is_empty()).then(|| {
                    i64::from(
                        durations[((durations.len() as f64 * q).ceil() as usize).saturating_sub(1)],
                    )
                })
            } else {
                percentile(&hist, q)
            }
        };
        json!({"p50":p(0.5),"p95":p(0.95),"p99":p(0.99),"method":if exact {"exact"} else {"histogram"}})
    }
    pub fn tokens(&self, divisor: f64) -> Option<i64> {
        let values: Vec<_> = self
            .calls
            .iter()
            .filter_map(|e| e.tokens(divisor))
            .collect();
        (!values.is_empty()).then(|| values.iter().sum::<f64>().round() as i64)
    }
    pub fn average(&self, key: &str) -> Option<i64> {
        let values: Vec<_> = self.calls.iter().filter_map(|e| e.number(key)).collect();
        (!values.is_empty())
            .then(|| (values.iter().sum::<i64>() as f64 / values.len() as f64).round() as i64)
    }
    pub fn error_kinds(&self) -> Value {
        let known = self.calls.iter().any(|e| e.attrs["error_kind"].is_string());
        let count = |kind: &str| {
            self.calls
                .iter()
                .filter(|e| e.attrs["error_kind"] == kind)
                .count()
        };
        json!({"tool":self.calls.iter().filter(|e|e.is_error && (e.attrs["error_kind"].is_null() || e.attrs["error_kind"]=="tool")).count(),"protocol":known.then(||count("protocol")),"timeout":known.then(||count("timeout")),"cancelled":known.then(||count("cancelled")),"unknown":known.then(||self.calls.iter().filter(|e|e.is_error && e.attrs["error_kind"].as_str().is_some_and(|k|!matches!(k,"tool"|"protocol"|"timeout"|"cancelled"))).count())})
    }
    pub fn payload_hist(&self, key: &str) -> Option<Vec<i64>> {
        let mut seen = false;
        let mut h = vec![0; 5];
        for n in self.calls.iter().filter_map(|e| e.number(key)) {
            seen = true;
            h[match n {
                0..1024 => 0,
                1024..4096 => 1,
                4096..16384 => 2,
                16384..65536 => 3,
                _ => 4,
            }] += 1;
        }
        seen.then_some(h)
    }
    pub fn rollup(&self, divisor: f64) -> Value {
        let (retry, corrected) = retries(self.calls.iter().copied());
        json!({"calls":self.calls.len(),"errors":self.errors(),"error_kinds":self.error_kinds(),"cancelled":self.calls.iter().filter(|e|e.attrs["cancelled"]==true).count(),"timeouts":self.error_kinds()["timeout"],"input_bytes_sum":self.sum("input_bytes"),"output_bytes_sum":self.sum("output_bytes"),"output_chars_sum":self.sum("output_chars"),"input_hist":self.payload_hist("input_bytes"),"output_hist":self.payload_hist("output_bytes"),"latency_hist":histogram(self.calls.iter().filter_map(|e|e.duration_ms)),"retries":retry,"self_corrected":corrected,"tokens":self.tokens(divisor)})
    }
    fn sum(&self, key: &str) -> Option<i64> {
        self.average(key)
            .map(|_| self.calls.iter().filter_map(|e| e.number(key)).sum())
    }
}
pub fn retries<'a>(events: impl IntoIterator<Item = &'a Fact>) -> (usize, usize) {
    let mut previous = BTreeMap::new();
    let (mut retries, mut corrected) = (0, 0);
    for e in events {
        if !e.call() {
            continue;
        }
        if let (Some(s), Some(t)) = (&e.session_id, &e.tool) {
            if let Some(prev) = previous.insert((s, t), e) {
                let prev: &Fact = prev;
                if prev.is_error && e.ts - prev.ts <= Duration::seconds(30) {
                    retries += 1;
                    corrected += usize::from(!e.is_error);
                }
            }
        }
    }
    (retries, corrected)
}
pub fn paths<'a>(events: impl IntoIterator<Item = &'a Fact>) -> BTreeMap<Vec<String>, usize> {
    let mut sessions = BTreeMap::<&str, Vec<String>>::new();
    let mut paths = BTreeMap::new();
    for e in events {
        if !e.call() {
            continue;
        }
        if let (Some(s), Some(t)) = (&e.session_id, &e.tool) {
            let seq = sessions.entry(s).or_default();
            seq.push(t.clone());
            for len in [2, 3] {
                if seq.len() >= len {
                    *paths.entry(seq[seq.len() - len..].to_vec()).or_default() += 1;
                }
            }
            if seq.len() > 3 {
                seq.remove(0);
            }
        }
    }
    paths
}
pub fn slo_class<'a>(tool: &str, settings: &'a Value, annotations: &Value) -> &'a str {
    if let Some(class) = settings["slo_classes"][tool].as_str() {
        if matches!(class, "read" | "mutate") {
            return class;
        }
    }
    let flag = |name: &str| {
        annotations[name] == true
            || annotations
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v == name))
    };
    if flag("destructive") || flag("destructiveHint") {
        return "mutate";
    }
    if flag("readOnly") || flag("readOnlyHint") {
        return "read";
    }
    if annotations["readOnly"] == false || annotations["readOnlyHint"] == false {
        return "mutate";
    }
    if [
        "get_",
        "list_",
        "search_",
        "find_",
        "read_",
        "fetch_",
        "describe_",
        "lookup_",
    ]
    .iter()
    .any(|p| tool.starts_with(p))
    {
        "read"
    } else {
        "mutate"
    }
}
#[derive(Clone)]
pub struct Data {
    pub events: Vec<Fact>,
    pub first: BTreeMap<(String, String), DateTime<Utc>>,
    pub settings: Value,
    pub catalog: BTreeMap<String, Value>,
    pub catalog_info: Value,
}
impl Store {
    pub async fn analytics_data(&self, project: Uuid, _to: DateTime<Utc>) -> Result<Arc<Data>> {
        let revision: i64 = crate::checked_query_scalar!(
            "SELECT analytics_revision FROM projects WHERE id=$1",
            project
        )
        .fetch_one(&self.pool)
        .await?;
        let cache = DATA_CACHE.get_or_init(Default::default);
        {
            let guard = cache.lock().unwrap();
            if let Some((version, loaded, data)) = guard.get(&project) {
                if *version == revision && loaded.elapsed().as_secs() < 60 {
                    return Ok(data.clone());
                }
            }
        }
        let to = DateTime::<Utc>::MAX_UTC;
        let events=checked_query_as!("SELECT ts,id,type AS event_type,session_id,tool,duration_ms,is_error,client_name,client_version,attrs,client,caller FROM events WHERE project_id=$1 AND ts<$2 ORDER BY ts,id",project,to).fetch_all(&self.pool).await?;
        let settings: Value = crate::checked_query_scalar!(
            "SELECT analytics_settings FROM projects WHERE id=$1",
            project
        )
        .fetch_one(&self.pool)
        .await?;
        let mut first = BTreeMap::new();
        for r in checked_query!(
            "SELECT kind,identity_key,first_seen FROM identities WHERE project_id=$1",
            project
        )
        .fetch_all(&self.pool)
        .await?
        {
            first.insert((r.get("kind"), r.get("identity_key")), r.get("first_seen"));
        }
        let mut catalog = BTreeMap::new();
        for r in checked_query!("SELECT c.tool,c.annotations FROM tool_catalog c JOIN catalog_snapshots s ON s.project_id=c.project_id AND c.tool=ANY(s.tools) WHERE c.project_id=$1",project).fetch_all(&self.pool).await? {catalog.insert(r.get("tool"),r.get::<Option<Value>,_>("annotations").unwrap_or(Value::Null));}
        let snapshot = checked_query!(
            "SELECT ts,catalog_hash FROM catalog_snapshots WHERE project_id=$1",
            project
        )
        .fetch_optional(&self.pool)
        .await?;
        let catalog_info = match snapshot {
            Some(r) => {
                json!({"known":true,"catalog_hash":r.get::<Option<String>,_>("catalog_hash"),"updated_at":r.get::<DateTime<Utc>,_>("ts")})
            }
            None => json!({"known":false,"catalog_hash":null,"updated_at":null}),
        };
        let data = Arc::new(Data {
            events,
            first,
            settings,
            catalog,
            catalog_info,
        });
        {
            let mut cache = cache.lock().unwrap();
            if cache.len() >= 32 {
                let oldest = cache.iter().min_by_key(|(_, v)| v.1).map(|(p, _)| *p);
                if let Some(p) = oldest {
                    cache.remove(&p);
                }
            }
            cache.insert(project, (revision, Instant::now(), data.clone()));
        }
        Ok(data)
    }
}
impl Data {
    pub fn divisor(&self) -> f64 {
        self.settings["token_divisor"].as_f64().unwrap_or(4.0)
    }
    pub fn target(&self, class: &str) -> f64 {
        self.settings["slo_targets"][class]
            .as_f64()
            .unwrap_or(if class == "read" { 99.5 } else { 98.0 })
    }
    pub fn class(&self, tool: &str) -> &str {
        slo_class(
            tool,
            &self.settings,
            self.catalog.get(tool).unwrap_or(&Value::Null),
        )
    }
    pub fn selected<'a>(&'a self, w: Window, f: &Filters) -> Vec<&'a Fact> {
        let transports: BTreeMap<_, _> = if f.transport.is_some() {
            self.events
                .iter()
                .filter_map(|e| Some((e.session_id.as_ref()?, e.attrs["transport"].as_str()?)))
                .collect()
        } else {
            BTreeMap::new()
        };
        let start = self.events.partition_point(|e| e.ts < w.from);
        let end = self.events.partition_point(|e| e.ts < w.to);
        self.events[start..end]
            .iter()
            .filter(|e| {
                w.contains(e.ts)
                    && f.client
                        .as_ref()
                        .is_none_or(|v| e.client_name.as_ref() == Some(v))
                    && f.tool.as_ref().is_none_or(|v| e.tool.as_ref() == Some(v))
                    && f.caller
                        .as_ref()
                        .is_none_or(|v| e.identity().is_some_and(|(_, k)| k == *v))
                    && f.transport.as_ref().is_none_or(|v| {
                        e.attrs["transport"].as_str().or_else(|| {
                            e.session_id
                                .as_ref()
                                .and_then(|s| transports.get(s).copied())
                        }) == Some(v.as_str())
                    })
            })
            .collect()
    }
    pub fn by_kind(&self, events: &[&Fact]) -> Value {
        let ids: BTreeSet<_> = events.iter().filter_map(|e| e.identity()).collect();
        json!({"strong":ids.iter().filter(|i|i.0=="strong").count(),"key":ids.iter().filter(|i|i.0=="key").count(),"network":ids.iter().filter(|i|i.0=="network").count()})
    }
    pub fn funnel(&self, w: Window, events: &[&Fact]) -> Vec<Value> {
        let mut people = BTreeMap::<(String, String), (bool, bool, usize, bool)>::new();
        for e in events {
            if let Some(id) = e.identity() {
                if let Some(first) = self.first.get(&id).filter(|t| w.contains(**t)) {
                    let p = people.entry(id).or_default();
                    p.0 |= e.event_type == "session.started";
                    p.1 |= e.event_type == "tools.listed"
                        || (e.event_type == "mcp.request" && e.attrs["method"] == "tools/list");
                    p.2 += usize::from(e.call());
                    p.3 |= e.ts >= *first + Duration::days(7);
                }
            }
        }
        let counts = [
            people.values().filter(|p| p.0).count(),
            people.values().filter(|p| p.1).count(),
            people.values().filter(|p| p.2 >= 1).count(),
            people.values().filter(|p| p.2 >= 5).count(),
            people.values().filter(|p| p.3).count(),
        ];
        [
            "connected",
            "listed_tools",
            "first_call",
            "five_calls",
            "returned_day_7",
        ]
        .iter()
        .zip(counts)
        .map(|(step, count)| json!({"step":step,"count":count}))
        .collect()
    }
    pub fn cohorts(&self, w: Window, f: &Filters) -> Vec<Value> {
        let first_day = w.from.date_naive()
            - Duration::days(i64::from(w.from.weekday().num_days_from_monday()));
        let events = self.selected(
            Window {
                from: first_day.and_hms_opt(0, 0, 0).unwrap().and_utc(),
                to: w.to,
            },
            f,
        );
        let ids: BTreeSet<_> = events.iter().filter_map(|e| e.identity()).collect();
        let mut cohorts = BTreeMap::<NaiveDate, Vec<&(String, String)>>::new();
        for id in &ids {
            if let Some(t) = self.first.get(id) {
                let d =
                    t.date_naive() - Duration::days(i64::from(t.weekday().num_days_from_monday()));
                cohorts.entry(d).or_default().push(id);
            }
        }
        cohorts
            .into_iter()
            .filter(|(d, _)| *d >= w.from.date_naive() - Duration::days(6))
            .map(|(start, ids)| {
                let mut retention = Vec::new();
                let mut week = 0;
                while start + Duration::weeks(week) < w.to.date_naive() {
                    let from = start + Duration::weeks(week);
                    let to = from + Duration::weeks(1);
                    if to > w.to.date_naive() {
                        retention.push(Value::Null);
                    } else {
                        let active: BTreeSet<_> = events
                            .iter()
                            .filter(|e| e.ts.date_naive() >= from && e.ts.date_naive() < to)
                            .filter_map(|e| e.identity())
                            .collect();
                        retention.push(json!(rate(
                            ids.iter().filter(|id| active.contains(**id)).count(),
                            ids.len()
                        )));
                    }
                    week += 1;
                }
                json!({"cohort_start":start,"size":ids.len(),"retained_pct":retention})
            })
            .collect()
    }
    pub fn tools(&self, w: Window, events: &[&Fact]) -> Value {
        let mut grouped = BTreeMap::<String, Vec<&Fact>>::new();
        for t in self.catalog.keys() {
            grouped.insert(t.clone(), vec![]);
        }
        for e in events.iter().filter(|e| e.call()) {
            if let Some(t) = &e.tool {
                grouped.entry(t.clone()).or_default().push(e);
            }
        }
        let used = grouped.values().filter(|es| !es.is_empty()).count();
        let dead: Vec<_> = grouped
            .iter()
            .filter(|(t, es)| es.is_empty() && self.catalog.contains_key(*t))
            .map(|(t, _)| t)
            .collect();
        let tools:Vec<_>=grouped.iter().map(|(tool,es)|{let m=Metrics::new(es.iter().copied());let(r,c)=retries(es.iter().copied());let mut days=BTreeMap::<NaiveDate,(usize,usize)>::new();for e in es {let d=days.entry(e.ts.date_naive()).or_default();d.0+=1;d.1+=usize::from(e.is_error);}let schema=|key:&str|es.iter().any(|e|e.attrs[key].is_boolean()).then(||es.iter().filter(|e|e.attrs[key]==false).count());
            json!({"tool":tool,"slo_class":self.class(tool),"calls":es.len(),"success_rate":m.success(),"errors":m.error_kinds(),"latency":m.latency(w.exact()),"input_bytes_avg":m.average("input_bytes"),"output_bytes_avg":m.average("output_bytes"),"output_tokens_est":m.tokens(self.divisor()).map(|t|(t as f64/es.len() as f64).round() as i64),"retries":{"count":r,"self_corrected_pct":rate(c,r)},"schema_failures":{"input":schema("input_schema_valid"),"output":schema("output_schema_valid")},"trend":days.into_iter().map(|(t,(calls,errors))|json!({"t":t,"calls":calls,"errors":errors})).collect::<Vec<_>>()})
        }).collect();
        let mut paths: Vec<_> = paths(events.iter().copied()).into_iter().collect();
        paths.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let total = paths.iter().map(|p| p.1).sum();
        let mut catalog = self.catalog_info.clone();
        catalog["advertised"] = if catalog["known"] == true {
            json!(self.catalog.len())
        } else {
            Value::Null
        };
        catalog["used"] = json!(used);
        catalog["dead"] = json!(dead);
        json!({"catalog":catalog,"tools":tools,"paths":paths.into_iter().take(20).map(|(sequence,count)|json!({"sequence":sequence,"count":count,"pct":rate(count,total)})).collect::<Vec<_>>()})
    }
    pub fn cost(&self, events: &[&Fact]) -> Value {
        let m = Metrics::new(events.iter().copied());
        let tokens = m.tokens(self.divisor());
        let mut tools = BTreeMap::<&str, Vec<&Fact>>::new();
        let mut tenants = BTreeMap::<(String, String), Vec<&Fact>>::new();
        let mut periods = BTreeMap::<(String, String), Vec<&Fact>>::new();
        for e in &m.calls {
            if let Some(t) = &e.tool {
                tools.entry(t).or_default().push(e);
            }
            if let Some(id) = e.identity() {
                periods
                    .entry((e.ts.format("%Y-%m").to_string(), id.1.clone()))
                    .or_default()
                    .push(e);
                tenants.entry(id).or_default().push(e);
            }
        }
        json!({"total_tokens_est":tokens,"per_call":tokens.map(|n|(n as f64/m.calls.len() as f64).round() as i64),"estimated":true,"by_tool":tools.into_iter().map(|(tool,es)|{let t=Metrics::new(es.iter().copied()).tokens(self.divisor());json!({"tool":tool,"calls":es.len(),"tokens":t,"pct":t.zip(tokens).and_then(|(a,b)|rate(a as usize,b as usize))})}).collect::<Vec<_>>(),"by_tenant":tenants.into_iter().map(|((kind,caller),es)|json!({"caller":caller,"identity_kind":kind,"calls":es.len(),"tokens":Metrics::new(es).tokens(self.divisor())})).collect::<Vec<_>>(),"payload_hist":{"buckets":["<1K","1-4K","4-16K","16-64K",">64K"],"input":m.payload_hist("input_bytes"),"output":m.payload_hist("output_bytes")},"billing_periods":periods.into_iter().map(|((period,caller),es)|json!({"period":period,"caller":caller,"calls":es.len(),"tokens":Metrics::new(es).tokens(self.divisor())})).collect::<Vec<_>>()})
    }
    pub fn overview(&self, w: Window, f: &Filters) -> Value {
        let events = self.selected(w, f);
        let prev = self.selected(w.previous(), f);
        let m = Metrics::new(events.iter().copied());
        let pm = Metrics::new(prev.iter().copied());
        let mut grouped = BTreeMap::<&str, Vec<&Fact>>::new();
        for t in self.catalog.keys() {
            grouped.insert(t, vec![]);
        }
        for e in &m.calls {
            if let Some(t) = e.tool.as_deref() {
                grouped.entry(t).or_default().push(e);
            }
        }
        let ids: BTreeSet<_> = events.iter().filter_map(|e| e.identity()).collect();
        let sessions: BTreeSet<_> = events
            .iter()
            .filter_map(|e| e.session_id.as_ref())
            .collect();
        let mut attention:Vec<_>=grouped.into_iter().map(|(tool,es)|{let m=Metrics::new(es);let class=self.class(tool);let target=self.target(class);let status=if m.calls.is_empty(){"dead"}else{let success=100.0*(1.0-m.errors() as f64/m.calls.len() as f64);if success<target{"error"}else if success<=target+1.0{"warn"}else{"ok"}};json!({"tool":tool,"calls":m.calls.len(),"success_rate":m.success(),"p95":m.latency(w.exact())["p95"],"slo_class":class,"status":status})}).collect();
        let rank = |v: &Value| match v["status"].as_str().unwrap() {
            "error" => 0,
            "warn" => 1,
            "dead" => 2,
            _ => 3,
        };
        attention.sort_by(|a, b| {
            rank(a)
                .cmp(&rank(b))
                .then(b["calls"].as_u64().cmp(&a["calls"].as_u64()))
        });
        let mut clients = BTreeMap::<NaiveDate, BTreeMap<&str, usize>>::new();
        for e in &m.calls {
            *clients
                .entry(e.ts.date_naive())
                .or_default()
                .entry(e.client_name.as_deref().unwrap_or("Unknown"))
                .or_default() += 1;
        }
        let mut latency = m.latency(w.exact());
        latency["prev_p95"] = pm.latency(w.exact())["p95"].clone();
        json!({"tiles":{"tool_calls":{"value":m.calls.len(),"prev":pm.calls.len()},"active_users":{"value":ids.len(),"prev":prev.iter().filter_map(|e|e.identity()).collect::<BTreeSet<_>>().len(),"new":ids.iter().filter(|id|self.first.get(*id).is_some_and(|t|w.contains(*t))).count(),"by_kind":self.by_kind(&events)},"sessions":{"value":sessions.len(),"prev":prev.iter().filter_map(|e|e.session_id.as_ref()).collect::<BTreeSet<_>>().len(),"calls_per_session":(!sessions.is_empty()).then(||(m.calls.len() as f64/sessions.len() as f64*10.0).round()/10.0)},"success_rate":{"value":m.success(),"prev":pm.success(),"tools_below_slo":attention.iter().filter(|t|t["status"]=="error").count()},"latency":latency,"context_tokens":{"value":m.tokens(self.divisor()),"per_call":m.tokens(self.divisor()).map(|n|(n as f64/m.calls.len() as f64).round() as i64),"estimated":true}},"calls_by_client":{"buckets":"day","points":clients.into_iter().map(|(t,by_client)|json!({"t":t,"by_client":by_client})).collect::<Vec<_>>()},"funnel":self.funnel(w,&events),"attention":attention,"cohorts":{"kind":"weekly","rows":self.cohorts(w,f)}})
    }
    pub fn adoption(&self, w: Window, f: &Filters) -> Value {
        let events = self.selected(w, f);
        let mut days = BTreeMap::<NaiveDate, Vec<&Fact>>::new();
        for e in &events {
            days.entry(e.ts.date_naive()).or_default().push(e);
        }
        let points:Vec<_>=days.into_iter().map(|(t,es)|{let ids:BTreeSet<_>=es.iter().filter_map(|e|e.identity()).collect();let new=ids.iter().filter(|id|self.first.get(*id).is_some_and(|first|first.date_naive()==t)).count();json!({"t":t,"users":ids.len(),"new":new,"returning":ids.len()-new,"by_kind":self.by_kind(&es)})}).collect();
        let active = |days: i64| {
            self.selected(
                Window {
                    from: w.to - Duration::days(days),
                    to: w.to,
                },
                f,
            )
            .iter()
            .filter_map(|e| e.identity())
            .collect::<BTreeSet<_>>()
            .len()
        };
        let mut clients =
            BTreeMap::<(Option<&str>, Option<&str>), (BTreeSet<&str>, usize, BTreeSet<&str>)>::new(
            );
        let mut protocols = BTreeMap::<&str, BTreeSet<&str>>::new();
        let mut transports = BTreeMap::<&str, BTreeSet<&str>>::new();
        let all_sessions: BTreeSet<_> = events
            .iter()
            .filter_map(|e| e.session_id.as_deref())
            .collect();
        for e in &events {
            let group = clients
                .entry((e.client_name.as_deref(), e.client_version.as_deref()))
                .or_default();
            group.1 += usize::from(e.call());
            if let Some(s) = e.session_id.as_deref() {
                group.0.insert(s);
                if let Some(p) = e
                    .client
                    .as_ref()
                    .and_then(|c| c["protocol_version"].as_str())
                    .or_else(|| e.attrs["requested_protocol_version"].as_str())
                {
                    protocols.entry(p).or_default().insert(s);
                }
                if let Some(t) = e.attrs["transport"].as_str() {
                    transports.entry(t).or_default().insert(s);
                }
            }
            group
                .2
                .extend(capability_names(&e.attrs["client_capabilities"]));
        }
        let retention = |offset: i64| {
            let eligible: Vec<_> = self
                .first
                .iter()
                .filter(|(_, t)| w.contains(**t) && **t + Duration::days(offset + 1) <= w.to)
                .collect();
            let active: BTreeSet<_> = events
                .iter()
                .filter_map(|e| {
                    let id = e.identity()?;
                    let first = self.first.get(&id)?;
                    (e.ts.date_naive() == (*first + Duration::days(offset)).date_naive())
                        .then_some(id)
                })
                .collect();
            rate(
                eligible
                    .iter()
                    .filter(|(id, _)| active.contains(*id))
                    .count(),
                eligible.len(),
            )
        };
        let mut funnel = self.funnel(w, &events);
        let mut previous = None;
        for step in &mut funnel {
            let count = step["count"].as_u64().unwrap() as usize;
            step["dropoff_pct"] = json!(previous.map_or(Some(0.0), |prev: usize| rate(
                prev.saturating_sub(count),
                prev
            )));
            previous = Some(count);
        }
        json!({"active":{"bucket":"day","points":points,"dau":active(1),"wau":active(7),"mau":active(30)},"clients":clients.into_iter().map(|((name,version),(sessions,calls,capabilities))|json!({"name":name,"version":version,"sessions":sessions.len(),"calls":calls,"pct":rate(sessions.len(),all_sessions.len()),"capabilities":capabilities})).collect::<Vec<_>>(),"protocol_versions":protocols.into_iter().map(|(version,sessions)|json!({"version":version,"sessions":sessions.len()})).collect::<Vec<_>>(),"transports":transports.into_iter().map(|(transport,sessions)|json!({"transport":transport,"sessions":sessions.len()})).collect::<Vec<_>>(),"retention":{"daily":{"d1":retention(1),"d7":retention(7),"d30":retention(30)},"weekly":self.cohorts(w,f)},"funnel":{"steps":funnel},"identity_quality":self.by_kind(&events)})
    }
    pub fn reliability(&self, w: Window, f: &Filters) -> Value {
        let events = self.selected(w, f);
        let m = Metrics::new(events.iter().copied());
        let slo:Vec<_>=["read","mutate"].iter().map(|class|{let target=self.target(class);let cm=Metrics::new(events.iter().copied().filter(|e|e.tool.as_ref().is_some_and(|t|self.class(t)==*class)));let burn=|hours|{let es=self.selected(Window{from:w.to-Duration::hours(hours),to:w.to},f);let m=Metrics::new(es.into_iter().filter(|e|e.tool.as_ref().is_some_and(|t|self.class(t)==*class)));(!m.calls.is_empty()).then(||(m.errors() as f64/m.calls.len() as f64)/(1.0-target/100.0))};json!({"class":class,"target":target,"success_rate":cm.success(),"error_budget_pct":(!cm.calls.is_empty()).then(||(((1.0-cm.errors() as f64/cm.calls.len() as f64/(1.0-target/100.0))*1000.0).round()/10.0).clamp(0.0,100.0)),"burn_rate_1h":burn(1),"burn_rate_6h":burn(6)})}).collect();
        let handshakes: Vec<_> = events
            .iter()
            .filter(|e| e.event_type == "mcp.initialize")
            .copied()
            .collect();
        let handshake_known = handshakes.iter().any(|e| e.attrs["is_error"].is_boolean());
        let mut hd: Vec<_> = handshakes.iter().filter_map(|e| e.duration_ms).collect();
        hd.sort_unstable();
        let timeouts = m
            .calls
            .iter()
            .any(|e| e.attrs["error_kind"].is_string())
            .then(|| {
                m.calls
                    .iter()
                    .filter(|e| e.attrs["error_kind"] == "timeout")
                    .count()
            });
        let cancellations = m
            .calls
            .iter()
            .any(|e| e.attrs["cancelled"].is_boolean())
            .then(|| {
                m.calls
                    .iter()
                    .filter(|e| e.attrs["cancelled"] == true)
                    .count()
            });
        let mut codes = BTreeMap::<(i64, Option<&str>), usize>::new();
        let mut auth = BTreeMap::<&str, usize>::new();
        for e in &events {
            if let Some(code) = e.attrs["error_code"].as_i64() {
                *codes
                    .entry((code, e.attrs["error_kind"].as_str()))
                    .or_default() += 1;
            }
            if e.event_type == "error" && e.attrs["where"] == "auth" {
                if let Some(reason) = e.attrs["reason"].as_str() {
                    *auth.entry(reason).or_default() += 1;
                }
            }
        }
        let hallucinated: Vec<_> = m
            .calls
            .iter()
            .filter(|e| e.attrs["error_kind"] == "unknown_tool")
            .collect();
        let sessions: BTreeSet<_> = events
            .iter()
            .filter_map(|e| e.session_id.as_ref())
            .collect();
        let errors: BTreeSet<_> = events
            .iter()
            .filter(|e| e.is_error)
            .filter_map(|e| e.session_id.as_ref())
            .collect();
        let silent = m
            .calls
            .iter()
            .filter(|e| {
                (!e.is_error && e.number("output_bytes") == Some(0))
                    || (e.attrs["cancelled"] == true
                        && e.number("output_bytes").is_some_and(|n| n > 0))
            })
            .count();
        json!({"slo":slo,"handshake":{"attempts":handshakes.len(),"success_rate":handshake_known.then(||rate(handshakes.iter().filter(|e|!e.is_error).count(),handshakes.len())).flatten(),"p95":(!hd.is_empty()).then(||hd[(hd.len() as f64*0.95).ceil() as usize-1])},"timeouts":{"count":timeouts,"pct":timeouts.and_then(|n|rate(n,m.calls.len()))},"cancellations":{"count":cancellations,"pct":cancellations.and_then(|n|rate(n,m.calls.len()))},"error_codes":codes.into_iter().map(|((code,kind),count)|json!({"code":code,"kind":kind,"count":count})).collect::<Vec<_>>(),"hallucinated_tools":{"count":m.calls.iter().any(|e|e.attrs["error_kind"].is_string()).then_some(hallucinated.len()),"names":hallucinated.iter().filter_map(|e|e.tool.as_ref()).collect::<BTreeSet<_>>()},"sessions_with_errors":{"count":errors.len(),"pct":rate(errors.len(),sessions.len())},"silent_failures":{"count":m.calls.iter().any(|e|e.number("output_bytes").is_some()).then_some(silent)},"auth_failures":auth.into_iter().map(|(reason,count)|json!({"reason":reason,"count":count})).collect::<Vec<_>>(),"availability":null})
    }
    pub fn protocol(&self, events: &[&Fact]) -> Value {
        let sessions: BTreeSet<_> = events
            .iter()
            .filter_map(|e| e.session_id.as_ref())
            .collect();
        let capabilities = |side: &str| {
            let mut caps = BTreeMap::<&str, BTreeSet<&str>>::new();
            for e in events {
                if let Some(s) = e.session_id.as_deref() {
                    for k in capability_names(&e.attrs[side]) {
                        caps.entry(k).or_default().insert(s);
                    }
                }
            }
            caps.into_iter().map(|(name,es)|json!({"name":name,"sessions":es.len(),"pct":rate(es.len(),sessions.len())})).collect::<Vec<_>>()
        };
        json!({"capabilities":{"sessions":sessions.len(),"client":capabilities("client_capabilities"),"server":capabilities("server_capabilities")},"sampling":{"requests":null,"p95":null,"rejected_pct":null,"by_model":[]},"elicitation":{"requests":null,"accept_pct":null,"decline_pct":null,"cancel_pct":null},"tasks":{"created":null,"completed":null,"failed":null,"cancelled":null},"progress":{"long_calls":null,"with_progress_pct":null}})
    }
    pub fn digest(&self, w: Window, f: &Filters) -> Value {
        let events = self.selected(w, f);
        let m = Metrics::new(events.iter().copied());
        let ids: BTreeSet<_> = events.iter().filter_map(|e| e.identity()).collect();
        let new = ids
            .iter()
            .filter(|id| self.first.get(*id).is_some_and(|t| w.contains(*t)))
            .count();
        let total = ids.len();
        let calls = m.calls.len();
        let prev_calls = Metrics::new(self.selected(w.previous(), f)).calls.len();
        let tools = self.tools(w, &events);
        let dead = tools["catalog"]["dead"].clone();
        let previous = self.tools(w.previous(), &self.selected(w.previous(), f));
        let tools:Vec<_>=tools["tools"].as_array().unwrap().iter().map(|t|{let prev=previous["tools"].as_array().unwrap().iter().find(|p|p["tool"]==t["tool"]);let prev_calls=prev.and_then(|p|p["calls"].as_i64()).unwrap_or(0);let calls=t["calls"].as_i64().unwrap();json!({"tool":t["tool"],"calls":calls,"prev":prev_calls,"delta_pct":(prev_calls>0).then(||((calls-prev_calls) as f64/prev_calls as f64*1000.0).round()/10.0),"success_rate":t["success_rate"],"p95":t["latency"]["p95"],"errors":t["errors"]})}).collect();
        json!({"tools":tools,"top_error_kinds":m.error_kinds(),"new":new,"returning":total-new,"dead_tools":dead,"changes":[format!("{calls} tool calls, compared with {prev_calls} in the previous week."),format!("{new} new identities and {} returning identities.",total-new)]})
    }
}

impl Store {
    /// Merge complete, clean hourly histograms with raw boundary/dirty hours. This
    /// prevents late events and partially covered hours from being double counted.
    pub async fn analytics_histograms(
        &self,
        project: Uuid,
        w: Window,
        data: &Data,
    ) -> Result<BTreeMap<String, Value>> {
        use chrono::Timelike;
        let watermark: DateTime<Utc> = crate::checked_query_scalar!(
            "SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'"
        )
        .fetch_one(&self.pool)
        .await?;
        let rows=checked_query!("SELECT r.hour,r.tool,r.metrics->'latency_hist' AS hist FROM analytics_hourly r WHERE project_id=$1 AND hour>=$2 AND hour+interval '1 hour'<=$3 AND NOT EXISTS(SELECT 1 FROM events e WHERE e.project_id=r.project_id AND e.ts>=r.hour AND e.ts<r.hour+interval '1 hour' AND e.received_at>$4)",project,w.from,w.to,watermark).fetch_all(&self.pool).await?;
        let mut hist = BTreeMap::<String, Vec<i64>>::new();
        let mut covered = BTreeSet::new();
        for row in rows {
            let tool: String = row.get("tool");
            let hour: DateTime<Utc> = row.get("hour");
            let bins: Value = row.get("hist");
            let h = hist.entry(tool.clone()).or_insert_with(|| vec![0; 60]);
            for (a, b) in h.iter_mut().zip(bins.as_array().into_iter().flatten()) {
                *a += b.as_i64().unwrap_or(0);
            }
            covered.insert((hour, tool));
        }
        for e in data.events.iter().filter(|e| e.call() && w.contains(e.ts)) {
            let hour =
                e.ts.with_minute(0)
                    .unwrap()
                    .with_second(0)
                    .unwrap()
                    .with_nanosecond(0)
                    .unwrap();
            for tool in std::iter::once("").chain(e.tool.as_deref()) {
                if !covered.contains(&(hour, tool.to_owned())) {
                    let h = hist.entry(tool.to_owned()).or_insert_with(|| vec![0; 60]);
                    if let Some(d) = e.duration_ms {
                        let b = ((d.max(1) as f64).ln() / 600000f64.ln() * 59.0).floor() as usize;
                        h[b.min(59)] += 1;
                    }
                }
            }
        }
        Ok(hist.into_iter().map(|(tool,h)|(tool,json!({"p50":percentile(&h,0.5),"p95":percentile(&h,0.95),"p99":percentile(&h,0.99),"method":"histogram"}))).collect())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fact(ts: DateTime<Utc>, kind: &str, tool: &str, error: bool) -> Fact {
        Fact {
            ts,
            id: Uuid::new_v4(),
            event_type: kind.into(),
            session_id: Some("s".into()),
            tool: Some(tool.into()),
            duration_ms: Some(100),
            is_error: error,
            client_name: None,
            client_version: None,
            attrs: json!({}),
            client: None,
            caller: Some(json!({"subject":"a"})),
        }
    }
    #[test]
    fn identity_precedence() {
        assert_eq!(
            identity(&json!({"subject":"a","key_id":"b","ip_hash":"c"})),
            Some(("strong".into(), "a".into()))
        );
        assert_eq!(
            identity(&json!({"subject":"a","subject_kind":"header","key_id":"b"})),
            Some(("key".into(), "b".into()))
        );
        assert_eq!(
            identity(&json!({"ip_hash":"c"})),
            Some(("network".into(), "c".into()))
        );
        assert_eq!(identity(&json!({})), None);
    }
    #[test]
    fn percentile_error_bound() {
        for v in (1..=600000).step_by(31) {
            let p = percentile(&histogram([v]), 0.95).unwrap();
            assert!(
                (p - v as i64).unsigned_abs() as f64 / (v as f64) < 0.26,
                "{v}: {p}"
            );
        }
        assert_eq!(percentile(&histogram([]), 0.95), None);
    }
    #[test]
    fn retry_and_path_boundaries() {
        let now = Utc::now();
        let es = vec![
            fact(now, "tool.called", "a", true),
            fact(now + Duration::seconds(30), "tool.called", "a", false),
            fact(now + Duration::seconds(31), "tool.called", "b", true),
            fact(now + Duration::seconds(62), "tool.called", "b", false),
        ];
        assert_eq!(retries(&es), (1, 1));
        let p = paths(&es);
        assert_eq!(p[&vec!["a".into(), "a".into()]], 1);
        assert_eq!(p[&vec!["a".into(), "a".into(), "b".into()]], 1);
        assert_eq!(p.values().sum::<usize>(), 5);
    }
    #[test]
    fn funnel_and_cohorts() {
        let from = DateTime::parse_from_rfc3339("2026-09-07T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut events = vec![
            fact(from, "session.started", "", false),
            fact(from, "tools.listed", "", false),
        ];
        for i in 0..5 {
            events.push(fact(
                from + Duration::seconds(i + 1),
                "tool.called",
                "a",
                false,
            ));
        }
        events.push(fact(from + Duration::days(7), "session.started", "", false));
        let data = Data {
            events,
            first: BTreeMap::from([(("strong".into(), "a".into()), from)]),
            settings: json!({}),
            catalog: BTreeMap::new(),
            catalog_info: json!({}),
        };
        let w = Window {
            from,
            to: from + Duration::days(21),
        };
        let es = data.selected(w, &Filters::default());
        assert!(data.funnel(w, &es).iter().all(|s| s["count"] == 1));
        assert_eq!(
            data.cohorts(w, &Filters::default())[0]["retained_pct"],
            json!([100.0, 100.0, 0.0])
        );
    }
}
