// Invisible positioned text layers - the bridge that makes bitmap previews
// (PDF pages, images) selectable by the virtual selection engine: backend
// geometry (normalized word rects) becomes transparent DOM text laid over the
// bitmap, and the one selection engine handles it like any code/markdown
// preview. Same technique as pdf.js's text layer, one word per span.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NormRect, OcrWord, PdfTextLayerData, PdfTextLine } from "../types";

// ── shared geometry layer ─────────────────────────────────────────────────────

interface LayerLine {
  rect: NormRect;
  words: { text: string; rect: NormRect }[];
}

/** Lines of transparent, absolutely-positioned word spans. The layer itself is
 *  hit-transparent; only line boxes take the I-beam (drags on page whitespace
 *  keep panning). Word spans are scaleX-fitted to their boxes after layout so
 *  caret hit-testing lands on roughly the right glyph. */
function GeometryTextLayer({
  lines,
  className,
  scale,
}: {
  lines: LayerLine[];
  className: string;
  scale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // offset* ignore the ancestor zoom transform (PDF Quicklook), so font
      // sizing and fit stay in untransformed layout px.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit pass: stretch each word's glyphs to its PDF/OCR box so hit-testing
  // and the rendered highlight agree with the bitmap underneath.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || size.w === 0) return;
    for (const span of el.querySelectorAll<HTMLElement>(".geo-word")) {
      const target = parseFloat(span.dataset.w ?? "0") * size.w;
      span.style.transform = "";
      const natural = span.offsetWidth;
      if (natural > 0 && target > 0) span.style.transform = `scaleX(${target / natural})`;
    }
  }, [lines, size]);

  return (
    <div
      ref={ref}
      className={className}
      data-selectable
      data-sel-blend="multiply"
      data-sel-scale={scale}
    >
      {size.h > 0 &&
        lines.map((line, li) => {
          const [lx, ly, lw, lh] = line.rect;
          if (lw <= 0 || lh <= 0) return null;
          const fontPx = Math.max(4, lh * size.h * 0.8);
          return (
            <div
              key={li}
              className="geo-line"
              style={{
                left: `${lx * 100}%`,
                top: `${ly * 100}%`,
                width: `${lw * 100}%`,
                height: `${lh * 100}%`,
                fontSize: fontPx,
                lineHeight: `${lh * size.h}px`,
              }}
            >
              {line.words.map((w, wi) => (
                <span
                  key={wi}
                  className="geo-word"
                  data-sel-inline=""
                  data-w={w.rect[2]}
                  style={{ left: `${((w.rect[0] - lx) / lw) * 100}%` }}
                >
                  {w.text}{" "}
                </span>
              ))}
            </div>
          );
        })}
    </div>
  );
}

// ── PDF text layer ────────────────────────────────────────────────────────────

const pdfLayerPromises = new Map<string, Promise<PdfTextLayerData>>();
const pdfLayerCache = new Map<string, PdfTextLayerData>();
const LAYER_CACHE_CAP = 32;

function storeLayer<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  while (cache.size > LAYER_CACHE_CAP) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function getPdfTextLayer(path: string, page: number): Promise<PdfTextLayerData> {
  const key = `${path}#${page}`;
  if (!pdfLayerPromises.has(key)) {
    pdfLayerPromises.set(
      key,
      invoke<PdfTextLayerData>("pdf_text_layer", { path, page })
        .then(layer => {
          storeLayer(pdfLayerCache, key, layer);
          return layer;
        })
        .catch(e => {
          pdfLayerPromises.delete(key);
          throw e;
        }),
    );
  }
  return pdfLayerPromises.get(key)!;
}

/** Selectable text layer over a rendered PDF page. Mount inside the
 *  `.pdf-hl-host` span; pass the Quicklook zoom so selection geometry can
 *  un-scale itself. Scanned pages (no text layer) render nothing. */
export function PdfTextLayer({ path, page, scale }: { path: string; page: number; scale?: number }) {
  const key = `${path}#${page}`;
  const [data, setData] = useState<PdfTextLayerData | null>(() => pdfLayerCache.get(key) ?? null);

  useEffect(() => {
    const cached = pdfLayerCache.get(key);
    if (cached) { setData(cached); return; }
    let cancelled = false;
    setData(null);
    getPdfTextLayer(path, page)
      .then(layer => { if (!cancelled) setData(layer); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [key, path, page]);

  if (!data || data.lines.length === 0) return null;
  return <GeometryTextLayer lines={data.lines as PdfTextLine[]} className="pdf-text-layer" scale={scale} />;
}

// ── OCR (Live Text) layer ─────────────────────────────────────────────────────

const ocrLayerPromises = new Map<string, Promise<OcrWord[]>>();
const ocrLayerCache = new Map<string, OcrWord[]>();

function getOcrWords(key: string, fetcher: () => Promise<OcrWord[]>): Promise<OcrWord[]> {
  if (!ocrLayerPromises.has(key)) {
    ocrLayerPromises.set(
      key,
      fetcher()
        .then(words => {
          storeLayer(ocrLayerCache, key, words);
          return words;
        })
        .catch(e => {
          ocrLayerPromises.delete(key);
          throw e;
        }),
    );
  }
  return ocrLayerPromises.get(key)!;
}

/** Flat OCR words → lines, by the backend's line ordinal. */
function groupOcrLines(words: OcrWord[]): LayerLine[] {
  const byLine = new Map<number, OcrWord[]>();
  for (const w of words) {
    const list = byLine.get(w.line);
    if (list) list.push(w);
    else byLine.set(w.line, [w]);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ws]) => {
      ws.sort((a, b) => a.rect[0] - b.rect[0]);
      let x1 = Infinity, y1 = Infinity, x2 = 0, y2 = 0;
      for (const w of ws) {
        x1 = Math.min(x1, w.rect[0]);
        y1 = Math.min(y1, w.rect[1]);
        x2 = Math.max(x2, w.rect[0] + w.rect[2]);
        y2 = Math.max(y2, w.rect[1] + w.rect[3]);
      }
      return { rect: [x1, y1, x2 - x1, y2 - y1] as NormRect, words: ws };
    });
}

/** Live Text layer over an image preview: OCR'd words become selectable text.
 *  `path` fetches `image_text_layer`; `clipboardId` fetches the clipboard
 *  variant. Silently absent while OCR runs or when Tesseract finds nothing. */
export function OcrTextLayer({ path, clipboardId }: { path?: string; clipboardId?: string }) {
  const key = path ? `f:${path}` : `c:${clipboardId}`;
  const [words, setWords] = useState<OcrWord[] | null>(() => ocrLayerCache.get(key) ?? null);

  useEffect(() => {
    const cached = ocrLayerCache.get(key);
    if (cached) { setWords(cached); return; }
    let cancelled = false;
    setWords(null);
    // Debounced like the OCR highlight fetch: arrow-keying through images must
    // not queue an OCR per selection (the backend coalesces too).
    const timer = setTimeout(() => {
      const fetcher = path
        ? () => invoke<OcrWord[]>("image_text_layer", { path })
        : () => invoke<OcrWord[]>("clipboard_image_text_layer", { id: clipboardId });
      getOcrWords(key, fetcher)
        .then(w => { if (!cancelled) setWords(w); })
        .catch(() => {});
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, path, clipboardId]);

  if (!words || words.length === 0) return null;
  return <GeometryTextLayer lines={groupOcrLines(words)} className="ocr-text-layer" />;
}
