import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriListener } from "../../hooks/useTauriListener";
import { Config, ExtensionInfo, InstallPreview } from "../../types";
import SectionHeader from "./SectionHeader";
import SettingsGroup from "./SettingsGroup";
import SettingsField from "./SettingsField";
import ExtensionCard from "./extensions/ExtensionCard";
import InstallExtensionDialog from "./extensions/InstallExtensionDialog";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

export default function ExtensionsSection({ config, onChange }: Props) {
  const [exts, setExts] = useState<ExtensionInfo[] | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [storageDegraded, setStorageDegraded] = useState<string | null>(null);
  const [secretsAvailable, setSecretsAvailable] = useState(true);

  useEffect(() => {
    invoke<string | null>("extension_storage_status")
      .then(setStorageDegraded)
      .catch(() => {});
    invoke<boolean>("secrets_available")
      .then(setSecretsAvailable)
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    invoke<ExtensionInfo[]>("list_extensions")
      .then(next =>
        // Skip the state update when nothing changed - a no-op refresh after
        // Rescan would otherwise re-render every row (visible as a flash).
        setExts(prev => prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      .catch(() => setExts([]));
  }, []);
  useEffect(refresh, [refresh]);
  // Fired by the backend when an extension rebuild completes.
  useTauriListener("search-invalidated", refresh, [refresh]);
  // Installs/uninstalls/reloads emit this dedicated signal.
  useTauriListener("extensions-reloaded", refresh, [refresh]);
  // Runtime errors happen while the user is in the LAUNCHER; refresh on focus.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => { if (focused) refresh(); })
      .then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, [refresh]);

  const setEnabled = (name: string, value: boolean) => {
    const entry = config.extensions[name] ?? { enabled: false, settings: {} };
    onChange({ ...config, extensions: { ...config.extensions, [name]: { ...entry, enabled: value } } });
  };

  const rescan = () => { invoke("rescan_extensions").catch(() => {}); };

  // Pre-staged updates from a "Check all" sweep, keyed by extension name. Each
  // holds a staging dir that must be cancelled if the user never installs it.
  const [updates, setUpdates] = useState<Record<string, InstallPreview>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkAllMsg, setCheckAllMsg] = useState<string | null>(null);
  const updatesRef = useRef<Record<string, InstallPreview>>({});
  useEffect(() => { updatesRef.current = updates; }, [updates]);

  // Cancel any un-consumed staged bytes when the section unmounts.
  useEffect(() => () => {
    for (const p of Object.values(updatesRef.current)) {
      invoke("cancel_extension_install", { stagingToken: p.staging_token }).catch(() => {});
    }
  }, []);

  const consumeUpdate = (name: string) => {
    setUpdates(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const checkAllUpdates = async () => {
    if (!exts) return;
    // Cancel any leftover staged previews from a prior sweep before re-running.
    for (const p of Object.values(updatesRef.current)) {
      invoke("cancel_extension_install", { stagingToken: p.staging_token }).catch(() => {});
    }
    setUpdates({});
    setCheckingAll(true);
    setCheckAllMsg(null);
    const urlExts = exts.filter(e => e.origin === "url" && !e.dev);
    const found: Record<string, InstallPreview> = {};
    let failures = 0;
    // Sequential: each check re-downloads the full archive (up to 40 MB).
    for (const e of urlExts) {
      try {
        const res = await invoke<{ preview: InstallPreview | null }>("check_extension_update", { name: e.name });
        if (res.preview) found[e.name] = res.preview;
      } catch {
        failures++;
      }
    }
    setUpdates(found);
    setCheckingAll(false);
    const n = Object.keys(found).length;
    setCheckAllMsg(
      `${n === 0 ? "No updates" : `${n} update${n > 1 ? "s" : ""}`}${failures ? ` — ${failures} check failed` : ""}`,
    );
  };

  // Dev-linked extensions sort first: they're the ones being actively worked on.
  const sorted = exts ? [...exts].sort((a, b) => Number(b.dev) - Number(a.dev) || a.name.localeCompare(b.name)) : null;
  const hasUrlExts = !!exts?.some(e => e.origin === "url" && !e.dev);

  return (
    <div className="settings-section">
      <SectionHeader
        title="Extensions"
        desc={<>WASM extensions extend search with new sources and actions. Install from a <code>.portext</code> file or URL, or drop a folder into <code>~/.local/share/portunus/extensions/</code>. Nothing runs until you review its permissions.</>}
      />

      {storageDegraded && (
        <div className="settings-dep-inline-warn">
          Extension storage is running in memory — data will be lost on quit ({storageDegraded})
        </div>
      )}

      <SettingsGroup>
        <SettingsField
          name="Install extension"
          desc="From a URL or a downloaded .portext file. Shows permissions and the archive hash before anything is installed."
        >
          <button className="settings-btn-primary" onClick={() => setInstallOpen(true)}>Install…</button>
        </SettingsField>
      </SettingsGroup>

      {sorted === null && <div className="settings-dep-empty">Scanning…</div>}
      {sorted?.length === 0 && (
        <SettingsGroup>
          <div className="settings-dep-empty">
            No extensions installed yet. Install one above, or scaffold your own with <code>portunus ext new</code>.
          </div>
        </SettingsGroup>
      )}

      {sorted && sorted.length > 0 && (
        // Deliberately NOT a SettingsGroup: the cards are containers already,
        // nesting them in the group card reads as a weird double box.
        <div className="settings-group-block">
          <div className="settings-group-title-row">
            <div className="settings-group-title">Installed</div>
            {hasUrlExts && (
              <button className="settings-btn-secondary" onClick={checkAllUpdates} disabled={checkingAll}>
                {checkingAll ? "Checking…" : checkAllMsg ?? "Check all for updates"}
              </button>
            )}
          </div>
          <div className="settings-ext-cards">
            {sorted.map(info => (
              <ExtensionCard
                key={info.name}
                info={info}
                // Live toggle state comes from config; `info` is a backend snapshot.
                enabled={config.extensions[info.name]?.enabled ?? false}
                isNew={!(info.name in config.extensions)}
                secretsAvailable={secretsAvailable}
                pendingUpdate={updates[info.name]}
                onUpdateConsumed={() => consumeUpdate(info.name)}
                onSetEnabled={v => setEnabled(info.name, v)}
                onChanged={refresh}
              />
            ))}
          </div>
        </div>
      )}

      <SettingsGroup>
        <SettingsField
          name="Rescan"
          desc={<>Re-discover the extensions directory and reload wasm files (also: <code>portunus --reload-extensions</code>).</>}
        >
          <button className="settings-btn-secondary" onClick={rescan}>Rescan</button>
        </SettingsField>
      </SettingsGroup>

      {installOpen && (
        <InstallExtensionDialog onClose={() => setInstallOpen(false)} onInstalled={refresh} />
      )}
    </div>
  );
}
