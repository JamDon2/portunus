import type { Shortcut } from "./shortcut";
import type { LaunchContext } from "../providers/registry";

export type ActionSection = "result" | "global";

/** One executable entry in the action panel (Alt+Enter). Providers declare
 *  these per result; App.tsx composes the generic rows (open, Quick Look) and
 *  the global section from the command catalog. */
export interface ActionDescriptor {
  /** Stable identity: "file:copy-path", "ext:<action.id>", "cmd:settings". */
  id: string;
  title: string;
  /** Muted context shown after the title (extension action hints). */
  hint?: string;
  section: ActionSection;
  /** Drives both the chord dispatch and the kbd badge. Absent = menu-only. */
  shortcut?: Shortcut;
  /** Badge-only shortcut: the chord is handled by a bespoke App.tsx branch
   *  (Enter launch, Shift+Enter Quick Look, Tab, Ctrl+H), so dispatchShortcut
   *  must not fire it a second time. */
  displayOnly?: boolean;
  run: (ctx: LaunchContext) => void;
}
