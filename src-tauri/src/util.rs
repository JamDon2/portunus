//! Small shared helpers.

/// Returns true if `bin` is found as an executable file on any PATH entry.
/// Used both to gate providers at startup and to report dependency status
/// to the Settings UI via `check_dependencies`.
pub fn binary_in_path(bin: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|path| {
        std::env::split_paths(&path).any(|dir| dir.join(bin).is_file())
    })
}
