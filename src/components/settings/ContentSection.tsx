import { useState, KeyboardEvent } from "react";
import { Config, ContentDirEntry } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-wrap">
      <input type="checkbox" className="toggle-input" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  );
}

function ExtensionEditor({ extensions, onChange }: { extensions: string[]; onChange: (e: string[]) => void }) {
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
        placeholder="add ext…"
      />
    </div>
  );
}

export default function ContentSection({ config, onChange }: Props) {
  const cc = config.content;
  const set = (patch: Partial<Config["content"]>) =>
    onChange({ ...config, content: { ...config.content, ...patch } });

  const updateDir = (i: number, patch: Partial<ContentDirEntry>) => {
    const next = cc.dirs.map((d, idx) => idx === i ? { ...d, ...patch } : d);
    set({ dirs: next });
  };

  const removeDir = (i: number) => set({ dirs: cc.dirs.filter((_, idx) => idx !== i) });

  const addDir = () =>
    set({ dirs: [...cc.dirs, { path: "~/", depth: 3, extensions: null }] });

  const bytesToMb = (b: number) => +(b / (1024 * 1024)).toFixed(1);
  const mbToBytes = (mb: number) => Math.round(mb * 1024 * 1024);

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Content search</div>
        <div className="settings-section-desc">Full-text search inside files. Prefix your query with <code style={{ font: "400 11px/1 'JetBrains Mono',monospace", color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 3, padding: "1px 4px" }}>!</code> to activate.</div>
      </div>

      <div className="settings-section-note">
        Requires: <strong>poppler</strong> (pdftotext/pdftoppm) for PDF text extraction. OCR additionally requires <strong>tesseract</strong> + <strong>tesseract-data-eng</strong>. Re-index on demand: <code style={{ fontFamily: "monospace" }}>portunus --reindex</code>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Enable content search</div>
          <div className="settings-field-desc">Master switch for full-text indexing. The index is built in the background after startup.</div>
        </div>
        <div className="settings-field-control">
          <Toggle checked={cc.enabled} onChange={v => set({ enabled: v })} />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Max file size</div>
          <div className="settings-field-desc">Skip files larger than this limit to avoid long indexing times</div>
        </div>
        <div className="settings-field-control">
          <div className="settings-number-wrap">
            <button className="settings-number-btn" onClick={() => set({ max_file_bytes: mbToBytes(Math.max(0.5, bytesToMb(cc.max_file_bytes) - 1)) })}>−</button>
            <input
              type="number"
              className="settings-number-input"
              style={{ width: 64 }}
              value={bytesToMb(cc.max_file_bytes)}
              min={0.5} max={512} step={1}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) set({ max_file_bytes: mbToBytes(v) }); }}
            />
            <button className="settings-number-btn" onClick={() => set({ max_file_bytes: mbToBytes(Math.min(512, bytesToMb(cc.max_file_bytes) + 1) ) })}>+</button>
          </div>
          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--fg-mute)" }}>MB</span>
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">OCR images</div>
          <div className="settings-field-desc">Run OCR on image files (jpg, png, webp…) using Tesseract — requires tesseract installed</div>
        </div>
        <div className="settings-field-control">
          <Toggle checked={cc.ocr_images} onChange={v => set({ ocr_images: v })} />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">OCR PDF fallback</div>
          <div className="settings-field-desc">Run OCR on PDFs that contain no extractable text layer (scanned documents)</div>
        </div>
        <div className="settings-field-control">
          <Toggle checked={cc.ocr_pdf_fallback} onChange={v => set({ ocr_pdf_fallback: v })} />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">OCR language</div>
          <div className="settings-field-desc">Tesseract language code. Must have the corresponding tesseract-data-&lt;lang&gt; package installed. Multiple languages can be combined with <code style={{ fontFamily: "monospace" }}>+</code> (e.g. <code style={{ fontFamily: "monospace" }}>eng+hun</code>).</div>
        </div>
        <div className="settings-field-control">
          <input
            className="settings-text-input"
            value={cc.ocr_language}
            onChange={e => set({ ocr_language: e.target.value })}
            placeholder="eng"
            style={{ width: 80 }}
          />
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">
          <div className="settings-field-name">Indexer threads</div>
          <div className="settings-field-desc">Rayon worker threads for parallel indexing. Set to 0 to use all CPU cores.</div>
        </div>
        <div className="settings-field-control">
          <div className="settings-number-wrap">
            <button className="settings-number-btn" onClick={() => set({ threads: Math.max(0, cc.threads - 1) })}>−</button>
            <input
              type="number"
              className="settings-number-input"
              value={cc.threads}
              min={0} max={64} step={1}
              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) set({ threads: v }); }}
            />
            <button className="settings-number-btn" onClick={() => set({ threads: Math.min(64, cc.threads + 1) })}>+</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-mute)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
          Indexed file types
        </div>
        <div className="settings-field-desc" style={{ marginBottom: 8 }}>
          Press Enter or comma to add an extension. Backspace removes the last one.
        </div>
        <ExtensionEditor
          extensions={cc.extensions}
          onChange={extensions => set({ extensions })}
        />
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-mute)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          Indexed directories
        </div>
        <div className="settings-field-desc" style={{ marginBottom: 10 }}>
          Depth controls recursion. Per-directory extensions override the global list above when set.
        </div>
        <div className="settings-dir-list">
          {cc.dirs.map((dir, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid var(--line-soft)" }}>
              <div className="settings-dir-row">
                <input
                  className="settings-dir-path"
                  value={dir.path}
                  placeholder="~/path/to/dir"
                  onChange={e => updateDir(i, { path: e.target.value })}
                />
                <div className="settings-dir-depth">
                  <button className="settings-dir-depth-btn" onClick={() => updateDir(i, { depth: Math.max(1, dir.depth - 1) })}>−</button>
                  <span className="settings-dir-depth-val" title="Search depth">{dir.depth}</span>
                  <button className="settings-dir-depth-btn" onClick={() => updateDir(i, { depth: Math.min(10, dir.depth + 1) })}>+</button>
                </div>
                <button className="settings-dir-remove" onClick={() => removeDir(i)} title="Remove">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--fg-dim)", whiteSpace: "nowrap" }}>Override extensions:</span>
                <ExtensionEditor
                  extensions={dir.extensions ?? []}
                  onChange={exts => updateDir(i, { extensions: exts.length > 0 ? exts : null })}
                />
              </div>
            </div>
          ))}
          <button className="settings-dir-add" onClick={addDir}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add directory
          </button>
        </div>
      </div>
    </div>
  );
}
