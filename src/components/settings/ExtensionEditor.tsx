import { useState, KeyboardEvent } from "react";

interface Props {
  extensions: string[];
  onChange: (e: string[]) => void;
  placeholder?: string;
}

/**
 * Tag-input for file extensions: type + Enter/comma/space to add, Backspace on
 * an empty input removes the last. Extracted from ContentSection so the global
 * list and each per-directory override share one implementation.
 */
export default function ExtensionEditor({ extensions, onChange, placeholder = "add ext…" }: Props) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const val = draft.trim().replace(/^\./, "");
    if (val && !extensions.includes(val)) onChange([...extensions, val]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); commit(); }
    if (e.key === "Backspace" && draft === "" && extensions.length > 0) {
      onChange(extensions.slice(0, -1));
    }
  };

  return (
    <div className="settings-ext-editor">
      {extensions.map(ext => (
        <span className="settings-ext-tag" key={ext}>
          {ext}
          <button className="settings-ext-remove" onClick={() => onChange(extensions.filter(e => e !== ext))} title="Remove">×</button>
        </span>
      ))}
      <input
        className="settings-ext-input"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={placeholder}
      />
    </div>
  );
}
