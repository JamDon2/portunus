import { useEffect, useState, type ReactNode } from "react";
import type { ClipboardEntry } from "../../types";
import { EnterIcon, CopyIcon, CheckIcon } from "../../icons";
import { LinkIcon, ClipboardGlyphIcon } from "./clipIcons";
import { getDecoded, peekDecoded, classifyFullText, textStats, type Decoded } from "./clipboardCache";
import { formatBytes } from "../../utils";
import hljs from "highlight.js/lib/core";
import langJson from "highlight.js/lib/languages/json";

hljs.registerLanguage("json", langJson);

const TEXT_RENDER_CAP = 100_000;
const JSON_MAX = 1_000_000;

type Anim = "none" | "fade" | "reveal";

interface Props {
  entry: ClipboardEntry;
  smartPaste: boolean;
  onPaste: () => void;
  onCopy: () => void;
  onOpenUrl: () => void;
}

// ── color parsing ─────────────────────────────────────────────────────────────

function toRgba(value: string): [number, number, number, number] | null {
  const s = value.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].every((n) => !isNaN(n))) return [r, g, b, a];
    }
    return null;
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(",").map((p) => p.trim());
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
      if ([r, g, b, a].every((n) => !isNaN(n))) return [Math.round(r), Math.round(g), Math.round(b), a];
    }
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function colorFormats(value: string): { label: string; value: string }[] {
  const rgba = toRgba(value);
  if (!rgba) return [{ label: "VALUE", value }];
  const [r, g, b, a] = rgba;
  const hex = "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  const [h, s, l] = rgbToHsl(r, g, b);
  return [
    { label: "HEX", value: a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex },
    { label: "RGB", value: a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})` },
    { label: "HSL", value: a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)` },
  ];
}

// ── per-format copy row ───────────────────────────────────────────────────────

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="clip-format-row">
      <span className="file-preview-meta-key">{label}</span>
      <span className="clip-format-val">{value}</span>
      <button className={`file-btn-icon clip-format-copy${copied ? " copied" : ""}`} onClick={copy} title={`Copy ${label}`} tabIndex={-1}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

// ── views ─────────────────────────────────────────────────────────────────────

function ImageView({ entry, decoded, showSkeleton, anim }: {
  entry: ClipboardEntry; decoded: Decoded | null; showSkeleton: boolean; anim: Anim;
}) {
  const dims = entry.dimensions ? `${entry.dimensions[0]} × ${entry.dimensions[1]}` : null;
  const meta = [dims, entry.format?.toUpperCase(), entry.byte_size != null ? formatBytes(entry.byte_size) : null]
    .filter(Boolean).join(" · ");
  // Cached swaps ("none") paint instantly with no animation - the headline
  // zero-blank behaviour when flicking between two images.
  const cls = anim === "reveal" ? "pdf-img-revealed" : anim === "fade" ? "clip-img-in" : undefined;
  return (
    <div className="clip-img-stage">
      {showSkeleton && <div className="pdf-skeleton" />}
      {decoded?.kind === "image" && (
        <img key={decoded.url} src={decoded.url} alt="clipboard" className={cls} draggable={false} />
      )}
      {meta && <span className="pdf-page-label">{meta}</span>}
    </div>
  );
}

function ColorView({ value }: { value: string }) {
  return (
    <div className="clip-color">
      <div className="clip-color-swatch">
        <div className="clip-color-fill" style={{ background: value }} />
        <span className="clip-color-orig">{value}</span>
      </div>
      <div className="clip-color-formats">
        {colorFormats(value).map((f) => <CopyRow key={f.label} {...f} />)}
      </div>
    </div>
  );
}

function UrlView({ url }: { url: string }) {
  let host = url;
  try { host = new URL(url).host; } catch { /* keep raw */ }
  return (
    <div className="clip-url">
      <div className="clip-url-tile"><LinkIcon /></div>
      <div className="clip-url-host">{host}</div>
      <div className="clip-url-full">{url}</div>
      <div className="clip-url-hint"><kbd>ctrl</kbd><kbd>O</kbd> open in browser</div>
    </div>
  );
}

function JsonView({ text }: { text: string }) {
  if (text.length > JSON_MAX) return <pre className="clipboard-text">{text.slice(0, TEXT_RENDER_CAP)}</pre>;
  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
  const html = hljs.highlight(pretty, { language: "json", ignoreIllegals: true }).value;
  return <pre className="clipboard-text hljs" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TextView({ text }: { text: string }) {
  const capped = text.length > TEXT_RENDER_CAP;
  return (
    <>
      <pre className="clipboard-text">{capped ? text.slice(0, TEXT_RENDER_CAP) : text}</pre>
      {capped && <div className="clip-text-more">… {(text.length - TEXT_RENDER_CAP).toLocaleString()} more characters</div>}
    </>
  );
}

// ── footer ──────────────────────────────────────────────────────────────────

function MetaFooter({ entry, decoded }: { entry: ClipboardEntry; decoded: Decoded | null }) {
  const cells: { key: string; val: string }[] = [];
  if (entry.kind === "image") {
    if (entry.dimensions) cells.push({ key: "Size", val: `${entry.dimensions[0]}×${entry.dimensions[1]}` });
    if (entry.byte_size != null) cells.push({ key: "Bytes", val: formatBytes(entry.byte_size) });
    if (entry.format) cells.push({ key: "Type", val: entry.format.toUpperCase() });
  } else if (decoded?.kind === "text") {
    const t = classifyFullText(decoded.text);
    const stats = textStats(decoded.text);
    cells.push({ key: "Type", val: t === "text" ? "Text" : t.toUpperCase() });
    if (t === "url") {
      try { cells.push({ key: "Host", val: new URL(decoded.text.trim()).host }); } catch { /* skip */ }
    } else {
      cells.push({ key: "Size", val: `${stats.chars.toLocaleString()} chars · ${stats.lines} lines` });
    }
  } else if (decoded?.kind === "binary") {
    cells.push({ key: "Type", val: "Binary" });
    cells.push({ key: "Bytes", val: formatBytes(decoded.bytes) });
  }
  if (!cells.length) return null;
  return (
    <div className="file-preview-meta">
      {cells.map((c) => (
        <div className="file-preview-meta-cell" key={c.key}>
          <span className="file-preview-meta-key">{c.key}</span>
          <span className="file-preview-meta-val">{c.val}</span>
        </div>
      ))}
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ClipboardEntryPreview({ entry, smartPaste, onPaste, onCopy, onOpenUrl }: Props) {
  const [decoded, setDecoded] = useState<Decoded | null>(() => peekDecoded(entry.id) ?? null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [anim, setAnim] = useState<Anim>("none");
  const [error, setError] = useState(false);

  useEffect(() => {
    const id = entry.id;
    const cached = peekDecoded(id);
    if (cached) { setDecoded(cached); setShowSkeleton(false); setAnim("none"); setError(false); return; }
    // Keep the previous content visible (no blank) while decoding the new entry.
    let cancelled = false;
    let skeletonShown = false;
    setError(false);
    const skeletonTimer = setTimeout(() => { if (!cancelled) { skeletonShown = true; setShowSkeleton(true); } }, 140);
    const decodeTimer = setTimeout(() => {
      getDecoded(id)
        .then(async (d) => {
          if (d.kind === "image") {
            try { const probe = new Image(); probe.src = d.url; await probe.decode(); } catch { /* onLoad covers */ }
          }
          if (cancelled) return;
          clearTimeout(skeletonTimer);
          setAnim(skeletonShown ? "reveal" : "fade");
          setShowSkeleton(false);
          setDecoded(d);
        })
        .catch(() => { if (!cancelled) { clearTimeout(skeletonTimer); setShowSkeleton(false); setError(true); } });
    }, 80);
    return () => { cancelled = true; clearTimeout(skeletonTimer); clearTimeout(decodeTimer); };
  }, [entry.id]);

  // Decide which view + label to show. Image entries use the backend kind; text
  // entries are reclassified from the authoritative decoded content.
  const isImage = entry.kind === "image";
  const fullType = !isImage && decoded?.kind === "text" ? classifyFullText(decoded.text) : null;
  const label =
    isImage ? "Image" :
    decoded?.kind === "binary" ? "Binary" :
    fullType === "url" ? "Link" :
    fullType === "color" ? "Color" :
    fullType === "json" ? "JSON" :
    "Text";

  let body: ReactNode;
  if (error && !decoded) {
    body = <div className="clipboard-preview-empty">Preview unavailable</div>;
  } else if (isImage) {
    body = <ImageView entry={entry} decoded={decoded} showSkeleton={showSkeleton} anim={anim} />;
  } else if (decoded?.kind === "binary") {
    body = <div className="clip-binary"><ClipboardGlyphIcon size={32} /><span>Binary data · {formatBytes(decoded.bytes)}</span></div>;
  } else if (decoded?.kind === "text") {
    const text = decoded.text;
    body =
      fullType === "color" ? <ColorView value={text.trim()} /> :
      fullType === "url" ? <UrlView url={text.trim()} /> :
      fullType === "json" ? <div className="clip-text-wrap"><JsonView text={text} /></div> :
      <div className="clip-text-wrap"><TextView text={text} /></div>;
  } else {
    body = <div className="clipboard-preview-empty">Loading…</div>;
  }

  return (
    <div className="clip-preview">
      <div className="clip-preview-head">
        <span className="clipboard-preview-label">{label}</span>
        <div className="clip-preview-actions">
          {fullType === "url" && (
            <button className="file-btn-icon" onClick={onOpenUrl} title="Open in browser (Ctrl+O)" tabIndex={-1}>
              <LinkIcon />
            </button>
          )}
          <button className="file-btn-icon" onClick={onCopy} title="Copy (Ctrl+Enter)" tabIndex={-1}>
            <CopyIcon />
          </button>
          <button className="btn-primary" onClick={onPaste} tabIndex={-1}>
            {smartPaste ? "Paste" : "Copy"} <span className="btn-kbd"><EnterIcon /></span>
          </button>
        </div>
      </div>
      {body}
      <MetaFooter entry={entry} decoded={decoded} />
    </div>
  );
}
