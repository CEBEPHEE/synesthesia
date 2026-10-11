/**
 * Scene-cut detection for videos. Pure: works on small RGBA frames, unit-tested.
 *
 * Every sampled frame gets a "signature": a coarse colour histogram (hue × brightness)
 * plus overall brightness. A cut is where two consecutive signatures differ a lot
 * — a new shot changes its colours far more than motion inside one shot does.
 */

const HUE_BINS = 8, VAL_BINS = 3;

/** @param {Uint8ClampedArray} rgba @returns {Float32Array} normalised histogram + mean brightness */
export function frameSignature(rgba) {
  const bins = new Float32Array(HUE_BINS * VAL_BINS + VAL_BINS + 1);
  const n = rgba.length / 4;
  let lum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const v = Math.min(VAL_BINS - 1, Math.floor(max * VAL_BINS));
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (d < 0.12) { bins[HUE_BINS * VAL_BINS + v] += 1; continue; }   // greys: brightness only
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    if (h < 0) h += 6;
    bins[Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS)) * VAL_BINS + v] += 1;
  }
  for (let i = 0; i < bins.length - 1; i++) bins[i] /= n;
  bins[bins.length - 1] = lum / n;
  return bins;
}

/** 0 (identical) … ~2 (completely different). */
export function signatureDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length - 1; i++) d += Math.abs(a[i] - b[i]);
  return d + 2 * Math.abs(a[a.length - 1] - b[b.length - 1]);
}

/**
 * @param {Float32Array[]} signatures  one per sampled time
 * @param {number[]} times             seconds of each signature
 * @param {{threshold?, minScene?, maxScenes?, duration}} options
 * @returns {Array<{start, end}>} scenes covering 0…duration
 */
export function detectScenes(signatures, times, { threshold = 0.55, minScene = 2, maxScenes = 24, duration } = {}) {
  const end = duration ?? times[times.length - 1] ?? 0;
  const candidates = [];
  for (let i = 1; i < signatures.length; i++) {
    const d = signatureDistance(signatures[i - 1], signatures[i]);
    if (d >= threshold) candidates.push({ t: times[i], d });
  }
  // strongest cuts first, keep those at least minScene away from others and from the ends
  candidates.sort((a, b) => b.d - a.d);
  const cuts = [];
  for (const c of candidates) {
    if (cuts.length >= maxScenes - 1) break;
    if (c.t < minScene || end - c.t < minScene) continue;
    if (cuts.every((t) => Math.abs(t - c.t) >= minScene)) cuts.push(c.t);
  }
  cuts.sort((a, b) => a - b);
  const bounds = [0, ...cuts, end];
  return bounds.slice(1).map((e, i) => ({ start: bounds[i], end: e }));
}

/**
 * Where to place the picture inside the output frame.
 * fit 'cover' fills the frame (cropping), 'contain' shows everything (letterbox).
 * zoom > 1 enlarges around the centre (slow "Ken Burns" push-in for slideshows).
 */
export function fitRect(srcW, srcH, dstW, dstH, fit = 'cover', zoom = 1) {
  const s = (fit === 'cover' ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH)) * zoom;
  const w = srcW * s, h = srcH * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/**
 * Output size for a chosen aspect; `short` is the short side (720 → 1280×720 or 720×1280).
 * Always even (H.264 requires it); the long side never exceeds 2.2× the short one.
 */
export function outputSize(aspect, short, srcW = 16, srcH = 9) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  let r = aspect === '9:16' ? 9 / 16 : aspect === '1:1' ? 1 : aspect === 'original' ? srcW / srcH : 16 / 9;
  r = Math.min(2.2, Math.max(1 / 2.2, r));
  return r >= 1 ? { width: even(short * r), height: even(short) } : { width: even(short), height: even(short / r) };
}
