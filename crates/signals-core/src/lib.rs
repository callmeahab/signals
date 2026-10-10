use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{collections::HashSet, sync::OnceLock};
use uuid::Uuid;

pub const MAX_EVENTS: usize = 1000;
pub const MAX_BODY: usize = 1_048_576;
pub const INGEST_LOCK: i64 = 0x53494701;
pub const PARTITION_LOCK: i64 = 0x53494702;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CallerIdentity {
    pub key_id: Option<String>,
    pub subject: Option<String>,
    #[serde(skip_serializing)]
    pub ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_hash: Option<String>,
    pub user_agent: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Event {
    pub id: Uuid,
    pub ts: DateTime<Utc>,
    #[serde(default)]
    pub received_at: Option<DateTime<Utc>>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: Option<String>,
    pub caller: Option<CallerIdentity>,
    pub tool: Option<String>,
    pub duration_ms: Option<i32>,
    pub is_error: bool,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub attrs: Map<String, Value>,
    #[serde(default)]
    pub source: Value,
    #[serde(default)]
    pub client: Value,
    #[serde(default)]
    pub caller_data: Value,
}
#[derive(Debug)]
pub struct Batch {
    pub sent_at: DateTime<Utc>,
    pub source: Value,
    pub events: Vec<Value>,
}
#[derive(Debug, Serialize)]
pub struct Rejected {
    pub index: usize,
    pub reason: String,
}

// Grow the parsing stack, and destroy arbitrary rejected nesting iteratively.
pub fn parse_json(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    let mut de = serde_json::Deserializer::from_slice(bytes);
    de.disable_recursion_limit();
    let mut value = Value::deserialize(serde_stacker::Deserializer::new(&mut de))?;
    if let Err(error) = de.end() {
        drop_json(value);
        return Err(error);
    }
    // JSON.parse accepts overflowing numeric tokens as infinities; JSON.stringify
    // persists those as null. Preserve all finite numbers exactly for storage.
    // Walk iteratively because depth validation has not happened yet.
    let mut pending = vec![&mut value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Number(n) if n.as_f64().is_none_or(|n| !n.is_finite()) => {
                *value = Value::Null;
            }
            Value::Array(values) => pending.extend(values.iter_mut()),
            Value::Object(values) => pending.extend(values.values_mut()),
            _ => {}
        }
    }
    Ok(value)
}
pub fn drop_json(value: Value) {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            Value::Array(values) => pending.extend(values),
            Value::Object(values) => pending.extend(values.into_values()),
            _ => {}
        }
    }
}
pub fn contract_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn timestamp(value: &Value) -> Option<DateTime<Utc>> {
    let ts = DateTime::parse_from_rfc3339(value.as_str()?).ok()?;
    (ts.timestamp_subsec_nanos() < 1_000_000_000).then(|| ts.with_timezone(&Utc))
}
pub fn parse_batch(body: &[u8], ndjson: bool) -> Result<Batch, &'static str> {
    if body.len() > MAX_BODY {
        return Err("body_too_large");
    }
    let text = std::str::from_utf8(body).map_err(|_| "malformed_body")?;
    // UTF-8 precedes parsing; NDJSON counts lines before envelope validation.
    if ndjson
        && text
            .split('\n')
            .filter(|l| !l.chars().all(contract_whitespace))
            .count()
            > MAX_EVENTS + 1
    {
        return Err("too_many_events");
    }
    let mut doc = if ndjson {
        let mut lines = text
            .split('\n')
            .filter(|l| !l.chars().all(contract_whitespace));
        let line = lines.next().ok_or("malformed_envelope")?;
        let mut doc = parse_json(line.as_bytes()).map_err(|_| "malformed_json")?;
        if !doc.is_object() || doc.get("events").is_some() {
            drop_json(doc);
            return Err("malformed_envelope");
        }
        doc["events"] = Value::Array(
            lines
                .map(|l| parse_json(l.as_bytes()).unwrap_or(Value::Null))
                .collect(),
        );
        doc
    } else {
        parse_json(body).map_err(|_| "malformed_json")?
    };
    let events = match doc.get_mut("events").map(Value::take) {
        Some(Value::Array(events)) => events,
        _ => {
            drop_json(doc);
            return Err("malformed_envelope");
        }
    };
    if events.len() > MAX_EVENTS {
        drop_json(Value::Array(events));
        drop_json(doc);
        return Err("too_many_events");
    }
    doc["events"] = serde_json::json!([]);
    static ENVELOPE: OnceLock<jsonschema::Validator> = OnceLock::new();
    let validator = ENVELOPE.get_or_init(|| {
        let mut schema: Value =
            serde_json::from_str(include_str!("../../../spec/batch.schema.json")).unwrap();
        // Events are validated independently; no external schema resolution is needed.
        schema["properties"]["events"]["items"] = serde_json::json!({});
        jsonschema::options()
            .should_validate_formats(true)
            .build(&schema)
            .unwrap()
    });
    let sent_at = timestamp(&doc["sent_at"]);
    let source_ok = doc["source"].as_object().is_some_and(|source| {
        source.values().all(|v| {
            v.as_str()
                .is_some_and(|s| !s.chars().all(contract_whitespace))
        })
    });
    if !validator.is_valid(&doc) || sent_at.is_none() || !source_ok {
        drop_json(Value::Array(events));
        drop_json(doc);
        return Err("malformed_envelope");
    }
    Ok(Batch {
        sent_at: sent_at.unwrap(),
        source: doc["source"].take(),
        events,
    })
}
fn depth_ok(value: &Value) -> bool {
    let mut pending = vec![(value, 0)];
    while let Some((value, depth)) = pending.pop() {
        match value {
            Value::Array(values) => {
                if depth >= 128 {
                    return false;
                }
                pending.extend(values.iter().map(|v| (v, depth + 1)));
            }
            Value::Object(values) => {
                if depth >= 128 {
                    return false;
                }
                pending.extend(values.values().map(|v| (v, depth + 1)));
            }
            _ => {}
        }
    }
    true
}
pub fn normalize_storage(value: &mut Value) {
    match value {
        Value::String(s) => *s = s.replace('\0', "�"),
        Value::Array(a) => a.iter_mut().for_each(normalize_storage),
        Value::Object(o) => {
            *o = std::mem::take(o)
                .into_iter()
                .map(|(k, mut v)| {
                    normalize_storage(&mut v);
                    (k.replace('\0', "�"), v)
                })
                .collect();
        }
        _ => {}
    }
}
/// Compact JSON.stringify byte length, without changing the stored Value.
/// JSON.parse represents all numbers as binary64, including integer wire tokens.
/// The caller checks depth before measuring; the walk itself is iterative.
fn serialised_bytes(value: &Value) -> usize {
    fn string_bytes(s: &str) -> usize {
        2 + s
            .bytes()
            .map(|b| match b {
                b'"' | b'\\' | b'\x08' | b'\x0c' | b'\n' | b'\r' | b'\t' => 2,
                0..=0x1f => 6,
                _ => 1,
            })
            .sum::<usize>()
    }
    let mut bytes = 0;
    let mut pending = vec![value];
    let mut number = ryu_js::Buffer::new();
    while let Some(value) = pending.pop() {
        bytes += match value {
            Value::Null => 4,
            Value::Bool(true) => 4,
            Value::Bool(false) => 5,
            Value::String(s) => string_bytes(s),
            Value::Number(n) => n
                .as_f64()
                .filter(|n| n.is_finite())
                .map_or(4, |n| number.format_finite(n).len()),
            Value::Array(values) => {
                pending.extend(values);
                2 + values.len().saturating_sub(1)
            }
            Value::Object(values) => {
                pending.extend(values.values());
                2 + values.len().saturating_sub(1)
                    + values.keys().map(|k| string_bytes(k) + 1).sum::<usize>()
            }
        };
    }
    bytes
}
pub fn validate_batch(
    values: Vec<Value>,
    now: DateTime<Utc>,
    retention_days: i32,
) -> (Vec<Event>, Vec<Rejected>) {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    let validator = VALIDATOR.get_or_init(|| {
        jsonschema::options()
            .should_validate_formats(true)
            .build(
                &serde_json::from_str::<Value>(include_str!("../../../spec/events.schema.json"))
                    .unwrap(),
            )
            .unwrap()
    });
    let mut seen = HashSet::new();
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    for (index, mut value) in values.into_iter().enumerate() {
        let reason = (|| {
            let kind = value.get("type").and_then(Value::as_str).ok_or("schema")?;
            if !matches!(
                kind,
                "session.started"
                    | "session.ended"
                    | "mcp.initialize"
                    | "tool.called"
                    | "resource.read"
                    | "prompt.get"
                    | "mcp.request"
                    | "log"
                    | "error"
                    | "custom"
            ) {
                return Err("unknown_type");
            }
            if !depth_ok(&value) || !validator.is_valid(&value) {
                return Err("schema");
            }
            let ts = timestamp(&value["ts"]).ok_or("schema")?;
            let duplicate = !seen.insert(value["id"].as_str().unwrap().to_ascii_lowercase());
            if serialised_bytes(&value) > 16384 {
                return Err("too_large");
            }
            for (t, field, cap) in [
                ("tool.called", "args", 2048),
                ("log", "fields", 4096),
                ("custom", "props", 8192),
            ] {
                if kind == t
                    && value["attrs"][field].is_object()
                    && serialised_bytes(&value["attrs"][field]) > cap
                {
                    return Err("too_large");
                }
            }
            if ts > now + Duration::minutes(5) {
                return Err("ts_future");
            }
            if retention_days > 0 && ts < now - Duration::days(i64::from(retention_days)) {
                return Err("ts_too_old");
            }
            if duplicate {
                return Err("duplicate_in_batch");
            }
            Ok(ts)
        })();
        match reason {
            Err(reason) => {
                rejected.push(Rejected {
                    index,
                    reason: reason.into(),
                });
                drop_json(value);
            }
            Ok(ts) => {
                let raw_ip = value["caller"]["ip"].as_str().map(str::to_owned);
                normalize_storage(&mut value);
                let string = |v: &Value| v.as_str().map(str::to_owned);
                accepted.push(Event {
                    id: value["id"].as_str().unwrap().parse().unwrap(),
                    ts,
                    received_at: None,
                    event_type: string(&value["type"]).unwrap(),
                    session_id: string(&value["session_id"]),
                    caller: value.get("caller").map(|v| {
                        let mut caller: CallerIdentity = serde_json::from_value(v.clone()).unwrap();
                        caller.ip = raw_ip.clone();
                        caller
                    }),
                    tool: string(&value["attrs"]["tool"]),
                    // The original unbounded integer remains intact in attrs.
                    duration_ms: value["attrs"]["duration_ms"]
                        .as_f64()
                        .map(|n| n.min(i32::MAX as f64) as i32),
                    is_error: value["attrs"]["is_error"]
                        .as_bool()
                        .unwrap_or(value["type"] == "error"),
                    client_name: string(&value["client"]["name"]),
                    client_version: string(&value["client"]["version"]),
                    attrs: value["attrs"].as_object().unwrap().clone(),
                    caller_data: value["caller"].take(),
                    client: value["client"].take(),
                    source: Value::Null,
                });
            }
        }
    }
    (accepted, rejected)
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
    #[test]
    fn official_fixtures_match_reference() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/fixtures");
        for category in ["valid", "invalid"] {
            for entry in std::fs::read_dir(root.join(category)).unwrap() {
                let path = entry.unwrap().path();
                let name = path.file_name().unwrap().to_str().unwrap();
                if name.ends_with(".expected.json")
                    || !matches!(
                        path.extension().and_then(|s| s.to_str()),
                        Some("json" | "ndjson")
                    )
                {
                    continue;
                }
                let expected: Value = if category == "invalid" {
                    serde_json::from_slice(
                        &std::fs::read(path.with_extension("expected.json")).unwrap(),
                    )
                    .unwrap()
                } else {
                    Value::Null
                };
                match parse_batch(
                    &std::fs::read(&path).unwrap(),
                    path.extension().unwrap() == "ndjson",
                ) {
                    Err(code) => {
                        assert_eq!(category, "invalid", "{name}: {code}");
                        assert_eq!(expected["error"], code, "{name}");
                    }
                    Ok(batch) => {
                        let n = batch.events.len();
                        let (accepted, rejected) = validate_batch(batch.events, batch.sent_at, 30);
                        if category == "valid" {
                            assert!(rejected.is_empty(), "{name}: {rejected:?}");
                            assert_eq!(accepted.len(), n, "{name}");
                        } else {
                            assert_eq!(expected["status"], 202, "{name}");
                            assert_eq!(expected["accepted"], accepted.len(), "{name}");
                            assert_eq!(
                                expected["rejected"],
                                serde_json::to_value(rejected).unwrap(),
                                "{name}"
                            );
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn rejects_arbitrary_depth_without_recursive_drop() {
        let raw = format!(
            r#"{{"id":"0192f3a1-5c7e-7a3b-9d0e-2f6a1b4c8d9e","ts":"2026-10-01T12:00:00.000Z","type":"custom","attrs":{{"name":"deep","nested":{}0{}}}}}"#,
            "[".repeat(10000),
            "]".repeat(10000)
        );
        let value = parse_json(raw.as_bytes()).unwrap();
        let (accepted, rejected) = validate_batch(vec![value], Utc::now(), 30);
        assert!(accepted.is_empty());
        assert_eq!(rejected[0].reason, "schema");
    }
    #[test]
    fn source_uses_ecmascript_whitespace() {
        let mut batch: Value = serde_json::from_str(include_str!(
            "../../../spec/fixtures/valid/tool-called.json"
        ))
        .unwrap();
        batch["source"]["sdk"] = serde_json::json!("\u{0085}");
        assert!(parse_batch(&serde_json::to_vec(&batch).unwrap(), false).is_ok());
        batch["source"]["sdk"] = serde_json::json!("\u{feff}");
        assert_eq!(
            parse_batch(&serde_json::to_vec(&batch).unwrap(), false).unwrap_err(),
            "malformed_envelope"
        );
    }
    #[test]
    fn utf8_precedes_ndjson_count_but_count_precedes_envelope() {
        let lines = "{}\n".repeat(1001);
        let mut invalid = b"\xff\n".to_vec();
        invalid.extend_from_slice(lines.as_bytes());
        assert_eq!(parse_batch(&invalid, true).unwrap_err(), "malformed_body");
        let valid = format!("not JSON\n{lines}");
        assert_eq!(
            parse_batch(valid.as_bytes(), true).unwrap_err(),
            "too_many_events"
        );
        invalid.resize(MAX_BODY + 1, b' ');
        assert_eq!(parse_batch(&invalid, true).unwrap_err(), "body_too_large");
    }

    #[test]
    fn measurement_uses_ecmascript_numbers_and_json_escaping() {
        for (wire, canonical) in [
            ("1.0", "1"),
            ("-0.0", "0"),
            ("1e20", "100000000000000000000"),
            ("1e21", "1e+21"),
            ("1e-6", "0.000001"),
            ("1e-7", "1e-7"),
            ("1.2345678901234567", "1.2345678901234567"),
            ("1000000000000000100", "1000000000000000100"),
            ("18446744073709551615", "18446744073709552000"),
        ] {
            let value = parse_json(wire.as_bytes()).unwrap();
            assert_eq!(serialised_bytes(&value), canonical.len(), "{wire}");
            assert_eq!(
                ryu_js::Buffer::new().format_finite(value.as_f64().unwrap()),
                canonical
            );
        }
        let value = serde_json::json!({"\0\n\t\r\u{0008}\u{000c}\\\"": ["é😀\u{2028}", true, false, null, {}, []]});
        assert_eq!(
            serialised_bytes(&value),
            serde_json::to_vec(&value).unwrap().len()
        );
    }

    #[test]
    fn overflowing_numbers_become_null_and_finite_numbers_stay_exact() {
        let fixture = include_str!("../../../spec/fixtures/valid/custom.json");
        for token in [
            "1e400".to_owned(),
            "-1e400".to_owned(),
            "1".to_owned() + &"0".repeat(400),
        ] {
            let raw: Value = serde_json::from_str(&token).unwrap();
            assert_eq!(serialised_bytes(&raw), 4);
            let mut doc: Value = serde_json::from_str(fixture).unwrap();
            doc["events"][0]["attrs"]["props"] = serde_json::json!({"nested": [raw]});
            let wire = serde_json::to_vec(&doc).unwrap();
            let batch = parse_batch(&wire, false).unwrap();
            assert!(batch.events[0]["attrs"]["props"]["nested"][0].is_null());
            let (accepted, rejected) = validate_batch(batch.events, batch.sent_at, 30);
            assert!(rejected.is_empty());
            assert_eq!(accepted.len(), 1);
            assert!(accepted[0].attrs["props"]["nested"][0].is_null());
            let event = doc["events"][0].take();
            doc.as_object_mut().unwrap().remove("events");
            let ndjson = format!("{doc}\n{event}\n");
            let batch = parse_batch(ndjson.as_bytes(), true).unwrap();
            assert!(batch.events[0]["attrs"]["props"]["nested"][0].is_null());
        }
        for token in ["1e308", "9007199254740993", "18446744073709551615", "1.0"] {
            let original: Value = serde_json::from_str(token).unwrap();
            let parsed = parse_json(token.as_bytes()).unwrap();
            assert_eq!(parsed, original);
            let mut doc: Value = serde_json::from_str(fixture).unwrap();
            doc["events"][0]["attrs"]["props"] = serde_json::json!({"n": parsed});
            let batch = parse_batch(&serde_json::to_vec(&doc).unwrap(), false).unwrap();
            let (accepted, rejected) = validate_batch(batch.events, batch.sent_at, 30);
            assert!(rejected.is_empty());
            assert_eq!(accepted[0].attrs["props"]["n"], original);
        }
    }

    #[test]
    fn event_cap_uses_json_stringify_without_changing_stored_floats() {
        let batch: Value = serde_json::from_str(include_str!(
            "../../../spec/fixtures/valid/tool-called.json"
        ))
        .unwrap();
        let now = timestamp(&batch["sent_at"]).unwrap();
        let mut canonical = batch["events"][0].clone();
        canonical["attrs"]["nums"] = serde_json::json!(vec![1; 8]);
        canonical["attrs"]["pad"] = serde_json::json!("");
        let padding = 16384 - serde_json::to_vec(&canonical).unwrap().len();
        canonical["attrs"]["pad"] = serde_json::json!("p".repeat(padding));
        assert_eq!(serialised_bytes(&canonical), 16384);
        let mut floats = canonical.clone();
        floats["attrs"]["nums"] = serde_json::json!(vec![1.0; 8]);
        assert_eq!(serde_json::to_vec(&floats).unwrap().len(), 16400);
        assert_eq!(serialised_bytes(&floats), 16384);
        let mut over = canonical.clone();
        over["attrs"]["pad"] = serde_json::json!("p".repeat(padding + 1));
        for value in [canonical, floats] {
            let original = value["attrs"].clone();
            let (accepted, rejected) = validate_batch(vec![value], now, 30);
            assert!(rejected.is_empty());
            assert_eq!(
                serde_json::to_vec(&accepted[0].attrs).unwrap(),
                serde_json::to_vec(&original).unwrap()
            );
        }
        let (accepted, rejected) = validate_batch(vec![over], now, 30);
        assert!(accepted.is_empty());
        assert_eq!(rejected[0].reason, "too_large");
    }

    #[test]
    fn object_caps_use_the_same_measurement() {
        for (fixture, field, cap) in [
            ("tool-called", "args", 2048),
            ("log", "fields", 4096),
            ("custom", "props", 8192),
        ] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../../spec/fixtures/valid/{fixture}.json"));
            let batch: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let now = timestamp(&batch["sent_at"]).unwrap();
            let mut event = batch["events"][0].clone();
            let mut object = serde_json::json!({"nums": vec![1.0; 8], "pad": ""});
            let padding = cap - serialised_bytes(&object);
            object["pad"] = serde_json::json!("p".repeat(padding));
            event["attrs"][field] = object.clone();
            let (accepted, rejected) = validate_batch(vec![event.clone()], now, 30);
            assert!(rejected.is_empty(), "{fixture}: {rejected:?}");
            assert_eq!(
                serde_json::to_vec(&accepted[0].attrs[field]).unwrap(),
                serde_json::to_vec(&object).unwrap()
            );
            event["attrs"][field]["pad"] = serde_json::json!("p".repeat(padding + 1));
            let (_, rejected) = validate_batch(vec![event], now, 30);
            assert_eq!(rejected[0].reason, "too_large", "{fixture}");
        }
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
