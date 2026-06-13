import { Config } from "../../types";
import Toggle from "./Toggle";
import SectionHeader from "./SectionHeader";
import SettingsGroup from "./SettingsGroup";
import SettingsField from "./SettingsField";
import NumberStepper from "./NumberStepper";
import { useDep } from "./DepsContext";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

export default function DictSection({ config, onChange }: Props) {
  const set = (patch: Partial<Config["dict"]>) =>
    onChange({ ...config, dict: { ...config.dict, ...patch } });

  const dictDep = useDep("dict");
  const missing = config.dict.enabled && dictDep && !dictDep.available;
  const disabled = !config.dict.enabled;

  return (
    <div className="settings-section">
      <SectionHeader
        title="Dictionary"
        desc={<>Word definitions via dict. Explicit <code>define</code> and <code>dict</code> lookups, plus optional sparse-result fill for plain words.</>}
        master={{ checked: config.dict.enabled, onChange: v => set({ enabled: v }), label: "Enable dictionary" }}
        warn={missing && (
          <div className="settings-dep-inline-warn">
            ⚠ Enabled but <code>{dictDep!.label}</code> is missing. Install <code>{dictDep!.install_hint}</code>
          </div>
        )}
      />

      <div className={disabled ? "settings-disabled" : undefined} aria-hidden={disabled}>
        <SettingsGroup title="Sparse-result fill">
          <SettingsField
            name="Fill sparse results"
            desc="When few other results match a plain word, add dictionary entries for it."
          >
            <Toggle label="Fill sparse results" checked={config.dict.fill_sparse} onChange={v => set({ fill_sparse: v })} />
          </SettingsField>

          <SettingsField
            name="Correct misspellings"
            desc="Allow edit-distance (typo) matches when filling. Off = exact word only."
          >
            <Toggle label="Correct misspellings" checked={config.dict.correct_misspellings} onChange={v => set({ correct_misspellings: v })} />
          </SettingsField>

          <SettingsField
            name="Fill threshold"
            desc="Only fill when fewer than this many non-dictionary results exist."
          >
            <NumberStepper label="Fill threshold" value={config.dict.fill_threshold} min={0} max={20} onChange={v => set({ fill_threshold: v })} />
          </SettingsField>

          <SettingsField name="Fill max" desc="Maximum dictionary rows added when filling.">
            <NumberStepper label="Fill max" value={config.dict.fill_max} min={0} max={20} onChange={v => set({ fill_max: v })} />
          </SettingsField>
        </SettingsGroup>

        <SettingsGroup title="Behaviour">
          <SettingsField
            name="Copy definition on Ctrl+C"
            desc="On = copy the first definition. Off = copy the word itself."
          >
            <Toggle label="Copy definition on Ctrl+C" checked={config.dict.copy_definition} onChange={v => set({ copy_definition: v })} />
          </SettingsField>
        </SettingsGroup>
      </div>
    </div>
  );
}
