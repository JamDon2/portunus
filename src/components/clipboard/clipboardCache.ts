import { invoke } from "@tauri-apps/api/core";

/**
 * Session cache for decoded clipboard entries. cliphist entries are immutable per
 * id, so a decode is cached for the life of the session. Image blob URLs are
 * LRU-capped + revoked (detached bitmaps leak otherwise); text is capped without
 * revocation. This is what makes rapid switching between two image entries a pure
 * src swap with no blank frame - see ClipboardEntryPreview.
 */

export type Decoded =
  | { kind: "image"; url: string; mime: string }
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: number };

const decodedCache = new Map<string, Decoded>();
const promiseCache = new Map<string, Promise<Decoded>>();

const IMG_CACHE_CAP = 32;
const TEXT_CACHE_CAP = 64;

function evict() {
  // Count by kind and drop the oldest of whichever kind is over budget. Map
  // preserves insertion order, so the first matching key is the oldest.
  let imgs = 0;
  let texts = 0;
  for (const v of decodedCache.values()) {
    if (v.kind === "image") imgs++;
    else if (v.kind === "text") texts++;
  }
  if (imgs > IMG_CACHE_CAP) {
    for (const [k, v] of decodedCache) {
      if (v.kind === "image") {
        URL.revokeObjectURL(v.url);
        decodedCache.delete(k);
        promiseCache.delete(k);
        break;
      }
    }
  }
  if (texts > TEXT_CACHE_CAP) {
    for (const [k, v] of decodedCache) {
      if (v.kind === "text") {
        decodedCache.delete(k);
        promiseCache.delete(k);
        break;
      }
    }
  }
}

/** Sniff the leading bytes for a supported raster image format. */
function imageMime(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  return null;
}

/** Synchronous cache peek - lets the preview seed state with zero render delay. */
export function peekDecoded(id: string): Decoded | undefined {
  return decodedCache.get(id);
}

export function getDecoded(id: string): Promise<Decoded> {
  const hit = decodedCache.get(id);
  if (hit) return Promise.resolve(hit);
  const inflight = promiseCache.get(id);
  if (inflight) return inflight;

  const p = invoke<ArrayBuffer>("decode_clipboard_entry", { id })
    .then((buf) => {
      const bytes = new Uint8Array(buf);
      const mime = imageMime(bytes);
      let decoded: Decoded;
      if (mime) {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        decoded = { kind: "image", url, mime };
      } else {
        // A NUL byte early on means non-text binary we can't sniff; show a card.
        const head = bytes.subarray(0, 64);
        const isBinary = head.includes(0);
        decoded = isBinary
          ? { kind: "binary", bytes: bytes.length }
          : { kind: "text", text: new TextDecoder().decode(bytes) };
      }
      decodedCache.set(id, decoded);
      evict();
      return decoded;
    })
    .catch((e) => {
      promiseCache.delete(id);
      throw e;
    });
  promiseCache.set(id, p);
  return p;
}

/** Drop an entry from the cache (e.g. after it's deleted from cliphist). */
export function evictDecoded(id: string) {
  const v = decodedCache.get(id);
  if (v?.kind === "image") URL.revokeObjectURL(v.url);
  decodedCache.delete(id);
  promiseCache.delete(id);
}

// ── full-content classification (authoritative, runs on decoded text) ─────────

export type FullType = "text" | "url" | "color" | "json";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)$/i;

export function classifyFullText(text: string): FullType {
  const s = text.trim();
  if (HEX_RE.test(s) || RGB_RE.test(s)) return "color";
  if ((s.startsWith("http://") || s.startsWith("https://")) && !/\s/.test(s)) return "url";
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      JSON.parse(s);
      return "json";
    } catch {
      /* not valid json */
    }
  }
  return "text";
}

export interface TextStats {
  chars: number;
  words: number;
  lines: number;
}

export function textStats(text: string): TextStats {
  const chars = text.length;
  const lines = text === "" ? 0 : text.split("\n").length;
  const words = (text.match(/\S+/g) ?? []).length;
  return { chars, words, lines };
}
