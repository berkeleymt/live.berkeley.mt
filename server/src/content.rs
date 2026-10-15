use std::{fs, path::PathBuf, sync::Mutex};

use axum::http::StatusCode;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
#[path = "content_tests.rs"]
mod tests;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventContent {
    pub title: String,
    pub date: String,
    pub time_zone: String,
    pub subtitle: String,
    pub notice: String,
    pub event_url: String,
    pub travel_url: String,
    pub faqs: Vec<Faq>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Faq {
    pub question: String,
    pub answer: String,
}

impl EventContent {
    fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() || self.title.len() > 120 {
            return Err("Event name is required (maximum 120 bytes).".into());
        }
        if self.date.len() != 10 || NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").is_err() {
            return Err("Use a valid event date in YYYY-MM-DD format.".into());
        }
        if self.time_zone != "America/Los_Angeles" {
            return Err("This campus event uses America/Los_Angeles time.".into());
        }
        if self.subtitle.len() > 500 || self.notice.len() > 1000 || self.faqs.len() > 50 {
            return Err(
                "Keep the subtitle under 500 bytes, notice under 1,000, and FAQs under 50.".into(),
            );
        }
        for (url, optional) in [(&self.event_url, false), (&self.travel_url, true)] {
            if url.is_empty() && optional {
                continue;
            }
            let parsed =
                reqwest::Url::parse(url).map_err(|_| "Links must be absolute HTTPS URLs.")?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err("Links must be HTTPS URLs without credentials.".into());
            }
        }
        for faq in &self.faqs {
            if faq.question.trim().is_empty()
                || faq.answer.trim().is_empty()
                || faq.question.len() > 300
                || faq.answer.len() > 10000
            {
                return Err(
                    "Each FAQ needs a question (up to 300 bytes) and answer (up to 10,000).".into(),
                );
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContentDocument {
    pub revision: String,
    pub content: EventContent,
}

struct StoredContent {
    document: ContentDocument,
    bytes: Vec<u8>,
}

pub struct ContentStore {
    path: PathBuf,
    stored: Mutex<StoredContent>,
}

pub type ContentError = (StatusCode, String);

fn read_content(path: &PathBuf) -> Result<(EventContent, Vec<u8>), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 100_000 {
        return Err("Event content must be smaller than 100 KB.".into());
    }
    let content: EventContent = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    content.validate()?;
    Ok((content, bytes))
}

impl ContentStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let (content, bytes) = read_content(&path)?;
        Ok(Self {
            path,
            stored: Mutex::new(StoredContent {
                document: ContentDocument {
                    revision: Uuid::new_v4().to_string(),
                    content,
                },
                bytes,
            }),
        })
    }

    pub fn snapshot(&self) -> ContentDocument {
        self.stored.lock().unwrap().document.clone()
    }

    // Valid direct file edits are loaded by the poller; invalid edits leave the last good content live.
    pub fn reload(&self) -> Result<ContentDocument, String> {
        let mut stored = self.stored.lock().unwrap();
        let (content, bytes) = read_content(&self.path)?;
        if bytes != stored.bytes {
            stored.document = ContentDocument {
                revision: Uuid::new_v4().to_string(),
                content,
            };
            stored.bytes = bytes;
        }
        Ok(stored.document.clone())
    }

    pub fn save(&self, input: ContentDocument) -> Result<ContentDocument, ContentError> {
        input
            .content
            .validate()
            .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))?;
        let bytes = serde_json::to_vec_pretty(&input.content).unwrap();
        if bytes.len() > 100_000 {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Event content must be smaller than 100 KB.".into(),
            ));
        }
        let mut stored = self.stored.lock().unwrap();
        let disk = fs::read(&self.path).map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Cannot read the content file. Nothing was saved.".into(),
            )
        })?;
        if input.revision != stored.document.revision || disk != stored.bytes {
            return Err((StatusCode::CONFLICT, "Content changed since you opened the editor. Copy your edits, then reload the file before trying again.".into()));
        }
        let temporary = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
            return Err((StatusCode::SERVICE_UNAVAILABLE, "Cannot write the content file. Nothing was published; check directory permissions.".into()));
        }
        stored.document = ContentDocument {
            revision: Uuid::new_v4().to_string(),
            content: input.content,
        };
        stored.bytes = bytes;
        Ok(stored.document.clone())
    }
}
