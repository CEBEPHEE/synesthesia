/**
 * Film mode: several photos (slideshow) or a video → one piece of music → MP4.
 *
 *   photos/video ─► analysis per photo / per scene ─► timeline (one style, one tempo,
 *   each scene its own chords) ─► live preview (canvas + audio engine)
 *                                └► export: soundtrack rendered offline + frames → MP4
 *
 * Everything runs in this tab. The original files are never uploaded.
 */
import { STYLES, getStyle } from '../core/styles.js';
import { buildTimeline, timelineArrangement, stepsToSeconds } from '../core/timeline.js';
import { detectScenes, outputSize } from '../video/scenes.js';
import { loadVideo, sampleSignatures, grabFrame, seekTo, decodeSoundtrack } from '../video/frames.js';
import { drawFilmFrame, pointHits } from '../video/film-renderer.js';
import { fillStyleSelect, renderStyleOptions, escapeHtml } from './panels.js';
import { download, creditsText } from './export-menu.js';

export const MAX_PHOTOS = 30;
const rgb = (c) => `rgb(${c.r},${c.g},${c.b})`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * @param {{analyzer, ensureEngine: () => Promise<AudioEngine>, getEngine: () => AudioEngine|null,
 *          onOpen: () => void}} deps
 */
export function initVideoStage({ analyzer, ensureEngine, getEngine, onOpen }) {
  const $ = (id) => document.getElementById(id);
  const ui = {
    stage: $('film-stage'), canvas: $('film-canvas'), status: $('film-status'), scenes: $('film-scenes'),
    play: $('film-play'), stop: $('film-stop'), exportBtn: $('film-export'), style: $('film-style'),
    seconds: $('film-seconds'), secondsOut: $('film-seconds-out'), secondsWrap: $('film-seconds-wrap'),
    aspect: $('film-aspect'), quality: $('film-quality'), fit: $('film-fit'), overlay: $('film-overlay'),
    mood: $('film-mood'), points: $('film-points'), original: $('film-original'), originalWrap: $('film-original-wrap'),
    progress: $('film-progress'), bar: $('film-bar'), cancel: $('film-cancel'), credits: $('film-credits'),
    copy: $('film-copy'), why: $('film-why'), tips: $('film-tips'),
  };
  fillStyleSelect(ui.style, STYLES);
  ui.credits.value = creditsText();

  let film = null;          // { kind, items: [{image, analysis, start?, end?}], video?, timeline, arrangement, hits }
  let ticket = 0, raf = 0, busy = false, abort = null;
  const ctx = ui.canvas.getContext('2d');

  const setStatus = (t, err = false) => { ui.status.textContent = t; ui.status.classList.toggle('error', err); };
  const opts = () => ({ fit: ui.fit.value, overlay: ui.overlay.checked });
  const filmLength = () => (film.kind === 'video' ? film.video.usableDuration : film.timeline.totalSeconds + 1.5);

  function sizePreview() {
    const src = film.kind === 'video' ? { w: film.video.videoWidth, h: film.video.videoHeight } : { w: film.items[0].image.width, h: film.items[0].image.height };
    const { width, height } = outputSize(ui.aspect.value, 360, src.w, src.h);
    ui.canvas.width = width; ui.canvas.height = height;
  }

  const summary = () => `${film.timeline.style.name} · ${film.timeline.tempo} BPM · ${film.items.length} ${film.kind === 'video' ? 'scene' : 'photo'}${film.items.length > 1 ? 's' : ''} · ${fmt(filmLength())}`;

  // ── Building the music ──
  function compose() {
    const pointsAs = ui.points.value === 'default' ? undefined : ui.points.value;
    const scenes = film.items.map((it) => ({ analysis: it.analysis, seconds: film.kind === 'video' ? it.end - it.start : Number(ui.seconds.value) }));
    const timeline = buildTimeline(scenes, {
      styleId: ui.style.value === 'auto' ? null : ui.style.value, getStyle,
      mood: Number(ui.mood.value), pointsAs, snap: film.kind === 'video' ? 'beat' : 'bar',
    });
    const arrangement = timelineArrangement(timeline);
    Object.assign(film, { timeline, arrangement, hits: pointHits(timeline, arrangement) });
    renderStyleOptions(ui.style, timeline.ranking);
    renderScenes();
    renderWhy();
    ui.play.disabled = ui.stop.disabled = ui.exportBtn.disabled = false;
    setStatus(summary());
    const engine = getEngine();
    if (engine) engine.load({ ...arrangement, tempo: timeline.tempo }, timeline.style).catch((e) => setStatus(e.message, true));
    draw();
  }

  function renderScenes() {
    const secs = film.timeline.sections;
    ui.scenes.innerHTML = film.items.map((it, i) => {
      const s = secs[i];
      return `<button class="scene" data-scene="${i}" title="Play from here">
        <canvas width="96" height="60" data-thumb="${i}"></canvas>
        <span class="t">${fmt(s.startSec)}</span>
        <span class="k">${escapeHtml(s.score.key.name)}</span>
        <span class="c">${s.score.chords.map((c) => `<i style="background:${rgb(c.color)}"></i>`).join('')}</span>
      </button>`;
    }).join('');
    ui.scenes.querySelectorAll('canvas[data-thumb]').forEach((c) => {
      const img = film.items[Number(c.dataset.thumb)].image;
      const g = c.getContext('2d');
      const s = Math.max(96 / img.width, 60 / img.height);
      g.drawImage(img, (96 - img.width * s) / 2, (60 - img.height * s) / 2, img.width * s, img.height * s);
    });
  }

  function renderWhy() {
    const { timeline } = film;
    const auto = ui.style.value === 'auto';
    const top = timeline.ranking.slice(0, 3).map((m) => `${escapeHtml(m.style.name)} ${Math.round(m.score * 100)}%`).join(' · ');
    const what = film.kind === 'video' ? 'scenes of the video' : 'photos';
    ui.why.innerHTML = `
      <h3>Why it sounds like this</h3>
      <p><b>${escapeHtml(timeline.style.name)}</b> ${auto
        ? `was chosen from the average look of all ${film.items.length} ${what} (best matches: ${top}).`
        : 'was picked by you.'} One style and one tempo (<b>${timeline.tempo} BPM</b>) keep the film sounding like one piece.</p>
      <p>Every ${film.kind === 'video' ? 'scene' : 'photo'} gets its own key colour and chords from its own palette, and the chords are voiced to flow smoothly from one ${film.kind === 'video' ? 'scene' : 'photo'} to the next.
      ${film.kind === 'video' ? 'Scene changes were found where the colours of the picture change abruptly; the music changes on the nearest beat.' : 'Photos change on the first beat of a bar, exactly when the music moves on.'}</p>
      <ol class="scene-list">${timeline.sections.map((s) => `<li><span class="muted">${fmt(s.startSec)}</span> ${escapeHtml(s.score.key.name)}: ${s.score.chords.map((c) => escapeHtml(c.symbol)).join(' → ')}</li>`).join('')}</ol>`;
  }

  function renderTips(extra = []) {
    const tips = [...extra];
    if (film.kind === 'slides') {
      if (film.items.length < 3) tips.push('Three or more photos make a better story.');
      if (Number(ui.seconds.value) < 3) tips.push('Very short slides feel rushed; 3–5 seconds works best for most music.');
    } else if (film.video.fullDuration > film.video.usableDuration) {
      tips.push(`Only the first ${fmt(film.video.usableDuration)} of the video are used (limit: 3 minutes).`);
    }
    if (ui.aspect.value === '9:16' && ui.fit.value === 'fill') tips.push('9:16 with “Fill” crops wide pictures a lot; “Fit” keeps the whole picture.');
    tips.push('Keep this tab visible while exporting: browsers slow down hidden tabs.');
    ui.tips.innerHTML = tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  }

  // ── Preview ──
  const position = () => {
    const engine = getEngine();
    if (!engine || engine.state === 'stopped' || !film?.timeline) return 0;
    return stepsToSeconds(engine.step % film.timeline.totalSteps, film.timeline.tempo);
  };

  function draw() {
    if (!film?.timeline || busy) return;      // while exporting, the export owns the video element
    const t = position();
    if (film.kind === 'video') syncVideo(t);
    const i = drawFilmFrame(ctx, film, t, opts());
    ui.scenes.querySelectorAll('.scene').forEach((b) => b.classList.toggle('active', Number(b.dataset.scene) === i && getEngine()?.state === 'started'));
  }
  function loop() { draw(); raf = requestAnimationFrame(loop); }

  function syncVideo(t) {
    const v = film.video, engine = getEngine();
    const playing = engine?.state === 'started';
    v.muted = !ui.original.checked;
    v.volume = 0.35;
    if (playing && t < v.usableDuration) {
      if (v.paused) v.play().catch(() => {});
      if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
    } else {
      if (!v.paused) v.pause();
      if (!playing && Math.abs(v.currentTime - t) > 0.05 && !v.seeking) v.currentTime = t;
    }
  }

  ui.play.addEventListener('click', async () => {
    if (!film?.timeline || busy) return;
    try {
      const engine = await ensureEngine();
      listen();
      if (engine.state === 'started') { engine.pause(); return; }
      await engine.load({ ...film.arrangement, tempo: film.timeline.tempo }, film.timeline.style);
      engine.play();
    } catch (err) { setStatus(`Audio is unavailable: ${err.message}`, true); }
  });
  ui.stop.addEventListener('click', () => { getEngine()?.stop(); film?.video?.pause(); });
  ui.scenes.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scene]');
    if (!b || !film?.timeline || busy) return;
    const engine = await ensureEngine();
    if (engine.state !== 'started') {
      await engine.load({ ...film.arrangement, tempo: film.timeline.tempo }, film.timeline.style);
      engine.play();
    }
    engine.seek(film.timeline.sections[Number(b.dataset.scene)].startStep);
  });

  const onEngineState = (e) => {
    const playing = e.detail.state === 'started';
    ui.play.textContent = playing ? '❚❚ Pause' : '▶ Play';
    if (!playing) film?.video?.pause();
  };
  let listened = null;
  const listen = () => {
    const engine = getEngine();
    if (engine && listened !== engine) {
      engine.addEventListener('state', onEngineState);
      engine.addEventListener('loading', (e) => { if (film?.timeline && !busy) setStatus(`Loading the ${e.detail.style} instruments…`); });
      engine.addEventListener('loaded', () => { if (film?.timeline && !busy) setStatus(summary()); });
      listened = engine;
    }
  };

  // settings that change the music
  for (const el of [ui.style, ui.mood, ui.points]) el.addEventListener('input', () => film && !busy && compose());
  ui.seconds.addEventListener('input', () => {
    ui.secondsOut.textContent = ui.seconds.value;
    if (film && !busy) { compose(); renderTips(); }
  });
  // settings that only change the picture
  for (const el of [ui.aspect, ui.fit]) el.addEventListener('input', () => { if (film) { sizePreview(); renderTips(); draw(); } });
  ui.overlay.addEventListener('input', draw);
  ui.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ui.credits.value); ui.copy.textContent = '✓ Copied'; } catch { ui.credits.select(); }
    setTimeout(() => { ui.copy.textContent = 'Copy'; }, 1500);
  });

  // ── Export ──
  ui.exportBtn.addEventListener('click', async () => {
    if (!film?.timeline || busy) return;
    busy = true;
    abort = new AbortController();
    getEngine()?.stop({ hard: true });
    film.video?.pause();
    ui.progress.hidden = false; ui.bar.value = 0;
    ui.exportBtn.disabled = ui.play.disabled = true;
    const short = Number(ui.quality.value);
    const src = film.kind === 'video' ? { w: film.video.videoWidth, h: film.video.videoHeight } : { w: film.items[0].image.width, h: film.items[0].image.height };
    const { width, height } = outputSize(ui.aspect.value, short, src.w, src.h);
    const fps = 30, length = filmLength();
    const { timeline, arrangement } = film;
    try {
      setStatus('Composing the soundtrack…');
      const [{ renderSoundtrack }, { exportMp4 }] = await Promise.all([import('../audio/exporter.js'), import('../video/export-mp4.js')]);
      const original = film.kind === 'video' && ui.original.checked ? await decodeSoundtrack(film.video.file) : null;
      const audio = await renderSoundtrack({
        arrangement, style: timeline.style, tempo: timeline.tempo, length, original,
        musicLevel: original ? 0.85 : 1,
      });
      setStatus(film.kind === 'video' ? 'Encoding the video (plays through once, in real time)…' : 'Encoding the video…');
      const o = opts();
      const job = {
        width, height, fps, duration: length, audio, signal: abort.signal,
        onProgress: (f) => { ui.bar.value = f; },
        drawFrame: async (c, t) => {
          if (film.kind === 'video') await seekTo(film.video, Math.min(t, film.video.usableDuration - 0.01));
          drawFilmFrame(c, film, t, o);
        },
      };
      if (film.kind === 'video') job.capture = (c, frameCount, emit) => captureVideo(c, frameCount, fps, emit, o);
      const { blob, codecs, extension } = await exportMp4(job);
      const name = `synesthesia-${film.kind === 'video' ? 'video' : 'slideshow'}-${timeline.style.id}-${ui.aspect.value.replace(':', 'x')}.${extension}`;
      download(blob, name);
      setStatus(`Saved ${name} (${(blob.size / 1048576).toFixed(1)} MB, ${width}×${height}, ${codecs}). If you post it, paste the credits below into the description.`);
      ui.credits.closest('details').open = true;
    } catch (err) {
      console.error(err);
      setStatus(err.name === 'AbortError' ? 'Export cancelled.' : `Export failed: ${err.message}`, err.name !== 'AbortError');
    } finally {
      busy = false; abort = null;
      ui.progress.hidden = true;
      ui.exportBtn.disabled = ui.play.disabled = false;
      if (film?.video) { film.video.playbackRate = 1; await seekTo(film.video, 0); }
      draw();
    }
  });
  ui.cancel.addEventListener('click', () => abort?.abort());

  /** Videos: play once and grab frames as the browser decodes them (much faster than seeking frame by frame). */
  async function captureVideo(c, frameCount, fps, emit, o) {
    const v = film.video;
    v.muted = true;
    await seekTo(v, 0);
    const bySeeking = async (from) => {
      for (let i = from; i < frameCount; i++) {
        if (abort?.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        await seekTo(v, Math.min(i / fps, v.usableDuration - 0.01));
        drawFilmFrame(c, film, i / fps, o);
        await emit(i);
      }
    };
    let next = 0, rate = 1;
    const pending = [];
    // One still copy of the current video frame per batch, so every output frame
    // of the batch shows exactly the picture that belongs to its time.
    const still = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const stillCtx = still.getContext('2d');
    film.frame = still;
    const flush = (upTo) => {
      stillCtx.drawImage(v, 0, 0);
      let n = 0;
      while (next < frameCount && next / fps <= upTo) {
        drawFilmFrame(c, film, next / fps, o);
        pending.push(emit(next));   // encodes synchronously; the promise only carries back-pressure/errors
        next++; n++;
      }
      // the computer cannot keep up (several frames per batch): slow the video down; speed back up when it can
      if (n > 2 && rate > 0.15) { rate *= 0.8; v.playbackRate = rate; }
      else if (n <= 1 && rate < 1) { rate = Math.min(1, rate * 1.05); v.playbackRate = rate; }
    };
    const played = await new Promise((resolve, reject) => {
      // Frames are taken as the video plays: on every decoded frame (requestVideoFrameCallback)
      // and, as a safety net, by polling the play position. If the video never starts
      // moving (some hidden or headless tabs), fall back to seeking frame by frame.
      let over = false, lastMove = performance.now(), lastT = -1;
      const end = (ok, err) => {
        if (over) return;
        over = true; v.pause(); clearInterval(poll);
        if (err) reject(err); else { if (ok) flush(Infinity); resolve(ok); }
      };
      const step = () => {
        if (over) return;
        const mediaTime = v.currentTime;
        if (abort?.signal.aborted) { end(false, new DOMException('Export cancelled', 'AbortError')); return; }
        if (mediaTime !== lastT) { lastT = mediaTime; lastMove = performance.now(); }
        flush(mediaTime + 0.5 / fps);
        if (mediaTime >= v.usableDuration - 0.5 / fps || next >= frameCount) end(true);
      };
      const onFrame = () => { step(); if (!over) v.requestVideoFrameCallback(onFrame); };
      const poll = setInterval(() => {
        if (!v.seeking && v.readyState >= 2) step();
        if (!over && performance.now() - lastMove > 3000) {
          if (lastT <= 0) end(false);                       // never started: seek instead
          else v.play().catch(() => {});                    // stalled: nudge
        }
      }, 8);
      v.addEventListener('ended', () => end(true), { once: true });
      if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(onFrame);
      v.playbackRate = 1;
      v.play().catch((e) => end(false, e));
    });
    await Promise.all(pending);
    delete film.frame;
    v.playbackRate = 1;
    if (!played) await bySeeking(next);
  }

  // ── Opening films ──
  async function begin(kind) {
    const my = ++ticket;
    onOpen();
    listen();
    getEngine()?.stop({ hard: true });
    film?.video?.pause();
    if (film?.video) { URL.revokeObjectURL(film.video.src); film.video.remove(); }
    film = null;
    ui.stage.hidden = false;
    ui.play.disabled = ui.stop.disabled = ui.exportBtn.disabled = true;
    ui.style.value = 'auto'; ui.points.value = 'default'; ui.mood.value = '0';
    ui.secondsWrap.hidden = kind !== 'slides';
    ui.originalWrap.hidden = kind !== 'video';
    ui.overlay.checked = kind === 'slides';
    ui.scenes.innerHTML = ''; ui.why.innerHTML = '';
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    cancelAnimationFrame(raf);
    return my;
  }

  async function openSlides(files) {
    const my = await begin('slides');
    const extra = [];
    if (files.length > MAX_PHOTOS) { extra.push(`Only the first ${MAX_PHOTOS} photos are used.`); files = files.slice(0, MAX_PHOTOS); }
    const items = [];
    try {
      for (const [i, f] of files.entries()) {
        setStatus(`Reading photo ${i + 1} of ${files.length}…`);
        const image = await createImageBitmap(f, { imageOrientation: 'from-image' });
        const analysis = await analyzer.analyze(image, { colors: 6, maxPoints: 7 });
        if (my !== ticket) return;
        items.push({ image, analysis });
      }
    } catch (err) { setStatus(`Could not read a photo: ${err.message}`, true); return; }
    film = { kind: 'slides', items };
    sizePreview(); compose(); renderTips(extra); loop();
  }

  async function openVideo(file) {
    const my = await begin('video');
    try {
      setStatus('Opening the video…');
      const video = await loadVideo(file);
      if (my !== ticket) return;
      setStatus('Looking for scene changes…');
      const { signatures, times } = await sampleSignatures(video, { onProgress: (f) => setStatus(`Looking for scene changes… ${Math.round(f * 100)}%`) });
      const cuts = detectScenes(signatures, times, { duration: video.usableDuration });
      const items = [];
      for (const [i, sc] of cuts.entries()) {
        setStatus(`Reading scene ${i + 1} of ${cuts.length}…`);
        const image = await grabFrame(video, Math.min(video.usableDuration - 0.05, (sc.start + sc.end) / 2));
        const analysis = await analyzer.analyze(image, { colors: 6, maxPoints: 7 });
        if (my !== ticket) return;
        items.push({ image, analysis, start: sc.start, end: sc.end });
      }
      await seekTo(video, 0);
      film = { kind: 'video', items, video };
      sizePreview(); compose(); renderTips(); loop();
    } catch (err) {
      console.error(err);
      setStatus(err.message, true);
    }
  }

  function close() {
    ticket++;
    cancelAnimationFrame(raf);
    abort?.abort();
    film?.video?.pause();
    ui.stage.hidden = true;
  }

  return { openSlides, openVideo, close, get active() { return !ui.stage.hidden; } };
}
