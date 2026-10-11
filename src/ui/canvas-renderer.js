/**
 * Interactive canvas: photo + points of interest. In melody mode the edges are
 * labelled with distance and interval; in drum mode each point shows the drum it
 * hits. Knows nothing about sound or analysis; it only draws.
 */
import { INTERVAL_NAMES } from '../core/music-theory.js';

export class CanvasRenderer {
  #ro;

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.image = null;
    this.analysis = null;
    this.score = null;
    this.activePoint = -1;
    this.editMode = false;
    this.hover = -1;
    this.#ro = new ResizeObserver(() => this.render());
    this.#ro.observe(canvas.parentElement);
  }

  setImage(image) { this.image = image; this.analysis = null; this.score = null; this.render(); }
  /** points: { mode: 'melody'|'drums'|'off', voices: Map<pointIndex, string> } */
  setAnalysis(analysis, score, points = { mode: 'melody', voices: new Map() }) {
    this.analysis = analysis; this.score = score; this.points = points; this.render();
  }
  setActivePoint(i) { this.activePoint = i; this.render(); }

  // ── Edit mode support ──
  setEditMode(on) { this.editMode = on; this.hover = -1; this.canvas.classList.toggle('editing', on); this.render(); }
  setHover(i) { if (this.hover !== i) { this.hover = i; this.render(); } }

  /** Pointer position → normalised photo coordinates (0..1), clamped to the photo. */
  toNormalized(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }

  /** Index of the point under the pointer, or -1. */
  hitTest(clientX, clientY, radius = 16) {
    const pts = this.analysis?.keypoints ?? [];
    const r = this.canvas.getBoundingClientRect();
    let best = -1, bestD = radius;
    pts.forEach((p, i) => {
      const d = Math.hypot(r.left + p.x * r.width - clientX, r.top + p.y * r.height - clientY);
      if (d <= bestD) { bestD = d; best = i; }
    });
    return best;
  }

  render() {
    const { canvas, ctx, image } = this;
    if (!image) return;
    const parentW = canvas.parentElement.clientWidth;
    const maxH = Math.min(window.innerHeight * 0.68, 720);
    let w = parentW, h = (parentW * image.height) / image.width;
    if (h > maxH) { h = maxH; w = (maxH * image.width) / image.height; }
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(image, 0, 0, w, h);

    const pts = this.analysis?.keypoints;
    if (!pts?.length) return;
    ctx.fillStyle = 'rgba(8, 8, 14, 0.28)';
    ctx.fillRect(0, 0, w, h);

    const P = (p) => [p.x * w, p.y * h];
    ctx.font = '600 11px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    const mode = this.points?.mode ?? 'melody';
    for (const e of this.score?.edges ?? []) {
      const [x1, y1] = P(pts[e.from]), [x2, y2] = P(pts[e.to]);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      if (mode !== 'melody') continue;            // intervals only mean something for a melody
      // fallback motif: there is no meaningful distance, only the interval played
      const label = e.distance ? `${e.distance.toFixed(2)} → ${INTERVAL_NAMES[e.interval]}` : INTERVAL_NAMES[e.interval];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const tw = ctx.measureText(label).width + 10;
      if (Math.hypot(x2 - x1, y2 - y1) < tw + 24) continue;   // too short: the label would cover the points
      ctx.fillStyle = 'rgba(10,10,18,0.82)';
      ctx.fillRect(mx - tw / 2, my - 9, tw, 18);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillText(label, mx, my);
    }

    pts.forEach((p, i) => {
      const [x, y] = P(p);
      const active = i === this.activePoint;
      const hovered = this.editMode && i === this.hover;
      const r = active || hovered ? 14 : this.editMode ? 11 : 9;
      if (this.editMode) {                         // a handle ring says "you can drag me"
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = hovered ? '#ffd666' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.setLineDash([]);
      }
      if (active) {
        ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 214, 102, 0.35)'; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${p.color.r},${p.color.g},${p.color.b})`;
      ctx.fill();
      ctx.lineWidth = active ? 3 : 2;
      ctx.strokeStyle = active ? '#ffd666' : '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      const voice = mode === 'drums' ? this.points.voices.get(i) : null;
      const label = voice ? `${i + 1} · ${voice}` : String(i + 1);
      if (voice) {
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(10,10,18,0.82)';
        ctx.fillRect(x - tw / 2, y - r - 18, tw, 18);
        ctx.fillStyle = '#f4f1ea';
      }
      ctx.fillText(label, x, y - r - 9);
    });
  }

  dispose() { this.#ro.disconnect(); }
}
