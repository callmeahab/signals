//! Shared analytics definitions. Windows are half-open and all calendar buckets are UTC.
use crate::{checked_query, checked_query_as, Store};
use anyhow::Result;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use uuid::Uuid;
type DataCache = BTreeMap<Uuid, (i64, Instant, Arc<Data>)>;
static DATA_CACHE: OnceLock<Mutex<DataCache>> = OnceLock::new();

fn identity_counts(ids: &BTreeSet<(String, String)>) -> Value {
    json!({"strong":ids.iter().filter(|i|i.0=="strong").count(),"key":ids.iter().filter(|i|i.0=="key").count(),"network":ids.iter().filter(|i|i.0=="network").count()})
}

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
pub fn histogram_buckets(hist: &[i64]) -> Value {
    if hist.iter().sum::<i64>() == 0 {
        return Value::Null;
    }
    let mut edges: Vec<Value> = (0..60)
        .map(|b| json!(600000f64.powf(b as f64 / 59.0)))
        .collect();
    edges.push(Value::Null);
    json!({"edges":edges,"counts":hist})
}
pub fn merge_histogram(target: &mut [i64], source: &[i64]) {
    for (a, b) in target.iter_mut().zip(source) {
        *a += b;
    }
}
fn histogram_latency(hist: &[i64]) -> Value {
    json!({"p50":percentile(hist,0.5),"p95":percentile(hist,0.95),"p99":percentile(hist,0.99),"method":"histogram","buckets":histogram_buckets(hist)})
}
fn series_bucket(w: Window, t: DateTime<Utc>) -> DateTime<Utc> {
    if w.to - w.from <= Duration::hours(48) {
        t.with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap()
            .with_nanosecond(0)
            .unwrap()
    } else {
        t.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc()
    }
}
fn latency_series(w: Window, values: BTreeMap<DateTime<Utc>, Value>) -> Value {
    if values.values().all(|v| v["p95"].is_null()) {
        return Value::Null;
    }
    let method = values.values().next().unwrap()["method"].clone();
    let hourly = w.to - w.from <= Duration::hours(48);
    let mut t = series_bucket(w, w.from);
    let mut points = Vec::new();
    while t < w.to {
        let v = values.get(&t).cloned().unwrap_or(Value::Null);
        points.push(json!({"t":t,"p50":v["p50"],"p95":v["p95"],"p99":v["p99"]}));
        t += if hourly {
            Duration::hours(1)
        } else {
            Duration::days(1)
        };
    }
    json!({"bucket":if hourly {"hour"} else {"day"},"method":method,"points":points})
}
pub fn latency_sparkline(series: &Value) -> Value {
    series["points"]
        .as_array()
        .map(|points| json!(points.iter().map(|p| p["p95"].clone()).collect::<Vec<_>>()))
        .unwrap_or(Value::Null)
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
        json!({"p50":p(0.5),"p95":p(0.95),"p99":p(0.99),"method":if exact {"exact"} else {"histogram"},"buckets":histogram_buckets(&hist)})
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
        let schema = |key: &str| {
            self.calls
                .iter()
                .any(|e| e.attrs[key].is_boolean())
                .then(|| self.calls.iter().filter(|e| e.attrs[key] == false).count())
        };
        json!({"calls":self.calls.len(),"errors":self.errors(),"error_kinds":self.error_kinds(),"cancelled":self.calls.iter().filter(|e|e.attrs["cancelled"]==true).count(),"timeouts":self.error_kinds()["timeout"],"input_bytes_sum":self.sum("input_bytes"),"output_bytes_sum":self.sum("output_bytes"),"output_chars_sum":self.sum("output_chars"),"output_items_sum":self.sum("output_items"),"schema_failures":{"input":schema("input_schema_valid"),"output":schema("output_schema_valid")},"input_hist":self.payload_hist("input_bytes"),"output_hist":self.payload_hist("output_bytes"),"latency_hist":histogram(self.calls.iter().filter_map(|e|e.duration_ms)),"retries":retry,"self_corrected":corrected,"tokens":self.tokens(divisor)})
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
        let events=checked_query_as!("SELECT ts,id,type AS event_type,session_id,tool,duration_ms,is_error,client_name,client_version,attrs,client,caller FROM analytics_facts WHERE project_id=$1 AND ts<$2 ORDER BY ts,id",project,to).fetch_all(&self.pool).await?;
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
            "SELECT ts,catalog_hash,truncated,advertised_count FROM catalog_snapshots WHERE project_id=$1",
            project
        )
        .fetch_optional(&self.pool)
        .await?;
        let catalog_info = match snapshot {
            Some(r) => {
                json!({"known":true,"truncated":r.get::<bool,_>("truncated"),"advertised_count":r.get::<Option<i64>,_>("advertised_count"),"catalog_hash":r.get::<Option<String>,_>("catalog_hash"),"updated_at":r.get::<DateTime<Utc>,_>("ts")})
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
        identity_counts(&ids)
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
        // The half-open window cannot observe a return exactly at its upper bound.
        let eligible = people
            .keys()
            .filter(|id| self.first[*id] + Duration::days(7) < w.to)
            .count();
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
        .map(|(step, count)| {
            if *step == "returned_day_7" {
                json!({"step":step,"count":(eligible > 0).then_some(count),"eligible":eligible})
            } else {
                json!({"step":step,"count":count})
            }
        })
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
    pub fn latency_over_time(&self, w: Window, f: &Filters) -> Value {
        let mut groups = BTreeMap::<DateTime<Utc>, Vec<&Fact>>::new();
        for e in self.selected(w, f).into_iter().filter(|e| e.call()) {
            groups.entry(series_bucket(w, e.ts)).or_default().push(e);
        }
        latency_series(
            w,
            groups
                .into_iter()
                .map(|(t, es)| (t, Metrics::new(es).latency(w.exact())))
                .collect(),
        )
    }
    pub fn tools(&self, w: Window, events: &[&Fact]) -> Value {
        let mut grouped = BTreeMap::<String, Vec<&Fact>>::new();
        for t in self.catalog.keys() {
            grouped.insert(t.clone(), vec![]);
        }
        for e in events.iter().filter(|e| e.call()) {
            if let Some(t) = &e.tool {
                if self.catalog_info["known"] != true
                    || self.catalog_info["truncated"] == true
                    || self.catalog.contains_key(t)
                {
                    grouped.entry(t.clone()).or_default().push(e);
                }
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
            catalog["advertised_count"]
                .as_i64()
                .map_or_else(|| json!(self.catalog.len()), |n| json!(n))
        } else {
            Value::Null
        };
        catalog["complete"] = json!(catalog["known"] == true && catalog["truncated"] != true);
        catalog["used"] = json!(used);
        catalog["dead"] = if catalog["truncated"] == true {
            Value::Null
        } else {
            json!(dead)
        };
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
                if self.catalog_info["known"] != true
                    || self.catalog_info["truncated"] == true
                    || self.catalog.contains_key(t)
                {
                    grouped.entry(t).or_default().push(e);
                }
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
        // The identity set already drives active users; reuse it for the quality
        // breakdown instead of parsing and allocating every caller a second time.
        let by_kind = identity_counts(&ids);
        let tokens = m.tokens(self.divisor());
        let mut latency = m.latency(w.exact());
        latency["prev_p95"] = pm.latency(w.exact())["p95"].clone();
        latency["sparkline"] = latency_sparkline(&self.latency_over_time(w, f));
        json!({"tiles":{"tool_calls":{"value":m.calls.len(),"prev":pm.calls.len()},"active_users":{"value":ids.len(),"prev":prev.iter().filter_map(|e|e.identity()).collect::<BTreeSet<_>>().len(),"new":ids.iter().filter(|id|self.first.get(*id).is_some_and(|t|w.contains(*t))).count(),"by_kind":by_kind},"sessions":{"value":sessions.len(),"prev":prev.iter().filter_map(|e|e.session_id.as_ref()).collect::<BTreeSet<_>>().len(),"calls_per_session":(!sessions.is_empty()).then(||(m.calls.len() as f64/sessions.len() as f64*10.0).round()/10.0)},"success_rate":{"value":m.success(),"prev":pm.success(),"tools_below_slo":attention.iter().filter(|t|t["status"]=="error").count()},"latency":latency,"context_tokens":{"value":tokens,"per_call":tokens.map(|n|(n as f64/m.calls.len() as f64).round() as i64),"estimated":true}},"calls_by_client":{"buckets":"day","points":clients.into_iter().map(|(t,by_client)|json!({"t":t,"by_client":by_client})).collect::<Vec<_>>()},"funnel":self.funnel(w,&events),"attention":attention,"cohorts":{"kind":"weekly","rows":self.cohorts(w,f)}})
    }
    /// Distinct identities in the `span`-day window ending at each of `ends`, which
    /// must ascend. One pass over the widest span any end needs, then a two-pointer
    /// slide, so a 90-bucket series costs no more than a 7-bucket one.
    fn rolling_identities(&self, f: &Filters, span: i64, ends: &[DateTime<Utc>]) -> Vec<usize> {
        let (Some(first), Some(last)) = (ends.first(), ends.last()) else {
            return Vec::new();
        };
        let events = self.selected(
            Window {
                from: *first - Duration::days(span),
                to: *last,
            },
            f,
        );
        let mut index = BTreeMap::<(String, String), usize>::new();
        let keys: Vec<Option<usize>> = events
            .iter()
            .map(|e| {
                e.identity().map(|id| {
                    let next = index.len();
                    *index.entry(id).or_insert(next)
                })
            })
            .collect();
        let mut live = vec![0usize; index.len()];
        let (mut left, mut right, mut distinct) = (0, 0, 0);
        ends.iter()
            .map(|end| {
                while right < events.len() && events[right].ts < *end {
                    if let Some(i) = keys[right] {
                        live[i] += 1;
                        distinct += usize::from(live[i] == 1);
                    }
                    right += 1;
                }
                let from = *end - Duration::days(span);
                while left < right && events[left].ts < from {
                    if let Some(i) = keys[left] {
                        live[i] -= 1;
                        distinct -= usize::from(live[i] == 0);
                    }
                    left += 1;
                }
                distinct
            })
            .collect()
    }
    pub fn adoption(&self, w: Window, f: &Filters) -> Value {
        let events = self.selected(w, f);
        let mut days = BTreeMap::<NaiveDate, Vec<&Fact>>::new();
        for e in &events {
            days.entry(e.ts.date_naive()).or_default().push(e);
        }
        // A session belongs to the bucket holding its first selected event, so the
        // per-bucket counts sum to the sessions tile. Nothing carrying a session id
        // leaves the series null rather than a measured zero.
        let mut started = BTreeMap::<NaiveDate, usize>::new();
        let mut sessions = BTreeSet::new();
        for e in &events {
            if let Some(s) = e.session_id.as_deref() {
                if sessions.insert(s) {
                    *started.entry(e.ts.date_naive()).or_default() += 1;
                }
            }
        }
        // Rolling counts end at the bucket end, clamped to the window end so the last
        // bucket reports exactly the headline wau / mau.
        let ends: Vec<DateTime<Utc>> = days
            .keys()
            .map(|t| {
                (*t + Duration::days(1))
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .min(w.to)
            })
            .collect();
        let wau = self.rolling_identities(f, 7, &ends);
        let mau = self.rolling_identities(f, 30, &ends);
        let points:Vec<_>=days.into_iter().enumerate().map(|(i,(t,es))|{let ids:BTreeSet<_>=es.iter().filter_map(|e|e.identity()).collect();let new=ids.iter().filter(|id|self.first.get(*id).is_some_and(|first|first.date_naive()==t)).count();json!({"t":t,"users":ids.len(),"sessions":(!sessions.is_empty()).then(||started.get(&t).copied().unwrap_or(0)),"wau":wau[i],"mau":mau[i],"new":new,"returning":ids.len()-new,"by_kind":self.by_kind(&es)})}).collect();
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
        let total_calls = events.iter().filter(|e| e.call()).count();
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
                .filter(|(_, t)| {
                    w.contains(**t)
                        && (t.date_naive() + Duration::days(offset + 1))
                            .and_hms_opt(0, 0, 0)
                            .unwrap()
                            .and_utc()
                            <= w.to
                })
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
            let count = step["count"].as_u64().map(|v| v as usize);
            step["dropoff_pct"] = json!(count.and_then(|count| previous.map_or(
                Some(0.0),
                |prev: usize| rate(prev.saturating_sub(count), prev)
            )));
            previous = count;
        }
        json!({"active":{"bucket":"day","points":points,"dau":active(1),"wau":active(7),"mau":active(30)},"clients":clients.into_iter().map(|((name,version),(sessions,calls,capabilities))|json!({"name":name,"version":version,"sessions":sessions.len(),"calls":calls,"pct":rate(calls,total_calls),"capabilities":capabilities})).collect::<Vec<_>>(),"protocol_versions":protocols.into_iter().map(|(version,sessions)|json!({"version":version,"sessions":sessions.len()})).collect::<Vec<_>>(),"transports":transports.into_iter().map(|(transport,sessions)|json!({"transport":transport,"sessions":sessions.len()})).collect::<Vec<_>>(),"retention":{"daily":{"d1":retention(1),"d7":retention(7),"d30":retention(30)},"weekly":self.cohorts(w,f)},"funnel":{"steps":funnel},"identity_quality":self.by_kind(&events)})
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
            .filter(|e| {
                e.attrs["error_kind"] == "unknown_tool"
                    || (self.catalog_info["known"] == true
                        && self.catalog_info["truncated"] != true
                        && e.tool
                            .as_ref()
                            .is_some_and(|t| !self.catalog.contains_key(t)))
            })
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
        json!({"latency_over_time":self.latency_over_time(w, f),"slo":slo,"handshake":{"attempts":handshakes.len(),"success_rate":handshake_known.then(||rate(handshakes.iter().filter(|e|e.attrs["is_error"] == false).count(),handshakes.iter().filter(|e|e.attrs["is_error"].is_boolean()).count())).flatten(),"p95":(!hd.is_empty()).then(||hd[(hd.len() as f64*0.95).ceil() as usize-1])},"timeouts":{"count":timeouts,"pct":timeouts.and_then(|n|rate(n,m.calls.len()))},"cancellations":{"count":cancellations,"pct":cancellations.and_then(|n|rate(n,m.calls.len()))},"error_codes":codes.into_iter().map(|((code,kind),count)|json!({"code":code,"kind":kind,"count":count})).collect::<Vec<_>>(),"hallucinated_tools":{"count":(self.catalog_info["known"] == true && self.catalog_info["truncated"] != true || m.calls.iter().any(|e|e.attrs["error_kind"].is_string())).then_some(hallucinated.len()),"names":hallucinated.iter().filter_map(|e|e.tool.as_ref()).collect::<BTreeSet<_>>()},"sessions_with_errors":{"count":errors.len(),"pct":rate(errors.len(),sessions.len())},"silent_failures":{"count":m.calls.iter().any(|e|e.number("output_bytes").is_some()).then_some(silent)},"auth_failures":auth.into_iter().map(|(reason,count)|json!({"reason":reason,"count":count})).collect::<Vec<_>>(),"availability":null})
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
        let sampling: Vec<_> = events
            .iter()
            .copied()
            .filter(|e| e.event_type == "sampling.requested")
            .collect();
        let elicitation: Vec<_> = events
            .iter()
            .copied()
            .filter(|e| e.event_type == "elicitation.requested")
            .collect();
        let tasks: Vec<_> = events
            .iter()
            .copied()
            .filter(|e| e.event_type == "task.updated")
            .collect();
        let discovery: Vec<_> = events
            .iter()
            .copied()
            .filter(|e| {
                e.event_type == "tools.listed"
                    || (e.event_type == "mcp.request" && e.attrs["method"] == "tools/list")
            })
            .collect();
        let p95 = |es: &[&Fact]| {
            let mut d: Vec<_> = es.iter().filter_map(|e| e.duration_ms).collect();
            d.sort_unstable();
            (!d.is_empty()).then(|| d[(d.len() as f64 * 0.95).ceil() as usize - 1])
        };
        let mut models = BTreeMap::<&str, usize>::new();
        for e in &sampling {
            if let Some(model) = e.attrs["model"].as_str() {
                *models.entry(model).or_default() += 1;
            }
        }
        let action = |name| {
            rate(
                elicitation
                    .iter()
                    .filter(|e| e.attrs["action"] == name)
                    .count(),
                elicitation
                    .iter()
                    .filter(|e| e.attrs["action"].is_string())
                    .count(),
            )
        };
        let task_count = |status| {
            tasks
                .iter()
                .any(|e| e.attrs["status"].is_string())
                .then(|| tasks.iter().filter(|e| e.attrs["status"] == status).count())
        };
        let created: BTreeSet<_> = tasks
            .iter()
            .filter_map(|e| {
                e.attrs["task_id"]
                    .as_str()
                    .map(|id| (e.session_id.as_deref(), id))
            })
            .collect();
        let long: Vec<_> = events
            .iter()
            .copied()
            .filter(|e| e.call() && e.duration_ms.is_some_and(|n| n >= 1000))
            .collect();
        let progress: Vec<_> = long
            .iter()
            .filter(|e| e.number("progress_events").is_some())
            .collect();
        json!({"capabilities":{"sessions":sessions.len(),"client":capabilities("client_capabilities"),"server":capabilities("server_capabilities")},
          "sampling":{"requests":(!sampling.is_empty()).then_some(sampling.len()),"p95":p95(&sampling),"rejected_pct":rate(sampling.iter().filter(|e|e.attrs["rejected"]==true).count(),sampling.iter().filter(|e|e.attrs["rejected"].is_boolean()).count()),"by_model":models.into_iter().map(|(model,requests)|json!({"model":model,"requests":requests})).collect::<Vec<_>>()},
          "elicitation":{"requests":(!elicitation.is_empty()).then_some(elicitation.len()),"accept_pct":action("accept"),"decline_pct":action("decline"),"cancel_pct":action("cancel")},
          "tasks":{"created":(!created.is_empty()).then_some(created.len()),"completed":task_count("completed"),"failed":task_count("failed"),"cancelled":task_count("cancelled")},
          "progress":{"long_calls":events.iter().any(|e|e.call() && e.number("progress_events").is_some()).then_some(long.len()),"with_progress_pct":rate(progress.iter().filter(|e|e.number("progress_events").is_some_and(|n|n>0)).count(),progress.len())},
          "discovery":{"requests":(!discovery.is_empty()).then_some(discovery.len()),"p95":p95(&discovery),"duration_ms":discovery.iter().any(|e|e.duration_ms.is_some()).then(||discovery.iter().filter_map(|e|e.duration_ms.map(i64::from)).sum::<i64>())}})
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
    ) -> Result<BTreeMap<Option<String>, Value>> {
        Ok(self.analytics_latency_detail(project, w, data).await?.0)
    }
    pub async fn analytics_latency_detail(
        &self,
        project: Uuid,
        w: Window,
        data: &Data,
    ) -> Result<(BTreeMap<Option<String>, Value>, Value)> {
        let watermark: DateTime<Utc> = crate::checked_query_scalar!(
            "SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'"
        )
        .fetch_one(&self.pool)
        .await?;
        let rows = sqlx::query_file!(
            "queries/analytics_histograms.sql",
            project,
            w.from,
            w.to,
            watermark
        )
        .fetch_all(&self.pool)
        .await?;
        let mut hist = BTreeMap::<Option<String>, Vec<i64>>::new();
        let mut series = BTreeMap::<DateTime<Utc>, Vec<i64>>::new();
        let mut covered = BTreeSet::new();
        for row in rows {
            let tool = (!row.is_project).then_some(row.tool);
            let hour = row.hour;
            let bins = row.hist;
            let h = hist.entry(tool.clone()).or_insert_with(|| vec![0; 60]);
            for (a, b) in h.iter_mut().zip(bins.as_array().into_iter().flatten()) {
                *a += b.as_i64().unwrap_or(0);
            }
            if tool.is_none() {
                let h = series
                    .entry(series_bucket(w, hour))
                    .or_insert_with(|| vec![0; 60]);
                let counts: Vec<_> = bins
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|v| v.as_i64().unwrap_or(0))
                    .collect();
                merge_histogram(h, &counts);
            }
            covered.insert((hour, tool));
        }
        // Facts are ordered by timestamp. The previous window is often empty;
        // avoid scanning the current window again just to discover that.
        let start = data.events.partition_point(|e| e.ts < w.from);
        let end = data.events.partition_point(|e| e.ts < w.to);
        for e in data.events[start..end].iter().filter(|e| e.call()) {
            let hour =
                e.ts.with_minute(0)
                    .unwrap()
                    .with_second(0)
                    .unwrap()
                    .with_nanosecond(0)
                    .unwrap();
            for tool in std::iter::once(None).chain(e.tool.as_ref().map(|s| Some(s.clone()))) {
                if !covered.contains(&(hour, tool.to_owned())) {
                    let h = hist.entry(tool.to_owned()).or_insert_with(|| vec![0; 60]);
                    if let Some(d) = e.duration_ms {
                        let b = ((d.max(1) as f64).ln() / 600000f64.ln() * 59.0).floor() as usize;
                        h[b.min(59)] += 1;
                        if tool.is_none() {
                            series
                                .entry(series_bucket(w, hour))
                                .or_insert_with(|| vec![0; 60])[b.min(59)] += 1;
                        }
                    }
                }
            }
        }
        Ok((
            hist.into_iter()
                .map(|(tool, h)| (tool, histogram_latency(&h)))
                .collect(),
            latency_series(
                w,
                series
                    .into_iter()
                    .map(|(t, h)| (t, histogram_latency(&h)))
                    .collect(),
            ),
        ))
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
    fn client_share_measures_calls_not_sessions() {
        let now = Utc::now();
        let mut events = Vec::new();
        for (client, calls) in [("A", 3), ("B", 1), ("Idle", 0)] {
            for i in 0..=calls {
                events.push(Fact {
                    client_name: Some(client.into()),
                    client_version: Some("1".into()),
                    session_id: Some(client.into()),
                    ..fact(
                        now,
                        if i == 0 {
                            "session.started"
                        } else {
                            "tool.called"
                        },
                        "a",
                        false,
                    )
                });
            }
        }
        let mut data = Data {
            events,
            first: BTreeMap::new(),
            settings: json!({}),
            catalog: BTreeMap::new(),
            catalog_info: json!({}),
        };
        let window = Window {
            from: now - Duration::hours(1),
            to: now + Duration::seconds(1),
        };
        let adoption = data.adoption(window, &Filters::default());
        let clients = adoption["clients"].as_array().unwrap();
        assert_eq!(
            clients
                .iter()
                .map(|c| c["sessions"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 1, 1]
        );
        assert_eq!(
            clients
                .iter()
                .map(|c| c["calls"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![3, 1, 0]
        );
        assert_eq!(
            clients
                .iter()
                .map(|c| c["pct"].as_f64().unwrap())
                .collect::<Vec<_>>(),
            vec![75.0, 25.0, 0.0]
        );
        data.events.retain(|e| !e.call());
        assert!(data.adoption(window, &Filters::default())["clients"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["pct"].is_null()));
    }

    #[test]
    fn latency_histogram_edges_merge_and_overflow() {
        let a = histogram([0, 1, 2, 600000, i32::MAX]);
        let b = histogram([100, 120, 500]);
        let mut merged = a.clone();
        merge_histogram(&mut merged, &b);
        assert_eq!(
            merged,
            histogram([0, 1, 2, 600000, i32::MAX, 100, 120, 500])
        );
        assert_eq!(merged.iter().sum::<i64>(), 8);
        let buckets = histogram_buckets(&merged);
        let edges = buckets["edges"].as_array().unwrap();
        assert_eq!(edges.len(), 61);
        assert_eq!(edges[0], 1.0);
        assert_eq!(edges[59], 600000.0);
        assert!(edges[60].is_null());
        for i in 1..60 {
            assert!(edges[i].as_f64().unwrap() > edges[i - 1].as_f64().unwrap());
        }
        assert_eq!(merged[0], 2);
        assert_eq!(merged[59], 2);
        for v in [2, 5, 100, 501, 599999] {
            let h = histogram([v]);
            let bin = h.iter().position(|n| *n == 1).unwrap();
            assert!(edges[bin].as_f64().unwrap() <= f64::from(v));
            assert!(edges[bin + 1].as_f64().unwrap() > f64::from(v));
        }
        assert!(histogram_buckets(&[0; 60]).is_null());
    }
    #[test]
    fn latency_series_gaps_filters_and_methods() {
        let from = DateTime::parse_from_rfc3339("2026-10-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let w = Window {
            from,
            to: from + Duration::hours(3),
        };
        let mut slow = fact(from + Duration::hours(2), "tool.called", "b", false);
        slow.duration_ms = Some(500);
        let data = Data {
            events: vec![fact(from, "tool.called", "a", false), slow],
            first: BTreeMap::new(),
            settings: json!({}),
            catalog: BTreeMap::new(),
            catalog_info: json!({"known":false}),
        };
        let series = data.latency_over_time(w, &Filters::default());
        assert_eq!(series["method"], "exact");
        assert_eq!(series["bucket"], "hour");
        assert_eq!(latency_sparkline(&series), json!([100, null, 500]));
        let filtered = data.latency_over_time(
            w,
            &Filters {
                tool: Some("a".into()),
                ..Default::default()
            },
        );
        assert_eq!(latency_sparkline(&filtered), json!([100, null, null]));
        let daily = data.latency_over_time(
            Window {
                from,
                to: from + Duration::days(3),
            },
            &Filters::default(),
        );
        assert_eq!(daily["bucket"], "day");
        assert_eq!(daily["method"], "histogram");
        assert_eq!(daily["points"].as_array().unwrap().len(), 3);
        assert!(data
            .latency_over_time(w.previous(), &Filters::default())
            .is_null());
    }
    #[test]
    fn catalogue_limits_tool_rows_and_attention_but_preserves_hallucinations() {
        let now = Utc::now();
        let w = Window {
            from: now - Duration::hours(1),
            to: now + Duration::seconds(1),
        };
        let mut known = fact(now, "tool.called", "known", true);
        known.attrs = json!({"error_kind":"unknown_tool"});
        let mut data = Data {
            events: vec![known, fact(now, "tool.called", "outside", true)],
            first: BTreeMap::new(),
            settings: json!({}),
            catalog: BTreeMap::from([("known".into(), json!([])), ("dead".into(), json!([]))]),
            catalog_info: json!({"known":true}),
        };
        let tools = data.tools(w, &data.selected(w, &Filters::default()));
        assert_eq!(tools["catalog"]["used"], 1);
        assert_eq!(tools["catalog"]["dead"], json!(["dead"]));
        assert_eq!(
            tools["tools"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["tool"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["dead", "known"]
        );
        let overview = data.overview(w, &Filters::default());
        assert!(overview["attention"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["tool"] != "outside"));
        assert_eq!(overview["tiles"]["tool_calls"]["value"], 2);
        assert_eq!(
            data.reliability(w, &Filters::default())["hallucinated_tools"],
            json!({"count":2,"names":["known","outside"]})
        );
        data.catalog_info["truncated"] = json!(true);
        let tools = data.tools(w, &data.selected(w, &Filters::default()));
        assert_eq!(tools["catalog"]["complete"], false);
        assert!(tools["catalog"]["dead"].is_null());
        assert_eq!(tools["tools"].as_array().unwrap().len(), 3);
        assert_eq!(
            data.overview(w, &Filters::default())["attention"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            data.reliability(w, &Filters::default())["hallucinated_tools"],
            json!({"count":1,"names":["known"]})
        );
        data.catalog.clear();
        data.catalog_info = json!({"known":true});
        assert_eq!(
            data.tools(w, &data.selected(w, &Filters::default()))["tools"],
            json!([])
        );
        data.catalog_info = json!({"known":false});
        let tools = data.tools(w, &data.selected(w, &Filters::default()));
        assert_eq!(tools["catalog"]["known"], false);
        assert_eq!(tools["catalog"]["used"], 2);
        assert_eq!(tools["tools"].as_array().unwrap().len(), 2);
        assert_eq!(
            data.overview(w, &Filters::default())["attention"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn optional_protocol_metrics_wait_for_their_measurements() {
        let now = Utc::now();
        let mut call = fact(now, "tool.called", "known", false);
        call.duration_ms = Some(2000);
        let mut data = Data {
            events: vec![call],
            first: BTreeMap::new(),
            settings: json!({}),
            catalog: BTreeMap::new(),
            catalog_info: json!({"known":false}),
        };
        let protocol = data.protocol(&data.events.iter().collect::<Vec<_>>());
        assert_eq!(
            protocol["progress"],
            json!({"long_calls":null,"with_progress_pct":null})
        );
        assert!(protocol["sampling"]["requests"].is_null());
        assert!(protocol["elicitation"]["requests"].is_null());
        assert!(protocol["tasks"]["created"].is_null());
        data.events[0].attrs = json!({"progress_events":0});
        assert_eq!(
            data.protocol(&data.events.iter().collect::<Vec<_>>())["progress"],
            json!({"long_calls":1,"with_progress_pct":0.0})
        );
        data.events[0].attrs = json!({"progress_events":3});
        assert_eq!(
            data.protocol(&data.events.iter().collect::<Vec<_>>())["progress"]["with_progress_pct"],
            100.0
        );
        data.events[0].duration_ms = Some(10);
        assert_eq!(
            data.protocol(&data.events.iter().collect::<Vec<_>>())["progress"],
            json!({"long_calls":0,"with_progress_pct":null})
        );
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
    fn day_seven_funnel_requires_observable_identities() {
        let from = DateTime::parse_from_rfc3339("2026-10-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut events = vec![fact(from, "session.started", "", false)];
        let mut missed = fact(from, "session.started", "", false);
        missed.caller = Some(json!({"subject":"missed"}));
        events.push(missed);
        events.push(fact(from + Duration::days(7), "tool.called", "a", false));
        let mut young = fact(from + Duration::days(8), "session.started", "", false);
        young.caller = Some(json!({"subject":"young"}));
        events.push(young);
        let data = Data {
            events,
            first: BTreeMap::from([
                (("strong".into(), "a".into()), from),
                (("strong".into(), "missed".into()), from),
                (("strong".into(), "young".into()), from + Duration::days(8)),
            ]),
            settings: json!({}),
            catalog: BTreeMap::new(),
            catalog_info: json!({}),
        };
        for days in [1, 7, 10] {
            let w = Window {
                from,
                to: from + Duration::days(days),
            };
            let events = data.selected(w, &Filters::default());
            let step = data.funnel(w, &events).pop().unwrap();
            assert_eq!(
                step["count"],
                if days <= 7 { Value::Null } else { json!(1) }
            );
            assert_eq!(step["eligible"], if days <= 7 { 0 } else { 2 });
            let adoption = data.adoption(w, &Filters::default());
            assert_eq!(adoption["funnel"]["steps"][4]["count"], step["count"]);
            if days <= 7 {
                assert!(adoption["funnel"]["steps"][4]["dropoff_pct"].is_null());
            }
        }
    }
    #[test]
    fn retention_uses_completed_utc_anniversary_day() {
        let from = DateTime::parse_from_rfc3339("2026-10-07T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut first = BTreeMap::new();
        let mut events = Vec::new();
        for offset in [1, 7, 30] {
            events.clear();
            first.clear();
            for i in 0..7 {
                // Review's user-late-clock misses D1 despite returning on D2.
                let seen = if i == 6 {
                    from + Duration::days(2) + Duration::hours(6)
                } else {
                    from + Duration::hours(13)
                };
                let id = if i == 6 {
                    "user-late-clock".into()
                } else {
                    format!("key-only-{i}")
                };
                first.insert(("strong".into(), id.clone()), seen);
                let mut e = fact(seen, "session.started", "", false);
                e.caller = Some(json!({"subject":id}));
                events.push(e.clone());
                e.ts = if i == 6 {
                    (seen.date_naive() + Duration::days(offset + 1))
                        .and_hms_opt(8, 30, 0)
                        .unwrap()
                        .and_utc()
                } else {
                    seen + Duration::days(offset)
                };
                events.push(e);
            }
            events.sort_by_key(|e| e.ts);
            let data = Data {
                events: events.clone(),
                first: first.clone(),
                settings: json!({}),
                catalog: BTreeMap::new(),
                catalog_info: json!({}),
            };
            let end = (from.date_naive() + Duration::days(offset + 3))
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc();
            let key = format!("d{offset}");
            for (to, expected) in [
                (end - Duration::milliseconds(1), 100.0),
                (end, 85.7),
                (end + Duration::hours(12), 85.7),
            ] {
                assert_eq!(
                    data.adoption(Window { from, to }, &Filters::default())["retention"]["daily"]
                        [&key],
                    expected
                );
            }
        }
    }
    #[test]
    fn adoption_trend_series() {
        let at = |d: u32, h: u32| {
            NaiveDate::from_ymd_opt(2026, 10, d)
                .unwrap()
                .and_hms_opt(h, 0, 0)
                .unwrap()
                .and_utc()
        };
        let sample = |ts: DateTime<Utc>, session: &str, subject: &str| Fact {
            session_id: Some(session.into()),
            caller: Some(json!({ "subject": subject })),
            ..fact(ts, "tool.called", "a", false)
        };
        let data = Data {
            events: vec![
                sample(at(5, 6), "s0", "a"),
                sample(at(7, 6), "s1", "b"),
                sample(at(7, 7), "s1", "b"),
                sample(at(8, 6), "s2", "a"),
            ],
            first: BTreeMap::from([
                (("strong".into(), "a".into()), at(5, 6)),
                (("strong".into(), "b".into()), at(7, 6)),
            ]),
            settings: json!({}),
            catalog: BTreeMap::new(),
            catalog_info: json!({}),
        };
        let w = Window {
            from: at(7, 0),
            to: at(8, 12),
        };
        let adoption = data.adoption(w, &Filters::default());
        let active = &adoption["active"];
        let points = active["points"].as_array().unwrap();
        assert_eq!(points.len(), 2);
        assert_eq!(
            points[0],
            json!({"t":"2026-10-07","users":1,"sessions":1,"wau":2,"mau":2,"new":1,"returning":0,"by_kind":{"strong":1,"key":0,"network":0}})
        );
        // Rolling counts reach behind the window start and end at the bucket end, so
        // the final bucket reports exactly the headline totals.
        assert_eq!(points[1]["wau"], active["wau"]);
        assert_eq!(points[1]["mau"], active["mau"]);
        assert_eq!(active["dau"], 1);
        for point in points {
            assert!(point["wau"].as_u64().unwrap() >= point["users"].as_u64().unwrap());
            assert!(point["mau"].as_u64().unwrap() >= point["wau"].as_u64().unwrap());
        }
        assert_eq!(
            points
                .iter()
                .map(|p| p["sessions"].as_u64().unwrap())
                .sum::<u64>(),
            2
        );
        // Without session ids the series is null, never a measured zero.
        let mut anonymous = data.clone();
        for e in &mut anonymous.events {
            e.session_id = None;
        }
        assert!(
            anonymous.adoption(w, &Filters::default())["active"]["points"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| p["sessions"].is_null())
        );
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
