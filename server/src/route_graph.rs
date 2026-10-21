//! Public bounded route geometry; editorial assertions are not physical verification.
use super::{id, invalid, safe_image, text, Result, WayfindingContent};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Graph {
    pub demonstration: bool,
    pub maps: Vec<Map>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Map {
    pub id: String,
    pub label: String,
    pub floor_id: Option<String>,
    pub image: Option<super::FloorImage>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub map_id: String,
    pub room_id: Option<String>,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: Kind,
    pub cost: u32,
    pub step_free: bool,
    pub closed: bool,
    pub status: super::Verification,
    pub verification_note: String,
    pub instruction: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Path,
    Stairs,
    Elevator,
    Entrance,
}
impl Graph {
    pub fn validate(&self, c: &WayfindingContent) -> Result<()> {
        let fail = || {
            invalid("Route graph needs bounded unique maps/nodes/edges, valid references and geometry, directed steps and honest verification/accessibility metadata.")
        };
        if self.maps.len() > 40 || self.nodes.len() > 1500 || self.edges.len() > 5000 {
            return Err(fail());
        }
        let mut maps = HashSet::new();
        let mut nodes = HashSet::new();
        let mut edges = HashSet::new();
        let mut rooms = HashSet::new();
        for m in &self.maps {
            if !id(&m.id) || !maps.insert(&m.id) || !text(&m.label, 120) {
                return Err(fail());
            }
            if let Some(floor) = &m.floor_id {
                if !c
                    .buildings
                    .iter()
                    .flat_map(|b| &b.floors)
                    .any(|f| &f.id == floor)
                {
                    return Err(fail());
                }
            }
            if let Some(img) = &m.image {
                if !safe_image(&img.url)
                    || !text(&img.alt, 500)
                    || !text(&img.caption, 500)
                    || (img.url.starts_with("/demo-maps/") && !img.demonstration)
                    || (img.demonstration && !self.demonstration)
                {
                    return Err(fail());
                }
            }
        }
        for n in &self.nodes {
            if !id(&n.id)
                || !nodes.insert(&n.id)
                || !text(&n.label, 120)
                || !maps.contains(&n.map_id)
                || ![n.x, n.y]
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=100.0).contains(v))
            {
                return Err(fail());
            }
            if let Some(room) = &n.room_id {
                if !rooms.insert(room) || !c.has_room(room) {
                    return Err(fail());
                }
                let m = self.maps.iter().find(|m| m.id == n.map_id).unwrap();
                if !c.buildings.iter().any(|b| {
                    b.floors.iter().any(|f| {
                        m.floor_id.as_ref() == Some(&f.id) && f.rooms.iter().any(|r| &r.id == room)
                    }) && (self.demonstration
                        || matches!(
                            b.status,
                            super::Verification::Verified | super::Verification::Mapped
                        ))
                }) {
                    return Err(fail());
                }
            }
        }
        for e in &self.edges {
            if !id(&e.id)
                || !edges.insert(&e.id)
                || e.from == e.to
                || !nodes.contains(&e.from)
                || !nodes.contains(&e.to)
                || e.cost == 0
                || e.cost > 100_000
                || !text(&e.instruction, 500)
                || !text(&e.verification_note, 500)
                || (e.step_free && e.kind == Kind::Stairs)
                || (e.step_free && matches!(e.status, super::Verification::Mapped))
                || (matches!(e.status, super::Verification::Demo) && !self.demonstration)
            {
                return Err(fail());
            }
            let a = self.nodes.iter().find(|n| n.id == e.from).unwrap();
            let b = self.nodes.iter().find(|n| n.id == e.to).unwrap();
            if a.map_id != b.map_id && e.kind == Kind::Path {
                return Err(invalid("Cross-map edges must explicitly identify stairs, elevator or entrance transitions."));
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_dangling_stairs_and_false_verification() {
        let mut c: WayfindingContent =
            serde_json::from_str(include_str!("../../content/wayfinding.json")).unwrap();
        c.validate().unwrap();
        let graph = c.graph.as_mut().unwrap();
        graph.edges[0].to = "missing".into();
        assert!(c.validate().is_err());
        let mut c: WayfindingContent =
            serde_json::from_str(include_str!("../../content/wayfinding.json")).unwrap();
        c.graph.as_mut().unwrap().edges[0].kind = Kind::Stairs;
        c.graph.as_mut().unwrap().edges[0].step_free = true;
        assert!(c.validate().is_err());
        c.graph.as_mut().unwrap().demonstration = false;
        assert!(c.validate().is_err());
        c.graph = None;
        c.validate().unwrap(); // pre-graph content remains valid
    }
}
