mod content;
mod db;
mod email;
mod lost_found;
mod models;
mod operations;
mod planner;
mod publishing;
mod routes;
mod site;
mod staff;
mod wayfinding;

use std::sync::Arc;

use axum::{
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use routes::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let db = Arc::new(db::Db::open(
        &std::env::var("DATABASE_PATH").unwrap_or_else(|_| "data.db".into()),
    ));
    db.seed_if_empty();

    let demo = std::env::var("DEMO_MODE").as_deref() == Ok("true");
    let postmark = if demo {
        None
    } else {
        email::PostmarkConfig::from_env()
    };
    if postmark.is_some() {
        eprintln!("[email] Postmark integration enabled");
    } else {
        eprintln!("[email] Postmark not configured — email notifications disabled");
    }

    let admin_password = std::env::var("ADMIN_PASSWORD").ok();
    let staff = Arc::new(staff::StaffStore::from_env().expect("Invalid staff configuration"));
    eprintln!("[auth] Staff capabilities enforced; demo mode: {demo}");
    let site = Arc::new(
        site::SiteStore::open(
            std::env::var("SITE_CONTENT_PATH")
                .unwrap_or_else(|_| "content/site.json".into())
                .into(),
            std::env::var("SITE_MEDIA_DIR")
                .unwrap_or_else(|_| "media".into())
                .into(),
        )
        .expect("Invalid site content"),
    );
    let wayfinding = Arc::new(
        wayfinding::WayfindingStore::from_env(
            std::env::var("WAYFINDING_CONTENT_PATH")
                .unwrap_or_else(|_| "content/wayfinding.json".into())
                .into(),
        )
        .expect("Invalid wayfinding configuration"),
    );
    let lost_found = Arc::new(
        lost_found::LostFoundStore::open(
            std::env::var("PRIVATE_DB_PATH").unwrap_or_else(|_| "private.db".into()),
            demo,
        )
        .expect("Invalid private inbox database"),
    );

    let content_path =
        std::env::var("EVENT_CONTENT_PATH").unwrap_or_else(|_| "content/event.json".into());
    let content = Arc::new(
        content::ContentStore::open(content_path.into())
            .expect("Invalid event content; check EVENT_CONTENT_PATH"),
    );
    let operations = match std::env::var("LIVE_CONTENT_REPO") {
        Ok(path) if !path.is_empty() => Some(Arc::new(
            operations::OperationsStore::open(path.into())
                .await
                .expect("Invalid LIVE_CONTENT_REPO"),
        )),
        _ => None,
    };
    let state = AppState {
        db,
        postmark,
        admin_password,
        content,
        operations,
        staff,
        site,
        wayfinding,
        lost_found,
    };

    publishing::sync_editorial(&state);
    if let Some(operations) = state.operations.clone() {
        let state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            let mut previous_error = None;
            loop {
                interval.tick().await;
                let error = operations.reload().await.err();
                publishing::sync_editorial(&state);
                if error != previous_error {
                    if let Some((_, ref message)) = error {
                        eprintln!("[publishing] Keeping last valid publication: {message}");
                    }
                    previous_error = error;
                }
            }
        });
    }

    let content = state.content.clone();
    let site = state.site.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        let mut previous_error = None;
        loop {
            interval.tick().await;
            let content = content.clone();
            let site = site.clone();
            let error = tokio::task::spawn_blocking(move || {
                let _ = site.reload();
                content.reload()
            })
            .await
            .unwrap()
            .err();
            if error != previous_error {
                if let Some(ref message) = error {
                    eprintln!("[content] Keeping last valid content: {message}");
                }
                previous_error = error;
            }
        }
    });

    // Background task: poll for scheduled announcements that are now due and send emails
    if let Some(config) = state.postmark.clone() {
        let db = state.db.clone();
        let operations = state.operations.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                interval.tick().await;
                let due = if let Some(ref operations) = operations {
                    let mut live = db.get_live_data(None, false);
                    operations.snapshot().content.apply(&mut live, None, false);
                    live.announcements
                        .into_iter()
                        .filter(|a| !db.has_email_been_sent(&a.id))
                        .collect()
                } else {
                    db.get_due_unsent_announcements()
                };
                for ann in due {
                    eprintln!("[email] Scheduled announcement now due: {}", ann.id);
                    email::send_announcement_emails(db.clone(), config.clone(), ann).await;
                }
            }
        });
    }

    // Serve frontend static files — fall back to index.html for SPA routing
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "dist".to_string());
    let spa_fallback =
        ServeDir::new(&static_dir).fallback(ServeFile::new(format!("{}/index.html", static_dir)));

    // Protected admin routes
    let admin = Router::new()
        .route("/api/publishing", get(publishing::status))
        .route("/api/publishing/export", get(publishing::export))
        .route("/api/publishing/push", post(publishing::push))
        .route("/api/publishing/restore", post(publishing::restore))
        .route(
            "/api/content",
            get(routes::get_content)
                .put(routes::save_content)
                .layer(middleware::map_response(routes::no_store)),
        )
        .route("/api/schedule/plan/preview", post(planner::preview))
        .route("/api/schedule/plan/apply", post(planner::apply))
        .route("/api/schedule", post(routes::create_schedule))
        .route("/api/schedule/{id}", put(routes::update_schedule))
        .route("/api/schedule/{id}", delete(routes::delete_schedule))
        .route("/api/delays", post(routes::create_delay))
        .route("/api/delays/{id}", delete(routes::delete_delay))
        .route("/api/announcements", post(routes::create_announcement))
        .route("/api/announcements/{id}", put(routes::update_announcement))
        .route(
            "/api/announcements/{id}",
            delete(routes::delete_announcement),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            publishing::operations_mutation,
        ))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            publishing::editorial_mutation,
        ))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            staff::require_auth,
        ))
        .layer(middleware::map_response(routes::no_store));

    let feature_admin = site::admin_router()
        .with_state(state.clone())
        .merge(wayfinding::admin_router(state.wayfinding.clone()))
        .merge(lost_found::admin_router(state.lost_found.clone()))
        .route_layer(middleware::from_fn(routes::feature_access))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            publishing::editorial_mutation,
        ))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            staff::require_auth,
        ));
    let media = Router::new()
        .nest_service(
            "/media",
            ServeDir::new(state.site.media_dir()).append_index_html_on_directories(false),
        )
        .layer(middleware::map_response(site::media_headers));
    let app = Router::new()
        .route(
            "/api/live",
            get(routes::get_live).layer(middleware::map_response(routes::no_store)),
        )
        .route("/api/email/subscribe", post(routes::subscribe))
        .route("/api/email/unsubscribe", get(routes::unsubscribe))
        .merge(admin)
        .merge(staff::public_router())
        .merge(site::public_router())
        .with_state(state.clone())
        .merge(feature_admin)
        .merge(wayfinding::public_router(state.wayfinding.clone()))
        .merge(lost_found::public_router(state.lost_found.clone()))
        .merge(media)
        .fallback_service(spa_fallback)
        // Same-origin staff credentials must not be usable by arbitrary web origins.
        // Vite's /api proxy keeps local development same-origin too.
        .layer(CorsLayer::new());

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()
        .expect("PORT must be a port number");
    let host = std::env::var("HOST").unwrap_or_else(|_| "[::]".into());
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("Server listening on {}", listener.local_addr().unwrap());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .unwrap();
}
