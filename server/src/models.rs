use serde::{Deserialize, Serialize};

// ── Schedule ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEvent {
    pub id: String,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub location: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEventInput {
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub location: String,
    pub category: String,
    pub description: Option<String>,
}

// ── Announcements ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Announcement {
    pub id: String,
    pub title: String,
    pub body: String,
    pub timestamp: String,
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AnnouncementInput {
    pub title: String,
    pub body: String,
    pub priority: Option<String>,
    pub pinned: Option<bool>,
}

// ── Delays ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayNotice {
    pub id: String,
    pub event_id: String,
    pub event_title: String,
    pub original_time: String,
    pub new_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayInput {
    pub event_id: String,
    pub new_time: String,
    pub reason: Option<String>,
}

// ── Venues ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueLocation {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floor: Option<String>,
}

// ── Info ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfoItem {
    pub id: String,
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

// ── LiveData (the full response) ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveData {
    pub schedule: Vec<ScheduleEvent>,
    pub announcements: Vec<Announcement>,
    pub delays: Vec<DelayNotice>,
    pub venues: Vec<VenueLocation>,
    pub info: Vec<InfoItem>,
    pub last_updated: String,
}
