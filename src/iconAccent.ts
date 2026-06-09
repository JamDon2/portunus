// Per-app accent colour: the dominant vibrant hue of an app's icon, sampled on a
// tiny offscreen canvas and used to "bleed" colour into the selection rail and
// the preview panel.

// ── canvas sampling ───────────────────────────────────────────────────────────

// Sampled results keyed by image src. A resolved value is `string | null`
// (null = sampled but no usable colour); an in-flight sample is a Promise.
const cache = new Map<string, string | null | Promise<string | null>>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}

/** Pull the dominant vibrant colour out of decoded image pixels, or null. */
function extractAccent(data: Uint8ClampedArray): string | null {
  // 24 hue buckets (15° each); each accumulates saturation-weighted lightness
  // and a vote count, so the winning bucket is both common and colourful.
  const N = 24;
  const weight = new Float64Array(N);
  const sumH = new Float64Array(N);
  const sumS = new Float64Array(N);
  const sumL = new Float64Array(N);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.18 || l < 0.12 || l > 0.92) continue; // skip grey / near-black / near-white
    const b = Math.min(N - 1, Math.floor(h / (360 / N)));
    const w = s * (1 - Math.abs(l - 0.5)); // favour saturated mid-tones
    weight[b] += w;
    sumH[b] += h * w;
    sumS[b] += s * w;
    sumL[b] += l * w;
  }
  let best = -1, bestW = 0;
  for (let b = 0; b < N; b++) {
    if (weight[b] > bestW) { bestW = weight[b]; best = b; }
  }
  if (best < 0 || bestW === 0) return null;
  const h = sumH[best] / bestW;
  const s = Math.max(0.55, Math.min(0.95, sumS[best] / bestW));
  const l = Math.max(0.52, Math.min(0.68, sumL[best] / bestW)); // normalise to a usable accent
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

function sample(src: string): Promise<string | null> {
  const p = new Promise<string | null>(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, 24, 24);
        // getImageData throws SecurityError if the canvas is tainted (cross-origin
        // asset that didn't grant CORS) — degrade to the kind palette instead.
        const { data } = ctx.getImageData(0, 0, 24, 24);
        resolve(extractAccent(data));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  cache.set(src, p);
  p.then(v => cache.set(src, v)); // collapse the promise to its resolved value
  return p;
}

/**
 * Resolve an icon src to an accent colour. Returns the cached value synchronously
 * when known; otherwise kicks off a sample and returns null until it resolves
 * (the caller re-renders via `onResolved`).
 */
export function iconAccent(src: string, onResolved: () => void): string | null {
  const hit = cache.get(src);
  if (typeof hit === "string" || hit === null) return hit;
  if (hit === undefined) sample(src).then(onResolved);
  return null;
}
