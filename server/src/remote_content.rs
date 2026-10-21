//! Opt-in remote-first publication. Only Git objects under content/ are interpreted;
//! there is no worktree, checkout, hook execution, reset, force push or app-file write.
use crate::{
    content::ContentError,
    operations::{Editorial, Operations, Published},
};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Mutex,
};

const LOADED: &str = "refs/live/loaded";
const PENDING: &str = "refs/live/pending";
const MAX_BUNDLE: usize = 25 * 1024 * 1024;
const JSON_FILES: [&str; 5] = [
    "manifest.json",
    "operations.json",
    "event.json",
    "site.json",
    "wayfinding.json",
];
type Files = BTreeMap<String, Vec<u8>>;
fn unavailable() -> ContentError {
    (StatusCode::SERVICE_UNAVAILABLE, "Remote publication not confirmed. Keep your draft; refresh publishing status. Check origin access/branch protection with a Super. No remote output or credentials are exposed.".into())
}
fn invalid() -> ContentError {
    (StatusCode::UNPROCESSABLE_ENTITY, "Invalid content bundle. Require manifest v1, operations/event/site/wayfinding JSON and bounded hash-named PNG/JPEG/WebP media only; check schemas, references and symlinks.".into())
}
fn conflict() -> ContentError {
    (StatusCode::CONFLICT, "Remote content changed or a retained draft is pending. Keep your editor draft, refresh and reconcile; retry or archive the retained publication explicitly.".into())
}
fn sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
}
#[derive(Clone)]
pub struct Bundle {
    pub published: Published,
    pub files: Files,
    pub digest: String,
}
#[derive(Default)]
struct Diagnostic {
    remote: Option<String>,
    checked_at: Option<String>,
    error: Option<String>,
}
pub struct RemoteStore {
    directory: PathBuf,
    branch: String,
    origin: String,
    writer: Mutex<()>,
    loaded: RwLock<Option<Arc<Bundle>>>,
    diagnostic: RwLock<Diagnostic>,
}

// Bound both execution and stdout. Never return stderr (it may contain URLs/secrets).
async fn git(
    directory: &Path,
    args: &[&str],
    input: Option<&[u8]>,
) -> Result<Vec<u8>, ContentError> {
    let mut command = Command::new("git");
    command
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "protocol.ext.allow=never",
            "-c",
            "commit.gpgSign=false",
        ])
        .args(args)
        .current_dir(directory)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command.spawn().map_err(|_| unavailable())?;
    let pid = child.id();
    let mut stdin = child.stdin.take().ok_or_else(unavailable)?;
    let stdout = child.stdout.take().ok_or_else(unavailable)?;
    let operation = async {
        let write = async {
            if let Some(input) = input {
                stdin.write_all(input).await?;
            }
            drop(stdin);
            Ok::<_, std::io::Error>(())
        };
        let read = async {
            let mut bytes = Vec::new();
            stdout
                .take((MAX_BUNDLE + 1) as u64)
                .read_to_end(&mut bytes)
                .await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let (_, bytes) = tokio::try_join!(write, read).map_err(|_| unavailable())?;
        if bytes.len() > MAX_BUNDLE {
            return Err(invalid());
        }
        if !child.wait().await.map_err(|_| unavailable())?.success() {
            return Err(unavailable());
        }
        Ok(bytes)
    };
    let result = tokio::time::timeout(Duration::from_secs(20), operation).await;
    if !matches!(result, Ok(Ok(_))) {
        #[cfg(unix)]
        if let Some(pid) = pid {
            let _ = Command::new("kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .status()
                .await;
        }
    }
    result.map_err(|_| unavailable())?
}
async fn text(
    directory: &Path,
    args: &[&str],
    input: Option<&[u8]>,
) -> Result<String, ContentError> {
    String::from_utf8(git(directory, args, input).await?)
        .map(|s| s.trim_end().to_owned())
        .map_err(|_| invalid())
}

impl RemoteStore {
    pub async fn open(
        directory: PathBuf,
        branch: String,
        allow_local: bool,
    ) -> Result<Self, ContentError> {
        if !directory.is_absolute()
            || tokio::fs::canonicalize(&directory)
                .await
                .map_err(|_| unavailable())?
                != directory
        {
            return Err(invalid());
        }
        if branch.is_empty()
            || branch.len() > 100
            || branch.starts_with('-')
            || !branch
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_/".contains(&b))
        {
            return Err(invalid());
        }
        text(
            &directory,
            &["check-ref-format", &format!("refs/heads/{branch}")],
            None,
        )
        .await?;
        if text(&directory, &["rev-parse", "--is-bare-repository"], None).await? != "true"
            || directory.join("index").exists()
            || directory.join("index.lock").exists()
        {
            return Err(invalid());
        }
        let origin = text(&directory, &["remote", "get-url", "--all", "origin"], None).await?;
        let github = origin
            .strip_prefix("https://github.com/")
            .or_else(|| origin.strip_prefix("git@github.com:"));
        let safe_github = github.is_some_and(|p| {
            p.split('/').count() == 2
                && p.split('/').all(|part| {
                    !part.is_empty()
                        && part != "."
                        && part != ".."
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                })
        });
        if !safe_github
            && !(allow_local && Path::new(&origin).is_absolute() && !origin.contains('\n'))
        {
            return Err(invalid());
        }
        let store = Self {
            directory,
            branch,
            origin,
            writer: Mutex::new(()),
            loaded: RwLock::new(None),
            diagnostic: RwLock::new(Diagnostic::default()),
        };
        store.config_guard().await?;
        if let Ok(revision) = store.reference(LOADED).await {
            let bundle = store.read(&revision).await?;
            *store.loaded.write().unwrap() = Some(Arc::new(bundle));
        }
        let result = store.reload().await;
        if store.loaded.read().unwrap().is_none() {
            result?;
        }
        Ok(store)
    }
    async fn reference(&self, name: &str) -> Result<String, ContentError> {
        let value = text(&self.directory, &["rev-parse", "--verify", name], None).await?;
        if !sha(&value) {
            return Err(invalid());
        }
        Ok(value)
    }
    async fn config_guard(&self) -> Result<(), ContentError> {
        if self.directory.join("index").exists()
            || self.directory.join("index.lock").exists()
            || self.directory.join("shallow").exists()
            || text(
                &self.directory,
                &["remote", "get-url", "--all", "origin"],
                None,
            )
            .await?
                != self.origin
            || text(
                &self.directory,
                &["remote", "get-url", "--push", "--all", "origin"],
                None,
            )
            .await?
                != self.origin
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub fn bundle(&self) -> Arc<Bundle> {
        self.loaded
            .read()
            .unwrap()
            .as_ref()
            .expect("validated before serving")
            .clone()
    }
    pub fn snapshot(&self) -> Published {
        self.bundle().published.clone()
    }
    async fn read(&self, revision: &str) -> Result<Bundle, ContentError> {
        if !sha(revision) {
            return Err(invalid());
        }
        let listing = text(
            &self.directory,
            &["ls-tree", "-r", "-l", revision, "--", "content/"],
            None,
        )
        .await?;
        let mut files = Files::new();
        let mut total = 0;
        for line in listing.lines() {
            let (entry, path) = line.split_once('\t').ok_or_else(invalid)?;
            let parts: Vec<_> = entry.split_whitespace().collect();
            let name = path.strip_prefix("content/").ok_or_else(invalid)?;
            if parts.len() != 4 || parts[0] != "100644" || parts[1] != "blob" || files.len() >= 237
            {
                return Err(invalid());
            }
            let size: usize = parts[3].parse().map_err(|_| invalid())?;
            total += size;
            if total > MAX_BUNDLE
                || size
                    > if name.starts_with("media/") {
                        crate::site::MAX_IMAGE_BYTES
                    } else {
                        1_000_000
                    }
            {
                return Err(invalid());
            }
            if !JSON_FILES.contains(&name)
                && media_mime(name).is_none()
                && !name
                    .strip_prefix("pages/")
                    .is_some_and(crate::pages::filename)
            {
                return Err(invalid());
            }
            let bytes = git(&self.directory, &["cat-file", "blob", parts[2]], None).await?;
            if bytes.len() != size {
                return Err(invalid());
            }
            files.insert(name.to_owned(), bytes);
        }
        validate(revision, files)
    }
    async fn fetch(&self) -> Result<String, ContentError> {
        self.config_guard().await?;
        text(
            &self.directory,
            &[
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                "origin",
                &format!("refs/heads/{}", self.branch),
            ],
            None,
        )
        .await?;
        let remote = self.reference("FETCH_HEAD").await?;
        let mut d = self.diagnostic.write().unwrap();
        d.remote = Some(remote.clone());
        d.checked_at = Some(chrono::Utc::now().to_rfc3339());
        Ok(remote)
    }
    async fn activate(&self, revision: &str) -> Result<(), ContentError> {
        let bundle = self.read(revision).await?;
        // The durable reference is the commit point; restart revalidates its objects.
        text(&self.directory, &["update-ref", LOADED, revision], None).await?;
        *self.loaded.write().unwrap() = Some(Arc::new(bundle));
        Ok(())
    }
    fn record<T>(&self, result: &Result<T, ContentError>) {
        self.diagnostic.write().unwrap().error = result.as_ref().err().map(|e| e.1.clone());
    }
    async fn lock(&self) -> Result<tokio::sync::MutexGuard<'_, ()>, ContentError> {
        tokio::time::timeout(Duration::from_secs(2), self.writer.lock())
            .await
            .map_err(|_| conflict())
    }
    pub async fn reload(&self) -> Result<(), ContentError> {
        let _guard = self.lock().await?;
        let result = async {
            let remote = self.fetch().await?;
            self.activate(&remote).await?;
            if self.reference(PENDING).await.ok().as_deref() == Some(&remote) {
                text(
                    &self.directory,
                    &["update-ref", "-d", PENDING, &remote],
                    None,
                )
                .await?;
            }
            Ok(())
        }
        .await;
        self.record(&result);
        result
    }
    async fn base(&self, expected: &str) -> Result<String, ContentError> {
        if self.reference(PENDING).await.is_ok() {
            return Err(conflict());
        }
        let remote = self.fetch().await?;
        // The content tree, not unrelated executable-code commits, is the CAS token.
        let base = self.read(expected).await.map_err(|_| conflict())?;
        let current = self.read(&remote).await?;
        if current.digest != base.digest {
            return Err(conflict());
        }
        Ok(remote)
    }
    pub async fn edit(
        &self,
        expected: &str,
        change: impl FnOnce(&mut Operations) -> Result<Value, ContentError>,
    ) -> Result<(Value, String), ContentError> {
        let _guard = self.lock().await?;
        let result = async {
            let parent = self.base(expected).await?;
            let mut bundle = self.read(&parent).await?;
            let value = change(&mut bundle.published.content)?;
            bundle.published.content.validate()?;
            let files = encode(&bundle.published.content, bundle.files)?;
            let revision = self.publish(&parent, files).await?;
            Ok((value, revision))
        }
        .await;
        self.record(&result);
        result
    }
    async fn tree(&self, entries: &[(String, String, String)]) -> Result<String, ContentError> {
        let input: String = entries
            .iter()
            .map(|(mode, object, name)| {
                format!(
                    "{mode} {} {object}\t{name}\n",
                    if mode == "040000" { "tree" } else { "blob" }
                )
            })
            .collect();
        text(&self.directory, &["mktree"], Some(input.as_bytes())).await
    }
    async fn publish(&self, parent: &str, files: Files) -> Result<String, ContentError> {
        let validated = validate(parent, files.clone())?;
        if self
            .read(parent)
            .await
            .is_ok_and(|b| b.digest == validated.digest)
        {
            self.activate(parent).await?;
            return Ok(parent.into());
        }
        let mut entries = Vec::new();
        let mut media = Vec::new();
        let mut pages = Vec::new();
        for (name, bytes) in files {
            let object = text(
                &self.directory,
                &["hash-object", "-w", "--stdin"],
                Some(&bytes),
            )
            .await?;
            if let Some(name) = name.strip_prefix("media/") {
                media.push(("100644".into(), object, name.into()));
            } else if let Some(name) = name.strip_prefix("pages/") {
                pages.push(("100644".into(), object, name.into()));
            } else {
                entries.push(("100644".into(), object, name));
            }
        }
        if !media.is_empty() {
            entries.push(("040000".into(), self.tree(&media).await?, "media".into()));
        }
        if !pages.is_empty() {
            entries.push(("040000".into(), self.tree(&pages).await?, "pages".into()));
        }
        let content_tree = self.tree(&entries).await?;
        // Preserve every unrelated root object byte-for-byte without ever checking it out.
        let root = git(&self.directory, &["ls-tree", "-z", parent], None).await?;
        let mut input = Vec::new();
        for entry in root.split(|b| *b == 0).filter(|v| !v.is_empty()) {
            let name = entry
                .splitn(2, |b| *b == b'\t')
                .nth(1)
                .ok_or_else(invalid)?;
            if name != b"content" {
                input.extend_from_slice(entry);
                input.push(0);
            }
        }
        input.extend_from_slice(format!("040000 tree {content_tree}\tcontent\0").as_bytes());
        let tree = text(&self.directory, &["mktree", "-z"], Some(&input)).await?;
        let revision = text(
            &self.directory,
            &[
                "commit-tree",
                &tree,
                "-p",
                parent,
                "-m",
                "Live: publish validated public content",
            ],
            None,
        )
        .await?;
        self.read(&revision).await?;
        // Retain before attempting network. Never serve this draft until the consumer confirms origin.
        text(
            &self.directory,
            &[
                "update-ref",
                PENDING,
                &revision,
                "0000000000000000000000000000000000000000",
            ],
            None,
        )
        .await?;
        self.send(&revision).await?;
        Ok(revision)
    }
    async fn send(&self, revision: &str) -> Result<(), ContentError> {
        self.config_guard().await?;
        self.read(revision).await?;
        text(
            &self.directory,
            &[
                "push",
                "origin",
                &format!("{revision}:refs/heads/{}", self.branch),
            ],
            None,
        )
        .await?;
        let remote = self.fetch().await?;
        if remote != revision {
            return Err(conflict());
        }
        self.activate(&remote).await?;
        text(
            &self.directory,
            &["update-ref", "-d", PENDING, revision],
            None,
        )
        .await?;
        Ok(())
    }
    pub async fn retry(&self, expected: &str) -> Result<Value, ContentError> {
        let _guard = self.lock().await?;
        if self.reference(PENDING).await? != expected {
            return Err(conflict());
        }
        let result = self
            .send(expected)
            .await
            .map(|()| json!({"ok":true,"revision":expected}));
        self.record(&result);
        result
    }
    pub async fn archive(&self, expected: &str) -> Result<(), ContentError> {
        let _guard = self.lock().await?;
        if self.reference(PENDING).await? != expected {
            return Err(conflict());
        }
        text(
            &self.directory,
            &[
                "update-ref",
                &format!("refs/live/drafts/{expected}"),
                expected,
            ],
            None,
        )
        .await?;
        text(
            &self.directory,
            &["update-ref", "-d", PENDING, expected],
            None,
        )
        .await?;
        Ok(())
    }
    pub async fn pending(&self) -> Result<Value, ContentError> {
        let _guard = self.lock().await?;
        let revision = self.reference(PENDING).await.map_err(|_| {
            (
                StatusCode::CONFLICT,
                "No retained draft is available. Refresh publication status.".into(),
            )
        })?;
        Ok(json!(self.read(&revision).await?.published))
    }
    pub async fn restore(&self, expected: &str, target: &str) -> Result<String, ContentError> {
        let _guard = self.lock().await?;
        let result = async {
            if self.reference(PENDING).await.is_ok() {
                return Err(conflict());
            }
            let parent = self.fetch().await?;
            if parent != expected || !sha(target) {
                return Err(conflict());
            }
            text(
                &self.directory,
                &["merge-base", "--is-ancestor", target, &parent],
                None,
            )
            .await
            .map_err(|_| conflict())?;
            let bundle = self.read(target).await?;
            self.publish(&parent, bundle.files).await
        }
        .await;
        self.record(&result);
        result
    }
    pub async fn upload(
        &self,
        mime: &str,
        bytes: &[u8],
    ) -> Result<crate::site::MediaAsset, ContentError> {
        let extension = crate::site::image_extension(mime, bytes).ok_or_else(invalid)?;
        if bytes.len() > crate::site::MAX_IMAGE_BYTES {
            return Err(invalid());
        }
        let _guard = self.lock().await?;
        let result = async {
            let previous_revision = self.snapshot().revision;
            let parent = self.base(&previous_revision).await?;
            let mut files = self.read(&parent).await?.files;
            let filename = format!("{:x}.{extension}", Sha256::digest(bytes));
            files.insert(format!("media/{filename}"), bytes.into());
            let revision = self.publish(&parent, files).await?;
            Ok(crate::site::MediaAsset {
                url: format!("/media/{filename}"),
                bytes: bytes.len() as u64,
                revision: Some(revision),
                previous_revision: Some(previous_revision),
            })
        }
        .await;
        self.record(&result);
        result
    }
    pub async fn status(&self) -> Result<Value, ContentError> {
        let _guard = self.lock().await?;
        let pending = self.reference(PENDING).await.ok();
        let guard_error = self.config_guard().await.err();
        let mut value = {
            let d = self.diagnostic.read().unwrap();
            json!({"mode":"remote", "revision":self.snapshot().revision, "remoteRevision":d.remote, "head":d.remote, "branch":self.branch, "checkedAt":d.checked_at, "pendingRevision":pending, "digest":self.bundle().digest, "lastFailure":d.error, "dirty":guard_error.is_some(), "locked":false, "healthy":d.error.is_none() && guard_error.is_none() && pending.is_none(), "issues":[]})
        };
        let mut issues = Vec::new();
        if let Some(error) = guard_error {
            issues.push(json!({"kind":"checkout", "message":error.1}));
        }
        if let Some(error) = value["lastFailure"].as_str() {
            issues.push(json!({"kind":"remote", "message":error}));
        }
        if pending.is_some() {
            issues.push(json!({"kind":"pending", "message":"A draft commit is retained, not confirmed live. Retry after resolving access/protection, or archive and reconcile with remote content. No automatic force push or PR bypass."}));
        }
        value["issues"] = json!(issues);
        let head = value["head"]
            .as_str()
            .unwrap_or(&self.snapshot().revision)
            .to_owned();
        let history = text(
            &self.directory,
            &["log", "-15", "--format=%H%x09%aI", &head, "--", "content/"],
            None,
        )
        .await?;
        value["history"] = json!(history.lines().filter_map(|line| line.split_once('\t')).map(|(revision,date)| json!({"revision":revision,"date":date,"message":"Public content revision"})).collect::<Vec<_>>());
        Ok(value)
    }
    pub fn settings(&self) -> Value {
        json!({"mode":"remote", "branch":self.branch, "path":"content/", "configuration":"Deployment-managed dedicated bare checkout and origin. No browser credential storage or branch changes.", "protection":"Normal fast-forward push only. Required-PR/signature/check rules may reject staff publishing; retain/export draft and merge using the authorized external workflow."})
    }
}

pub fn media_mime(path: &str) -> Option<&'static str> {
    let name = path.strip_prefix("media/")?;
    let (hash, extension) = name.split_once('.')?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    match extension {
        "png" => Some("image/png"),
        "jpg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}
fn encode(content: &Operations, mut files: Files) -> Result<Files, ContentError> {
    let editorial = content.editorial.as_ref().ok_or_else(invalid)?;
    let mut operations = content.clone();
    operations.editorial = None;
    operations.pages.clear();
    files.retain(|name, _| !name.starts_with("pages/"));
    for (name, source) in &content.pages {
        files.insert(format!("pages/{name}"), source.as_bytes().to_vec());
    }
    for (name, value) in [
        ("operations.json", json!(operations)),
        ("event.json", json!(editorial.event)),
        ("site.json", json!(editorial.site)),
        ("wayfinding.json", json!(editorial.wayfinding)),
    ] {
        if files
            .get(name)
            .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
            .as_ref()
            != Some(&value)
        {
            files.insert(
                name.into(),
                serde_json::to_vec_pretty(&value).map_err(|_| invalid())?,
            );
        }
    }
    Ok(files)
}
fn validate(revision: &str, files: Files) -> Result<Bundle, ContentError> {
    let parse = |name| -> Result<Value, ContentError> {
        serde_json::from_slice(files.get(name).ok_or_else(invalid)?).map_err(|_| invalid())
    };
    let manifest: Manifest =
        serde_json::from_value(parse("manifest.json")?).map_err(|_| invalid())?;
    if manifest.schema_version != 1
        || files.len() > 237
        || files.values().map(Vec::len).sum::<usize>() > MAX_BUNDLE
    {
        return Err(invalid());
    }
    let mut content: Operations =
        serde_json::from_value(parse("operations.json")?).map_err(|_| invalid())?;
    if content.editorial.is_some() || !content.pages.is_empty() {
        return Err(invalid());
    }
    content.editorial = Some(Editorial {
        event: serde_json::from_value(parse("event.json")?).map_err(|_| invalid())?,
        site: serde_json::from_value(parse("site.json")?).map_err(|_| invalid())?,
        wayfinding: serde_json::from_value(parse("wayfinding.json")?).map_err(|_| invalid())?,
    });
    for (name, bytes) in &files {
        if let Some(name) = name.strip_prefix("pages/") {
            if !crate::pages::filename(name) {
                return Err(invalid());
            }
            content.pages.insert(
                name.into(),
                String::from_utf8(bytes.clone()).map_err(|_| invalid())?,
            );
        }
    }
    crate::pages::validate(&content.pages)?;
    // Sanitize errors rather than returning authored data or arbitrary Git output.
    content.validate().map_err(|_| invalid())?;
    let mut digest = Sha256::new();
    for (name, bytes) in &files {
        if JSON_FILES.contains(&name.as_str()) {
            if bytes.len() > 1_000_000 {
                return Err(invalid());
            }
        } else if name.starts_with("pages/") {
            if bytes.len() > crate::pages::MAX_PAGE {
                return Err(invalid());
            }
        } else {
            let mime = media_mime(name).ok_or_else(invalid)?;
            let extension = crate::site::image_extension(mime, bytes).ok_or_else(invalid)?;
            if bytes.len() > crate::site::MAX_IMAGE_BYTES
                || name != &format!("media/{:x}.{extension}", Sha256::digest(bytes))
            {
                return Err(invalid());
            }
        }
        digest.update(name.as_bytes());
        digest.update([0]);
        digest.update(bytes);
        digest.update([0]);
    }
    if crate::pages::media_urls(&content.pages).iter().any(|url| {
        !files.contains_key(
            url.trim_start_matches('/')
                .split(['?', '#'])
                .next()
                .unwrap(),
        )
    }) || !media_references(&content, &files)
    {
        return Err(invalid());
    }
    Ok(Bundle {
        published: Published {
            revision: revision.into(),
            content,
        },
        files,
        digest: format!("{:x}", digest.finalize()),
    })
}

fn media_references(content: &Operations, files: &Files) -> bool {
    use pulldown_cmark::{Event, Options, Parser, Tag};

    // Only actual URL destinations are references. External HTTPS paths and ordinary
    // text mentioning /media/ must not require blobs in this repository. Markdown
    // parsing also resolves entities, escapes and reference-style destinations.
    let url = |value: &str| {
        value.strip_prefix("/media/").is_none_or(|name| {
            let name = name.split(['?', '#']).next().unwrap_or_default();
            files.contains_key(&format!("media/{name}"))
        })
    };
    let markdown = |value: &str| {
        Parser::new_ext(value, Options::all()).all(|event| match event {
            Event::Start(Tag::Image { dest_url, .. } | Tag::Link { dest_url, .. }) => {
                url(&dest_url)
            }
            _ => true,
        })
    };
    let Some(editorial) = &content.editorial else {
        return false;
    };
    let site = &editorial.site;
    let wayfinding = &editorial.wayfinding;
    std::iter::once(&site.branding.logo_url)
        .chain(std::iter::once(&site.hero.image_url))
        .chain(site.guide.sections.iter().map(|section| &section.image_url))
        .chain(
            wayfinding
                .buildings
                .iter()
                .flat_map(|b| &b.floors)
                .filter_map(|floor| floor.image.as_ref().map(|image| &image.url)),
        )
        .chain(
            wayfinding
                .graph
                .iter()
                .flat_map(|graph| &graph.maps)
                .filter_map(|map| map.image.as_ref().map(|image| &image.url)),
        )
        .all(|value| url(value))
        && site
            .guide
            .sections
            .iter()
            .map(|section| &section.markdown)
            .chain(site.help.iter().map(|block| &block.markdown))
            .chain(editorial.event.faqs.iter().map(|faq| &faq.answer))
            .chain(
                content
                    .announcements
                    .iter()
                    .map(|announcement| &announcement.body),
            )
            .all(|value| markdown(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Files {
        let mut files: Files = [
            ("manifest.json", r#"{"schemaVersion":1}"#),
            (
                "operations.json",
                r#"{"schedule":[],"delays":[],"announcements":[]}"#,
            ),
            ("event.json", include_str!("../../content/event.json")),
            ("site.json", include_str!("../../content/site.json")),
            (
                "wayfinding.json",
                include_str!("../../content/wayfinding.json"),
            ),
        ]
        .into_iter()
        .map(|(name, bytes)| (name.into(), bytes.as_bytes().into()))
        .collect();
        for entry in
            std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../content/media")).unwrap()
        {
            let entry = entry.unwrap();
            let name = format!("media/{}", entry.file_name().to_str().unwrap());
            files.insert(name, std::fs::read(entry.path()).unwrap());
        }
        files
    }

    #[test]
    fn external_media_urls_and_plain_text_do_not_require_local_blobs() {
        let mut files = fixture();
        let mut site: Value = serde_json::from_slice(&files["site.json"]).unwrap();
        site["hero"]["imageUrl"] = json!("https://example.org/media/photo.png");
        site["hero"]["imageAlt"] = json!("Synthetic external image");
        site["copy"]["example"] = json!("The /media/ directory is public, not a private inbox.");
        site["guide"]["sections"][0]["markdown"] = json!("![External](https://example.org/media/photo.png)\n\n`/media/not-an-image.png`\n\n[External][ref]\n\n[ref]: https://example.org/media/page");
        files.insert("site.json".into(), serde_json::to_vec(&site).unwrap());
        assert!(validate("synthetic", files).is_ok());
    }

    #[test]
    fn local_media_checks_cover_all_structured_images_and_rendered_markdown() {
        let mut png = vec![0; 33];
        png[..16].copy_from_slice(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
        let name = format!("media/{:x}.png", Sha256::digest(&png));
        for (file, pointer, markdown) in [
            ("site.json", "/branding/logoUrl", false),
            ("site.json", "/hero/imageUrl", false),
            ("site.json", "/guide/sections/0/imageUrl", false),
            ("site.json", "/guide/sections/0/markdown", true),
            ("site.json", "/help/0/markdown", true),
            ("wayfinding.json", "/buildings/0/floors/0/image/url", false),
            ("wayfinding.json", "/graph/maps/1/image/url", false),
            ("event.json", "/faqs/0/answer", true),
            ("operations.json", "/announcements/0/body", true),
        ] {
            let mut files = fixture();
            let mut document: Value = serde_json::from_slice(&files[file]).unwrap();
            if file == "site.json" {
                document["hero"]["imageAlt"] = json!("Synthetic pixel");
                document["guide"]["sections"][0]["imageAlt"] = json!("Synthetic pixel");
            }
            if file == "operations.json" {
                document["announcements"] = json!([{"id":"synthetic", "title":"Synthetic", "body":"Placeholder", "timestamp":"2026-10-20T10:00:00Z", "priority":"normal"}]);
            }
            *document.pointer_mut(pointer).unwrap() = json!(if markdown {
                format!("![Local](/{name}?version=one#top)")
            } else {
                format!("/{name}")
            });
            files.insert(file.into(), serde_json::to_vec(&document).unwrap());
            assert!(
                validate("synthetic", files.clone()).is_err(),
                "{file}{pointer}"
            );
            files.insert(name.clone(), png.clone());
            assert!(validate("synthetic", files).is_ok(), "{file}{pointer}");
        }
    }

    #[test]
    fn markdown_media_destinations_resolve_after_entities_and_reference_syntax() {
        for markdown in [
            "![Missing](/media/missing.png)",
            "![Missing][image]\n\n[image]: /media/missing.png",
            "![Missing](&#47;media/missing.png)",
            "[Missing](/media/missing.png)",
        ] {
            let mut files = fixture();
            let mut site: Value = serde_json::from_slice(&files["site.json"]).unwrap();
            site["guide"]["sections"][0]["markdown"] = json!(markdown);
            files.insert("site.json".into(), serde_json::to_vec(&site).unwrap());
            assert!(validate("synthetic", files).is_err(), "{markdown}");
        }
    }
}
