//! Private lost-and-found data. Never add these tables to a public export.
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::Path as FilePath,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

type ApiError = (StatusCode, &'static str);
type Result<T> = std::result::Result<T, ApiError>;
const BODY_LIMIT: usize = 12 * 1024;
const DB_ERROR: ApiError = (
    StatusCode::SERVICE_UNAVAILABLE,
    "The private inbox is unavailable. Please try again.",
);

/// Insert ONLY after trusted server-side session/capability checks. Without this
/// extension the staff router returns 401, even if accidentally mounted publicly.
#[derive(Clone)]
pub struct LostFoundAccess {
    pub actor: String,
    pub can_read: bool,
    pub can_write: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReportKind {
    Lost,
    Found,
}
impl ReportKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Lost => "lost",
            Self::Found => "found",
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReportStatus {
    New,
    Found,
    Contacted,
    Resolved,
}
impl ReportStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Found => "found",
            Self::Contacted => "contacted",
            Self::Resolved => "resolved",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitReport {
    idempotency_key: String,
    kind: ReportKind,
    description: String,
    location: String,
    occurred_at: String,
    #[serde(default)]
    name: String,
    email: String,
}
#[derive(Serialize, Deserialize)]
pub struct Receipt {
    pub receipt: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateReport {
    idempotency_key: String,
    revision: u32,
    status: ReportStatus,
    notes: String,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListQuery {
    kind: Option<ReportKind>,
    status: Option<ReportStatus>,
    #[serde(default)]
    q: String,
    limit: Option<u32>,
    #[serde(default)]
    offset: u32,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    at: String,
    actor: String,
    from_status: Option<String>,
    status: String,
    notes: String,
    revision: u32,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    id: String,
    receipt: String,
    kind: String,
    description: String,
    location: String,
    occurred_at: String,
    name: String,
    email: String,
    status: String,
    notes: String,
    created_at: String,
    updated_at: String,
    revision: u32,
    synthetic: bool,
    history: Vec<AuditEntry>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPage {
    reports: Vec<Report>,
    total: u32,
    limit: u32,
    offset: u32,
    demo_mode: bool,
}

struct Bucket {
    started: Instant,
    count: u32,
}
#[derive(Default)]
struct Limiter {
    buckets: HashMap<String, Bucket>,
}
impl Limiter {
    fn take(&mut self, key: String, max: u32, window: Duration) -> bool {
        let now = Instant::now();
        // Bounded memory even when many spoofed contacts or IPv6 addresses arrive.
        self.buckets
            .retain(|_, bucket| now.duration_since(bucket.started) < Duration::from_secs(1800));
        if !self.buckets.contains_key(&key) && self.buckets.len() >= 4096 {
            return false;
        }
        let bucket = self.buckets.entry(key).or_insert(Bucket {
            started: now,
            count: 0,
        });
        if now.duration_since(bucket.started) >= window {
            bucket.started = now;
            bucket.count = 0;
        }
        if bucket.count >= max {
            return false;
        }
        bucket.count += 1;
        true
    }
}

pub struct LostFoundStore {
    db: Mutex<Connection>,
    limiter: Mutex<Limiter>,
    salt: String,
    demo_mode: bool,
}
impl LostFoundStore {
    /// `path` MUST be outside STATIC_DIR and the public Git/content directory.
    /// Caller opts in only when DEMO_MODE is exactly "true". Seeding is atomic,
    /// once per database, additive, and never updates an existing report.
    pub fn open(path: impl AsRef<FilePath>, demo_mode: bool) -> std::result::Result<Self, String> {
        let path = path.as_ref();
        #[cfg(unix)]
        if path != FilePath::new(":memory:") {
            use std::os::unix::fs::OpenOptionsExt;
            use std::os::unix::fs::PermissionsExt;
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .mode(0o600)
                .open(path)
                .map_err(|_| {
                    "Cannot open PRIVATE_DB_PATH; its parent directory must exist.".to_string()
                })?;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "Cannot restrict private database permissions.".to_string())?;
        }
        let db = Connection::open(path).map_err(|_| "Cannot open private database.".to_string())?;
        db.busy_timeout(Duration::from_secs(3))
            .map_err(|_| "Cannot configure private database.".to_string())?;
        db.execute_batch("PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS lf_reports (
                id TEXT PRIMARY KEY, receipt TEXT UNIQUE NOT NULL,
                submission_key TEXT UNIQUE NOT NULL, submission_hash TEXT NOT NULL,
                kind TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL,
                occurred_at TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1, synthetic INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS lf_status_created ON lf_reports(status, created_at);
            CREATE TABLE IF NOT EXISTS lf_history (
                change_id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES lf_reports(id),
                request_hash TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
                from_status TEXT, status TEXT NOT NULL, notes TEXT NOT NULL, revision INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS lf_history_report ON lf_history(report_id, revision);
            CREATE TABLE IF NOT EXISTS lf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .map_err(|_| "Cannot initialize private database.".to_string())?;
        let store = Self {
            db: Mutex::new(db),
            limiter: Mutex::new(Limiter::default()),
            salt: Uuid::new_v4().to_string(),
            demo_mode,
        };
        if demo_mode {
            store
                .seed_demo()
                .map_err(|_| "Cannot initialize synthetic reports.".to_string())?;
        }
        Ok(store)
    }

    fn seed_demo(&self) -> Result<()> {
        let mut db = self.db.lock().map_err(|_| DB_ERROR)?;
        let tx = db.transaction().map_err(|_| DB_ERROR)?;
        let seeded: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lf_meta WHERE key='demo_v1')",
                [],
                |r| r.get(0),
            )
            .map_err(|_| DB_ERROR)?;
        if !seeded {
            for (kind, item, location, email) in [
                (
                    ReportKind::Lost,
                    "SYNTHETIC DEMO — blue water bottle with a star sticker",
                    "Demo check-in desk",
                    "demo-student@example.invalid",
                ),
                (
                    ReportKind::Found,
                    "SYNTHETIC DEMO — gray pencil case",
                    "Demo room entrance",
                    "demo-volunteer@example.invalid",
                ),
            ] {
                let input = SubmitReport {
                    idempotency_key: Uuid::new_v4().to_string(),
                    kind,
                    description: item.into(),
                    location: location.into(),
                    occurred_at: "November 14, 2026, around 9:00 am Pacific (demo)".into(),
                    name: "Synthetic demo person".into(),
                    email: email.into(),
                };
                insert_report(&tx, &input, true)?;
            }
            tx.execute(
                "INSERT INTO lf_meta (key,value) VALUES ('demo_v1','seeded')",
                [],
            )
            .map_err(|_| DB_ERROR)?;
        }
        tx.commit().map_err(|_| DB_ERROR)
    }

    fn submit(&self, mut input: SubmitReport) -> Result<Receipt> {
        input.validate()?;
        let db = self.db.lock().map_err(|_| DB_ERROR)?;
        let existing: Option<(String, String)> = db
            .query_row(
                "SELECT receipt,submission_hash FROM lf_reports WHERE submission_key=?1",
                [&input.idempotency_key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| DB_ERROR)?;
        if let Some((receipt, hash)) = existing {
            return if hash == fingerprint(&input)? {
                Ok(Receipt { receipt })
            } else {
                Err((StatusCode::CONFLICT, "This submission key belongs to a different report. Do not reuse it for another item."))
            };
        }
        let contact_key = format!(
            "email:{:x}",
            Sha256::digest(format!("{}:{}", self.salt, input.email.to_lowercase()))
        );
        if !self.limiter.lock().map_err(|_| DB_ERROR)?.take(
            contact_key,
            5,
            Duration::from_secs(1800),
        ) {
            return Err((StatusCode::TOO_MANY_REQUESTS, "Too many reports for this contact. Please wait 30 minutes or ask at the help desk."));
        }
        insert_report(&db, &input, false)
    }

    fn list(&self, query: ListQuery) -> Result<ReportPage> {
        let limit = query.limit.unwrap_or(20);
        if !(1..=50).contains(&limit) || query.offset > 10_000 || query.q.chars().count() > 100 {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Use a page size of 1–50, offset at most 10000, and search at most 100 characters.",
            ));
        }
        let db = self.db.lock().map_err(|_| DB_ERROR)?;
        let status = query.status.map(|s| s.as_str());
        let kind = query.kind.map(|s| s.as_str());
        let search = format!(
            "%{}%",
            query
                .q
                .trim()
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let filter = " WHERE (?1 IS NULL OR status=?1) AND (?2 IS NULL OR kind=?2) AND (?3='%%' OR (description || ' ' || location || ' ' || name || ' ' || email || ' ' || receipt) LIKE ?3 ESCAPE '\\')";
        let total = db
            .query_row(
                &format!("SELECT COUNT(*) FROM lf_reports{filter}"),
                params![status, kind, search],
                |r| r.get(0),
            )
            .map_err(|_| DB_ERROR)?;
        let mut statement = db.prepare(&format!("SELECT id FROM lf_reports{filter} ORDER BY created_at DESC,id DESC LIMIT ?4 OFFSET ?5")).map_err(|_| DB_ERROR)?;
        let ids = statement
            .query_map(params![status, kind, search, limit, query.offset], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|_| DB_ERROR)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| DB_ERROR)?;
        let reports = ids
            .iter()
            .map(|id| read_report(&db, id))
            .collect::<Result<Vec<_>>>()?;
        Ok(ReportPage {
            reports,
            total,
            limit,
            offset: query.offset,
            demo_mode: self.demo_mode,
        })
    }

    fn update(&self, id: String, mut input: UpdateReport, actor: String) -> Result<Report> {
        validate_uuid(&id)?;
        validate_uuid(&input.idempotency_key)?;
        input.notes = input.notes.trim().to_string();
        validate_text(
            &input.notes,
            0,
            4000,
            "Private notes must be at most 4000 characters.",
        )?;
        let hash = fingerprint(&input)?;
        let mut db = self.db.lock().map_err(|_| DB_ERROR)?;
        let tx = db.transaction().map_err(|_| DB_ERROR)?;
        let replay: Option<(String, String, String)> = tx
            .query_row(
                "SELECT report_id,request_hash,actor FROM lf_history WHERE change_id=?1",
                [&input.idempotency_key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| DB_ERROR)?;
        if let Some((report_id, previous_hash, previous_actor)) = replay {
            if report_id == id && previous_hash == hash && previous_actor == actor {
                return read_report(&tx, &id);
            }
            return Err((
                StatusCode::CONFLICT,
                "This update key was already used. Refresh the inbox before trying again.",
            ));
        }
        let previous = read_report(&tx, &id)?;
        if previous.revision != input.revision {
            return Err((
                StatusCode::CONFLICT,
                "Another staff member changed this report. Refresh the inbox before saving again.",
            ));
        }
        let now = Utc::now().to_rfc3339();
        tx.execute("UPDATE lf_reports SET status=?1,notes=?2,updated_at=?3,revision=revision+1 WHERE id=?4", params![input.status.as_str(), input.notes, now, id]).map_err(|_| DB_ERROR)?;
        tx.execute("INSERT INTO lf_history (change_id,report_id,request_hash,at,actor,from_status,status,notes,revision) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![input.idempotency_key, id, hash, now, actor, previous.status, input.status.as_str(), input.notes, previous.revision + 1]).map_err(|_| DB_ERROR)?;
        let report = read_report(&tx, &id)?;
        tx.commit().map_err(|_| DB_ERROR)?;
        Ok(report)
    }
}

impl SubmitReport {
    fn validate(&mut self) -> Result<()> {
        validate_uuid(&self.idempotency_key)?;
        self.description = self.description.trim().to_string();
        self.location = self.location.trim().to_string();
        self.occurred_at = self.occurred_at.trim().to_string();
        self.name = self.name.trim().to_string();
        self.email = self.email.trim().to_string();
        validate_text(
            &self.description,
            5,
            2000,
            "Describe the item in 5–2000 characters.",
        )?;
        validate_text(
            &self.location,
            2,
            200,
            "Enter a location in 2–200 characters; say 'Unknown' if unsure.",
        )?;
        validate_text(
            &self.occurred_at,
            2,
            120,
            "Enter a time or approximate time in 2–120 characters.",
        )?;
        validate_text(
            &self.name,
            0,
            100,
            "Your name must be at most 100 characters.",
        )?;
        if !valid_email(&self.email) {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Enter a contact email address so staff can reach you.",
            ));
        }
        Ok(())
    }
}
fn validate_uuid(value: &str) -> Result<()> {
    if Uuid::parse_str(value).is_ok_and(|id| id.get_version_num() == 4) && value.len() == 36 {
        Ok(())
    } else {
        Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "A random UUID submission or update key is required.",
        ))
    }
}
fn validate_text(value: &str, min: usize, max: usize, message: &'static str) -> Result<()> {
    let len = value.chars().count();
    if len < min
        || len > max
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        Err((StatusCode::UNPROCESSABLE_ENTITY, message))
    } else {
        Ok(())
    }
}
fn valid_email(email: &str) -> bool {
    if email.len() > 254 || !email.is_ascii() {
        return false;
    }
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && local.len() <= 64
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&c))
        && domain.contains('.')
        && domain.split('.').all(|part| {
            !part.is_empty()
                && part.len() <= 63
                && !part.starts_with('-')
                && !part.ends_with('-')
                && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
}
fn fingerprint(value: &impl Serialize) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|_| DB_ERROR)?)
    ))
}
fn insert_report(db: &Connection, input: &SubmitReport, synthetic: bool) -> Result<Receipt> {
    let id = Uuid::new_v4().to_string();
    let receipt = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    db.execute("INSERT INTO lf_reports (id,receipt,submission_key,submission_hash,kind,description,location,occurred_at,name,email,created_at,updated_at,synthetic) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12)", params![id, receipt, input.idempotency_key, fingerprint(input)?, input.kind.as_str(), input.description, input.location, input.occurred_at, input.name, input.email, now, synthetic]).map_err(|_| DB_ERROR)?;
    Ok(Receipt { receipt })
}
fn read_report(db: &Connection, id: &str) -> Result<Report> {
    let mut report = db.query_row("SELECT id,receipt,kind,description,location,occurred_at,name,email,status,notes,created_at,updated_at,revision,synthetic FROM lf_reports WHERE id=?1", [id], |r| Ok(Report { id: r.get(0)?, receipt: r.get(1)?, kind: r.get(2)?, description: r.get(3)?, location: r.get(4)?, occurred_at: r.get(5)?, name: r.get(6)?, email: r.get(7)?, status: r.get(8)?, notes: r.get(9)?, created_at: r.get(10)?, updated_at: r.get(11)?, revision: r.get(12)?, synthetic: r.get(13)?, history: vec![] }))
        .optional().map_err(|_| DB_ERROR)?.ok_or((StatusCode::NOT_FOUND, "Report not found. Refresh the inbox."))?;
    let mut statement = db.prepare("SELECT at,actor,from_status,status,notes,revision FROM lf_history WHERE report_id=?1 ORDER BY revision DESC LIMIT 20").map_err(|_| DB_ERROR)?;
    report.history = statement
        .query_map([id], |r| {
            Ok(AuditEntry {
                at: r.get(0)?,
                actor: r.get(1)?,
                from_status: r.get(2)?,
                status: r.get(3)?,
                notes: r.get(4)?,
                revision: r.get(5)?,
            })
        })
        .map_err(|_| DB_ERROR)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| DB_ERROR)?;
    Ok(report)
}

/// Both routers are state-independent after construction; merge into Router<AppState>.
pub fn public_router<S: Clone + Send + Sync + 'static>(store: Arc<LostFoundStore>) -> Router<S> {
    Router::new()
        .route("/api/lost-found", post(submit_report))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .route_layer(middleware::from_fn_with_state(store.clone(), limit_public))
        .layer(middleware::map_response(private_response))
        .with_state(store)
}
pub fn admin_router<S: Clone + Send + Sync + 'static>(store: Arc<LostFoundStore>) -> Router<S> {
    Router::new()
        .route("/api/lost-found/staff", get(list_reports))
        .route(
            "/api/lost-found/staff/{id}",
            axum::routing::patch(update_report),
        )
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(middleware::map_response(private_response))
        .with_state(store)
}
async fn private_response(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store, private".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, "1800".parse().unwrap());
    }
    response
}
async fn limit_public(
    State(store): State<Arc<LostFoundStore>>,
    request: Request,
    next: Next,
) -> Response {
    // Deliberately ignore Forwarded and X-Forwarded-For. See docs/lost-found.md.
    let ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip().to_string())
        .unwrap_or_else(|| "unknown-peer".into());
    let allowed = store
        .limiter
        .lock()
        .map(|mut limiter| {
            limiter.take("global".into(), 1000, Duration::from_secs(600))
                && limiter.take(format!("ip:{ip}"), 60, Duration::from_secs(600))
        })
        .unwrap_or(false);
    if !allowed {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests. Please wait or ask at the help desk.",
        )
            .into_response();
    }
    next.run(request).await
}
async fn submit_report(
    State(store): State<Arc<LostFoundStore>>,
    Json(input): Json<SubmitReport>,
) -> Result<(StatusCode, Json<Receipt>)> {
    tokio::task::spawn_blocking(move || store.submit(input))
        .await
        .map_err(|_| DB_ERROR)?
        .map(|receipt| (StatusCode::CREATED, Json(receipt)))
}
fn authorize(access: Option<Extension<LostFoundAccess>>, write: bool) -> Result<LostFoundAccess> {
    let Extension(access) =
        access.ok_or((StatusCode::UNAUTHORIZED, "Sign in to the staff workspace."))?;
    if access.actor.trim().is_empty()
        || access.actor.len() > 200
        || !(if write {
            access.can_write
        } else {
            access.can_read
        })
    {
        return Err((
            StatusCode::FORBIDDEN,
            "Your account does not have permission for this action.",
        ));
    }
    Ok(access)
}
async fn list_reports(
    State(store): State<Arc<LostFoundStore>>,
    access: Option<Extension<LostFoundAccess>>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ReportPage>> {
    authorize(access, false)?;
    tokio::task::spawn_blocking(move || store.list(query))
        .await
        .map_err(|_| DB_ERROR)?
        .map(Json)
}
async fn update_report(
    State(store): State<Arc<LostFoundStore>>,
    access: Option<Extension<LostFoundAccess>>,
    Path(id): Path<String>,
    Json(input): Json<UpdateReport>,
) -> Result<Json<Report>> {
    let access = authorize(access, true)?;
    tokio::task::spawn_blocking(move || store.update(id, input, access.actor))
        .await
        .map_err(|_| DB_ERROR)?
        .map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> SubmitReport {
        SubmitReport {
            idempotency_key: Uuid::new_v4().to_string(),
            kind: ReportKind::Lost,
            description: "Synthetic blue bottle".into(),
            location: "Demo desk".into(),
            occurred_at: "Nov 14, 9 am Pacific".into(),
            name: String::new(),
            email: "fixture@example.invalid".into(),
        }
    }
    fn store() -> LostFoundStore {
        LostFoundStore::open(":memory:", false).unwrap()
    }
    #[test]
    fn validates_contact_fields_and_enum() {
        for email in [
            "",
            "hello",
            "x@y",
            "x@@example.org",
            "x@y..org",
            "x@example.org\r\nBcc:other@example.org",
            "a b@example.org",
            ".a@example.org",
        ] {
            let mut report = input();
            report.email = email.into();
            assert!(report.validate().is_err(), "invalid email accepted");
        }
        assert!(valid_email("a+b@example.invalid"));
        let mut report = input();
        report.description = "x".into();
        assert!(report.validate().is_err());
        report = input();
        report.location = "x".repeat(201);
        assert!(report.validate().is_err());
        report = input();
        report.email.clear();
        assert!(report.validate().is_err());
        let mut json = serde_json::to_value(input()).unwrap();
        json.as_object_mut().unwrap().remove("name");
        assert!(serde_json::from_value::<SubmitReport>(json.clone())
            .unwrap()
            .name
            .is_empty());
        json["kind"] = "other".into();
        assert!(serde_json::from_value::<SubmitReport>(json).is_err());
    }
    #[test]
    fn receipt_is_opaque_and_submission_is_idempotent() {
        let store = store();
        let report = input();
        let first = store.submit(report.clone()).unwrap();
        let replay = store.submit(report.clone()).unwrap();
        assert_eq!(first.receipt, replay.receipt);
        assert_eq!(
            serde_json::to_value(first)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(store.list(ListQuery::default()).unwrap().total, 1);
        let mut changed = report;
        changed.location = "Different desk".into();
        assert_eq!(store.submit(changed).err().unwrap().0, StatusCode::CONFLICT);
    }
    #[test]
    fn optimistic_updates_audit_and_replay() {
        let store = store();
        store.submit(input()).unwrap();
        let initial = store.list(ListQuery::default()).unwrap().reports.remove(0);
        let body = serde_json::json!({"idempotencyKey":Uuid::new_v4().to_string(),"revision":1,"status":"contacted","notes":"Staff manually sent an email."});
        let updated = store
            .update(
                initial.id.clone(),
                serde_json::from_value(body.clone()).unwrap(),
                "test-staff".into(),
            )
            .unwrap();
        assert_eq!(updated.revision, 2);
        assert_eq!(updated.history.len(), 1);
        assert_eq!(updated.history[0].from_status.as_deref(), Some("new"));
        assert_eq!(
            store
                .update(
                    initial.id.clone(),
                    serde_json::from_value(body).unwrap(),
                    "test-staff".into()
                )
                .unwrap()
                .revision,
            2
        );
        assert_eq!(
            store
                .update(
                    initial.id,
                    UpdateReport {
                        idempotency_key: Uuid::new_v4().to_string(),
                        revision: 1,
                        status: ReportStatus::Resolved,
                        notes: "stale".into()
                    },
                    "test-staff".into()
                )
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
    }
    #[test]
    fn list_is_bounded_and_search_escapes_wildcards() {
        let store = store();
        store.submit(input()).unwrap();
        assert_eq!(
            store
                .list(ListQuery {
                    q: "bottle".into(),
                    ..Default::default()
                })
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            store
                .list(ListQuery {
                    q: "%".into(),
                    ..Default::default()
                })
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            store
                .list(ListQuery {
                    status: Some(ReportStatus::Resolved),
                    ..Default::default()
                })
                .unwrap()
                .total,
            0
        );
        assert!(store
            .list(ListQuery {
                limit: Some(51),
                ..Default::default()
            })
            .is_err());
    }
    #[test]
    fn fails_closed_and_checks_read_write_separately() {
        assert_eq!(
            authorize(None, false).err().unwrap().0,
            StatusCode::UNAUTHORIZED
        );
        let access = LostFoundAccess {
            actor: "reader".into(),
            can_read: true,
            can_write: false,
        };
        assert!(authorize(Some(Extension(access.clone())), false).is_ok());
        assert_eq!(
            authorize(Some(Extension(access)), true).err().unwrap().0,
            StatusCode::FORBIDDEN
        );
    }
    #[test]
    fn limiter_and_contact_limits_do_not_duplicate_retries() {
        let mut limiter = Limiter::default();
        assert!(limiter.take("ip".into(), 1, Duration::from_secs(600)));
        assert!(!limiter.take("ip".into(), 1, Duration::from_secs(600)));
        let store = store();
        let first = input();
        store.submit(first.clone()).unwrap();
        for _ in 0..4 {
            store.submit(input()).unwrap();
        }
        assert_eq!(
            store.submit(input()).err().unwrap().0,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert!(store.submit(first).is_ok());
    }
    #[test]
    fn demo_seeding_is_explicit_additive_and_once() {
        assert_eq!(store().list(ListQuery::default()).unwrap().total, 0);
        let demo = LostFoundStore::open(":memory:", true).unwrap();
        demo.seed_demo().unwrap();
        demo.submit(input()).unwrap();
        demo.seed_demo().unwrap();
        let page = demo.list(ListQuery::default()).unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.reports.iter().filter(|r| r.synthetic).count(), 2);
        assert!(page
            .reports
            .iter()
            .filter(|r| r.synthetic)
            .all(|r| r.email.ends_with("@example.invalid")));
    }
}
