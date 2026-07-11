// Smart entity detection for the selection popover: the selected text is
// classified once on show and the popover grows a contextual action chip.

export type Entity =
  | { type: "url"; value: string }
  | { type: "email"; value: string }
  | { type: "math"; value: string }
  | { type: "word"; value: string };

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Conservative math shape: digits + operators only. The backend engine is the
// real judge (calc_eval returns null for anything fend can't parse).
const MATH_CHARS_RE = /^[\d\s+\-*/^%().,]+$/;
// Unit/currency conversion shape ("km to m", "eur to huf", "1.5 GiB to MB").
// A single unit token each side, optional leading quantity; the backend
// (calc_eval) is the real judge and prefixes "1 " when the quantity is absent.
const UNIT = String.raw`[\p{L}\d][\p{L}\d./^*%]*`;
const CONVERSION_RE = new RegExp(`^(?:\\d+(?:\\.\\d+)?\\s*)?${UNIT}\\s+(?:to|in)\\s+${UNIT}$`, "iu");
const WORD_RE = /^\p{L}[\p{L}'-]*$/u;

export function detectEntity(raw: string): Entity | null {
  const text = raw.trim();
  if (!text || text.length > 256) return null;
  if (URL_RE.test(text)) return { type: "url", value: text };
  if (EMAIL_RE.test(text)) return { type: "email", value: text };
  if (MATH_CHARS_RE.test(text) && /\d/.test(text) && /[+\-*/^%]/.test(text)) {
    return { type: "math", value: text };
  }
  if (CONVERSION_RE.test(text)) return { type: "math", value: text };
  if (WORD_RE.test(text) && text.length >= 2 && text.length <= 40) {
    return { type: "word", value: text };
  }
  return null;
}
