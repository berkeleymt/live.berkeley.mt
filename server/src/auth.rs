use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::Engine;

use crate::routes::AppState;

fn check_basic_auth(headers: &header::HeaderMap, expected_password: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|creds| creds.split_once(':').map(|(_, pass)| pass == expected_password))
        .unwrap_or(false)
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Basic realm=\"admin\"")],
    )
        .into_response()
}

/// Middleware that protects admin API routes with HTTP Basic Auth.
/// If `ADMIN_PASSWORD` is not set, all requests are allowed through.
pub async fn require_auth(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, Response> {
    let Some(ref password) = state.admin_password else {
        return Ok(next.run(request).await);
    };

    if check_basic_auth(request.headers(), password) {
        Ok(next.run(request).await)
    } else {
        Err(unauthorized())
    }
}

/// Serves `index.html` for `/admin` after checking Basic Auth.
pub async fn serve_admin(State(state): State<AppState>, request: Request) -> Response {
    if let Some(ref password) = state.admin_password {
        if !check_basic_auth(request.headers(), password) {
            return unauthorized();
        }
    }

    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "dist".to_string());
    match std::fs::read_to_string(format!("{}/index.html", static_dir)) {
        Ok(html) => ([(header::CONTENT_TYPE, "text/html")], html).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
