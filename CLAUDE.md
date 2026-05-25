# Portunus

macOS Spotlight-style app launcher for Linux (Hyprland).

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Desktop | Tauri 2 |
| Package manager | Bun |
| Fuzzy matching | nucleo-matcher 0.3 |
| File traversal | walkdir 2 |
| Serialization | serde + serde_json |
| PDF rendering | pdfium-render 0.8 + image 0.25 |

## Commands

```bash
bun tauri dev       # dev mode (hot reload)
bun tauri build     # production build (requires linuxdeploy for AppImage)
cargo check         # type-check Rust only
bun x tsc --noEmit  # type-check TypeScript only
```

## System dependencies

- `libpdfium.so` (x86_64) — required for PDF preview. Install via AUR: `yay -S pdfium-bin` (must be the 64-bit build). Loaded at runtime via `Pdfium::bind_to_system_library()`.

## Structure

```
src/
  App.tsx           # Search UI, result list, keyboard nav, preview panel
  App.css           # Dark card styles (warm brown palette)

src-tauri/
  tauri.conf.json   # Window (900×576, transparent, alwaysOnTop, center)
                    # assetProtocol enabled for icon dirs
  Cargo.toml        # protocol-asset feature required for assetProtocol
  capabilities/
    default.json    # ACL: core:default, core:window:allow-set-size

  src/
    main.rs         # Binary entry point (do not edit)
    lib.rs          # Tauri commands + setup:
                    #   search, launch_app, hide_window, is_apps_ready
                    #   render_pdf_page (async, spawn_blocking)
                    #   FileProvider + AppProvider loaded in background thread
                    #   → emits "apps-ready" when both are ready
    providers/
      mod.rs        # Provider trait, SearchResult, PluginRegistry
                    # Scoring constants + recency_bonus()
      apps.rs       # AppProvider: parses .desktop files, builds icon index,
                    # fuzzy-matches with nucleo-matcher
      calc.rs       # CalcProvider: evaluates math expressions via exp-rs
      files.rs      # FileProvider: indexes ~/Downloads at depth 2
```

## Architecture Notes

**Provider system** — `Provider` trait in `providers/mod.rs`. Implement `id()` + `search(query) -> Vec<SearchResult>` and register via `PluginRegistry::register()`. Results are merged, sorted by composite score, truncated to 8.

**SearchResult fields** — `id`, `title`, `subtitle`, `kind`, `score`, `exec`, `icon_path`, `file_size: Option<u64>`, `created: Option<u64>` (Unix secs), `modified: Option<u64>` (Unix secs).

**Scoring system** — Composite score encodes category priority + within-category relevance. No result with `nucleo_score < MIN_NUCLEO_SCORE (50)` is returned.

| Category | Score range |
|---|---|
| Calc | 3,000,000 (fixed) |
| App | 2,000,000 + nucleo score |
| File | 1,000,000 + nucleo score + recency bonus (0–50) |
| Folder | 0 + nucleo score + recency bonus (0–50) |

Recency bonus decays linearly from 50 (modified today) to 0 (modified ≥ 1 year ago).

**Startup** — `CalcProvider` registers synchronously. `FileProvider` and `AppProvider` load in a background thread (file indexing first, then app icon resolution). Window opens immediately; frontend shows "Loading…" until the `apps-ready` Tauri event fires.

**Icon index** — Built once at startup by reading only `{theme}/{size}/apps/` dirs. SVG preferred over PNG; larger sizes preferred over smaller. Stored as `HashMap<stem, path>`.

**File provider** — Indexes `~/Downloads` at depth 2. Collects name, parent path, is_dir, file_size, created, modified from filesystem metadata at index time. `exec` is `xdg-open "<path>"` (double-quotes in path are escaped). Folders get `file_size: None`.

**Preview panel** — Right column of the body. Three variants:
- `AppPreview` — for `kind = "app"`: icon, name, description, Launch button
- `FilePreview` — for `kind = "file" | "folder"`: icon, name/tag, optional media preview, compact metadata strip
- Empty — for `kind = "calc"` and no selection

**PDF preview** — `render_pdf_page` Tauri command renders page 0 via PDFium at 800px wide, returns JPEG bytes. Runs in `spawn_blocking` (non-blocking IPC). Frontend uses a two-level cache: `pdfPromiseCache` (Promise, prevents duplicate invocations) and `pdfUrlCache` (resolved blob URL string, enables synchronous state init). Image fades in via `onLoad` opacity transition to avoid black flash.

**Background mode** — Portunus runs hidden at all times. To show it, send `--show` to a running instance:
```bash
portunus --show   # signals the daemon via $XDG_RUNTIME_DIR/portunus.sock, then exits
```
On Escape or app launch the window hides (does not exit). State (query, results) resets on the next show.

**Hyprland** — Window rule and keybind in `~/.config/hypr/hyprland.conf`:
```
windowrule = float on, stay_focused 1, no_blur 1, opacity 1 1, border_size 0, match:class portunus
bind = CTRL, SPACE, exec, /path/to/portunus --show
```
