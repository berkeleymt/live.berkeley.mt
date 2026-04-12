use std::sync::Arc;

use pulldown_cmark::{Parser, Options, html};

use crate::db::Db;
use crate::models::Announcement;

/// Convert markdown to HTML.
fn md_to_html(md: &str) -> String {
    let opts = Options::all();
    let parser = Parser::new_ext(md, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

/// Postmark configuration, read from environment variables at startup.
#[derive(Clone)]
pub struct PostmarkConfig {
    pub server_token: String,
    pub from_address: String,
    pub base_url: String, // public site URL for unsubscribe links
}

impl PostmarkConfig {
    /// Read from env vars. Returns None if POSTMARK_SERVER_TOKEN is not set
    /// (email sending is disabled).
    pub fn from_env() -> Option<Self> {
        let token = std::env::var("POSTMARK_SERVER_TOKEN").ok()?;
        if token.is_empty() {
            return None;
        }
        let from = std::env::var("POSTMARK_FROM_ADDRESS")
            .unwrap_or_else(|_| "noreply@berkeley.mt".to_string());
        let base = std::env::var("SITE_BASE_URL")
            .unwrap_or_else(|_| "https://live.berkeley.mt".to_string());
        Some(Self {
            server_token: token,
            from_address: from,
            base_url: base.trim_end_matches('/').to_string(),
        })
    }
}

/// Send notification emails for an announcement to all subscribers.
/// Runs as a background task (fire-and-forget from the route handler).
pub async fn send_announcement_emails(
    db: Arc<Db>,
    config: PostmarkConfig,
    announcement: Announcement,
) {
    // Guard: don't double-send
    if db.has_email_been_sent(&announcement.id) {
        return;
    }

    let subscribers = db.get_all_subscribers();
    if subscribers.is_empty() {
        return;
    }

    let client = reqwest::Client::new();
    let subject = format!("BmMT 2026: {}", announcement.title);
    let priority_label = if announcement.priority == "urgent" {
        "[URGENT] "
    } else {
        ""
    };

    // Build batch (Postmark supports up to 500 per batch call)
    let messages: Vec<serde_json::Value> = subscribers
        .iter()
        .map(|(email, unsub_token)| {
            let unsub_url = format!(
                "{}/api/email/unsubscribe?token={}",
                config.base_url, unsub_token
            );

            let body_html = md_to_html(&announcement.body);

            let html_body = format!(
                r#"<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#003262;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:18px">{}{}</h1>
  </div>
  <div style="border:1px solid #e0e0e0;border-top:none;padding:20px;border-radius:0 0 8px 8px;font-size:14px;line-height:1.6;color:#333">
    {}
  </div>
  <p style="margin:16px 0 0;font-size:12px;color:#888;text-align:center">
    <a href="{}" style="color:#888">Unsubscribe</a> from BmMT live updates
  </p>
</div>"#,
                priority_label,
                html_escape(&announcement.title),
                body_html,
                unsub_url,
            );

            let text_body = format!(
                "{}{}\n\n{}\n\n---\nUnsubscribe: {}",
                priority_label, announcement.title, announcement.body, unsub_url
            );

            serde_json::json!({
                "From": config.from_address,
                "To": email,
                "Subject": format!("{}{}", priority_label, subject),
                "HtmlBody": html_body,
                "TextBody": text_body,
                "MessageStream": "outbound"
            })
        })
        .collect();

    // Send in batches of 500
    for chunk in messages.chunks(500) {
        let result = client
            .post("https://api.postmarkapp.com/email/batch")
            .header("X-Postmark-Server-Token", &config.server_token)
            .header("Content-Type", "application/json")
            .json(&chunk)
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                eprintln!(
                    "[email] Sent {} emails for announcement {}",
                    chunk.len(),
                    announcement.id
                );
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                eprintln!(
                    "[email] Postmark error {}: {}",
                    status, body
                );
            }
            Err(e) => {
                eprintln!("[email] Request failed: {}", e);
            }
        }
    }

    db.mark_email_sent(&announcement.id);
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
