import { Config } from "../../types";
import ThemeGrid from "./ThemeGrid";
import Toggle from "./Toggle";
import Select from "./Select";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

const ANIM_OPTIONS = [
  { label: "Off",   value: "off"   },
  { label: "Slide", value: "slide" },
  { label: "FLIP",  value: "flip"  },
] as const;

function animLabel(v: Config["appearance"]["animate_results"]): string {
  return ANIM_OPTIONS.find(o => o.value === v)?.label ?? "Slide";
}

export default function AppearanceSection({ config, onChange }: Props) {
  const set = (patch: Partial<Config["appearance"]>) =>
    onChange({ ...config, appearance: { ...config.appearance, ...patch } });

  const { theme, font_size, animate_results, show_metadata, accent_bleed, slide_selection } = config.appearance;

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
        <ThemeGrid value={theme} onSelect={(id) => set({ theme: id })} />
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

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Result animations</div>
          <div className="settings-field-desc">Off · Slide-in entrance · FLIP repositioning of retained rows</div>
        </div>
        <div className="settings-field-control">
          <Select
            options={ANIM_OPTIONS.map(o => ({ label: o.label }))}
            value={animLabel(animate_results)}
            onChange={label => {
              const opt = ANIM_OPTIONS.find(o => o.label === label);
              if (opt) set({ animate_results: opt.value });
            }}
          />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">File metadata</div>
          <div className="settings-field-desc">Show the modified/created row in file previews</div>
        </div>
        <div className="settings-field-control">
          <Toggle
            label="File metadata"
            checked={show_metadata ?? true}
            onChange={v => set({ show_metadata: v })}
          />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Accent bleed</div>
          <div className="settings-field-desc">Tint the selection and preview with the app's icon color</div>
        </div>
        <div className="settings-field-control">
          <Toggle
            label="Accent bleed"
            checked={accent_bleed ?? true}
            onChange={v => set({ accent_bleed: v })}
          />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Sliding selection</div>
          <div className="settings-field-desc">Glide the highlight between rows as you navigate</div>
        </div>
        <div className="settings-field-control">
          <Toggle
            label="Sliding selection"
            checked={slide_selection ?? true}
            onChange={v => set({ slide_selection: v })}
          />
        </div>
      </div>
    </div>
  );
}
