//! Isolated test host for site.rs while shared application wiring is owned by the integrator.
//! Compiled by tests/site.test.mjs using the repository's existing dependency artifacts.
#[path = "../../../server/src/site.rs"]
mod site;
#[path = "../../../server/src/staff.rs"]
mod staff;
// This host tests file mode only. An uninhabited adapter satisfies the optional
// source type without emulating any remote behavior; real remote publication is
// exercised against the production router in tests/remote-content.test.mjs.
mod remote_content {
    pub enum RemoteStore {}
    pub struct Snapshot {
        pub revision: String,
        pub content: Content,
    }
    pub struct Content {
        pub editorial: Option<Editorial>,
    }
    pub struct Editorial {
        pub site: crate::site::SiteConfig,
    }
    pub struct Bundle {
        pub files: std::collections::BTreeMap<String, Vec<u8>>,
    }
    impl RemoteStore {
        pub fn snapshot(&self) -> Snapshot {
            match *self {}
        }
        pub fn bundle(&self) -> Bundle {
            match *self {}
        }
        pub async fn upload(
            &self,
            _: &str,
            _: &[u8],
        ) -> Result<crate::site::MediaAsset, crate::site::SiteError> {
            match *self {}
        }
    }
}
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
