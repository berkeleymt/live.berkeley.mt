use super::*;
use serde_json::{json, Value};

// All provider traffic is loopback; these are deliberately fictional credentials/addresses.
fn config() -> MailConfig {
    MailConfig::configured(
        true,
        "synthetic-token".into(),
        "synthetic-sender@berkeley.mt".into(),
        "synthetic-reply@berkeley.mt".into(),
    )
}
fn input() -> SubmitReport {
    serde_json::from_value(json!({"idempotencyKey":Uuid::new_v4().to_string(),"kind":"lost","description":"Private synthetic item details","location":"Demo desk","occurredAt":"9 am Pacific","name":"Synthetic name","email":"fixture@example.invalid","phone":"555-0100","confirmationEmail":true})).unwrap()
}
fn store() -> Arc<LostFoundStore> {
    Arc::new(LostFoundStore::open_with_mail(":memory:", false, config()).unwrap())
}
fn report(store: &LostFoundStore) -> Report {
    store.list(ListQuery::default()).unwrap().reports.remove(0)
}
fn delivery(store: &LostFoundStore) -> Delivery {
    report(store).delivery.unwrap()
}
fn action(revision: u32, action: &str, confirm: bool) -> RetryMail {
    RetryMail {
        idempotency_key: Uuid::new_v4().to_string(),
        revision,
        action: action.into(),
        note: "Synthetic provider review completed".into(),
        confirm_duplicate_risk: confirm,
    }
}
struct Disk(std::path::PathBuf);
impl Disk {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("live-receipt-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> std::path::PathBuf {
        self.0.join("private.db")
    }
}
impl Drop for Disk {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn validates_explicit_berkeley_configuration_and_never_serializes_token() {
    assert_eq!(config().status, "ready");
    assert!(!config().settings().to_string().contains("synthetic-token"));
    for from in [
        "",
        "x@example.invalid",
        "x@sub.berkeley.mt",
        "Name <x@berkeley.mt>",
        "x@berkeley.mt\r\nBcc:y@example.invalid",
    ] {
        assert_ne!(
            MailConfig::configured(
                true,
                "token".into(),
                from.into(),
                "reply@berkeley.mt".into()
            )
            .status,
            "ready"
        );
    }
    assert_ne!(
        MailConfig::configured(
            true,
            "token".into(),
            "sender@berkeley.mt".into(),
            "reply@example.invalid".into()
        )
        .status,
        "ready"
    );
    assert_eq!(
        MailConfig::configured(
            false,
            "token".into(),
            "sender@berkeley.mt".into(),
            "reply@berkeley.mt".into()
        )
        .status,
        "not_configured"
    );
    assert_eq!(MailConfig::from_env(true).status, "not_configured");
}

#[test]
fn atomic_receipt_job_duplicate_concurrency_and_legacy_fingerprint() {
    let store = store();
    let input = input();
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let store = store.clone();
            let input = input.clone();
            std::thread::spawn(move || store.submit(input).unwrap().receipt)
        })
        .collect();
    let receipts: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(receipts.iter().all(|r| r == &receipts[0]));
    assert_eq!(store.list(ListQuery::default()).unwrap().total, 1);
    assert_eq!(delivery(&store).attempts, 0);
    assert_eq!(report(&store).phone, "555-0100");
    let public = serde_json::to_value(store.submit(input.clone()).unwrap()).unwrap();
    assert_eq!(public, json!({"receipt":receipts[0],"emailState":"queued"}));
    let mut changed = input.clone();
    changed.phone = "555-0199".into();
    assert_eq!(store.submit(changed).err().unwrap().0, StatusCode::CONFLICT);
    store.db.lock().unwrap().execute_batch("CREATE TRIGGER fail_enqueue BEFORE INSERT ON lf_outbox BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
    assert!(store.submit(super::tests::input()).is_err());
    assert_eq!(store.list(ListQuery::default()).unwrap().total, 1);
    store
        .db
        .lock()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_enqueue")
        .unwrap();
    // Original struct field order/hash is unchanged when new fields are omitted/defaulted.
    let legacy_text = format!("{{\"idempotencyKey\":\"{}\",\"kind\":\"lost\",\"description\":\"Synthetic legacy bottle\",\"location\":\"Desk\",\"occurredAt\":\"9 am\",\"name\":\"\",\"email\":\"legacy@example.invalid\"}}",Uuid::new_v4());
    let legacy: SubmitReport = serde_json::from_str(&legacy_text).unwrap();
    assert_eq!(
        fingerprint(&legacy).unwrap(),
        format!("{:x}", Sha256::digest(legacy_text.as_bytes()))
    );
    let result = store.submit(legacy.clone()).unwrap();
    assert_eq!(
        serde_json::to_value(&result)
            .unwrap()
            .as_object()
            .unwrap()
            .len(),
        1
    );
    assert!(public_state(&store.db.lock().unwrap(), &result.receipt)
        .unwrap()
        .is_none());
    assert_eq!(store.submit(legacy).unwrap().receipt, result.receipt);
}

#[test]
fn missing_configuration_and_demo_do_not_claim_or_backfill_mail() {
    for demo in [false, true] {
        let store = LostFoundStore::open_with_mail(
            ":memory:",
            demo,
            if demo {
                config()
            } else {
                MailConfig::disabled()
            },
        )
        .unwrap();
        assert_eq!(
            store.submit(input()).unwrap().email_state.as_deref(),
            Some("not_configured")
        );
        assert!(store.claim_mail().unwrap().is_none());
        let r = store
            .list(ListQuery {
                q: "Private synthetic".into(),
                ..Default::default()
            })
            .unwrap()
            .reports
            .remove(0);
        assert_eq!(
            store
                .mail_action(r.id, action(1, "retry", true), "staff".into())
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
    }
}

#[test]
fn demo_submissions_remain_ineligible_for_mail_after_mode_change() {
    let disk = Disk::new();
    let submitted = input();
    let receipt;
    {
        let store = LostFoundStore::open_with_mail(disk.path(), true, config()).unwrap();
        receipt = store.submit(submitted.clone()).unwrap().receipt;
    }
    let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
    let r = store
        .list(ListQuery {
            q: "Private synthetic".into(),
            ..Default::default()
        })
        .unwrap()
        .reports
        .remove(0);
    assert!(
        r.synthetic,
        "Demo submissions must retain their origin after restart"
    );
    assert_eq!(store.submit(submitted).unwrap().receipt, receipt);
    let revision = r.delivery.unwrap().revision;
    assert_eq!(
        store
            .mail_action(
                r.id.clone(),
                action(revision, "retry", true),
                "staff".into()
            )
            .unwrap_err()
            .0,
        StatusCode::CONFLICT
    );
    assert!(store.claim_mail().unwrap().is_none());
    let handled = store
        .mail_action(r.id, action(revision, "handled", false), "staff".into())
        .unwrap();
    assert_eq!(handled.delivery.unwrap().state, "handled");
}

#[test]
fn restart_persists_queued_and_accepted_but_never_retries_interrupted_send() {
    let disk = Disk::new();
    let input = input();
    let receipt;
    {
        let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
        receipt = store.submit(input.clone()).unwrap().receipt;
    }
    {
        let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
        assert_eq!(store.submit(input.clone()).unwrap().receipt, receipt);
        assert_eq!(delivery(&store).state, "queued");
        assert!(store.claim_mail().unwrap().is_some()); // crash before a durable result
    }
    {
        let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
        assert_eq!(delivery(&store).state, "uncertain");
        assert_eq!(delivery(&store).diagnostic, "interrupted_attempt");
        assert!(store.claim_mail().unwrap().is_none());
        let r = report(&store);
        let rev = r.delivery.unwrap().revision;
        assert!(store
            .mail_action(r.id.clone(), action(rev, "retry", false), "staff".into())
            .is_err());
        let a = action(rev, "retry", true);
        let body = serde_json::to_value(&a).unwrap();
        store.mail_action(r.id.clone(), a, "staff".into()).unwrap();
        store
            .mail_action(
                r.id.clone(),
                serde_json::from_value(body.clone()).unwrap(),
                "staff".into(),
            )
            .unwrap();
        assert_eq!(delivery(&store).history.len(), 1);
        assert!(store
            .mail_action(
                r.id.clone(),
                serde_json::from_value(body).unwrap(),
                "another-staff".into()
            )
            .is_err());
        assert!(store
            .mail_action(r.id.clone(), action(rev, "retry", true), "staff".into())
            .is_err());
        let job = store.claim_mail().unwrap().unwrap();
        store
            .finish_mail(&job, Outcome::Accepted(Uuid::new_v4().to_string()))
            .unwrap();
    }
    let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
    assert_eq!(delivery(&store).state, "accepted");
    assert!(store.claim_mail().unwrap().is_none());
    let r = report(&store);
    let rev = r.delivery.unwrap().revision;
    assert!(store
        .mail_action(r.id, action(rev, "retry", true), "staff".into())
        .is_err());
    assert_eq!(
        store.submit(input).unwrap().email_state.as_deref(),
        Some("accepted")
    );
}

#[test]
fn additive_legacy_migration_and_configuration_restart_do_not_send_a_backlog() {
    let disk = Disk::new();
    let mut legacy = input();
    legacy.phone.clear();
    legacy.confirmation_email = false;
    let receipt;
    {
        let store = LostFoundStore::open(disk.path(), false).unwrap();
        receipt = store.submit(legacy.clone()).unwrap().receipt;
        let r = report(&store);
        store
            .update(
                r.id,
                UpdateReport {
                    idempotency_key: Uuid::new_v4().to_string(),
                    revision: 1,
                    status: ReportStatus::Found,
                    notes: "Legacy private note".into(),
                },
                "legacy-staff".into(),
            )
            .unwrap();
        store.db.lock().unwrap().execute_batch("DROP TABLE lf_mail_actions; DROP TABLE lf_outbox; ALTER TABLE lf_reports DROP COLUMN phone;").unwrap();
    }
    {
        let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
        assert_eq!(store.submit(legacy).unwrap().receipt, receipt);
        let r = report(&store);
        assert_eq!(r.notes, "Legacy private note");
        assert_eq!(r.status, "found");
        assert_eq!(r.history.len(), 1);
        assert_eq!(r.phone, "");
        assert!(r.delivery.is_none());
        store.submit(input()).unwrap();
    }
    {
        let store = LostFoundStore::open(disk.path(), false).unwrap();
        assert_eq!(delivery(&store).state, "not_configured");
        assert!(store.claim_mail().unwrap().is_none());
    }
    let store = LostFoundStore::open_with_mail(disk.path(), false, config()).unwrap();
    assert_eq!(delivery(&store).state, "not_configured");
    assert!(store.claim_mail().unwrap().is_none());
}

#[test]
fn bounded_backoff_attempt_ceiling_manual_handling_and_independent_report_notes() {
    let store = store();
    store.submit(input()).unwrap();
    for attempt in 1..=5 {
        let job = store.claim_mail().unwrap().unwrap();
        assert_eq!(job.attempts, attempt);
        store
            .finish_mail(&job, Outcome::Retry("provider_rate_limited"))
            .unwrap();
        let d = delivery(&store);
        if attempt < 5 {
            assert_eq!(d.state, "retry_wait");
            let delay = d.next_attempt.unwrap() - Utc::now().timestamp();
            assert!((29..=(30 + (30i64 << attempt))).contains(&delay));
            assert!(store.claim_mail().unwrap().is_none());
            store
                .db
                .lock()
                .unwrap()
                .execute("UPDATE lf_outbox SET next_attempt=0", [])
                .unwrap();
        } else {
            assert_eq!(d.state, "failed");
            assert!(d.next_attempt.is_none());
        }
    }
    for _ in 5..10 {
        let r = report(&store);
        let rev = r.delivery.unwrap().revision;
        store
            .mail_action(r.id, action(rev, "retry", true), "staff".into())
            .unwrap();
        let job = store.claim_mail().unwrap().unwrap();
        store
            .finish_mail(&job, Outcome::Retry("connection_failed"))
            .unwrap();
        assert_eq!(delivery(&store).state, "failed");
    }
    let r = report(&store);
    let rev = r.delivery.unwrap().revision;
    assert!(store
        .mail_action(r.id.clone(), action(rev, "retry", true), "staff".into())
        .is_err());
    store
        .update(
            r.id.clone(),
            UpdateReport {
                idempotency_key: Uuid::new_v4().to_string(),
                revision: r.revision,
                status: ReportStatus::Contacted,
                notes: "Private staff note".into(),
            },
            "staff".into(),
        )
        .unwrap();
    let updated = store
        .mail_action(r.id, action(rev, "handled", false), "staff".into())
        .unwrap();
    assert_eq!(updated.notes, "Private staff note");
    assert_eq!(updated.status, "contacted");
    assert_eq!(updated.delivery.unwrap().state, "handled");
    assert!(store.claim_mail().unwrap().is_none());
}

async fn fake(
    status: u16,
    body: String,
    delay_ms: u64,
) -> (String, Arc<Mutex<Vec<Value>>>, tokio::task::JoinHandle<()>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let capture = seen.clone();
    let app = axum::Router::new().route(
        "/email",
        axum::routing::post(
            move |headers: axum::http::HeaderMap, Json(payload): Json<Value>| {
                let capture = capture.clone();
                let body = body.clone();
                async move {
                    assert_eq!(headers["X-Postmark-Server-Token"], "synthetic-token");
                    capture.lock().unwrap().push(payload);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    (StatusCode::from_u16(status).unwrap(), body)
                }
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/email", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (endpoint, seen, task)
}

#[tokio::test]
async fn fake_provider_acknowledgements_privacy_rejections_and_unknown_results() {
    let id = Uuid::new_v4().to_string();
    for (status, body, state) in [
        (
            200,
            json!({"ErrorCode":0,"MessageID":id}).to_string(),
            "accepted",
        ),
        (401, "secret rejection body".into(), "failed"),
        (422, "private provider error".into(), "failed"),
        (429, "rate limit".into(), "retry_wait"),
        (500, "maybe accepted".into(), "uncertain"),
        (503, "maybe accepted".into(), "uncertain"),
        (200, "not json".into(), "uncertain"),
        (200, json!({"ErrorCode":0}).to_string(), "uncertain"),
        (
            200,
            json!({"ErrorCode":0,"MessageID":"not-valid"}).to_string(),
            "uncertain",
        ),
        (200, "x".repeat(17 * 1024), "uncertain"),
        (302, "redirect".into(), "uncertain"),
    ] {
        let store = store();
        let input = input();
        let receipt = store.submit(input.clone()).unwrap();
        let (endpoint, seen, task) = fake(status, body, 0).await;
        assert!(store
            .mail_tick(&mail_client().unwrap(), &endpoint)
            .await
            .unwrap());
        assert!(!store
            .mail_tick(&mail_client().unwrap(), &endpoint)
            .await
            .unwrap());
        task.abort();
        let d = delivery(&store);
        assert_eq!(d.state, state);
        assert_eq!(d.attempts, 1);
        assert_eq!(
            store.submit(input).unwrap().email_state.as_deref(),
            Some(state)
        );
        assert_eq!(seen.lock().unwrap().len(), 1);
        let payload = seen.lock().unwrap()[0].clone();
        assert_eq!(payload["Metadata"]["receipt"], receipt.receipt);
        assert_eq!(payload["MessageStream"], "outbound");
        assert_eq!(payload["TrackOpens"], false);
        assert_eq!(payload["TrackLinks"], "None");
        for secret in [
            "Private synthetic item details",
            "555-0100",
            "Synthetic name",
            "Demo desk",
        ] {
            assert!(!payload.to_string().contains(secret));
        }
        assert!(!serde_json::to_string(&d)
            .unwrap()
            .contains("private provider error"));
        assert_eq!(
            d.provider_id,
            if state == "accepted" {
                Some(id.clone())
            } else {
                None
            }
        );
    }
}

#[tokio::test]
async fn timeout_after_acceptance_is_uncertain_and_connection_failure_is_bounded_retry() {
    let store = store();
    store.submit(input()).unwrap();
    let (endpoint, seen, task) = fake(
        200,
        json!({"ErrorCode":0,"MessageID":Uuid::new_v4().to_string()}).to_string(),
        300,
    )
    .await;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(80))
        .retry(reqwest::retry::never())
        .build()
        .unwrap();
    store.mail_tick(&client, &endpoint).await.unwrap();
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(delivery(&store).state, "uncertain");
    assert!(!store.mail_tick(&client, &endpoint).await.unwrap());
    task.abort();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let unavailable = format!("http://{}/email", listener.local_addr().unwrap());
    drop(listener);
    let r = report(&store);
    let rev = r.delivery.unwrap().revision;
    store
        .mail_action(r.id, action(rev, "retry", true), "staff".into())
        .unwrap();
    store
        .mail_tick(&mail_client().unwrap(), &unavailable)
        .await
        .unwrap();
    assert_eq!(delivery(&store).state, "retry_wait");
    assert_eq!(delivery(&store).diagnostic, "connection_failed");
}
