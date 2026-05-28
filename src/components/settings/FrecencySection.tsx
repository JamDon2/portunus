import { Config } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-wrap">
      <input type="checkbox" className="toggle-input" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  );
}

export default function FrecencySection({ config, onChange }: Props) {
  const set = (patch: Partial<Config["frecency"]>) =>
    onChange({ ...config, frecency: { ...config.frecency, ...patch } });

  const fr = config.frecency;

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Frecency</div>
        <div className="settings-section-desc">Boosts items you launch frequently to the top of results.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Enable frecency</div>
          <div className="settings-field-desc">Track launch history to surface frequently used apps and files. Stored in SQLite at $XDG_DATA_HOME/portunus/frecency.db</div>
        </div>
        <div className="settings-field-control">
          <Toggle checked={fr.enabled} onChange={v => set({ enabled: v })} />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Half-life (days)</div>
          <div className="settings-field-desc">Frecency score halves every N days of non-use. Shorter = fades faster; longer = longer memory.</div>
        </div>
        <div className="settings-field-control">
          <div className="settings-number-wrap">
            <button className="settings-number-btn" onClick={() => set({ half_life_days: Math.max(1, fr.half_life_days - 1) })}>−</button>
            <input
              type="number"
              className="settings-number-input"
              value={fr.half_life_days}
              min={1} max={365} step={1}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) set({ half_life_days: v }); }}
            />
            <button className="settings-number-btn" onClick={() => set({ half_life_days: Math.min(365, fr.half_life_days + 1) })}>+</button>
          </div>
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Score weight</div>
          <div className="settings-field-desc">Multiplier applied to the frecency bonus on top of the base category score. Higher = frecency has more influence.</div>
        </div>
        <div className="settings-field-control">
          <div className="settings-number-wrap">
            <button className="settings-number-btn" onClick={() => set({ weight: Math.max(0, fr.weight - 500) })}>−</button>
            <input
              type="number"
              className="settings-number-input"
              style={{ width: 72 }}
              value={fr.weight}
              min={0} max={50000} step={500}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) set({ weight: v }); }}
            />
            <button className="settings-number-btn" onClick={() => set({ weight: Math.min(50000, fr.weight + 500) })}>+</button>
          </div>
        </div>
      </div>
    </div>
  );
}
