//! Non-executable, bounded page authoring. Files are canonical in every publication mode.
use crate::{content::ContentError, routes::AppState};
use axum::{extract::State, http::StatusCode, Json};
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub type Files = BTreeMap<String, String>;
pub const MAX_PAGE: usize = 64 * 1024;
pub const MAX_TOTAL: usize = 512 * 1024;
pub const MAX_PAGES: usize = 32;
pub const BLOCKS: &[&str] = &[
    "now_next",
    "announcements",
    "urgent_updates",
    "subscribe",
    "schedule",
    "room_lookup",
    "map",
    "report_form",
];
fn invalid(message: impl Into<String>) -> ContentError {
    (StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn unavailable() -> ContentError {
    (StatusCode::SERVICE_UNAVAILABLE, "Cannot read or write page files. Keep your draft; check directory permissions and retained files.".into())
}
fn conflict() -> ContentError {
    (StatusCode::CONFLICT, "Page files changed. Your draft is retained; load the latest publication and reconcile before publishing.".into())
}
pub fn slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
pub fn anchor_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
pub fn filename(name: &str) -> bool {
    name.strip_suffix(".md").is_some_and(slug)
}
pub fn route(value: &str) -> bool {
    matches!(
        value,
        "/" | "/schedule"
            | "/updates"
            | "/map"
            | "/rooms"
            | "/guide"
            | "/faq"
            | "/help"
            | "/lost-found"
    ) || ["/pages/", "/guide/", "/help/"]
        .iter()
        .any(|prefix| value.strip_prefix(prefix).is_some_and(slug))
}
pub fn link(value: &str) -> bool {
    let (path, anchor) = value.split_once('#').unwrap_or((value, ""));
    crate::site::valid_link_url(value)
        || ((route(path) || (path.is_empty() && !anchor.is_empty()))
            && (anchor.is_empty() || anchor_id(anchor)))
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Meta {
    pub title: String,
    pub route: String,
    #[serde(default)]
    pub nav_label: String,
    #[serde(default)]
    pub nav_order: i32,
    #[serde(default)]
    pub nav_visible: bool,
    #[serde(default = "prose")]
    pub layout: String,
}
fn prose() -> String {
    "prose".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Part {
    Markdown { source: String },
    Block { name: String },
    Anchor { id: String },
    Button { label: String, href: String },
}
#[derive(Clone, Debug, Serialize)]
pub struct Page {
    pub meta: Meta,
    pub body: String,
    pub parts: Vec<Part>,
    pub headings: Vec<Heading>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Heading {
    pub id: String,
    pub title: String,
    pub part: usize,
}

pub fn parse(source: &str) -> Result<Page, ContentError> {
    if source.len() > MAX_PAGE || source.contains('\0') {
        return Err(invalid(
            "Each page must be at most 64 KiB, without NUL characters.",
        ));
    }
    let source = source.replace("\r\n", "\n");
    let rest = source.strip_prefix("+++\n").ok_or_else(|| {
        invalid("Start the file with +++ on its own line, followed by TOML frontmatter.")
    })?;
    let (front, body) = rest.split_once("\n+++\n").ok_or_else(|| {
        invalid("Close TOML frontmatter with +++ on its own line, followed by a newline.")
    })?;
    if front.len() > 4096 {
        return Err(invalid("Frontmatter must be at most 4 KiB."));
    }
    let meta: Meta =
        toml::from_str(front).map_err(|e| invalid(format!("Invalid TOML frontmatter: {e}")))?;
    if meta.title.trim().is_empty()
        || meta.title.len() > 200
        || meta.nav_label.len() > 100
        || (meta.nav_visible && meta.nav_label.trim().is_empty())
        || !(-1000..=1000).contains(&meta.nav_order)
        || !["prose", "wide"].contains(&meta.layout.as_str())
        || !route(&meta.route)
    {
        return Err(invalid("Use a title (1–200 bytes), navigation label (1–100 when visible), order -1000…1000, layout prose/wide and a public route: /, /guide, /help, other existing public destinations, or /pages/<slug>, /guide/<slug>, /help/<slug>. Reserved routes and aliases cannot be replaced."));
    }
    // Markdown parser resolves entity-encoded/reference destinations and bounds nesting.
    let mut depth = 0usize;
    let mut code_ranges = Vec::new();
    let mut standalone_ranges = Vec::new();
    for (event, range) in Parser::new_ext(
        body,
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS,
    )
    .into_offset_iter()
    {
        match event {
            Event::Start(tag) => {
                depth += 1;
                if depth > 16 {
                    return Err(invalid("Markdown nesting is limited to 16 levels."));
                }
                match tag {
                    Tag::Image { dest_url, .. }
                        if !crate::site::valid_image_url(&dest_url) || dest_url.is_empty() =>
                    {
                        return Err(invalid(
                            "Unsafe image URL. Use HTTPS or an existing /media/ image.",
                        ))
                    }
                    Tag::Link { dest_url, .. } if !link(&dest_url) => {
                        return Err(invalid(
                            "Unsafe link URL. Use HTTPS, a public route, or a simple #anchor.",
                        ))
                    }
                    Tag::CodeBlock(_) => code_ranges.push(range),
                    Tag::Paragraph if depth == 1 => standalone_ranges.push(range),
                    _ => {}
                }
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            Event::Html(_) | Event::InlineHtml(_) => {
                return Err(invalid(
                    "Raw HTML is disabled. Use Markdown or an allowlisted shortcode.",
                ))
            }
            Event::Code(_) => code_ranges.push(range),
            _ => {}
        }
    }
    let mut parts = Vec::new();
    let mut markdown = String::new();
    let mut offset = 0;
    let mut anchors = HashSet::new();
    let mut blocks = HashSet::new();
    for (index, line) in body.split_inclusive('\n').enumerate() {
        let template_outside_code = ["{{", "{%"].iter().any(|token| {
            line.match_indices(token).any(|(position, _)| {
                let at = offset + position;
                !code_ranges.iter().any(|r| r.start <= at && at < r.end)
            })
        });
        let trimmed = line.trim();
        if template_outside_code {
            if !markdown.is_empty() {
                parts.push(Part::Markdown {
                    source: std::mem::take(&mut markdown),
                });
            }
            let call = trimmed
                .strip_prefix("{{ ")
                .and_then(|s| s.strip_suffix(" }}"));
            let error = || {
                invalid(format!("Body line {}: use a standalone {{{{ now_next() }}}}, announcements(), urgent_updates(), subscribe(), schedule(), room_lookup(), map(), report_form(), anchor(id=\"stable-id\"), or button_link(label=\"Label\", href=\"/rooms\"). No nesting or executable templates.", index + 1))
            };
            // Splitting a list/quote/paragraph around a shortcode changes Markdown semantics.
            // Only a complete top-level paragraph may become an operational component.
            if !standalone_ranges.iter().any(|range| {
                range.start >= offset
                    && range.end <= offset + line.len()
                    && body[range.clone()].trim() == trimmed
            }) {
                return Err(error());
            }
            let call = call.ok_or_else(error)?;
            if let Some(name) = call.strip_suffix("()") {
                if !BLOCKS.contains(&name) || !blocks.insert(name.to_owned()) {
                    return Err(error());
                }
                parts.push(Part::Block { name: name.into() });
            } else if let Some(args) = call
                .strip_prefix("button_link(")
                .and_then(|s| s.strip_suffix(')'))
            {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Button {
                    label: String,
                    href: String,
                }
                #[derive(Deserialize)]
                struct Call {
                    button: Button,
                }
                let Call { button } =
                    toml::from_str(&format!("button = {{ {args} }}")).map_err(|_| error())?;
                if button.label.trim().is_empty()
                    || button.label.len() > 100
                    || button.href.len() > 2000
                    || !link(&button.href)
                {
                    return Err(error());
                }
                parts.push(Part::Button {
                    label: button.label,
                    href: button.href,
                });
            } else if let Some(args) = call
                .strip_prefix("anchor(")
                .and_then(|s| s.strip_suffix(')'))
            {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Anchor {
                    id: String,
                }
                let anchor: Anchor = toml::from_str(args).map_err(|_| error())?;
                if !anchor_id(&anchor.id)
                    || ["section-", "preview-", "lf-"]
                        .iter()
                        .any(|prefix| anchor.id.starts_with(prefix))
                    || ["main", "now-heading", "page-search"].contains(&anchor.id.as_str())
                    || !anchors.insert(anchor.id.clone())
                {
                    return Err(error());
                }
                parts.push(Part::Anchor { id: anchor.id });
            } else {
                return Err(error());
            }
        } else {
            markdown.push_str(line);
        }
        offset += line.len();
    }
    if !markdown.is_empty() {
        parts.push(Part::Markdown { source: markdown });
    }
    if parts.len() > 128 {
        return Err(invalid(
            "Use at most 128 Markdown/shortcode sections per page.",
        ));
    }
    let mut headings = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        if let Part::Markdown { source } = part {
            let mut current: Option<Heading> = None;
            for (event, range) in Parser::new_ext(
                source,
                Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS,
            )
            .into_offset_iter()
            {
                match event {
                    Event::Start(Tag::Heading { .. }) => {
                        current = Some(Heading {
                            id: format!(
                                "section-{index}-{}",
                                source[..range.start]
                                    .bytes()
                                    .filter(|b| *b == b'\n')
                                    .count()
                                    + 1
                            ),
                            title: String::new(),
                            part: index,
                        });
                    }
                    Event::Text(text) | Event::Code(text) => {
                        if let Some(h) = &mut current {
                            h.title.push_str(&text);
                        }
                    }
                    Event::End(pulldown_cmark::TagEnd::Heading(_)) => {
                        if let Some(h) = current.take() {
                            if headings.len() >= 128 {
                                return Err(invalid("A page can contain at most 128 headings."));
                            }
                            headings.push(h);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(Page {
        meta,
        body: body.into(),
        parts,
        headings,
    })
}
pub fn validate(files: &Files) -> Result<BTreeMap<String, Page>, ContentError> {
    if files.len() > MAX_PAGES || files.values().map(String::len).sum::<usize>() > MAX_TOTAL {
        return Err(invalid(
            "Use at most 32 pages and 512 KiB of page source in total.",
        ));
    }
    let mut routes = HashSet::new();
    files.iter().map(|(name, source)| {
        if !filename(name) { return Err(invalid("Page filenames must be <slug>.md (1–64 lowercase letters, digits or hyphens); no subdirectories.")); }
        let page = parse(source).map_err(|(code, message)| (code, format!("{name}: {message}")))?;
        if !routes.insert(page.meta.route.clone()) { return Err(invalid(format!("{name}: another page already uses this route."))); }
        Ok((name.clone(), page))
    }).collect()
}
pub fn media_urls(files: &Files) -> Vec<String> {
    files
        .values()
        .filter_map(|source| parse(source).ok())
        .flat_map(|page| {
            Parser::new_ext(&page.body, Options::all())
                .filter_map(|e| match e {
                    Event::Start(Tag::Image { dest_url, .. } | Tag::Link { dest_url, .. })
                        if dest_url.starts_with("/media/") =>
                    {
                        Some(dest_url.into_string())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}
pub fn check_media(files: &Files, directories: &[PathBuf]) -> Result<(), ContentError> {
    for url in media_urls(files) {
        let name = url
            .strip_prefix("/media/")
            .unwrap()
            .split(['?', '#'])
            .next()
            .unwrap();
        if !directories.iter().any(|dir| {
            fs::symlink_metadata(dir.join(name))
                .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
        }) {
            return Err(invalid(format!(
                "Missing local image {url}. Upload it in Site settings before publishing."
            )));
        }
    }
    Ok(())
}
pub fn digest(files: &Files) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(files).unwrap()))
}

// File mode: validate an entire directory before activation; a durable last-good cache
// survives bad direct edits/restart. API replacement uses staged regular files, no symlinks.
fn regular_read(path: &Path, limit: usize) -> Result<Vec<u8>, ContentError> {
    let meta = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit as u64 {
        return Err(invalid(
            "Page storage must contain bounded regular files, not symlinks.",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| unavailable())?
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() > limit {
        return Err(invalid("Page file is too large."));
    }
    Ok(bytes)
}
pub fn read_directory(path: &Path) -> Result<Files, ContentError> {
    let files = read_directory_unvalidated(path)?;
    validate(&files)?;
    Ok(files)
}
pub fn read_directory_unvalidated(path: &Path) -> Result<Files, ContentError> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Files::new()),
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {}
        _ => return Err(invalid("Pages must be a regular directory, not a symlink.")),
    }
    let mut files = Files::new();
    for entry in fs::read_dir(path).map_err(|_| unavailable())? {
        let entry = entry.map_err(|_| unavailable())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| invalid("Use ASCII page filenames."))?;
        if !filename(&name) || files.len() >= MAX_PAGES {
            return Err(invalid(
                "Only up to 32 <slug>.md files are allowed in pages/.",
            ));
        }
        let source = String::from_utf8(regular_read(&entry.path(), MAX_PAGE)?)
            .map_err(|_| invalid("Pages must be UTF-8."))?;
        files.insert(name, source);
    }
    Ok(files)
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), ContentError> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| unavailable())?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| unavailable())
}
pub fn write_directory(path: &Path, files: &Files) -> Result<(), ContentError> {
    fs::create_dir(path).map_err(|_| unavailable())?;
    for (name, source) in files {
        write_new(&path.join(name), source.as_bytes())?;
    }
    fs::File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|_| unavailable())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub revision: String,
    pub files: Files,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub revision: String,
    pub files: Files,
    pub pages: BTreeMap<String, Page>,
    pub reload_error: Option<String>,
}
pub fn document(
    revision: String,
    files: Files,
    reload_error: Option<String>,
) -> Result<Document, ContentError> {
    let pages = validate(&files)?;
    Ok(Document {
        revision,
        files,
        pages,
        reload_error,
    })
}
pub struct Store {
    path: PathBuf,
    media: Vec<PathBuf>,
    state: Mutex<(Files, Option<String>)>,
}
impl Store {
    pub fn open(path: PathBuf, media: Vec<PathBuf>) -> Result<Self, ContentError> {
        let parent = path.parent().ok_or_else(unavailable)?;
        // Resolve only the parent; reject symlinked storage components rather than following them.
        let absolute = std::path::absolute(parent).map_err(|_| unavailable())?;
        if fs::canonicalize(parent).map_err(|_| unavailable())? != absolute {
            return Err(invalid(
                "Page storage parent must not contain symlinks or traversal.",
            ));
        }
        let path = absolute.join(path.file_name().ok_or_else(unavailable)?);
        let store = Self {
            path,
            media,
            state: Mutex::new((Files::new(), None)),
        };
        let result = store.disk();
        match result {
            Ok(files) => {
                // A missing directory after an interrupted directory swap is not an intentional deletion.
                if !store.path.exists() && store.cache().exists() {
                    let cached: Files = serde_json::from_slice(&regular_read(
                        &store.cache(),
                        MAX_TOTAL * 6 + MAX_PAGES * 80,
                    )?)
                    .map_err(|_| unavailable())?;
                    validate(&cached)?;
                    check_media(&cached, &store.media)?;
                    *store.state.lock().unwrap() = (cached, Some("Page directory missing; serving last good pages. Restore the directory before publishing.".into()));
                } else {
                    *store.state.lock().unwrap() = (files, None);
                }
            }
            Err(error) => {
                let cached: Files = serde_json::from_slice(&regular_read(
                    &store.cache(),
                    MAX_TOTAL * 6 + MAX_PAGES * 80,
                )?)
                .map_err(|_| error.clone())?;
                validate(&cached)?;
                check_media(&cached, &store.media)?;
                *store.state.lock().unwrap() = (cached, Some(error.1));
            }
        }
        let current = store.state.lock().unwrap();
        if current.1.is_none() && store.path.exists() {
            store.retain(&current.0)?;
        }
        drop(current);
        Ok(store)
    }
    fn cache(&self) -> PathBuf {
        self.path.with_file_name(".pages-last-good.json")
    }
    fn disk(&self) -> Result<Files, ContentError> {
        let files = read_directory(&self.path)?;
        check_media(&files, &self.media)?;
        Ok(files)
    }
    fn retain(&self, files: &Files) -> Result<(), ContentError> {
        let temporary = self
            .path
            .with_file_name(format!(".pages-cache-{}", Uuid::new_v4()));
        write_new(&temporary, &serde_json::to_vec(files).unwrap())?;
        fs::rename(temporary, self.cache()).map_err(|_| unavailable())?;
        fs::File::open(self.path.parent().unwrap())
            .and_then(|f| f.sync_all())
            .map_err(|_| unavailable())
    }
    pub fn snapshot(&self) -> Result<Document, ContentError> {
        let state = self.state.lock().unwrap();
        document(digest(&state.0), state.0.clone(), state.1.clone())
    }
    pub fn reload(&self) -> Result<(), ContentError> {
        let mut state = self.state.lock().unwrap();
        let result = (|| {
            if !self.path.exists() && (!state.0.is_empty() || self.cache().exists()) {
                return Err(invalid("Pages directory is missing; last good pages remain live. Restore it rather than deleting the directory."));
            }
            let files = self.disk()?;
            if files != state.0 {
                self.retain(&files)?;
                state.0 = files;
            }
            Ok(())
        })();
        state.1 = result.as_ref().err().map(|e: &ContentError| e.1.clone());
        result
    }
    pub fn save(&self, input: Input) -> Result<Document, ContentError> {
        validate(&input.files)?;
        check_media(&input.files, &self.media)?;
        let mut state = self.state.lock().unwrap();
        if input.revision != digest(&state.0) || self.disk()? != state.0 || state.1.is_some() {
            return Err(conflict());
        }
        let temporary = self
            .path
            .with_file_name(format!(".pages-stage-{}", Uuid::new_v4()));
        write_directory(&temporary, &input.files)?;
        if self.disk()? != state.0 {
            return Err(conflict());
        }
        self.retain(&state.0)?;
        let old = self
            .path
            .with_file_name(format!(".pages-previous-{}", Uuid::new_v4()));
        if self.path.exists() {
            fs::rename(&self.path, &old).map_err(|_| unavailable())?;
        }
        if fs::rename(&temporary, &self.path).is_err() {
            if old.exists() {
                let _ = fs::rename(&old, &self.path);
            }
            return Err(unavailable());
        }
        fs::File::open(self.path.parent().unwrap())
            .and_then(|f| f.sync_all())
            .map_err(|_| unavailable())?;
        self.retain(&input.files)?;
        state.0 = input.files;
        state.1 = None;
        // Only this transaction's previous directory is removed; never an unrelated retained draft.
        if old.exists() {
            let _ = fs::remove_dir_all(old);
        }
        document(digest(&state.0), state.0.clone(), None)
    }
}

pub async fn get(State(state): State<AppState>) -> Result<Json<Document>, ContentError> {
    if let Some(store) = &state.operations {
        let snapshot = store.snapshot();
        return document(snapshot.revision, snapshot.content.pages, None).map(Json);
    }
    state
        .pages
        .as_ref()
        .ok_or_else(unavailable)?
        .snapshot()
        .map(Json)
}
pub async fn save(
    State(state): State<AppState>,
    Json(input): Json<Input>,
) -> Result<Json<Document>, ContentError> {
    validate(&input.files)?;
    if let Some(store) = &state.operations {
        if store.remote.is_none() {
            check_media(&input.files, &state.page_media)?;
        }
        let revision = store
            .publish_pages(&input.revision, input.files.clone())
            .await?;
        crate::publishing::sync_editorial(&state);
        return document(revision, input.files, None).map(Json);
    }
    tokio::task::spawn_blocking(move || state.pages.as_ref().ok_or_else(unavailable)?.save(input))
        .await
        .map_err(|_| unavailable())?
        .map(Json)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    source: String,
}
pub async fn preview(
    State(state): State<AppState>,
    Json(input): Json<Preview>,
) -> Result<Json<Page>, ContentError> {
    let page = parse(&input.source)?;
    let files = BTreeMap::from([("preview.md".into(), input.source)]);
    if let Some(remote) = state.operations.as_ref().and_then(|s| s.remote.as_ref()) {
        if media_urls(&files).iter().any(|url| {
            !remote
                .bundle()
                .files
                .contains_key(url.trim_start_matches('/'))
        }) {
            return Err(invalid(
                "Upload the referenced image in Site settings before previewing.",
            ));
        }
    } else {
        check_media(&files, &state.page_media)?;
    }
    Ok(Json(page))
}

/// Authored destinations have one editable source. Legacy fields remain readable for /classic.
pub fn guard_compat(state: &AppState, next: &crate::site::SiteConfig) -> Result<(), ContentError> {
    let files = if let Some(store) = &state.operations {
        store.snapshot().content.pages
    } else {
        state
            .pages
            .as_ref()
            .ok_or_else(unavailable)?
            .snapshot()?
            .files
    };
    let previous = state.site.snapshot().content;
    for page in validate(&files)?.values() {
        let changed = match page.meta.route.as_str() {
            "/guide" => {
                serde_json::to_value(&previous.guide).unwrap()
                    != serde_json::to_value(&next.guide).unwrap()
            }
            "/help" => {
                serde_json::to_value(&previous.help).unwrap()
                    != serde_json::to_value(&next.help).unwrap()
            }
            _ => false,
        };
        if changed {
            return Err(invalid(format!("{} is now an authored page. Edit Website content instead; legacy Guide/Help fields are read-only compatibility data.", page.meta.route)));
        }
    }
    Ok(())
}

pub fn guard_faq(
    state: &AppState,
    next: &crate::content::EventContent,
) -> Result<(), ContentError> {
    let files = if let Some(store) = &state.operations {
        store.snapshot().content.pages
    } else {
        state
            .pages
            .as_ref()
            .ok_or_else(unavailable)?
            .snapshot()?
            .files
    };
    if validate(&files)?
        .values()
        .any(|page| page.meta.route == "/faq")
        && serde_json::to_value(&state.content.snapshot().content.faqs).unwrap()
            != serde_json::to_value(&next.faqs).unwrap()
    {
        return Err(invalid("/faq is now an authored page. Edit Website content instead; legacy FAQs remain read-only compatibility data."));
    }
    Ok(())
}

#[cfg(test)]
fn source(title: &str, route: &str, label: &str, order: i32, body: &str) -> String {
    let meta = Meta {
        title: title.into(),
        route: route.into(),
        nav_label: label.into(),
        nav_order: order,
        nav_visible: true,
        layout: prose(),
    };
    format!("+++\n{}+++\n\n{}\n", toml::to_string(&meta).unwrap(), body)
}
fn plain(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| {
            if "\\`*_{}[]<>()#+-.!|>&".contains(c) {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect()
}
// Angle destinations preserve unbalanced parentheses; entities must remain literal URLs.
fn markdown_url(value: &str) -> String {
    format!(
        "<{}>",
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    )
}
fn destination(href: &str) -> &str {
    match href {
        "#today" | "/#today" => "/",
        "#schedule" | "/#schedule" => "/schedule",
        "#updates" | "/#updates" => "/updates",
        "#map" | "/#map" | "/directions" => "/map",
        "#help" | "/#help" => "/help",
        "#faq" | "/#faq" => "/faq",
        "/lookup" => "/rooms",
        "/lost-and-found" => "/lost-found",
        _ => href,
    }
}
/// Conversion is a preview only. Staff must explicitly publish it with the current CAS token.
pub fn conversion(site: &crate::site::SiteConfig, event: &crate::content::EventContent) -> Files {
    let mut guide = format!(
        "{{{{ anchor(id=\"guide-main\") }}}}\n\n{}\n\n{}\n",
        plain(&site.guide.intro),
        plain(&site.guide.notice)
    );
    for section in &site.guide.sections {
        guide.push_str(&format!(
            "\n{{{{ anchor(id=\"guide-{}\") }}}}\n\n## {}\n\n{}\n",
            section.id,
            plain(&section.title),
            section.markdown
        ));
        if !section.image_url.is_empty() {
            guide.push_str(&format!(
                "\n![{}]({})\n",
                plain(&section.image_alt),
                markdown_url(&section.image_url)
            ));
        }
    }
    guide.push_str("\n[Practical help](/help)\n");
    for link in &site.useful_links {
        guide.push_str(&format!(
            "\n- [{}]({})",
            plain(&link.label),
            markdown_url(&link.href)
        ));
    }
    let mut help = String::new();
    for block in &site.help {
        help.push_str(&format!(
            "\n{{{{ anchor(id=\"{}\") }}}}\n\n## {}\n\n{}\n",
            block.id,
            plain(&block.title),
            block.markdown
        ));
    }
    help.push_str("\n[Tournament guide](/guide) · [FAQ](/faq) · [Lost & found](/lost-found)\n");
    let text = |key: &str, fallback: &str| {
        site.copy
            .get(key)
            .cloned()
            .unwrap_or_else(|| fallback.into())
    };
    let mut home = format!(
        "**[{}](/rooms)**\n\n{}\n\n{{{{ urgent_updates() }}}}\n\n{{{{ now_next() }}}}\n",
        plain(&text("lookup.submit", "Find my rooms")),
        plain(&text("hub.intro", ""))
    );
    // Preserve every installed destination/label, not a new fixed set of choices.
    for item in &site.navigation {
        home.push_str(&format!(
            "\n- [{}]({})",
            plain(&item.label),
            markdown_url(destination(&item.href))
        ));
    }
    if !site.hero.image_url.is_empty() {
        home.push_str(&format!(
            "\n\n![{}]({})\n",
            plain(&site.hero.image_alt),
            markdown_url(&site.hero.image_url)
        ));
    }
    if !event.travel_url.is_empty() {
        home.push_str(&format!(
            "\n\n[{}]({})\n",
            plain(&text("quick.travelTitle", "Travel")),
            markdown_url(&event.travel_url)
        ));
    }
    let mut faq = String::new();
    for (index, item) in event.faqs.iter().enumerate() {
        faq.push_str(&format!(
            "\n{{{{ anchor(id=\"faq-{}\") }}}}\n\n## {}\n\n{}\n",
            index + 1,
            plain(&item.question),
            item.answer
        ));
    }
    if faq.is_empty() {
        faq = plain(&text(
            "faq.notPublished",
            "Answers have not been published yet. Ask staff for help.",
        ));
    }
    let mut map = plain(&text("map.intro", ""));
    if let Some(link) = site
        .useful_links
        .iter()
        .find(|link| link.id == "campus-map")
    {
        map.push_str(&format!(
            "\n\n[{}]({})",
            plain(&link.label),
            markdown_url(&link.href)
        ));
    }
    map.push_str("\n\n{{ map() }}\n");
    let report = format!(
        "{}\n\n## {}\n\n{}\n\n{}\n\n{{{{ report_form() }}}}",
        plain(&text("lostFound.intro", "")),
        plain(&text("lostFound.privacyTitle", "Private report")),
        plain(&text("lostFound.privacy", "")),
        plain(&text("lostFound.safety", ""))
    );
    let mut files = BTreeMap::new();
    for (name, route, title, body, wide) in [
        (
            "home",
            "/",
            text("hub.title", &site.branding.short_title),
            home,
            false,
        ),
        (
            "schedule",
            "/schedule",
            text("schedule.title", "Schedule"),
            "{{ schedule() }}".into(),
            false,
        ),
        (
            "updates",
            "/updates",
            text("updates.title", "Live updates"),
            "{{ announcements() }}\n\n{{ subscribe() }}".into(),
            false,
        ),
        ("map", "/map", text("map.title", "Map"), map, true),
        (
            "rooms",
            "/rooms",
            text("lookup.submit", "Find my rooms"),
            "{{ room_lookup() }}\n\n[Browse buildings and rooms](/map)".into(),
            false,
        ),
        ("guide", "/guide", site.guide.title.clone(), guide, false),
        ("faq", "/faq", text("help.faqTitle", "FAQ"), faq, false),
        ("help", "/help", text("help.title", "Help"), help, false),
        (
            "lost-found",
            "/lost-found",
            text("lostFound.title", "Lost & found"),
            report,
            false,
        ),
    ] {
        let nav = site
            .navigation
            .iter()
            .enumerate()
            .find(|(_, item)| destination(&item.href) == route);
        let meta = Meta {
            title: title.clone(),
            route: route.into(),
            nav_label: nav.map_or(title, |(_, item)| item.label.clone()),
            nav_order: nav.map_or(100, |(i, _)| i as i32 * 10),
            nav_visible: nav.is_some(),
            layout: if wide { "wide".into() } else { prose() },
        };
        files.insert(
            format!("{name}.md"),
            format!("+++\n{}+++\n\n{}\n", toml::to_string(&meta).unwrap(), body),
        );
    }
    files
}
pub async fn adopt(State(state): State<AppState>) -> Result<Json<Document>, ContentError> {
    let Json(current) = get(State(state.clone())).await?;
    if !current.files.is_empty() {
        return Err(invalid(
            "Pages already exist. Adoption never overwrites installed pages.",
        ));
    }
    let site = state.site.snapshot().content;
    let event = state.content.snapshot().content;
    let mut files = conversion(&site, &event);
    let wayfinding = state.wayfinding.snapshot().content;
    // Preserve installed room-page prose without baking the old page wrapper into a block.
    files
        .get_mut("rooms.md")
        .unwrap()
        .push_str(&format!("\n{}\n", plain(&wayfinding.intro)));
    let map = files.get_mut("map.md").unwrap();
    map.push_str(&format!("\n{}\n", plain(&wayfinding.help_text)));
    if !wayfinding.travel_url.is_empty() {
        map.push_str(&format!(
            "\n[{}]({})\n",
            plain(
                site.copy
                    .get("rooms.transit")
                    .map_or("Travel", String::as_str)
            ),
            markdown_url(&wayfinding.travel_url)
        ));
    }
    document(current.revision, files, None).map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn page(body: &str) -> String {
        source("Test page", "/guide", "Guide", 10, body)
    }
    fn files(body: &str) -> Files {
        BTreeMap::from([("guide.md".into(), page(body))])
    }
    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("live-pages-{}", Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn maintained_toml_and_markdown_parsers_accept_multiline_unicode_and_references() {
        let raw = "+++\n# comment\ntitle = '''A\nmultiline title'''\nroute = '/pages/visit'\nnav_visible = true\nnav_label = \"Visit \\u03b1\"\nnav_order = 1_0\n+++\n\n## A **heading**\n\n[help][dest]\n\n[dest]: /help\n\n{{ now_next() }}\n";
        let parsed = parse(raw).unwrap();
        assert_eq!(parsed.meta.nav_label, "Visit α");
        assert_eq!(parsed.meta.nav_order, 10);
        assert_eq!(parsed.headings[0].title, "A heading");
        assert!(parse(&page("Before `{{ unknown() }}` and `{% literal %}` after.")).is_ok());
        assert!(parse(&page("`literal` {{ now_next() }}")).is_err());
        assert!(parse(&page(&"# Heading\n\n".repeat(129))).is_err());
        assert!(matches!(&parsed.parts[1], Part::Block { name } if name == "now_next"));
        assert!(parse(&raw.replace("nav_order = 1_0", "nav_order = 1\nnav_order = 2")).is_err());
        assert!(parse(&raw.replace(
            "route = '/pages/visit'",
            "route = '/pages/visit'\nscript = 'bad'"
        ))
        .is_err());
    }
    #[test]
    fn button_links_are_bounded_data_not_templates() {
        let parsed = parse(&page(
            "{{ button_link(label=\"Find my rooms\", href=\"/rooms\") }}\n",
        ))
        .unwrap();
        assert_eq!(parsed.parts.iter().filter(|part| matches!(part, Part::Button { label, href } if label == "Find my rooms" && href == "/rooms")).count(), 1);
        for args in [
            "label=\"Bad\", href=\"javascript:alert(1)\"",
            "label=\"Bad\", href=\"//evil.test\"",
            "label=\"\", href=\"/rooms\"",
            "label=\"Bad\", href=\"/rooms\", onclick=\"run\"",
        ] {
            assert!(parse(&page(&format!("{{{{ button_link({args}) }}}}\n"))).is_err());
        }
    }
    #[test]
    fn rejects_unsafe_links_html_routes_templates_duplicates_and_limits() {
        for body in [
            "<script>alert(1)</script>",
            "<img src=x>",
            "[x](javascript:alert%281%29)",
            "[x](jav&#x61;script:bad)",
            "![x](/media/../secret.png)",
            "[x](//example.com)",
            "[x][ref]\n\n[ref]: data:text/html,bad",
            "{{ unknown() }}",
            "{{ schedule(limit=5) }}",
            "{{ schedule() }}\n\n{{ schedule() }}",
            "text {{ map() }}",
            "{% include 'x' %}",
            "{{ anchor(id=\"main\") }}",
            "{{ anchor(id=\"section-1-1\") }}",
            "{{ anchor(id=\"same\") }}\n{{ anchor(id=\"same\") }}",
        ] {
            assert!(parse(&page(body)).is_err(), "{body}");
        }
        for route in [
            "/admin",
            "/api",
            "/classic",
            "/media/a",
            "/staff/sign-in",
            "/lookup",
            "/directions",
            "/lost-and-found",
            "/pages/../admin",
            "/pages/a/b",
            "/pages/%2e%2e",
            "//example.com",
        ] {
            assert!(!super::route(route), "{route}");
        }
        assert!(parse(&page(&"x".repeat(MAX_PAGE))).is_err());
        assert!(parse(&page(&format!("{}deep", "> ".repeat(20)))).is_err());
        let mut duplicate = files("text");
        duplicate.insert("other.md".into(), page("other"));
        assert!(validate(&duplicate).is_err());
        assert!(!filename("../guide.md"));
        assert!(!filename("GUIDE.md"));
        assert!(parse(&page("```text\n{{ unknown() }}\n```\n")).is_ok());
    }
    #[test]
    fn rejects_shortcodes_inside_markdown_containers_and_reserved_ids() {
        for body in [
            "- item\n\n  {{ map() }}\n",
            "prose\n{{ map() }}\nmore prose",
            "{{ anchor(id=\"page-search\") }}",
            "{{ anchor(id=\"preview-example\") }}",
            "{{ anchor(id=\"lf-description\") }}",
        ] {
            assert!(parse(&page(body)).is_err(), "{body}");
        }
        assert!(parse(&page("```\n{{ map() }}\n```\n")).is_ok());
    }
    #[test]
    fn conversion_preserves_literal_text_and_url_destinations() {
        let mut site: crate::site::SiteConfig =
            serde_json::from_str(include_str!("../../content/site.json")).unwrap();
        let event = serde_json::from_str(include_str!("../../content/event.json")).unwrap();
        site.guide.intro = "Keep &copy; and > literal, not entities".into();
        let url = "https://example.org/image)unbalanced?x=&copy;";
        site.hero.image_url = url.into();
        site.hero.image_alt = "Installed &copy; image".into();
        site.useful_links[0].href = url.into();
        site.useful_links[0].label = "Installed &copy; link".into();
        site.validate().unwrap();
        let converted = conversion(&site, &event);
        let parsed = validate(&converted).unwrap();
        let destinations = |page: &Page| {
            Parser::new(&page.body)
                .filter_map(|event| match event {
                    Event::Start(Tag::Image { dest_url, .. } | Tag::Link { dest_url, .. }) => {
                        Some(dest_url.into_string())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
        };
        assert!(destinations(&parsed["home.md"]).contains(&url.to_owned()));
        assert!(destinations(&parsed["guide.md"]).contains(&url.to_owned()));
        let text = Parser::new(&parsed["guide.md"].body)
            .filter_map(|event| match event {
                Event::Text(value) => Some(value.into_string()),
                _ => None,
            })
            .collect::<String>();
        assert!(text.contains(&site.guide.intro), "{text}");
        assert!(text.contains(&site.useful_links[0].label), "{text}");
    }
    #[test]
    fn shipped_files_and_explicit_conversion_preserve_legacy_anchors() {
        for raw in [
            include_str!("../../content/pages/home.md"),
            include_str!("../../content/pages/guide.md"),
            include_str!("../../content/pages/schedule.md"),
            include_str!("../../content/pages/updates.md"),
            include_str!("../../content/pages/map.md"),
            include_str!("../../content/pages/rooms.md"),
            include_str!("../../content/pages/faq.md"),
            include_str!("../../content/pages/help.md"),
            include_str!("../../content/pages/lost-found.md"),
        ] {
            parse(raw).unwrap();
        }
        let mut site: crate::site::SiteConfig =
            serde_json::from_str(include_str!("../../content/site.json")).unwrap();
        let event = serde_json::from_str(include_str!("../../content/event.json")).unwrap();
        let legacy_nav = site
            .navigation
            .iter_mut()
            .find(|link| link.href == "/schedule")
            .unwrap();
        legacy_nav.href = "/#schedule".into();
        legacy_nav.label = "Installed schedule label".into();
        let converted = conversion(&site, &event);
        let schedule = parse(&converted["schedule.md"]).unwrap();
        assert!(schedule.meta.nav_visible);
        assert_eq!(schedule.meta.nav_label, "Installed schedule label");
        assert_eq!(converted.len(), 9);
        assert!(converted["faq.md"].contains("Where can I find my testing room?"));
        validate(&converted).unwrap();
        assert!(converted["guide.md"].contains("guide-before-you-arrive"));
        assert!(converted["guide.md"].contains("guide-main"));
        assert!(converted["help.md"].contains("anchor(id=\"wifi\")"));
    }
    #[test]
    fn recovery_cache_accounts_for_json_escaping_not_just_source_bytes() {
        let root = directory();
        let path = root.join("pages");
        let store = Store::open(path.clone(), vec![]).unwrap();
        let escaped: Files = (0..3)
            .map(|i| {
                (
                    format!("page-{i}.md"),
                    source(
                        "Title",
                        &format!("/pages/page-{i}"),
                        "Page",
                        0,
                        &"\u{1}".repeat(60_000),
                    ),
                )
            })
            .collect();
        let saved = store
            .save(Input {
                revision: store.snapshot().unwrap().revision,
                files: escaped,
            })
            .unwrap();
        assert!(fs::metadata(store.cache()).unwrap().len() > (MAX_TOTAL * 2) as u64);
        fs::write(path.join("page-0.md"), "invalid frontmatter").unwrap();
        drop(store);
        let recovered = Store::open(path, vec![]).unwrap().snapshot().unwrap();
        assert_eq!(recovered.files, saved.files);
        assert!(recovered.reload_error.is_some());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn file_publication_cas_direct_edits_and_last_good_survive_restart() {
        let root = directory();
        let path = root.join("pages");
        let store = Store::open(path.clone(), vec![]).unwrap();
        assert!(store.snapshot().unwrap().files.is_empty());
        assert!(!path.exists());
        let old = store.snapshot().unwrap().revision;
        let saved = store
            .save(Input {
                revision: old.clone(),
                files: files("first"),
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(path.join("guide.md")).unwrap(),
            page("first")
        );
        assert_eq!(
            store
                .save(Input {
                    revision: old,
                    files: files("stale")
                })
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        fs::write(path.join("guide.md"), page("direct edit")).unwrap();
        assert!(store
            .save(Input {
                revision: saved.revision,
                files: files("stale disk")
            })
            .is_err());
        store.reload().unwrap();
        let retained = store.snapshot().unwrap();
        fs::write(path.join("guide.md"), "bad frontmatter").unwrap();
        assert!(store.reload().is_err());
        assert_eq!(store.snapshot().unwrap().files, retained.files);
        drop(store);
        let restarted = Store::open(path.clone(), vec![]).unwrap();
        assert_eq!(restarted.snapshot().unwrap().files, retained.files);
        assert!(restarted.snapshot().unwrap().reload_error.is_some());
        fs::write(path.join("guide.md"), page("repaired")).unwrap();
        restarted.reload().unwrap();
        let repaired = restarted.snapshot().unwrap();
        restarted
            .save(Input {
                revision: repaired.revision,
                files: Files::new(),
            })
            .unwrap();
        assert!(path.exists());
        assert!(read_directory(&path).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_images_and_symlinks_cannot_publish() {
        assert!(check_media(&files("![image](/media/missing.png)"), &[]).is_err());
        let root = directory();
        let path = root.join("pages");
        fs::create_dir(&path).unwrap();
        fs::write(root.join("target"), page("safe")).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("target"), path.join("guide.md")).unwrap();
            assert!(read_directory(&path).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
