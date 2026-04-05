use rusqlite::{Connection, params};
use std::sync::Mutex;

use crate::models::*;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &str) -> Self {
        let conn = Connection::open(path).expect("failed to open database");

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("failed to set pragmas");

        let db = Db {
            conn: Mutex::new(conn),
        };
        db.migrate();
        db
    }

    fn migrate(&self) {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schedule (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                start_time  TEXT NOT NULL,
                end_time    TEXT NOT NULL,
                location    TEXT NOT NULL,
                category    TEXT NOT NULL DEFAULT 'general',
                description TEXT,
                sort_order  INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS announcements (
                id        TEXT PRIMARY KEY,
                title     TEXT NOT NULL,
                body      TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                priority  TEXT NOT NULL DEFAULT 'normal',
                pinned    INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS delays (
                id            TEXT PRIMARY KEY,
                event_id      TEXT NOT NULL,
                new_time      TEXT NOT NULL,
                reason        TEXT,
                timestamp     TEXT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES schedule(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS venues (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                short_name  TEXT NOT NULL,
                description TEXT NOT NULL,
                floor       TEXT
            );

            CREATE TABLE IF NOT EXISTS info (
                id    TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                value TEXT NOT NULL,
                icon  TEXT
            );
            ",
        )
        .expect("failed to run migrations");
    }

    /// Seed the database with initial data if tables are empty.
    pub fn seed_if_empty(&self) {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schedule", [], |r| r.get(0))
            .unwrap_or(0);
        if count > 0 {
            return;
        }

        // Schedule
        let events = [
            ("s1", "Check-in (Coaches Only)", "08:00", "08:45", "Dwinelle Hall", "general", Some("Coaches should proceed to Dwinelle Hall for check-in and materials pick-up. Room assignments, sticker sheets, and tournament guides will be distributed.")),
            ("s2", "Puzzle Round", "09:00", "10:15", "Dwinelle Hall & Wheeler Hall", "team", Some("75-minute team-based round with a variety of mathematical puzzles. Report to your assigned classroom.")),
            ("s3", "Individual Round", "10:30", "11:30", "Dwinelle Hall & Wheeler Hall", "individual", Some("60-minute individual test, 20 questions. No calculators. Remain in your assigned classroom.")),
            ("s4", "Lunch", "11:30", "12:30", "Outside Dwinelle Hall", "general", Some("Pre-purchased lunches (Crave Subs) available for pick-up outside Dwinelle Hall. Restaurants also nearby on south side of campus and in Downtown Berkeley.")),
            ("s5", "Team Round", "12:45", "13:45", "Dwinelle Hall & Wheeler Hall", "team", Some("60-minute team test, 20 questions. Work with your team of up to 5 in your assigned classroom.")),
            ("s6", "Relay Round", "13:45", "14:25", "Dwinelle Hall & Wheeler Hall", "team", Some("40-minute relay-style round. Teams pass answers down the line. Stay in your assigned classroom.")),
            ("s7", "Activities", "14:45", "16:00", "Various Locations", "general", Some("Fun math activities and campus exploration while scores are tabulated. Check the info booth for details.")),
            ("s8", "Awards Ceremony", "17:00", "18:00", "Pauley Ballroom & Dwinelle 155", "ceremony", Some("Results announcement and trophy presentation. Report to your assigned awards room. Tiebreaker qualifiers will be announced after the Relay Round.")),
        ];
        for (i, (id, title, start, end, loc, cat, desc)) in events.iter().enumerate() {
            conn.execute(
                "INSERT INTO schedule (id, title, start_time, end_time, location, category, description, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, title, start, end, loc, cat, desc, i as i64],
            ).unwrap();
        }

        // Announcements
        let anns = [
            ("a1", "Welcome to BmMT 2026!", "We're excited to have you at UC Berkeley for the Berkeley mini Math Tournament! Coaches: head to Dwinelle Hall for check-in. Students: find your team and wait for your coach to return with room assignments.", "normal", true),
            ("a2", "Room assignments distributed", "Room assignments are on the sticker sheets given to coaches at check-in. You'll be in classrooms in Dwinelle Hall or Wheeler Hall. Check the campus map if you need directions.", "normal", false),
            ("a3", "Lunch pick-up location update", "Pre-purchased lunches from Crave Subs will be available outside Dwinelle Hall starting at 11:30 AM. Please have your ticket ready. Vegetarian and vegan options labeled separately.", "urgent", false),
        ];
        for (id, title, body, priority, pinned) in &anns {
            conn.execute(
                "INSERT INTO announcements (id, title, body, timestamp, priority, pinned) VALUES (?1, ?2, ?3, datetime('now'), ?4, ?5)",
                params![id, title, body, priority, *pinned as i32],
            ).unwrap();
        }

        // Venues
        let venues = [
            ("v1", "Dwinelle Hall", "Dwinelle", "Main venue for check-in, testing rooms, and awards. Coaches check in at Dwinelle 145/155.", Some("Multiple floors")),
            ("v2", "Wheeler Hall", "Wheeler", "Overflow testing rooms for Puzzle, Individual, Team, and Relay rounds.", Some("1F–2F")),
            ("v3", "Pauley Ballroom", "Pauley", "Awards ceremony location (shared with Dwinelle 155). Located in Martin Luther King Jr. Student Union.", None),
            ("v4", "South Side & Downtown Berkeley", "Food", "Restaurants within a 5–15 minute walk from campus for those not purchasing lunch.", None),
        ];
        for (id, name, short, desc, floor) in &venues {
            conn.execute(
                "INSERT INTO venues (id, name, short_name, description, floor) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, name, short, desc, floor],
            ).unwrap();
        }

        // Info
        let infos = [
            ("i1", "Wi-Fi", "CalVisitor (no password)"),
            ("i2", "Emergency", "UCPD: 510-642-3333"),
            ("i3", "Lost & Found", "Information booth near Dwinelle"),
            ("i4", "Restrooms", "Dwinelle 1F, Wheeler 1F"),
            ("i5", "Disputes", "Wheeler 126, during lunch only"),
            ("i6", "Contact Staff", "team@berkeley.mt"),
            ("i7", "Campus Map", "berkeley.edu/map (PDF)"),
            ("i8", "Parking", "See UC Berkeley Parking website"),
        ];
        for (id, label, value) in &infos {
            conn.execute(
                "INSERT INTO info (id, label, value) VALUES (?1, ?2, ?3)",
                params![id, label, value],
            ).unwrap();
        }
    }

    // ── Queries ──

    pub fn get_live_data(&self) -> LiveData {
        let conn = self.conn.lock().unwrap();

        let schedule = {
            let mut stmt = conn
                .prepare("SELECT id, title, start_time, end_time, location, category, description FROM schedule ORDER BY sort_order")
                .unwrap();
            stmt.query_map([], |row| {
                Ok(ScheduleEvent {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                    location: row.get(4)?,
                    category: row.get(5)?,
                    description: row.get(6)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
        };

        let announcements = {
            let mut stmt = conn
                .prepare("SELECT id, title, body, timestamp, priority, pinned FROM announcements ORDER BY timestamp DESC")
                .unwrap();
            stmt.query_map([], |row| {
                let pinned_val: i32 = row.get(5)?;
                Ok(Announcement {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    body: row.get(2)?,
                    timestamp: row.get(3)?,
                    priority: row.get(4)?,
                    pinned: if pinned_val != 0 { Some(true) } else { None },
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
        };

        let delays = {
            let mut stmt = conn
                .prepare(
                    "SELECT d.id, d.event_id, s.title, s.start_time, d.new_time, d.reason, d.timestamp
                     FROM delays d
                     JOIN schedule s ON s.id = d.event_id
                     ORDER BY d.timestamp DESC"
                )
                .unwrap();
            stmt.query_map([], |row| {
                Ok(DelayNotice {
                    id: row.get(0)?,
                    event_id: row.get(1)?,
                    event_title: row.get(2)?,
                    original_time: row.get(3)?,
                    new_time: row.get(4)?,
                    reason: row.get(5)?,
                    timestamp: row.get(6)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
        };

        let venues = {
            let mut stmt = conn
                .prepare("SELECT id, name, short_name, description, floor FROM venues")
                .unwrap();
            stmt.query_map([], |row| {
                Ok(VenueLocation {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    short_name: row.get(2)?,
                    description: row.get(3)?,
                    floor: row.get(4)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
        };

        let info = {
            let mut stmt = conn
                .prepare("SELECT id, label, value, icon FROM info")
                .unwrap();
            stmt.query_map([], |row| {
                Ok(InfoItem {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    value: row.get(2)?,
                    icon: row.get(3)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
        };

        LiveData {
            schedule,
            announcements,
            delays,
            venues,
            info,
            last_updated: chrono::Utc::now().to_rfc3339(),
        }
    }

    // ── Schedule CRUD ──

    pub fn update_schedule_event(&self, id: &str, input: &ScheduleEventInput) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn
            .execute(
                "UPDATE schedule SET title=?1, start_time=?2, end_time=?3, location=?4, category=?5, description=?6 WHERE id=?7",
                params![input.title, input.start_time, input.end_time, input.location, input.category, input.description, id],
            )
            .unwrap_or(0);
        rows > 0
    }

    pub fn create_schedule_event(&self, input: &ScheduleEventInput) -> ScheduleEvent {
        let conn = self.conn.lock().unwrap();
        let id = format!("s{}", chrono::Utc::now().timestamp_millis());
        let max_order: i64 = conn
            .query_row("SELECT COALESCE(MAX(sort_order), 0) FROM schedule", [], |r| r.get(0))
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO schedule (id, title, start_time, end_time, location, category, description, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, input.title, input.start_time, input.end_time, input.location, input.category, input.description, max_order + 1],
        ).unwrap();
        ScheduleEvent {
            id,
            title: input.title.clone(),
            start_time: input.start_time.clone(),
            end_time: input.end_time.clone(),
            location: input.location.clone(),
            category: input.category.clone(),
            description: input.description.clone(),
        }
    }

    pub fn delete_schedule_event(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM schedule WHERE id=?1", params![id]).unwrap_or(0);
        rows > 0
    }

    // ── Delays CRUD ──

    pub fn create_delay(&self, input: &DelayInput) -> Option<DelayNotice> {
        let conn = self.conn.lock().unwrap();
        let id = format!("d{}", chrono::Utc::now().timestamp_millis());
        let timestamp = chrono::Utc::now().to_rfc3339();

        // Look up event title and original time
        let event = conn
            .query_row(
                "SELECT title, start_time FROM schedule WHERE id=?1",
                params![input.event_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .ok()?;

        conn.execute(
            "INSERT INTO delays (id, event_id, new_time, reason, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, input.event_id, input.new_time, input.reason, timestamp],
        )
        .ok()?;

        Some(DelayNotice {
            id,
            event_id: input.event_id.clone(),
            event_title: event.0,
            original_time: event.1,
            new_time: input.new_time.clone(),
            reason: input.reason.clone(),
            timestamp,
        })
    }

    pub fn delete_delay(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM delays WHERE id=?1", params![id]).unwrap_or(0);
        rows > 0
    }

    // ── Announcements CRUD ──

    pub fn create_announcement(&self, input: &AnnouncementInput) -> Announcement {
        let conn = self.conn.lock().unwrap();
        let id = format!("a{}", chrono::Utc::now().timestamp_millis());
        let timestamp = chrono::Utc::now().to_rfc3339();
        let priority = input.priority.as_deref().unwrap_or("normal");
        let pinned = input.pinned.unwrap_or(false);

        conn.execute(
            "INSERT INTO announcements (id, title, body, timestamp, priority, pinned) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.title, input.body, timestamp, priority, pinned as i32],
        ).unwrap();

        Announcement {
            id,
            title: input.title.clone(),
            body: input.body.clone(),
            timestamp,
            priority: priority.to_string(),
            pinned: if pinned { Some(true) } else { None },
        }
    }

    pub fn delete_announcement(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM announcements WHERE id=?1", params![id]).unwrap_or(0);
        rows > 0
    }
}
