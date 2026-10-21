//! Google is consulted only at sign-in. No runtime fake verifier or configurable key URL.
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const KEYS: &str = "https://www.googleapis.com/oauth2/v3/certs";

#[derive(Debug, Deserialize)]
pub struct Claims {
    pub email: String,
    pub email_verified: bool,
    pub sub: String,
    pub exp: u64,
    pub iat: u64,
    pub picture: Option<String>,
    pub azp: Option<String>,
}

struct Cache {
    keys: Option<JwkSet>,
    expires: Instant,
    retry_after: Instant,
}

pub struct Google {
    pub client_id: String,
    client: reqwest::Client,
    cache: Mutex<Cache>,
}

#[derive(Debug, PartialEq)]
pub enum VerifyError {
    Invalid,
    Unavailable,
}

impl Google {
    pub fn new(client_id: String) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .connect_timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Cannot initialize Google verification")?;
        Ok(Self {
            client_id,
            client,
            cache: Mutex::new(Cache {
                keys: None,
                expires: Instant::now(),
                retry_after: Instant::now(),
            }),
        })
    }

    pub async fn verify(&self, token: &str) -> Result<Claims, VerifyError> {
        if token.len() > 8192 {
            return Err(VerifyError::Invalid);
        }
        let header = decode_header(token).map_err(|_| VerifyError::Invalid)?;
        if header.alg != Algorithm::RS256 {
            return Err(VerifyError::Invalid);
        }
        let kid = header
            .kid
            .filter(|k| !k.is_empty() && k.len() <= 200)
            .ok_or(VerifyError::Invalid)?;
        // Single flight, including failures/unknown kids. A bad credential cannot force a fetch loop.
        let mut cache = self.cache.lock().await;
        let now = Instant::now();
        let known = cache
            .keys
            .as_ref()
            .is_some_and(|keys| keys.find(&kid).is_some());
        if (now >= cache.expires || !known) && now >= cache.retry_after {
            cache.retry_after = now + Duration::from_secs(60);
            let (keys, ttl) = self.fetch_keys().await?;
            cache.keys = Some(keys);
            cache.expires = Instant::now() + Duration::from_secs(ttl);
        }
        if Instant::now() >= cache.expires {
            return Err(VerifyError::Unavailable);
        }
        let keys = cache.keys.as_ref().ok_or(VerifyError::Unavailable)?;
        verify_with_keys(token, &self.client_id, keys)
    }

    async fn fetch_keys(&self) -> Result<(JwkSet, u64), VerifyError> {
        // Bound both elapsed time (including body) and allocation; never follow redirects.
        tokio::time::timeout(Duration::from_secs(8), async {
            let mut response = self
                .client
                .get(KEYS)
                .send()
                .await
                .map_err(|_| VerifyError::Unavailable)?;
            if !response.status().is_success() {
                return Err(VerifyError::Unavailable);
            }
            let ttl = response
                .headers()
                .get("cache-control")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    v.split(',')
                        .find_map(|p| p.trim().strip_prefix("max-age=")?.parse::<u64>().ok())
                })
                .unwrap_or(300)
                .clamp(60, 3600);
            let mut body = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| VerifyError::Unavailable)?
            {
                if body.len() + chunk.len() > 65536 {
                    return Err(VerifyError::Unavailable);
                }
                body.extend_from_slice(&chunk);
            }
            let keys: JwkSet =
                serde_json::from_slice(&body).map_err(|_| VerifyError::Unavailable)?;
            if keys.keys.is_empty() || keys.keys.len() > 16 {
                return Err(VerifyError::Unavailable);
            }
            Ok((keys, ttl))
        })
        .await
        .map_err(|_| VerifyError::Unavailable)?
    }
}

fn verify_with_keys(token: &str, client: &str, keys: &JwkSet) -> Result<Claims, VerifyError> {
    let header = decode_header(token).map_err(|_| VerifyError::Invalid)?;
    if header.alg != Algorithm::RS256 {
        return Err(VerifyError::Invalid);
    }
    let jwk = keys
        .find(header.kid.as_deref().ok_or(VerifyError::Invalid)?)
        .ok_or(VerifyError::Invalid)?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| VerifyError::Invalid)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client]);
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = 0;
    let claims = decode::<Claims>(token, &key, &validation)
        .map_err(|_| VerifyError::Invalid)?
        .claims;
    if !claims.email_verified
        || claims.sub.is_empty()
        || claims.sub.len() > 255
        || claims.iat > super::now() + 60
        || claims.exp <= super::now()
        || claims.azp.as_ref().is_some_and(|azp| azp != client)
        || super::people::normalize_email(&claims.email).is_err()
    {
        return Err(VerifyError::Invalid);
    }
    Ok(claims)
}

#[cfg(test)]
#[path = "google_tests.rs"]
mod tests;

pub fn safe_picture(value: Option<String>) -> Option<String> {
    value.filter(|v| {
        v.len() <= 500
            && reqwest::Url::parse(v).is_ok_and(|url| {
                url.scheme() == "https"
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.port().is_none()
                    && url.host_str().is_some_and(|h| {
                        h == "lh3.googleusercontent.com" || h.ends_with(".googleusercontent.com")
                    })
            })
    })
}
