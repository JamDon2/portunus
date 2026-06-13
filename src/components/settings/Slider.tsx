import { CSSProperties, useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Formats the live value readout next to the track. */
  format?: (v: number) => string;
  /** Accessible name. */
  label?: string;
  /**
   * Only fire `onChange` when the drag ends (pointer up / key up / blur) instead
   * of on every input. Use for settings whose application is expensive or visually
   * disruptive mid-drag (e.g. interface scale, which rescales this very window).
   * The thumb still tracks the pointer live via a local value.
   */
  commitOnRelease?: boolean;
}

export default function Slider({ value, min, max, step = 1, onChange, format, label, commitOnRelease }: Props) {
  // Local display value: in commit-on-release mode the thumb follows the pointer
  // through `local` while the committed `value` stays put until release.
  const [local, setLocal] = useState(value);
  const localRef = useRef(value);
  const dragging = useRef(false);

  // Adopt external changes (e.g. config reload) only when not mid-drag.
  useEffect(() => {
    if (!dragging.current) { setLocal(value); localRef.current = value; }
  }, [value]);

  const display = commitOnRelease ? local : value;
  const pct = max > min ? ((display - min) / (max - min)) * 100 : 0;

  const setLocalVal = (v: number) => { setLocal(v); localRef.current = v; };
  const commit = () => {
    if (!commitOnRelease) return;
    dragging.current = false;
    if (localRef.current !== value) onChange(localRef.current);
  };

  return (
    <div className="settings-slider">
      <input
        type="range"
        className="settings-slider-input"
        min={min}
        max={max}
        step={step}
        value={display}
        aria-label={label}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (commitOnRelease) setLocalVal(v);
          else onChange(v);
        }}
        onPointerDown={() => { if (commitOnRelease) dragging.current = true; }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="settings-slider-value">{format ? format(display) : display}</span>
    </div>
  );
}
