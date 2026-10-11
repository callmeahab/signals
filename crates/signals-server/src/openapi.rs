use axum::{http::header, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ErrorDocument {
    pub error: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct EventDocument {
    pub id: uuid::Uuid,
    pub ts: chrono::DateTime<chrono::Utc>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: Option<String>,
    pub caller_id: Option<String>,
    pub tool: Option<String>,
    pub duration_ms: Option<i32>,
    pub is_error: bool,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub attrs: serde_json::Value,
    pub source: serde_json::Value,
    pub client: serde_json::Value,
    pub caller: serde_json::Value,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct EventPage {
    pub items: Vec<EventDocument>,
    pub next_cursor: Option<String>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Point {
    pub ts: chrono::DateTime<chrono::Utc>,
    pub requests: i64,
    pub errors: i64,
    pub sessions: usize,
    pub callers: usize,
    pub latency_p50: f64,
    pub latency_p95: f64,
    pub latency_p99: f64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct MetricPoint {
    pub ts: chrono::DateTime<chrono::Utc>,
    pub value: f64,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum Timeseries {
    Complete(Vec<Point>),
    Metric(Vec<MetricPoint>),
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Identity {
    pub project: uuid::Uuid,
    pub label: String,
    pub scopes: Vec<String>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreatedResource {
    pub id: uuid::Uuid,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Health {
    pub rollup_lag_seconds: f64,
    pub partitions: i64,
    pub default_partition_rows: i64,
    pub db_pool_size: u32,
    pub db_pool_idle: usize,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ClientSplit {
    pub name: String,
    pub count: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Tool {
    pub tool: String,
    pub calls: i64,
    pub errors: i64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub last_called: chrono::DateTime<chrono::Utc>,
    pub trend: Vec<i64>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Overview {
    pub requests: i64,
    pub tool_calls: i64,
    pub errors: i64,
    pub error_rate: f64,
    pub sessions: usize,
    pub unique_callers: usize,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub top_tools: Vec<Tool>,
    pub clients: Vec<ClientSplit>,
    pub deltas: std::collections::BTreeMap<String, Option<f64>>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Caller {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub calls: i64,
    pub errors: i64,
    pub sessions: usize,
    pub clients: Vec<String>,
    pub first_seen: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Session {
    pub session_id: String,
    pub client_name: String,
    pub caller_label: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    pub calls: i64,
    pub errors: i64,
    pub transport: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct SessionPage {
    pub items: Vec<Session>,
    pub next_cursor: Option<String>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct KeyDocument {
    pub id: uuid::Uuid,
    pub project_id: uuid::Uuid,
    pub key_id: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct MintedKey {
    pub key: KeyDocument,
    pub secret: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct UserDocument {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub email: String,
    pub role: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProvisionedProject {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub name: String,
    pub slug: String,
    pub retention_days: i32,
    pub rate_events_per_min: i32,
    pub rate_bytes_per_min: i64,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ProjectDocument {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub name: String,
    pub slug: String,
    pub retention_days: i32,
    pub rate_events_per_min: i32,
    pub rate_bytes_per_min: i64,
    pub slo_classes: serde_json::Value,
    pub slo_targets: serde_json::Value,
    pub token_divisor: f64,
    pub digest: serde_json::Value,
    pub alerts: serde_json::Value,
    pub probe_url: Option<String>,
    pub probe_key_set: bool,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Account {
    pub user: UserDocument,
    pub projects: Vec<ProjectDocument>,
}

#[derive(OpenApi)]
#[openapi(info(title="Signals read and provisioning API",version="0.1.0",description="UTC times. Dashboard sessions and project-scoped read keys authorize reads. Project writes require an owner session. Admin keys provision resources. The ingest contract is served separately."),paths(
crate::handlers::login,crate::handlers::logout,crate::handlers::me,crate::handlers::whoami,
crate::handlers::overview,crate::handlers::timeseries,crate::handlers::tools,crate::handlers::tool_timeseries,crate::handlers::callers,crate::handlers::caller_timeseries,crate::handlers::sessions,crate::handlers::session_events,crate::handlers::events,crate::handlers::live,crate::handlers::keys,crate::handlers::create_key,crate::handlers::revoke_key,crate::handlers::get_project,crate::handlers::update_project,crate::handlers::project_users,crate::handlers::project_create_user,crate::handlers::create_tenant,crate::handlers::create_project,crate::handlers::admin_key,crate::handlers::create_user,crate::handlers::admin_health
),components(schemas(ErrorDocument,EventDocument,EventPage,Point,MetricPoint,Timeseries,Identity,CreatedResource,Health,Tool,Caller,Session,SessionPage,KeyDocument,MintedKey,Overview,ProvisionedProject,ProjectDocument,UserDocument,Account,crate::handlers::Login,crate::handlers::Settings,crate::handlers::KeyInput,crate::handlers::TenantInput,crate::handlers::ProjectInput,crate::handlers::AdminKeyInput,crate::handlers::UserInput,crate::handlers::ProjectUserInput)),modifiers(&Security))]
pub struct ReadApi;
struct Security;
impl utoipa::Modify for Security {
    fn modify(&self, api: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::*;
        let c = api.components.as_mut().unwrap();
        c.add_security_scheme(
            "ingestKey",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        c.add_security_scheme(
            "readKey",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        c.add_security_scheme(
            "adminToken",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        c.add_security_scheme(
            "session",
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("signals_session"))),
        );
        analytics_document(api);
    }
}
pub async fn read_document() -> Json<utoipa::openapi::OpenApi> {
    Json(ReadApi::openapi())
}
#[derive(rust_embed::RustEmbed)]
#[folder = "../../spec/"]
struct Spec;
pub async fn ingest_document() -> impl IntoResponse {
    let asset = Spec::get("ingest.openapi.yaml").expect("official OpenAPI bundled");
    (
        [(header::CONTENT_TYPE, "application/yaml")],
        asset.data.into_owned(),
    )
}

pub async fn event_schema() -> impl IntoResponse {
    let asset = Spec::get("events.schema.json").expect("event schema bundled");
    (
        [(header::CONTENT_TYPE, "application/schema+json")],
        asset.data.into_owned(),
    )
}
/// Analytics models are JSON schemas because nullable count fields and dynamic client/tool
/// maps are part of the public wire contract rather than storage row representations.
fn analytics_document(api: &mut utoipa::openapi::OpenApi) {
    use serde_json::{json, Value};
    fn obj(fields: &[(&str, Value)]) -> Value {
        json!({"type":"object","required":fields.iter().map(|(k,_)|*k).collect::<Vec<_>>(),"properties":fields.iter().map(|(k,v)|(k.to_string(),v.clone())).collect::<serde_json::Map<_,_>>()})
    }
    fn arr(item: Value) -> Value {
        json!({"type":"array","items":item})
    }
    fn reference(name: &str) -> Value {
        json!({"$ref":format!("#/components/schemas/{name}")})
    }
    let int = json!({"type":["integer","null"],"format":"int64"});
    let number = json!({"type":["number","null"]});
    let string = json!({"type":["string","null"]});
    let boolean = json!({"type":"boolean"});
    let date = json!({"type":"string","format":"date-time"});
    let strings = arr(string.clone());
    let mut schemas = serde_json::Map::new();
    schemas.insert(
        "AnalyticsSettingsError".into(),
        obj(&[
            (
                "error",
                json!({"type":"string","enum":["invalid_settings"]}),
            ),
            ("message", json!({"type":"string"})),
        ]),
    );
    schemas.insert(
        "AnalyticsRange".into(),
        obj(&[
            ("from", date.clone()),
            ("to", date.clone()),
            ("prev_from", date.clone()),
            ("prev_to", date.clone()),
        ]),
    );
    schemas.insert(
        "AnalyticsError".into(),
        obj(&[
            ("error", json!({"type":"string","enum":["invalid_filter"]})),
            ("message", string.clone()),
        ]),
    );
    schemas.insert(
        "IdentityQuality".into(),
        obj(&[
            ("strong", int.clone()),
            ("key", int.clone()),
            ("network", int.clone()),
        ]),
    );
    schemas.insert("AnalyticsLatencyBuckets".into(), json!({"oneOf":[{"type":"null"},{"type":"object","required":["edges","counts"],"properties":{
        "edges":{"type":"array","minItems":61,"maxItems":61,"items":{"type":["number","null"]},"description":"60 lower boundaries in milliseconds followed by null for the unbounded overflow edge; zero durations clamp into the first bin"},
        "counts":{"type":"array","minItems":60,"maxItems":60,"items":{"type":"integer","minimum":0}}
    }}]}));
    schemas.insert("AnalyticsLatencySeries".into(), json!({"oneOf":[{"type":"null"},obj(&[
        ("bucket",json!({"type":"string","enum":["hour","day"]})),
        ("method",json!({"type":"string","enum":["exact","histogram"]})),
        ("points",arr(obj(&[("t",date.clone()),("p50",int.clone()),("p95",int.clone()),("p99",int.clone())])))
    ])]}));
    schemas.insert(
        "AnalyticsLatency".into(),
        obj(&[
            ("buckets", reference("AnalyticsLatencyBuckets")),
            ("p50", int.clone()),
            ("p95", int.clone()),
            ("p99", int.clone()),
            (
                "method",
                json!({"type":"string","enum":["histogram","exact"]}),
            ),
        ]),
    );
    schemas.insert(
        "AnalyticsErrors".into(),
        obj(&[
            ("tool", int.clone()),
            ("protocol", int.clone()),
            ("timeout", int.clone()),
            ("cancelled", int.clone()),
            ("unknown", int.clone()),
        ]),
    );
    schemas.insert(
        "AnalyticsFunnelStep".into(),
        json!({"type":"object","required":["step","count"],"properties":{
            "step":string.clone(),"count":int.clone(),"eligible":{"type":"integer","minimum":0},"dropoff_pct":number.clone()
        }}),
    );
    schemas.insert(
        "AnalyticsCohort".into(),
        obj(&[
            ("cohort_start", json!({"type":"string","format":"date"})),
            ("size", int.clone()),
            ("retained_pct", arr(number.clone())),
        ]),
    );
    schemas.insert(
        "AnalyticsAttention".into(),
        obj(&[
            ("tool", string.clone()),
            ("calls", int.clone()),
            ("success_rate", number.clone()),
            ("p95", int.clone()),
            (
                "slo_class",
                json!({"type":"string","enum":["read","mutate"]}),
            ),
            (
                "status",
                json!({"type":"string","enum":["ok","warn","error","dead"]}),
            ),
        ]),
    );
    let pair = obj(&[("value", number.clone()), ("prev", number.clone())]);
    let mut latency = schemas["AnalyticsLatency"].clone();
    latency["properties"]["prev_p95"] = int.clone();
    latency["properties"]["sparkline"] = json!({"oneOf":[{"type":"null"},arr(int.clone())]});
    let overview = obj(&[
        (
            "tiles",
            obj(&[
                ("tool_calls", pair.clone()),
                (
                    "active_users",
                    obj(&[
                        ("value", int.clone()),
                        ("prev", int.clone()),
                        ("new", int.clone()),
                        ("by_kind", reference("IdentityQuality")),
                    ]),
                ),
                (
                    "sessions",
                    obj(&[
                        ("value", int.clone()),
                        ("prev", int.clone()),
                        ("calls_per_session", number.clone()),
                    ]),
                ),
                (
                    "success_rate",
                    obj(&[
                        ("value", number.clone()),
                        ("prev", number.clone()),
                        ("tools_below_slo", int.clone()),
                    ]),
                ),
                ("latency", latency),
                (
                    "context_tokens",
                    obj(&[
                        ("value", int.clone()),
                        ("per_call", int.clone()),
                        ("estimated", boolean.clone()),
                    ]),
                ),
            ]),
        ),
        (
            "calls_by_client",
            obj(&[
                ("buckets", string.clone()),
                (
                    "points",
                    arr(obj(&[
                        ("t", string.clone()),
                        (
                            "by_client",
                            json!({"type":"object","additionalProperties":int}),
                        ),
                    ])),
                ),
            ]),
        ),
        ("funnel", arr(reference("AnalyticsFunnelStep"))),
        ("attention", arr(reference("AnalyticsAttention"))),
        (
            "cohorts",
            obj(&[
                ("kind", string.clone()),
                ("rows", arr(reference("AnalyticsCohort"))),
            ]),
        ),
    ]);
    let adoption = obj(&[
        (
            "active",
            obj(&[
                ("bucket", string.clone()),
                (
                    "points",
                    arr(obj(&[
                        ("t", string.clone()),
                        ("users", int.clone()),
                        ("new", int.clone()),
                        ("returning", int.clone()),
                        ("by_kind", reference("IdentityQuality")),
                    ])),
                ),
                ("dau", int.clone()),
                ("wau", int.clone()),
                ("mau", int.clone()),
            ]),
        ),
        (
            "clients",
            arr(obj(&[
                ("name", string.clone()),
                ("version", string.clone()),
                ("sessions", int.clone()),
                ("calls", int.clone()),
                ("pct", number.clone()),
                ("capabilities", strings.clone()),
            ])),
        ),
        (
            "protocol_versions",
            arr(obj(&[
                ("version", string.clone()),
                ("sessions", int.clone()),
            ])),
        ),
        (
            "transports",
            arr(obj(&[
                ("transport", string.clone()),
                ("sessions", int.clone()),
            ])),
        ),
        (
            "retention",
            obj(&[
                (
                    "daily",
                    obj(&[
                        ("d1", number.clone()),
                        ("d7", number.clone()),
                        ("d30", number.clone()),
                    ]),
                ),
                ("weekly", arr(reference("AnalyticsCohort"))),
            ]),
        ),
        (
            "funnel",
            obj(&[("steps", arr(reference("AnalyticsFunnelStep")))]),
        ),
        ("identity_quality", reference("IdentityQuality")),
    ]);
    let catalog = obj(&[
        ("advertised", int.clone()),
        ("used", int.clone()),
        ("dead", strings.clone()),
        ("known", boolean.clone()),
        ("catalog_hash", string.clone()),
        (
            "updated_at",
            json!({"type":["string","null"],"format":"date-time"}),
        ),
    ]);
    schemas.insert(
        "AnalyticsTool".into(),
        obj(&[
            ("tool", string.clone()),
            ("slo_class", string.clone()),
            ("calls", int.clone()),
            ("success_rate", number.clone()),
            ("errors", reference("AnalyticsErrors")),
            ("latency", reference("AnalyticsLatency")),
            ("input_bytes_avg", int.clone()),
            ("output_bytes_avg", int.clone()),
            ("output_tokens_est", int.clone()),
            (
                "retries",
                obj(&[
                    ("count", int.clone()),
                    ("self_corrected_pct", number.clone()),
                ]),
            ),
            (
                "schema_failures",
                obj(&[("input", int.clone()), ("output", int.clone())]),
            ),
            (
                "trend",
                arr(obj(&[
                    ("t", string.clone()),
                    ("calls", int.clone()),
                    ("errors", int.clone()),
                ])),
            ),
        ]),
    );
    let tools = obj(&[
        ("catalog", catalog),
        ("tools", arr(reference("AnalyticsTool"))),
        (
            "paths",
            arr(obj(&[
                ("sequence", strings.clone()),
                ("count", int.clone()),
                ("pct", number.clone()),
            ])),
        ),
    ]);
    let count_pct = obj(&[("count", int.clone()), ("pct", number.clone())]);
    let reliability = obj(&[
        ("latency_over_time", reference("AnalyticsLatencySeries")),
        (
            "slo",
            arr(obj(&[
                ("class", string.clone()),
                ("target", number.clone()),
                ("success_rate", number.clone()),
                ("error_budget_pct", number.clone()),
                ("burn_rate_1h", number.clone()),
                ("burn_rate_6h", number.clone()),
            ])),
        ),
        (
            "handshake",
            obj(&[
                ("attempts", int.clone()),
                ("success_rate", number.clone()),
                ("p95", int.clone()),
            ]),
        ),
        ("timeouts", count_pct.clone()),
        ("cancellations", count_pct.clone()),
        (
            "error_codes",
            arr(obj(&[
                ("code", int.clone()),
                ("kind", string.clone()),
                ("count", int.clone()),
            ])),
        ),
        (
            "hallucinated_tools",
            obj(&[("count", int.clone()), ("names", strings.clone())]),
        ),
        ("sessions_with_errors", count_pct),
        ("silent_failures", obj(&[("count", int.clone())])),
        (
            "auth_failures",
            arr(obj(&[("reason", string.clone()), ("count", int.clone())])),
        ),
        (
            "availability",
            json!({"oneOf":[{"type":"null"},obj(&[("uptime_pct",number.clone()),("last_probe_at",date.clone()),("last_failure_at",string.clone()),("advertised_tools",int.clone()),("healthy_tools",int.clone()),("probes",arr(obj(&[("t",date.clone()),("ok",boolean.clone()),("latency_ms",int.clone())])))])]}),
        ),
    ]);
    let cost = obj(&[
        ("total_tokens_est", int.clone()),
        ("per_call", int.clone()),
        ("estimated", boolean.clone()),
        (
            "by_tool",
            arr(obj(&[
                ("tool", string.clone()),
                ("calls", int.clone()),
                ("tokens", int.clone()),
                ("pct", number.clone()),
            ])),
        ),
        (
            "by_tenant",
            arr(obj(&[
                ("caller", string.clone()),
                ("identity_kind", string.clone()),
                ("calls", int.clone()),
                ("tokens", int.clone()),
            ])),
        ),
        (
            "payload_hist",
            obj(&[
                ("buckets", strings.clone()),
                ("input", json!({"oneOf":[{"type":"null"},arr(int.clone())]})),
                (
                    "output",
                    json!({"oneOf":[{"type":"null"},arr(int.clone())]}),
                ),
            ]),
        ),
        (
            "billing_periods",
            arr(obj(&[
                ("period", string.clone()),
                ("caller", string.clone()),
                ("calls", int.clone()),
                ("tokens", int.clone()),
            ])),
        ),
    ]);
    let cap = arr(obj(&[
        ("name", string.clone()),
        ("sessions", int.clone()),
        ("pct", number.clone()),
    ]));
    let protocol = obj(&[
        (
            "capabilities",
            obj(&[
                ("sessions", int.clone()),
                ("client", cap.clone()),
                ("server", cap),
            ]),
        ),
        (
            "sampling",
            obj(&[
                ("requests", int.clone()),
                ("p95", int.clone()),
                ("rejected_pct", number.clone()),
                ("by_model", arr(json!({"type":"object"}))),
            ]),
        ),
        (
            "elicitation",
            obj(&[
                ("requests", int.clone()),
                ("accept_pct", number.clone()),
                ("decline_pct", number.clone()),
                ("cancel_pct", number.clone()),
            ]),
        ),
        (
            "tasks",
            obj(&[
                ("created", int.clone()),
                ("completed", int.clone()),
                ("failed", int.clone()),
                ("cancelled", int.clone()),
            ]),
        ),
        (
            "progress",
            obj(&[
                ("long_calls", int.clone()),
                ("with_progress_pct", number.clone()),
            ]),
        ),
    ]);
    let digest = obj(&[
        (
            "tools",
            arr(obj(&[
                ("tool", string.clone()),
                ("calls", int.clone()),
                ("prev", int.clone()),
                ("delta_pct", number.clone()),
                ("success_rate", number.clone()),
                ("p95", int.clone()),
                ("errors", reference("AnalyticsErrors")),
            ])),
        ),
        ("top_error_kinds", reference("AnalyticsErrors")),
        ("new", int.clone()),
        ("returning", int.clone()),
        ("dead_tools", strings.clone()),
        ("changes", strings.clone()),
    ]);
    schemas.insert(
        "AnalyticsAlertRule".into(),
        obj(&[
            (
                "id",
                json!({"type":"string","enum":["volume","latency","errors","destructive","burn"]}),
            ),
            ("enabled", boolean.clone()),
        ]),
    );
    let alerts = obj(&[(
        "rules",
        arr(
            json!({"allOf":[reference("AnalyticsAlertRule"),obj(&[("state",json!({"type":"string","enum":["ok","firing","disabled","no_data"]})),("changed_at",string.clone()),("details",json!({"type":["object","null"]}))])]}),
        ),
    )]);
    let timeline = obj(&[
        (
            "session",
            obj(&[
                ("session_id", string.clone()),
                ("client", json!({"type":["object","null"]})),
                ("identity", json!({"type":["object","null"]})),
                ("transport", string.clone()),
                ("reason", string.clone()),
                ("duration_ms", int.clone()),
            ]),
        ),
        (
            "events",
            arr(obj(&[
                ("id", string.clone()),
                ("ts", date.clone()),
                ("offset_ms", int.clone()),
                ("type", string.clone()),
                ("duration_ms", int.clone()),
                ("is_error", boolean.clone()),
                ("error_kind", string.clone()),
                ("output_kinds", json!({"oneOf":[strings,{"type":"null"}]})),
                ("input_bytes", int.clone()),
                ("output_bytes", int),
                ("args_hash", string),
            ])),
        ),
    ]);
    for (name, mut schema) in [
        ("AnalyticsOverview", overview),
        ("AnalyticsAdoption", adoption),
        ("AnalyticsTools", tools),
        ("AnalyticsReliability", reliability),
        ("AnalyticsCost", cost),
        ("AnalyticsProtocol", protocol),
        ("AnalyticsDigest", digest),
        ("AnalyticsAlerts", alerts),
        ("AnalyticsTimeline", timeline),
    ] {
        schema["properties"]["range"] = reference("AnalyticsRange");
        schema["properties"]["generated_at"] = date.clone();
        schema["required"]
            .as_array_mut()
            .unwrap()
            .extend([json!("range"), json!("generated_at")]);
        schemas.insert(name.into(), schema);
    }
    let mut document = serde_json::to_value(&*api).unwrap();
    document["components"]["schemas"]
        .as_object_mut()
        .unwrap()
        .extend(schemas);
    for (route, model) in [
        ("overview", "AnalyticsOverview"),
        ("adoption", "AnalyticsAdoption"),
        ("tools", "AnalyticsTools"),
        ("reliability", "AnalyticsReliability"),
        ("cost", "AnalyticsCost"),
        ("protocol", "AnalyticsProtocol"),
        ("digest", "AnalyticsDigest"),
        ("alerts", "AnalyticsAlerts"),
        ("sessions/{session}/timeline", "AnalyticsTimeline"),
    ] {
        let mut parameters = vec![
            json!({"name":"project","in":"path","required":true,"schema":{"type":"string","format":"uuid"}}),
        ];
        for name in [
            "range",
            "from",
            "to",
            "client",
            "tool",
            "caller",
            "transport",
        ] {
            parameters.push(json!({"name":name,"in":"query","required":false,"schema":if name=="range"{json!({"type":"string","enum":["24h","7d","30d","90d"],"default":"7d"})}else{json!({"type":"string"})}}));
        }
        if route == "digest" {
            parameters.push(
                json!({"name":"week","in":"query","required":false,"schema":{"type":"string","example":"2026-W41"}}),
            );
        }
        if route.contains("{session}") {
            parameters.push(
                json!({"name":"session","in":"path","required":true,"schema":{"type":"string"}}),
            );
        }
        document["paths"][format!("/v1/projects/{{project}}/analytics/{route}")] = json!({"get":{"operationId":model,"tags":["Analytics"],"parameters":parameters,"security":[{"session":[]},{"readKey":[]}],"responses":{"200":{"description":"Analytics with UTC windows; unavailable metrics are null","content":{"application/json":{"schema":reference(model)}}},"400":{"description":"Invalid range or filter","content":{"application/json":{"schema":reference("AnalyticsError")}}},"401":{"description":"Unauthenticated"},"403":{"description":"Project access denied"}}}});
    }
    document["paths"]["/v1/projects/{project}/alerts"] = json!({"put":{"operationId":"setAnalyticsAlerts","parameters":[{"name":"project","in":"path","required":true,"schema":{"type":"string","format":"uuid"}}],"security":[{"session":[]}],"requestBody":{"required":true,"content":{"application/json":{"schema":obj(&[("rules",arr(reference("AnalyticsAlertRule")))])}}},"responses":{"200":{"description":"Updated rules","content":{"application/json":{"schema":obj(&[("rules",arr(reference("AnalyticsAlertRule")))])}}},"400":{"description":"Invalid settings","content":{"application/json":{"schema":reference("AnalyticsSettingsError")}}},"403":{"description":"Owner session required"}}}});
    document["paths"]["/v1/projects/{project}"]["patch"]["responses"]["400"] = json!({"description":"Invalid settings","content":{"application/json":{"schema":reference("AnalyticsSettingsError")}}});
    api.paths
        .paths
        .get_mut("/v1/projects/{project}")
        .unwrap()
        .patch
        .as_mut()
        .unwrap()
        .responses
        .responses
        .insert(
            "400".into(),
            serde_json::from_value(
                document["paths"]["/v1/projects/{project}"]["patch"]["responses"]["400"].clone(),
            )
            .expect("valid settings error response"),
        );
    for (name, schema) in document["components"]["schemas"].as_object().unwrap() {
        if name.starts_with("Analytics") || name == "IdentityQuality" {
            api.components.as_mut().unwrap().schemas.insert(
                name.clone(),
                serde_json::from_value(schema.clone())
                    .unwrap_or_else(|e| panic!("Invalid analytics schema {name}: {e}")),
            );
        }
    }
    for (name, path) in document["paths"].as_object().unwrap() {
        if name.contains("/analytics/") || name.ends_with("/alerts") {
            api.paths.paths.insert(
                name.clone(),
                serde_json::from_value(path.clone())
                    .unwrap_or_else(|e| panic!("Invalid path {name}: {e}: {path}")),
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_covers_read_routes_and_models() {
        let v = serde_json::to_value(ReadApi::openapi()).unwrap();
        for p in [
            "/v1/projects/{project}/overview",
            "/v1/projects/{project}/tool-timeseries",
            "/v1/projects/{project}/sessions/{session}/events",
            "/v1/admin/users",
            "/v1/projects/{project}/analytics/overview",
            "/v1/projects/{project}/analytics/adoption",
            "/v1/projects/{project}/analytics/tools",
            "/v1/projects/{project}/analytics/reliability",
            "/v1/projects/{project}/analytics/cost",
            "/v1/projects/{project}/analytics/protocol",
            "/v1/projects/{project}/analytics/digest",
            "/v1/projects/{project}/analytics/alerts",
            "/v1/projects/{project}/analytics/sessions/{session}/timeline",
            "/v1/projects/{project}/alerts",
        ] {
            assert!(v["paths"][p].is_object(), "{p}");
        }
        assert!(v["components"]["schemas"]["Overview"]["properties"]["p99"].is_object());
        for (path, method) in [
            ("/v1/projects/{project}", "patch"),
            ("/v1/projects/{project}/alerts", "put"),
        ] {
            assert_eq!(
                v["paths"][path][method]["responses"]["400"]["content"]["application/json"]
                    ["schema"]["$ref"],
                "#/components/schemas/AnalyticsSettingsError"
            );
        }
        let project_get = &v["paths"]["/v1/projects/{project}"]["get"];
        assert_eq!(project_get["security"], serde_json::json!([{"session":[]}]));
        for method in ["get", "patch"] {
            assert_eq!(
                v["paths"]["/v1/projects/{project}"][method]["responses"]["200"]["content"]
                    ["application/json"]["schema"]["$ref"],
                "#/components/schemas/ProjectDocument"
            );
        }
        let project = &v["components"]["schemas"]["ProjectDocument"]["properties"];
        for field in [
            "slo_classes",
            "slo_targets",
            "token_divisor",
            "digest",
            "alerts",
            "probe_url",
            "probe_key_set",
        ] {
            assert!(project[field].is_object());
        }
        assert!(project.get("probe_key").is_none());
        let funnel = &v["components"]["schemas"]["AnalyticsFunnelStep"];
        assert!(funnel["properties"]["eligible"].is_object());
        assert!(!funnel["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("eligible")));
    }
}
