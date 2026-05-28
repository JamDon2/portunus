import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Config } from "./types";
import GeneralSection from "./components/settings/GeneralSection";
import ProvidersSection from "./components/settings/ProvidersSection";
import FilesSection from "./components/settings/FilesSection";
import SearchSection from "./components/settings/SearchSection";
import FrecencySection from "./components/settings/FrecencySection";
import ContentSection from "./components/settings/ContentSection";
import DebugSection from "./components/settings/DebugSection";
import AppearanceSection from "./components/settings/AppearanceSection";
import { applyTheme } from "./theme";
import "./settings.css";
import "./themes.css";

type Section = "general" | "providers" | "files" | "search" | "frecency" | "content" | "debug" | "appearance";

interface NavItem {
  id: Section;
  label: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  {
    id: "general",
    label: "General",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    id: "providers",
    label: "Providers",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
  },
  {
    id: "files",
    label: "Files",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    id: "search",
    label: "Search",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
  {
    id: "frecency",
    label: "Frecency",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: "content",
    label: "Content",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    id: "debug",
    label: "Debug",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    ),
  },
];

const AUTOSAVE_DELAY_MS = 800;

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("general");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracks the config object reference as it came from disk.
  // Reference equality check lets us skip the auto-save on initial load.
  const diskConfigRef = useRef<Config | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<Config>("get_config");
      diskConfigRef.current = cfg;
      setConfig(cfg);
      applyTheme(cfg.appearance);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Load config whenever the window gains focus (i.e. every time the user opens it).
  // Debounced because show() + set_focus() each fire the event in quick succession.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let lastLoad = 0;
    win.onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      const now = Date.now();
      if (now - lastLoad < 300) return;
      lastLoad = now;
      loadConfig();
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [loadConfig]);


  // Escape closes the window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Apply theme immediately on any appearance change.
  // Only broadcast to main window when it's a user-driven change, not the initial disk load.
  useEffect(() => {
    if (!config) return;
    applyTheme(config.appearance);
    if (diskConfigRef.current && config.appearance !== diskConfigRef.current.appearance) {
      emit("appearance-changed", config.appearance);
    }
  }, [config?.appearance]);

  // Auto-save: fires 800ms after the last config change, skips on initial load
  useEffect(() => {
    if (!config || config === diskConfigRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        await invoke("save_config", { config });
        diskConfigRef.current = config;
        setSavedFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setSavedFlash(false), 1800);
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [config]);

  const handleClose = () => getCurrentWindow().hide();

  const activeNav = NAV.find(n => n.id === activeSection)!;

  return (
    <div className="settings-window">
      <div className="settings-card">
        {/* Title bar */}
        <div className="settings-titlebar" data-tauri-drag-region>
          <div className="settings-titlebar-left">
            <span className="settings-brand-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </span>
            <span className="settings-brand-text">Portunus</span>
            <span className="settings-brand-sep">·</span>
            <span className="settings-section-title">{activeNav.label}</span>
          </div>
          <button className="settings-close-btn" onClick={handleClose} title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="settings-body">
          {/* Sidebar */}
          <div className="settings-sidebar">
            {NAV.map(item => (
              <button
                key={item.id}
                className={`settings-nav-item${activeSection === item.id ? " active" : ""}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="settings-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="settings-content">
            {!config ? (
              <div style={{ padding: "24px 0", color: "var(--fg-dim)", fontSize: 13 }}>
                {error ? `Error: ${error}` : "Loading…"}
              </div>
            ) : (
              <>
                {activeSection === "general"   && <GeneralSection   config={config} onChange={setConfig} />}
                {activeSection === "providers" && <ProvidersSection config={config} onChange={setConfig} />}
                {activeSection === "files"     && <FilesSection     config={config} onChange={setConfig} />}
                {activeSection === "search"    && <SearchSection    config={config} onChange={setConfig} />}
                {activeSection === "frecency"  && <FrecencySection  config={config} onChange={setConfig} />}
                {activeSection === "content"   && <ContentSection   config={config} onChange={setConfig} />}
                {activeSection === "debug"      && <DebugSection      config={config} onChange={setConfig} />}
                {activeSection === "appearance" && <AppearanceSection config={config} onChange={setConfig} />}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <span className="settings-footer-status">
            {error
              ? <span style={{ color: "var(--danger-fg)" }}>Error: {error}</span>
              : saving
                ? <span style={{ color: "var(--fg-mute)" }}>Saving…</span>
                : <span className={`settings-save-status${savedFlash ? " visible" : ""}`}>✓ Saved</span>
            }
          </span>
          <button className="btn-settings-save" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
