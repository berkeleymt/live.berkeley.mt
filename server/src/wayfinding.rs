//! Public directions and private, code-protected room assignments. No Lemon calls.
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[path = "route_graph.rs"]
pub mod graph;
const CONTENT_LIMIT: usize = 512_000;
const LOOKUP_ERROR: &str = "We could not verify those details. Check your student ID and private check-in code, or ask the BMT help desk.";
const WINDOW: Duration = Duration::from_secs(600);

type Result<T> = std::result::Result<T, WayfindingError>;
#[derive(Debug)]
pub struct WayfindingError(pub StatusCode, pub String);
impl IntoResponse for WayfindingError {
    fn into_response(self) -> Response {
        let mut response = (self.0, Json(serde_json::json!({"message": self.1}))).into_response();
        if self.0 == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, "600".parse().unwrap());
        }
        response
    }
}
fn invalid(message: &str) -> WayfindingError {
    WayfindingError(StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn unavailable(message: &str) -> WayfindingError {
    WayfindingError(StatusCode::SERVICE_UNAVAILABLE, message.into())
}
fn conflict() -> WayfindingError {
    WayfindingError(StatusCode::CONFLICT, "Directions changed since you opened the editor. Keep your draft, load the latest version and reconcile before saving.".into())
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.contains('\0')
}
fn id(value: &str) -> bool {
    text(value, 64)
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn coordinates(value: &[f64; 2]) -> bool {
    value[0].is_finite()
        && value[1].is_finite()
        && (-90.0..=90.0).contains(&value[0])
        && (-180.0..=180.0).contains(&value[1])
}
fn steps(value: &[String]) -> bool {
    !value.is_empty() && value.len() <= 12 && value.iter().all(|s| text(s, 500))
}
fn https(value: &str) -> bool {
    value.len() <= 1000
        && reqwest::Url::parse(value).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
        })
}
fn safe_image(value: &str) -> bool {
    if https(value) {
        return true;
    }
    (value.starts_with("/demo-maps/") || value.starts_with("/media/"))
        && value.len() <= 500
        && !value.contains("..")
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/-_.".contains(&c))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WayfindingContent {
    pub title: String,
    pub intro: String,
    pub notice: String,
    pub help_text: String,
    pub travel_url: String,
    pub buildings: Vec<Building>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph: Option<graph::Graph>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verification {
    Demo,
    Unverified,
    Mapped,
    Verified,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Building {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub coordinates: [f64; 2],
    pub status: Verification,
    pub verification_note: String,
    pub entrances: Vec<Entrance>,
    pub floors: Vec<Floor>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entrance {
    pub id: String,
    pub name: String,
    pub coordinates: [f64; 2],
    pub accessible: bool,
    pub notes: String,
    pub steps: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Floor {
    pub id: String,
    pub name: String,
    pub image: Option<FloorImage>,
    pub rooms: Vec<Room>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FloorImage {
    pub url: String,
    pub alt: String,
    pub caption: String,
    pub demonstration: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Room {
    pub id: String,
    pub code: String,
    pub name: String,
    pub route: RoomRoute,
    pub accessible_route: Option<RoomRoute>,
    pub hotspot: Option<Hotspot>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoomRoute {
    pub entrance_id: String,
    pub steps: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hotspot {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WayfindingDocument {
    pub revision: String,
    pub content: WayfindingContent,
}

impl WayfindingContent {
    pub fn validate(&self) -> Result<()> {
        if !text(&self.title, 120)
            || !text(&self.intro, 1000)
            || self.notice.len() > 1500
            || !text(&self.help_text, 1000)
            || !https(&self.travel_url)
            || self.buildings.len() > 50
        {
            return Err(invalid("Provide a title, introduction, help text and HTTPS transit link; at most 50 buildings."));
        }
        let mut all_ids = HashSet::new();
        let mut room_count = 0;
        for b in &self.buildings {
            if !id(&b.id)
                || !all_ids.insert(b.id.as_str())
                || !text(&b.name, 120)
                || !coordinates(&b.coordinates)
                || !text(&b.verification_note, 1500)
                || b.aliases.len() > 12
                || b.aliases.iter().any(|v| !text(v, 100))
                || b.entrances.len() > 12
                || b.floors.len() > 20
            {
                return Err(invalid("Buildings need unique IDs, names, valid coordinates, a verification note and bounded lists."));
            }
            let mut entrance_ids = HashSet::new();
            for e in &b.entrances {
                if !id(&e.id)
                    || !entrance_ids.insert(e.id.as_str())
                    || !text(&e.name, 120)
                    || !coordinates(&e.coordinates)
                    || !text(&e.notes, 1000)
                    || !steps(&e.steps)
                {
                    return Err(invalid("Entrances need unique IDs, names, coordinates, notes and 1–12 short direction steps."));
                }
            }
            for f in &b.floors {
                if !id(&f.id)
                    || !all_ids.insert(f.id.as_str())
                    || !text(&f.name, 120)
                    || f.rooms.len() > 100
                {
                    return Err(invalid(
                        "Floors need unique IDs, names and at most 100 rooms.",
                    ));
                }
                if let Some(image) = &f.image {
                    if !safe_image(&image.url)
                        || !text(&image.alt, 500)
                        || !text(&image.caption, 500)
                        || (image.url.starts_with("/demo-maps/") && !image.demonstration)
                    {
                        return Err(invalid("Images need a safe HTTPS or /media/ or /demo-maps/ URL, alt text and caption. Demo maps must be marked demonstration."));
                    }
                }
                for r in &f.rooms {
                    room_count += 1;
                    if room_count > 1000
                        || !id(&r.id)
                        || !all_ids.insert(r.id.as_str())
                        || !text(&r.code, 40)
                        || !text(&r.name, 120)
                        || !steps(&r.route.steps)
                        || !entrance_ids.contains(r.route.entrance_id.as_str())
                    {
                        return Err(invalid("Rooms need globally unique IDs, codes, names and a route from an existing entrance; at most 1,000 rooms."));
                    }
                    if let Some(route) = &r.accessible_route {
                        if !steps(&route.steps)
                            || !b
                                .entrances
                                .iter()
                                .any(|e| e.id == route.entrance_id && e.accessible)
                        {
                            return Err(invalid("An accessible route must start at an entrance marked accessible and have 1–12 steps."));
                        }
                    }
                    if r.hotspot.as_ref().is_some_and(|p| {
                        f.image.is_none()
                            || !p.x.is_finite()
                            || !p.y.is_finite()
                            || !(0.0..=100.0).contains(&p.x)
                            || !(0.0..=100.0).contains(&p.y)
                    }) {
                        return Err(invalid("Room markers need a floor image and x/y percentages between 0 and 100."));
                    }
                }
            }
        }
        if let Some(graph) = &self.graph {
            graph.validate(self)?;
        }
        Ok(())
    }
    fn has_room(&self, room_id: &str) -> bool {
        self.buildings
            .iter()
            .flat_map(|b| &b.floors)
            .flat_map(|f| &f.rooms)
            .any(|r| r.id == room_id)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assignment {
    pub round: String,
    pub room_id: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoCredential {
    pub student_id: String,
    pub check_in_code: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupInfo {
    pub mode: &'static str,
    pub source_label: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub demo_credentials: Vec<DemoCredential>,
}
/// Boundary for a future reviewed ContestDojo importer; never return upstream student records.
/// Providers are preloaded, bounded and local. Do not make network requests from authenticate.
pub trait AssignmentProvider: Send + Sync {
    fn info(&self) -> LookupInfo;
    fn authenticate(&self, student_id: &str, code: &str) -> Option<Vec<Assignment>>;
}
struct DisabledProvider;
impl AssignmentProvider for DisabledProvider {
    fn info(&self) -> LookupInfo {
        LookupInfo {
            mode: "unavailable",
            source_label: "Student lookup is not configured. Ask the BMT help desk.",
            demo_credentials: vec![],
        }
    }
    fn authenticate(&self, _: &str, _: &str) -> Option<Vec<Assignment>> {
        None
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateRoster {
    version: u8,
    source: String,
    generated_at: String,
    students: Vec<PrivateStudent>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateStudent {
    student_id: String,
    code_salt: String,
    code_hash: String,
    assignments: Vec<Assignment>,
}
pub struct PrivateImportProvider {
    students: HashMap<String, PrivateStudent>,
    contestdojo: bool,
}
fn code_hash(salt: &str, student_id: &str, code: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{salt}:{student_id}:{code}").as_bytes())
    )
}
fn equal_hash(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0_u8, |difference, (x, y)| difference | (x ^ y))
            == 0
}
fn read_bounded(path: &Path, max: usize) -> std::result::Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "Cannot read the configured file.".to_owned())?;
    let mut bytes = Vec::new();
    file.take((max + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read the configured file.".to_owned())?;
    if bytes.len() > max {
        return Err("The configured file exceeds its size limit.".into());
    }
    Ok(bytes)
}
impl PrivateImportProvider {
    pub fn open(path: PathBuf) -> std::result::Result<Self, String> {
        if !path.is_absolute() {
            return Err(
                "PRIVATE_ROSTER_PATH must be absolute and outside Git and public assets.".into(),
            );
        }
        let path = fs::canonicalize(path).map_err(|_| "Cannot open PRIVATE_ROSTER_PATH.")?;
        if !fs::metadata(&path)
            .map_err(|_| "Cannot inspect PRIVATE_ROSTER_PATH.")?
            .is_file()
        {
            return Err("PRIVATE_ROSTER_PATH must be a regular file.".into());
        }
        if path.ancestors().any(|p| {
            p.join(".git").exists()
                || p.join("package.json").exists()
                || p.join("Cargo.toml").exists()
        }) {
            return Err(
                "The private roster must be outside application/content repositories.".into(),
            );
        }
        for public_root in [
            std::env::var("STATIC_DIR").unwrap_or_else(|_| "dist".into()),
            std::env::var("LIVE_CONTENT_REPO").unwrap_or_default(),
        ] {
            if !public_root.is_empty()
                && fs::canonicalize(public_root).is_ok_and(|root| path.starts_with(root))
            {
                return Err("The private roster must not be inside a published directory.".into());
            }
        }
        let roster: PrivateRoster = serde_json::from_slice(&read_bounded(&path, 5_000_000)?)
            .map_err(|_| "Private roster JSON is invalid; no private field details are logged.")?;
        if roster.version != 1
            || !["private_import", "contestdojo_export"].contains(&roster.source.as_str())
            || chrono::DateTime::parse_from_rfc3339(&roster.generated_at).is_err()
            || roster.students.len() > 20_000
        {
            return Err("Private roster needs version 1, an import source, generatedAt timestamp and at most 20,000 students.".into());
        }
        let mut students = HashMap::new();
        for record in roster.students {
            if !id(&record.student_id)
                || record.student_id != record.student_id.to_ascii_uppercase()
                || record.code_salt.len() != 32
                || !record.code_salt.bytes().all(|c| c.is_ascii_hexdigit())
                || record.code_hash.len() != 64
                || !record
                    .code_hash
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                || record.assignments.is_empty()
                || record.assignments.len() > 12
                || record
                    .assignments
                    .iter()
                    .any(|a| !id(&a.room_id) || !text(&a.round, 120))
            {
                return Err("Private roster has an invalid record. Use uppercase IDs, random 16-byte salts, lowercase SHA-256 hashes and 1–12 room assignments.".into());
            }
            if students.insert(record.student_id.clone(), record).is_some() {
                return Err("Private roster has duplicate student IDs.".into());
            }
        }
        Ok(Self {
            students,
            contestdojo: roster.source == "contestdojo_export",
        })
    }
}
impl AssignmentProvider for PrivateImportProvider {
    fn info(&self) -> LookupInfo {
        LookupInfo {
            mode: "private_import",
            source_label: if self.contestdojo {
                "Private ContestDojo export · imported snapshot, not a live connection"
            } else {
                "Private room-assignment import · not a live connection"
            },
            demo_credentials: vec![],
        }
    }
    fn authenticate(&self, student_id: &str, code: &str) -> Option<Vec<Assignment>> {
        let record = self.students.get(student_id);
        // Hash unknown IDs too; never expose whether the ID or the code was incorrect.
        let salt = record
            .map(|r| r.code_salt.as_str())
            .unwrap_or("00000000000000000000000000000000");
        let expected = record
            .map(|r| r.code_hash.as_str())
            .unwrap_or("0000000000000000000000000000000000000000000000000000000000000000");
        let matches = equal_hash(&code_hash(salt, student_id, code), expected);
        if matches && (12..=128).contains(&code.len()) {
            record.map(|r| r.assignments.clone())
        } else {
            None
        }
    }
}
struct DemoProvider;
impl AssignmentProvider for DemoProvider {
    fn info(&self) -> LookupInfo {
        LookupInfo {
            mode: "demo",
            source_label: "Synthetic demo · no ContestDojo connection or real student records",
            demo_credentials: vec![DemoCredential {
                student_id: "DEMO-1001".into(),
                check_in_code: "DEMO-CHECKIN-2026".into(),
            }],
        }
    }
    fn authenticate(&self, student_id: &str, code: &str) -> Option<Vec<Assignment>> {
        (student_id == "DEMO-1001"
            && equal_hash(
                &code_hash("demo", student_id, code),
                &code_hash("demo", student_id, "DEMO-CHECKIN-2026"),
            ))
        .then(|| {
            vec![
                Assignment {
                    round: "Demo individual round".into(),
                    room_id: "demo-a101".into(),
                },
                Assignment {
                    round: "Demo team round".into(),
                    room_id: "demo-a102".into(),
                },
            ]
        })
    }
}

struct Stored {
    document: WayfindingDocument,
    bytes: Vec<u8>,
}
#[derive(Default)]
struct FailureLimits {
    buckets: HashMap<String, (Instant, usize)>,
}
impl FailureLimits {
    fn prune(&mut self) {
        self.buckets
            .retain(|_, (start, _)| start.elapsed() < WINDOW);
    }
    fn limited(&self, key: &str, maximum: usize) -> bool {
        self.buckets
            .get(key)
            .is_some_and(|(_, count)| *count >= maximum)
    }
    fn fail(&mut self, key: String) {
        self.buckets
            .entry(key)
            .and_modify(|(_, count)| *count += 1)
            .or_insert((Instant::now(), 1));
    }
}
pub struct WayfindingStore {
    pub remote: std::sync::OnceLock<Arc<crate::remote_content::RemoteStore>>,
    path: PathBuf,
    stored: Mutex<Stored>,
    provider: Arc<dyn AssignmentProvider>,
    failures: Mutex<FailureLimits>,
    published: std::sync::atomic::AtomicBool,
}
struct FileLock(PathBuf);
impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
impl WayfindingStore {
    /// DEMO_MODE must equal the literal "true". No default credentials, no API calls.
    pub fn from_env(path: PathBuf) -> std::result::Result<Self, String> {
        let demo = std::env::var("DEMO_MODE").as_deref() == Ok("true");
        let private = std::env::var("PRIVATE_ROSTER_PATH")
            .ok()
            .filter(|v| !v.is_empty());
        if demo && private.is_some() {
            return Err("Choose either DEMO_MODE=true or PRIVATE_ROSTER_PATH, never both.".into());
        }
        let provider: Arc<dyn AssignmentProvider> = if demo {
            Arc::new(DemoProvider)
        } else if let Some(path) = private {
            Arc::new(PrivateImportProvider::open(path.into())?)
        } else {
            Arc::new(DisabledProvider)
        };
        Self::open(path, provider)
    }
    pub fn open(
        path: PathBuf,
        provider: Arc<dyn AssignmentProvider>,
    ) -> std::result::Result<Self, String> {
        let (content, bytes) = Self::read(&path)?;
        Ok(Self {
            remote: std::sync::OnceLock::new(),
            path,
            stored: Mutex::new(Stored {
                document: WayfindingDocument {
                    revision: revision(&bytes),
                    content,
                },
                bytes,
            }),
            provider,
            failures: Mutex::new(FailureLimits::default()),
            published: std::sync::atomic::AtomicBool::new(false),
        })
    }
    fn read(path: &Path) -> std::result::Result<(WayfindingContent, Vec<u8>), String> {
        let bytes = read_bounded(path, CONTENT_LIMIT)?;
        let content: WayfindingContent = serde_json::from_slice(&bytes)
            .map_err(|_| "Directions JSON is invalid or contains unknown fields.".to_owned())?;
        content.validate().map_err(|e| e.1)?;
        Ok((content, bytes))
    }
    pub fn snapshot(&self) -> WayfindingDocument {
        if let Some(remote) = self.remote.get() {
            let snapshot = remote.snapshot();
            return WayfindingDocument {
                revision: snapshot.revision,
                content: snapshot.content.editorial.unwrap().wayfinding,
            };
        }
        self.stored.lock().unwrap().document.clone()
    }
    pub fn publish(&self, content: WayfindingContent, revision: String) {
        self.published
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.stored.lock().unwrap().document = WayfindingDocument { content, revision };
    }

    pub fn reload(&self) -> std::result::Result<WayfindingDocument, String> {
        if self.remote.get().is_some() || self.published.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(self.snapshot());
        }
        let mut stored = self.stored.lock().unwrap();
        let (content, bytes) = Self::read(&self.path)?;
        if bytes != stored.bytes {
            stored.document = WayfindingDocument {
                revision: revision(&bytes),
                content,
            };
            stored.bytes = bytes;
        }
        Ok(stored.document.clone())
    }
    pub fn save(&self, input: WayfindingDocument) -> Result<WayfindingDocument> {
        if self.remote.get().is_some() || self.published.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(conflict());
        }
        input.content.validate()?;
        let bytes = serde_json::to_vec_pretty(&input.content)
            .map_err(|_| invalid("Cannot serialize directions."))?;
        if bytes.len() > CONTENT_LIMIT {
            return Err(invalid("Directions must be smaller than 512 KB."));
        }
        let mut stored = self.stored.lock().unwrap();
        let lock_path = self.path.with_extension("json.lock");
        let _lock_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| conflict())?;
        let _lock = FileLock(lock_path);
        let disk = read_bounded(&self.path, CONTENT_LIMIT)
            .map_err(|_| unavailable("Cannot read directions. Nothing was saved."))?;
        if input.revision != stored.document.revision || disk != stored.bytes {
            return Err(conflict());
        }
        let temporary = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let write = (|| -> std::io::Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            // Detect file editors that do not honor the cooperative .json.lock.
            if fs::read(&self.path)? != disk {
                return Err(std::io::Error::other("changed"));
            }
            fs::rename(&temporary, &self.path)
        })();
        if write.is_err() {
            let _ = fs::remove_file(temporary);
            return Err(unavailable(
                "Directions could not be saved. Your draft is unchanged; reload before retrying.",
            ));
        }
        stored.document = WayfindingDocument {
            revision: revision(&bytes),
            content: input.content,
        };
        stored.bytes = bytes;
        Ok(stored.document.clone())
    }
    fn lookup(&self, input: LookupRequest, peer: &str) -> Result<LookupResponse> {
        let student_id = input.student_id.trim().to_ascii_uppercase();
        let mut failures = self.failures.lock().unwrap();
        failures.prune();
        let student_key = format!("id:{:x}", Sha256::digest(student_id.as_bytes()));
        let peer_key = format!("ip:{peer}");
        if failures.limited(&student_key, 5)
            || failures.limited(&peer_key, 60)
            || failures.limited("global", 600)
            || failures.buckets.len() > 4096
        {
            return Err(WayfindingError(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts. Wait 10 minutes before trying again, or ask the BMT help desk."
                    .into(),
            ));
        }
        let assignments = if id(&student_id) && (1..=128).contains(&input.check_in_code.len()) {
            self.provider
                .authenticate(&student_id, input.check_in_code.trim())
        } else {
            None
        };
        match assignments {
            Some(assignments)
                if !assignments.is_empty()
                    && assignments.len() <= 12
                    && assignments
                        .iter()
                        .all(|a| self.snapshot().content.has_room(&a.room_id)) =>
            {
                Ok(LookupResponse {
                    source: self.provider.info(),
                    assignments,
                })
            }
            _ => {
                failures.fail(student_key);
                failures.fail(peer_key);
                failures.fail("global".into());
                Err(WayfindingError(StatusCode::FORBIDDEN, LOOKUP_ERROR.into()))
            }
        }
    }
}
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LookupRequest {
    pub student_id: String,
    pub check_in_code: String,
}
#[derive(Serialize)]
pub struct LookupResponse {
    pub source: LookupInfo,
    pub assignments: Vec<Assignment>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicDocument {
    #[serde(flatten)]
    document: WayfindingDocument,
    lookup: LookupInfo,
    content_warning: Option<&'static str>,
}
/// Insert ONLY after validating the current server-side staff session/role.
/// No HTTP header can grant this capability; the module fails closed without it.
#[derive(Clone)]
pub struct WayfindingAccess {
    pub can_read: bool,
    pub can_write: bool,
}
fn authorize(access: Option<Extension<WayfindingAccess>>, write: bool) -> Result<()> {
    let access = access
        .ok_or_else(|| {
            WayfindingError(
                StatusCode::UNAUTHORIZED,
                "Sign in to the staff workspace first.".into(),
            )
        })?
        .0;
    if !access.can_read || (write && !access.can_write) {
        return Err(WayfindingError(
            StatusCode::FORBIDDEN,
            "Your staff role cannot edit room directions.".into(),
        ));
    }
    Ok(())
}
pub(crate) fn same_origin(headers: &HeaderMap) -> Result<()> {
    let cross_site =
        headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("cross-site");
    let invalid_origin = headers.get(header::ORIGIN).is_some_and(|origin| {
        let host = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        origin
            .to_str()
            .ok()
            .and_then(|v| reqwest::Url::parse(v).ok())
            .is_none_or(|url| !["http", "https"].contains(&url.scheme()) || url.authority() != host)
    });
    if cross_site || invalid_origin {
        return Err(WayfindingError(
            StatusCode::FORBIDDEN,
            "Use the same-origin BMT page to submit this request.".into(),
        ));
    }
    Ok(())
}
async fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
}
async fn public_content(State(store): State<Arc<WayfindingStore>>) -> Json<PublicDocument> {
    let cloned = store.clone();
    let reloaded = tokio::task::spawn_blocking(move || cloned.reload()).await;
    let warning = (!matches!(reloaded, Ok(Ok(_)))).then_some(
        "A directions update is unavailable. Showing the last valid copy; confirm with staff.",
    );
    Json(PublicDocument {
        document: store.snapshot(),
        lookup: store.provider.info(),
        content_warning: warning,
    })
}
async fn editor_content(
    State(store): State<Arc<WayfindingStore>>,
    access: Option<Extension<WayfindingAccess>>,
) -> Result<Json<WayfindingDocument>> {
    authorize(access, false)?;
    tokio::task::spawn_blocking(move || store.reload()).await.map_err(|_| unavailable("Cannot load directions."))?.map(Json).map_err(|_| unavailable("The directions file is invalid. Fix it on disk; public visitors still see the last valid copy."))
}
async fn save_content(
    State(store): State<Arc<WayfindingStore>>,
    access: Option<Extension<WayfindingAccess>>,
    headers: HeaderMap,
    Json(input): Json<WayfindingDocument>,
) -> Result<Json<WayfindingDocument>> {
    authorize(access, true)?;
    same_origin(&headers)?;
    tokio::task::spawn_blocking(move || store.save(input))
        .await
        .map_err(|_| unavailable("Cannot save directions."))?
        .map(Json)
}
async fn lookup(
    State(store): State<Arc<WayfindingStore>>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(input): Json<LookupRequest>,
) -> Result<Json<LookupResponse>> {
    same_origin(&headers)?;
    let peer = peer
        .map(|Extension(ConnectInfo(addr))| addr.ip().to_string())
        .unwrap_or_else(|| "unknown".into());
    store.lookup(input, &peer).map(Json)
}
pub fn public_router(store: Arc<WayfindingStore>) -> Router {
    Router::new()
        .route("/api/wayfinding", get(public_content))
        .route(
            "/api/wayfinding/lookup",
            post(lookup).layer(DefaultBodyLimit::max(4096)),
        )
        .layer(middleware::map_response(no_store))
        .with_state(store)
}
pub fn admin_router(store: Arc<WayfindingStore>) -> Router {
    Router::new()
        .route(
            "/api/wayfinding/editor",
            get(editor_content).put(save_content),
        )
        .layer(DefaultBodyLimit::max(CONTENT_LIMIT + 1024))
        .layer(middleware::map_response(no_store))
        .with_state(store)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> WayfindingContent {
        serde_json::from_str(include_str!("../../content/wayfinding.json")).unwrap()
    }
    fn store() -> (WayfindingStore, PathBuf) {
        let path = std::env::temp_dir().join(format!("wayfinding-{}.json", Uuid::new_v4()));
        fs::write(&path, serde_json::to_vec(&fixture()).unwrap()).unwrap();
        (
            WayfindingStore::open(path.clone(), Arc::new(DemoProvider)).unwrap(),
            path,
        )
    }
    #[test]
    fn safe_urls_references_and_markers() {
        fixture().validate().unwrap();
        for value in [
            "javascript:alert(1)",
            "data:image/svg+xml,bad",
            "//evil.test/a.svg",
            "/demo-maps/../secret",
            "/demo-maps/%2e%2e/secret",
            "https://user:pass@host.test/a.svg",
        ] {
            assert!(!safe_image(value), "{value}");
        }
        let mut content = fixture();
        content.buildings[0].floors[0].rooms[0]
            .accessible_route
            .as_mut()
            .unwrap()
            .entrance_id = "demo-main".into();
        assert!(content.validate().is_err());
        let mut content = fixture();
        content.buildings[0].floors[0].rooms[0]
            .hotspot
            .as_mut()
            .unwrap()
            .x = 101.0;
        assert!(content.validate().is_err());
    }
    #[test]
    fn save_conflicts_and_invalid_disk_preserves_last_good() {
        let (store, path) = store();
        let old = store.snapshot();
        let mut draft = old.clone();
        draft.content.title = "Updated directions".into();
        let saved = store.save(draft).unwrap();
        assert_ne!(saved.revision, old.revision);
        assert_eq!(store.save(old).unwrap_err().0, StatusCode::CONFLICT);
        fs::write(&path, b"invalid").unwrap();
        assert!(store.reload().is_err());
        assert_eq!(store.snapshot().revision, saved.revision);
        assert_eq!(store.save(saved).unwrap_err().0, StatusCode::CONFLICT);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn demo_lookup_requires_both_fields_and_failures_are_bounded() {
        let (store, path) = store();
        let request = |code: &str| LookupRequest {
            student_id: "DEMO-1001".into(),
            check_in_code: code.into(),
        };
        let response = store.lookup(request("DEMO-CHECKIN-2026"), "local").unwrap();
        assert_eq!(response.assignments.len(), 2);
        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("name"));
        assert!(!json.contains("email"));
        for _ in 0..5 {
            assert_eq!(
                store.lookup(request("wrong"), "local").err().unwrap().0,
                StatusCode::FORBIDDEN
            );
        }
        assert_eq!(
            store
                .lookup(request("DEMO-CHECKIN-2026"), "local")
                .err()
                .unwrap()
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn public_schema_cannot_contain_a_roster() {
        let mut json = serde_json::to_value(fixture()).unwrap();
        json["students"] = serde_json::json!([]);
        assert!(serde_json::from_value::<WayfindingContent>(json).is_err());
        let mut json = serde_json::to_value(fixture()).unwrap();
        json["buildings"][0]["floors"][0]["rooms"][0]["studentId"] = serde_json::json!("secret");
        assert!(serde_json::from_value::<WayfindingContent>(json).is_err());
        assert_eq!(DisabledProvider.info().mode, "unavailable");
        assert!(DisabledProvider
            .authenticate("DEMO-1001", "DEMO-CHECKIN-2026")
            .is_none());
    }
    #[test]
    fn authorization_fails_closed() {
        assert_eq!(
            authorize(None, true).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            authorize(
                Some(Extension(WayfindingAccess {
                    can_read: true,
                    can_write: false
                })),
                true
            )
            .unwrap_err()
            .0,
            StatusCode::FORBIDDEN
        );
        assert!(authorize(
            Some(Extension(WayfindingAccess {
                can_read: true,
                can_write: true
            })),
            true
        )
        .is_ok());
    }
}
