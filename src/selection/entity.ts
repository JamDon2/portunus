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
const WORD_RE = /^\p{L}[\p{L}'-]*$/u;

export function detectEntity(raw: string): Entity | null {
  const text = raw.trim();
  if (!text || text.length > 256) return null;
  if (URL_RE.test(text)) return { type: "url", value: text };
  if (EMAIL_RE.test(text)) return { type: "email", value: text };
  if (MATH_CHARS_RE.test(text) && /\d/.test(text) && /[+\-*/^%]/.test(text)) {
    return { type: "math", value: text };
  }
  if (WORD_RE.test(text) && text.length >= 2 && text.length <= 40) {
    return { type: "word", value: text };
  }
  return null;
}
