import rawCss from "../../themes.css?raw";
import { Config } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

interface ThemeDef {
  id: string;
  label: string;
  swatches: string[];
}

function buildThemes(): ThemeDef[] {
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

const THEMES = buildThemes();

const STYLES = `
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, auto);
  justify-content: start;
  gap: 8px;
  margin-top: 14px;
}

.theme-card {
  position: relative;
  padding: 11px 11px 10px;
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
  font-size: 11px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 8px;
  letter-spacing: -0.01em;
  line-height: 1;
}

.theme-card-swatches {
  display: flex;
  gap: 4px;
  align-items: center;
}

.theme-swatch {
  width: 13px;
  height: 13px;
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
  const id = "appearance-section-styles";
  if (!document.getElementById(id)) {
    const el = document.createElement("style");
    el.id = id;
    el.textContent = STYLES;
    document.head.appendChild(el);
  }
}

export default function AppearanceSection({ config, onChange }: Props) {
  const set = (patch: Partial<Config["appearance"]>) =>
    onChange({ ...config, appearance: { ...config.appearance, ...patch } });

  const { theme, font_size } = config.appearance;

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Appearance</div>
        <div className="settings-section-desc">Theme and display settings.</div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-mute)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
          Theme
        </div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-card${theme === t.id ? " selected" : ""}`}
              onClick={() => set({ theme: t.id })}
            >
              <div className="theme-card-label">{t.label}</div>
              <div className="theme-card-swatches">
                {t.swatches.map((color, i) => (
                  <span key={i} className="theme-swatch" style={{ background: color }} />
                ))}
              </div>
              <span className="theme-card-check" aria-hidden>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="var(--text-on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Zoom</div>
          <div className="settings-field-desc">Scale the entire UI proportionally</div>
        </div>
        <div className="settings-field-control">
          <div className="settings-number-wrap">
            <button
              className="settings-number-btn"
              onClick={() => set({ font_size: Math.max(11, font_size - 1) })}
            >−</button>
            <input
              type="number"
              className="settings-number-input"
              value={font_size}
              min={11} max={18} step={1}
              onChange={e => {
                const v = parseInt(e.target.value);
                if (!isNaN(v) && v >= 11 && v <= 18) set({ font_size: v });
              }}
            />
            <button
              className="settings-number-btn"
              onClick={() => set({ font_size: Math.min(18, font_size + 1) })}
            >+</button>
          </div>
        </div>
      </div>
    </div>
  );
}
