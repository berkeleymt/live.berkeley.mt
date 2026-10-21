use crate::{content::ContentError, operations::Operations, routes::AppState};
use axum::{
    body::to_bytes,
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn sync_editorial(state: &AppState) {
    if let Some(store) = &state.operations {
        if store.remote.is_some() {
            return;
        } // Every reader uses the same atomic bundle pointer.
        let snapshot = store.snapshot();
        if let Some(editorial) = snapshot.content.editorial {
            state
                .content
                .publish(editorial.event, snapshot.revision.clone());
            state
                .site
                .publish(editorial.site, snapshot.revision.clone());
            state
                .wayfinding
                .publish(editorial.wayfinding, snapshot.revision);
        }
    }
}

/// Auth/CSRF middleware runs outside this layer. Only allowlisted public documents enter Git.
pub async fn editorial_mutation(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let kind = match (request.method().as_str(), request.uri().path()) {
        ("PUT", "/api/content") => "event",
        ("PUT", "/api/site/editor") => "site",
        ("PUT", "/api/wayfinding/editor") => "wayfinding",
        _ => return next.run(request).await,
    };
    let request = if kind == "site" || kind == "event" {
        let (parts, body) = request.into_parts();
        let bytes = match to_bytes(body, 1_000_000).await {
            Ok(bytes) => bytes,
            Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        };
        let validation = if kind == "site" {
            let input: crate::site::SiteDocument = match serde_json::from_slice(&bytes) {
                Ok(input) => input,
                Err(_) => {
                    return (StatusCode::BAD_REQUEST, "Invalid site document.").into_response()
                }
            };
            crate::pages::guard_compat(&state, &input.content)
        } else {
            let input: crate::content::ContentDocument = match serde_json::from_slice(&bytes) {
                Ok(input) => input,
                Err(_) => {
                    return (StatusCode::BAD_REQUEST, "Invalid event document.").into_response()
                }
            };
            crate::pages::guard_faq(&state, &input.content)
        };
        if let Err(error) = validation {
            return error.into_response();
        }
        Request::from_parts(parts, axum::body::Body::from(bytes))
    } else {
        request
    };
    let Some(store) = &state.operations else {
        return next.run(request).await;
    };
    if store.snapshot().content.editorial.is_none() {
        return next.run(request).await;
    }
    let bytes = match to_bytes(request.into_body(), 1_000_000).await {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Document {
        revision: String,
        content: Value,
    }
    let input: Document = match serde_json::from_slice(&bytes) {
        Ok(input) => input,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid public document.").into_response(),
    };
    match store
        .publish_editorial(&input.revision, kind, input.content.clone())
        .await
    {
        Ok(revision) => {
            sync_editorial(&state);
            Json(json!({"revision": revision, "content": input.content})).into_response()
        }
        Err(error) => error.into_response(),
    }
}

fn configured(_state: &AppState) -> Result<(), ContentError> {
    // All callers are behind fail-closed staff capability middleware.
    Ok(())
}
fn revision(headers: &HeaderMap) -> Result<&str, ContentError> {
    let value = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::PRECONDITION_REQUIRED,
            "Refresh to load the publication revision before saving.".into(),
        ))?;
    let value = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .unwrap_or(value);
    if value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err((
            StatusCode::PRECONDITION_FAILED,
            "If-Match must contain one full publication revision.".into(),
        ));
    }
    Ok(value)
}
pub async fn status(State(state): State<AppState>) -> Result<Json<Value>, ContentError> {
    configured(&state)?;
    match state.operations {
        Some(store) => store.status().await.map(Json),
        None => Ok(Json(json!({"mode":"sqlite"}))),
    }
}
pub async fn export(State(state): State<AppState>) -> Result<Response, ContentError> {
    configured(&state)?;
    let content = match state.operations {
        Some(store) => store.snapshot().content,
        None => Operations::from_live(state.db.get_live_data(None, true)),
    };
    Ok((
        [
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=operations.json",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        Json(content),
    )
        .into_response())
}
fn remote(
    state: &AppState,
) -> Result<&std::sync::Arc<crate::remote_content::RemoteStore>, ContentError> {
    state
        .operations
        .as_ref()
        .and_then(|store| store.remote.as_ref())
        .ok_or((
            StatusCode::CONFLICT,
            "Remote-first mode is not enabled. Existing local/SQLite publication is unchanged."
                .into(),
        ))
}
pub async fn sync_remote(State(state): State<AppState>) -> Result<Json<Value>, ContentError> {
    remote(&state)?.reload().await?;
    remote(&state)?.status().await.map(Json)
}
pub async fn pending(State(state): State<AppState>) -> Result<Json<Value>, ContentError> {
    remote(&state)?.pending().await.map(Json)
}
pub async fn archive(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, ContentError> {
    remote(&state)?.archive(revision(&headers)?).await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn settings(State(state): State<AppState>) -> Json<Value> {
    Json(remote(&state).map(|store| store.settings()).unwrap_or_else(|_| json!({"mode": if state.operations.is_some() {"git"} else {"sqlite"}, "configuration":"Remote-first mode is opt-in through deployment configuration; existing data is not migrated automatically."})))
}
pub async fn remote_media(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let Ok(remote) = remote(&state) else {
        return next.run(request).await;
    };
    let path = request.uri().path().trim_start_matches('/');
    let Some(mime) = crate::remote_content::media_mime(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let bundle = remote.bundle();
    let Some(bytes) = bundle.files.get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !matches!(request.method().as_str(), "GET" | "HEAD") {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let body = if request.method() == axum::http::Method::HEAD {
        Vec::new()
    } else {
        bytes.clone()
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CONTENT_SECURITY_POLICY, "default-src 'none'"),
        ],
        body,
    )
        .into_response()
}
pub async fn push(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ContentError> {
    configured(&state)?;
    let store = state
        .operations
        .ok_or((StatusCode::CONFLICT, "Git mode is not enabled.".into()))?;
    store.push(revision(&headers)?).await.map(Json)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Restore {
    revision: String,
}
pub async fn restore(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Restore>,
) -> Result<Response, ContentError> {
    configured(&state)?;
    let store = state
        .operations
        .as_ref()
        .ok_or((StatusCode::CONFLICT, "Git mode is not enabled.".into()))?;
    let revision = store.restore(revision(&headers)?, &input.revision).await?;
    sync_editorial(&state);
    Ok((
        [(header::ETAG, format!("\"{revision}\""))],
        Json(json!({"revision":revision})),
    )
        .into_response())
}

pub async fn operations_mutation(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let Some(ref store) = state.operations else {
        return next.run(request).await;
    };
    let path: Vec<_> = request
        .uri()
        .path()
        .trim_matches('/')
        .split('/')
        .map(str::to_owned)
        .collect();
    let method = request.method().to_string();
    if request.uri().path().starts_with("/api/schedule/plan") {
        return next.run(request).await;
    }
    if path.len() < 2
        || path[0] != "api"
        || !["schedule", "delays", "announcements"].contains(&path[1].as_str())
        || !["POST", "PUT", "DELETE"].contains(&method.as_str())
    {
        return next.run(request).await;
    }
    if let Err(error) = configured(&state) {
        return error.into_response();
    }
    let valid_route = match (method.as_str(), path[1].as_str()) {
        ("POST", _) => path.len() == 2,
        ("PUT", "schedule" | "announcements") | ("DELETE", _) => path.len() == 3,
        _ => false,
    };
    if !valid_route {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let expected = match revision(request.headers()) {
        Ok(value) => value.to_owned(),
        Err(error) => return error.into_response(),
    };
    let body = if method == "DELETE" {
        Value::Null
    } else {
        if request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_none_or(|v| !v.starts_with("application/json"))
        {
            return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
        }
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            to_bytes(request.into_body(), 1_000_000),
        )
        .await
        {
            Ok(Ok(bytes)) => match serde_json::from_slice(&bytes) {
                Ok(value) => value,
                Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response(),
            },
            Ok(Err(_)) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
            Err(_) => return StatusCode::REQUEST_TIMEOUT.into_response(),
        }
    };
    match store
        .mutate(
            &expected,
            &method,
            &path[1],
            path.get(2).map(String::as_str),
            body,
        )
        .await
    {
        Ok((value, revision)) => {
            sync_editorial(&state);
            (
                if method == "POST" {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                },
                [(header::ETAG, format!("\"{revision}\""))],
                Json(value),
            )
                .into_response()
        }
        Err(error) => error.into_response(),
    }
}
