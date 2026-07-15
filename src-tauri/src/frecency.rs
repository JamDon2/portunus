use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Result};
use serde::Serialize;

use crate::content_match::normalize;
use crate::util;

/// One pin row: `result_id` surfaces on top whenever the typed query is a
/// prefix of `query`. Title/subtitle/kind are display snapshots so the
/// Settings list can render pins whose result no longer exists.
#[derive(Debug, Clone, Serialize)]
pub struct PinRow {
    pub query: String,
    pub result_id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub created_ms: i64,
}

pub struct FrecencyStore {
    conn: Mutex<Connection>,
    half_life_days: f32,
    // In-memory mirror of the (id → score) table, so a search can apply frecency
    // bonuses without hitting SQLite on every keystroke. Kept in sync by
    // record_launch and rebuilt from disk on open.
    cache: RwLock<HashMap<String, f32>>,
    /// In-memory mirror of the pins table (tiny), same rationale as `cache`.
    pins: RwLock<Vec<PinRow>>,
    /// Gates `record_launch` - the store stays open when `[frecency]` is
    /// disabled (pins live in the same DB), but history must not accumulate.
    recording: AtomicBool,
}

fn db_path() -> PathBuf {
    crate::paths::data_dir().join("frecency.db")
}

impl FrecencyStore {
    pub fn open(half_life_days: f32) -> Result<Self> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = crate::util::open_sqlite_resilient(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS frecency (
                 id            TEXT PRIMARY KEY,
                 kind          TEXT NOT NULL,
                 score         REAL NOT NULL DEFAULT 0.0,
                 last_launched INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS pins (
                 query      TEXT NOT NULL,
                 result_id  TEXT NOT NULL,
                 kind       TEXT NOT NULL,
                 title      TEXT NOT NULL,
                 subtitle   TEXT,
                 created_ms INTEGER NOT NULL,
                 PRIMARY KEY (query, result_id)
             );",
        )?;
        let store = Self {
            conn: Mutex::new(conn),
            half_life_days,
            cache: RwLock::new(HashMap::new()),
            pins: RwLock::new(Vec::new()),
            recording: AtomicBool::new(true),
        };
        store.reload_cache();
        store.reload_pins();
        Ok(store)
    }

    /// Enables/disables launch recording (mirrors `[frecency] enabled`).
    /// Reading scores stays available either way; the ranking weights zero the
    /// bonus when frecency is off.
    pub fn set_recording(&self, enabled: bool) {
        self.recording.store(enabled, Ordering::Relaxed);
    }

    /// Rebuilds the in-memory score cache from the database.
    fn reload_cache(&self) {
        let conn = util::lock(&self.conn);
        let mut map = HashMap::new();
        if let Ok(mut stmt) = conn.prepare("SELECT id, score FROM frecency") {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)? as f32))
            }) {
                map.extend(rows.flatten());
            }
        }
        *util::write(&self.cache) = map;
    }

    pub fn record_launch(&self, id: &str, kind: &str) {
        if !self.recording.load(Ordering::Relaxed) {
            return;
        }
        if !matches!(kind, "app" | "file" | "folder" | "extension" | "command") {
            return;
        }
        let normalized = id.to_string();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0) as i64;

        let conn = util::lock(&self.conn);

        let existing = conn
            .query_row(
                "SELECT score, last_launched FROM frecency WHERE id = ?1",
                params![normalized],
                |row| Ok((row.get::<_, f64>(0)?, row.get::<_, i64>(1)?)),
            )
            .ok();

        let new_score = match existing {
            Some((old_score, last_launched)) => {
                let elapsed_days = (now - last_launched).max(0) as f64 / 86400.0;
                old_score * 2f64.powf(-elapsed_days / self.half_life_days as f64) + 1.0
            }
            None => 1.0,
        };

        let written = conn.execute(
            "INSERT INTO frecency (id, kind, score, last_launched) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET score = ?3, last_launched = ?4",
            params![normalized, kind, new_score, now],
        );
        drop(conn);
        // Mirror the new score into the cache so the next search sees it without
        // a DB round-trip. Only on a successful write, to avoid drift from disk.
        if written.is_ok() {
            util::write(&self.cache).insert(normalized, new_score as f32);
        }
    }

    pub fn all_scores(&self) -> HashMap<String, f32> {
        util::read(&self.cache).clone()
    }

    /// Removes every record whose id starts with `prefix` - used when an
    /// extension is uninstalled (`ext:<name>:`), so its history doesn't
    /// outlive it.
    pub fn delete_prefix(&self, prefix: &str) {
        // Escape LIKE metacharacters: extension names may contain '_', which
        // LIKE would treat as a single-char wildcard and match neighbors
        // (deleting `ext:my_ext:%` must not hit `ext:my-ext:...`).
        let escaped = prefix
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let conn = util::lock(&self.conn);
        let _ = conn.execute(
            "DELETE FROM frecency WHERE id LIKE ?1 || '%' ESCAPE '\\'",
            params![escaped],
        );
        // Pins reference result ids too - an uninstalled extension's pins
        // must not outlive it either.
        let _ = conn.execute(
            "DELETE FROM pins WHERE result_id LIKE ?1 || '%' ESCAPE '\\'",
            params![escaped],
        );
        drop(conn);
        util::write(&self.cache).retain(|k, _| !k.starts_with(prefix));
        util::write(&self.pins).retain(|p| !p.result_id.starts_with(prefix));
    }

    // ── Pins ──────────────────────────────────────────────────────────────────

    fn reload_pins(&self) {
        let conn = util::lock(&self.conn);
        let mut rows = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT query, result_id, kind, title, subtitle, created_ms
             FROM pins ORDER BY created_ms DESC",
        ) {
            if let Ok(iter) = stmt.query_map([], |row| {
                Ok(PinRow {
                    query: row.get(0)?,
                    result_id: row.get(1)?,
                    kind: row.get(2)?,
                    title: row.get(3)?,
                    subtitle: row.get(4)?,
                    created_ms: row.get(5)?,
                })
            }) {
                rows.extend(iter.flatten());
            }
        }
        *util::write(&self.pins) = rows;
    }

    /// Pins `result_id` for `query` (stored normalized). Overwrites the
    /// snapshot on re-pin.
    pub fn pin(
        &self,
        query: &str,
        result_id: &str,
        kind: &str,
        title: &str,
        subtitle: Option<&str>,
    ) -> Result<()> {
        let q = normalize(query.trim());
        if q.is_empty() || result_id.is_empty() {
            return Ok(());
        }
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        {
            let conn = util::lock(&self.conn);
            conn.execute(
                "INSERT INTO pins (query, result_id, kind, title, subtitle, created_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(query, result_id)
                 DO UPDATE SET kind = ?3, title = ?4, subtitle = ?5",
                params![q, result_id, kind, title, subtitle, now_ms],
            )?;
        }
        self.reload_pins();
        Ok(())
    }

    pub fn unpin(&self, query: &str, result_id: &str) -> Result<()> {
        let q = normalize(query.trim());
        {
            let conn = util::lock(&self.conn);
            conn.execute(
                "DELETE FROM pins WHERE query = ?1 AND result_id = ?2",
                params![q, result_id],
            )?;
        }
        self.reload_pins();
        Ok(())
    }

    /// Removes every pin currently boosting `result_id` for the typed query -
    /// the launcher's unpin toggle, which only knows what the user typed, not
    /// the stored pin query it prefix-matched.
    pub fn unpin_matching(&self, typed: &str, result_id: &str) -> Result<()> {
        let t = normalize(typed.trim());
        if t.is_empty() {
            return Ok(());
        }
        let doomed: Vec<String> = util::read(&self.pins)
            .iter()
            .filter(|p| p.result_id == result_id && p.query.starts_with(&t))
            .map(|p| p.query.clone())
            .collect();
        {
            let conn = util::lock(&self.conn);
            for q in &doomed {
                conn.execute(
                    "DELETE FROM pins WHERE query = ?1 AND result_id = ?2",
                    params![q, result_id],
                )?;
            }
        }
        self.reload_pins();
        Ok(())
    }

    /// All pins, newest first (Settings management list).
    pub fn list_pins(&self) -> Vec<PinRow> {
        util::read(&self.pins).clone()
    }

    /// Result ids boosted for `typed`: every pin whose stored query starts
    /// with the normalized typed query (equal included). Typing toward a
    /// pinned query keeps its result on top the whole way.
    pub fn pin_bonus_ids(&self, typed: &str) -> HashSet<String> {
        let t = normalize(typed.trim());
        if t.is_empty() {
            return HashSet::new();
        }
        util::read(&self.pins)
            .iter()
            .filter(|p| p.query.starts_with(&t))
            .map(|p| p.result_id.clone())
            .collect()
    }


    /// Extension names that have frecency history (`ext:<name>:...` ids).
    /// Part of the uninstall-orphan census: an extension that never wrote kv
    /// data is otherwise invisible after its directory is deleted.
    pub fn extension_names(&self) -> Vec<String> {
        let cache = util::read(&self.cache);
        let mut names: Vec<String> = cache
            .keys()
            .filter_map(|id| id.strip_prefix("ext:"))
            .filter_map(|rest| rest.split(':').next())
            .map(str::to_string)
            .collect();
        names.sort();
        names.dedup();
        names
    }
}
