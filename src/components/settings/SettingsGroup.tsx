import { ReactNode } from "react";

interface Props {
  /** Optional uppercase group label above the card. */
  title?: string;
  /** Optional explanatory text shown under the title, above the card. */
  desc?: ReactNode;
  /** Optional right-aligned control on the title row (e.g. a reset button). */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * A titled card grouping related `SettingsField`s. Gives each subsection visual
 * rhythm instead of one long undifferentiated list. Fields inside are separated
 * by the existing `.settings-field` dividers.
 */
export default function SettingsGroup({ title, desc, action, children }: Props) {
  return (
    <div className="settings-group-block">
      {title && action ? (
        <div className="settings-group-title-row">
          <div className="settings-group-title">{title}</div>
          {action}
        </div>
      ) : (
        title && <div className="settings-group-title">{title}</div>
      )}
      {desc && <div className="settings-group-desc">{desc}</div>}
      <div className="settings-group">{children}</div>
    </div>
  );
}
