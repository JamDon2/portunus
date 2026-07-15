//! Async-query orchestration: runs extensions' `query` exports on worker
//! threads and streams scored result batches to the frontend.
//!
//! Lifecycle per keystroke: `dispatch` bumps the internal epoch (which makes
//! every in-flight emit stale at the host-fn gate), epoch-cancels running
//! calls, and spawns one worker per triggered extension that exports `query`.
//! Workers push batches through a coalescing sink; each batch is scored with
//! the same frecency formula as the sync path and forwarded to the frontend
//! as a `search-stream` event.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;

use crate::providers::wasm::WasmProvider;
use crate::providers::{self, PluginRegistry, SearchResult};

/// Streamed batches are flushed at most this often - an LLM-token-speed guest
/// must not flood Tauri IPC. `done` always flushes immediately.
const COALESCE_MS: u64 = 30;

/// One extension the dispatcher started an async query for; the frontend
/// shows a pending indicator until that extension's `done` event arrives.
#[derive(Debug, Clone, Serialize)]
pub struct PendingExt {
    pub name: String,
    pub kind: String,
}

/// `search-stream` event payload.
#[derive(Debug, Clone, Serialize)]
struct StreamPayload {
    query_id: u64,
    ext: String,
    results: Vec<SearchResult>,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Process-global manager handle. Like the log store, query cancellation is
/// needed from paths (registry mutation, CLI reloads) that have no Tauri
/// state access - a global avoids threading it through every reload caller.
static MANAGER: std::sync::OnceLock<Arc<QueryManager>> = std::sync::OnceLock::new();

/// Creates the manager once at app setup and registers it globally.
pub fn init(app: tauri::AppHandle) -> Arc<QueryManager> {
    MANAGER.get_or_init(|| Arc::new(QueryManager::new(app))).clone()
}

pub fn manager() -> Option<&'static Arc<QueryManager>> {
    MANAGER.get()
}

pub struct QueryManager {
    app: tauri::AppHandle,
    /// Internal emit-gating epoch: bumped on every dispatch AND cancel_all.
    /// The host-fn emit gate and the workers compare against it.
    epoch: Arc<AtomicU64>,
    /// Highest frontend query id seen - guards against reordered commands.
    last_query_id: AtomicU64,
    /// Running workers by extension name, for targeted cancellation.
    slots: Mutex<HashMap<String, Arc<WasmProvider>>>,
}

impl QueryManager {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            epoch: Arc::new(AtomicU64::new(0)),
            last_query_id: AtomicU64::new(0),
            slots: Mutex::new(HashMap::new()),
        }
    }

    /// Cancels every in-flight query (window hidden, query cleared).
    pub fn cancel_all(&self) {
        self.epoch.fetch_add(1, Ordering::Relaxed);
        let slots = std::mem::take(&mut *crate::util::lock(&self.slots));
        for provider in slots.values() {
            provider.cancel_query();
        }
    }

    /// Cancels the in-flight query of one extension (reload/unload paths).
    /// Its provider Arc keeps the old instance alive until the worker exits;
    /// the epoch gate keeps whatever it still emits from rendering.
    pub fn cancel_ext(&self, name: &str) {
        if let Some(provider) = crate::util::lock(&self.slots).remove(name) {
            provider.cancel_query();
        }
    }

    /// Starts async queries for `raw_query`: cancels stale workers, then
    /// spawns one per loaded extension whose trigger gate passes and which
    /// exports `query`. Returns the started set for the command response.
    /// `query_id` is the frontend's monotonic counter; commands arriving out
    /// of order are ignored.
    pub fn dispatch(
        &self,
        query_id: u64,
        raw_query: &str,
        registry: &PluginRegistry,
    ) -> Vec<PendingExt> {
        // Reorder guard: an older keystroke's command must never cancel or
        // supersede a newer one that already dispatched.
        let prev = self.last_query_id.fetch_max(query_id, Ordering::Relaxed);
        if query_id <= prev {
            return Vec::new();
        }

        // Invalidate all in-flight emits, then interrupt the calls.
        let generation = self.epoch.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut slots = crate::util::lock(&self.slots);
            for provider in slots.values() {
                provider.cancel_query();
            }
            slots.clear();
        }
        if raw_query.is_empty() {
            return Vec::new();
        }

        let (frecency, weights) = registry.stream_params();
        let mut pending = Vec::new();
        for name in registry.extension_names() {
            let Some(provider) = registry.extension(&name) else { continue };
            if !provider.has_query() || provider.query_disabled() || provider.is_benched() {
                continue;
            }
            let Some(gc) = provider.gate(raw_query) else { continue };
            // Root gate resolves only `always` commands; those are discovery-band.
            let intent = false;

            pending.push(PendingExt {
                name: name.clone(),
                kind: provider.result_kind().to_string(),
            });
            self.spawn_worker(
                query_id,
                generation,
                name,
                provider,
                gc,
                intent,
                frecency.clone(),
                Arc::clone(&weights),
                raw_query.to_string(),
            );
        }
        pending
    }

    /// Scoped variant for an entered extension command mode: cancels all
    /// workers, then spawns only the target extension with the command forced
    /// (the whole query is the command's input). Same epoch/reorder guards as
    /// `dispatch`.
    pub fn dispatch_scoped(
        &self,
        query_id: u64,
        ext_name: &str,
        command: &str,
        query: &str,
        registry: &PluginRegistry,
    ) -> Vec<PendingExt> {
        let prev = self.last_query_id.fetch_max(query_id, Ordering::Relaxed);
        if query_id <= prev {
            return Vec::new();
        }
        let generation = self.epoch.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut slots = crate::util::lock(&self.slots);
            for provider in slots.values() {
                provider.cancel_query();
            }
            slots.clear();
        }

        let Some(provider) = registry.extension(ext_name) else { return Vec::new() };
        if !provider.has_query() || provider.query_disabled() || provider.is_benched() {
            return Vec::new();
        }
        let Some(gc) = provider.gate_scoped(command, query) else { return Vec::new() };

        let (frecency, weights) = registry.stream_params();
        let pending = vec![PendingExt {
            name: ext_name.to_string(),
            kind: provider.result_kind().to_string(),
        }];
        // Scoped batches carry no root-band parts and pins never apply inside
        // a scope, so the pin query is empty.
        self.spawn_worker(
            query_id,
            generation,
            ext_name.to_string(),
            provider,
            gc,
            true,
            frecency,
            weights,
            String::new(),
        );
        pending
    }

    /// Spawns one worker thread running an extension's `query` export,
    /// streaming coalesced `search-stream` batches gated on `generation`.
    #[allow(clippy::too_many_arguments)]
    fn spawn_worker(
        &self,
        query_id: u64,
        generation: u64,
        name: String,
        provider: Arc<WasmProvider>,
        gc: crate::extensions::trigger::GatedCommand,
        intent: bool,
        frecency: Option<Arc<crate::frecency::FrecencyStore>>,
        weights: Arc<std::sync::RwLock<providers::ranking::RankingWeights>>,
        pin_query: String,
    ) {
        crate::util::lock(&self.slots).insert(name.clone(), provider.clone());

        let app = self.app.clone();
        let epoch = self.epoch.clone();
        let slots_name = name;
        std::thread::spawn(move || {
            let epoch_for_emit = epoch.clone();
            let emit = move |results: Vec<SearchResult>, done: bool, error: Option<String>| {
                // Stale-generation batches are dropped host-side too; this
                // is the second gate for anything racing the bump.
                if epoch_for_emit.load(Ordering::Relaxed) != generation {
                    return;
                }
                let mut results = results;
                // Same composition as the sync path, read live so a config
                // edit re-scores the very next batch. Root batches drop
                // weight-0-hidden extensions here; scoped ones never do.
                let w = weights.read().unwrap().clone();
                providers::finalize_results(
                    &mut results,
                    &w,
                    frecency.as_deref(),
                    &pin_query,
                    !intent,
                    false,
                );
                let _ = app.emit(
                    "search-stream",
                    StreamPayload { query_id, ext: slots_name.clone(), results, done, error },
                );
            };

            // Coalesce partial batches so chatty guests don't flood IPC.
            let buffer = Arc::new(Mutex::new(Vec::<SearchResult>::new()));
            let last_flush = Arc::new(Mutex::new(Instant::now() - Duration::from_millis(COALESCE_MS)));
            let sink_emit = emit.clone();
            let sink_buffer = buffer.clone();
            let sink_last = last_flush.clone();
            let sink = move |batch: Vec<SearchResult>| {
                let mut buf = sink_buffer.lock().unwrap_or_else(|e| e.into_inner());
                buf.extend(batch);
                let mut last = sink_last.lock().unwrap_or_else(|e| e.into_inner());
                if last.elapsed() >= Duration::from_millis(COALESCE_MS) && !buf.is_empty() {
                    *last = Instant::now();
                    let out = std::mem::take(&mut *buf);
                    drop(buf);
                    sink_emit(out, false, None);
                }
            };

            let outcome = provider.run_query(gc, intent, generation, epoch.clone(), sink);
            // Final flush: buffered partials + the returned final batch.
            let mut tail = std::mem::take(&mut *buffer.lock().unwrap_or_else(|e| e.into_inner()));
            match outcome {
                Ok(finals) => {
                    tail.extend(finals);
                    emit(tail, true, None);
                }
                Err(e) => emit(tail, true, Some(e)),
            }
        });
    }
}
