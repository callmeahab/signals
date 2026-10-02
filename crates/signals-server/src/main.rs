use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use signals_server::{auth, App, Counters};
use signals_store::checked_query_scalar;
use signals_store::{random_secret, Store};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::{broadcast, watch};
use uuid::Uuid;

#[derive(Parser)]
#[command(
    name = "signals",
    version,
    about = "Self-hosted MCP observability collector"
)]
struct Cli {
    #[arg(long, env = "DATABASE_URL")]
    database_url: Option<String>,
    #[arg(long, env = "SIGNALS_URL", default_value = "http://localhost:8300")]
    url: String,
    #[arg(long, env = "SIGNALS_ADMIN_TOKEN")]
    admin_token: Option<String>,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(long, env = "SIGNALS_BIND", default_value = "0.0.0.0:8300")]
        bind: SocketAddr,
    },
    Migrate,
    Openapi,
    Tenant {
        #[command(subcommand)]
        command: TenantCommand,
    },
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    Key {
        #[command(subcommand)]
        command: KeyCommand,
    },
    User {
        #[command(subcommand)]
        command: UserCommand,
    },
}
#[derive(Subcommand)]
enum TenantCommand {
    Create {
        #[arg(long)]
        slug: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        external_id: Option<String>,
    },
}
#[derive(Subcommand)]
enum ProjectCommand {
    Create {
        #[arg(long)]
        tenant: Uuid,
        #[arg(long)]
        slug: String,
        #[arg(long)]
        name: String,
    },
}
#[derive(Subcommand)]
enum KeyCommand {
    Create {
        #[arg(long)]
        project: Uuid,
        #[arg(long)]
        label: String,
        #[arg(long, default_value = "ingest", value_delimiter = ',')]
        scopes: Vec<String>,
    },
}
#[derive(Subcommand)]
enum UserCommand {
    Create {
        #[arg(long)]
        tenant: Uuid,
        #[arg(long)]
        email: String,
        #[arg(long, env = "SIGNALS_USER_PASSWORD")]
        password: String,
        #[arg(long, default_value = "owner")]
        role: String,
    },
}
#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let telemetry = if matches!(&cli.command, Command::Serve { .. }) {
        signals_server::telemetry::init()?
    } else {
        None
    };
    if matches!(&cli.command, Command::Openapi) {
        use utoipa::OpenApi;
        println!(
            "{}",
            signals_server::openapi::ReadApi::openapi().to_pretty_json()?
        );
        return Ok(());
    }
    if !matches!(&cli.command, Command::Serve { .. } | Command::Migrate) {
        let token = cli
            .admin_token
            .as_deref()
            .context("SIGNALS_ADMIN_TOKEN is required for provisioning")?;
        let (route, input) = match cli.command {
            Command::Tenant {
                command:
                    TenantCommand::Create {
                        slug,
                        name,
                        external_id,
                    },
            } => (
                "tenants",
                serde_json::json!({"slug":slug,"name":name,"external_id":external_id}),
            ),
            Command::Project {
                command: ProjectCommand::Create { tenant, slug, name },
            } => (
                "projects",
                serde_json::json!({"tenant_id":tenant,"slug":slug,"name":name}),
            ),
            Command::Key {
                command:
                    KeyCommand::Create {
                        project,
                        label,
                        scopes,
                    },
            } => (
                "keys",
                serde_json::json!({"project_id":project,"label":label,"scopes":scopes}),
            ),
            Command::User {
                command:
                    UserCommand::Create {
                        tenant,
                        email,
                        password,
                        role,
                    },
            } => (
                "users",
                serde_json::json!({"tenant_id":tenant,"email":email,"password":password,"role":role}),
            ),
            _ => unreachable!(),
        };
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?
            .post(format!(
                "{}/v1/admin/{route}",
                cli.url.trim_end_matches('/')
            ))
            .bearer_auth(token)
            .json(&input)
            .send()
            .await?;
        let status = response.status();
        let body: serde_json::Value = response.json().await?;
        anyhow::ensure!(
            status.is_success(),
            "Provisioning failed ({status}): {}",
            body["error"].as_str().unwrap_or("Invalid response")
        );
        if route == "keys" {
            println!(
                "{}",
                body["secret"]
                    .as_str()
                    .context("Key response missing secret")?
            );
        } else {
            println!("{body}");
        }
        return Ok(());
    }
    let database_url = cli
        .database_url
        .as_deref()
        .context("DATABASE_URL is required for serve/migrate")?;
    let store = Store::connect(database_url).await?;
    if matches!(&cli.command, Command::Migrate)
        || std::env::var("SIGNALS_MIGRATE").as_deref() != Ok("false")
    {
        store.migrate().await?;
    }
    match cli.command {
        Command::Migrate => println!("Migrations applied"),
        Command::Serve { bind } => {
            let admin_token = cli.admin_token.context("SIGNALS_ADMIN_TOKEN is required")?;
            anyhow::ensure!(
                admin_token.len() >= 32,
                "Admin token must have at least 32 characters"
            );
            let session_secret = std::env::var("SIGNALS_SESSION_SECRET")
                .context("SIGNALS_SESSION_SECRET is required")?;
            anyhow::ensure!(
                session_secret.len() >= 32,
                "Session secret must have at least 32 characters"
            );
            let public_url = url::Url::parse(
                &std::env::var("SIGNALS_PUBLIC_URL")
                    .unwrap_or_else(|_| format!("http://localhost:{}", bind.port())),
            )?;
            anyhow::ensure!(
                matches!(public_url.scheme(), "http" | "https")
                    && public_url.host_str().is_some()
                    && public_url.username().is_empty()
                    && public_url.password().is_none(),
                "SIGNALS_PUBLIC_URL must be an HTTP(S) URL without credentials"
            );
            let public_origin = public_url.origin().ascii_serialization();
            let mut allowed_origins = vec![public_origin.clone()];
            for origin in std::env::var("SIGNALS_CORS_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                let parsed = url::Url::parse(origin).context("Invalid SIGNALS_CORS_ORIGINS URL")?;
                anyhow::ensure!(
                    matches!(parsed.scheme(), "http" | "https")
                        && parsed.host_str().is_some()
                        && parsed.username().is_empty()
                        && parsed.password().is_none()
                        && parsed.path() == "/"
                        && parsed.query().is_none()
                        && parsed.fragment().is_none(),
                    "CORS entries must be HTTP(S) origins"
                );
                allowed_origins.push(parsed.origin().ascii_serialization());
            }
            allowed_origins.sort();
            allowed_origins.dedup();
            if let Ok(email) = std::env::var("SIGNALS_BOOTSTRAP_EMAIL") {
                let mut bootstrap = store.pool.begin().await?;
                signals_store::checked_query!("SELECT pg_advisory_xact_lock($1)", 0x53494704_i64)
                    .execute(&mut *bootstrap)
                    .await?;
                let exists: bool = checked_query_scalar!(
                    "SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)",
                    email.to_lowercase()
                )
                .fetch_one(&store.pool)
                .await?;
                if !exists {
                    let password = std::env::var("SIGNALS_BOOTSTRAP_PASSWORD")
                        .context("Bootstrap password is required")?;
                    let tenant = store.tenant("default", "My workspace", None).await?;
                    store.project(tenant, "my-server", "My MCP server").await?;
                    store
                        .create_user(tenant, &email, &auth::password_hash(&password)?, "owner")
                        .await?;
                }
                bootstrap.commit().await?;
            }
            store.rollup().await?;
            store.maintain().await?;
            let (notices, _) = broadcast::channel(1024);
            let (stop, shutdown) = watch::channel(false);
            let app = App {
                store: store.clone(),
                event_store: Arc::new(store.clone()),
                key_cache: Default::default(),
                allowed_origins,
                admin_token,
                session_secret,
                public_origin,
                dummy_password_hash: auth::password_hash(&random_secret())?,
                notices: notices.clone(),
                counters: Arc::new(Counters::default()),
                shutdown: shutdown.clone(),
                login_limits: Default::default(),
            };
            let mut listener = sqlx::postgres::PgListener::connect(database_url).await?;
            listener.listen("signals_live").await?;
            listener.listen("signals_keys").await?;
            let key_cache = app.key_cache.clone();
            let mut listener_shutdown = shutdown.clone();
            let listener_task = tokio::spawn(async move {
                loop {
                    tokio::select! {notice=listener.recv()=>match notice{Ok(n)=>if n.channel()=="signals_keys"{if let Ok(id)=Uuid::parse_str(n.payload()){key_cache.lock().await.retain(|_,c|c.auth.id!=id);}}else if let Ok(v)=serde_json::from_str(n.payload()){let _=notices.send(v);},Err(e)=>{tracing::error!(error=%e,"live listener reconnecting");tokio::time::sleep(std::time::Duration::from_secs(1)).await;}},_=listener_shutdown.changed()=>break}
                }
            });
            let worker_store = store.clone();
            let mut worker_shutdown = shutdown.clone();
            let worker = tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                let mut ticks = 0u32;
                loop {
                    tokio::select! {_=interval.tick()=>{if let Err(e)=worker_store.rollup().await{tracing::error!(error=%e,"rollup failed");}ticks+=1;if ticks.is_multiple_of(10){if let Err(e)=worker_store.maintain().await{tracing::error!(error=%e,"maintenance failed");}}},_=worker_shutdown.changed()=>break}
                }
            });
            let listener = tokio::net::TcpListener::bind(bind).await?;
            tracing::info!(%bind,"Signals collector listening");
            let server = axum::serve(
                listener,
                signals_server::router(app).into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                shutdown_signal().await;
                let _ = stop.send(true);
            });
            let mut server_task = tokio::spawn(async move { server.await });
            let mut draining = shutdown.clone();
            tokio::select! {
                result=&mut server_task=>{result??;},
                _=draining.changed()=>{match tokio::time::timeout(std::time::Duration::from_secs(10),&mut server_task).await{Ok(result)=>{result??;},Err(_)=>server_task.abort()}}
            }
            worker.abort();
            listener_task.abort();
            store.pool.close().await;
        }
        _ => unreachable!(),
    }
    if let Some(provider) = telemetry {
        tokio::task::spawn_blocking(move || provider.shutdown()).await??;
    }
    Ok(())
}
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("signal handler");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
