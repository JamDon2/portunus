import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionDescriptor } from "../actions/types";
import { matchesShortcut, shortcutParts } from "../actions/shortcut";
import { EnterIcon } from "../icons";

interface Props {
  actions: ActionDescriptor[];
  onRun: (a: ActionDescriptor) => void;
  onClose: () => void;
}

/** One kbd badge sequence for a descriptor's shortcut. */
function ShortcutBadge({ parts }: { parts: string[] }) {
  return (
    <span className="action-panel-keys">
      {parts.map((p, i) => (
        <kbd key={i}>{p === "enter" ? <EnterIcon /> : p}</kbd>
      ))}
    </span>
  );
}

/**
 * Footer-anchored action panel (Alt+Enter / Ctrl+K). Modal like Quicklook: it
 * owns the keyboard while open (capture-phase listener so the launcher's own
 * handler never sees the keys). Rows are the selected result's actions; typing
 * filters them, ↑↓ + Enter or a bare digit runs a row, and a row's own chord
 * (e.g. Ctrl+C) runs it directly.
 */
export default function ActionPanel({ actions, onRun, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return actions;
    return actions.filter(a => a.title.toLowerCase().includes(f) || a.hint?.toLowerCase().includes(f));
  }, [actions, filter]);

  useEffect(() => setIndex(0), [filter]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Capture phase + stopImmediatePropagation: the launcher's window-level
      // handler (navigation, launch, Esc-hides-window) must stay inert.
      e.stopImmediatePropagation();
      if (
        e.key === "Escape" ||
        (e.altKey && e.key === "Enter") ||
        (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "k" || e.key === "K"))
      ) {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex(i => (visible.length ? (i + 1) % visible.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex(i => (visible.length ? (i - 1 + visible.length) % visible.length : 0));
      } else if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        const action = visible[index];
        if (action) onRun(action);
      } else if (e.key === "Tab") {
        // Keep focus trapped in the filter input.
        e.preventDefault();
      } else if (!filter && e.key >= "1" && e.key <= "9" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Bare digits are shortcuts only while the filter is empty; once the
        // user starts filtering, digits type into the filter like any char.
        const action = visible[parseInt(e.key) - 1];
        if (action) {
          e.preventDefault();
          onRun(action);
        }
      } else if (e.ctrlKey || e.altKey || e.shiftKey) {
        // A row's own chord pressed inside the panel runs that row (Raycast
        // behavior). Only chorded shortcuts qualify - bare-key ones (Enter,
        // Tab) already mean something to the panel itself.
        for (const a of visible) {
          if (a.shortcut && (a.shortcut.ctrl || a.shortcut.alt || a.shortcut.shift)
              && matchesShortcut(e, a.shortcut)) {
            e.preventDefault();
            onRun(a);
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, index, filter, onRun, onClose]);

  return (
    <div className="action-panel">
      <div className="action-panel-list">
        {visible.length === 0 && <div className="action-panel-empty">No matching actions</div>}
        {visible.map((a, i) => (
          <div
            key={a.id}
            ref={i === index ? selectedRef : undefined}
            className={`action-panel-row${i === index ? " selected" : ""}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => onRun(a)}
          >
            <span className="action-panel-title">{a.title}</span>
            {a.hint && <span className="action-panel-hint">{a.hint}</span>}
            {a.shortcut ? (
              <ShortcutBadge parts={shortcutParts(a.shortcut)} />
            ) : (
              !filter && i < 9 && <span className="action-panel-keys"><kbd>{i + 1}</kbd></span>
            )}
          </div>
        ))}
      </div>
      <div className="action-panel-input">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search actions…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
