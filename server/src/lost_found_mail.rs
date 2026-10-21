//! Private transactional receipt outbox. No provider deduplication guarantee is assumed.
use super::*;
#[cfg(test)]
#[path = "lost_found_mail_tests.rs"]
mod tests;

#[derive(Clone)]
pub struct MailConfig {
    pub status: &'static str,
    token: String,
    from: String,
    reply_to: String,
}
impl MailConfig {
    pub fn disabled() -> Self {
        Self {
            status: "not_configured",
            token: String::new(),
            from: String::new(),
            reply_to: String::new(),
        }
    }
    pub fn from_env(demo: bool) -> Self {
        Self::configured(
            !demo && std::env::var("LIVE_LOST_FOUND_MAIL_ENABLED").as_deref() == Ok("true"),
            std::env::var("POSTMARK_SERVER_TOKEN").unwrap_or_default(),
            std::env::var("LIVE_LOST_FOUND_MAIL_FROM").unwrap_or_default(),
            std::env::var("LIVE_LOST_FOUND_MAIL_REPLY_TO").unwrap_or_default(),
        )
    }
    fn configured(enabled: bool, token: String, from: String, reply_to: String) -> Self {
        let berkeley = |s: &str| {
            valid_email(s)
                && s.rsplit_once('@')
                    .is_some_and(|(_, d)| d.eq_ignore_ascii_case("berkeley.mt"))
        };
        let status = if !enabled || token.is_empty() || from.is_empty() || reply_to.is_empty() {
            "not_configured"
        } else if !berkeley(&from)
            || !berkeley(&reply_to)
            || token.len() > 500
            || token.chars().any(char::is_control)
        {
            "invalid_configuration"
        } else {
            "ready"
        };
        Self {
            status,
            token,
            from,
            reply_to,
        }
    }
    pub fn settings(&self) -> serde_json::Value {
        serde_json::json!({"status": self.status, "from": if self.status == "ready" { Some(&self.from) } else { None }, "replyTo": if self.status == "ready" { Some(&self.reply_to) } else { None }, "provider": "Postmark", "deliveryTracking": false})
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub state: String,
    pub revision: u32,
    pub attempts: u32,
    pub next_attempt: Option<i64>,
    pub updated_at: String,
    pub diagnostic: String,
    pub provider_id: Option<String>,
    pub history: Vec<MailAction>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAction {
    at: String,
    actor: String,
    action: String,
    note: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryMail {
    idempotency_key: String,
    revision: u32,
    action: String,
    note: String,
    #[serde(default)]
    confirm_duplicate_risk: bool,
}

pub fn initialize(db: &Connection) -> std::result::Result<(), rusqlite::Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS lf_outbox (
        report_id TEXT PRIMARY KEY REFERENCES lf_reports(id),
        state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER,
        updated_at TEXT NOT NULL, diagnostic TEXT NOT NULL DEFAULT '', provider_id TEXT
    );
    CREATE INDEX IF NOT EXISTS lf_outbox_due ON lf_outbox(state,next_attempt);
    CREATE TABLE IF NOT EXISTS lf_mail_actions (
        request_id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES lf_reports(id),
        request_hash TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL,
        action TEXT NOT NULL, note TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lf_mail_actions_report ON lf_mail_actions(report_id,at);
    UPDATE lf_outbox SET state='uncertain', diagnostic='interrupted_attempt',
        next_attempt=NULL, revision=revision+1 WHERE state='sending';",
    )
}
pub fn enqueue(db: &Connection, receipt: &str, state: &str) -> Result<()> {
    db.execute("INSERT INTO lf_outbox (report_id,state,next_attempt,updated_at) SELECT id,?2,?3,?4 FROM lf_reports WHERE receipt=?1",
        params![receipt, state, if state == "queued" { Some(Utc::now().timestamp()) } else { None }, Utc::now().to_rfc3339()]).map_err(|_| DB_ERROR)?;
    Ok(())
}
pub fn read(db: &Connection, id: &str) -> Result<Option<Delivery>> {
    let mut delivery = db.query_row("SELECT state,revision,attempts,next_attempt,updated_at,diagnostic,provider_id FROM lf_outbox WHERE report_id=?1", [id], |r| Ok(Delivery {
        state: r.get(0)?, revision: r.get(1)?, attempts: r.get(2)?, next_attempt: r.get(3)?, updated_at: r.get(4)?, diagnostic: r.get(5)?, provider_id: r.get(6)?, history: vec![],
    })).optional().map_err(|_| DB_ERROR)?;
    if let Some(ref mut delivery) = delivery {
        let mut stmt = db.prepare("SELECT at,actor,action,note FROM lf_mail_actions WHERE report_id=?1 ORDER BY at DESC,request_id DESC LIMIT 20").map_err(|_| DB_ERROR)?;
        delivery.history = stmt
            .query_map([id], |r| {
                Ok(MailAction {
                    at: r.get(0)?,
                    actor: r.get(1)?,
                    action: r.get(2)?,
                    note: r.get(3)?,
                })
            })
            .map_err(|_| DB_ERROR)?
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| DB_ERROR)?;
    }
    Ok(delivery)
}
pub fn public_state(db: &Connection, receipt: &str) -> Result<Option<String>> {
    db.query_row(
        "SELECT state FROM lf_outbox JOIN lf_reports ON report_id=id WHERE receipt=?1",
        [receipt],
        |r| r.get(0),
    )
    .optional()
    .map_err(|_| DB_ERROR)
}

struct Job {
    id: String,
    receipt: String,
    email: String,
    attempts: u32,
}
enum Outcome {
    Accepted(String),
    Retry(&'static str),
    Failed(&'static str),
    Uncertain(&'static str),
}

impl LostFoundStore {
    pub fn mail_settings(&self) -> serde_json::Value {
        self.mail.settings()
    }
    fn mail_action(&self, id: String, mut input: RetryMail, actor: String) -> Result<Report> {
        validate_uuid(&id)?;
        validate_uuid(&input.idempotency_key)?;
        input.note = input.note.trim().into();
        validate_text(
            &input.note,
            5,
            500,
            "Record the provider check or follow-up in 5–500 characters.",
        )?;
        if !["retry", "handled"].contains(&input.action.as_str()) {
            return Err((StatusCode::UNPROCESSABLE_ENTITY, "Choose retry or handled."));
        }
        let hash = fingerprint(&input)?;
        let mut db = self.db.lock().map_err(|_| DB_ERROR)?;
        let tx = db.transaction().map_err(|_| DB_ERROR)?;
        let previous: Option<(String, String, String)> = tx
            .query_row(
                "SELECT report_id,request_hash,actor FROM lf_mail_actions WHERE request_id=?1",
                [&input.idempotency_key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| DB_ERROR)?;
        if let Some(previous) = previous {
            return if previous == (id.clone(), hash, actor) {
                read_report(&tx, &id)
            } else {
                Err((StatusCode::CONFLICT, "This action key was already used."))
            };
        }
        let report = read_report(&tx, &id)?;
        let delivery = report.delivery.ok_or((
            StatusCode::CONFLICT,
            "This legacy report did not request confirmation mail.",
        ))?;
        if delivery.revision != input.revision
            || !["not_configured", "failed", "uncertain", "retry_wait"]
                .contains(&delivery.state.as_str())
        {
            return Err((
                StatusCode::CONFLICT,
                "Refresh delivery status before acting. Accepted or active jobs cannot be resent.",
            ));
        }
        let state = if input.action == "handled" {
            "handled"
        } else {
            if self.mail.status != "ready"
                || self.demo_mode
                || report.synthetic
                || delivery.attempts >= 10
            {
                return Err((StatusCode::CONFLICT, "Mail is unconfigured, synthetic, or has reached its attempt limit. Follow up manually."));
            }
            if delivery.state == "uncertain" && !input.confirm_duplicate_risk {
                return Err((StatusCode::CONFLICT, "Check provider activity first and explicitly acknowledge possible duplicate delivery."));
            }
            "queued"
        };
        let now = Utc::now().to_rfc3339();
        tx.execute("UPDATE lf_outbox SET state=?2,revision=revision+1,next_attempt=?3,updated_at=?4,diagnostic='staff_action' WHERE report_id=?1", params![id,state,if state == "queued" { Some(Utc::now().timestamp()) } else { None },now]).map_err(|_| DB_ERROR)?;
        tx.execute(
            "INSERT INTO lf_mail_actions VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                input.idempotency_key,
                id,
                hash,
                actor,
                now,
                input.action,
                input.note
            ],
        )
        .map_err(|_| DB_ERROR)?;
        let report = read_report(&tx, &id)?;
        tx.commit().map_err(|_| DB_ERROR)?;
        Ok(report)
    }
    fn claim_mail(&self) -> Result<Option<Job>> {
        if self.mail.status != "ready" || self.demo_mode {
            return Ok(None);
        }
        let mut db = self.db.lock().map_err(|_| DB_ERROR)?;
        let tx = db.transaction().map_err(|_| DB_ERROR)?;
        let job = tx.query_row("SELECT r.id,r.receipt,r.email,o.attempts FROM lf_outbox o JOIN lf_reports r ON r.id=o.report_id WHERE o.state IN ('queued','retry_wait') AND o.next_attempt<=?1 AND o.attempts<10 AND r.synthetic=0 ORDER BY o.next_attempt,r.id LIMIT 1", [Utc::now().timestamp()], |r| Ok(Job { id:r.get(0)?, receipt:r.get(1)?, email:r.get(2)?, attempts:r.get::<_,u32>(3)? + 1 })).optional().map_err(|_| DB_ERROR)?;
        if let Some(ref job) = job {
            tx.execute("UPDATE lf_outbox SET state='sending',attempts=attempts+1,revision=revision+1,next_attempt=NULL,updated_at=?2 WHERE report_id=?1", params![job.id,Utc::now().to_rfc3339()]).map_err(|_| DB_ERROR)?;
        }
        tx.commit().map_err(|_| DB_ERROR)?;
        Ok(job)
    }
    fn finish_mail(&self, job: &Job, outcome: Outcome) -> Result<()> {
        let (state, diagnostic, provider_id, next) = match outcome {
            Outcome::Accepted(id) => ("accepted", "provider_accepted", Some(id), None),
            Outcome::Retry(reason) if job.attempts < 5 => {
                let cap = (30u64 << job.attempts).min(3600);
                let jitter = Uuid::new_v4().as_u128() as u64 % cap;
                (
                    "retry_wait",
                    reason,
                    None,
                    Some(Utc::now().timestamp() + 30 + jitter as i64),
                )
            }
            Outcome::Retry(reason) | Outcome::Failed(reason) => ("failed", reason, None, None),
            Outcome::Uncertain(reason) => ("uncertain", reason, None, None),
        };
        self.db.lock().map_err(|_| DB_ERROR)?.execute("UPDATE lf_outbox SET state=?2,diagnostic=?3,provider_id=?4,next_attempt=?5,updated_at=?6,revision=revision+1 WHERE report_id=?1 AND state='sending' AND attempts=?7", params![job.id,state,diagnostic,provider_id,next,Utc::now().to_rfc3339(),job.attempts]).map_err(|_| DB_ERROR)?;
        Ok(())
    }
    async fn mail_tick(self: &Arc<Self>, client: &reqwest::Client, endpoint: &str) -> Result<bool> {
        let store = self.clone();
        let Some(job) = tokio::task::spawn_blocking(move || store.claim_mail())
            .await
            .map_err(|_| DB_ERROR)??
        else {
            return Ok(false);
        };
        // No visitor description, staff note, phone, name, or report id leaves the private DB.
        let outcome = send(client, endpoint, &self.mail, &job).await;
        let store = self.clone();
        tokio::task::spawn_blocking(move || store.finish_mail(&job, outcome))
            .await
            .map_err(|_| DB_ERROR)??;
        Ok(true)
    }
    pub fn start_mail_worker(self: Arc<Self>) {
        if self.mail.status != "ready" || self.demo_mode {
            return;
        }
        tokio::spawn(async move {
            let Ok(client) = mail_client() else {
                eprintln!("[lost-found] Receipt mail client unavailable; queued reports remain private and unsent.");
                return;
            };
            let mut failures = 0u32;
            loop {
                let result = self
                    .mail_tick(&client, "https://api.postmarkapp.com/email")
                    .await;
                if result.is_err() && failures == 0 {
                    eprintln!("[lost-found] Receipt outbox unavailable; restore private storage and review in-flight jobs before restart.");
                }
                failures = if result.is_err() {
                    (failures + 1).min(6)
                } else {
                    0
                };
                // One awaited request; max one job / 2 seconds. No unbounded task spawning.
                let cap = if failures == 0 {
                    2000
                } else {
                    (1000u64 << failures).min(60_000)
                };
                tokio::time::sleep(Duration::from_millis(
                    2000 + Uuid::new_v4().as_u128() as u64 % cap,
                ))
                .await;
            }
        });
    }
}
fn mail_client() -> std::result::Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
}
async fn send(client: &reqwest::Client, endpoint: &str, config: &MailConfig, job: &Job) -> Outcome {
    let result = client.post(endpoint).header("X-Postmark-Server-Token", &config.token).header("Accept", "application/json")
        .json(&serde_json::json!({"From":config.from,"ReplyTo":config.reply_to,"To":job.email,
            "Subject":"BMT lost-and-found report received",
            "TextBody":format!("Tournament staff received your private lost-and-found report.\n\nReceipt: {}\n\nKeep this reference when speaking with staff. This confirms receipt only, not a match, return, or promise of follow-up. If you did not submit a report, no action is required.",job.receipt),
            "MessageStream":"outbound","Tag":"lost-found-receipt","Metadata":{"receipt":job.receipt},"TrackOpens":false,"TrackLinks":"None"}))
        .send().await;
    let mut response = match result {
        Ok(r) => r,
        // Only a connection-stage failure is known not to have submitted a message.
        Err(e) if e.is_connect() => return Outcome::Retry("connection_failed"),
        Err(_) => return Outcome::Uncertain("transport_unknown"),
    };
    let status = response.status().as_u16();
    if status == 429 {
        return Outcome::Retry("provider_rate_limited");
    }
    if [401, 404, 413, 415, 422].contains(&status) {
        return Outcome::Failed("provider_rejected");
    }
    // Postmark documents that 500 loses the message "in most cases", not always.
    if status != 200 {
        return Outcome::Uncertain("provider_result_unknown");
    }
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 16 * 1024 => {
                bytes.extend_from_slice(&chunk)
            }
            Ok(None) => break,
            _ => return Outcome::Uncertain("invalid_acknowledgement"),
        }
    }
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Outcome::Uncertain("invalid_acknowledgement");
    };
    if body["ErrorCode"].as_u64() == Some(0) {
        if let Some(id) = body["MessageID"]
            .as_str()
            .filter(|id| Uuid::parse_str(id).is_ok())
        {
            return Outcome::Accepted(id.to_owned());
        }
    }
    Outcome::Uncertain("invalid_acknowledgement")
}

pub async fn action(
    State(store): State<Arc<LostFoundStore>>,
    access: Option<Extension<LostFoundAccess>>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<RetryMail>,
) -> Result<Json<Report>> {
    let access = authorize(access, true)?;
    if headers.get("X-Staff-Request").and_then(|v| v.to_str().ok()) != Some("1") {
        return Err((StatusCode::FORBIDDEN, "Staff request intent is required."));
    }
    tokio::task::spawn_blocking(move || store.mail_action(id, input, access.actor))
        .await
        .map_err(|_| DB_ERROR)?
        .map(Json)
}
