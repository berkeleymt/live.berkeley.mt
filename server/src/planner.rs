use crate::{content::ContentError, models::DelayNotice, operations::Operations, routes::AppState};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInput {
    pub from_id: String,
    pub delay_minutes: i32,
    pub absorb_id: String,
    pub absorb_minutes: i32,
    pub reason: String,
}
fn invalid(message: &str) -> ContentError {
    (StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn minutes(value: &str) -> i32 {
    let (h, m) = value.split_once(':').unwrap();
    h.parse::<i32>().unwrap() * 60 + m.parse::<i32>().unwrap()
}
fn clock(value: i32) -> Result<String, ContentError> {
    if !(0..1440).contains(&value) {
        return Err(invalid(
            "The adjustment crosses midnight. Use a smaller delay.",
        ));
    }
    Ok(format!("{:02}:{:02}", value / 60, value % 60))
}
/// Pure proposal: existing delays are respected; duration is preserved except the explicitly chosen break.
pub fn plan(original: &Operations, input: &PlanInput) -> Result<Operations, ContentError> {
    original.validate()?;
    if !(1..=180).contains(&input.delay_minutes)
        || input.absorb_minutes < 0
        || input.absorb_minutes > input.delay_minutes
        || input.reason.trim().is_empty()
        || input.reason.len() > 1000
    {
        return Err(invalid("Choose a delay of 1–180 minutes, absorption no greater than the delay, and a public reason."));
    }
    let mut ordered = original.schedule.clone();
    ordered.sort_by_key(|e| e.start_time.clone());
    let from = ordered
        .iter()
        .position(|e| e.id == input.from_id)
        .ok_or_else(|| invalid("Select a starting event."))?;
    let absorb = ordered
        .iter()
        .position(|e| e.id == input.absorb_id)
        .ok_or_else(|| invalid("Select the break that can absorb time."))?;
    if absorb < from {
        return Err(invalid(
            "The absorbing break must be at or after the starting event.",
        ));
    }
    if ordered[absorb].category != "general" {
        return Err(invalid("Only a general break can absorb time; competition rounds and ceremonies keep their duration."));
    }
    let mut result = original.clone();
    for (index, event) in ordered.iter().enumerate().skip(from) {
        let old = original.delays.iter().find(|d| d.event_id == event.id);
        let start = minutes(
            old.and_then(|d| d.new_time.as_deref())
                .unwrap_or(&event.start_time),
        );
        let end = minutes(
            old.and_then(|d| d.new_end_time.as_deref())
                .unwrap_or(&event.end_time),
        );
        if index == absorb && end - start - input.absorb_minutes < 15 {
            return Err(invalid("Keep at least 15 minutes in the absorbing break."));
        }
        let start_shift = input.delay_minutes
            - if index > absorb {
                input.absorb_minutes
            } else {
                0
            };
        let end_shift = input.delay_minutes
            - if index >= absorb {
                input.absorb_minutes
            } else {
                0
            };
        result.delays.retain(|d| d.event_id != event.id);
        result.delays.push(DelayNotice {
            id: uuid::Uuid::new_v4().to_string(),
            event_id: event.id.clone(),
            event_title: event.title.clone(),
            original_time: event.start_time.clone(),
            original_end_time: Some(event.end_time.clone()),
            new_time: Some(clock(start + start_shift)?),
            new_end_time: Some(clock(end + end_shift)?),
            reason: Some(input.reason.trim().into()),
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }
    result.validate()?;
    Ok(result)
}
pub fn version(content: &Operations) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(content).unwrap()))
}
fn token(revision: &str, input: &PlanInput) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!(
            "{revision}:{}",
            serde_json::to_string(input).unwrap()
        ))
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    revision: String,
    plan: PlanInput,
    confirmation: Option<String>,
}
pub async fn preview(
    State(state): State<AppState>,
    Json(input): Json<PlanInput>,
) -> Result<Json<Value>, ContentError> {
    let (revision, original) = match &state.operations {
        Some(store) => {
            let s = store.snapshot();
            (s.revision, s.content)
        }
        None => {
            let o = Operations::from_live(state.db.get_live_data(None, true));
            (version(&o), o)
        }
    };
    let proposed = plan(&original, &input)?;
    let rows: Vec<_> = original.schedule.iter().filter_map(|event| {
        let new=proposed.delays.iter().find(|d| d.event_id==event.id)?;
        let old=original.delays.iter().find(|d| d.event_id==event.id);
        Some(json!({"id":event.id,"title":event.title,"beforeStart":old.and_then(|d| d.new_time.as_ref()).unwrap_or(&event.start_time),"beforeEnd":old.and_then(|d| d.new_end_time.as_ref()).unwrap_or(&event.end_time),"afterStart":new.new_time,"afterEnd":new.new_end_time}))
    }).collect();
    Ok(Json(
        json!({"revision":revision,"confirmation":token(&revision,&input),"plan":input,"rows":rows}),
    ))
}
pub async fn apply(
    State(state): State<AppState>,
    Json(input): Json<Review>,
) -> Result<Json<Value>, ContentError> {
    if input.confirmation.as_deref() != Some(&token(&input.revision, &input.plan)) {
        return Err((
            StatusCode::PRECONDITION_REQUIRED,
            "Preview and explicitly confirm this exact plan first.".into(),
        ));
    }
    let revision = match &state.operations {
        Some(store) => store.apply_plan(&input.revision, &input.plan).await?,
        None => state.db.apply_schedule_plan(&input.revision, &input.plan)?,
    };
    crate::publishing::sync_editorial(&state);
    Ok(Json(json!({"revision":revision})))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Operations {
        serde_json::from_value(json!({"schedule":[
        {"id":"round","title":"Round","startTime":"10:00","endTime":"11:00","location":"Demo","category":"team"},
        {"id":"lunch","title":"Lunch","startTime":"11:00","endTime":"12:00","location":"Demo","category":"general"},
        {"id":"awards","title":"Awards","startTime":"12:00","endTime":"13:00","location":"Demo","category":"ceremony"}],"delays":[],"announcements":[]})).unwrap()
    }
    fn input() -> PlanInput {
        PlanInput {
            from_id: "round".into(),
            delay_minutes: 30,
            absorb_id: "lunch".into(),
            absorb_minutes: 15,
            reason: "Demo timing adjustment".into(),
        }
    }
    #[test]
    fn absorbs_fifteen_without_shortening_rounds() {
        let before = fixture();
        let after = plan(&before, &input()).unwrap();
        assert!(before.delays.is_empty());
        assert_eq!(after.delays[0].new_time.as_deref(), Some("10:30"));
        assert_eq!(after.delays[0].new_end_time.as_deref(), Some("11:30"));
        assert_eq!(after.delays[1].new_end_time.as_deref(), Some("12:15"));
        assert_eq!(after.delays[2].new_time.as_deref(), Some("12:15"));
    }
    #[test]
    fn rejects_invalid_absorption_and_midnight() {
        let mut i = input();
        i.absorb_minutes = 31;
        assert!(plan(&fixture(), &i).is_err());
        i = input();
        i.absorb_id = "round".into();
        assert!(plan(&fixture(), &i).is_err());
        i = input();
        i.from_id = "awards".into();
        assert!(plan(&fixture(), &i).is_err());
        let mut o = fixture();
        o.schedule[2].start_time = "23:00".into();
        o.schedule[2].end_time = "23:55".into();
        assert!(plan(&o, &input()).is_err());
    }
}
