//! Staff authentication is local to BMT Live; no Lemon cookies or SSO are shared.
use std::{
    collections::{HashMap, VecDeque},
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use argon2::{
    password_hash::{PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::routes::AppState;

const COOKIE: &str = "bmt_live_staff";
const MAX_SESSIONS: usize = 4096;
const ALL: [Capability; 9] = [
    Capability::ScheduleWrite,
    Capability::UpdatesRead,
    Capability::UpdatesWrite,
    Capability::ContentWrite,
    Capability::RoomsWrite,
    Capability::FoundRead,
    Capability::FoundWrite,
    Capability::PublishingWrite,
    Capability::AccessRead,
];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum Capability {
    #[serde(rename = "schedule:write")]
    ScheduleWrite,
    #[serde(rename = "updates:read")]
    UpdatesRead,
    #[serde(rename = "updates:write")]
    UpdatesWrite,
    #[serde(rename = "content:write")]
    ContentWrite,
    #[serde(rename = "rooms:write")]
    RoomsWrite,
    #[serde(rename = "found:read")]
    FoundRead,
    #[serde(rename = "found:write")]
    FoundWrite,
    #[serde(rename = "publishing:write")]
    PublishingWrite,
    #[serde(rename = "access:read")]
    AccessRead,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Dispatcher,
    CrisisManager,
    InfoDesk,
    Administrator,
}

impl Role {
    pub fn capabilities(self) -> Vec<Capability> {
        use Capability::*;
        match self {
            Self::Dispatcher => vec![ScheduleWrite, UpdatesRead, UpdatesWrite, AccessRead],
            Self::CrisisManager => {
                vec![UpdatesRead, UpdatesWrite, FoundRead, FoundWrite, AccessRead]
            }
            Self::InfoDesk => vec![UpdatesRead, FoundRead, FoundWrite, AccessRead],
            Self::Administrator => ALL.to_vec(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffIdentity {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub capabilities: Vec<Capability>,
    pub demo: bool,
    pub auth_source: &'static str,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Account {
    id: String,
    username: String,
    name: String,
    role: Role,
    password_hash: String,
    /// When present this is an explicit allow-list, not extra grants on top of a role.
    capabilities: Option<Vec<Capability>>,
}

impl Account {
    fn identity(&self) -> StaffIdentity {
        StaffIdentity {
            id: self.id.clone(),
            name: self.name.clone(),
            role: self.role,
            capabilities: self
                .capabilities
                .clone()
                .unwrap_or_else(|| self.role.capabilities()),
            demo: false,
            auth_source: "account",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountFile {
    accounts: Vec<Account>,
}

#[derive(Clone)]
struct Session {
    user: StaffIdentity,
    csrf: String,
    expires_at: u64,
}

pub struct StaffStore {
    accounts: Vec<Account>,
    sessions: Mutex<HashMap<String, Session>>,
    attempts: Mutex<VecDeque<u64>>,
    password_slots: Arc<tokio::sync::Semaphore>,
    dummy_hash: String,
    demo_mode: bool,
    secure_cookie: bool,
    public_origin: Option<String>,
    ttl: u64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn equal_secret(a: &str, b: &str) -> bool {
    let a = Sha256::digest(a.as_bytes());
    let b = Sha256::digest(b.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}
fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

impl StaffStore {
    /// Invalid configuration aborts startup; absent accounts never grant access.
    pub fn from_env() -> Result<Self, String> {
        let demo_mode = std::env::var("DEMO_MODE").as_deref() == Ok("true");
        let secure_cookie = match std::env::var("STAFF_COOKIE_SECURE").as_deref() {
            Ok("false") if demo_mode => false,
            Ok("false") => {
                return Err("STAFF_COOKIE_SECURE=false is allowed only with DEMO_MODE=true".into())
            }
            Ok("true") | Err(_) => true,
            _ => return Err("STAFF_COOKIE_SECURE must be true or false".into()),
        };
        let ttl = std::env::var("STAFF_SESSION_TTL_SECONDS")
            .ok()
            .map(|v| v.parse::<u64>())
            .transpose()
            .map_err(|_| "Invalid STAFF_SESSION_TTL_SECONDS")?
            .unwrap_or(8 * 60 * 60);
        if !(60..=86400).contains(&ttl) {
            return Err("STAFF_SESSION_TTL_SECONDS must be between 60 and 86400".into());
        }
        let public_origin = std::env::var("STAFF_PUBLIC_ORIGIN").ok();
        if let Some(origin) = &public_origin {
            let url = reqwest::Url::parse(origin).map_err(|_| "Invalid STAFF_PUBLIC_ORIGIN")?;
            if !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path() != "/"
                || url.host_str().is_none()
                || (url.scheme() != "https" && !(demo_mode && url.scheme() == "http"))
                || origin != &url.origin().ascii_serialization()
            {
                return Err("STAFF_PUBLIC_ORIGIN must be an exact HTTPS origin without a trailing slash (HTTP only in demo)".into());
            }
        }
        let accounts = match std::env::var("STAFF_ACCOUNTS_PATH") {
            Ok(path) if !path.trim().is_empty() => Self::read_accounts(Path::new(&path))?,
            Ok(_) => return Err("STAFF_ACCOUNTS_PATH cannot be empty".into()),
            Err(_) => Vec::new(),
        };
        Self::new(accounts, demo_mode, secure_cookie, public_origin, ttl)
    }

    fn new(
        accounts: Vec<Account>,
        demo_mode: bool,
        secure_cookie: bool,
        public_origin: Option<String>,
        ttl: u64,
    ) -> Result<Self, String> {
        let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes())
            .map_err(|_| "Cannot generate password salt")?;
        let dummy_hash = Argon2::default()
            .hash_password(random_token().as_bytes(), &salt)
            .map_err(|_| "Cannot initialize password verifier")?
            .to_string();
        Ok(Self {
            accounts,
            sessions: Mutex::new(HashMap::new()),
            attempts: Mutex::new(VecDeque::new()),
            password_slots: Arc::new(tokio::sync::Semaphore::new(4)),
            dummy_hash,
            demo_mode,
            secure_cookie,
            public_origin,
            ttl,
        })
    }

    fn read_accounts(path: &Path) -> Result<Vec<Account>, String> {
        let metadata = std::fs::metadata(path).map_err(|_| "Cannot read STAFF_ACCOUNTS_PATH")?;
        if !metadata.is_file() || metadata.len() > 1_048_576 {
            return Err("Staff account file must be a file smaller than 1 MiB".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(
                    "Staff account file must be private: chmod 600 STAFF_ACCOUNTS_PATH".into(),
                );
            }
        }
        let bytes = std::fs::read(path).map_err(|_| "Cannot read staff account file")?;
        let file: AccountFile = serde_json::from_slice(&bytes)
            .map_err(|_| "Staff account JSON is invalid; check the documented schema")?;
        if file.accounts.len() > 2000 {
            return Err("Too many staff accounts (maximum 2000)".into());
        }
        let mut usernames = std::collections::HashSet::new();
        let mut ids = std::collections::HashSet::new();
        for account in &file.accounts {
            if account.id.trim().is_empty()
                || account.id == "owner"
                || account.id.len() > 128
                || account.name.trim().is_empty()
                || account.name.len() > 200
                || account.username.is_empty()
                || account.username.len() > 128
                || !account
                    .username
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-@".contains(&c))
                || account.username == "owner"
                || account.id.starts_with("demo-")
                || account.username.starts_with("demo-")
                || !usernames.insert(&account.username)
                || !ids.insert(&account.id)
            {
                return Err(
                    "Staff account names or IDs are invalid, reserved or duplicated".into(),
                );
            }
            let hash = PasswordHash::new(&account.password_hash)
                .map_err(|_| "Invalid Argon2 password hash")?;
            let memory = hash.params.get_decimal("m").unwrap_or(0);
            let time = hash.params.get_decimal("t").unwrap_or(0);
            let lanes = hash.params.get_decimal("p").unwrap_or(0);
            if hash.algorithm.as_str() != "argon2id"
                || hash.version != Some(19)
                || hash.salt.is_none()
                || hash.hash.is_none()
                || !(19456..=262144).contains(&memory)
                || !(2..=10).contains(&time)
                || !(1..=8).contains(&lanes)
            {
                return Err(
                    "Use an Argon2id v19 hash with m=19456..262144, t=2..10, p=1..8".into(),
                );
            }
        }
        Ok(file.accounts)
    }

    fn issue(&self, user: StaffIdentity, timestamp: u64) -> Option<(String, Session)> {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, session| session.expires_at > timestamp);
        if sessions.len() >= MAX_SESSIONS {
            return None;
        }
        let token = random_token();
        let session = Session {
            user,
            csrf: random_token(),
            expires_at: timestamp + self.ttl,
        };
        sessions.insert(digest(&token), session.clone());
        Some((token, session))
    }

    fn session(&self, headers: &HeaderMap, timestamp: u64) -> Option<Session> {
        let token = cookie_token(headers)?;
        let key = digest(token);
        let mut sessions = self.sessions.lock().unwrap();
        if sessions
            .get(&key)
            .is_some_and(|session| session.expires_at <= timestamp)
        {
            sessions.remove(&key);
        }
        sessions.get(&key).cloned()
    }

    fn revoke(&self, headers: &HeaderMap) {
        if let Some(token) = cookie_token(headers) {
            self.sessions.lock().unwrap().remove(&digest(token));
        }
    }

    fn allow_login(&self, timestamp: u64) -> bool {
        let mut attempts = self.attempts.lock().unwrap();
        while attempts
            .front()
            .is_some_and(|t| timestamp.saturating_sub(*t) >= 60)
        {
            attempts.pop_front();
        }
        if attempts.len() >= 30 {
            return false;
        }
        attempts.push_back(timestamp);
        true
    }

    fn cookie(&self, token: &str, max_age: u64) -> String {
        format!(
            "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{}",
            if self.secure_cookie { "; Secure" } else { "" }
        )
    }
}

fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|pair| {
            let (key, value) = pair.trim().split_once('=')?;
            (key == COOKIE && value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
                .then_some(value)
        })
}

fn owner() -> StaffIdentity {
    StaffIdentity {
        id: "owner".into(),
        name: "Owner fallback".into(),
        role: Role::Administrator,
        capabilities: ALL.to_vec(),
        demo: false,
        auth_source: "owner",
    }
}

fn basic_owner(state: &AppState, headers: &HeaderMap) -> Option<StaffIdentity> {
    let expected = state.admin_password.as_ref().filter(|p| !p.is_empty())?;
    let encoded = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Basic ")?;
    if encoded.len() > 4096 {
        return None;
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (_, password) = text.split_once(':')?;
    equal_secret(password, expected).then(owner)
}

pub fn identity(state: &AppState, headers: &HeaderMap) -> Option<StaffIdentity> {
    state
        .staff
        .session(headers, now())
        .map(|s| s.user)
        .or_else(|| basic_owner(state, headers))
}

/// Use for future-preview gating on the otherwise public /api/live endpoint.
pub fn can(state: &AppState, headers: &HeaderMap, capability: Capability) -> bool {
    identity(state, headers).is_some_and(|user| user.capabilities.contains(&capability))
}

fn api_error(status: StatusCode, message: &str) -> Response {
    let mut response = (status, Json(serde_json::json!({"error": message}))).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

/// Browser mutations must originate at this host (or the explicitly trusted origin).
/// Never trust X-Forwarded-Host supplied by an arbitrary client.
fn same_origin(store: &StaffStore, headers: &HeaderMap) -> bool {
    if headers
        .get("sec-fetch-site")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|site| site != "same-origin" && site != "none")
    {
        return false;
    }
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    if let Some(expected) = &store.public_origin {
        return origin == expected;
    }
    let Ok(url) = reqwest::Url::parse(origin) else {
        return false;
    };
    if origin != url.origin().ascii_serialization()
        || (url.scheme() != "https" && !(store.demo_mode && url.scheme() == "http"))
    {
        return false;
    }
    let Some(host) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) else {
        return false;
    };
    origin == format!("{}://{host}", url.scheme())
}

fn json_intent(headers: &HeaderMap) -> bool {
    headers.get("x-staff-request").and_then(|h| h.to_str().ok()) == Some("1")
}
fn csrf_valid(store: &StaffStore, headers: &HeaderMap) -> bool {
    let Some(session) = store.session(headers, now()) else {
        return false;
    };
    headers
        .get("x-staff-csrf")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|token| equal_secret(token, &session.csrf))
}

fn resource(path: &str, base: &str) -> bool {
    path == base || path.strip_prefix(base).is_some_and(|s| s.starts_with('/'))
}

/// Deliberately deny unknown protected routes. Public routes do NOT use this middleware.
pub fn capability_for_route(method: &Method, path: &str) -> Option<Capability> {
    use Capability::*;
    if *method == Method::GET && resource(path, "/admin") {
        return Some(AccessRead);
    }
    if *method == Method::GET && path == "/api/staff/access" {
        return Some(AccessRead);
    }
    if resource(path, "/api/publishing") {
        return Some(PublishingWrite);
    }
    if path == "/api/content"
        || resource(path, "/api/site/editor")
        || resource(path, "/api/site/media")
    {
        return Some(ContentWrite);
    }
    if resource(path, "/api/wayfinding/editor") || resource(path, "/api/room-lookup/staff") {
        return Some(RoomsWrite);
    }
    if resource(path, "/api/lost-found/staff") {
        return Some(if *method == Method::GET || *method == Method::HEAD {
            FoundRead
        } else {
            FoundWrite
        });
    }
    if resource(path, "/api/schedule") || resource(path, "/api/delays") {
        return Some(ScheduleWrite);
    }
    if resource(path, "/api/announcements") {
        return Some(if *method == Method::GET || *method == Method::HEAD {
            UpdatesRead
        } else {
            UpdatesWrite
        });
    }
    None
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let Some(user) = identity(&state, request.headers()) else {
        return if resource(request.uri().path(), "/admin") {
            Redirect::to("/staff/sign-in").into_response()
        } else {
            api_error(StatusCode::UNAUTHORIZED, "Sign in to continue.")
        };
    };
    let Some(capability) = capability_for_route(request.method(), request.uri().path()) else {
        return api_error(
            StatusCode::FORBIDDEN,
            "This route has no staff permission policy. Ask an administrator.",
        );
    };
    if !user.capabilities.contains(&capability) {
        return api_error(
            StatusCode::FORBIDDEN,
            "Your account cannot do this. Ask an administrator for access.",
        );
    }
    if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) {
        if !same_origin(&state.staff, request.headers()) {
            return api_error(
                StatusCode::FORBIDDEN,
                "Use the BMT Live staff workspace to make changes.",
            );
        }
        if state.staff.session(request.headers(), now()).is_some()
            && !csrf_valid(&state.staff, request.headers())
        {
            return api_error(
                StatusCode::FORBIDDEN,
                "Your security token is missing or expired. Reload and try again.",
            );
        }
    }
    // Downstream adapters can map this trusted identity into module-specific audit access.
    request.extensions_mut().insert(user);
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionView {
    user: Option<StaffIdentity>,
    csrf_token: Option<String>,
    expires_at: Option<u64>,
    demo_mode: bool,
    demo_accounts: Vec<StaffIdentity>,
    password_login_enabled: bool,
    owner_login_enabled: bool,
}

fn demos() -> Vec<StaffIdentity> {
    [
        ("demo-dispatcher", "Demo dispatcher", Role::Dispatcher),
        ("demo-crisis", "Demo crisis manager", Role::CrisisManager),
        ("demo-info", "Demo info desk", Role::InfoDesk),
        ("demo-admin", "Demo administrator", Role::Administrator),
    ]
    .into_iter()
    .map(|(id, name, role)| StaffIdentity {
        id: id.into(),
        name: name.into(),
        role,
        capabilities: role.capabilities(),
        demo: true,
        auth_source: "demo",
    })
    .collect()
}

fn session_response(
    state: &AppState,
    session: Option<Session>,
    fallback: Option<StaffIdentity>,
    cookie: Option<String>,
) -> Response {
    let view = SessionView {
        user: session.as_ref().map(|s| s.user.clone()).or(fallback),
        csrf_token: session.as_ref().map(|s| s.csrf.clone()),
        expires_at: session.as_ref().map(|s| s.expires_at),
        demo_mode: state.staff.demo_mode,
        demo_accounts: if state.staff.demo_mode {
            demos()
        } else {
            Vec::new()
        },
        password_login_enabled: !state.staff.accounts.is_empty(),
        owner_login_enabled: state.admin_password.as_ref().is_some_and(|s| !s.is_empty()),
    };
    let mut response = Json(view).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    if let Some(cookie) = cookie {
        response
            .headers_mut()
            .insert(header::SET_COOKIE, cookie.parse().unwrap());
    }
    response
}

pub async fn session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    session_response(
        &state,
        state.staff.session(&headers, now()),
        basic_owner(&state, &headers),
        None,
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginInput {
    username: String,
    password: String,
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    input: Result<Json<LoginInput>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !same_origin(&state.staff, &headers) || !json_intent(&headers) {
        return api_error(
            StatusCode::FORBIDDEN,
            "Sign in from the BMT Live staff page.",
        );
    }
    let Ok(Json(input)) = input else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Enter a username and password as JSON.",
        );
    };
    if input.username.len() > 128 || input.password.is_empty() || input.password.len() > 1024 {
        return api_error(
            StatusCode::UNAUTHORIZED,
            "Username or password not recognized.",
        );
    }
    if !state.staff.allow_login(now()) {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many sign-in attempts. Wait one minute and try again.",
        );
    }
    let username = input.username.trim().to_ascii_lowercase();
    let account = state
        .staff
        .accounts
        .iter()
        .find(|a| a.username == username)
        .cloned();
    let is_owner = username == "owner"
        && state
            .admin_password
            .as_ref()
            .filter(|p| !p.is_empty())
            .is_some_and(|p| equal_secret(&input.password, p));
    let hash = account
        .as_ref()
        .map(|a| a.password_hash.clone())
        .unwrap_or_else(|| state.staff.dummy_hash.clone());
    let Ok(permit) = state.staff.password_slots.clone().try_acquire_owned() else {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Sign-in is busy. Wait a moment and try again.",
        );
    };
    let valid = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(input.password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await
    .unwrap_or(false);
    let user = if is_owner {
        Some(owner())
    } else if valid {
        account.map(|a| a.identity())
    } else {
        None
    };
    let Some(user) = user else {
        return api_error(
            StatusCode::UNAUTHORIZED,
            "Username or password not recognized.",
        );
    };
    create_session(&state, &headers, user)
}

fn create_session(state: &AppState, headers: &HeaderMap, user: StaffIdentity) -> Response {
    // Rotate only once the replacement can be issued, so capacity errors preserve the old session.
    let Some((token, session)) = state.staff.issue(user, now()) else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Staff sessions are full. Try again later.",
        );
    };
    state.staff.revoke(headers);
    session_response(
        state,
        Some(session),
        None,
        Some(state.staff.cookie(&token, state.staff.ttl)),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoInput {
    account_id: String,
}

pub async fn demo_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    input: Result<Json<DemoInput>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !state.staff.demo_mode {
        return api_error(StatusCode::NOT_FOUND, "Demo sign-in is disabled.");
    }
    if !same_origin(&state.staff, &headers) || !json_intent(&headers) {
        return api_error(
            StatusCode::FORBIDDEN,
            "Choose a demo account from the staff page.",
        );
    }
    if !state.staff.allow_login(now()) {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many sign-in attempts. Wait one minute and try again.",
        );
    }
    let Ok(Json(input)) = input else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Choose one of the listed demo accounts.",
        );
    };
    let Some(user) = demos().into_iter().find(|u| u.id == input.account_id) else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Choose one of the listed demo accounts.",
        );
    };
    create_session(&state, &headers, user)
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !same_origin(&state.staff, &headers)
        || !json_intent(&headers)
        || (state.staff.session(&headers, now()).is_some() && !csrf_valid(&state.staff, &headers))
    {
        return api_error(
            StatusCode::FORBIDDEN,
            "Reload the staff page, then sign out again.",
        );
    }
    state.staff.revoke(&headers);
    session_response(&state, None, None, Some(state.staff.cookie("", 0)))
}

/// Public discovery/login routes. Only metadata and the current session are returned.
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/api/staff/session", get(session))
        .route("/api/staff/login", post(login))
        .route("/api/staff/logout", post(logout))
        .route("/api/staff/demo", post(demo_login))
        .layer(DefaultBodyLimit::max(4096))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> StaffStore {
        StaffStore::new(Vec::new(), false, true, None, 60).unwrap()
    }
    fn headers(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, format!("{COOKIE}={token}").parse().unwrap());
        h
    }

    #[test]
    fn session_expiry_revocation_and_cookie_attributes() {
        let store = store();
        let (token, session) = store.issue(owner(), 100).unwrap();
        assert_eq!(token.len(), 64);
        assert_ne!(token, session.csrf);
        assert!(!store.sessions.lock().unwrap().contains_key(&token));
        assert!(store.session(&headers(&token), 159).is_some());
        assert!(store.session(&headers(&token), 160).is_none());
        assert!(store.sessions.lock().unwrap().is_empty());
        let (token, _) = store.issue(owner(), 200).unwrap();
        store.revoke(&headers(&token));
        assert!(store.session(&headers(&token), 201).is_none());
        assert!(store
            .cookie("test", 60)
            .ends_with("HttpOnly; SameSite=Strict; Max-Age=60; Secure"));
        assert!(!store.cookie("test", 60).contains("Domain="));
    }

    #[test]
    fn role_boundaries_and_routes_are_explicit() {
        use Capability::*;
        assert_eq!(Role::Administrator.capabilities(), ALL);
        for role in [Role::Dispatcher, Role::CrisisManager, Role::InfoDesk] {
            for forbidden in [ContentWrite, RoomsWrite, PublishingWrite] {
                assert!(!role.capabilities().contains(&forbidden));
            }
            assert!(role.capabilities().contains(&AccessRead));
        }
        assert!(!Role::InfoDesk.capabilities().contains(&UpdatesWrite));
        assert!(!Role::Dispatcher.capabilities().contains(&FoundRead));
        assert!(!Role::CrisisManager.capabilities().contains(&ScheduleWrite));
        assert_eq!(
            capability_for_route(&Method::GET, "/api/content"),
            Some(ContentWrite)
        );
        assert_eq!(
            capability_for_route(&Method::GET, "/api/lost-found/staff"),
            Some(FoundRead)
        );
        assert_eq!(
            capability_for_route(&Method::PATCH, "/api/lost-found/staff/123"),
            Some(FoundWrite)
        );
        for public in [
            "/api/live",
            "/api/lost-found",
            "/api/site",
            "/api/wayfinding",
            "/api/unmapped",
            "/api/site/editorial",
        ] {
            assert_eq!(capability_for_route(&Method::GET, public), None);
        }
    }

    #[test]
    fn csrf_checks_origin_and_login_throttle_is_bounded() {
        let store = store();
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "live.example.test".parse().unwrap());
        h.insert(header::ORIGIN, "https://live.example.test".parse().unwrap());
        assert!(same_origin(&store, &h));
        h.insert(header::ORIGIN, "https://evil.example.test".parse().unwrap());
        assert!(!same_origin(&store, &h));
        h.insert(header::ORIGIN, "null".parse().unwrap());
        assert!(!same_origin(&store, &h));
        h.insert(header::ORIGIN, "http://live.example.test".parse().unwrap());
        assert!(!same_origin(&store, &h));
        h.remove(header::ORIGIN);
        h.insert("sec-fetch-site", "same-site".parse().unwrap());
        assert!(!same_origin(&store, &h));
        for _ in 0..30 {
            assert!(store.allow_login(100));
        }
        assert!(!store.allow_login(159));
        assert!(store.allow_login(160));
    }
}
