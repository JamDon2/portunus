//! Cache of OCR'd text for clipboard images, keyed by cliphist entry id.
//!
//! OCR is expensive, so each copied image is OCR'd once and the result is stored
//! here; subsequent clipboard searches read the cache instead of re-running
//! Tesseract. Mirrors the `frecency.rs` SQLite-store shape. Clipboard history is
//! small (≤ `max_entries`, default 250), so a plain text column + substring
//! match on the frontend suffices - no FTS needed.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Result};

use crate::util;

pub struct ClipboardOcrStore {
    conn: Mutex<Connection>,
}

fn db_path() -> PathBuf {
    crate::paths::data_dir().join("clipboard_ocr.db")
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64
}

impl ClipboardOcrStore {
    pub fn open() -> Result<Self> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = crate::util::open_sqlite_resilient(&path)?;
        // Schema v1 added the `boxes` column (JSON word boxes for Live Text). A
        // pure cache, so a mismatch just drops and lazily re-OCRs.
        const SCHEMA_VERSION: i64 = 1;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap_or(0);
        if version != SCHEMA_VERSION {
            conn.execute_batch("DROP TABLE IF EXISTS clipboard_ocr;")?;
        }
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS clipboard_ocr (
                 id         TEXT PRIMARY KEY,
                 byte_size  INTEGER NOT NULL DEFAULT 0,
                 text       TEXT NOT NULL,
                 boxes      TEXT NOT NULL DEFAULT '[]',
                 indexed_at INTEGER NOT NULL
             );",
        )?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Cached `(byte_size, text)` for an entry, or `None` if never OCR'd. An
    /// empty `text` is a valid negative-cache hit (image had no detectable text).
    pub fn get(&self, id: &str) -> Option<(u64, String)> {
        let conn = util::lock(&self.conn);
        conn.query_row(
            "SELECT byte_size, text FROM clipboard_ocr WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?)),
        )
        .ok()
    }

    /// Cached `(byte_size, text, boxes_json)` for the Live Text layer, or `None`.
    pub fn get_with_boxes(&self, id: &str) -> Option<(u64, String, String)> {
        let conn = util::lock(&self.conn);
        conn.query_row(
            "SELECT byte_size, text, boxes FROM clipboard_ocr WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .ok()
    }

    pub fn upsert(&self, id: &str, byte_size: u64, text: &str, boxes_json: &str) {
        let conn = util::lock(&self.conn);
        let _ = conn.execute(
            "INSERT INTO clipboard_ocr (id, byte_size, text, boxes, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET byte_size = ?2, text = ?3, boxes = ?4, indexed_at = ?5",
            params![id, byte_size as i64, text, boxes_json, now_secs()],
        );
    }

    /// Drops rows for entries no longer present in cliphist, so the cache doesn't
    /// outgrow the history. Called at the end of an index pass with the live ids.
    pub fn prune(&self, live_ids: &HashSet<String>) {
        let conn = util::lock(&self.conn);
        let stale: Vec<String> = {
            let mut stmt = match conn.prepare("SELECT id FROM clipboard_ocr") {
                Ok(s) => s,
                Err(_) => return,
            };
            let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
                Ok(r) => r,
                Err(_) => return,
            };
            rows.flatten().filter(|id| !live_ids.contains(id)).collect()
        };
        for id in stale {
            let _ = conn.execute("DELETE FROM clipboard_ocr WHERE id = ?1", params![id]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_store() -> ClipboardOcrStore {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE clipboard_ocr (
                 id TEXT PRIMARY KEY,
                 byte_size INTEGER NOT NULL DEFAULT 0,
                 text TEXT NOT NULL,
                 boxes TEXT NOT NULL DEFAULT '[]',
                 indexed_at INTEGER NOT NULL
             );",
        )
        .unwrap();
        ClipboardOcrStore { conn: Mutex::new(conn) }
    }

    #[test]
    fn boxes_json_round_trips() {
        let store = mem_store();
        let boxes = r#"[{"text":"café","rect":[0.1,0.2,0.3,0.4],"line":0}]"#;
        store.upsert("42", 1234, "café", boxes);
        let (bs, text, got) = store.get_with_boxes("42").unwrap();
        assert_eq!(bs, 1234);
        assert_eq!(text, "café");
        assert_eq!(got, boxes);
        // The text-only getter still works alongside the boxes column.
        assert_eq!(store.get("42").unwrap().1, "café");
    }

    #[test]
    fn empty_boxes_default() {
        let store = mem_store();
        store.upsert("1", 0, "", "[]");
        assert_eq!(store.get_with_boxes("1").unwrap().2, "[]");
    }
}
