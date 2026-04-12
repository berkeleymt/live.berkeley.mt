use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::db::Db;
use crate::models::*;

#[derive(Deserialize)]
pub struct LiveQuery {
    at: Option<String>,
    include_future: Option<bool>,
}

pub async fn get_live(
    State(db): State<Arc<Db>>,
    Query(query): Query<LiveQuery>,
) -> Json<LiveData> {
    Json(db.get_live_data(query.at.as_deref(), query.include_future.unwrap_or(false)))
}

// ── Schedule ──

pub async fn update_schedule(
    State(db): State<Arc<Db>>,
    Path(id): Path<String>,
    Json(input): Json<ScheduleEventInput>,
) -> StatusCode {
    if db.update_schedule_event(&id, &input) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn create_schedule(
    State(db): State<Arc<Db>>,
    Json(input): Json<ScheduleEventInput>,
) -> (StatusCode, Json<ScheduleEvent>) {
    let event = db.create_schedule_event(&input);
    (StatusCode::CREATED, Json(event))
}

pub async fn delete_schedule(
    State(db): State<Arc<Db>>,
    Path(id): Path<String>,
) -> StatusCode {
    if db.delete_schedule_event(&id) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Delays ──

pub async fn create_delay(
    State(db): State<Arc<Db>>,
    Json(input): Json<DelayInput>,
) -> Result<(StatusCode, Json<DelayNotice>), StatusCode> {
    db.create_delay(&input)
        .map(|d| (StatusCode::CREATED, Json(d)))
        .ok_or(StatusCode::BAD_REQUEST)
}

pub async fn delete_delay(
    State(db): State<Arc<Db>>,
    Path(id): Path<String>,
) -> StatusCode {
    if db.delete_delay(&id) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Announcements ──

pub async fn update_announcement(
    State(db): State<Arc<Db>>,
    Path(id): Path<String>,
    Json(input): Json<AnnouncementInput>,
) -> StatusCode {
    if db.update_announcement(&id, &input) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn create_announcement(
    State(db): State<Arc<Db>>,
    Json(input): Json<AnnouncementInput>,
) -> (StatusCode, Json<Announcement>) {
    let ann = db.create_announcement(&input);
    (StatusCode::CREATED, Json(ann))
}

pub async fn delete_announcement(
    State(db): State<Arc<Db>>,
    Path(id): Path<String>,
) -> StatusCode {
    if db.delete_announcement(&id) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}
