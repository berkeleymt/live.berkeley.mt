//! Isolated test host for site.rs while shared application wiring is owned by the integrator.
//! Compiled by tests/site.test.mjs using the repository's existing dependency artifacts.
#[path = "../../../server/src/staff.rs"]
mod staff;
#[path = "../../../server/src/site.rs"]
mod site;
mod routes {
    #[derive(Clone)]
    pub struct AppState {
        pub site: std::sync::Arc<crate::site::SiteStore>,
        pub staff: std::sync::Arc<crate::staff::StaffStore>,
        pub admin_password: Option<String>,
    }
}

#[tokio::main]
async fn main() {
    use axum::{middleware, Router};
    use std::{path::PathBuf, sync::Arc};
    use tower_http::services::ServeDir;
    let site = Arc::new(
        site::SiteStore::open(
            PathBuf::from(std::env::var("SITE_CONTENT_PATH").expect("test content path")),
            PathBuf::from(std::env::var("SITE_MEDIA_DIR").expect("test media directory")),
        )
        .expect("valid test content"),
    );
    let state = routes::AppState {
        site,
        staff: Arc::new(staff::StaffStore::from_env().unwrap()),
        admin_password: std::env::var("ADMIN_PASSWORD").ok(),
    };
    let reloader = state.site.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            let store = reloader.clone();
            let _ = tokio::task::spawn_blocking(move || store.reload()).await;
        }
    });
    let media = Router::new()
        .nest_service(
            "/media",
            ServeDir::new(state.site.media_dir()).append_index_html_on_directories(false),
        )
        .layer(middleware::map_response(site::media_headers));
    let app = Router::new()
        .merge(site::public_router())
        .merge(site::admin_router())
        .merge(media)
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("Site test listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
