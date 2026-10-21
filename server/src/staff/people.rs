//! Private allowlist and fixed-lifetime sessions. Never part of public content/export.
use super::{digest, now, random_token, Role, Session, StaffIdentity, MAX_SESSIONS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Mutex,
};

pub type Failure = (axum::http::StatusCode, &'static str);
type Result<T> = std::result::Result<T, Failure>;
fn unavailable(_: rusqlite::Error) -> Failure {
    (
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "Staff storage is unavailable. Try again; no success is confirmed.",
    )
}

pub fn normalize_email(input: &str) -> std::result::Result<String, &'static str> {
    let email = input.trim().to_ascii_lowercase();
    let Some((local, domain)) = email.split_once('@') else {
        return Err("Enter a valid email address.");
    };
    if email.len() > 254
        || local.is_empty()
        || local.len() > 64
        || domain.is_empty()
        || !local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&b))
        || !domain.contains('.')
        || domain.split('.').any(|p| {
            p.is_empty()
                || p.starts_with('-')
                || p.ends_with('-')
                || !p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return Err("Enter a valid email address.");
    }
    Ok(email)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub email: String,
    pub role: Role,
    pub picture: Option<String>,
    pub fixed: bool,
    pub online: bool,
    pub added_by: String,
}

pub struct PeopleStore {
    db: Mutex<Connection>,
    fixed: HashSet<String>,
    presence: Mutex<HashMap<String, u64>>,
    pub demo: bool,
}

impl PeopleStore {
    pub fn open(
        path: Option<&Path>,
        fixed: HashSet<String>,
        demo: bool,
    ) -> std::result::Result<Self, String> {
        let db = if let Some(path) = path {
            if !path.is_absolute() {
                return Err("STAFF_STATE_PATH must be absolute".into());
            }
            let parent = path
                .parent()
                .ok_or("Missing staff state directory")?
                .canonicalize()
                .map_err(|_| "Create the private staff state directory first")?;
            for (variable, default, file) in [
                ("STATIC_DIR", "dist", false),
                ("SITE_MEDIA_DIR", "media", false),
                ("LIVE_CONTENT_REPO", "", false),
                ("LIVE_CONTENT_REMOTE_REPO", "", false),
                ("SITE_CONTENT_PATH", "content/site.json", true),
                ("EVENT_CONTENT_PATH", "content/event.json", true),
                ("WAYFINDING_CONTENT_PATH", "content/wayfinding.json", true),
            ] {
                let value = std::env::var(variable).unwrap_or_else(|_| default.into());
                if value.is_empty() {
                    continue;
                }
                let root = Path::new(&value);
                let root = if file {
                    root.parent().unwrap_or(root)
                } else {
                    root
                };
                if root
                    .canonicalize()
                    .is_ok_and(|root| parent.starts_with(root))
                {
                    return Err("Staff state must be outside public/content directories".into());
                }
            }
            // Never store private auth state anywhere inside a Git checkout.
            if parent.ancestors().any(|p| p.join(".git").exists()) {
                return Err("Staff state must be outside Git checkouts".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
                if std::fs::metadata(&parent)
                    .map_err(|_| "Cannot inspect staff directory")?
                    .permissions()
                    .mode()
                    & 0o077
                    != 0
                {
                    return Err("Private staff directory requires chmod 700".into());
                }
                if !path.exists() {
                    std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .mode(0o600)
                        .open(path)
                        .map_err(|_| "Cannot create private staff database")?;
                }
                let meta =
                    std::fs::symlink_metadata(path).map_err(|_| "Cannot inspect staff database")?;
                if !meta.is_file() || meta.permissions().mode() & 0o077 != 0 {
                    return Err(
                        "Staff database must be a regular private file (chmod 600), not a symlink"
                            .into(),
                    );
                }
            }
            Connection::open(path).map_err(|_| "Cannot open staff database")?
        } else {
            Connection::open_in_memory().map_err(|_| "Cannot open demo accounts")?
        };
        db.busy_timeout(std::time::Duration::from_millis(1500))
            .map_err(|_| "Cannot configure staff database")?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS staff_accounts(email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','super')), picture TEXT, added_by TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS staff_sessions(digest TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES staff_accounts(email) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);")
            .map_err(|_| "Cannot initialize staff database")?;
        // Environment supers are protected only while explicitly configured. No legacy import.
        for email in &fixed {
            db.execute("INSERT INTO staff_accounts(email,role,added_by) VALUES(?1,'super','environment') ON CONFLICT(email) DO UPDATE SET role='super'", [email]).map_err(|_| "Cannot configure bootstrap Super")?;
        }
        if demo {
            db.execute("INSERT OR IGNORE INTO staff_accounts(email,role,added_by) VALUES('admin@example.test','admin','synthetic demo')", []).map_err(|_| "Cannot seed demo")?;
        }
        Ok(Self {
            db: Mutex::new(db),
            fixed,
            presence: Mutex::new(HashMap::new()),
            demo,
        })
    }

    fn user(db: &Connection, email: &str, demo: bool) -> rusqlite::Result<Option<StaffIdentity>> {
        db.query_row(
            "SELECT role,picture FROM staff_accounts WHERE email=?1",
            [email],
            |row| {
                let role = if row.get::<_, String>(0)? == "super" {
                    Role::Super
                } else {
                    Role::Admin
                };
                Ok(StaffIdentity {
                    id: email.into(),
                    name: email.into(),
                    email: Some(email.into()),
                    picture: row.get(1)?,
                    role,
                    capabilities: role.capabilities(),
                    demo,
                    auth_source: if demo { "demo" } else { "google" }.into(),
                })
            },
        )
        .optional()
    }

    pub fn issue(
        &self,
        email: &str,
        picture: Option<String>,
        timestamp: u64,
        previous: Option<&str>,
    ) -> Result<(String, Session)> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(unavailable)?;
        let mut user = Self::user(&tx, email, self.demo)
            .map_err(unavailable)?
            .ok_or((
                axum::http::StatusCode::FORBIDDEN,
                "That Google account is not on the staff list. Ask a Super admin to add you.",
            ))?;
        tx.execute("DELETE FROM staff_sessions WHERE expires<=?1", [timestamp])
            .map_err(unavailable)?;
        let count: usize = tx
            .query_row("SELECT count(*) FROM staff_sessions", [], |r| r.get(0))
            .map_err(unavailable)?;
        if count >= MAX_SESSIONS {
            return Err((
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "Staff sessions are full. Try again later.",
            ));
        }
        if !self.demo {
            tx.execute(
                "UPDATE staff_accounts SET picture=?1 WHERE email=?2",
                params![picture, email],
            )
            .map_err(unavailable)?;
            user.picture = picture;
        }
        let token = random_token();
        let session = Session {
            user,
            csrf: random_token(),
            expires_at: timestamp + 86400,
        };
        tx.execute(
            "INSERT INTO staff_sessions VALUES(?1,?2,?3,?4)",
            params![digest(&token), email, session.csrf, session.expires_at],
        )
        .map_err(unavailable)?;
        if let Some(old) = previous {
            tx.execute("DELETE FROM staff_sessions WHERE digest=?1", [digest(old)])
                .map_err(unavailable)?;
        }
        tx.commit().map_err(unavailable)?;
        Ok((token, session))
    }

    pub fn session(&self, token: &str, timestamp: u64) -> Option<Session> {
        let db = self.db.lock().unwrap();
        let (email, csrf, expires_at): (String, String, u64) = db
            .query_row(
                "SELECT email,csrf,expires FROM staff_sessions WHERE digest=?1 AND expires>?2",
                params![digest(token), timestamp],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .ok()??;
        // Never authorize from the session's historical role.
        let user = Self::user(&db, &email, self.demo).ok()??;
        Some(Session {
            user,
            csrf,
            expires_at,
        })
    }

    pub fn revoke(&self, token: &str) -> Result<()> {
        self.db
            .lock()
            .unwrap()
            .execute(
                "DELETE FROM staff_sessions WHERE digest=?1",
                [digest(token)],
            )
            .map_err(unavailable)?;
        Ok(())
    }

    pub fn heartbeat(&self, email: &str) {
        let mut presence = self.presence.lock().unwrap();
        presence.retain(|_, last| now().saturating_sub(*last) < 30);
        presence.insert(email.into(), now());
    }

    pub fn list(&self) -> Result<Vec<Person>> {
        let db = self.db.lock().unwrap();
        let presence = self.presence.lock().unwrap();
        let mut statement = db
            .prepare(
                "SELECT email,role,picture,added_by FROM staff_accounts ORDER BY email LIMIT 2000",
            )
            .map_err(unavailable)?;
        let result = statement
            .query_map([], |row| {
                let email: String = row.get(0)?;
                Ok(Person {
                    fixed: self.fixed.contains(&email),
                    online: presence
                        .get(&email)
                        .is_some_and(|last| now().saturating_sub(*last) < 30),
                    email,
                    role: if row.get::<_, String>(1)? == "super" {
                        Role::Super
                    } else {
                        Role::Admin
                    },
                    picture: row.get(2)?,
                    added_by: row.get(3)?,
                })
            })
            .map_err(unavailable)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(unavailable);
        result
    }

    pub fn change(&self, actor: &str, email: &str, role: Option<Role>, add: bool) -> Result<()> {
        use axum::http::StatusCode as S;
        if role.is_some_and(|r| !matches!(r, Role::Admin | Role::Super)) {
            return Err((S::BAD_REQUEST, "Choose Admin or Super admin."));
        }
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction().map_err(unavailable)?;
        // Check actor again inside the serialized transaction, not just in outer middleware.
        if Self::user(&tx, actor, self.demo)
            .map_err(unavailable)?
            .is_none_or(|u| u.role != Role::Super)
        {
            return Err((S::FORBIDDEN, "Only a Super admin can manage People."));
        }
        if email == actor || self.fixed.contains(email) {
            return Err((S::CONFLICT, "Your own account and environment-configured Super accounts are protected. Ask another Super admin or the server operator."));
        }
        let exists = Self::user(&tx, email, self.demo)
            .map_err(unavailable)?
            .is_some();
        if add {
            if exists {
                return Err((S::CONFLICT, "That email is already on the staff list."));
            }
            let count: usize = tx
                .query_row("SELECT count(*) FROM staff_accounts", [], |r| r.get(0))
                .map_err(unavailable)?;
            if count >= 2000 {
                return Err((
                    S::CONFLICT,
                    "The staff list is full (2000 accounts). Remove unused accounts first.",
                ));
            }
            let role = role.ok_or((S::BAD_REQUEST, "Choose a role."))?;
            tx.execute(
                "INSERT INTO staff_accounts(email,role,added_by) VALUES(?1,?2,?3)",
                params![email, role_name(role), actor],
            )
            .map_err(unavailable)?;
        } else {
            if !exists {
                return Err((
                    S::NOT_FOUND,
                    "That person is no longer on the list. Refresh People.",
                ));
            }
            if let Some(role) = role {
                tx.execute(
                    "UPDATE staff_accounts SET role=?1 WHERE email=?2",
                    params![role_name(role), email],
                )
                .map_err(unavailable)?;
            } else {
                tx.execute("DELETE FROM staff_accounts WHERE email=?1", [email])
                    .map_err(unavailable)?;
            }
        }
        tx.commit().map_err(unavailable)?;
        Ok(())
    }
}
#[cfg(test)]
#[path = "people_tests.rs"]
mod tests;

fn role_name(role: Role) -> &'static str {
    if role == Role::Super {
        "super"
    } else {
        "admin"
    }
}
