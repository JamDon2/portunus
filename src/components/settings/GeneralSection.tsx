import { Config } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

export default function GeneralSection({ config, onChange }: Props) {
  const set = (max_results: number) =>
    onChange({ ...config, general: { ...config.general, max_results } });

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">General</div>
        <div className="settings-section-desc">Top-level launcher behaviour.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Max results</div>
          <div className="settings-field-desc">Total results shown in the launcher per query</div>
        </div>
        <div className="settings-field-control">
          <div className="settings-number-wrap">
            <button className="settings-number-btn" onClick={() => set(Math.max(1, config.general.max_results - 1))}>−</button>
            <input
              type="number"
              className="settings-number-input"
              value={config.general.max_results}
              min={1}
              max={50}
              onChange={e => set(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button className="settings-number-btn" onClick={() => set(Math.min(50, config.general.max_results + 1))}>+</button>
          </div>
        </div>
      </div>
    </div>
  );
}
