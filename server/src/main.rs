mod auth;
mod db;
mod email;
mod models;
mod routes;

use std::sync::Arc;

use axum::{middleware, routing::{get, post, put, delete}, Router};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use routes::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let db = Arc::new(db::Db::open("data.db"));
    db.seed_if_empty();

    let postmark = email::PostmarkConfig::from_env();
    if postmark.is_some() {
        eprintln!("[email] Postmark integration enabled");
    } else {
        eprintln!("[email] Postmark not configured — email notifications disabled");
    }

    let admin_password = std::env::var("ADMIN_PASSWORD").ok();
    if admin_password.is_some() {
        eprintln!("[auth] Admin password set — /admin routes protected with HTTP Basic Auth");
    } else {
        eprintln!("[auth] ADMIN_PASSWORD not set — admin routes are unprotected");
    }

    let state = AppState { db, postmark, admin_password };

    // Background task: poll for scheduled announcements that are now due and send emails
    if let Some(config) = state.postmark.clone() {
        let db = state.db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                interval.tick().await;
                let due = db.get_due_unsent_announcements();
                for ann in due {
                    eprintln!("[email] Scheduled announcement now due: {}", ann.id);
                    email::send_announcement_emails(db.clone(), config.clone(), ann).await;
                }
            }
        });
    }

    // Serve frontend static files — fall back to index.html for SPA routing
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "dist".to_string());
    let spa_fallback = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(format!("{}/index.html", static_dir)));

    // Protected admin routes
    let admin = Router::new()
        .route("/admin", get(auth::serve_admin))
        .route("/api/schedule", post(routes::create_schedule))
        .route("/api/schedule/{id}", put(routes::update_schedule))
        .route("/api/schedule/{id}", delete(routes::delete_schedule))
        .route("/api/delays", post(routes::create_delay))
        .route("/api/delays/{id}", delete(routes::delete_delay))
        .route("/api/announcements", post(routes::create_announcement))
        .route("/api/announcements/{id}", put(routes::update_announcement))
        .route("/api/announcements/{id}", delete(routes::delete_announcement))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    let app = Router::new()
        .route("/api/live", get(routes::get_live))
        .route("/api/email/subscribe", post(routes::subscribe))
        .route("/api/email/unsubscribe", get(routes::unsubscribe))
        .merge(admin)
        .fallback_service(spa_fallback)
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let addr = "[::]:3001";
    println!("Server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
