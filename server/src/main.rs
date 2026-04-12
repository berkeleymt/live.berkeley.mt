mod db;
mod email;
mod models;
mod routes;

use std::sync::Arc;

use axum::{routing::{get, post, put, delete}, Router};
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

    let state = AppState { db, postmark };

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

    let app = Router::new()
        .route("/api/live", get(routes::get_live))
        // Schedule
        .route("/api/schedule", post(routes::create_schedule))
        .route("/api/schedule/{id}", put(routes::update_schedule))
        .route("/api/schedule/{id}", delete(routes::delete_schedule))
        // Delays
        .route("/api/delays", post(routes::create_delay))
        .route("/api/delays/{id}", delete(routes::delete_delay))
        // Announcements
        .route("/api/announcements", post(routes::create_announcement))
        .route("/api/announcements/{id}", put(routes::update_announcement))
        .route("/api/announcements/{id}", delete(routes::delete_announcement))
        // Email subscriptions
        .route("/api/email/subscribe", post(routes::subscribe))
        .route("/api/email/unsubscribe", get(routes::unsubscribe))
        .fallback_service(spa_fallback)
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let addr = "0.0.0.0:3001";
    println!("Server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
