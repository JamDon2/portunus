use std::sync::{Arc, Mutex};

use crate::{config, content_index, providers, ContentWatcherTx, FileWatcherTx, Registry, SharedFileEntries};

pub fn rebuild_providers(
    new_cfg: &config::Config,
    old_cfg: &config::Config,
    shared: &config::SharedConfig,
    registry: &Registry,
    content_state: &Arc<Mutex<Option<Arc<content_index::ContentIndex>>>>,
    progress_cb: &Arc<dyn Fn(usize, usize) + Send + Sync>,
    content_watcher_tx: &ContentWatcherTx,
    notify_cb: &Arc<dyn Fn() + Send + Sync>,
    file_entries: &SharedFileEntries,
    file_watcher_tx: &FileWatcherTx,
) {
    // Update per-search scalars instantly (no rebuild needed).
    shared.write().unwrap().update_from(new_cfg);

    // Update registry-level settings (max_results, frecency_weight).
    {
        let mut reg = registry.write().unwrap();
        reg.update_settings(new_cfg.general.max_results, new_cfg.frecency.weight);
    }

    // ── Selectively rebuild index-backed providers ────────────────────────────

    if new_cfg.files != old_cfg.files || new_cfg.providers.files != old_cfg.providers.files {
        let files_cfg = new_cfg.files.clone();
        let was_enabled = old_cfg.providers.files;
        let now_enabled = new_cfg.providers.files;
        let shared2 = Arc::clone(shared);
        let reg2 = Arc::clone(registry);
        let ncb = Arc::clone(notify_cb);
        let fe = Arc::clone(file_entries);
        let fw_tx = Arc::clone(file_watcher_tx);
        std::thread::spawn(move || {
            if now_enabled {
                let new_vec = providers::files::FileProvider::walk_dirs(&files_cfg);
                *fe.write().unwrap() = new_vec;
                if !was_enabled {
                    let p = providers::files::FileProvider::with_entries(Arc::clone(&fe), shared2);
                    reg2.write().unwrap().replace("files", Some(Box::new(p)));
                }
            } else {
                *fe.write().unwrap() = vec![];
                reg2.write().unwrap().replace("files", None);
            }
            if let Some(tx) = fw_tx.lock().unwrap().as_ref() {
                let _ = tx.send(files_cfg);
            }
            eprintln!("[config] files provider rebuilt");
            ncb();
        });
    }

    if new_cfg.recent != old_cfg.recent || new_cfg.providers.recent != old_cfg.providers.recent {
        let recent_cfg = new_cfg.recent.clone();
        let enabled = new_cfg.providers.recent;
        let shared2 = Arc::clone(shared);
        let reg2 = Arc::clone(registry);
        let ncb = Arc::clone(notify_cb);
        std::thread::spawn(move || {
            let new: Option<Box<dyn providers::Provider>> = if enabled {
                Some(Box::new(providers::recent::RecentProvider::new(&recent_cfg, shared2)))
            } else {
                None
            };
            reg2.write().unwrap().replace("recent", new);
            eprintln!("[config] recent provider rebuilt");
            ncb();
        });
    }

    if new_cfg.providers.apps != old_cfg.providers.apps {
        let enabled = new_cfg.providers.apps;
        let shared2 = Arc::clone(shared);
        let reg2 = Arc::clone(registry);
        let ncb = Arc::clone(notify_cb);
        std::thread::spawn(move || {
            let new: Option<Box<dyn providers::Provider>> = if enabled {
                Some(Box::new(providers::apps::AppProvider::new(shared2)))
            } else {
                None
            };
            reg2.write().unwrap().replace("apps", new);
            eprintln!("[config] apps provider rebuilt");
            ncb();
        });
    }

    // ── Cheap providers: toggle under write lock directly ─────────────────────

    if new_cfg.providers.calc != old_cfg.providers.calc {
        let mut reg = registry.write().unwrap();
        if new_cfg.providers.calc {
            reg.register(providers::calc::CalcProvider);
            eprintln!("[config] calc provider enabled");
        } else {
            reg.replace("calc", None);
            eprintln!("[config] calc provider disabled");
        }
        notify_cb();
    }

    if new_cfg.providers.dict != old_cfg.providers.dict {
        let mut reg = registry.write().unwrap();
        if new_cfg.providers.dict {
            let p = providers::dict::DictProvider::new();
            if p.available {
                reg.register(p);
            }
            eprintln!("[config] dict provider enabled");
        } else {
            reg.replace("dict", None);
            eprintln!("[config] dict provider disabled");
        }
        notify_cb();
    }

    if new_cfg.content != old_cfg.content {
        let new_content_cfg = new_cfg.content.clone();
        let old_content_cfg = old_cfg.content.clone();
        // Notify the filesystem watcher of the new config so it can watch any added dirs.
        if let Some(tx) = content_watcher_tx.lock().unwrap().as_ref() {
            let _ = tx.send(new_content_cfg.clone());
        }
        let reg2 = Arc::clone(registry);
        let ci_state = Arc::clone(content_state);
        let cb = Arc::clone(progress_cb);
        let ncb = Arc::clone(notify_cb);
        std::thread::spawn(move || {
            // Hold the lock for the full operation (register → index) so
            // two rapid config saves can't race each other on the same DB tables.
            let mut guard = ci_state.lock().unwrap();
            if new_content_cfg.enabled {
                let idx = match guard.as_ref() {
                    Some(existing) => Arc::clone(existing),
                    None => match content_index::ContentIndex::open() {
                        Ok(idx) => {
                            let arc = Arc::new(idx);
                            *guard = Some(Arc::clone(&arc));
                            arc
                        }
                        Err(e) => {
                            eprintln!("[content] failed to open index: {e}");
                            return;
                        }
                    },
                };
                // OCR settings change the extracted text without touching mtime/size,
                // so the incremental check would wrongly skip affected files.
                let ocr_changed = old_content_cfg.ocr_images != new_content_cfg.ocr_images
                    || old_content_cfg.ocr_pdf_fallback != new_content_cfg.ocr_pdf_fallback
                    || old_content_cfg.ocr_language != new_content_cfg.ocr_language;
                if ocr_changed {
                    idx.clear().ok();
                }
                reg2.write().unwrap().replace(
                    "content",
                    Some(Box::new(providers::content::ContentProvider::new(Arc::clone(&idx)))),
                );
                content_index::run_content_indexer(idx, &new_content_cfg, Some(cb));
                eprintln!("[content] reindex complete");
                ncb();
            } else {
                *guard = None;
                reg2.write().unwrap().replace("content", None);
                eprintln!("[content] content provider disabled");
                ncb();
            }
        });
    }

    eprintln!("[config] reload complete");
}
