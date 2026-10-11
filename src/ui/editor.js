/**
 * Edit mode: drag the photo's points, add or remove them, and pick a different
 * chord for any colour. Advice and a harmony check keep the result musical.
 *
 * The editor never touches the music directly: it changes `edits` and asks the
 * app to recompose (throttled while dragging, so the sound follows the hand).
 */
import { chordChoices, editAdvice, MAX_POINTS } from '../core/editing.js';
import { escapeHtml } from './panels.js';

const rgb = (c) => `rgb(${c.r},${c.g},${c.b})`;

/** Average colour of the photo around a point (for points that were moved or added). */
export function makeColorSampler(image) {
  const W = 256, H = Math.max(1, Math.round((256 * image.height) / image.width));
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  return (x, y) => {
    const cx = Math.round(x * (W - 1)), cy = Math.round(y * (H - 1));
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = Math.min(W - 1, Math.max(0, cx + dx)), py = Math.min(H - 1, Math.max(0, cy + dy));
      const i = (py * W + px) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  };
}

/**
 * @param {object} deps
 *   el:        { toggle, panel, palette, tips, meter, meterValue, verdict, reset, done, strip }
 *   renderer:  CanvasRenderer
 *   getContext() → { analysis (edited), score, style, image }
 *   edits:     { keypoints: Array|null, chordOverrides: {} }  (mutated by the editor)
 *   onChange({ live: boolean })  ask the app to recompose
 */
export function initEditor(deps) {
  const { el, renderer, getContext, onChange } = deps;
  const E = () => deps.edits;          // read every time: a new photo replaces the edits object
  let active = false, drag = null, sampler = null, samplerFor = null, menu = null, lastLive = 0, liveTimer = null;
  const canvas = renderer.canvas;

  const points = () => {
    if (!E().keypoints) E().keypoints = getContext().analysis.keypoints.map((p) => ({ ...p, color: { ...p.color } }));
    return E().keypoints;
  };
  const colorAt = (x, y) => {
    const { image } = getContext();
    if (samplerFor !== image) { sampler = makeColorSampler(image); samplerFor = image; }
    return sampler(x, y);
  };
  const changed = (live) => {
    if (!live) { clearTimeout(liveTimer); onChange({ live: false }); return; }
    const now = performance.now();
    const run = () => { lastLive = performance.now(); onChange({ live: true }); };
    clearTimeout(liveTimer);
    if (now - lastLive > 120) run(); else liveTimer = setTimeout(run, 120);
  };

  function setActive(on) {
    active = on;
    el.panel.hidden = !on;
    el.toggle.setAttribute('aria-pressed', String(on));
    el.toggle.textContent = on ? '✓ Done editing' : '✎ Edit';
    el.strip.classList.toggle('editable', on);
    renderer.setEditMode(on);
    closeMenu();
    if (on) refresh();
  }

  // ── Points on the photo ──
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    const i = renderer.hitTest(e.clientX, e.clientY);
    if (i >= 0) {
      drag = { index: i, moved: false };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    if (!drag) { renderer.setHover(renderer.hitTest(e.clientX, e.clientY)); return; }
    const { x, y } = renderer.toNormalized(e.clientX, e.clientY);
    const p = points()[drag.index];
    p.x = x; p.y = y; p.color = colorAt(x, y);
    drag.moved = true;
    changed(true);
  });
  const endDrag = () => { if (drag?.moved) changed(false); drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('click', (e) => {
    if (!active || renderer.hitTest(e.clientX, e.clientY) >= 0) return;
    const pts = points();
    if (pts.length >= MAX_POINTS) { refresh(`At most ${MAX_POINTS} points: remove one first (double-click it).`); return; }
    const { x, y } = renderer.toNormalized(e.clientX, e.clientY);
    pts.push({ x, y, score: 0.7, color: colorAt(x, y) });
    changed(false);
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!active) return;
    const i = renderer.hitTest(e.clientX, e.clientY);
    if (i < 0) return;
    points().splice(i, 1);
    renderer.setHover(-1);
    changed(false);
  });

  // ── Colours → chords ──
  function closeMenu() { menu?.remove(); menu = null; }
  document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('[data-chord-index]')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  function openMenu(anchor, chordIndex) {
    closeMenu();
    const { score, style } = getContext();
    const ch = score.chords[chordIndex];
    const choices = chordChoices(score, chordIndex, style);
    menu = document.createElement('div');
    menu.className = 'chord-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <div class="chord-menu-head"><span class="swatch" style="background:${rgb(ch.color)}"></span>
        Chord for this colour <span class="muted small">★ = smooth with its neighbours</span></div>
      ${choices.map((c) => `
        <button role="menuitemradio" aria-checked="${c.current}" data-degree="${c.degree}" class="${c.current ? 'current' : ''}">
          <span class="star">${c.recommended ? '★' : ''}</span>
          <b>${escapeHtml(c.roman)}</b> ${escapeHtml(c.symbol)}
          <span class="why">${escapeHtml(c.reason)}</span>
        </button>`).join('')}
      ${ch.chosen ? '<button data-degree="original" class="original">↺ Back to the chord the colour suggests</button>' : ''}`;
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 6);
    menu.style.top = `${Math.max(8, top) + window.scrollY}px`;
    menu.style.left = `${Math.min(window.innerWidth - menu.offsetWidth - 8, r.left) + window.scrollX}px`;
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-degree]');
      if (!b) return;
      if (b.dataset.degree === 'original') delete E().chordOverrides[ch.paletteIndex];
      else E().chordOverrides[ch.paletteIndex] = Number(b.dataset.degree);
      closeMenu();
      changed(false);
    });
  }

  el.strip.addEventListener('click', (e) => {
    const card = e.target.closest('[data-index]');
    if (active && card) openMenu(card, Number(card.dataset.index));
  });
  el.palette.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chord-index]');
    if (b) openMenu(b, Number(b.dataset.chordIndex));
  });

  // ── Advice ──
  function refresh(extraTip) {
    if (!active) return;
    const { analysis, score } = getContext();
    if (!score) return;
    el.palette.innerHTML = score.chords.map((ch, i) => `
      <button data-chord-index="${i}" title="Change the chord for this colour">
        <span class="swatch" style="background:${rgb(ch.color)}"></span>
        <b>${escapeHtml(ch.roman)}</b> ${escapeHtml(ch.symbol)}${ch.chosen ? ' <span class="muted small">(your choice)</span>' : ''}
      </button>`).join('');
    const advice = editAdvice(analysis, score);
    el.meter.value = advice.score;
    el.meterValue.textContent = `${advice.score}/100`;
    el.verdict.textContent = advice.verdict;
    const tips = extraTip ? [{ level: 'warn', text: extraTip }, ...advice.tips] : advice.tips;
    el.tips.innerHTML = tips.map((t) => `<li class="${t.level}">${escapeHtml(t.text)}</li>`).join('');
  }

  el.toggle.addEventListener('click', () => setActive(!active));
  el.done.addEventListener('click', () => setActive(false));
  el.reset.addEventListener('click', () => {
    E().keypoints = null;
    E().chordOverrides = {};
    closeMenu();
    changed(false);
  });

  return {
    refresh: () => refresh(),
    close: () => setActive(false),
    get active() { return active; },
  };
}
