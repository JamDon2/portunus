interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Fixed input width in px (for wide values). */
  width?: number;
  /** Unit shown after the stepper (e.g. "MB"). */
  suffix?: string;
  /** Accessible name. */
  label?: string;
  onChange: (v: number) => void;
}

/**
 * Pure −/+ number stepper control (no label/desc) — compose inside
 * `SettingsField`. Rejects NaN and sub-floor values so typing can't push a
 * field into an invalid range.
 */
export default function NumberStepper({ value, min, max, step, width, suffix, label, onChange }: Props) {
  const dec = () => onChange(Math.max(min ?? 0, value - (step ?? 1)));
  const inc = () => onChange(Math.min(max ?? Infinity, value + (step ?? 1)));
  return (
    <div className="settings-number-row">
      <div className="settings-number-wrap">
        <button className="settings-number-btn" onClick={dec} aria-label={label && `Decrease ${label}`}>−</button>
        <input
          type="number"
          className="settings-number-input"
          style={width ? { width } : undefined}
          value={value}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && (min === undefined || v >= min)) onChange(v);
          }}
        />
        <button className="settings-number-btn" onClick={inc} aria-label={label && `Increase ${label}`}>+</button>
      </div>
      {suffix && <span className="settings-number-suffix">{suffix}</span>}
    </div>
  );
}
