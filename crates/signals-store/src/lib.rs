pub mod checked;
pub mod event_store;
pub mod ingest;
pub mod read;
pub mod workers;

use anyhow::Result;
use chrono::{DateTime, Utc};
use rand::TryRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use uuid::Uuid;

type CallerCache = std::sync::Arc<
    tokio::sync::Mutex<
        std::collections::HashMap<(Uuid, String, String), (i64, std::time::Instant)>,
    >,
>;
#[derive(Clone)]
pub struct Store {
    pub pool: PgPool,
    pub caller_cache: CallerCache,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
    pub retention_days: i32,
    pub rate_events_per_min: i32,
    pub rate_bytes_per_min: i64,
}
#[derive(Debug, Serialize, FromRow)]
pub struct ApiKey {
    pub id: Uuid,
    pub project_id: Uuid,
    pub key_id: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}
pub fn random_secret() -> String {
    let mut bytes = [0; 32];
    rand::rngs::SysRng
        .try_fill_bytes(&mut bytes)
        .expect("System random source unavailable");
    hex::encode(bytes)
}
pub fn hash(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}
fn migration_checksum_matches(migration: &sqlx::migrate::Migration, checksum: &[u8]) -> bool {
    migration.checksum.as_ref() == checksum
        || (migration.version == 2
            && hex::encode(migration.checksum.as_ref())
                == "ad2d732bb9d7abbe8721dc170a8d096e9a08bbb1a0de3a8ac28bc8fbf00da8f7f0b5dad33819b748a9925f1d4da96152"
            && hex::encode(checksum)
                == "bc172fa86f15bd6da8fae1fe203cef5ace66a50147d371931d16c3f2c496dff11b0a9ed0cfb438437d48502a043e5f79")
}

impl Store {
    pub async fn connect(url: &str) -> Result<Self> {
        Ok(Self {
            caller_cache: Default::default(),
            pool: PgPoolOptions::new()
                .max_connections(16)
                .after_connect(|conn, _| {
                    Box::pin(async move {
                        checked_query!("SET TIME ZONE 'UTC'").execute(conn).await?;
                        Ok(())
                    })
                })
                .connect(url)
                .await?,
        })
    }
    pub async fn migrations_current(&self) -> Result<bool> {
        let migrator = sqlx::migrate!("./migrations");
        let rows = checked_query!(
            "SELECT version,checksum FROM _sqlx_migrations WHERE success ORDER BY version"
        )
        .fetch_all(&self.pool)
        .await?;
        use sqlx::Row;
        Ok(rows.len() == migrator.iter().count()
            && migrator.iter().all(|m| {
                rows.iter().any(|r| {
                    r.get::<i64, _>("version") == m.version
                        && migration_checksum_matches(m, &r.get::<Vec<u8>, _>("checksum"))
                })
            }))
    }
    pub async fn migrate(&self) -> Result<()> {
        use sqlx::migrate::Migrate;
        let mut connection = self.pool.acquire().await?;
        connection.lock().await?;
        let result: Result<()> = async {
            connection
                .ensure_migrations_table("_sqlx_migrations")
                .await?;
            let applied = connection
                .list_applied_migrations("_sqlx_migrations")
                .await?;
            let mut migrator = sqlx::migrate!("./migrations");
            for migration in migrator.migrations.to_mut() {
                if let Some(previous) = applied.iter().find(|previous| {
                    previous.version == migration.version
                        && migration_checksum_matches(migration, previous.checksum.as_ref())
                }) {
                    migration.checksum = previous.checksum.clone();
                }
            }
            migrator.set_locking(false).run(&mut *connection).await?;
            Ok(())
        }
        .await;
        connection.unlock().await?;
        result
    }
    pub async fn tenant(&self, slug: &str, name: &str, external: Option<&str>) -> Result<Uuid> {
        let salt = hash(&random_secret());
        Ok(checked_query_scalar!("INSERT INTO tenants(id,slug,name,external_id,ip_salt) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id" ,Uuid::new_v4(),slug,name,external,salt).fetch_one(&self.pool).await?)
    }
    pub async fn project(&self, tenant: Uuid, slug: &str, name: &str) -> Result<Project> {
        Ok(checked_query_as!("INSERT INTO projects(id,tenant_id,slug,name) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,slug) DO UPDATE SET name=EXCLUDED.name RETURNING id,tenant_id,slug,name,retention_days,rate_events_per_min,rate_bytes_per_min" ,Uuid::new_v4(),tenant,slug,name).fetch_one(&self.pool).await?)
    }
    pub async fn get_project(&self, project: Uuid) -> Result<Option<Project>> {
        Ok(checked_query_as!("SELECT id,tenant_id,slug,name,retention_days,rate_events_per_min,rate_bytes_per_min FROM projects WHERE id=$1 AND deleted_at IS NULL" ,project).fetch_optional(&self.pool).await?)
    }
    pub async fn keys(&self, project: Uuid) -> Result<Vec<ApiKey>> {
        Ok(checked_query_as!("SELECT id,project_id,key_id,label,scopes,created_at,last_used_at,revoked_at FROM api_keys WHERE project_id=$1 ORDER BY created_at DESC" ,project).fetch_all(&self.pool).await?)
    }
    pub async fn create_key(
        &self,
        project: Uuid,
        label: &str,
        scopes: Vec<String>,
    ) -> Result<(ApiKey, String)> {
        anyhow::ensure!(
            !scopes.is_empty() && scopes.iter().all(|s| s == "ingest" || s == "read"),
            "Invalid scopes"
        );
        let key_id = Uuid::new_v4().simple().to_string();
        let secret = random_secret();
        let key: ApiKey = checked_query_as!("INSERT INTO api_keys(id,project_id,key_id,secret_hash,scopes,label) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,project_id,key_id,label,scopes,created_at,last_used_at,revoked_at" ,Uuid::new_v4(),project,&key_id,hash(&secret),&scopes,label).fetch_one(&self.pool).await?;
        Ok((key, format!("sgk_{key_id}_{secret}")))
    }
    pub async fn create_user(
        &self,
        tenant: Uuid,
        email: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<Uuid> {
        Ok(checked_query_scalar!("INSERT INTO users(id,tenant_id,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id" ,Uuid::new_v4(),tenant,email.to_lowercase(),password_hash,role).fetch_one(&self.pool).await?)
    }
}
