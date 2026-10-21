//! Private, local roster snapshots. Only three fixed-origin, read-only provider requests.
use crate::{models::ScheduleEvent, routes::AppState, wayfinding::WayfindingContent};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Query, State},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

type Row = BTreeMap<String, String>;
type Failure = (StatusCode, &'static str);
type Result<T> = std::result::Result<T, Failure>;
const LIMIT: usize = 20_000_000;
const INVALID: &str = "No room assignments could be found. Check your ID or ask the BMT help desk.";
const STORAGE: Failure = (
    StatusCode::SERVICE_UNAVAILABLE,
    "Private roster storage is unavailable. Nothing is confirmed saved.",
);
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn norm(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}
fn room_label(s: &str) -> String {
    let mut s = norm(s);
    while s.ends_with(')') {
        if let Some(i) = s.rfind('(') {
            s.truncate(i);
            s = s.trim_end().into();
        } else {
            break;
        }
    }
    s
}
fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mapping {
    pub id_column: String,
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    pub room_columns: BTreeMap<String, String>,
    pub room_aliases: BTreeMap<String, String>,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Saved {
    event_id: String,
    token: String,
    auto_sync: bool,
    revision: u64,
    snapshot_event: String,
    rows: Vec<Row>,
    mapping: Mapping,
    checked_at: Option<i64>,
    synced_at: Option<i64>,
    notes: Vec<String>,
}
struct Inner {
    saved: Saved,
    db: Connection,
    error: Option<&'static str>,
    attempted_at: Option<i64>,
    failures: u32,
    next_attempt: i64,
}
pub struct RosterStore {
    inner: Mutex<Inner>,
    sync: tokio::sync::Mutex<()>,
    client: reqwest::Client,
    enabled: bool,
    demo: bool,
    legacy: bool,
    auto_allowed: bool,
    attempts: Mutex<HashMap<String, (Instant, u32)>>,
}
impl RosterStore {
    pub fn from_env(demo: bool) -> std::result::Result<Self, String> {
        let path = std::env::var("LIVE_CONTESTDOJO_DB")
            .ok()
            .filter(|s| !s.is_empty());
        let db = if !demo {
            if let Some(path) = &path {
                let p = Path::new(path);
                if !p.is_absolute() || p.is_symlink() {
                    return Err(
                        "LIVE_CONTESTDOJO_DB must be an absolute private non-symlink path".into(),
                    );
                }
                let parent = p
                    .parent()
                    .ok_or("Missing private directory")?
                    .canonicalize()
                    .map_err(|_| "Create the private roster directory first")?;
                if parent.ancestors().any(|p| {
                    p.join(".git").exists()
                        || p.join("package.json").exists()
                        || p.join("Cargo.toml").exists()
                }) {
                    return Err(
                        "Roster storage must be outside application/content repositories".into(),
                    );
                }
                for (var, default, file) in [
                    ("STATIC_DIR", "dist", false),
                    ("SITE_MEDIA_DIR", "media", false),
                    ("LIVE_CONTENT_REPO", "", false),
                    ("LIVE_CONTENT_REMOTE_REPO", "", false),
                    ("SITE_CONTENT_PATH", "content/site.json", true),
                    ("WAYFINDING_CONTENT_PATH", "content/wayfinding.json", true),
                ] {
                    let value = std::env::var(var).unwrap_or(default.into());
                    if value.is_empty() {
                        continue;
                    }
                    let root = Path::new(&value);
                    let root = if file {
                        root.parent().unwrap_or(root)
                    } else {
                        root
                    };
                    if root.canonicalize().is_ok_and(|r| parent.starts_with(r)) {
                        return Err(
                            "Roster storage must be outside public/content directories".into()
                        );
                    }
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
                    if p.exists()
                        && p.metadata()
                            .map_err(|_| "Cannot inspect private storage")?
                            .permissions()
                            .mode()
                            & 0o077
                            != 0
                    {
                        return Err("Existing roster database must have mode 0600".into());
                    }
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .mode(0o600)
                        .open(p)
                        .map_err(|_| "Cannot create private roster database")?;
                }
                Connection::open(p)
            } else {
                Connection::open_in_memory()
            }
        } else {
            Connection::open_in_memory()
        }
        .map_err(|_| "Cannot open private roster database")?;
        let store = Self::open(
            db,
            demo || path.is_some(),
            demo,
            std::env::var("PRIVATE_ROSTER_PATH").is_ok(),
            std::env::var("ROSTER_AUTO_SYNC").as_deref() != Ok("0"),
        )?;
        if !demo {
            let mut i = store.inner.lock().unwrap();
            if i.saved.revision == 0 {
                i.saved.event_id = std::env::var("CONTESTDOJO_EVENT_ID")
                    .unwrap_or_default()
                    .trim()
                    .into();
                i.saved.token = std::env::var("CONTESTDOJO_API_TOKEN")
                    .unwrap_or_default()
                    .trim()
                    .into();
                if (!i.saved.event_id.is_empty() && !identifier(&i.saved.event_id))
                    || !valid_token(&i.saved.token)
                {
                    return Err("Invalid ContestDojo configuration".into());
                }
            }
        }
        Ok(store)
    }
    fn open(
        db: Connection,
        enabled: bool,
        demo: bool,
        legacy: bool,
        auto_allowed: bool,
    ) -> std::result::Result<Self, String> {
        db.execute_batch("CREATE TABLE IF NOT EXISTS live_roster (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)").map_err(|_| "Cannot initialize private roster storage")?;
        let raw: Option<String> = db
            .query_row("SELECT value FROM live_roster WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|_| "Cannot read private roster storage")?;
        let saved = if let Some(raw) = raw {
            if raw.len() > LIMIT {
                return Err("Private snapshot exceeds limit".into());
            }
            serde_json::from_str(&raw).map_err(|_| "Invalid private roster storage")?
        } else {
            Saved {
                auto_sync: true,
                mapping: Mapping {
                    id_column: "number".into(),
                    ..Default::default()
                },
                ..Default::default()
            }
        };
        Ok(Self {
            inner: Mutex::new(Inner {
                saved,
                db,
                error: None,
                attempted_at: None,
                failures: 0,
                next_attempt: 0,
            }),
            sync: tokio::sync::Mutex::new(()),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .connect_timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "Cannot initialize roster client")?,
            enabled,
            demo,
            legacy,
            auto_allowed,
            attempts: Mutex::new(HashMap::new()),
        })
    }
    fn persist(i: &mut Inner, saved: Saved) -> Result<()> {
        let raw = serde_json::to_string(&saved).map_err(|_| STORAGE)?;
        if raw.len() > LIMIT {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Private snapshot exceeds its storage limit.",
            ));
        }
        i.db.execute("INSERT INTO live_roster(id,value) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET value=excluded.value", [&raw]).map_err(|_| STORAGE)?;
        i.saved = saved;
        Ok(())
    }
    fn configured(&self, s: &Saved) -> bool {
        self.enabled && (self.demo || (!s.event_id.is_empty() && !s.token.is_empty()))
    }
    pub async fn sync(&self) -> Result<()> {
        let _lock = self.sync.try_lock().map_err(|_| {
            (
                StatusCode::CONFLICT,
                "A sync is already running. Refresh its status shortly.",
            )
        })?;
        let (event, token) = {
            let i = self.inner.lock().unwrap();
            if !self.configured(&i.saved) {
                return Err((
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Ask a Super admin to configure ContestDojo in Settings.",
                ));
            }
            if now() < i.next_attempt {
                return Err((
                    StatusCode::TOO_MANY_REQUESTS,
                    "Sync is cooling down. Wait a minute and refresh status.",
                ));
            }
            (i.saved.event_id.clone(), i.saved.token.clone())
        };
        let fetched = if self.demo {
            demo_rows()
        } else {
            fetch(&self.client, "https://api.contestdojo.com", &event, &token).await
        };
        self.apply_fetch(event, fetched)
    }
    fn apply_fetch(&self, event: String, fetched: Result<(Vec<Row>, Vec<String>)>) -> Result<()> {
        let mut i = self.inner.lock().unwrap();
        i.attempted_at = Some(now());
        match fetched {
            Ok((rows, notes)) => {
                let mut s = i.saved.clone();
                let changed = s.rows != rows || s.snapshot_event != event;
                if changed {
                    s.rows = rows;
                    s.snapshot_event = event;
                    s.revision += 1;
                }
                s.synced_at = Some(now());
                s.checked_at = Some(now());
                s.notes = notes;
                if self.demo && s.mapping.room_columns.is_empty() {
                    s.mapping.room_columns = BTreeMap::from([
                        ("individual".into(), "roomAssignments.individual".into()),
                        ("team".into(), "roomAssignments.team".into()),
                    ]);
                }
                if let Err(e) = Self::persist(&mut i, s) {
                    i.error = Some(e.1);
                    i.next_attempt = now() + 60;
                    return Err(e);
                }
                i.error = None;
                i.failures = 0;
                i.next_attempt = now() + 30;
                Ok(())
            }
            Err(error) => {
                i.error = Some(error.1);
                i.failures = (i.failures + 1).min(5);
                let cap = (60i64 << i.failures).min(900);
                i.next_attempt = now() + 60 + (uuid::Uuid::new_v4().as_u128() % cap as u128) as i64;
                Err(error)
            }
        }
    }
    pub fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs((60 - now().rem_euclid(60)) as u64)).await;
                let run = {
                    let i = self.inner.lock().unwrap();
                    self.auto_allowed
                        && !self.demo
                        && i.saved.auto_sync
                        && self.configured(&i.saved)
                        && now() >= i.next_attempt
                };
                if run {
                    let _ = self.sync().await;
                }
            }
        });
    }
    fn mode(&self) -> &'static str {
        if self.demo {
            "demo"
        } else if self.enabled {
            "contestdojo"
        } else if self.legacy {
            "legacy"
        } else {
            "unavailable"
        }
    }
    fn status(
        &self,
        content: &WayfindingContent,
        schedule: &[ScheduleEvent],
        offset: usize,
    ) -> Value {
        let i = self.inner.lock().unwrap();
        let s = &i.saved;
        let ids = index(&s.rows, &s.mapping);
        let missing_ids = s
            .rows
            .iter()
            .filter(|r| student_id(r, &s.mapping).is_empty())
            .count();
        let unmatched = s
            .rows
            .iter()
            .flat_map(|r| s.mapping.room_columns.values().filter_map(|c| r.get(c)))
            .filter(|v| !v.trim().is_empty() && match_room(v, &s.mapping, content).is_none())
            .map(|v| room_label(v))
            .collect::<BTreeSet<_>>();
        let cols = columns(&s.rows);
        json!({"mode":self.mode(), "configured":self.configured(s), "syncing":self.sync.try_lock().is_err(), "autoSync":self.auto_allowed && s.auto_sync && !self.demo,
            "revision":s.revision,"snapshotEvent":s.snapshot_event,"eventMatches":s.snapshot_event==s.event_id,"stale":i.error.is_some() || s.checked_at.is_none_or(|t| now()-t>180),"attemptedAt":i.attempted_at,"checkedAt":s.checked_at,"syncedAt":s.synced_at,"count":s.rows.len(),"notes":s.notes,"error":i.error,"nextAttempt":i.next_attempt,
            "columns":cols,"mapping":s.mapping,"missingIds":missing_ids,"ambiguousIds":ids.values().filter(|v| v.is_none()).count(),"unmatchedRooms":unmatched.iter().take(100).collect::<Vec<_>>(),"unmatchedRoomCount":unmatched.len(),
            "missingColumns":s.mapping.room_columns.values().chain(std::iter::once(&s.mapping.id_column)).chain(s.mapping.fields.values()).filter(|c| !c.is_empty() && !cols.contains(*c)).collect::<BTreeSet<_>>(),
            "schedule":schedule,"rows":s.rows.iter().skip(offset).take(50).collect::<Vec<_>>(),"offset":offset})
    }
    fn limited(&self, peer: &str, sid: &str) -> bool {
        let mut a = self.attempts.lock().unwrap();
        a.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(600));
        // All requests, including successes, are charged; never expose a bulk enumeration path.
        let keys = [
            (format!("id:{:x}", Sha256::digest(sid)), 20),
            (format!("ip:{peer}"), 600),
            ("global".into(), 6000),
        ];
        if a.len() + keys.iter().filter(|(k, _)| !a.contains_key(k)).count() > 8192
            || keys
                .iter()
                .any(|(k, max)| a.get(k).is_some_and(|(_, n)| n >= max))
        {
            return true;
        }
        for (k, _) in keys {
            a.entry(k)
                .and_modify(|(_, n)| *n += 1)
                .or_insert((Instant::now(), 1));
        }
        false
    }
}
fn valid_token(t: &str) -> bool {
    t.len() <= 4096 && t.bytes().all(|b| b.is_ascii_graphic())
}
fn columns(rows: &[Row]) -> BTreeSet<String> {
    rows.iter().flat_map(|r| r.keys().cloned()).collect()
}
fn student_id(r: &Row, m: &Mapping) -> String {
    if m.id_column.is_empty() {
        return String::new();
    }
    r.get(&m.id_column)
        .filter(|v| !v.trim().is_empty())
        .map_or(String::new(), |s| norm(s))
}
fn index(rows: &[Row], m: &Mapping) -> HashMap<String, Option<usize>> {
    let mut out = HashMap::new();
    for (n, r) in rows.iter().enumerate() {
        let id = student_id(r, m);
        if !id.is_empty() {
            out.entry(id).and_modify(|v| *v = None).or_insert(Some(n));
        }
    }
    out
}
fn participates(row: &Row, mapping: &Mapping, test: &str) -> bool {
    let Some(column) = mapping.fields.get("tests").filter(|c| !c.is_empty()) else {
        return true;
    };
    row.get(column)
        .is_some_and(|v| v.split([',', ';']).any(|id| id.trim() == test))
}
fn match_room(raw: &str, mapping: &Mapping, c: &WayfindingContent) -> Option<String> {
    let label = room_label(raw);
    let alias = mapping.room_aliases.get(&label);
    let mut candidates = c
        .buildings
        .iter()
        .flat_map(|b| {
            b.floors
                .iter()
                .flat_map(move |f| f.rooms.iter().map(move |r| (b, r)))
        })
        .filter(|(b, r)| {
            if let Some(alias) = alias {
                r.id == *alias
            } else {
                norm(&r.id) == label || room_label(&format!("{} {}", b.name, r.code)) == label
            }
        });
    let first = candidates.next()?.1.id.clone();
    if candidates.next().is_some() {
        None
    } else {
        Some(first)
    }
}
async fn get_rows(
    client: &reqwest::Client,
    base: &str,
    event: &str,
    token: &str,
    kind: &str,
) -> Result<Vec<Value>> {
    let response = client
        .get(format!("{base}/events/{event}/{kind}/"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                if e.is_timeout() {
                    "ContestDojo read timed out. Last good roster retained."
                } else {
                    "ContestDojo could not be reached. Last good roster retained."
                },
            )
        })?;
    let mut response = match response.status().as_u16() {
        200 => response,
        401 | 403 => {
            return Err((
                StatusCode::BAD_GATEWAY,
                "ContestDojo refused the token. Ask a Super admin to replace it.",
            ))
        }
        404 => {
            return Err((
                StatusCode::BAD_GATEWAY,
                "ContestDojo does not recognize that event. Check Settings.",
            ))
        }
        _ => {
            return Err((
                StatusCode::BAD_GATEWAY,
                "ContestDojo could not complete the read. Last good roster retained.",
            ))
        }
    };
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            "ContestDojo read timed out or was interrupted.",
        )
    })? {
        if body.len() + chunk.len() > 8_000_000 {
            return Err((
                StatusCode::BAD_GATEWAY,
                "ContestDojo response exceeds the import limit.",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    let rows: Vec<Value> = serde_json::from_slice(&body).map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            "ContestDojo returned invalid data. Last good roster retained.",
        )
    })?;
    if rows.len() > 20_000 || rows.iter().any(|r| !r.is_object()) {
        return Err((
            StatusCode::BAD_GATEWAY,
            "ContestDojo returned an unsupported roster shape or size.",
        ));
    }
    Ok(rows)
}
fn flatten(prefix: &str, v: &Value, out: &mut Row, depth: usize) -> Result<()> {
    if depth > 12 || prefix.len() > 256 || out.len() > 256 {
        return Err((
            StatusCode::BAD_GATEWAY,
            "ContestDojo row exceeds the column or nesting limit.",
        ));
    }
    match v {
        Value::Object(o) => {
            for (k, v) in o {
                flatten(
                    &if prefix.is_empty() {
                        k.clone()
                    } else {
                        format!("{prefix}.{k}")
                    },
                    v,
                    out,
                    depth + 1,
                )?;
            }
        }
        _ => {
            let s = match v {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                Value::Array(a) => a
                    .iter()
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
                _ => v.to_string(),
            };
            if s.len() > 8192 {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "ContestDojo cell exceeds its limit.",
                ));
            }
            if out.contains_key(prefix) {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "ContestDojo returned ambiguous flattened columns.",
                ));
            }
            out.insert(prefix.into(), s);
        }
    }
    Ok(())
}
fn join_rows(
    students: Vec<Value>,
    teams: Vec<Value>,
    orgs: Vec<Value>,
) -> Result<(Vec<Row>, Vec<String>)> {
    let fallback = (!teams.is_empty() || !orgs.is_empty()).then(|| students.clone());
    let team: HashMap<_, _> = teams
        .iter()
        .filter_map(|v| Some((v.get("id")?.as_str()?, v)))
        .collect();
    let org: HashMap<_, _> = orgs
        .iter()
        .filter_map(|v| Some((v.get("id")?.as_str()?, v)))
        .collect();
    let mut rows = Vec::new();
    let mut unmatched = 0;
    for s in students {
        let mut r = Row::new();
        flatten("", &s, &mut r, 0)?;
        if r.get("name").is_none_or(|v| v.trim().is_empty()) {
            r.remove("name");
        }
        r.entry("name".into()).or_insert_with(|| {
            format!(
                "{} {}",
                s["fname"].as_str().unwrap_or(""),
                s["lname"].as_str().unwrap_or("")
            )
            .trim()
            .into()
        });
        for (key, lookup) in [("team", &team), ("org", &org)] {
            if let Some(id) = s[key].as_str().filter(|s| !s.is_empty()) {
                if let Some(v) = lookup.get(id) {
                    let mut extra = Row::new();
                    if flatten(key, v, &mut extra, 0).is_ok() && r.len() + extra.len() <= 256 {
                        r.extend(extra);
                    } else {
                        unmatched += 1;
                    }
                } else {
                    unmatched += 1;
                }
            }
        }
        rows.push(r);
    }
    if rows.len() > 20_000
        || columns(&rows).len() > 256
        || serde_json::to_vec(&rows).map_err(|_| STORAGE)?.len() > 16_000_000
    {
        if let Some(students) = fallback {
            let (rows, mut notes) = join_rows(students, vec![], vec![])?;
            notes.push(
                "Enrichment exceeded snapshot limits and was omitted. Students were retained."
                    .into(),
            );
            return Ok((rows, notes));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            "ContestDojo snapshot exceeds its column or size limit.",
        ));
    }
    let notes = vec![format!(
        "{} students, {} teams, {} organizations; {unmatched} unresolved team/organization links.",
        rows.len(),
        teams.len(),
        orgs.len()
    )];
    Ok((rows, notes))
}
async fn fetch(
    client: &reqwest::Client,
    base: &str,
    event: &str,
    token: &str,
) -> Result<(Vec<Row>, Vec<String>)> {
    let students = get_rows(client, base, event, token, "students").await?;
    let teams = get_rows(client, base, event, token, "teams").await;
    let orgs = get_rows(client, base, event, token, "orgs").await;
    let partial = teams.is_err() || orgs.is_err();
    let (rows, mut notes) = join_rows(
        students,
        teams.unwrap_or_default(),
        orgs.unwrap_or_default(),
    )?;
    if partial {
        notes.push(
            "Team or organization enrichment was unavailable. Students were retained.".into(),
        );
    }
    Ok((rows, notes))
}
fn demo_rows() -> Result<(Vec<Row>, Vec<String>)> {
    join_rows(
        vec![
            json!({"number":"DEMO-1001","fname":"Synthetic","lname":"Student","roomAssignments":{"individual":"demo-a101","team":"demo-a102"}}),
        ],
        vec![],
        vec![],
    )
}
fn schedule(s: &AppState) -> Vec<ScheduleEvent> {
    let mut live = s.db.get_live_data(None, false);
    if let Some(o) = &s.operations {
        o.snapshot().content.apply(&mut live, None, false);
    }
    live.schedule
}
fn response(r: Result<Value>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err((s, m)) => (s, Json(json!({"message":m}))).into_response(),
    }
}
#[derive(Deserialize)]
pub struct Page {
    #[serde(default)]
    offset: usize,
}
pub async fn roster(State(s): State<AppState>, Query(q): Query<Page>) -> Response {
    Json(s.roster.status(
        &s.wayfinding.snapshot().content,
        &schedule(&s),
        q.offset.min(20_000),
    ))
    .into_response()
}
pub async fn sync(State(s): State<AppState>) -> Response {
    match s.roster.sync().await {
        Ok(()) => Json(
            s.roster
                .status(&s.wayfinding.snapshot().content, &schedule(&s), 0),
        )
        .into_response(),
        Err(e) => response(Err(e)),
    }
}
pub async fn settings(State(s): State<AppState>) -> Json<Value> {
    let r = &s.roster;
    let i = r.inner.lock().unwrap();
    Json(
        json!({"enabled":r.enabled,"demo":r.demo,"revision":i.saved.revision,"eventId":i.saved.event_id,"tokenConfigured":!i.saved.token.is_empty(),"autoSync":i.saved.auto_sync,"autoAllowed":r.auto_allowed && !r.demo}),
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setup {
    revision: u64,
    event_id: String,
    token: Option<String>,
    auto_sync: bool,
}
pub async fn save_settings(State(s): State<AppState>, Json(v): Json<Setup>) -> Response {
    let r = &s.roster;
    let Ok(_guard) = r.sync.try_lock() else {
        return response(Err((
            StatusCode::CONFLICT,
            "Wait for the current sync to finish.",
        )));
    };
    let mut i = r.inner.lock().unwrap();
    if !r.enabled {
        return response(Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Configure private LIVE_CONTESTDOJO_DB storage before saving credentials.",
        )));
    }
    if i.saved.revision != v.revision {
        return response(Err((
            StatusCode::CONFLICT,
            "Settings changed. Reload before saving.",
        )));
    }
    if (!v.event_id.is_empty() && !identifier(&v.event_id))
        || v.token.as_ref().is_some_and(|t| !valid_token(t))
    {
        return response(Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "Use a valid event ID and a bounded token without spaces.",
        )));
    }
    let mut next = i.saved.clone();
    // Keep the prior private snapshot for diagnosis, but never serve it for a new event.
    if next.event_id != v.event_id {
        next.mapping = Mapping {
            id_column: "number".into(),
            ..Default::default()
        };
    }
    next.event_id = v.event_id;
    if let Some(token) = v.token {
        next.token = token;
    }
    next.auto_sync = v.auto_sync;
    next.revision += 1;
    response(RosterStore::persist(&mut i, next).map(|()| {
        i.next_attempt = 0;
        json!({"saved":true})
    }))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MappingInput {
    revision: u64,
    mapping: Mapping,
}
pub async fn mapping(State(s): State<AppState>, Json(v): Json<MappingInput>) -> Response {
    let r = &s.roster;
    let Ok(_guard) = r.sync.try_lock() else {
        return response(Err((
            StatusCode::CONFLICT,
            "Wait for the current sync to finish.",
        )));
    };
    let mut i = r.inner.lock().unwrap();
    let cols = columns(&i.saved.rows);
    let times = schedule(&s);
    let c = s.wayfinding.snapshot().content;
    if v.revision != i.saved.revision {
        return response(Err((
            StatusCode::CONFLICT,
            "Mapping changed. Reload before saving.",
        )));
    }
    if v.mapping.room_columns.len() > 64
        || v.mapping.room_aliases.len() > 1000
        || v.mapping
            .fields
            .keys()
            .any(|k| !["name", "tests", "school", "org", "team", "contact"].contains(&k.as_str()))
        || [&v.mapping.id_column]
            .into_iter()
            .chain(v.mapping.fields.values())
            .chain(v.mapping.room_columns.values())
            .any(|c| !c.is_empty() && !cols.contains(c))
        || v.mapping
            .room_columns
            .keys()
            .any(|id| !times.iter().any(|t| &t.id == id))
        || v.mapping.room_aliases.iter().any(|(label, id)| {
            label.is_empty()
                || label.len() > 256
                || label != &room_label(label)
                || !c
                    .buildings
                    .iter()
                    .flat_map(|b| &b.floors)
                    .flat_map(|f| &f.rooms)
                    .any(|r| &r.id == id)
        })
    {
        return response(Err((StatusCode::UNPROCESSABLE_ENTITY,"Choose known columns, schedule IDs and public rooms; aliases must be normalized uppercase labels.")));
    }
    let mut next = i.saved.clone();
    next.mapping = v.mapping;
    next.revision += 1;
    response(RosterStore::persist(&mut i, next).map(|()| json!({"saved":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Clear {
    confirm: String,
}
pub async fn clear(State(s): State<AppState>, Json(v): Json<Clear>) -> Response {
    if v.confirm != "CLEAR" {
        return response(Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "Type CLEAR to remove the local roster. Auto-sync can repopulate it.",
        )));
    }
    let r = &s.roster;
    let Ok(_guard) = r.sync.try_lock() else {
        return response(Err((
            StatusCode::CONFLICT,
            "Wait for the current sync to finish.",
        )));
    };
    let mut i = r.inner.lock().unwrap();
    let mut next = i.saved.clone();
    next.rows.clear();
    next.checked_at = None;
    next.synced_at = None;
    next.snapshot_event.clear();
    next.notes.clear();
    next.revision += 1;
    response(RosterStore::persist(&mut i, next).map(|()| json!({"cleared":true})))
}
async fn public_status(State(s): State<AppState>) -> Json<Value> {
    let r = &s.roster;
    let i = r.inner.lock().unwrap();
    Json(
        json!({"mode":r.mode(),"available":r.configured(&i.saved) && i.saved.checked_at.is_some() && i.saved.snapshot_event == i.saved.event_id,"checkedAt":i.saved.checked_at,"stale":i.error.is_some() || i.saved.checked_at.is_none_or(|t| now()-t>180),"demoId":if r.demo {Some("DEMO-1001")} else {None}}),
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Lookup {
    student_id: String,
}
async fn lookup(
    State(s): State<AppState>,
    peer: Option<axum::Extension<ConnectInfo<std::net::SocketAddr>>>,
    headers: HeaderMap,
    body: std::result::Result<Json<Lookup>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = crate::wayfinding::same_origin(&headers) {
        return e.into_response();
    }
    let sid = body
        .as_ref()
        .map(|v| norm(&v.student_id))
        .unwrap_or_default();
    let peer = peer
        .map(|v| v.0 .0.ip().to_string())
        .unwrap_or("unknown".into());
    if s.roster.limited(&peer, &sid) {
        let mut res = response(Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many lookups. Wait ten minutes or ask the BMT help desk.",
        )));
        res.headers_mut()
            .insert("retry-after", "600".parse().unwrap());
        return res;
    }
    let invalid = || response(Err((StatusCode::NOT_FOUND, INVALID)));
    if sid.is_empty() || sid.len() > 128 || sid.chars().any(char::is_control) {
        return invalid();
    }
    let i = s.roster.inner.lock().unwrap();
    let saved = &i.saved;
    if !s.roster.configured(saved)
        || saved.checked_at.is_none()
        || saved.snapshot_event != saved.event_id
    {
        return response(Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Room lookup is unavailable. Ask the BMT help desk.",
        )));
    }
    let ids = index(&saved.rows, &saved.mapping);
    let Some(Some(n)) = ids.get(&sid) else {
        return invalid();
    };
    let row = &saved.rows[*n];
    let c = s.wayfinding.snapshot().content;
    let mut times = schedule(&s);
    times.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    let assignments: Vec<Value> = times.iter().filter(|t| participates(row,&saved.mapping,&t.id)).filter_map(|t| { let col=saved.mapping.room_columns.get(&t.id)?; let raw=row.get(col).filter(|v| !v.trim().is_empty())?; let room=match_room(raw,&saved.mapping,&c);
        Some(json!({"scheduleId":t.id,"round":t.title,"startTime":t.start_time,"endTime":t.end_time,"roomId":room,"status":if room.is_some(){"matched"}else{"unmatched"}})) }).collect();
    response(Ok(
        json!({"assignments":assignments,"checkedAt":saved.checked_at,"stale":i.error.is_some() || saved.checked_at.is_none_or(|t| now()-t>180),"demo":s.roster.demo}),
    ))
}
async fn private_headers(mut r: Response) -> Response {
    r.headers_mut()
        .insert("cache-control", "private, no-store".parse().unwrap());
    r.headers_mut()
        .insert("referrer-policy", "no-referrer".parse().unwrap());
    r
}
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/api/rooms/status", get(public_status))
        .route("/api/rooms/lookup", post(lookup))
        .layer(DefaultBodyLimit::max(4096))
        .layer(middleware::map_response(private_headers))
}
async fn staff_intent(request: axum::extract::Request, next: middleware::Next) -> Response {
    if request.method() != axum::http::Method::GET
        && request.method() != axum::http::Method::HEAD
        && request
            .headers()
            .get("x-staff-request")
            .and_then(|v| v.to_str().ok())
            != Some("1")
    {
        return response(Err((
            StatusCode::FORBIDDEN,
            "Use the staff workspace to make changes.",
        )));
    }
    next.run(request).await
}
pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/settings/contestdojo",
            get(settings).put(save_settings),
        )
        .route("/api/roster", get(roster))
        .route("/api/roster/sync", post(sync))
        .route("/api/roster/mapping", post(mapping))
        .route("/api/roster/clear", post(clear))
        .layer(middleware::from_fn(staff_intent))
        .layer(DefaultBodyLimit::max(128_000))
        .layer(middleware::map_response(private_headers))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> RosterStore {
        RosterStore::open(
            Connection::open_in_memory().unwrap(),
            true,
            true,
            false,
            false,
        )
        .unwrap()
    }
    #[test]
    fn normalization_columns_joins_and_ambiguous_ids() {
        let (rows, notes)=join_rows(vec![json!({"number":"  001a  ","fname":"Sample","lname":"Student","team":"t","org":"missing","rooms":{"round":"R"},"list":["a","b"]}),json!({"number":"001A"}),json!({"id":"fallback-must-not-be-used"})],vec![json!({"id":"t","name":"Synthetic Team"})],vec![]).unwrap();
        let mapping = Mapping {
            id_column: "number".into(),
            ..Default::default()
        };
        assert_eq!(rows[0]["team.name"], "Synthetic Team");
        assert_eq!(rows[0]["rooms.round"], "R");
        assert_eq!(rows[0]["list"], "a, b");
        assert_eq!(rows[0]["name"], "Sample Student");
        assert!(notes[0].contains("1 unresolved"));
        assert_eq!(index(&rows, &mapping)["001A"], None);
        assert_eq!(student_id(&rows[2], &mapping), "");
        assert!(join_rows(vec![json!({"a.b":1,"a":{"b":2}})], vec![], vec![]).is_err());
        assert!(join_rows(vec![json!({"large":"a".repeat(8193)})], vec![], vec![]).is_err());
        let mut nested = json!("leaf");
        for _ in 0..14 {
            nested = json!({"a":nested});
        }
        assert!(join_rows(vec![nested], vec![], vec![]).is_err());
        let mut many = serde_json::Map::new();
        for n in 0..258 {
            many.insert(format!("c{n}"), json!(n));
        }
        assert!(join_rows(vec![Value::Object(many)], vec![], vec![]).is_err());
        let mut teams = vec![];
        for prefix in ["a", "b"] {
            let mut team = serde_json::Map::new();
            team.insert("id".into(), json!(prefix));
            for n in 0..130 {
                team.insert(format!("{prefix}{n}"), json!("value"));
            }
            teams.push(Value::Object(team));
        }
        let (rows, notes) = join_rows(
            vec![
                json!({"number":"001","team":"a"}),
                json!({"number":"002","team":"b"}),
            ],
            teams,
            vec![],
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert!(notes.iter().any(|n| n.contains("omitted")));
    }
    #[test]
    fn room_matching_is_explicit_and_ambiguity_fails_closed() {
        let row = BTreeMap::from([("tests".into(), "individual; team".into())]);
        let mapping = Mapping {
            fields: BTreeMap::from([("tests".into(), "tests".into())]),
            ..Default::default()
        };
        assert!(participates(&row, &mapping, "individual"));
        assert!(!participates(&row, &mapping, "algebra"));
        assert!(!participates(&Row::new(), &mapping, "individual"));
        let mut c: WayfindingContent =
            serde_json::from_str(include_str!("../../content/wayfinding.json")).unwrap();
        let mut m = Mapping::default();
        assert_eq!(
            room_label(" Demo Learning Center   A101 (B) "),
            "DEMO LEARNING CENTER A101"
        );
        assert_eq!(
            match_room("Demo Learning Center A101 (B)", &m, &c),
            Some("demo-a101".into())
        );
        assert_eq!(match_room("A101", &m, &c), None);
        let mut duplicate = c.buildings[0].floors[0].rooms[0].clone();
        duplicate.id = "duplicate".into();
        c.buildings[0].floors[0].rooms.push(duplicate);
        assert_eq!(match_room("Demo Learning Center A101", &m, &c), None);
        m.room_aliases
            .insert("DEMO LEARNING CENTER A101".into(), "demo-a101".into());
        assert_eq!(
            match_room("Demo Learning Center A101", &m, &c),
            Some("demo-a101".into())
        );
        m.room_aliases
            .insert("UNKNOWN".into(), "deleted-room".into());
        assert_eq!(match_room("unknown", &m, &c), None);
    }
    #[tokio::test]
    async fn sync_serialization_backoff_failure_retention_and_atomic_storage() {
        let s = store();
        let lock = s.sync.lock().await;
        assert_eq!(s.sync().await.unwrap_err().0, StatusCode::CONFLICT);
        drop(lock);
        s.sync().await.unwrap();
        let before = s.inner.lock().unwrap().saved.rows.clone();
        assert_eq!(s.sync().await.unwrap_err().0, StatusCode::TOO_MANY_REQUESTS);
        s.apply_fetch(
            "other".into(),
            Err((StatusCode::BAD_GATEWAY, "Synthetic timeout")),
        )
        .unwrap_err();
        {
            let i = s.inner.lock().unwrap();
            assert_eq!(i.saved.rows, before);
            assert!(i.next_attempt > now());
            assert!(i.error.is_some());
        }
        {
            let i = s.inner.lock().unwrap();
            i.db.execute_batch("PRAGMA query_only=ON").unwrap();
        }
        assert!(s.apply_fetch("other".into(), Ok((vec![], vec![]))).is_err());
        assert_eq!(s.inner.lock().unwrap().saved.rows, before);
    }
    #[test]
    fn persistence_reopens_with_mappings_and_snapshot() {
        let path = std::env::temp_dir().join(format!("live-roster-{}.db", uuid::Uuid::new_v4()));
        {
            let s = RosterStore::open(Connection::open(&path).unwrap(), true, true, false, false)
                .unwrap();
            s.apply_fetch("event".into(), demo_rows()).unwrap();
        }
        {
            let s = RosterStore::open(Connection::open(&path).unwrap(), true, true, false, false)
                .unwrap();
            let i = s.inner.lock().unwrap();
            assert_eq!(i.saved.rows.len(), 1);
            assert_eq!(i.saved.snapshot_event, "event");
            assert!(i.saved.mapping.room_columns.contains_key("team"));
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn limits_charge_successes_and_do_not_store_plain_ids() {
        let s = store();
        for _ in 0..20 {
            assert!(!s.limited("local", "001A"));
        }
        assert!(s.limited("local", "001A"));
        assert!(!s
            .attempts
            .lock()
            .unwrap()
            .keys()
            .any(|k| k.contains("001A")));
    }
    async fn fixture(
        status: u16,
        body: String,
        delay: bool,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().fallback(get(move |headers: HeaderMap, uri: axum::http::Uri| {
            let body = body.clone();
            async move {
                assert_eq!(headers["authorization"], "Bearer synthetic-test-token");
                assert!(uri.path().starts_with("/events/synthetic/"));
                if delay {
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                }
                if uri.path().ends_with("/students/") {
                    (StatusCode::from_u16(status).unwrap(), body)
                } else {
                    (
                        StatusCode::BAD_GATEWAY,
                        "private upstream diagnostics must never escape".into(),
                    )
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, task)
    }
    #[tokio::test]
    async fn loopback_provider_required_failures_and_optional_enrichment() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(1000))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        for (status, body, delay) in [
            (401, "secret-body".into(), false),
            (404, "secret-body".into(), false),
            (200, "not json".into(), false),
            (200, "{}".into(), false),
            (200, "[1]".into(), false),
            (302, "[]".into(), false),
            (200, "[]".into(), true),
            (200, "x".repeat(8_000_001), false),
        ] {
            let (base, task) = fixture(status, body, delay).await;
            let result = fetch(&client, &base, "synthetic", "synthetic-test-token").await;
            assert!(result.is_err());
            let e = result.unwrap_err();
            assert!(!e.1.contains("secret-body") && !e.1.contains("synthetic-test-token"));
            task.abort();
        }
        let (base, task) = fixture(
            200,
            "[{\"number\":\"001\",\"fname\":\"Synthetic\"}]".into(),
            false,
        )
        .await;
        let (rows, notes) = fetch(&client, &base, "synthetic", "synthetic-test-token")
            .await
            .unwrap();
        assert_eq!(rows[0]["number"], "001");
        assert!(notes.iter().any(|n| n.contains("unavailable")));
        task.abort();
    }
}
