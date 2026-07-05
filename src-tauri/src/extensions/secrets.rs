//! Secret setting storage for extensions, backed by the desktop Secret
//! Service (`org.freedesktop.secrets` - GNOME Keyring, KWallet, KeePassXC).
//!
//! Values declared as `type = "secret"` in an extension's `[[settings]]`
//! schema are stored here, NEVER in config.toml. Entries are namespaced as
//! service `"portunus-extension"`, account `"<ext-name>/<key>"` - extension
//! names are `[A-Za-z0-9_-]+` and setting keys `[a-z0-9_]+`, so `/` is an
//! unambiguous separator.
//!
//! When no secrets daemon is available the feature is disabled with a clear
//! UI error rather than falling back to a plaintext file - a silent
//! downgrade would defeat the reason the type exists. Extensions still load;
//! `settings_get` simply returns `None` for unset secrets.
//!
//! Rules for this module: error strings may name the extension and key,
//! never the value. Every call is blocking dbus - callers must be on
//! background / `spawn_blocking` threads, never the keystroke path.

use std::sync::OnceLock;

use keyring::Entry;

const SERVICE: &str = "portunus-extension";
/// Sanity cap - API keys and tokens are far below this.
const MAX_SECRET_BYTES: usize = 4096;

fn entry(ext: &str, key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("{ext}/{key}"))
        .map_err(|e| format!("keyring entry for {ext}/{key}: {e}"))
}

/// Whether a Secret Service daemon is reachable. Probed once per process via
/// a sentinel set/get/delete round-trip.
pub fn available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let Ok(probe) = Entry::new(SERVICE, "__probe__") else {
            return false;
        };
        if probe.set_password("probe").is_err() {
            return false;
        }
        let ok = probe.get_password().is_ok();
        let _ = probe.delete_credential();
        ok
    })
}

/// Reads one secret; `Ok(None)` when it was never set.
pub fn get(ext: &str, key: &str) -> Result<Option<String>, String> {
    match entry(ext, key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring read for {ext}/{key}: {e}")),
    }
}

/// Stores one secret (non-empty, capped).
pub fn set(ext: &str, key: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("secret value must not be empty".to_string());
    }
    if value.len() > MAX_SECRET_BYTES {
        return Err(format!("secret value exceeds {MAX_SECRET_BYTES} bytes"));
    }
    entry(ext, key)?
        .set_password(value)
        .map_err(|e| format!("keyring write for {ext}/{key}: {e}"))
}

/// Deletes one secret; absent entries are not an error.
pub fn delete(ext: &str, key: &str) -> Result<(), String> {
    match entry(ext, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete for {ext}/{key}: {e}")),
    }
}

/// Whether a value is stored for this key.
pub fn exists(ext: &str, key: &str) -> bool {
    matches!(get(ext, key), Ok(Some(_)))
}
