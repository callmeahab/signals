//! Optional streamable-HTTP MCP probe. Keys are never returned by read APIs or logs.
use anyhow::{anyhow, ensure, Result};
use reqwest::{Client, Response};
use serde_json::{json, Value};
use signals_store::{checked_query, Store};
use sqlx::Row;
use uuid::Uuid;

async fn rpc(response: Response) -> Result<Value> {
    let mut response = response.error_for_status()?;
    let sse = response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        bytes.extend_from_slice(&chunk);
        ensure!(bytes.len() <= 1024 * 1024, "probe response exceeds 1 MiB");
        if sse {
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                if let Some(data) = line.strip_prefix("data:") {
                    if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                        if v.get("id").is_some() {
                            ensure!(v.get("error").is_none(), "MCP returned an error");
                            return Ok(v["result"].clone());
                        }
                    }
                }
            }
        }
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    ensure!(value.get("error").is_none(), "MCP returned an error");
    value
        .get("result")
        .cloned()
        .ok_or_else(|| anyhow!("Missing MCP result"))
}
async fn probe(client: &Client, url: &str, key: &str) -> Result<i32> {
    let response=client.post(url).bearer_auth(key).header("accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"signals-prober","version":"1"}}})).send().await?;
    let session = response.headers().get("mcp-session-id").cloned();
    let init = rpc(response).await?;
    let version = init["protocolVersion"]
        .as_str()
        .ok_or_else(|| anyhow!("Missing protocolVersion"))?;
    let request = |body: Value| {
        let mut r = client
            .post(url)
            .bearer_auth(key)
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", version)
            .json(&body);
        if let Some(s) = &session {
            r = r.header("mcp-session-id", s);
        }
        r
    };
    request(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .send()
        .await?
        .error_for_status()?;
    let mut count = 0;
    let mut cursor = None;
    let mut seen = std::collections::BTreeSet::new();
    loop {
        let result=rpc(request(json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":cursor.as_ref().map(|c|json!({"cursor":c})).unwrap_or(json!({}))})).send().await?).await?;
        count += result["tools"]
            .as_array()
            .ok_or_else(|| anyhow!("Missing tools"))?
            .len();
        cursor = result["nextCursor"].as_str().map(str::to_owned);
        if let Some(c) = &cursor {
            ensure!(
                seen.insert(c.clone()) && seen.len() < 100,
                "Invalid catalog pagination"
            );
        } else {
            break;
        }
    }
    // Close probe-created sessions where supported. A server may respond 405.
    if let Some(session) = session {
        let _ = client
            .delete(url)
            .bearer_auth(key)
            .header("mcp-session-id", session)
            .header("mcp-protocol-version", version)
            .send()
            .await;
    }
    Ok(count as i32)
}
pub async fn run(store: &Store) -> Result<()> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let projects=checked_query!("SELECT id,analytics_settings->>'probe_url' AS url,analytics_settings->>'probe_key' AS key FROM projects WHERE deleted_at IS NULL AND analytics_settings->>'probe_url' IS NOT NULL AND analytics_settings->>'probe_key' IS NOT NULL").fetch_all(&store.pool).await?;
    for row in projects {
        let id: Uuid = row.get("id");
        let url: String = row.get("url");
        let key: String = row.get("key");
        let mut lock = store.pool.begin().await?;
        if !signals_store::checked_query_scalar!(<_,bool>"SELECT pg_try_advisory_xact_lock(hashtextextended($1,1397311238))",id.to_string()).fetch_one(&mut *lock).await?{continue;}
        let recent:bool=signals_store::checked_query_scalar!("SELECT EXISTS(SELECT 1 FROM probes WHERE project_id=$1 AND ts>now()-interval '59 seconds')",id).fetch_one(&mut *lock).await?;
        if recent {
            continue;
        }
        let start = std::time::Instant::now();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(25),
            probe(&client, &url, &key),
        )
        .await;
        let tools = match result {
            Ok(Ok(n)) => Some(n),
            _ => None,
        };
        let error = tools.is_none().then_some("initialize or tools/list failed");
        checked_query!("INSERT INTO probes(project_id,ok,latency_ms,advertised_tools,error) VALUES($1,$2,$3,$4,$5)",id,tools.is_some(),start.elapsed().as_millis() as i64,tools,error).execute(&mut *lock).await?;
        lock.commit().await?;
    }
    Ok(())
}
