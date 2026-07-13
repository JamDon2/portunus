import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Config } from "../../types";
import Toggle from "./Toggle";
import SectionHeader from "./SectionHeader";
import SettingsGroup from "./SettingsGroup";
import SettingsField from "./SettingsField";
import NumberStepper from "./NumberStepper";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

export default function GeneralSection({ config, onChange }: Props) {
  const setGeneral = (patch: Partial<Config["general"]>) =>
    onChange({ ...config, general: { ...config.general, ...patch } });

  // Autostart is not config: it derives from ~/.config/autostart/portunus.desktop
  // existing, so external edits (DE settings panels) can't desync. It bypasses
  // the autosave/staging pipeline and applies instantly. null = probe pending.
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    invoke<boolean>("get_autostart")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);
  const toggleAutostart = (on: boolean) => {
    setAutostart(on); // optimistic
    invoke("set_autostart", { enabled: on }).catch(e => {
      console.error("[settings] set_autostart failed:", e);
      setAutostart(!on);
    });
  };

  return (
    <div className="settings-section">
      <SectionHeader title="General" desc="How the launcher window behaves." />

      <SettingsGroup>
        <SettingsField name="Max results" desc="Total results shown in the launcher per query.">
          <NumberStepper
            label="Max results"
            value={config.general.max_results}
            min={1}
            max={50}
            onChange={max_results => setGeneral({ max_results })}
          />
        </SettingsField>

        <SettingsField
          name="Start at login"
          desc="Run the background service at login via ~/.config/autostart. Compositors like Hyprland or sway ignore this - use an exec line in their config instead."
        >
          <Toggle
            label="Start at login"
            checked={autostart === true}
            onChange={toggleAutostart}
            disabled={autostart === null}
          />
        </SettingsField>

        <SettingsField
          name="Layer-shell overlay"
          desc="Wayland only. Draw the launcher as a true overlay above all windows. Restart to apply."
        >
          <Toggle label="Layer-shell overlay" checked={config.general.layer_shell} onChange={layer_shell => setGeneral({ layer_shell })} />
        </SettingsField>
      </SettingsGroup>
    </div>
  );
}
