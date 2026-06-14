interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name for screen readers (the visual label sits in a sibling element). */
  label?: string;
  /** When set, the toggle is non-interactive and visually dimmed. */
  disabled?: boolean;
}

export default function Toggle({ checked, onChange, label, disabled = false }: Props) {
  return (
    <label className={`toggle-wrap${disabled ? " toggle-wrap--disabled" : ""}`}>
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  );
}
