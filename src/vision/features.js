/**
 * Photo "fingerprint": eight perceptual features, each normalised to 0..1.
 * They drive automatic style selection and are shown to the user in the
 * "Why it sounds like this" panel, so every value must be explainable.
 *
 * Normalisation constants were calibrated on a set of ordinary photos so that
 * typical images spread across the 0..1 range instead of bunching up.
 * Pure module: runs in the Web Worker and in Node tests.
 */

export const FEATURES = Object.freeze([
  { id: 'brightness',   label: 'Brightness',   low: 'dark',         mid: 'evenly lit',           high: 'bright' },
  { id: 'contrast',     label: 'Contrast',     low: 'soft and flat', mid: 'moderately contrasted', high: 'punchy' },
  { id: 'saturation',   label: 'Saturation',   low: 'muted',        mid: 'moderately saturated', high: 'vivid' },
  { id: 'colorfulness', label: 'Colorfulness', low: 'monochrome',   mid: 'moderately colourful', high: 'multicolored' },
  { id: 'warmth',       label: 'Warmth',       low: 'cool, blue',   mid: 'neutral in tone',      high: 'warm, orange' },
  { id: 'sharpness',    label: 'Sharpness',    low: 'blurry, hazy', mid: 'moderately sharp',     high: 'crisp' },
  { id: 'grain',        label: 'Texture',      low: 'smooth',       mid: 'lightly textured',     high: 'grainy, gritty' },
  { id: 'complexity',   label: 'Complexity',   low: 'minimal',      mid: 'moderately busy',      high: 'busy' },
]);

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Circular spread of the chromatic palette hues (0 = one hue, 1 = all around the wheel). */
export function hueSpread(palette, minSaturation = 0.15) {
  const chroma = palette.filter((c) => c.s >= minSaturation);
  const w = chroma.reduce((s, c) => s + c.weight, 0);
  if (chroma.length < 2 || w === 0) return 0;
  let x = 0, y = 0;
  for (const c of chroma) {
    const a = (c.h * Math.PI) / 180;
    x += Math.cos(a) * c.weight; y += Math.sin(a) * c.weight;
  }
  return clamp01(1 - Math.hypot(x, y) / w);
}

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img  RGBA pixels
 * @param {Array} palette   output of kMeans
 * @returns {{brightness, contrast, saturation, colorfulness, warmth, sharpness, grain, complexity, raw}}
 *   complexity = how many different hues (palette spread) + how many edges.
 */
export function computeFeatures({ data, width, height }, palette = []) {
  const n = width * height;
  if (!n) throw new Error('empty image');
  const luma = new Float32Array(n);
  let sumL = 0, sumL2 = 0, sumS = 0, sumR = 0, sumB = 0;
  let sumRG = 0, sumRG2 = 0, sumYB = 0, sumYB2 = 0;

  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = l; sumL += l; sumL2 += l * l;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sumS += max ? (max - min) / max : 0;
    sumR += r; sumB += b;
    const rg = r - g, yb = 0.5 * (r + g) - b;            // Hasler & Süsstrunk opponent axes
    sumRG += rg; sumRG2 += rg * rg; sumYB += yb; sumYB2 += yb * yb;
  }

  const meanL = sumL / n;
  const stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
  const meanRG = sumRG / n, meanYB = sumYB / n;
  const stdRG = Math.sqrt(Math.max(0, sumRG2 / n - meanRG ** 2));
  const stdYB = Math.sqrt(Math.max(0, sumYB2 / n - meanYB ** 2));
  const hasler = Math.hypot(stdRG, stdYB) + 0.3 * Math.hypot(meanRG, meanYB);

  // Edges (Sobel) and fine texture (deviation from the 3×3 local mean)
  let strongEdges = 0, texture = 0, inner = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = luma[i - width - 1], t = luma[i - width], tr = luma[i - width + 1];
      const l = luma[i - 1], c = luma[i], r = luma[i + 1];
      const bl = luma[i + width - 1], bt = luma[i + width], br = luma[i + width + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * bt + br) - (tl + 2 * t + tr);
      if (Math.hypot(gx, gy) > 120) strongEdges++;
      texture += Math.abs(c - (tl + t + tr + l + c + r + bl + bt + br) / 9);
      inner++;
    }
  }
  const edgeDensity = inner ? strongEdges / inner : 0;
  const meanTexture = inner ? texture / inner : 0;
  const spread = hueSpread(palette);

  const raw = {
    meanLuma: meanL, stdLuma: stdL, meanSaturation: sumS / n, hasler,
    redMinusBlue: (sumR - sumB) / n, edgeDensity, meanTexture,
    hueSpread: spread,
  };

  return {
    brightness:   clamp01((meanL - 15) / 165),
    contrast:     clamp01((stdL - 15) / 65),
    saturation:   clamp01(raw.meanSaturation / 0.75),
    colorfulness: clamp01(hasler / 110),
    warmth:       clamp01(0.5 + raw.redMinusBlue / 150),
    sharpness:    clamp01(edgeDensity / 0.35),
    grain:        clamp01((meanTexture - 0.5) / 8),
    complexity:   clamp01(0.55 * Math.min(1, spread / 0.5) + 0.45 * Math.min(1, edgeDensity / 0.4)),
    raw,
  };
}
