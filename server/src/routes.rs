use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;

use crate::db::Db;
use crate::models::*;

pub async fn get_live(State(db): State<Arc<Db>>) -> Json<LiveData> {
    Json(db.get_live_data())
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
