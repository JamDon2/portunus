import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchResult } from "../types";
import { formatBytes, formatDate, fileKind } from "../utils";

// ── pdf ───────────────────────────────────────────────────────────────────────

const pdfPromiseCache = new Map<string, Promise<string>>();
const pdfUrlCache = new Map<string, string>();

function getPdfUrl(path: string): Promise<string> {
  if (!pdfPromiseCache.has(path)) {
    pdfPromiseCache.set(
      path,
      invoke<number[]>("render_pdf_page", { path })
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
          pdfUrlCache.set(path, url);
          return url;
        })
        .catch((e) => {
          pdfPromiseCache.delete(path);
          throw e;
        }),
    );
  }
  return pdfPromiseCache.get(path)!;
}

function PdfPreview({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(() => pdfUrlCache.get(path) ?? null);
  const [loaded, setLoaded] = useState(() => pdfUrlCache.has(path));
  const [error, setError] = useState(false);

  useEffect(() => {
    const cached = pdfUrlCache.get(path);
    if (cached) {
      setSrc(cached);
      setLoaded(true);
      setError(false);
      return;
    }
    let cancelled = false;
    setSrc(null);
    setLoaded(false);
    setError(false);
    getPdfUrl(path)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch((e) => {
        console.error("[pdf] render_pdf_page failed:", e);
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [path]);

  const isLoading = !src && !error;

  return (
    <div className={`pdf-preview-wrap${isLoading ? " is-loading" : ""}`}>
      {isLoading && <div className="pdf-skeleton" />}
      {src && (
        <img
          src={src}
          alt="PDF preview"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
        />
      )}
      {error && <span className="pdf-preview-msg">Preview unavailable</span>}
    </div>
  );
}

// ── file / folder ─────────────────────────────────────────────────────────────

interface Props {
  result: SearchResult;
}

export default function FilePreview({ result }: Props) {
  const isFolder = result.kind === "folder";
  const kind = fileKind(result.title, isFolder);
  const tag = [kind, !isFolder && result.file_size != null ? formatBytes(result.file_size) : null]
    .filter(Boolean)
    .join(" · ");
  const filePath = result.subtitle ? `${result.subtitle}/${result.title}` : result.title;
  const isPdf = kind === "PDF Document";

  const icon = isFolder ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );

  return (
    <div className="file-preview">
      <div className="file-preview-head">
        <div className="file-preview-icon-wrap">{icon}</div>
        <div className="file-preview-head-text">
          <div className="file-preview-title">{result.title}</div>
          <div className="file-preview-tag">{tag}</div>
        </div>
      </div>

      {isPdf && <PdfPreview path={filePath} />}

      <div className="file-preview-meta">
        {result.modified && (
          <span><span className="file-preview-meta-key">Modified </span>{formatDate(result.modified)}</span>
        )}
        {result.created && (
          <span><span className="file-preview-meta-key">Created </span>{formatDate(result.created)}</span>
        )}
        {!isFolder && result.file_size != null && (
          <span><span className="file-preview-meta-key">Size </span>{formatBytes(result.file_size)}</span>
        )}
        <span><span className="file-preview-meta-key">Kind </span>{kind}</span>
      </div>
    </div>
  );
}
