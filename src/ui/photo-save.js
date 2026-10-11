/**
 * Saving the picture:
 *  • the photo itself (e.g. one just taken with the camera), as JPEG;
 *  • a "music card": the photo with the points that play, the lines between them,
 *    and a caption with the style, key and the chords in their colours.
 * Drawn in the browser at full quality (up to 2048 px); nothing is uploaded.
 */

const MAX_SIDE = 2048;
const rgb = (c) => `rgb(${c.r},${c.g},${c.b})`;

function canvasFor(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}
const toBlob = (c, type, quality) => (c.convertToBlob
  ? c.convertToBlob({ type, quality })
  : new Promise((r) => c.toBlob(r, type, quality)));

function fitted(image) {
  const s = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  return { w: Math.round(image.width * s), h: Math.round(image.height * s) };
}

/** The photo itself. */
export async function photoBlob(image) {
  const { w, h } = fitted(image);
  const c = canvasFor(w, h);
  c.getContext('2d').drawImage(image, 0, 0, w, h);
  return toBlob(c, 'image/jpeg', 0.92);
}

/**
 * Photo + points + caption.
 * @param {{image, analysis, score, style, pointsAs}} job
 */
export async function musicCardBlob({ image, analysis, score, style, pointsAs, tempo = score.tempo }) {
  const { w, h } = fitted(image);
  const u = Math.max(w, h) / 1000;                  // 1 unit ≈ 1 px on a 1000 px picture
  const band = Math.round(175 * u);
  const c = canvasFor(w, h + band);
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, w, h);

  const pts = analysis.keypoints ?? [];
  if (pts.length && pointsAs !== 'off') {
    g.fillStyle = 'rgba(8,8,14,0.22)';
    g.fillRect(0, 0, w, h);
    const P = (p) => [p.x * w, p.y * h];
    g.setLineDash([6 * u, 6 * u]);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2 * u;
    for (const e of score.edges ?? []) {
      const [x1, y1] = P(pts[e.from]), [x2, y2] = P(pts[e.to]);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.setLineDash([]);
    for (const p of pts) {
      const [x, y] = P(p);
      g.beginPath(); g.arc(x, y, 22 * u, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,214,102,0.25)'; g.fill();
      g.beginPath(); g.arc(x, y, 11 * u, 0, Math.PI * 2);
      g.fillStyle = rgb(p.color); g.fill();
      g.lineWidth = 3 * u; g.strokeStyle = '#fff'; g.stroke();
    }
  }

  // caption band
  g.fillStyle = '#0f0f14';
  g.fillRect(0, h, w, band);
  const pad = 28 * u;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ece9e2';
  g.font = `700 ${34 * u}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const title = `${style.name} · ${score.key.name} · ${tempo} BPM`;
  const tw0 = g.measureText(title).width;
  if (tw0 > w - 2 * pad) g.font = `700 ${(34 * u * (w - 2 * pad)) / tw0}px Inter, system-ui, sans-serif`;   // shrink to fit narrow photos
  g.fillText(title, pad, h + 52 * u);
  let x = pad;
  g.font = `600 ${24 * u}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
  for (const ch of score.chords) {
    const label = ch.symbol;
    const tw = g.measureText(label).width;
    const bw = tw + 26 * u;
    if (x + bw > w - pad) break;
    g.fillStyle = '#1e1e28';
    g.fillRect(x, h + 74 * u, bw, 44 * u);
    g.fillStyle = rgb(ch.color);
    g.fillRect(x, h + 74 * u, bw, 6 * u);
    g.fillStyle = '#ece9e2';
    g.fillText(label, x + 13 * u, h + 108 * u);
    x += bw + 10 * u;
  }
  g.fillStyle = '#8d8a99';
  g.font = `500 ${18 * u}px Inter, system-ui, sans-serif`;
  g.fillText('made with Synesthesia', pad, h + 152 * u);
  return toBlob(c, 'image/png');
}
