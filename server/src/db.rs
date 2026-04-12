use rusqlite::{Connection, params};
use std::sync::Mutex;

use crate::models::*;

/// Consistent UTC timestamp format used everywhere (sorts lexicographically).
fn utc_now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Build a UTC timestamp for a given local (h, m) today — used by seed data.
fn local_hm_to_utc(h: u32, m: u32) -> String {
    use chrono::{Local, NaiveTime, TimeZone};
    let today = Local::now().date_naive();
    let naive = today.and_time(NaiveTime::from_hms_opt(h, m, 0).unwrap());
    let local = Local.from_local_datetime(&naive).single().unwrap();
    local.to_utc().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

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
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL,
                body         TEXT NOT NULL,
                timestamp    TEXT NOT NULL,
                priority     TEXT NOT NULL DEFAULT 'normal',
                pinned       INTEGER NOT NULL DEFAULT 0,
                scheduled_at TEXT
            );

            CREATE TABLE IF NOT EXISTS delays (
                id            TEXT PRIMARY KEY,
                event_id      TEXT NOT NULL,
                new_time      TEXT,
                new_end_time  TEXT,
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

            CREATE TABLE IF NOT EXISTS email_subscribers (
                id                TEXT PRIMARY KEY,
                email             TEXT NOT NULL UNIQUE,
                unsubscribe_token TEXT NOT NULL UNIQUE,
                created_at        TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS email_log (
                id              TEXT PRIMARY KEY,
                announcement_id TEXT NOT NULL,
                sent_at         TEXT NOT NULL
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
            ("s1", "Check-in (Coaches Only)", "07:45", "09:00", "Dwinelle 145 / Dwinelle 155", "general", Some("Coaches check in at Dwinelle 145, or pick up materials at Dwinelle 155 if checked in online. Check-in closes promptly at 9:00 AM.")),
            ("s2", "Puzzle Round", "09:00", "10:15", "Pauley Ballroom, VLSB, Dwinelle & Wheeler", "team", Some("75-minute team-based round with a variety of mathematical puzzles. Report to your assigned classroom.")),
            ("s3", "Individual Round", "10:15", "11:15", "Pauley Ballroom, VLSB, Dwinelle & Wheeler", "individual", Some("60-minute individual test, 20 questions. No calculators. Remain in your assigned classroom.")),
            ("s4", "Lunch", "12:00", "13:15", "Kerr Lobby (MLK Student Union)", "general", Some("Pre-ordered lunches (Crave Subs) available for pick-up inside Kerr Lobby. T-shirt & tote bag sales and free sponsor merch also in Kerr Lobby. Restaurants nearby on south side of campus and in Downtown Berkeley.")),
            ("s5", "Team Round", "13:15", "14:15", "Pauley Ballroom, VLSB, Dwinelle & Wheeler", "team", Some("60-minute team test, 20 questions. Work with your team of up to 5 in your assigned classroom.")),
            ("s6", "Relay Round", "14:15", "14:55", "Pauley Ballroom, VLSB, Dwinelle & Wheeler", "team", Some("40-minute relay-style round. Some questions depend on answers from prior questions. Stay in your assigned classroom.")),
            ("s7", "Activities & Tiebreaker", "15:30", "17:00", "Various Locations", "general", Some("Student activities in Dwinelle Hall and Pauley Ballroom. Tiebreaker (by invite) in Dwinelle 229. Problem disputes (Team, Relay) in Dwinelle 234 from 3:30–4:00 PM.")),
            ("s8", "Awards Ceremony", "17:00", "18:00", "Multiple Auditoriums", "ceremony", Some("Awards presented simultaneously in multiple auditoriums. Report to your assigned awards room — going to a different room may delay your award.")),
        ];
        for (i, (id, title, start, end, loc, cat, desc)) in events.iter().enumerate() {
            conn.execute(
                "INSERT INTO schedule (id, title, start_time, end_time, location, category, description, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, title, start, end, loc, cat, desc, i as i64],
            ).unwrap();
        }

        // Announcements — timestamps aligned with the schedule so the dev
        // time-slider shows realistic data.
        let anns: [(&str, &str, &str, &str, bool, String, Option<String>); 4] = [
            ("a1", "Welcome to BmMT 2026!", "We're excited to have you at UC Berkeley for the Berkeley mini Math Tournament! Coaches: head to Dwinelle Hall for check-in. Students: find your team and wait for your coach to return with room assignments.", "normal", true, local_hm_to_utc(8, 0), None),
            ("a2", "Room assignments distributed", "Room assignments are on the sticker sheets given to coaches at check-in. You'll be in Pauley Ballroom or classrooms in VLSB, Dwinelle Hall, or Wheeler Hall. Check the campus map if you need directions.", "normal", false, local_hm_to_utc(8, 30), None),
            ("a3", "Lunch pick-up location update", "Pre-ordered lunches from Crave Subs available for pick-up inside Kerr Lobby (MLK Student Union) from 11:30 AM. Please have your voucher ready. Vegetarian and vegan options labeled separately.", "urgent", false, local_hm_to_utc(11, 15), None),
            ("a4", "Tiebreaker qualifiers announced", "Tiebreaker qualifiers have been posted to the website and emailed to coaches. If you qualified, please report to Dwinelle 229 by 3:45 PM.", "normal", false, local_hm_to_utc(14, 30), Some(local_hm_to_utc(15, 15))),
        ];
        for (id, title, body, priority, pinned, ts, scheduled_at) in &anns {
            conn.execute(
                "INSERT INTO announcements (id, title, body, timestamp, priority, pinned, scheduled_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, title, body, ts, priority, *pinned as i32, scheduled_at],
            ).unwrap();
        }

        // Venues
        let venues = [
            ("v1", "Dwinelle Hall", "Dwinelle", "Main venue for check-in, testing rooms, information desk, and activities. Coaches check in at Dwinelle 145/155.", Some("Multiple floors")),
            ("v2", "Wheeler Hall", "Wheeler", "Testing rooms for Puzzle, Individual, Team, and Relay rounds.", Some("1F–2F")),
            ("v3", "Pauley Ballroom", "Pauley", "Testing room and Puzzle Hunt activity. Located in Martin Luther King Jr. Student Union.", None),
            ("v4", "Valley Life Sciences Building", "VLSB", "Testing rooms for Puzzle, Individual, Team, and Relay rounds.", None),
            ("v5", "Kerr Lobby (MLK Student Union)", "MLK", "Pre-ordered lunch pick-up, T-shirt & tote bag sales, free sponsor merch.", None),
            ("v6", "South Side & Downtown Berkeley", "Food", "Restaurants within a 5–15 minute walk from campus for those not purchasing lunch.", None),
        ];
        for (id, name, short, desc, floor) in &venues {
            conn.execute(
                "INSERT INTO venues (id, name, short_name, description, floor) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, name, short, desc, floor],
            ).unwrap();
        }

        // Info
        let infos = [
            ("i1", "Wi-Fi", "Berkeley-Visitor (no password)"),
            ("i2", "Emergency", "911 or UCPD: 510-642-3333"),
            ("i3", "Information Desk", "Inside Dwinelle Hall (from 8 AM)"),
            ("i4", "Restrooms", "Dwinelle Hall, Wheeler Hall"),
            ("i5", "Disputes", "Dwinelle 234 (12–12:30 & 3:30–4)"),
            ("i6", "Contact Staff", "team@berkeley.mt"),
            ("i7", "Campus Map", "berkeley.edu/map"),
            ("i8", "Parking", "Telegraph-Channing Garage rec'd"),
        ];
        for (id, label, value) in &infos {
            conn.execute(
                "INSERT INTO info (id, label, value) VALUES (?1, ?2, ?3)",
                params![id, label, value],
            ).unwrap();
        }

        // Delays — timestamped so they appear at realistic points during the day
        let delays: [(&str, &str, Option<&str>, Option<&str>, Option<&str>, String); 4] = [
            ("d1", "s3", Some("11:10"), Some("11:50"), Some("Puzzle round ran over"), local_hm_to_utc(10, 20)),
            ("d2", "s4", Some("12:10"), Some("12:50"), Some("Individual round pushed back"), local_hm_to_utc(11, 0)),
            ("d3", "s5", Some("13:25"), Some("14:25"), Some("Extended lunch break"), local_hm_to_utc(12, 15)),
            ("d4", "s2", None, Some("10:30"), Some("Extra time for puzzle round"), local_hm_to_utc(9, 45)),
        ];
        for (id, event_id, new_time, new_end_time, reason, ts) in &delays {
            conn.execute(
                "INSERT INTO delays (id, event_id, new_time, new_end_time, reason, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, event_id, new_time, new_end_time, reason, ts],
            ).unwrap();
        }
    }

    // ── Queries ──

    pub fn get_live_data(&self, at: Option<&str>, include_future: bool) -> LiveData {
        let conn = self.conn.lock().unwrap();
        let effective_now = at.map(|s| s.to_string()).unwrap_or_else(|| utc_now_ts());

        let schedule = {
            let mut stmt = conn
                .prepare("SELECT id, title, start_time, end_time, location, category, description FROM schedule ORDER BY start_time")
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
            let query = if include_future {
                "SELECT id, title, body, timestamp, priority, pinned, scheduled_at FROM announcements ORDER BY COALESCE(scheduled_at, timestamp) DESC"
            } else {
                "SELECT id, title, body, timestamp, priority, pinned, scheduled_at FROM announcements WHERE COALESCE(scheduled_at, timestamp) <= ?1 ORDER BY COALESCE(scheduled_at, timestamp) DESC"
            };
            let mut stmt = conn.prepare(query).unwrap();
            let params_slice: Vec<&dyn rusqlite::ToSql> = if include_future {
                vec![]
            } else {
                vec![&effective_now]
            };
            stmt.query_map(params_slice.as_slice(), |row| {
                let pinned_val: i32 = row.get(5)?;
                Ok(Announcement {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    body: row.get(2)?,
                    timestamp: row.get(3)?,
                    priority: row.get(4)?,
                    pinned: if pinned_val != 0 { Some(true) } else { None },
                    scheduled_at: row.get(6)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
        };

        let delays = {
            let mut stmt = conn
                .prepare(
                    "SELECT d.id, d.event_id, s.title, s.start_time, d.new_time, s.end_time, d.new_end_time, d.reason, d.timestamp
                     FROM delays d
                     JOIN schedule s ON s.id = d.event_id
                     WHERE d.timestamp <= ?1
                     ORDER BY d.timestamp DESC"
                )
                .unwrap();
            stmt.query_map(params![effective_now], |row| {
                Ok(DelayNotice {
                    id: row.get(0)?,
                    event_id: row.get(1)?,
                    event_title: row.get(2)?,
                    original_time: row.get(3)?,
                    new_time: row.get(4)?,
                    original_end_time: row.get(5)?,
                    new_end_time: row.get(6)?,
                    reason: row.get(7)?,
                    timestamp: row.get(8)?,
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
            last_updated: utc_now_ts(),
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
        let timestamp = utc_now_ts();

        // Remove any existing delay for this event (one delay per event)
        conn.execute("DELETE FROM delays WHERE event_id=?1", params![input.event_id]).ok();

        // Look up event title and original times
        let event = conn
            .query_row(
                "SELECT title, start_time, end_time FROM schedule WHERE id=?1",
                params![input.event_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .ok()?;

        conn.execute(
            "INSERT INTO delays (id, event_id, new_time, new_end_time, reason, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.event_id, input.new_time, input.new_end_time, input.reason, timestamp],
        )
        .ok()?;

        Some(DelayNotice {
            id,
            event_id: input.event_id.clone(),
            event_title: event.0,
            original_time: event.1,
            new_time: input.new_time.clone(),
            original_end_time: Some(event.2),
            new_end_time: input.new_end_time.clone(),
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
        let timestamp = utc_now_ts();
        let priority = input.priority.as_deref().unwrap_or("normal");
        let pinned = input.pinned.unwrap_or(false);

        conn.execute(
            "INSERT INTO announcements (id, title, body, timestamp, priority, pinned, scheduled_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, input.title, input.body, timestamp, priority, pinned as i32, input.scheduled_at],
        ).unwrap();

        Announcement {
            id,
            title: input.title.clone(),
            body: input.body.clone(),
            timestamp,
            priority: priority.to_string(),
            pinned: if pinned { Some(true) } else { None },
            scheduled_at: input.scheduled_at.clone(),
        }
    }

    pub fn update_announcement(&self, id: &str, input: &AnnouncementInput) -> bool {
        let conn = self.conn.lock().unwrap();
        let priority = input.priority.as_deref().unwrap_or("normal");
        let pinned = input.pinned.unwrap_or(false);
        let rows = conn
            .execute(
                "UPDATE announcements SET title=?1, body=?2, priority=?3, pinned=?4, scheduled_at=?5 WHERE id=?6",
                params![input.title, input.body, priority, pinned as i32, input.scheduled_at, id],
            )
            .unwrap_or(0);
        rows > 0
    }

    pub fn delete_announcement(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM announcements WHERE id=?1", params![id]).unwrap_or(0);
        rows > 0
    }

    // ── Email Subscribers ──

    pub fn add_subscriber(&self, email: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        let id = format!("sub{}", chrono::Utc::now().timestamp_millis());
        let token = uuid::Uuid::new_v4().to_string();
        let now = utc_now_ts();
        conn.execute(
            "INSERT OR IGNORE INTO email_subscribers (id, email, unsubscribe_token, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, email, token, now],
        ).ok()?;
        // Return None if nothing was inserted (email already exists)
        if conn.changes() == 0 { return None; }
        Some(token)
    }

    pub fn remove_subscriber_by_token(&self, token: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "DELETE FROM email_subscribers WHERE unsubscribe_token=?1",
            params![token],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn get_all_subscribers(&self) -> Vec<(String, String)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT email, unsubscribe_token FROM email_subscribers")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn has_email_been_sent(&self, announcement_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM email_log WHERE announcement_id=?1",
                params![announcement_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        count > 0
    }

    pub fn mark_email_sent(&self, announcement_id: &str) {
        let conn = self.conn.lock().unwrap();
        let id = format!("el{}", chrono::Utc::now().timestamp_millis());
        let now = utc_now_ts();
        conn.execute(
            "INSERT INTO email_log (id, announcement_id, sent_at) VALUES (?1, ?2, ?3)",
            params![id, announcement_id, now],
        ).ok();
    }

    /// Find scheduled announcements whose scheduled_at <= now and haven't been emailed yet.
    pub fn get_due_unsent_announcements(&self) -> Vec<Announcement> {
        let conn = self.conn.lock().unwrap();
        let now = utc_now_ts();
        let mut stmt = conn
            .prepare(
                "SELECT a.id, a.title, a.body, a.timestamp, a.priority, a.pinned, a.scheduled_at
                 FROM announcements a
                 WHERE a.scheduled_at IS NOT NULL
                   AND a.scheduled_at <= ?1
                   AND a.id NOT IN (SELECT announcement_id FROM email_log)"
            )
            .unwrap();
        stmt.query_map(params![now], |row| {
            let pinned_val: i32 = row.get(5)?;
            Ok(Announcement {
                id: row.get(0)?,
                title: row.get(1)?,
                body: row.get(2)?,
                timestamp: row.get(3)?,
                priority: row.get(4)?,
                pinned: if pinned_val != 0 { Some(true) } else { None },
                scheduled_at: row.get(6)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }
}
