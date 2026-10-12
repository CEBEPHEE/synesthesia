/**
 * Draws one frame of the film at time t (used for the live preview and, frame
 * by frame, for the MP4 export, so both look identical).
 *
 *  • slideshow: each photo gets a slow push-in/pull-out ("Ken Burns") and
 *    cross-fades into the next one on the beat the music changes;
 *  • video: the current video frame;
 *  • optional overlay: the photo's points light up when they play.
 *
 * "fit" shows the whole picture over a blurred, darkened copy of itself
 * (no black bars, nothing cropped); "fill" crops to fill the frame.
 */
import { fitRect } from './scenes.js';
import { stepsToSeconds } from '../core/timeline.js';
import { APP_CREDIT } from '../credit.js';

const FADE = 0.6;          // seconds of cross-fade between slides
const ZOOM = 0.07;         // how far the Ken Burns move zooms

/** For every section: when each point plays (seconds, absolute). */
export function pointHits(timeline, arrangement) {
  const hits = timeline.sections.map(() => []);
  for (const e of [...arrangement.tracks.melody, ...(arrangement.tracks.pointDrums ?? [])]) {
    if (e.pointIndex == null || e.pointIndex < 0) continue;
    hits[e.section]?.push({ t: stepsToSeconds(e.step, timeline.tempo), p: e.pointIndex });
  }
  hits.forEach((h) => h.sort((a, b) => a.t - b.t));
  return hits;
}

function drawPicture(ctx, src, W, H, fit, zoom = 1, panX = 0, panY = 0) {
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  if (!sw || !sh) return null;
  if (fit === 'fit') {
    const bg = fitRect(sw, sh, W, H, 'cover', 1.08);
    ctx.save();
    if ('filter' in ctx) ctx.filter = `blur(${Math.round(Math.max(W, H) / 40)}px) brightness(0.45)`;
    ctx.drawImage(src, bg.x, bg.y, bg.w, bg.h);
    ctx.restore();
    if (!('filter' in ctx)) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H); }
  }
  const r = fitRect(sw, sh, W, H, fit === 'fit' ? 'contain' : 'cover', zoom);
  r.x += panX * W; r.y += panY * H;
  ctx.drawImage(src, r.x, r.y, r.w, r.h);
  return r;
}

function drawPoints(ctx, rect, analysis, hits, t, W) {
  if (!rect || !analysis?.keypoints?.length) return;
  const last = new Map();
  for (const h of hits) { if (h.t > t) break; last.set(h.p, h.t); }
  const base = Math.max(3, W / 260);
  analysis.keypoints.forEach((p, i) => {
    const x = rect.x + p.x * rect.w, y = rect.y + p.y * rect.h;
    const since = last.has(i) ? t - last.get(i) : Infinity;
    const glow = Math.exp(-since / 0.28);
    ctx.beginPath();
    ctx.arc(x, y, base * (1.6 + 2.2 * glow), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,214,102,${0.35 + 0.65 * glow})`;
    ctx.lineWidth = base * 0.45;
    ctx.stroke();
    if (glow > 0.02) {
      ctx.beginPath();
      ctx.arc(x, y, base * (2 + 6 * (1 - glow)), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,102,${0.5 * glow})`;
      ctx.stroke();
    }
  });
}

/** The small "Made with Synesthesia" line in the corner of every video. */
export function drawCredit(ctx, W = ctx.canvas.width, H = ctx.canvas.height) {
  const size = Math.max(11, Math.round(Math.min(W, H) / 42));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = `600 ${size}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,.75)';
  ctx.shadowBlur = size / 3;
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.fillText(APP_CREDIT, W - size * 0.9, H - size * 0.7);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {object} film  { kind: 'slides'|'video', items: [{image, analysis}], video?, timeline, hits }
 * @param {number} t     seconds from the start of the film
 * @param {{fit?: 'fit'|'fill', overlay?: boolean}} opts
 */
export function drawFilmFrame(ctx, film, t, { fit = 'fit', overlay = true, credit = true } = {}) {
  const i = drawPicture_(ctx, film, t, fit, overlay);
  if (credit) drawCredit(ctx);
  return i;
}

function drawPicture_(ctx, film, t, fit, overlay) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const secs = film.timeline.sections;
  let i = secs.length - 1;
  while (i > 0 && t < secs[i].startSec) i--;
  const sec = secs[i];

  if (film.kind === 'video') {
    const rect = drawPicture(ctx, film.frame ?? film.video, W, H, fit);   // film.frame: a still copy during export
    if (overlay) drawPoints(ctx, rect, film.items[i]?.analysis, film.hits[i], t, W);
    return i;
  }

  const slide = (k, alpha) => {
    const s = secs[k], item = film.items[k];
    const local = t - s.startSec;
    const p = Math.min(1, Math.max(0, (local + FADE / 2) / (s.seconds + FADE)));
    const zoomIn = k % 2 === 0;
    const zoom = 1 + ZOOM * (zoomIn ? p : 1 - p);
    const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][k % 4];
    const pan = 0.012 * (p - 0.5);
    ctx.globalAlpha = alpha;
    const rect = drawPicture(ctx, item.image, W, H, fit, zoom, dir[0] * pan, dir[1] * pan);
    if (overlay) drawPoints(ctx, rect, item.analysis, film.hits[k], t, W);
    ctx.globalAlpha = 1;
  };
  // cross-fade centred on the moment the music changes
  const toEnd = sec.startSec + sec.seconds - t, fromStart = t - sec.startSec;
  if (i + 1 < secs.length && toEnd < FADE / 2) { slide(i, 1); slide(i + 1, 0.5 - toEnd / FADE); }
  else if (i > 0 && fromStart < FADE / 2) { slide(i - 1, 1); slide(i, 0.5 + fromStart / FADE); }
  else slide(i, 1);
  return i;
}
