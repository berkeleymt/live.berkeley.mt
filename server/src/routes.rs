use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, Redirect},
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::db::Db;
use crate::email::{self, PostmarkConfig};
use crate::models::*;

/// Shared application state passed to all route handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub postmark: Option<PostmarkConfig>,
}

#[derive(Deserialize)]
pub struct LiveQuery {
    at: Option<String>,
    include_future: Option<bool>,
}

pub async fn get_live(
    State(state): State<AppState>,
    Query(query): Query<LiveQuery>,
) -> Json<LiveData> {
    Json(state.db.get_live_data(query.at.as_deref(), query.include_future.unwrap_or(false)))
}

// ── Schedule ──

pub async fn update_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<ScheduleEventInput>,
) -> StatusCode {
    if state.db.update_schedule_event(&id, &input) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn create_schedule(
    State(state): State<AppState>,
    Json(input): Json<ScheduleEventInput>,
) -> (StatusCode, Json<ScheduleEvent>) {
    let event = state.db.create_schedule_event(&input);
    (StatusCode::CREATED, Json(event))
}

pub async fn delete_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    if state.db.delete_schedule_event(&id) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Delays ──

pub async fn create_delay(
    State(state): State<AppState>,
    Json(input): Json<DelayInput>,
) -> Result<(StatusCode, Json<DelayNotice>), StatusCode> {
    state.db.create_delay(&input)
        .map(|d| (StatusCode::CREATED, Json(d)))
        .ok_or(StatusCode::BAD_REQUEST)
}

pub async fn delete_delay(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    if state.db.delete_delay(&id) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Announcements ──

pub async fn update_announcement(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<AnnouncementInput>,
) -> StatusCode {
    if state.db.update_announcement(&id, &input) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn create_announcement(
    State(state): State<AppState>,
    Json(input): Json<AnnouncementInput>,
) -> (StatusCode, Json<Announcement>) {
    let ann = state.db.create_announcement(&input);

    // Fire email notifications in the background if not scheduled for the future
    if ann.scheduled_at.is_none() {
        if let Some(config) = state.postmark.clone() {
            let db = state.db.clone();
            let announcement = ann.clone();
            tokio::spawn(async move {
                email::send_announcement_emails(db, config, announcement).await;
            });
        }
    }

    (StatusCode::CREATED, Json(ann))
}

pub async fn delete_announcement(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    if state.db.delete_announcement(&id) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Email Subscriptions ──

pub async fn subscribe(
    State(state): State<AppState>,
    Json(input): Json<SubscribeInput>,
) -> Json<SubscribeResponse> {
    let email = input.email.trim().to_lowercase();
    if !email.contains('@') || !email.contains('.') {
        return Json(SubscribeResponse {
            ok: false,
            message: "Invalid email address.".to_string(),
        });
    }
    match state.db.add_subscriber(&email) {
        Some(_) => Json(SubscribeResponse {
            ok: true,
            message: "Subscribed! You'll receive email notifications for live updates.".to_string(),
        }),
        None => Json(SubscribeResponse {
            ok: true,
            message: "You're already subscribed.".to_string(),
        }),
    }
}

#[derive(Deserialize)]
pub struct UnsubscribeQuery {
    token: String,
}

pub async fn unsubscribe(
    State(state): State<AppState>,
    Query(query): Query<UnsubscribeQuery>,
) -> Result<Html<String>, Redirect> {
    if state.db.remove_subscriber_by_token(&query.token) {
        Ok(Html(
            r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribed</title></head>
<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5">
<div style="text-align:center;padding:40px">
<h1 style="color:#003262;margin:0 0 8px">Unsubscribed</h1>
<p style="color:#666;margin:0">You won't receive any more BmMT live update emails.</p>
</div></body></html>"#.to_string(),
        ))
    } else {
        Ok(Html(
            r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title></head>
<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5">
<div style="text-align:center;padding:40px">
<h1 style="color:#003262;margin:0 0 8px">Link Expired</h1>
<p style="color:#666;margin:0">This unsubscribe link is no longer valid. You may already be unsubscribed.</p>
</div></body></html>"#.to_string(),
        ))
    }
}
