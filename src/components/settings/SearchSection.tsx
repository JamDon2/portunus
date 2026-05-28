import { Config } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

function NumberField({
  label, desc, value, min, max, step, onChange,
}: {
  label: string; desc: string; value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <div className="settings-field-name">{label}</div>
        <div className="settings-field-desc">{desc}</div>
      </div>
      <div className="settings-field-control">
        <div className="settings-number-wrap">
          <button className="settings-number-btn" onClick={() => onChange(Math.max(min ?? 0, value - (step ?? 1)))}>−</button>
          <input
            type="number"
            className="settings-number-input"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(v);
            }}
          />
          <button className="settings-number-btn" onClick={() => onChange(Math.min(max ?? Infinity, value + (step ?? 1)))}>+</button>
        </div>
      </div>
    </div>
  );
}

export default function SearchSection({ config, onChange }: Props) {
  const set = (patch: Partial<Config["search"]>) =>
    onChange({ ...config, search: { ...config.search, ...patch } });

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Search</div>
        <div className="settings-section-desc">Tune fuzzy match quality thresholds and recency scoring.</div>
      </div>

      <NumberField
        label="File score threshold"
        desc="Minimum fuzzy match quality for files and folders (0–255). Higher = stricter matching."
        value={config.search.min_score_file}
        min={0} max={255} step={1}
        onChange={v => set({ min_score_file: v })}
      />
      <NumberField
        label="App score threshold"
        desc="Minimum fuzzy match quality for applications (0–255). Higher = stricter matching."
        value={config.search.min_score_app}
        min={0} max={255} step={1}
        onChange={v => set({ min_score_app: v })}
      />
      <NumberField
        label="Recency weight"
        desc="Maximum bonus added to file scores for recently modified items. Decays linearly to 0 at 1 year old."
        value={config.search.recency_weight}
        min={0} max={500} step={5}
        onChange={v => set({ recency_weight: v })}
      />
    </div>
  );
}
