// Structured keyboard shortcuts: declared once on an ActionDescriptor, they
// drive both the window-level chord dispatch and the action panel's kbd badge,
// so the handler and the displayed hint can never drift apart.

export interface Shortcut {
  /** KeyboardEvent.key, canonical lowercase: "enter", "c", "tab". */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Match e.code instead of e.key (WebKitGTK remaps e.g. Ctrl+H to an
   *  editing command, but e.code stays "KeyH"). */
  code?: string;
}

export const matchesShortcut = (e: KeyboardEvent, s: Shortcut): boolean =>
  (s.code ? e.code === s.code : e.key.toLowerCase() === s.key) &&
  e.ctrlKey === !!s.ctrl &&
  e.altKey === !!s.alt &&
  e.shiftKey === !!s.shift &&
  !e.metaKey;

/** Badge tokens: {ctrl:true, key:"enter"} → ["ctrl", "enter"]. The renderer
 *  maps "enter" to <EnterIcon/> - same idiom as FooterHints. */
export function shortcutParts(s: Shortcut): string[] {
  const parts: string[] = [];
  if (s.ctrl) parts.push("ctrl");
  if (s.alt) parts.push("alt");
  if (s.shift) parts.push("shift");
  parts.push(s.key);
  return parts;
}
