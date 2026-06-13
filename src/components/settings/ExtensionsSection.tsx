import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriListener } from "../../hooks/useTauriListener";
import { Config, ExtensionInfo } from "../../types";
import { WarnIcon } from "../../icons";
import Toggle from "./Toggle";
import SectionHeader from "./SectionHeader";
import SettingsGroup from "./SettingsGroup";
import SettingsField from "./SettingsField";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

function fmtInterval(secs: number): string {
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

/** Human summary of what an extension may touch - shown BEFORE first enable. */
function PermissionChips({ info }: { info: ExtensionInfo }) {
  if (!info.permissions) return null;
  const chips: string[] = [];
  if (info.permissions.network.length > 0) chips.push(`network: ${info.permissions.network.join(", ")}`);
  if (info.permissions.kv) chips.push("storage");
  if (info.permissions.clipboard) chips.push("clipboard");
  if (info.permissions.open_url) chips.push("open urls");
  if (chips.length === 0) chips.push("no permissions");
  if (info.background_interval_secs != null) chips.push(`background: every ${fmtInterval(info.background_interval_secs)}`);
  return (
    <div className="settings-ext-perms">
      {chips.map(c => <code key={c}>{c}</code>)}
    </div>
  );
}

export default function ExtensionsSection({ config, onChange }: Props) {
  const [exts, setExts] = useState<ExtensionInfo[] | null>(null);

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
  // Runtime errors happen while the user is in the LAUNCHER; refresh on focus.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => { if (focused) refresh(); })
      .then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, [refresh]);

  const setEnabled = (name: string, value: boolean) =>
    onChange({ ...config, extensions: { ...config.extensions, enabled: { ...config.extensions.enabled, [name]: value } } });

  const rescan = () => { invoke("rescan_extensions").catch(() => {}); };

  return (
    <div className="settings-section">
      <SectionHeader
        title="Extensions"
        desc={<>WASM extensions from <code>~/.local/share/portunus/extensions/</code>. New extensions stay disabled until you review their permissions and enable them.</>}
      />

      {exts === null && <div className="settings-dep-empty">Scanning…</div>}
      {exts?.length === 0 && (
        <SettingsGroup>
          <div className="settings-dep-empty">
            No extensions installed. Drop a folder with <code>manifest.toml</code> + <code>extension.wasm</code> into the extensions directory, then Rescan.
          </div>
        </SettingsGroup>
      )}

      {exts && exts.length > 0 && (
        <SettingsGroup title="Installed">
          {exts.map(info => {
            // Live toggle state comes from config; `info` is a backend snapshot.
            const enabled = config.extensions.enabled[info.name] ?? false;
            const isNew = !(info.name in config.extensions.enabled);
            return (
              <SettingsField
                key={info.name}
                name={<>
                  {info.name}
                  {info.version && <span className="settings-ext-version"> v{info.version}</span>}
                  {isNew && <span className="settings-ext-new"> new — review &amp; enable</span>}
                </>}
                desc={<>
                  {info.description}
                  <PermissionChips info={info} />
                </>}
                warn={<>
                  {info.error && <div className="settings-dep-inline-warn"><WarnIcon />{info.error}</div>}
                  {info.benched && <div className="settings-dep-inline-warn"><WarnIcon />Disabled for this session after repeated failures. Fix and Rescan.</div>}
                </>}
              >
                <Toggle label={info.name} checked={enabled} onChange={v => setEnabled(info.name, v)} />
              </SettingsField>
            );
          })}
        </SettingsGroup>
      )}

      <SettingsGroup>
        <SettingsField
          name="Rescan"
          desc={<>Re-discover the extensions directory and reload wasm files (also: <code>portunus --reload-extensions</code>).</>}
        >
          <button className="settings-btn-secondary" onClick={rescan}>Rescan</button>
        </SettingsField>
      </SettingsGroup>
    </div>
  );
}
