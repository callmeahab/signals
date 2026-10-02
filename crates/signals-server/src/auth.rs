use crate::{App, Error, Result};
use argon2::{
    password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2,
};
use axum::http::{header, HeaderMap};
use chrono::{DateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use serde::Serialize;
use sha2::Sha256;
use signals_store::{checked_query, checked_query_as};
use signals_store::{hash, Project};
use sqlx::{FromRow, Row};
use uuid::Uuid;

#[derive(Clone, Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub role: String,
}
#[derive(Clone)]
pub struct KeyAuth {
    pub id: Uuid,
    pub project: Project,
    pub salt: Vec<u8>,
}
#[derive(Clone)]
pub struct CachedKey {
    pub auth: KeyAuth,
    pub secret_hash: Vec<u8>,
    pub scopes: Vec<String>,
    pub expires: std::time::Instant,
}
pub fn password_hash(password: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        password.len() >= 12,
        "Password must have at least 12 characters"
    );
    Ok(Argon2::default()
        .hash_password(password.as_bytes())
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .to_string())
}
fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}
pub fn admin(app: &App, headers: &HeaderMap) -> Result<()> {
    if bearer(headers).is_some_and(|v| {
        constant_time_eq::constant_time_eq(v.as_bytes(), app.admin_token.as_bytes())
    }) {
        Ok(())
    } else {
        Err(Error::unauthorized())
    }
}
pub fn check_origin(app: &App, headers: &HeaderMap) -> Result<()> {
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !origin
            .to_str()
            .ok()
            .is_some_and(|o| app.allowed_origins.iter().any(|a| a == o))
        {
            return Err(Error::forbidden("Origin is not allowed"));
        }
    }
    if headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("cross-site") {
        return Err(Error::forbidden("Cross-site request is not allowed"));
    }
    Ok(())
}
fn signature(app: &App, secret: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(app.session_secret.as_bytes())
        .expect("HMAC accepts any key");
    mac.update(secret.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
pub fn signed_cookie(app: &App, secret: &str) -> String {
    format!("{secret}.{}", signature(app, secret))
}
pub fn session_secret(app: &App, headers: &HeaderMap) -> Option<String> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    let cookie = cookies
        .split(';')
        .find_map(|v| v.trim().strip_prefix("signals_session="))?;
    let (secret, sig) = cookie.split_once('.')?;
    if constant_time_eq::constant_time_eq(sig.as_bytes(), signature(app, secret).as_bytes()) {
        Some(secret.to_owned())
    } else {
        None
    }
}
pub async fn user(app: &App, headers: &HeaderMap) -> Result<User> {
    let secret = session_secret(app, headers).ok_or_else(Error::unauthorized)?;
    checked_query_as!("SELECT u.id,u.tenant_id,u.email,u.role FROM dashboard_sessions s JOIN users u ON u.id=s.user_id WHERE s.secret_hash=$1 AND s.expires_at>now()" ,hash(&secret)).fetch_optional(&app.store.pool).await?.ok_or_else(Error::unauthorized)
}
pub async fn key(app: &App, headers: &HeaderMap, scope: &str) -> Result<KeyAuth> {
    let value = bearer(headers).ok_or_else(Error::unauthorized)?;
    let (id, secret) = value
        .strip_prefix("sgk_")
        .and_then(|v| v.split_once('_'))
        .ok_or_else(Error::unauthorized)?;
    let cached = {
        let mut cache = app.key_cache.lock().await;
        let now = std::time::Instant::now();
        cache.retain(|_, v| v.expires > now);
        cache.get(id).cloned()
    };
    let from_cache = cached.is_some();
    let cached = if let Some(c) = cached {
        c
    } else {
        let row=checked_query!("SELECT k.id,k.project_id,k.secret_hash,k.scopes,t.ip_salt FROM api_keys k JOIN projects p ON p.id=k.project_id JOIN tenants t ON t.id=p.tenant_id WHERE k.key_id=$1 AND k.revoked_at IS NULL AND p.deleted_at IS NULL" ,id).fetch_optional(&app.store.pool).await?.ok_or_else(Error::unauthorized)?;
        let project = app
            .store
            .get_project(row.get("project_id"))
            .await?
            .ok_or_else(Error::unauthorized)?;
        let auth = KeyAuth {
            id: row.get("id"),
            project,
            salt: row.get("ip_salt"),
        };
        CachedKey {
            auth,
            secret_hash: row.get("secret_hash"),
            scopes: row.get("scopes"),
            expires: std::time::Instant::now() + std::time::Duration::from_secs(30),
        }
    };
    if !constant_time_eq::constant_time_eq(&cached.secret_hash, &hash(secret)) {
        return Err(Error::unauthorized());
    }
    if !cached.scopes.iter().any(|s| s == scope) {
        return Err(Error::forbidden("Key does not have the required scope"));
    }
    if !from_cache {
        let mut cache = app.key_cache.lock().await;
        if cache.len() >= 4096 {
            cache.clear();
        }
        cache.insert(id.to_owned(), cached.clone());
        drop(cache);
        checked_query!("UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute')" ,cached.auth.id).execute(&app.store.pool).await?;
    }
    let mut auth = cached.auth;
    auth.project=checked_query_as!("SELECT p.id,p.tenant_id,p.slug,p.name,p.retention_days,p.rate_events_per_min,p.rate_bytes_per_min FROM projects p JOIN api_keys k ON k.project_id=p.id WHERE p.id=$1 AND k.id=$2 AND k.revoked_at IS NULL AND p.deleted_at IS NULL",auth.project.id,auth.id).fetch_optional(&app.store.pool).await?.ok_or_else(Error::unauthorized)?;
    Ok(auth)
}

pub async fn read(app: &App, headers: &HeaderMap, project: Uuid, owner: bool) -> Result<Project> {
    let p = app
        .store
        .get_project(project)
        .await?
        .ok_or_else(|| Error::not_found("Project not found"))?;
    if bearer(headers).is_some() {
        let key = key(app, headers, "read").await?;
        if key.project.id != project || owner {
            return Err(Error::forbidden("This key cannot access this operation"));
        }
    } else {
        let u = user(app, headers).await?;
        if u.tenant_id != p.tenant_id || (owner && u.role != "owner") {
            return Err(Error::forbidden(
                "This account cannot access this operation",
            ));
        }
        if owner {
            check_origin(app, headers)?;
        }
    }
    Ok(p)
}
pub async fn verify_login(app: &App, email: &str, password: &str) -> Result<User> {
    let row = checked_query!(
        "SELECT password_hash FROM users WHERE email=$1",
        email.to_lowercase()
    )
    .fetch_optional(&app.store.pool)
    .await?;
    let stored = row
        .as_ref()
        .map(|r| r.get::<String, _>("password_hash"))
        .unwrap_or_else(|| app.dummy_password_hash.clone());
    let password = password.to_owned();
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&stored).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await
    .map_err(Error::internal)?;
    if !valid || row.is_none() {
        return Err(Error::unauthorized());
    }
    Ok(checked_query_as!(
        "SELECT id,tenant_id,email,role FROM users WHERE email=$1",
        email.to_lowercase()
    )
    .fetch_one(&app.store.pool)
    .await?)
}
pub async fn account(app: &App, user: User) -> Result<serde_json::Value> {
    let projects:Vec<Project>=checked_query_as!("SELECT id,tenant_id,slug,name,retention_days,rate_events_per_min,rate_bytes_per_min FROM projects WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name" ,user.tenant_id).fetch_all(&app.store.pool).await?;
    Ok(serde_json::json!({"user":user,"projects":projects}))
}
pub fn cookie(app: &App, value: &str, max_age: i64) -> String {
    format!(
        "signals_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}",
        if app.public_origin.starts_with("https:") {
            "; Secure"
        } else {
            ""
        }
    )
}
pub fn network_identity(salt: &[u8], ip: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(salt).expect("HMAC key");
    mac.update(ip.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
pub fn parse_event_cursor(value: Option<&str>) -> Result<Option<(DateTime<Utc>, Uuid)>> {
    value
        .map(|v| {
            let (ts, id) = v
                .split_once('|')
                .ok_or_else(|| Error::bad("Invalid cursor"))?;
            Ok((
                ts.parse()
                    .map_err(|_| Error::bad("Invalid cursor timestamp"))?,
                Uuid::parse_str(id).map_err(|_| Error::bad("Invalid cursor ID"))?,
            ))
        })
        .transpose()
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;

    #[test]
    fn verifies_existing_argon2_05_password_hashes() {
        // Generated with argon2 0.5.3: upgrades must preserve existing logins.
        let encoded = "$argon2id$v=19$m=19456,t=2,p=1$c2lnbmFscy11cGdyYWRlLXRlc3Qtc2FsdA$D8TjQvxGmNp/hNoLxvtvIPFtGS7PBMS8NT9oBalFBg4";
        let parsed = PasswordHash::new(encoded).unwrap();
        assert!(Argon2::default()
            .verify_password(b"signals-upgrade-test-password", &parsed)
            .is_ok());
        assert!(Argon2::default()
            .verify_password(b"incorrect-password", &parsed)
            .is_err());
        let fresh = password_hash("signals-upgrade-test-password").unwrap();
        assert!(Argon2::default()
            .verify_password(
                b"signals-upgrade-test-password",
                &PasswordHash::new(&fresh).unwrap()
            )
            .is_ok());
    }

    #[test]
    fn preserves_hmac_sha256_identity() {
        assert_eq!(
            network_identity(b"signals-upgrade-test-key", "127.0.0.1"),
            "457f47b897d7d7595554229fc85c3a1f0783a4301fb06147a00394036b0e9b2b"
        );
    }
}
