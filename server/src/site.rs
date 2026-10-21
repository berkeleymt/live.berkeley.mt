//! Public editorial content, independent of schedule/timer state. See docs/site-content.md.
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    middleware,
    response::Response,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::routes::AppState;

pub const MAX_SITE_BYTES: usize = 512 * 1024;
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
pub type SiteError = (StatusCode, String);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteConfig {
    pub schema_version: u32,
    pub branding: Branding,
    pub hero: Hero,
    pub navigation: Vec<SiteLink>,
    pub copy: BTreeMap<String, String>,
    pub guide: Guide,
    pub help: Vec<HelpBlock>,
    pub useful_links: Vec<SiteLink>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Branding {
    pub title: String,
    pub short_title: String,
    pub caption: String,
    pub logo_url: String,
    pub logo_alt: String,
    pub home_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hero {
    pub image_url: String,
    pub image_alt: String,
    pub location: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SiteLink {
    pub id: String,
    pub label: String,
    pub href: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Guide {
    pub title: String,
    pub intro: String,
    pub notice: String,
    pub sections: Vec<GuideSection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuideSection {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub image_url: String,
    pub image_alt: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HelpKind {
    Emergency,
    Wifi,
    InfoDesk,
    Restroom,
    Help,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HelpBlock {
    pub id: String,
    pub kind: HelpKind,
    pub title: String,
    pub markdown: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SiteDocument {
    pub revision: String,
    pub content: SiteConfig,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDocument {
    #[serde(flatten)]
    pub document: SiteDocument,
    pub reload_error: Option<String>,
}

fn text(value: &str, name: &str, max: usize, required: bool) -> Result<(), String> {
    if value.len() > max || (required && value.trim().is_empty()) || value.contains('\0') {
        return Err(format!(
            "{name} {}must be at most {max} bytes and contain no NUL characters.",
            if required { "is required and " } else { "" }
        ));
    }
    Ok(())
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn unique_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut seen = HashSet::new();
    for id in ids {
        if !safe_id(id) || !seen.insert(id) {
            return Err(
                "IDs must be unique within their list, 1–64 lowercase letters, digits or hyphens."
                    .into(),
            );
        }
    }
    Ok(())
}

fn https_url(value: &str) -> bool {
    if value.len() > 2048
        || value
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\')
    {
        return false;
    }
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn asset_filename(value: &str) -> bool {
    let Some((stem, extension)) = value.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= 100
        && stem
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        && matches!(extension, "png" | "jpg" | "jpeg" | "webp")
}

pub fn valid_image_url(value: &str) -> bool {
    value.is_empty()
        || https_url(value)
        || matches!(
            value,
            "/bmt-logo.svg" | "/favicon.svg" | "/bg-doodles.png" | "/campus-map.png"
        )
        || ["/media/", "/demo-guide/"]
            .iter()
            .any(|prefix| value.strip_prefix(prefix).is_some_and(asset_filename))
}

pub fn valid_link_url(value: &str) -> bool {
    if https_url(value) {
        return true;
    }
    let (path, anchor) = value.split_once('#').unwrap_or((value, ""));
    let known = matches!(
        path,
        "" | "/"
            | "/schedule"
            | "/updates"
            | "/guide"
            | "/help"
            | "/faq"
            | "/map"
            | "/directions"
            | "/rooms"
            | "/lookup"
            | "/lost-found"
            | "/lost-and-found"
            | "/staff/sign-in"
            | "/admin"
            | "/classic"
    );
    known && (!path.is_empty() || !anchor.is_empty()) && (anchor.is_empty() || safe_id(anchor))
}

fn image(url: &str, alt: &str) -> Result<(), String> {
    if !valid_image_url(url) {
        return Err("Images must use HTTPS, /media/<image>, /demo-guide/<image>, or a known bundled asset. SVG/HTML uploads and unsafe protocols are not allowed.".into());
    }
    text(alt, "Image description", 500, !url.is_empty())
}

impl SiteConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Unsupported site schemaVersion; expected 1.".into());
        }
        text(&self.branding.title, "Brand title", 200, true)?;
        text(&self.branding.short_title, "Short title", 120, true)?;
        text(&self.branding.caption, "Brand caption", 500, false)?;
        image(&self.branding.logo_url, &self.branding.logo_alt)?;
        if !valid_link_url(&self.branding.home_url) {
            return Err("Brand home URL must be HTTPS or a known site route.".into());
        }
        image(&self.hero.image_url, &self.hero.image_alt)?;
        text(&self.hero.location, "Location", 200, false)?;
        if self.navigation.len() > 20
            || self.useful_links.len() > 40
            || self.help.len() > 30
            || self.guide.sections.len() > 60
            || self.copy.len() > 500
        {
            return Err("Too many items: at most 20 navigation links, 40 useful links, 30 help blocks, 60 guide sections, and 500 copy keys.".into());
        }
        for links in [&self.navigation, &self.useful_links] {
            unique_ids(links.iter().map(|link| link.id.as_str()))?;
            for link in links {
                text(&link.label, "Link label", 200, true)?;
                if !valid_link_url(&link.href) {
                    return Err(format!(
                        "Link {} must be HTTPS or a known site route/anchor.",
                        link.id
                    ));
                }
            }
        }
        for (key, value) in &self.copy {
            if key.is_empty()
                || key.len() > 100
                || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.')
            {
                return Err("Copy keys must contain only letters, digits and dots (at most 100 characters).".into());
            }
            text(value, &format!("Copy {key}"), 4000, false)?;
        }
        text(&self.guide.title, "Guide title", 200, true)?;
        text(&self.guide.intro, "Guide introduction", 4000, false)?;
        text(&self.guide.notice, "Guide notice", 4000, false)?;
        unique_ids(
            self.guide
                .sections
                .iter()
                .map(|section| section.id.as_str()),
        )?;
        for section in &self.guide.sections {
            text(&section.title, "Section title", 200, true)?;
            text(&section.markdown, "Section Markdown", 30000, true)?;
            image(&section.image_url, &section.image_alt)?;
        }
        unique_ids(self.help.iter().map(|block| block.id.as_str()))?;
        for block in &self.help {
            text(&block.title, "Help title", 200, true)?;
            text(&block.markdown, "Help Markdown", 10000, true)?;
        }
        Ok(())
    }
}

fn read_bounded(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let file =
        fs::File::open(path).map_err(|_| "Content file is missing or unreadable.".to_string())?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read content file.".to_string())?;
    if bytes.len() > max {
        return Err(format!("Content file exceeds {max} bytes."));
    }
    Ok(bytes)
}

fn document(bytes: &[u8]) -> Result<SiteDocument, String> {
    let content: SiteConfig =
        serde_json::from_slice(bytes).map_err(|error| format!("Invalid site JSON: {error}"))?;
    content.validate()?;
    Ok(SiteDocument {
        revision: format!("{:x}", Sha256::digest(bytes)),
        content,
    })
}

pub struct SiteStore {
    pub remote: std::sync::OnceLock<std::sync::Arc<crate::remote_content::RemoteStore>>,
    path: PathBuf,
    media_dir: PathBuf,
    stored: Mutex<SiteDocument>,
    published: std::sync::atomic::AtomicBool,
}

impl SiteStore {
    /// Paths should be on durable storage. Put media outside source/Git, e.g. /var/lib/bmt-live/media.
    pub fn open(path: PathBuf, media_dir: PathBuf) -> Result<Self, String> {
        let stored = document(&read_bounded(&path, MAX_SITE_BYTES)?)?;
        fs::create_dir_all(&media_dir)
            .map_err(|_| "Cannot create the media directory.".to_string())?;
        Ok(Self {
            remote: std::sync::OnceLock::new(),
            path,
            media_dir,
            stored: Mutex::new(stored),
            published: std::sync::atomic::AtomicBool::new(false),
        })
    }

    pub fn media_dir(&self) -> &Path {
        &self.media_dir
    }

    pub fn snapshot(&self) -> SiteDocument {
        if let Some(remote) = self.remote.get() {
            let snapshot = remote.snapshot();
            return SiteDocument {
                revision: snapshot.revision,
                content: snapshot.content.editorial.unwrap().site,
            };
        }
        self.stored.lock().unwrap().clone()
    }

    /// A failed reload never changes the last-good public snapshot.
    pub fn publish(&self, content: SiteConfig, revision: String) {
        self.published
            .store(true, std::sync::atomic::Ordering::SeqCst);
        *self.stored.lock().unwrap() = SiteDocument { content, revision };
    }

    pub fn reload(&self) -> Result<SiteDocument, String> {
        if self.remote.get().is_some() || self.published.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(self.snapshot());
        }
        let mut stored = self.stored.lock().unwrap();
        let next = document(&read_bounded(&self.path, MAX_SITE_BYTES)?)?;
        *stored = next.clone();
        Ok(next)
    }

    pub fn save(&self, input: SiteDocument) -> Result<SiteDocument, SiteError> {
        if self.remote.get().is_some() || self.published.load(std::sync::atomic::Ordering::SeqCst) {
            return Err((
                StatusCode::CONFLICT,
                "Use the Git publication endpoint.".into(),
            ));
        }
        input
            .content
            .validate()
            .map_err(|error| (StatusCode::UNPROCESSABLE_ENTITY, error))?;
        let mut bytes = serde_json::to_vec_pretty(&input.content).map_err(|_| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                "Cannot serialize content.".into(),
            )
        })?;
        bytes.push(b'\n');
        if bytes.len() > MAX_SITE_BYTES {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Site content must be at most 512 KiB.".into(),
            ));
        }
        let mut stored = self.stored.lock().unwrap();
        let disk = read_bounded(&self.path, MAX_SITE_BYTES).map_err(|_| (StatusCode::CONFLICT, "The on-disk file is unreadable or too large. Repair it before saving; your draft has not been applied.".into()))?;
        if input.revision != stored.revision
            || input.revision != format!("{:x}", Sha256::digest(&disk))
        {
            return Err((StatusCode::CONFLICT, "Content changed on disk or in another editor. Your draft was not applied. Download your draft, load the latest version, and merge deliberately.".into()));
        }
        let temporary = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Cannot write the site file. Nothing was published; check directory permissions."
                    .into(),
            ));
        }
        // Rename is the commit point. Directory sync is best effort because some filesystems do not support it.
        if let Some(parent) = self.path.parent() {
            if let Ok(dir) = fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        *stored = SiteDocument {
            revision: format!("{:x}", Sha256::digest(&bytes)),
            content: input.content,
        };
        Ok(stored.clone())
    }

    fn upload(&self, mime: &str, bytes: &[u8]) -> Result<MediaAsset, SiteError> {
        let extension = image_extension(mime, bytes).ok_or((StatusCode::UNSUPPORTED_MEDIA_TYPE, "Upload a PNG, JPEG or WebP with a matching image content type. SVG, HTML and invalid signatures are not accepted.".into()))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Images must be 5 MiB or smaller.".into(),
            ));
        }
        let filename = format!("{}.{}", Uuid::new_v4(), extension);
        let path = self.media_dir.join(&filename);
        // Write out of the public filename, then rename: visitors never see partial uploads.
        let temporary = self.media_dir.join(format!(".{}.tmp", Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Image could not be stored. Check media directory permissions.".into(),
            ));
        }
        Ok(MediaAsset {
            url: format!("/media/{filename}"),
            bytes: bytes.len() as u64,
            ..Default::default()
        })
    }

    fn media(&self) -> Result<MediaList, SiteError> {
        if let Some(remote) = self.remote.get() {
            return Ok(MediaList {
                assets: remote
                    .bundle()
                    .files
                    .iter()
                    .filter(|(name, _)| name.starts_with("media/"))
                    .map(|(name, bytes)| MediaAsset {
                        url: format!("/{name}"),
                        bytes: bytes.len() as u64,
                        ..Default::default()
                    })
                    .collect(),
                truncated: false,
            });
        }
        let entries = fs::read_dir(&self.media_dir).map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Cannot read media directory.".into(),
            )
        })?;
        let mut assets = Vec::new();
        let mut truncated = false;
        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !asset_filename(&name) || !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            if assets.len() == 200 {
                truncated = true;
                break;
            }
            if let Ok(metadata) = entry.metadata() {
                assets.push(MediaAsset {
                    url: format!("/media/{name}"),
                    bytes: metadata.len(),
                    ..Default::default()
                });
            }
        }
        assets.sort_by(|a, b| a.url.cmp(&b.url));
        Ok(MediaList { assets, truncated })
    }
}

pub(crate) fn image_extension(mime: &str, bytes: &[u8]) -> Option<&'static str> {
    match mime {
        "image/png"
            if bytes.len() >= 33
                && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                && &bytes[8..16] == b"\0\0\0\rIHDR" =>
        {
            Some("png")
        }
        "image/jpeg"
            if bytes.len() >= 4
                && bytes.starts_with(b"\xff\xd8\xff")
                && bytes.ends_with(b"\xff\xd9") =>
        {
            Some("jpg")
        }
        "image/webp"
            if bytes.len() >= 20
                && bytes.starts_with(b"RIFF")
                && &bytes[8..12] == b"WEBP"
                && matches!(&bytes[12..16], b"VP8 " | b"VP8L" | b"VP8X")
                && u32::from_le_bytes(bytes[4..8].try_into().ok()?) as usize + 8 == bytes.len() =>
        {
            Some("webp")
        }
        _ => None,
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub url: String,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_revision: Option<String>,
}
#[derive(Serialize)]
pub struct MediaList {
    pub assets: Vec<MediaAsset>,
    pub truncated: bool,
}

/// Fail closed, even if legacy admin middleware allows an unset password.
/// Integrator: replace this one guard with the named-staff content-editor permission check.
fn authorize(state: &AppState, headers: &HeaderMap, mutation: bool) -> Result<(), SiteError> {
    if !crate::staff::can(state, headers, crate::staff::Capability::ContentWrite) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Staff sign-in is required to edit site content.".into(),
        ));
    }
    if mutation {
        if headers.get("x-site-editor").and_then(|v| v.to_str().ok()) != Some("1")
            || headers
                .get("sec-fetch-site")
                .is_some_and(|value| value == "cross-site")
        {
            return Err((
                StatusCode::FORBIDDEN,
                "Use the same-origin staff editor to save content.".into(),
            ));
        }
        if let Some(origin) = headers.get(header::ORIGIN) {
            let valid = origin
                .to_str()
                .ok()
                .and_then(|value| reqwest::Url::parse(value).ok())
                .is_some_and(|url| {
                    headers
                        .get(header::HOST)
                        .and_then(|host| host.to_str().ok())
                        .and_then(|host| {
                            reqwest::Url::parse(&format!("{}://{host}", url.scheme())).ok()
                        })
                        .is_some_and(|request_origin| request_origin.origin() == url.origin())
                });
            if !valid {
                return Err((
                    StatusCode::FORBIDDEN,
                    "Cross-origin editing is not allowed.".into(),
                ));
            }
        }
    }
    Ok(())
}

pub async fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
}

/// Apply only to /media ServeDir responses, not the SPA fallback. Do not serve the content directory.
pub async fn media_headers(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        "default-src 'none'; sandbox".parse().unwrap(),
    );
    response
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/api/site", get(get_site))
        .layer(middleware::map_response(no_store))
}

pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/site/editor",
            get(get_editor)
                .put(save_editor)
                .layer(DefaultBodyLimit::max(MAX_SITE_BYTES + 4096)),
        )
        .route(
            "/api/site/media",
            get(list_media)
                .post(upload_media)
                .layer(DefaultBodyLimit::max(MAX_IMAGE_BYTES)),
        )
        .layer(middleware::map_response(no_store))
}

async fn get_site(State(state): State<AppState>) -> Json<SiteDocument> {
    Json(state.site.snapshot())
}

async fn get_editor(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<EditorDocument>, SiteError> {
    authorize(&state, &headers, false)?;
    tokio::task::spawn_blocking(move || {
        let reload_error = state.site.reload().err();
        Json(EditorDocument {
            document: state.site.snapshot(),
            reload_error,
        })
    })
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot load site editor.".into(),
        )
    })
}

async fn save_editor(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SiteDocument>,
) -> Result<Json<SiteDocument>, SiteError> {
    authorize(&state, &headers, true)?;
    tokio::task::spawn_blocking(move || state.site.save(input))
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cannot save site content.".into(),
            )
        })?
        .map(Json)
}

async fn upload_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<(StatusCode, Json<MediaAsset>), SiteError> {
    authorize(&state, &headers, true)?;
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if let Some(remote) = state.site.remote.get() {
        return remote
            .upload(&mime, &bytes)
            .await
            .map(|asset| (StatusCode::CREATED, Json(asset)));
    }
    tokio::task::spawn_blocking(move || state.site.upload(&mime, &bytes))
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cannot upload image.".into(),
            )
        })?
        .map(|asset| (StatusCode::CREATED, Json(asset)))
}

async fn list_media(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MediaList>, SiteError> {
    authorize(&state, &headers, false)?;
    tokio::task::spawn_blocking(move || state.site.media())
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cannot list images.".into(),
            )
        })?
        .map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> SiteConfig {
        serde_json::from_str(include_str!("../../content/site.json")).unwrap()
    }
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("live-site-test-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            fs::write(
                path.join("site.json"),
                serde_json::to_vec_pretty(&fixture()).unwrap(),
            )
            .unwrap();
            Self(path)
        }
        fn store(&self) -> SiteStore {
            SiteStore::open(self.0.join("site.json"), self.0.join("media")).unwrap()
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn shipped_site_is_valid_and_rejects_unknown_schema() {
        let mut content = fixture();
        content.validate().unwrap();
        content.schema_version = 2;
        assert!(content.validate().is_err());
        let mut json = serde_json::to_value(fixture()).unwrap();
        json["privateRoster"] = serde_json::json!([]);
        assert!(serde_json::from_value::<SiteConfig>(json).is_err());
    }

    #[test]
    fn copy_limits_allow_old_documents_blanks_and_bounded_extensions() {
        let mut content = fixture();
        // No automatic server migration: old documents keep precisely their authored keys.
        content.copy.clear();
        content.copy.insert("rooms.title".into(), "".into());
        content
            .copy
            .insert("custom.future".into(), "Keep me".into());
        content.validate().unwrap();
        assert_eq!(content.copy["rooms.title"], "");
        for index in 0..498 {
            content
                .copy
                .insert(format!("custom.key{index}"), "Value".into());
        }
        content.validate().unwrap();
        content
            .copy
            .insert("custom.overflow".into(), "Value".into());
        assert!(content.validate().is_err());
        content.copy.remove("custom.overflow");
        content.copy.insert("rooms.title".into(), "x".repeat(4001));
        assert!(content.validate().is_err());
        for value in content.copy.values_mut() {
            *value = "x".repeat(2000);
        }
        let temp = Temp::new();
        let store = temp.store();
        let mut input = store.snapshot();
        input.content = content;
        // Aggregate size is checked by the file/HTTP publication boundary, not field validation.
        assert_eq!(
            store.save(input).unwrap_err().0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn unsafe_urls_and_duplicate_ids_are_rejected() {
        for url in [
            "javascript:alert(1)",
            "data:image/svg+xml,bad",
            "//evil.test/p.png",
            "/media/../site.json",
            "/media/x.svg",
            "https://staff:password@example.test/x.png",
            "https://example.test/\\x",
            "/demo-guide/a%2epng",
        ] {
            assert!(!valid_image_url(url), "{url}");
        }
        for url in [
            "/bmt-logo.svg",
            "/media/abcd.png",
            "/demo-guide/example.webp",
            "https://example.test/image.png",
        ] {
            assert!(valid_image_url(url), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "//evil.test",
            "/api/site",
            "/../../etc/passwd",
            "mailto:staff@example.test",
        ] {
            assert!(!valid_link_url(url), "{url}");
        }
        for url in [
            "/",
            "/schedule",
            "/updates",
            "/map",
            "/rooms",
            "/guide",
            "/faq",
            "/help",
            "/lost-found",
            "/classic",
            "/#schedule",
            "/guide#guide-before-you-arrive",
        ] {
            assert!(valid_link_url(url), "{url}");
            let mut content = fixture();
            content.navigation[0].href = url.into();
            content.validate().unwrap();
        }
        for url in [
            "/not-a-page",
            "/schedule/../admin",
            "/schedule#one#two",
            "/schedule?redirect=evil",
        ] {
            assert!(!valid_link_url(url), "{url}");
        }
        let mut content = fixture();
        content
            .guide
            .sections
            .push(content.guide.sections[0].clone());
        assert!(content.validate().is_err());
    }

    #[test]
    fn saves_are_persistent_and_stale_writers_conflict() {
        let temp = Temp::new();
        let store = temp.store();
        let stale = store.snapshot();
        let mut input = stale.clone();
        input.content.branding.title = "Synthetic test title".into();
        let saved = store.save(input).unwrap();
        assert_ne!(saved.revision, stale.revision);
        assert_eq!(store.save(stale).unwrap_err().0, StatusCode::CONFLICT);
        assert_eq!(temp.store().snapshot().revision, saved.revision);
        assert_eq!(
            temp.store().snapshot().content.branding.title,
            "Synthetic test title"
        );
        assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 2);
    }

    #[test]
    fn external_edits_invalidate_revision_and_invalid_reload_keeps_last_good() {
        let temp = Temp::new();
        let store = temp.store();
        let old = store.snapshot();
        let mut external = fixture();
        external.guide.title = "Edited directly".into();
        fs::write(
            temp.0.join("site.json"),
            serde_json::to_vec(&external).unwrap(),
        )
        .unwrap();
        assert_eq!(store.save(old).unwrap_err().0, StatusCode::CONFLICT);
        let good = store.reload().unwrap();
        fs::write(temp.0.join("site.json"), "{broken").unwrap();
        assert!(store.reload().is_err());
        assert_eq!(store.snapshot().revision, good.revision);
        assert_eq!(store.save(good).unwrap_err().0, StatusCode::CONFLICT);
    }

    #[test]
    fn failed_validation_and_missing_file_never_replace_last_good() {
        let temp = Temp::new();
        let store = temp.store();
        let before = fs::read(temp.0.join("site.json")).unwrap();
        let mut input = store.snapshot();
        input.content.guide.sections[0].image_url = "javascript:alert(1)".into();
        assert_eq!(
            store.save(input).unwrap_err().0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(fs::read(temp.0.join("site.json")).unwrap(), before);
        fs::remove_file(temp.0.join("site.json")).unwrap();
        assert!(store.reload().is_err());
        assert_eq!(
            store.save(store.snapshot()).unwrap_err().0,
            StatusCode::CONFLICT
        );
    }

    #[test]
    fn oversized_files_and_image_mismatches_are_rejected() {
        let temp = Temp::new();
        let store = temp.store();
        fs::write(temp.0.join("site.json"), vec![b' '; MAX_SITE_BYTES + 1]).unwrap();
        assert!(store.reload().is_err());
        for (mime, bytes) in [
            ("image/svg+xml", b"<svg></svg>".as_slice()),
            ("image/png", b"<html>bad</html>"),
            ("text/html", b"\xff\xd8\xff\xd9"),
        ] {
            assert_eq!(
                store.upload(mime, bytes).err().unwrap().0,
                StatusCode::UNSUPPORTED_MEDIA_TYPE
            );
        }
        let mut too_large = vec![0; MAX_IMAGE_BYTES + 1];
        too_large[0..3].copy_from_slice(b"\xff\xd8\xff");
        let len = too_large.len();
        too_large[len - 2..].copy_from_slice(b"\xff\xd9");
        assert_eq!(
            store.upload("image/jpeg", &too_large).err().unwrap().0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn uploads_have_random_names_and_are_listed_without_original_names() {
        let temp = Temp::new();
        let store = temp.store();
        let bytes = b"\xff\xd8\xff\xd9";
        let first = store.upload("image/jpeg", bytes).unwrap();
        let second = store.upload("image/jpeg", bytes).unwrap();
        assert_ne!(first.url, second.url);
        assert!(valid_image_url(&first.url));
        assert_eq!(store.media().unwrap().assets.len(), 2);
        assert_eq!(
            fs::read(
                store
                    .media_dir()
                    .join(first.url.trim_start_matches("/media/"))
            )
            .unwrap(),
            bytes
        );
    }
}
