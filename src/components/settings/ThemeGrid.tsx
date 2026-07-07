import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import rawCss from "../../themes.css?raw";

export interface ThemeDef {
  id: string;
  label: string;
  swatches: string[];
}

/** Parse themes.css at build time into selectable theme definitions with swatches. */
export function buildThemes(): ThemeDef[] {
  const labelRe = /\/\*\s*──\s+([A-Z][a-zA-Z\s-]+?)(?:\s*\([^)]*\))?\s*──/g;
  const blockRe = /:root\[data-theme="([^"]+)"\]\s*\{([^}]+)\}/g;

  const labels: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(rawCss)) !== null) {
    labels.push(m[1].trim());
  }

  const themes: ThemeDef[] = [];
  let i = 0;
  while ((m = blockRe.exec(rawCss)) !== null) {
    const [, id, body] = m;
    const v = (name: string) => {
      const vm = new RegExp(`--${name}:\\s*([^;\\n]+)`).exec(body);
      return vm ? vm[1].trim() : "#888";
    };
    themes.push({
      id,
      label: labels[i++] ?? id,
      swatches: [v("bg-card"), v("bg-bar"), v("accent"), v("fg"), v("fg-mute")],
    });
  }
  return themes;
}

const MATUGEN_PLACEHOLDER = ["#3a3a3a", "#2a2a2a", "#888", "#ddd", "#999"];
const MATUGEN_VARS = ["bg-card", "bg-bar", "accent", "fg", "fg-mute"];

/** Parse the matugen swatch colors out of the external matugen.css text. Unlike
 *  the built-in themes (compiled into themes.css), matugen's colors live in an
 *  external file generated at runtime, so they must be read from that CSS rather
 *  than from computed styles (which only reflect the *active* theme). */
function parseMatugenSwatches(css: string): string[] | null {
  const sw = MATUGEN_VARS.map(name => {
    const m = new RegExp(`--${name}:\\s*([^;\\n]+)`).exec(css);
    return m ? m[1].trim() : null;
  });
  return sw.every(Boolean) ? (sw as string[]) : null;
}

export const THEMES: ThemeDef[] = [
  ...buildThemes(),
  // Synthetic entry: matugen colors come from an external file at runtime, so it
  // isn't parsed from themes.css. Selecting it sets data-theme="matugen".
  { id: "matugen", label: "Matugen", swatches: MATUGEN_PLACEHOLDER },
];

const STYLES = `
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.theme-card {
  position: relative;
  padding: 14px 15px 13px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--kbd-bg);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
  text-align: left;
}

.theme-card:hover {
  border-color: var(--fg-dim);
  background: var(--bg-row-hov);
}

.theme-card.selected {
  border-color: var(--accent);
  background: var(--bg-row-hov);
}

.theme-card-label {
  font-size: var(--fs-desc, 12px);
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 9px;
  letter-spacing: -0.01em;
  line-height: 1;
}

.theme-card-swatches {
  display: flex;
  gap: 4px;
  align-items: center;
}

.theme-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
}

.theme-card-check {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.6);
  transition: opacity 0.15s, transform 0.15s;
}

.theme-card.selected .theme-card-check {
  opacity: 1;
  transform: scale(1);
}
`;

if (typeof document !== "undefined") {
  const id = "theme-grid-styles";
  if (!document.getElementById(id)) {
    const el = document.createElement("style");
    el.id = id;
    el.textContent = STYLES;
    document.head.appendChild(el);
  }
}

interface Props {
  /** Currently-selected theme id. */
  value: string;
  onSelect: (id: string) => void;
}

/** Shared 3-column theme picker grid with color swatches (Settings + onboarding). */
export default function ThemeGrid({ value, onSelect }: Props) {
  // Matugen colors live in an external runtime file, so fetch + parse them once
  // so its swatches show real colors regardless of the currently-active theme.
  const [matugen, setMatugen] = useState<string[] | null>(null);
  useEffect(() => {
    invoke<string | null>("get_custom_theme_css")
      .then(css => { if (css) setMatugen(parseMatugenSwatches(css)); })
      .catch(() => {});
  }, []);

  return (
    <div className="theme-grid">
      {THEMES.map((t) => {
        const swatches = t.id === "matugen" && matugen ? matugen : t.swatches;
        return (
        <button
          key={t.id}
          type="button"
          className={`theme-card${value === t.id ? " selected" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          <div className="theme-card-label">{t.label}</div>
          <div className="theme-card-swatches">
            {swatches.map((color, i) => (
              <span key={i} className="theme-swatch" style={{ background: color }} />
            ))}
          </div>
          <span className="theme-card-check" aria-hidden>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="var(--text-on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </button>
        );
      })}
    </div>
  );
}
