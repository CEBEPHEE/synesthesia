/**
 * Motion for the live camera: where in the picture something moves, and how much.
 * Pure (works on small greyscale frames), unit-tested.
 *
 * The frame is split into a grid; a cell "moves" when its pixels changed a lot
 * since the previous frame. The strongest moving cells become points (with the
 * centre of the movement inside the cell), so a waving hand plays the melody.
 */

/** RGBA → luminance (0–255). */
export function toLuma(rgba) {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (rgba[i * 4] * 54 + rgba[i * 4 + 1] * 183 + rgba[i * 4 + 2] * 19) >> 8;
  return out;
}

/**
 * @param {Uint8Array} prev  luminance of the previous frame
 * @param {Uint8Array} cur   luminance of this frame (same size)
 * @param {number} w @param {number} h
 * @param {{cols?, rows?, threshold?, maxPoints?, minDistance?}} options
 * @returns {{energy: number, points: Array<{x, y, score}>}} energy 0…1 (share of the picture that moves)
 */
export function detectMotion(prev, cur, w, h, { cols = 8, rows = 6, threshold = 22, maxPoints = 6, minDistance = 0.18 } = {}) {
  const cells = Array.from({ length: cols * rows }, () => ({ n: 0, moved: 0, sx: 0, sy: 0 }));
  let moving = 0;
  for (let y = 0; y < h; y++) {
    const cy = Math.min(rows - 1, Math.floor((y / h) * rows));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = cells[cy * cols + Math.min(cols - 1, Math.floor((x / w) * cols))];
      c.n++;
      if (Math.abs(cur[i] - prev[i]) > threshold) { c.moved++; c.sx += x; c.sy += y; moving++; }
    }
  }
  const energy = moving / (w * h);
  const active = cells
    .map((c) => ({ share: c.n ? c.moved / c.n : 0, x: c.moved ? (c.sx / c.moved + 0.5) / w : 0, y: c.moved ? (c.sy / c.moved + 0.5) / h : 0 }))
    .filter((c) => c.share > 0.12)
    .sort((a, b) => b.share - a.share);
  const points = [];
  for (const c of active) {
    if (points.length >= maxPoints) break;
    if (points.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= minDistance)) points.push({ x: c.x, y: c.y, score: Math.min(1, c.share * 1.5) });
  }
  return { energy, points };
}
