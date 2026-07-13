//! Desktop-environment facts for the onboarding wizard's setup step and the
//! Settings autostart toggle. Rust reports raw facts (detected DE, resolved
//! exec path); the per-DE snippet strings are presentation and live frontend-side.

use crate::paths;

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DesktopEnv {
    Hyprland,
    Gnome,
    Kde,
    Sway,
    Niri,
    River,
    Other,
}

#[derive(serde::Serialize)]
pub struct DeSetupInfo {
    pub de: DesktopEnv,
    /// Absolute path to put in snippets and `Exec=` (or bare "portunus").
    pub exec_path: String,
}

fn detect_de_from(value: &str) -> Option<DesktopEnv> {
    // Colon-separated list, e.g. "ubuntu:GNOME"; match any segment.
    for segment in value.split(':') {
        let s = segment.trim().to_lowercase();
        let de = if s.contains("hyprland") {
            DesktopEnv::Hyprland
        } else if s.contains("gnome") {
            DesktopEnv::Gnome
        } else if s.contains("kde") {
            DesktopEnv::Kde
        } else if s.contains("sway") {
            DesktopEnv::Sway
        } else if s.contains("niri") {
            DesktopEnv::Niri
        } else if s.contains("river") {
            DesktopEnv::River
        } else {
            continue;
        };
        return Some(de);
    }
    None
}

fn detect_de() -> DesktopEnv {
    std::env::var("XDG_CURRENT_DESKTOP")
        .ok()
        .and_then(|v| detect_de_from(&v))
        .or_else(|| {
            std::env::var("XDG_SESSION_DESKTOP")
                .ok()
                .and_then(|v| detect_de_from(&v))
        })
        .unwrap_or(DesktopEnv::Other)
}

/// The binary path snippets and the autostart entry should reference.
/// AppImage runtimes set `$APPIMAGE` to the real .AppImage path while
/// `current_exe()` points inside the transient mount, so it wins.
fn exec_path() -> String {
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.is_empty() {
            return appimage;
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(str::to_string))
        .unwrap_or_else(|| "portunus".to_string())
}

fn autostart_file() -> std::path::PathBuf {
    paths::xdg_config_home().join("autostart/portunus.desktop")
}

#[tauri::command]
pub fn de_setup_info() -> DeSetupInfo {
    DeSetupInfo {
        de: detect_de(),
        exec_path: exec_path(),
    }
}

#[tauri::command]
pub fn get_autostart() -> bool {
    autostart_file().exists()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let file = autostart_file();
    if enabled {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let exec = exec_path();
        let exec = if exec.contains(char::is_whitespace) {
            format!("\"{exec}\"")
        } else {
            exec
        };
        let contents = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=Portunus\n\
             Comment=Keyboard-first launcher (background service)\n\
             Exec={exec}\n\
             Terminal=false\n\
             StartupNotify=false\n"
        );
        std::fs::write(&file, contents).map_err(|e| e.to_string())
    } else {
        match std::fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_segments_and_composites() {
        assert_eq!(detect_de_from("Hyprland"), Some(DesktopEnv::Hyprland));
        assert_eq!(detect_de_from("ubuntu:GNOME"), Some(DesktopEnv::Gnome));
        assert_eq!(detect_de_from("KDE"), Some(DesktopEnv::Kde));
        assert_eq!(detect_de_from("sway"), Some(DesktopEnv::Sway));
        assert_eq!(detect_de_from("niri"), Some(DesktopEnv::Niri));
        assert_eq!(detect_de_from("river"), Some(DesktopEnv::River));
        assert_eq!(detect_de_from("XFCE"), None);
        assert_eq!(detect_de_from(""), None);
    }
}
