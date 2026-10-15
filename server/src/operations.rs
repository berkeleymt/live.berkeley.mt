use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::RwLock,
    time::Duration,
};

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{process::Command, sync::Mutex};
use uuid::Uuid;

use crate::{content::ContentError, models::*};

const FILE: &str = "operations.json";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Operations {
        serde_json::from_value(json!({
            "schedule": [{"id":"round", "title":"Round", "startTime":"10:00", "endTime":"11:00", "location":"Demo", "category":"team"}],
            "delays": [], "announcements": []
        })).unwrap()
    }

    #[test]
    fn malformed_unicode_times_are_rejected_without_panicking() {
        for value in ["é:12", "1:２", "24:00", "12:60", "1:00"] {
            let mut content = fixture();
            content.schedule[0].start_time = value.into();
            assert!(content.validate().is_err(), "{value}");
        }
    }

    #[test]
    fn private_or_misspelled_nested_fields_are_rejected() {
        let mut value = serde_json::to_value(fixture()).unwrap();
        value["schedule"][0]["privateRoster"] = json!(["not-public"]);
        assert!(serde_json::from_value::<Operations>(value).is_err());
    }

    #[test]
    fn misleading_delay_metadata_is_rejected() {
        let mut content = fixture();
        content.delays.push(
            serde_json::from_value(json!({
                "id":"delay", "eventId":"round", "eventTitle":"Wrong title", "originalTime":"10:00",
                "originalEndTime":"11:00", "newTime":"10:15", "timestamp":"2026-11-14T10:00:00Z"
            }))
            .unwrap(),
        );
        assert!(content.validate().is_err());
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operations {
    pub schedule: Vec<ScheduleEvent>,
    pub delays: Vec<DelayNotice>,
    pub announcements: Vec<Announcement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editorial: Option<Editorial>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Editorial {
    pub event: crate::content::EventContent,
    pub site: crate::site::SiteConfig,
    pub wayfinding: crate::wayfinding::WayfindingContent,
}

fn invalid(message: &str) -> ContentError {
    (StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn unavailable(message: &str) -> ContentError {
    (StatusCode::SERVICE_UNAVAILABLE, message.into())
}
fn conflict() -> ContentError {
    (StatusCode::CONFLICT, "Publication changed or the content checkout has uncommitted edits. Keep your draft, refresh and reconcile it before retrying.".into())
}
fn time(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && [b[0], b[1], b[3], b[4]].iter().all(u8::is_ascii_digit)
        && value[..2].parse::<u8>().is_ok_and(|h| h < 24)
        && value[3..].parse::<u8>().is_ok_and(|m| m < 60)
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max
}
fn identifier(value: &str) -> bool {
    text(value, 100)
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn timestamp(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok()
}
fn due(value: &str, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok_and(|date| date <= now)
}

impl Operations {
    pub fn from_live(live: LiveData) -> Self {
        Self {
            schedule: live.schedule,
            delays: live.delays,
            announcements: live.announcements,
            editorial: None,
        }
    }
    pub fn validate(&self) -> Result<(), ContentError> {
        if let Some(editorial) = &self.editorial {
            editorial.event.validate().map_err(|e| invalid(&e))?;
            editorial.site.validate().map_err(|e| invalid(&e))?;
            editorial.wayfinding.validate().map_err(|e| invalid(&e.1))?;
        }
        if self.schedule.len() > 300 || self.delays.len() > 300 || self.announcements.len() > 1000 {
            return Err(invalid("Too many schedule entries, delays or updates."));
        }
        let mut ids = HashSet::new();
        for event in &self.schedule {
            if !identifier(&event.id)
                || !ids.insert(&event.id)
                || !text(&event.title, 300)
                || !time(&event.start_time)
                || !time(&event.end_time)
                || event.start_time >= event.end_time
                || event.location.len() > 500
                || event.description.as_ref().is_some_and(|v| v.len() > 20000)
                || !["general", "individual", "team", "ceremony"].contains(&event.category.as_str())
            {
                return Err(invalid("Schedule entries need unique IDs, a title, valid HH:mm times with end after start, and a recognized category."));
            }
        }
        let mut delayed = HashSet::new();
        let mut delay_ids = HashSet::new();
        for delay in &self.delays {
            let event = self
                .schedule
                .iter()
                .find(|e| e.id == delay.event_id)
                .ok_or_else(|| invalid("A delay references an unknown event."))?;
            let start = delay.new_time.as_ref().unwrap_or(&event.start_time);
            let end = delay.new_end_time.as_ref().unwrap_or(&event.end_time);
            if !identifier(&delay.id)
                || !delay_ids.insert(&delay.id)
                || !delayed.insert(&delay.event_id)
                || delay.event_title != event.title
                || delay.original_time != event.start_time
                || delay
                    .original_end_time
                    .as_ref()
                    .is_some_and(|v| v != &event.end_time)
                || !timestamp(&delay.timestamp)
                || !time(start)
                || !time(end)
                || start >= end
                || (delay.new_time.is_none() && delay.new_end_time.is_none())
                || delay.reason.as_ref().is_some_and(|v| v.len() > 2000)
            {
                return Err(invalid("A delay needs unique IDs, valid timestamps and effective times, and at most one delay per event."));
            }
        }
        let mut ids = HashSet::new();
        for item in &self.announcements {
            if !identifier(&item.id)
                || !ids.insert(&item.id)
                || !text(&item.title, 300)
                || !text(&item.body, 20000)
                || !timestamp(&item.timestamp)
                || item.scheduled_at.as_ref().is_some_and(|v| !timestamp(v))
                || !["normal", "urgent"].contains(&item.priority.as_str())
            {
                return Err(invalid("Updates need unique IDs, title, body, valid timestamps and normal/urgent priority."));
            }
        }
        Ok(())
    }
    pub fn apply(&self, live: &mut LiveData, at: Option<&str>, include_future: bool) {
        let now = at
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);
        live.schedule = self.schedule.clone();
        live.schedule
            .sort_by(|a, b| a.start_time.cmp(&b.start_time));
        live.announcements = self
            .announcements
            .iter()
            .filter(|a| include_future || due(a.scheduled_at.as_ref().unwrap_or(&a.timestamp), now))
            .cloned()
            .collect();
        live.delays = self
            .delays
            .iter()
            .filter(|d| include_future || due(&d.timestamp, now))
            .cloned()
            .collect();
        live.announcements.sort_by_key(|a| {
            std::cmp::Reverse(
                DateTime::parse_from_rfc3339(a.scheduled_at.as_ref().unwrap_or(&a.timestamp)).ok(),
            )
        });
        live.delays
            .sort_by_key(|d| std::cmp::Reverse(DateTime::parse_from_rfc3339(&d.timestamp).ok()));
    }
    pub fn mutate(
        &mut self,
        method: &str,
        kind: &str,
        id: Option<&str>,
        body: Value,
    ) -> Result<Value, ContentError> {
        let missing = || {
            (
                StatusCode::NOT_FOUND,
                "Item no longer exists. Refresh before editing.".into(),
            )
        };
        let decode = |e: serde_json::Error| invalid(&format!("Invalid fields: {e}"));
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let result = match (method, kind) {
            ("POST", "schedule") => {
                let input: ScheduleEventInput = serde_json::from_value(body).map_err(decode)?;
                let event = ScheduleEvent {
                    id: Uuid::new_v4().to_string(),
                    title: input.title,
                    start_time: input.start_time,
                    end_time: input.end_time,
                    location: input.location,
                    category: input.category,
                    description: input.description,
                };
                let value = serde_json::to_value(&event).unwrap();
                self.schedule.push(event);
                value
            }
            ("PUT", "schedule") => {
                let event = self
                    .schedule
                    .iter_mut()
                    .find(|e| Some(e.id.as_str()) == id)
                    .ok_or_else(missing)?;
                let input: ScheduleEventInput = serde_json::from_value(body).map_err(decode)?;
                *event = ScheduleEvent {
                    id: event.id.clone(),
                    title: input.title,
                    start_time: input.start_time,
                    end_time: input.end_time,
                    location: input.location,
                    category: input.category,
                    description: input.description,
                };
                for delay in &mut self.delays {
                    if delay.event_id == event.id {
                        delay.event_title = event.title.clone();
                        delay.original_time = event.start_time.clone();
                        delay.original_end_time = Some(event.end_time.clone());
                    }
                }
                Value::Null
            }
            ("DELETE", "schedule") => {
                let index = self
                    .schedule
                    .iter()
                    .position(|e| Some(e.id.as_str()) == id)
                    .ok_or_else(missing)?;
                let removed = self.schedule.remove(index);
                self.delays.retain(|d| d.event_id != removed.id);
                Value::Null
            }
            ("POST", "delays") => {
                let input: DelayInput = serde_json::from_value(body).map_err(decode)?;
                let event = self
                    .schedule
                    .iter()
                    .find(|e| e.id == input.event_id)
                    .ok_or_else(missing)?;
                let delay = DelayNotice {
                    id: Uuid::new_v4().to_string(),
                    event_id: event.id.clone(),
                    event_title: event.title.clone(),
                    original_time: event.start_time.clone(),
                    original_end_time: Some(event.end_time.clone()),
                    new_time: input.new_time,
                    new_end_time: input.new_end_time,
                    reason: input.reason,
                    timestamp: now,
                };
                self.delays.retain(|d| d.event_id != event.id);
                let value = serde_json::to_value(&delay).unwrap();
                self.delays.push(delay);
                value
            }
            ("DELETE", "delays") => {
                let index = self
                    .delays
                    .iter()
                    .position(|d| Some(d.id.as_str()) == id)
                    .ok_or_else(missing)?;
                self.delays.remove(index);
                Value::Null
            }
            ("POST", "announcements") => {
                let input: AnnouncementInput = serde_json::from_value(body).map_err(decode)?;
                let item = Announcement {
                    id: Uuid::new_v4().to_string(),
                    title: input.title,
                    body: input.body,
                    priority: input.priority.unwrap_or("normal".into()),
                    pinned: input.pinned,
                    scheduled_at: input.scheduled_at,
                    timestamp: now,
                };
                let value = serde_json::to_value(&item).unwrap();
                self.announcements.push(item);
                value
            }
            ("PUT", "announcements") => {
                let item = self
                    .announcements
                    .iter_mut()
                    .find(|a| Some(a.id.as_str()) == id)
                    .ok_or_else(missing)?;
                let input: AnnouncementInput = serde_json::from_value(body).map_err(decode)?;
                item.title = input.title;
                item.body = input.body;
                item.priority = input.priority.unwrap_or("normal".into());
                item.pinned = input.pinned;
                item.scheduled_at = input.scheduled_at;
                Value::Null
            }
            ("DELETE", "announcements") => {
                let index = self
                    .announcements
                    .iter()
                    .position(|a| Some(a.id.as_str()) == id)
                    .ok_or_else(missing)?;
                self.announcements.remove(index);
                Value::Null
            }
            _ => return Err(invalid("Unsupported content operation.")),
        };
        self.validate()?;
        Ok(result)
    }
}

#[derive(Clone, Serialize)]
pub struct Published {
    pub revision: String,
    pub content: Operations,
}

pub struct OperationsStore {
    directory: PathBuf,
    branch: String,
    write: Mutex<()>,
    published: RwLock<Published>,
    last_failure: RwLock<Option<String>>,
    last_push: RwLock<Option<Value>>,
}

async fn git(directory: &Path, args: &[&str]) -> Result<String, ContentError> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(directory)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    // Give hooks/SSH their own group so a timeout cannot leave a late commit running.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let child = command
        .spawn()
        .map_err(|_| unavailable("Cannot run Git in the configured content repository."))?;
    let pid = child.id();
    let seconds = if matches!(args.first(), Some(&"push" | &"ls-remote")) {
        20
    } else {
        5
    };
    let output =
        match tokio::time::timeout(Duration::from_secs(seconds), child.wait_with_output()).await {
            Ok(result) => result.map_err(|_| unavailable("Cannot read Git output."))?,
            Err(_) => {
                #[cfg(unix)]
                if let Some(pid) = pid {
                    let _ = Command::new("kill")
                        .args(["-KILL", "--", &format!("-{pid}")])
                        .status()
                        .await;
                }
                return Err(unavailable(
                    "Git timed out. Publication was not confirmed; refresh status before retrying.",
                ));
            }
        };
    if !output.status.success() {
        return Err(unavailable("Git operation failed. Check repository status, hooks, identity and remote access on the server. No success is assumed."));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| invalid("Content repository must contain UTF-8 data."))
}

impl OperationsStore {
    pub async fn open(directory: PathBuf) -> Result<Self, ContentError> {
        let directory = tokio::fs::canonicalize(directory)
            .await
            .map_err(|_| unavailable("Content repository does not exist."))?;
        if PathBuf::from(
            git(&directory, &["rev-parse", "--show-toplevel"])
                .await?
                .trim(),
        ) != directory
        {
            return Err(invalid(
                "LIVE_CONTENT_REPO must be the root of a dedicated Git checkout.",
            ));
        }
        // A separate checkout is mandatory; never publish or push the application repository.
        if directory.join("package.json").exists()
            || directory.join("Cargo.toml").exists()
            || directory.join("server/Cargo.toml").exists()
        {
            return Err(invalid("LIVE_CONTENT_REPO must be a dedicated content checkout, not an application repository."));
        }
        let branch = git(&directory, &["symbolic-ref", "--short", "HEAD"])
            .await?
            .trim()
            .to_owned();
        let revision = git(&directory, &["rev-parse", "HEAD"])
            .await?
            .trim()
            .to_owned();
        let content = Self::read(&directory, &revision).await?;
        Ok(Self {
            directory,
            branch,
            write: Mutex::new(()),
            published: RwLock::new(Published { revision, content }),
            last_failure: RwLock::new(None),
            last_push: RwLock::new(None),
        })
    }
    async fn read(directory: &Path, revision: &str) -> Result<Operations, ContentError> {
        if revision.len() != 40 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid("Use a full Git commit SHA."));
        }
        let entry = git(directory, &["ls-tree", revision, "--", FILE]).await?;
        if !entry.starts_with("100644 blob ") && !entry.starts_with("100755 blob ") {
            return Err(invalid(
                "Committed operations.json must be a regular file, not a symlink.",
            ));
        }
        let object = format!("{revision}:{FILE}");
        let size = git(directory, &["cat-file", "-s", &object])
            .await?
            .trim()
            .parse::<usize>()
            .unwrap_or(usize::MAX);
        if size > 1_000_000 {
            return Err(invalid("Operations content exceeds 1 MB."));
        }
        let content: Operations = serde_json::from_str(&git(directory, &["show", &object]).await?)
            .map_err(|_| invalid("Committed operations.json is not valid content JSON."))?;
        content.validate()?;
        Ok(content)
    }
    async fn writer(&self) -> Result<tokio::sync::MutexGuard<'_, ()>, ContentError> {
        tokio::time::timeout(Duration::from_secs(5), self.write.lock()).await
            .map_err(|_| unavailable("Another publication operation is still running. Keep your draft and refresh status shortly."))
    }
    pub fn snapshot(&self) -> Published {
        self.published.read().unwrap().clone()
    }
    async fn head(&self) -> Result<String, ContentError> {
        if git(&self.directory, &["symbolic-ref", "--short", "HEAD"])
            .await?
            .trim()
            != self.branch
        {
            return Err((StatusCode::CONFLICT, "The content checkout's branch changed. Publication is paused; an operator must reconcile it with the configured branch without discarding edits.".into()));
        }
        Ok(git(&self.directory, &["rev-parse", "HEAD"])
            .await?
            .trim()
            .into())
    }
    async fn index_locked(&self) -> Result<bool, ContentError> {
        let path = git(&self.directory, &["rev-parse", "--git-path", "index.lock"]).await?;
        Ok(self.directory.join(path.trim()).exists())
    }
    async fn clean(&self, revision: &str) -> Result<(), ContentError> {
        if self.index_locked().await?
            || revision != self.snapshot().revision
            || self.head().await? != revision
            || !git(
                &self.directory,
                &["status", "--porcelain", "--untracked-files=normal"],
            )
            .await?
            .is_empty()
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub async fn reload(&self) -> Result<(), ContentError> {
        let _guard = self.writer().await?;
        let revision = self.head().await?;
        if revision != self.snapshot().revision {
            let content = Self::read(&self.directory, &revision).await?;
            *self.published.write().unwrap() = Published { revision, content };
        }
        Ok(())
    }
    async fn commit(
        &self,
        expected: &str,
        content: Operations,
        message: &str,
    ) -> Result<String, ContentError> {
        content.validate()?;
        let bytes = serde_json::to_vec_pretty(&content).unwrap();
        if bytes.len() > 1_000_000 {
            return Err(invalid("Operations content exceeds 1 MB."));
        }
        let temporary = self
            .directory
            .join(format!(".operations-{}.tmp", Uuid::new_v4()));
        let result = async {
            use tokio::io::AsyncWriteExt;
            let mut file = tokio::fs::File::create(&temporary).await?;
            file.write_all(&bytes).await?;
            file.sync_all().await?;
            // Recheck after writing the temporary file; do not replace an intervening edit.
            if self.head().await.map_err(|e| std::io::Error::other(e.1))? != expected {
                return Err(std::io::Error::other("HEAD changed"));
            }
            let exclude = format!(
                ":(exclude){}",
                temporary.file_name().unwrap().to_string_lossy()
            );
            let changed = git(
                &self.directory,
                &[
                    "status",
                    "--porcelain",
                    "--untracked-files=all",
                    "--",
                    ".",
                    &exclude,
                ],
            )
            .await
            .map_err(|e| std::io::Error::other(e.1))?;
            if !changed.is_empty()
                || self
                    .index_locked()
                    .await
                    .map_err(|e| std::io::Error::other(e.1))?
            {
                return Err(std::io::Error::other("Worktree changed or index locked"));
            }
            tokio::fs::rename(&temporary, self.directory.join(FILE)).await?;
            tokio::fs::File::open(&self.directory)
                .await?
                .sync_all()
                .await
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(temporary).await;
            let error = unavailable("Unable to write content or the checkout changed. No publication was confirmed; review the retained file and status before retrying.");
            *self.last_failure.write().unwrap() = Some(error.1.clone());
            return Err(error);
        }
        let result = async {
            git(&self.directory, &["add", "--", FILE]).await?;
            if self.head().await? != expected { return Err(conflict()); }
            git(&self.directory, &["commit", "-m", message, "--", FILE]).await?;
            let revision = self.head().await?;
            let committed = Self::read(&self.directory, &revision).await?;
            if serde_json::to_value(&committed).unwrap() != serde_json::to_value(&content).unwrap() {
                return Err(unavailable("A hook or concurrent edit changed the committed content. Refresh publication status."));
            }
            Ok(revision)
        }.await;
        let revision = match result {
            Ok(revision) => revision,
            Err(error) => {
                *self.last_failure.write().unwrap() = Some(error.1.clone());
                return Err(error);
            }
        };
        *self.last_failure.write().unwrap() = None;
        *self.published.write().unwrap() = Published {
            revision: revision.clone(),
            content,
        };
        Ok(revision)
    }
    pub async fn publish_editorial(
        &self,
        expected: &str,
        kind: &str,
        value: Value,
    ) -> Result<String, ContentError> {
        let _guard = self.writer().await?;
        self.clean(expected).await?;
        let mut content = self.snapshot().content;
        let editorial = content.editorial.as_mut().ok_or_else(|| {
            invalid("Initialize the complete editorial bundle in operations.json first.")
        })?;
        match kind {
            "event" => {
                editorial.event =
                    serde_json::from_value(value).map_err(|_| invalid("Invalid event content."))?
            }
            "site" => {
                editorial.site =
                    serde_json::from_value(value).map_err(|_| invalid("Invalid site content."))?
            }
            "wayfinding" => {
                editorial.wayfinding = serde_json::from_value(value)
                    .map_err(|_| invalid("Invalid directions content."))?
            }
            _ => return Err(invalid("Unknown public document.")),
        }
        content.validate()?;
        if serde_json::to_value(&content).unwrap()
            == serde_json::to_value(self.snapshot().content).unwrap()
        {
            return Ok(expected.into());
        }
        self.commit(expected, content, &format!("Live staff: publish {kind}"))
            .await
    }

    pub async fn apply_plan(
        &self,
        expected: &str,
        plan: &crate::planner::PlanInput,
    ) -> Result<String, ContentError> {
        let _guard = self.writer().await?;
        self.clean(expected).await?;
        let content = crate::planner::plan(&self.snapshot().content, plan)?;
        self.commit(
            expected,
            content,
            "Live staff: confirmed schedule adjustment",
        )
        .await
    }

    pub async fn mutate(
        &self,
        expected: &str,
        method: &str,
        kind: &str,
        id: Option<&str>,
        body: Value,
    ) -> Result<(Value, String), ContentError> {
        let _guard = self.writer().await?;
        self.clean(expected).await?;
        let before = self.snapshot();
        let mut content = before.content.clone();
        let result = content.mutate(method, kind, id, body)?;
        if serde_json::to_value(&content).unwrap() == serde_json::to_value(&before.content).unwrap()
        {
            return Ok((result, before.revision));
        }
        let revision = self
            .commit(expected, content, &format!("Live staff: {method} {kind}"))
            .await?;
        Ok((result, revision))
    }
    pub async fn restore(&self, expected: &str, target: &str) -> Result<String, ContentError> {
        let _guard = self.writer().await?;
        // Restore uses the HEAD shown in staff status, even if that HEAD is invalid.
        // This repairs a bad direct commit without a reset or throwing away edits.
        if self.index_locked().await?
            || self.head().await? != expected
            || !git(
                &self.directory,
                &["status", "--porcelain", "--untracked-files=all"],
            )
            .await?
            .is_empty()
        {
            return Err(conflict());
        }
        let content = Self::read(&self.directory, target).await?;
        git(
            &self.directory,
            &["merge-base", "--is-ancestor", target, expected],
        )
        .await
        .map_err(|_| invalid("Restore a commit from this branch's history."))?;
        if let Ok(current) = Self::read(&self.directory, expected).await {
            if serde_json::to_value(&content).unwrap() == serde_json::to_value(current).unwrap() {
                *self.published.write().unwrap() = Published {
                    revision: expected.into(),
                    content,
                };
                return Ok(expected.into());
            }
        }
        self.commit(
            expected,
            content,
            "Live staff: restore previous publication",
        )
        .await
    }
    pub async fn push(&self, expected: &str) -> Result<Value, ContentError> {
        let _guard = self.writer().await?;
        self.clean(expected).await?;
        let result = async {
            // Verify the actual push destination, including an explicit pushurl.
            let destinations = git(&self.directory, &["remote", "get-url", "--push", "--all", "origin"]).await?;
            let urls: Vec<_> = destinations.lines().collect();
            if urls.len() != 1 { return Err(invalid("Configure exactly one origin push destination before backing up.")); }
            // Push the checked revision, not a potentially moving HEAD. Never force.
            git(&self.directory, &["push", "origin", &format!("{expected}:refs/heads/{}", self.branch)]).await?;
            let remote = git(&self.directory, &["ls-remote", "--exit-code", "--refs", "--", urls[0], &format!("refs/heads/{}", self.branch)]).await?;
            if remote.split_whitespace().next() != Some(expected) {
                return Err(unavailable("Remote revision could not be verified. Do not assume the backup succeeded."));
            }
            Ok(serde_json::json!({"ok":true, "revision":expected, "verifiedAt":Utc::now().to_rfc3339()}))
        }.await;
        *self.last_push.write().unwrap() = Some(match &result {
            Ok(value) => value.clone(),
            Err(error) => {
                serde_json::json!({"ok":false, "revision":expected, "error":error.1, "attemptedAt":Utc::now().to_rfc3339()})
            }
        });
        result
    }
    pub async fn status(&self) -> Result<Value, ContentError> {
        let _guard = self.writer().await?;
        let published = self.snapshot();
        let mut issues = Vec::new();
        let head = match self.head().await {
            Ok(value) => Some(value),
            Err(error) => {
                issues.push(serde_json::json!({"kind":if error.0 == StatusCode::CONFLICT { "branch_changed" } else { "git_failure" }, "message":error.1}));
                None
            }
        };
        let locked = self.index_locked().await.ok();
        if locked == Some(true) {
            issues.push(serde_json::json!({"kind":"index_locked", "message":"Git's index is locked. A timed-out command may have left a lock. An operator must verify no Git process is running before removing a stale lock; the app never removes locks or staff edits."}));
        }
        let dirty = match git(
            &self.directory,
            &["status", "--porcelain", "--untracked-files=all"],
        )
        .await
        {
            Ok(value) => {
                if !value.is_empty() {
                    issues.push(serde_json::json!({"kind":"dirty", "message":"The checkout has uncommitted edits. Review and commit them on the server; this app will never discard them."}));
                }
                Some(!value.is_empty())
            }
            Err(error) => {
                issues.push(serde_json::json!({"kind":"git_failure", "message":error.1}));
                None
            }
        };
        if let Some(ref head) = head {
            if head != &published.revision {
                match Self::read(&self.directory, head).await {
                    Ok(_) => issues.push(serde_json::json!({"kind":"pending_reload", "message":"A valid commit is waiting for the publication poll (up to five seconds). Refresh shortly."})),
                    Err(error) => issues.push(serde_json::json!({"kind":"invalid_head", "message":error.1})),
                }
            }
        }
        let history = git(
            &self.directory,
            &["log", "-15", "--format=%H%x09%aI%x09%s", "--", FILE],
        )
        .await;
        let history: Vec<Value> = match history {
            Ok(value) => value.lines().filter_map(|line| {
                let mut p = line.splitn(3, '\t');
                Some(serde_json::json!({"revision":p.next()?, "date":p.next()?, "message":p.next()?}))
            }).collect(),
            Err(error) => {
                issues.push(serde_json::json!({"kind":"history_unavailable", "message":error.1}));
                Vec::new()
            }
        };
        Ok(serde_json::json!({
            "mode":"git", "revision":published.revision, "head":head, "dirty":dirty, "locked":locked,
            "branch":self.branch, "healthy":issues.is_empty(), "issues":issues, "history":history,
            "lastFailure":self.last_failure.read().unwrap().clone(),
            "lastPush":self.last_push.read().unwrap().clone()
        }))
    }
}
