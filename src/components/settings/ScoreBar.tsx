import { ScoreBreakdown } from "../../types";

interface Props {
  breakdown: ScoreBreakdown;
  /** Largest (score + penalty) across the rendered rows - normalizes widths. */
  max: number;
  /** Swap the bar for a mono numeric readout (alt-held / hover disclosure). */
  showNumbers: boolean;
}

function fmt(v: number): string {
  const m = v / 1_000_000;
  if (Math.abs(m) >= 1) return `${m.toFixed(1)}M`;
  const k = v / 1_000;
  if (Math.abs(k) >= 1) return `${Math.round(k)}k`;
  return `${Math.round(v)}`;
}

/**
 * Segmented score bar for the ranking playground. One accent only: positive
 * components share `--accent` on an opacity ramp (base → match → history →
 * pin); a penalty renders as a hatched notch at the fill's end.
 */
export default function ScoreBar({ breakdown, max, showNumbers }: Props) {
  const { base, match_bonus, frecency_bonus, pin_bonus, penalty } = breakdown;
  if (showNumbers) {
    return (
      <div className="settings-scorebar-nums">
        {fmt(base)}
        {match_bonus > 0 && ` +${fmt(match_bonus)}`}
        {frecency_bonus > 0 && ` +${fmt(frecency_bonus)}`}
        {pin_bonus > 0 && " ★"}
        {penalty > 0 && ` −${fmt(penalty)}`}
      </div>
    );
  }
  const total = Math.max(max, 1);
  const w = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  return (
    <div className="settings-scorebar" aria-hidden="true">
      <span className="settings-scorebar-seg" data-seg="base" style={{ width: w(base - penalty) }} />
      {match_bonus > 0 && <span className="settings-scorebar-seg" data-seg="match" style={{ width: w(match_bonus) }} />}
      {frecency_bonus > 0 && <span className="settings-scorebar-seg" data-seg="frecency" style={{ width: w(frecency_bonus) }} />}
      {pin_bonus > 0 && <span className="settings-scorebar-seg" data-seg="pin" style={{ width: w(Math.min(pin_bonus, total * 0.15)) }} />}
      {penalty > 0 && <span className="settings-scorebar-penalty" style={{ width: w(penalty) }} />}
    </div>
  );
}
