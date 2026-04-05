mod db;
mod models;
mod routes;

use std::sync::Arc;

use axum::{routing::{get, post, put, delete}, Router};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    let db = Arc::new(db::Db::open("data.db"));
    db.seed_if_empty();

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
        .route("/api/announcements/{id}", delete(routes::delete_announcement))
        .layer(CorsLayer::very_permissive())
        .with_state(db);

    let addr = "0.0.0.0:3001";
    println!("Server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
