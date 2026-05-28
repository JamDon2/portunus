import { Config } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

interface ProviderDef {
  key: keyof Config["providers"];
  label: string;
  desc: string;
}

const PROVIDERS: ProviderDef[] = [
  { key: "apps",   label: "Applications",  desc: "Search .desktop application entries" },
  { key: "files",  label: "Files",         desc: "Indexed file search" },
  { key: "recent", label: "Recent files",  desc: "Recently-used files from ~/.local/share/recently-used.xbel" },
  { key: "calc",   label: "Calculator",    desc: "Inline math expression evaluator" },
  { key: "dict",   label: "Dictionary",    desc: "Word definitions via dict (requires dictd: sudo pacman -S dictd)" },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-wrap">
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  );
}

export default function ProvidersSection({ config, onChange }: Props) {
  const set = (key: keyof Config["providers"], value: boolean) =>
    onChange({ ...config, providers: { ...config.providers, [key]: value } });

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Providers</div>
        <div className="settings-section-desc">Enable or disable individual search providers.</div>
      </div>

      {PROVIDERS.map(({ key, label, desc }) => (
        <div className="settings-field" key={key}>
          <div className="settings-field-label">
            <div className="settings-field-name">{label}</div>
            <div className="settings-field-desc">{desc}</div>
          </div>
          <div className="settings-field-control">
            <Toggle checked={config.providers[key]} onChange={v => set(key, v)} />
          </div>
        </div>
      ))}
    </div>
  );
}
