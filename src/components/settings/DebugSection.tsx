import { Config } from "../../types";
import Toggle from "./Toggle";
import SectionHeader from "./SectionHeader";
import SettingsGroup from "./SettingsGroup";
import SettingsField from "./SettingsField";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

const FIELDS: { key: keyof Config["debug"]; name: string; desc: string }[] = [
  { key: "log_scores",  name: "Log match scores",  desc: "Print fuzzy match scores and thresholds for every candidate to stderr." },
  { key: "log_watcher", name: "Log watcher events", desc: "Print filesystem watcher events and index update decisions to stderr." },
  { key: "log_pdf",     name: "Log PDF rendering",  desc: "Print pdfium load/render/encode steps to stderr." },
];

export default function DebugSection({ config, onChange }: Props) {
  const set = (patch: Partial<Config["debug"]>) =>
    onChange({ ...config, debug: { ...config.debug, ...patch } });

  return (
    <div className="settings-section">
      <SectionHeader
        title="Debug"
        desc="Diagnostic output written to stderr. Useful when troubleshooting search quality or watcher issues."
      />

      <SettingsGroup>
        {FIELDS.map(f => (
          <SettingsField key={f.key} name={f.name} desc={f.desc}>
            <Toggle label={f.name} checked={config.debug[f.key]} onChange={v => set({ [f.key]: v })} />
          </SettingsField>
        ))}
      </SettingsGroup>
    </div>
  );
}
