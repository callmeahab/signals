pub mod wire;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use uuid::Uuid;

pub const MAX_EVENTS: usize = 1000;
pub const MAX_BODY: usize = 1_048_576;
pub const INGEST_LOCK: i64 = 0x53494701;
pub const PARTITION_LOCK: i64 = 0x53494702;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallerIdentity {
    pub key_id: Option<String>,
    pub subject: Option<String>,
}
/// Internal normalized event. Wire deserialization uses the generated `wire` module.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub id: Uuid,
    pub ts: DateTime<Utc>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: Option<String>,
    pub caller: Option<CallerIdentity>,
    pub tool: Option<String>,
    pub duration_ms: Option<i32>,
    #[serde(default)]
    pub is_error: bool,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    #[serde(default)]
    pub attrs: Map<String, Value>,
}
impl TryFrom<wire::WireEvent> for Event {
    type Error = &'static str;
    fn try_from(e: wire::WireEvent) -> Result<Self, Self::Error> {
        Ok(Self {
            id: e.id,
            ts: e.ts,
            event_type: e.type_.to_string(),
            session_id: e.session_id.map(Into::into),
            caller: e.caller.map(|c| CallerIdentity {
                key_id: c.key_id.map(Into::into),
                subject: c.subject.map(Into::into),
            }),
            tool: e.tool.map(Into::into),
            duration_ms: e
                .duration_ms
                .map(i32::try_from)
                .transpose()
                .map_err(|_| "Duration outside database bounds")?,
            is_error: e.is_error.unwrap_or(false),
            client_name: e.client_name.map(Into::into),
            client_version: e.client_version.map(Into::into),
            attrs: e.attrs,
        })
    }
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub sent_at: DateTime<Utc>,
    pub events: Vec<Value>,
}
#[derive(Debug, Serialize)]
pub struct Rejected {
    pub index: usize,
    pub id: Option<String>,
    pub reason: String,
}
pub fn validate_batch(
    values: Vec<Value>,
    now: DateTime<Utc>,
    retention_days: i32,
) -> (Vec<Event>, Vec<Rejected>) {
    static VALIDATOR: std::sync::OnceLock<jsonschema::Validator> = std::sync::OnceLock::new();
    let validator = VALIDATOR.get_or_init(|| {
        jsonschema::validator_for(
            &serde_json::from_str::<Value>(include_str!("../../../spec/events.schema.json"))
                .expect("bundled schema"),
        )
        .expect("valid schema")
    });
    let mut seen = HashSet::new();
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    for (index, value) in values.into_iter().enumerate() {
        let id = value.get("id").and_then(Value::as_str).map(str::to_owned);
        let schema_ok = validator.is_valid(&value) && !contains_nul(&value);
        let parsed = serde_json::from_value::<wire::WireEvent>(value)
            .map_err(|e| e.to_string())
            .and_then(|e| Event::try_from(e).map_err(str::to_owned));
        let (event, reason) = match parsed {
            Ok(event) if schema_ok => {
                let reason = if !seen.insert(event.id) {
                    Some("duplicate_in_batch")
                } else if event.ts > now + Duration::minutes(5) {
                    Some("ts_future")
                } else if event.ts < now - Duration::days(i64::from(retention_days)) {
                    Some("ts_too_old")
                } else {
                    None
                };
                (Some(event), reason)
            }
            _ => (None, Some("schema_invalid")),
        };
        if let Some(reason) = reason {
            rejected.push(Rejected {
                index,
                id,
                reason: reason.into(),
            });
        } else if let Some(event) = event {
            accepted.push(event);
        }
    }
    (accepted, rejected)
}
fn contains_nul(value: &Value) -> bool {
    match value {
        Value::String(v) => v.contains('\0'),
        Value::Array(v) => v.iter().any(contains_nul),
        Value::Object(v) => v.iter().any(|(k, v)| k.contains('\0') || contains_nul(v)),
        _ => false,
    }
}
pub const HISTOGRAM_BUCKETS: [i32; 24] = [
    1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946,
    17711, 28657, 46368, 60000,
];
pub fn histogram(values: impl IntoIterator<Item = i32>) -> Vec<i64> {
    let mut buckets = vec![0; 24];
    for value in values {
        let index = HISTOGRAM_BUCKETS
            .iter()
            .position(|b| value <= *b)
            .unwrap_or(23);
        buckets[index] += 1;
    }
    buckets
}
pub fn percentile(buckets: &[i64], quantile: f64) -> f64 {
    let total: i64 = buckets.iter().sum();
    if total == 0 {
        return 0.0;
    }
    let target = total as f64 * quantile;
    let mut count = 0;
    for (i, value) in buckets.iter().enumerate().take(24) {
        if *value > 0 && (count + value) as f64 >= target {
            let lower = if i == 0 { 0 } else { HISTOGRAM_BUCKETS[i - 1] } as f64;
            return lower
                + (HISTOGRAM_BUCKETS[i] as f64 - lower) * (target - count as f64) / *value as f64;
        }
        count += value;
    }
    60000.0
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rejects_late_future_and_duplicate_individually() {
        let now = Utc::now();
        let id = Uuid::new_v4();
        let valid = json!({"id":id,"ts":now,"type":"tool.call","attrs":{}});
        let future =
            json!({"id":Uuid::new_v4(),"ts":now + Duration::minutes(6),"type":"tool.call"});
        let late = json!({"id":Uuid::new_v4(),"ts":now - Duration::days(31),"type":"tool.call"});
        let (events, rejected) =
            validate_batch(vec![valid.clone(), future, late, valid, json!({})], now, 30);
        assert_eq!(events.len(), 1);
        assert_eq!(
            rejected
                .iter()
                .map(|r| r.reason.as_str())
                .collect::<Vec<_>>(),
            [
                "ts_future",
                "ts_too_old",
                "duplicate_in_batch",
                "schema_invalid"
            ]
        );
    }
    #[test]
    fn histogram_merges_and_empty_percentile_is_zero() {
        let a = histogram([1, 10, 100]);
        let b = histogram([20, 200]);
        let merged: Vec<i64> = a.iter().zip(&b).map(|(x, y)| x + y).collect();
        assert_eq!(merged, histogram([1, 10, 100, 20, 200]));
        assert_eq!(percentile(&[0; 24], 0.95), 0.0);
        assert!(percentile(&merged, 0.5) <= percentile(&merged, 0.95));
    }
}
