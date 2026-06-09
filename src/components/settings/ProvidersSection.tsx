import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Config, DepStatus } from "../../types";
import Toggle from "./Toggle";
import Select from "./Select";
import NumberField from "./NumberField";

const PASTE_MODES: { label: string; value: "auto" | "copy" }[] = [
  { label: "Paste into focused app (auto)", value: "auto" },
  { label: "Copy to clipboard only", value: "copy" },
];

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

interface ProviderDef {
  key: keyof Config["providers"];
  label: string;
  desc: string;
  // Dependency id (from check_dependencies) this provider needs to function.
  dep?: string;
}

const PROVIDERS: ProviderDef[] = [
  { key: "apps",  label: "Applications", desc: "Search .desktop application entries" },
  { key: "files", label: "Files",        desc: "Indexed file search" },
  { key: "calc",  label: "Calculator",   desc: "Inline math expression evaluator" },
];

export default function ProvidersSection({ config, onChange }: Props) {
  const set = (key: keyof Config["providers"], value: boolean) =>
    onChange({ ...config, providers: { ...config.providers, [key]: value } });

  const [deps, setDeps] = useState<DepStatus[] | null>(null);
  useEffect(() => {
    invoke<DepStatus[]>("check_dependencies").then(setDeps).catch(() => setDeps([]));
  }, []);

  const depById = (id: string) => deps?.find(d => d.id === id);

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Providers</div>
        <div className="settings-section-desc">Enable or disable individual search providers.</div>
      </div>

      {PROVIDERS.map(({ key, label, desc, dep }) => {
        const enabled = config.providers[key];
        const status = dep ? depById(dep) : undefined;
        const missing = enabled && status && !status.available;
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-label">
              <div className="settings-field-name">{label}</div>
              <div className="settings-field-desc">{desc}</div>
              {missing && (
                <div className="settings-dep-inline-warn">
                  ⚠ Enabled but <code>{status!.label}</code> is missing. Install <code>{status!.install_hint}</code>
                </div>
              )}
            </div>
            <div className="settings-field-control">
              <Toggle label={label} checked={enabled} onChange={v => set(key, v)} />
            </div>
          </div>
        );
      })}

      <div className="settings-subsection">
        <div className="settings-section-name">Clipboard history</div>
        <div className="settings-section-desc" style={{ marginBottom: 10 }}>
          The clipboard browser (<code>clip</code> or <code>portunus --clipboard</code>).
        </div>

        <div className="settings-field">
          <div className="settings-field-label">
            <div className="settings-field-name">On Enter</div>
            <div className="settings-field-desc">
              Auto paste types Ctrl+V into the previously focused window.
            </div>
            {config.clipboard.paste_mode === "auto" && depById("wtype") && !depById("wtype")!.available && (
              <div className="settings-dep-inline-warn">
                ⚠ Auto paste needs <code>wtype</code>; without it Enter falls back to copy-only. Install <code>wtype</code>
              </div>
            )}
          </div>
          <div className="settings-field-control">
            <Select
              options={PASTE_MODES.map(m => ({ label: m.label }))}
              value={PASTE_MODES.find(m => m.value === config.clipboard.paste_mode)?.label ?? PASTE_MODES[0].label}
              onChange={label => {
                const mode = PASTE_MODES.find(m => m.label === label)?.value ?? "auto";
                onChange({ ...config, clipboard: { ...config.clipboard, paste_mode: mode } });
              }}
            />
          </div>
        </div>

        <NumberField
          label="Max entries"
          desc="How many history entries the browser loads."
          value={config.clipboard.max_entries}
          min={10}
          max={750}
          step={10}
          width={70}
          onChange={v => onChange({ ...config, clipboard: { ...config.clipboard, max_entries: v } })}
        />
      </div>

      <div className="settings-deps">
        <div className="settings-deps-title">System dependencies</div>
        <div className="settings-field-desc" style={{ marginBottom: 10 }}>
          Optional tools that power individual features. Missing tools disable only their feature.
        </div>
        {deps === null ? (
          <div className="settings-field-desc">Checking…</div>
        ) : (
          deps.map(d => (
            <div className="settings-dep-row" key={d.id}>
              <span className={`settings-dep-dot${d.available ? " ok" : " missing"}`} />
              <span className="settings-dep-feature">{d.feature}</span>
              <span className="settings-dep-tool">
                {d.available
                  ? <>{d.label} ✓</>
                  : <>{d.label} missing. Install <code>{d.install_hint}</code></>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
