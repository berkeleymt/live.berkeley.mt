//! Synthetic keys only; these tests never fetch Google or use an operator credential.
use super::*;
use base64::Engine;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde_json::{json, Value};

fn fixture() -> (EncodingKey, JwkSet) {
    let fixture: Value = serde_json::from_str(include_str!("synthetic-google-key.json")).unwrap();
    let der = base64::engine::general_purpose::STANDARD
        .decode(fixture["privateDer"].as_str().unwrap())
        .unwrap();
    (
        EncodingKey::from_rsa_der(&der),
        serde_json::from_value(json!({"keys": [fixture["jwk"]]})).unwrap(),
    )
}
fn claims() -> Value {
    json!({"email":" Admin@Example.Test ", "email_verified":true, "sub":"synthetic-subject", "iat":super::super::now(), "exp":super::super::now()+3600, "iss":"https://accounts.google.com", "aud":"synthetic-client"})
}
fn token(claims: &Value, key: &EncodingKey) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("synthetic-test".into());
    encode(&header, claims, key).unwrap()
}

#[test]
fn cryptographic_and_claim_validation_rejects_all_bad_credentials() {
    let (key, keys) = fixture();
    let good = claims();
    assert!(verify_with_keys(&token(&good, &key), "synthetic-client", &keys).is_ok());
    for (field, bad) in [
        ("email_verified", json!(false)),
        ("email_verified", json!("true")),
        ("email", json!("invalid")),
        ("sub", json!("")),
        ("exp", json!(1)),
        ("iat", json!(super::super::now() + 3600)),
        ("iss", json!("https://attacker.test")),
        ("aud", json!("other-client")),
        ("azp", json!("other-client")),
    ] {
        let mut changed = good.clone();
        changed[field] = bad;
        assert_eq!(
            verify_with_keys(&token(&changed, &key), "synthetic-client", &keys).unwrap_err(),
            VerifyError::Invalid,
            "{field}"
        );
    }
    for field in ["email", "email_verified", "sub", "iss", "aud", "exp", "iat"] {
        let mut changed = good.clone();
        changed.as_object_mut().unwrap().remove(field);
        assert!(
            verify_with_keys(&token(&changed, &key), "synthetic-client", &keys).is_err(),
            "missing {field}"
        );
    }
    let mut altered = token(&good, &key).into_bytes();
    let i = altered.iter().rposition(|b| *b == b'.').unwrap() + 2;
    altered[i] = if altered[i] == b'A' { b'B' } else { b'A' };
    assert!(verify_with_keys(
        std::str::from_utf8(&altered).unwrap(),
        "synthetic-client",
        &keys
    )
    .is_err());
    let hmac = encode(
        &Header::new(Algorithm::HS256),
        &good,
        &EncodingKey::from_secret(b"synthetic-test"),
    )
    .unwrap();
    assert!(verify_with_keys(&hmac, "synthetic-client", &keys).is_err());
    assert!(verify_with_keys("not-a-token", "synthetic-client", &keys).is_err());
    assert!(verify_with_keys(
        &token(&good, &key),
        "synthetic-client",
        &JwkSet { keys: vec![] }
    )
    .is_err());
}

#[tokio::test]
async fn bounded_cached_verification_and_outage_never_need_the_provider() {
    let (key, keys) = fixture();
    let verifier = Google::new("synthetic-client".into()).unwrap();
    {
        let mut cache = verifier.cache.lock().await;
        cache.keys = Some(keys);
        cache.expires = Instant::now() + Duration::from_secs(3600);
        // Simulate a failed key refresh / retry cooldown. No network is possible in this test.
        cache.retry_after = Instant::now() + Duration::from_secs(3600);
    }
    let credential = token(&claims(), &key);
    assert!(verifier.verify(&credential).await.is_ok());
    assert_eq!(
        verifier.verify(&"a".repeat(8193)).await.unwrap_err(),
        VerifyError::Invalid
    );
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("unknown".into());
    let unknown = encode(&header, &claims(), &key).unwrap();
    assert_eq!(
        verifier.verify(&unknown).await.unwrap_err(),
        VerifyError::Invalid
    );
    verifier.cache.lock().await.expires = Instant::now() - Duration::from_secs(1);
    assert_eq!(
        verifier.verify(&credential).await.unwrap_err(),
        VerifyError::Unavailable
    );
    assert_eq!(
        verifier.verify(&credential).await.unwrap_err(),
        VerifyError::Unavailable
    );
    let mut staff = super::super::StaffStore::new(vec![], false, true, None, 86400).unwrap();
    staff.google_mode = true;
    staff.google = Some(verifier);
    let people =
        super::super::people::PeopleStore::open(None, ["admin@example.test".into()].into(), false)
            .unwrap();
    let (token, _) = people
        .issue("admin@example.test", None, super::super::now(), None)
        .unwrap();
    staff.people = Some(std::sync::Arc::new(people));
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("cookie", format!("bmt_live_staff={token}").parse().unwrap());
    assert!(
        staff.session(&headers, super::super::now()).is_some(),
        "Google outage must not interrupt an existing Live session"
    );
}

#[test]
fn profile_pictures_are_bounded_https_google_images_only() {
    assert!(safe_picture(Some("https://lh3.googleusercontent.com/a/photo".into())).is_some());
    for url in [
        "http://lh3.googleusercontent.com/a",
        "https://evil.test/a",
        "https://googleusercontent.com.evil.test/a",
        "https://u:p@lh3.googleusercontent.com/a",
        "javascript:alert(1)",
    ] {
        assert!(safe_picture(Some(url.into())).is_none());
    }
}
