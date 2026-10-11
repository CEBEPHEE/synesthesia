/**
 * Lightweight "points of interest" detector, no neural network.
 * The frame is split into a grid; for every cell we measure
 *   • gradient energy (Sobel on luminance) — edges, texture, objects;
 *   • colour distinctiveness — how far the cell's mean colour is from the frame's;
 *   score = √(energy · (0.35 + 0.65 · distinctiveness)).
 * The point sits at the cell's gradient centre of mass; non-maximum
 * suppression then keeps at most maxPoints well-separated points.
 *
 * The output format matches what MediaPipe ObjectDetector would give
 * (box centres in normalised coordinates), so the detector can be swapped
 * without touching the mapping.
 */

/** Below this many points the detector takes a closer look (finer grid, closer points allowed). */
export const MIN_POINTS = 4;

/**
 * Finds the points of interest. If a coarse pass finds fewer than MIN_POINTS
 * (typically several small objects close together, which a coarse grid merges
 * into one), a finer pass allows points closer to each other.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @returns {Array<{x:number, y:number, score:number, color:{r,g,b}}>} x,y ∈ [0,1]
 */
export function detectKeypoints(img, options = {}) {
  const { maxPoints = 7 } = options;
  const coarse = detectOnGrid(img, options);
  if (coarse.length >= Math.min(MIN_POINTS, maxPoints) || options.grid) return coarse;
  const fine = detectOnGrid(img, { ...options, grid: 20, minDistance: 0.07, minScore: 0.25 });
  return fine.length > coarse.length ? fine : coarse;
}

function detectOnGrid({ data, width, height }, {
  grid = 10, maxPoints = 7, minDistance = 0.16, minScore = 0.2,
} = {}) {
  const n = width * height;
  if (n === 0) return [];
  const luma = new Float32Array(n);
  let gr = 0, gg = 0, gb = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    gr += r; gg += g; gb += b;
  }
  gr /= n; gg /= n; gb /= n;

  const cellsX = grid;
  const cellsY = Math.max(1, Math.round((grid * height) / width));
  const cw = width / cellsX, ch = height / cellsY;
  const cells = Array.from({ length: cellsX * cellsY }, () => ({ e: 0, wx: 0, wy: 0, r: 0, g: 0, b: 0, count: 0 }));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let mag = 0;
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        const tl = luma[i - width - 1], t = luma[i - width], tr = luma[i - width + 1];
        const l = luma[i - 1], r = luma[i + 1];
        const bl = luma[i + width - 1], bt = luma[i + width], br = luma[i + width + 1];
        const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        const gy = (bl + 2 * bt + br) - (tl + 2 * t + tr);
        mag = Math.hypot(gx, gy);
      }
      const c = cells[Math.min(cellsY - 1, Math.floor(y / ch)) * cellsX + Math.min(cellsX - 1, Math.floor(x / cw))];
      c.e += mag; c.wx += mag * x; c.wy += mag * y;
      c.r += data[i * 4]; c.g += data[i * 4 + 1]; c.b += data[i * 4 + 2]; c.count++;
    }
  }

  let maxE = 0, maxD = 0;
  const cand = cells.map((c, idx) => {
    const r = c.r / c.count, g = c.g / c.count, b = c.b / c.count;
    const energy = c.e / c.count;
    const distinct = Math.hypot(r - gr, g - gg, b - gb);
    maxE = Math.max(maxE, energy); maxD = Math.max(maxD, distinct);
    const cx = (idx % cellsX + 0.5) * cw, cy = (Math.floor(idx / cellsX) + 0.5) * ch;
    return {
      x: (c.e > 0 ? c.wx / c.e : cx) / width,
      y: (c.e > 0 ? c.wy / c.e : cy) / height,
      energy, distinct,
      color: { r: Math.round(r), g: Math.round(g), b: Math.round(b) },
    };
  });
  if (maxE === 0 && maxD === 0) return [];           // flat, uniform frame

  for (const c of cand) {
    // a product, not a sum: a point must sit on structure (an object's edge);
    // colour distinctiveness only boosts it, so an empty flat sky never qualifies
    const e = maxE ? c.energy / maxE : 0, d = maxD ? c.distinct / maxD : 0;
    c.score = Math.sqrt(e * (0.35 + 0.65 * d));
  }
  cand.sort((a, b) => b.score - a.score);

  const picked = [];
  for (const c of cand) {
    if (picked.length >= maxPoints || c.score < minScore) break;
    if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= minDistance)) {
      picked.push({ x: c.x, y: c.y, score: c.score, color: c.color });
    }
  }
  return picked;
}
