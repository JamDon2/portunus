use std::sync::Arc;

use tauri::{Emitter, Manager};

pub fn socket_path() -> std::path::PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(runtime_dir).join("portunus.sock")
}

pub fn try_signal_running(cmd: &str) -> bool {
    use std::io::Write;
    match std::os::unix::net::UnixStream::connect(socket_path()) {
        Ok(mut stream) => stream.write_all(format!("{cmd}\n").as_bytes()).is_ok(),
        Err(_) => false,
    }
}

pub fn start_socket_listener(
    app: tauri::AppHandle,
    reindex_fn: Option<Arc<dyn Fn() + Send + Sync>>,
    reload_fn: Arc<dyn Fn() + Send + Sync>,
) {
    use std::io::BufRead;
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let listener = match std::os::unix::net::UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("portunus: failed to bind socket: {e}");
            return;
        }
    };
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut line = String::new();
            let _ = std::io::BufReader::new(stream).read_line(&mut line);
            let cmd = line.trim();
            if cmd == "show" || cmd.starts_with("show:") {
                let initial_query = cmd.strip_prefix("show:").map(str::to_string);
                if let Some(window) = app.get_webview_window("main") {
                    let already_visible = window.is_visible().unwrap_or(false);
                    if let Some(q) = initial_query {
                        // Always apply a query command (e.g. --clipboard), even if already shown.
                        // Append a trailing space so prefix-based providers like ClipboardProvider activate.
                        let q_with_space = if q.ends_with(' ') { q } else { format!("{q} ") };
                        let _ = app.emit("window-show-query", q_with_space);
                        if !already_visible {
                            let _ = window.show();
                        }
                        let _ = window.set_focus();
                    } else if !already_visible {
                        // Plain --show: no-op when the window is already visible.
                        let _ = app.emit("window-show", ());
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            } else if cmd == "reindex" {
                if let Some(f) = &reindex_fn {
                    let f = Arc::clone(f);
                    std::thread::spawn(move || f());
                }
            } else if cmd == "reload-config" {
                let f = Arc::clone(&reload_fn);
                std::thread::spawn(move || f());
            }
        }
    });
}
