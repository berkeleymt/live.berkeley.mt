use super::*;
use axum::http::StatusCode as S;
const SUPER: &str = "super@example.test";
const FIXED: &str = "bootstrap@example.test";
const ADMIN: &str = "admin@example.test";
fn store() -> PeopleStore {
    let store = PeopleStore::open(None, [FIXED.into()].into(), false).unwrap();
    store.change(FIXED, SUPER, Some(Role::Super), true).unwrap();
    store.change(FIXED, ADMIN, Some(Role::Admin), true).unwrap();
    store
}
#[test]
fn allowlist_live_roles_removal_readdition_and_protection() {
    let store = store();
    assert_eq!(
        store
            .issue("absent@example.test", None, 100, None)
            .err()
            .unwrap()
            .0,
        S::FORBIDDEN
    );
    let (token, session) = store.issue(SUPER, None, 100, None).unwrap();
    assert_eq!(session.user.role, Role::Super);
    assert_eq!(session.expires_at, 86500);
    assert_ne!(token, session.csrf);
    let db = store.db.lock().unwrap();
    assert_eq!(
        db.query_row("SELECT digest FROM staff_sessions", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        digest(&token)
    );
    drop(db);
    assert_eq!(
        store.change(SUPER, SUPER, None, false).unwrap_err().0,
        S::CONFLICT
    );
    assert_eq!(
        store
            .change(SUPER, SUPER, Some(Role::Admin), false)
            .unwrap_err()
            .0,
        S::CONFLICT
    );
    assert_eq!(
        store.change(SUPER, FIXED, None, false).unwrap_err().0,
        S::CONFLICT
    );
    assert_eq!(
        store
            .change(SUPER, FIXED, Some(Role::Admin), false)
            .unwrap_err()
            .0,
        S::CONFLICT
    );
    assert_eq!(
        store.change(ADMIN, SUPER, None, false).unwrap_err().0,
        S::FORBIDDEN
    );
    store
        .change(FIXED, SUPER, Some(Role::Admin), false)
        .unwrap();
    assert_eq!(store.session(&token, 101).unwrap().user.role, Role::Admin);
    assert!(!store
        .session(&token, 101)
        .unwrap()
        .user
        .capabilities
        .contains(&super::super::Capability::PeopleWrite));
    assert_eq!(
        store.change(SUPER, ADMIN, None, false).unwrap_err().0,
        S::FORBIDDEN
    );
    store.change(FIXED, SUPER, None, false).unwrap();
    assert!(store.session(&token, 101).is_none());
    store.change(FIXED, SUPER, Some(Role::Super), true).unwrap();
    assert!(
        store.session(&token, 101).is_none(),
        "re-add must not resurrect revoked sessions"
    );
    assert_eq!(
        store
            .change(FIXED, ADMIN, Some(Role::Dispatcher), false)
            .unwrap_err()
            .0,
        S::BAD_REQUEST
    );
    assert_eq!(
        store
            .change(FIXED, ADMIN, Some(Role::Super), true)
            .unwrap_err()
            .0,
        S::CONFLICT
    );
}
#[test]
fn fixed_expiration_rotation_logout_and_presence() {
    let store = store();
    let (first, _) = store.issue(ADMIN, None, 100, None).unwrap();
    assert!(store.session(&first, 86499).is_some());
    assert!(store.session(&first, 86500).is_none());
    let (second, _) = store.issue(ADMIN, None, 101, Some(&first)).unwrap();
    assert!(store.session(&first, 102).is_none());
    assert!(store.session(&second, 102).is_some());
    store.revoke(&second).unwrap();
    assert!(store.session(&second, 102).is_none());
    store.heartbeat(ADMIN);
    assert!(
        store
            .list()
            .unwrap()
            .iter()
            .find(|p| p.email == ADMIN)
            .unwrap()
            .online
    );
    store
        .presence
        .lock()
        .unwrap()
        .insert(ADMIN.into(), now() - 31);
    assert!(
        !store
            .list()
            .unwrap()
            .iter()
            .find(|p| p.email == ADMIN)
            .unwrap()
            .online
    );
}
#[test]
fn email_normalization_is_exact_and_does_not_conflate_aliases() {
    assert_eq!(normalize_email(" Admin@Example.Test ").unwrap(), ADMIN);
    assert_ne!(normalize_email("ad.min+tag@example.test").unwrap(), ADMIN);
    for email in [
        "",
        "@example.test",
        "a@",
        "a@b@c.test",
        "a b@example.test",
        "a@bad..test",
        "a@-bad.test",
        "a\n@example.test",
    ] {
        assert!(normalize_email(email).is_err(), "{email}");
    }
}
#[test]
fn accounts_and_sessions_survive_restart_but_revocation_does_not_roll_back() {
    let dir = std::env::temp_dir().join(format!("live-people-unit-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let path = dir.join("staff.sqlite");
    let store = PeopleStore::open(Some(&path), [FIXED.into()].into(), false).unwrap();
    store.change(FIXED, ADMIN, Some(Role::Admin), true).unwrap();
    let (token, _) = store.issue(ADMIN, None, 100, None).unwrap();
    drop(store);
    let store = PeopleStore::open(Some(&path), [FIXED.into()].into(), false).unwrap();
    assert_eq!(store.session(&token, 101).unwrap().user.role, Role::Admin);
    store.revoke(&token).unwrap();
    drop(store);
    let store = PeopleStore::open(Some(&path), [FIXED.into()].into(), false).unwrap();
    assert!(store.session(&token, 101).is_none());
    drop(store);
    std::fs::remove_dir_all(dir).unwrap();
}
