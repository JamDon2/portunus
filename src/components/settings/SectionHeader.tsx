import { ReactNode } from "react";
import Toggle from "./Toggle";

interface MasterToggle {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name; defaults to the section title. */
  label?: string;
}

interface Props {
  title: string;
  desc?: ReactNode;
  /** Optional warning (e.g. a missing dependency) under the description. */
  warn?: ReactNode;
  /** Renders a prominent on/off switch in the header (the section master switch). */
  master?: MasterToggle;
}

/**
 * Section title + description, with an optional master on/off switch on the
 * right. Used so a source section's enable lives as a visible header affordance
 * (in sync with the Providers overview) rather than buried as the first field.
 */
export default function SectionHeader({ title, desc, warn, master }: Props) {
  return (
    <div className={`settings-section-header${master ? " settings-section-header--master" : ""}`}>
      <div className="settings-section-head-text">
        <div className="settings-section-name">{title}</div>
        {desc && <div className="settings-section-desc">{desc}</div>}
        {warn}
      </div>
      {master && (
        <div className="settings-section-master">
          <span className={`settings-section-master-state${master.checked ? " on" : ""}`}>
            {master.checked ? "On" : "Off"}
          </span>
          <Toggle label={master.label ?? title} checked={master.checked} onChange={master.onChange} />
        </div>
      )}
    </div>
  );
}
