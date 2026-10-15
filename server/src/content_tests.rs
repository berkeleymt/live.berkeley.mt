use super::*;

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("live-content-test-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("event.json");
        fs::write(&path, include_str!("../../content/event.json")).unwrap();
        Self { path }
    }
    fn store(&self) -> ContentStore {
        ContentStore::open(self.path.clone()).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.path.parent().unwrap());
    }
}

#[test]
fn publishing_survives_restart_and_changes_revision() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let mut draft = store.snapshot();
    let revision = draft.revision.clone();
    draft.content.title = "New event".into();
    let published = store.save(draft).unwrap();
    assert_ne!(published.revision, revision);
    assert_eq!(fixture.store().snapshot().content.title, "New event");
    assert_eq!(
        fs::read_dir(fixture.path.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn stale_editor_does_not_overwrite_a_publication() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let draft = store.snapshot();
    store.save(draft.clone()).unwrap();
    assert_eq!(store.save(draft).unwrap_err().0, StatusCode::CONFLICT);
}

#[test]
fn direct_file_edits_reload_and_invalidate_open_editors() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let draft = store.snapshot();
    let mut changed = draft.content.clone();
    changed.title = "Edited in Git".into();
    fs::write(&fixture.path, serde_json::to_vec(&changed).unwrap()).unwrap();
    assert_eq!(
        store.save(draft.clone()).unwrap_err().0,
        StatusCode::CONFLICT
    );
    assert_eq!(store.reload().unwrap().content.title, "Edited in Git");
    assert_eq!(store.save(draft).unwrap_err().0, StatusCode::CONFLICT);
}

#[test]
fn invalid_files_do_not_replace_last_good_public_content() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let before = store.snapshot();
    fs::write(&fixture.path, b"{broken").unwrap();
    assert!(store.reload().is_err());
    assert_eq!(store.snapshot().revision, before.revision);
    assert!(ContentStore::open(fixture.path.clone()).is_err());
}

#[test]
fn unchanged_file_does_not_invalidate_editors() {
    let fixture = Fixture::new();
    let store = fixture.store();
    assert_eq!(store.snapshot().revision, store.reload().unwrap().revision);
}

#[test]
fn invalid_fields_never_reach_disk() {
    let fixture = Fixture::new();
    let store = fixture.store();
    for (field, value) in [
        ("title", ""),
        ("date", "2026-02-30"),
        ("date", "2026-2-1"),
        ("timeZone", "bad-zone"),
        ("eventUrl", "javascript:alert(1)"),
        ("travelUrl", "http://example.com"),
        ("eventUrl", "https://user:password@example.com"),
    ] {
        let mut json = serde_json::to_value(store.snapshot()).unwrap();
        json["content"][field] = value.into();
        let input = serde_json::from_value(json).unwrap();
        assert_eq!(
            store.save(input).unwrap_err().0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{field}"
        );
    }
    assert_eq!(
        store.snapshot().content.title,
        fixture.store().snapshot().content.title
    );
}

#[test]
fn missing_file_does_not_report_a_successful_save() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let before = store.snapshot();
    fs::remove_file(&fixture.path).unwrap();
    assert_eq!(
        store.save(before.clone()).unwrap_err().0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(store.snapshot().revision, before.revision);
}

#[test]
fn both_shipped_event_files_are_valid() {
    for json in [
        include_str!("../../content/event.json"),
        include_str!("../../content/bmt-2026.example.json"),
    ] {
        serde_json::from_str::<EventContent>(json)
            .unwrap()
            .validate()
            .unwrap();
    }
}

#[test]
fn rejects_oversize_content_and_empty_faq_answers() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let mut draft = store.snapshot();
    draft.content.faqs = vec![
        Faq {
            question: "Question?".into(),
            answer: "x".repeat(9000)
        };
        15
    ];
    assert_eq!(
        store.save(draft).unwrap_err().0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut draft = store.snapshot();
    draft.content.faqs[0].answer.clear();
    assert_eq!(
        store.save(draft).unwrap_err().0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
