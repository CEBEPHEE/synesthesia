/**
 * Dominant colours: k-means++ in RGB with a deterministic random generator
 * (so tests are reproducible). Pure module — runs in the Web Worker and in Node.
 */

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sq = (P, i, C, c) => {
  const dr = P[i * 3] - C[c * 3], dg = P[i * 3 + 1] - C[c * 3 + 1], db = P[i * 3 + 2] - C[c * 3 + 2];
  return dr * dr + dg * dg + db * db;
};

/**
 * @param {Uint8ClampedArray} rgba  RGBA pixels (like ImageData.data)
 * @returns {Array<{r,g,b,h,s,v,weight}>} clusters, largest share first
 */
export function kMeans(rgba, { k = 5, maxIterations = 15, seed = 1337, alphaThreshold = 128 } = {}) {
  const total = rgba.length / 4;
  const P = new Float32Array(total * 3);
  let m = 0;
  for (let i = 0; i < total; i++) {
    if (rgba[i * 4 + 3] < alphaThreshold) continue;   // ignore transparent pixels
    P[m * 3] = rgba[i * 4]; P[m * 3 + 1] = rgba[i * 4 + 1]; P[m * 3 + 2] = rgba[i * 4 + 2];
    m++;
  }
  if (m === 0) return [];

  const rand = mulberry32(seed);
  let kk = Math.min(k, m);
  const C = new Float32Array(kk * 3);

  // k-means++: first centre at random, the rest proportional to D(x)²
  const first = Math.floor(rand() * m);
  C.set(P.subarray(first * 3, first * 3 + 3), 0);
  const dist = new Float32Array(m).fill(Infinity);
  for (let c = 1; c < kk; c++) {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const d = sq(P, i, C, c - 1);
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    if (sum === 0) { kk = c; break; }                // fewer distinct colours than k
    let r = rand() * sum, chosen = m - 1;
    for (let i = 0; i < m; i++) { r -= dist[i]; if (r <= 0) { chosen = i; break; } }
    C.set(P.subarray(chosen * 3, chosen * 3 + 3), c * 3);
  }

  const assign = new Int32Array(m).fill(-1);
  const counts = new Float64Array(kk);
  const sums = new Float64Array(kk * 3);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = 0;
    counts.fill(0); sums.fill(0);
    for (let i = 0; i < m; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < kk; c++) { const d = sq(P, i, C, c); if (d < bestD) { bestD = d; best = c; } }
      if (assign[i] !== best) { assign[i] = best; changed++; }
      counts[best]++;
      sums[best * 3] += P[i * 3]; sums[best * 3 + 1] += P[i * 3 + 1]; sums[best * 3 + 2] += P[i * 3 + 2];
    }
    for (let c = 0; c < kk; c++) {
      if (!counts[c]) continue;
      C[c * 3] = sums[c * 3] / counts[c]; C[c * 3 + 1] = sums[c * 3 + 1] / counts[c]; C[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
    }
    if (changed === 0) break;
  }

  const out = [];
  for (let c = 0; c < kk; c++) {
    if (!counts[c]) continue;
    const r = Math.round(C[c * 3]), g = Math.round(C[c * 3 + 1]), b = Math.round(C[c * 3 + 2]);
    out.push({ r, g, b, ...rgbToHsv(r, g, b), weight: counts[c] / m });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
