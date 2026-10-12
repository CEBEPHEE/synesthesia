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
import { analyzeMovement, planFromMovement, applyMovementPlan, fitTempo } from '../core/dancer.js';
import { movementSample, mainBody } from '../vision/movement.js';

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
    dancer: $('film-dancer'), plan: $('film-plan'), planWrap: $('film-plan-wrap'),
  };
  fillStyleSelect(ui.style, STYLES);
  ui.credits.value = creditsText();

  let film = null;          // { kind, items: [{image, analysis, start?, end?}], video?, timeline, arrangement, hits }
  let ticket = 0, raf = 0, busy = false, abort = null;
  const ctx = ui.canvas.getContext('2d');

  const setStatus = (t, err = false) => { ui.status.textContent = t; ui.status.classList.toggle('error', err); };
  // camera recordings already carry the “Made with Synesthesia” line in the picture
  const opts = () => ({ fit: ui.fit.value, overlay: ui.overlay.checked, credit: !film?.fromCamera });
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
    const settings = {
      styleId: ui.style.value === 'auto' ? null : ui.style.value, getStyle,
      mood: Number(ui.mood.value), pointsAs, snap: film.kind === 'video' ? 'beat' : 'bar',
    };
    let timeline = buildTimeline(scenes, settings);
    let arrangement;
    film.offset = 0; film.plan = null; film.poseTrack = null;
    if (film.following && film.motion) {
      // the dancer's tempo (folded into the style's range); the music starts on their beat
      const m = film.motion;
      let tempo = timeline.tempo;
      if (m.beat) {
        tempo = fitTempo(m.beat.bpm, timeline.style.tempo);
        film.offset = m.beat.offset % (60 / tempo);
        scenes[0] = { ...scenes[0], seconds: Math.max(60 / tempo, scenes[0].seconds - film.offset) };
        timeline = buildTimeline(scenes, { ...settings, styleId: timeline.style.id, tempo });
      }
      film.poseTrack = m.track;
      film.plan = planFromMovement(m.samples, { duration: film.video.usableDuration, tempo: timeline.tempo, offset: film.offset, onsets: m.onsets });
      arrangement = applyMovementPlan(timelineArrangement(timeline), film.plan, { hasDrums: !!timeline.style.drums });
    } else {
      arrangement = timelineArrangement(timeline);
    }
    Object.assign(film, { timeline, arrangement, hits: pointHits(timeline, arrangement) });
    renderStyleOptions(ui.style, timeline.ranking);
    renderScenes();
    renderWhy();
    drawPlan();
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
      ${followText()}
      <ol class="scene-list">${timeline.sections.map((s) => `<li><span class="muted">${fmt(s.startSec)}</span> ${escapeHtml(s.score.key.name)}: ${s.score.chords.map((c) => escapeHtml(c.symbol)).join(' → ')}</li>`).join('')}</ol>`;
  }

  function followText() {
    if (!film.following || !film.motion || !film.plan) return '';
    const m = film.motion, p = film.plan, tl = film.timeline;
    const barSec = (60 / tl.tempo) * 4;
    const at = (bar) => fmt(film.offset + bar * barSec);
    const levels = p.phrases.map((ph) => `<li><span class="muted">${at(ph.startBar)}</span> ${ph.level}${ph.lift === 'high' ? ', arms up / hands open: melody an octave higher' : ph.lift === 'low' ? ', closed pose: softer' : ''}</li>`).join('');
    return `<h3>🕺 Following the ${m.view === 'hands' ? 'hands' : 'dancer'}</h3>
      <p>The app watched the video (${m.view ?? 'nobody found'}). ${m.beat
        ? `The moves have a steady beat of about ${Math.round(m.beat.bpm)} per minute, so the music plays at <b>${tl.tempo} BPM</b> and starts on that beat (${film.offset.toFixed(2)} s in).`
        : 'The moves have no steady beat, so the music keeps its own tempo.'}
      The notes still come from the picture; the movement shapes the song: calm phrases play only chords and melody, groove adds bass and drums, peak plays everything louder${p.accents.length ? `, and the ${p.accents.length} biggest move${p.accents.length > 1 ? 's get a cymbal' : ' gets a cymbal'} with a short drum fill` : ''}. Levels change only every 4 bars, so it stays a song.</p>
      <ol class="scene-list">${levels}</ol>`;
  }

  /** The strip under the scenes: each bar's energy, the phrase levels, the big moves, the playhead. */
  const LEVEL_COLOR = { still: '#3b3b4a', calm: '#2f5d7a', groove: '#2f7a6c', peak: '#b8922f' };
  function drawPlan(playT = null) {
    const show = !!(film?.following && film.plan);
    ui.planWrap.hidden = !show;
    if (!show) return;
    const c = ui.plan, W = (c.width = c.clientWidth * (devicePixelRatio || 1) || 600), H = (c.height = 64 * (devicePixelRatio || 1));
    const g = c.getContext('2d');
    const p = film.plan, tl = film.timeline, total = film.video.usableDuration;
    const barSec = (60 / tl.tempo) * 4;
    const X = (t) => (t / total) * W;
    g.clearRect(0, 0, W, H);
    for (const ph of p.phrases) {
      g.fillStyle = LEVEL_COLOR[ph.level];
      const x0 = X(film.offset + ph.startBar * barSec), x1 = X(film.offset + (ph.startBar + ph.bars) * barSec);
      g.fillRect(x0, H * 0.55, Math.max(1, x1 - x0 - 2), H * 0.45);
      if (ph.lift === 'high') { g.fillStyle = '#fff'; g.font = `${Math.round(H * 0.28)}px system-ui`; g.fillText('↑', x0 + 4, H * 0.92); }
    }
    g.strokeStyle = '#7cc6c2'; g.lineWidth = Math.max(1, W / 600); g.beginPath();
    p.bars.forEach((b, i) => { const x = X(film.offset + (i + 0.5) * barSec), y = H * 0.5 - b.energy * H * 0.42; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = '#fff';
    for (const st of p.accents) g.fillRect(X(film.offset + (st * barSec) / 16) - 1, 0, Math.max(2, W / 400), H);
    if (playT != null) { g.fillStyle = '#ffd666'; g.fillRect(X(playT) - 1, 0, Math.max(2, W / 300), H); }
  }

  function renderTips(extra = []) {
    const tips = [...extra];
    if (film.kind === 'slides') {
      if (film.items.length < 3) tips.push('Three or more photos make a better story.');
      if (Number(ui.seconds.value) < 3) tips.push('Very short slides feel rushed; 3–5 seconds works best for most music.');
    } else if (film.video.fullDuration > film.video.usableDuration) {
      tips.push(`Only the first ${fmt(film.video.usableDuration)} of the video are used (limit: 3 minutes).`);
    }
    if (film.kind === 'video' && !film.following) tips.push('Someone dancing or moving in the video (even just hands)? Press “🕺 Follow the dancer”: the music takes their tempo and gets calmer or more energetic with the moves.');
    if (ui.aspect.value === '9:16' && ui.fit.value === 'fill') tips.push('9:16 with “Fill” crops wide pictures a lot; “Fit” keeps the whole picture.');
    tips.push('Keep this tab visible while exporting: browsers slow down hidden tabs.');
    ui.tips.innerHTML = tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  }

  // ── Preview ──
  const position = () => {
    const engine = getEngine();
    if (!engine || engine.state === 'stopped' || !film?.timeline) return 0;
    return stepsToSeconds(engine.step % film.timeline.totalSteps, film.timeline.tempo);   // music time
  };

  function draw() {
    if (!film?.timeline || busy) return;      // while exporting, the export owns the video element
    const t = position();
    if (film.kind === 'video') syncVideo(t + (film.offset ?? 0));      // the music may start on the dancer's first beat
    if (film.plan) drawPlan(getEngine()?.state === 'started' ? t + (film.offset ?? 0) : null);
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
        musicLevel: original ? 0.85 : 1, startAt: film.offset ?? 0,
      });
      setStatus(film.kind === 'video' ? 'Encoding the video (plays through once, in real time)…' : 'Encoding the video…');
      const o = opts();
      const job = {
        width, height, fps, duration: length, audio, signal: abort.signal,
        onProgress: (f) => { ui.bar.value = f; },
        drawFrame: async (c, t) => {
          if (film.kind === 'video') await seekTo(film.video, Math.min(t, film.video.usableDuration - 0.01));
          drawFilmFrame(c, film, t - (film.offset ?? 0), o);
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
        drawFilmFrame(c, film, i / fps - (film.offset ?? 0), o);
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
        drawFilmFrame(c, film, next / fps - (film.offset ?? 0), o);
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
  /** opts: music settings to start from (e.g. the style you picked in camera mode); default Auto. */
  async function begin(kind, opts = {}) {
    const my = ++ticket;
    onOpen();
    listen();
    getEngine()?.stop({ hard: true });
    film?.video?.pause();
    if (film?.video) { URL.revokeObjectURL(film.video.src); film.video.remove(); }
    film = null;
    // nothing else may keep playing (e.g. the recording's preview in camera mode or "This session")
    document.querySelectorAll('#cam-result-video, dialog.player video').forEach((v) => v.pause());
    ui.stage.hidden = false;
    ui.play.disabled = ui.stop.disabled = ui.exportBtn.disabled = true;
    ui.style.value = opts.styleId && STYLES.some((x) => x.id === opts.styleId) ? opts.styleId : 'auto';
    ui.points.value = opts.pointsAs ?? 'default';
    ui.mood.value = String(opts.mood ?? 0);
    ui.secondsWrap.hidden = kind !== 'slides';
    ui.originalWrap.hidden = kind !== 'video';
    // a fresh soundtrack never mixes in the video's own sound unless asked for again;
    // for camera recordings that sound IS the old live music
    ui.original.checked = false;
    ui.original.disabled = !!opts.fromCamera;
    ui.originalWrap.title = opts.fromCamera ? 'This recording\'s own sound is the live music you played, so it is left out.' : '';
    ui.dancer.hidden = kind !== 'video';
    ui.dancer.setAttribute('aria-pressed', 'false');
    ui.dancer.textContent = '🕺 Follow the dancer';
    ui.planWrap.hidden = true;
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

  async function openVideo(file, opts) {
    const my = await begin('video', opts);
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
      film = { kind: 'video', items, video, fromCamera: !!opts?.fromCamera };
      sizePreview(); compose(); renderTips(); loop();
      if (opts?.follow) ui.dancer.click();              // "a soundtrack that follows my moves"
    } catch (err) {
      console.error(err);
      setStatus(err.message, true);
    }
  }

  // ── Follow the dancer: watch the video once, frame by frame ──
  async function watchMover() {
    const v = film.video, my = ticket;
    busy = true; abort = new AbortController();
    getEngine()?.stop({ hard: true });
    ui.progress.hidden = false; ui.bar.value = 0;
    ui.play.disabled = ui.exportBtn.disabled = ui.dancer.disabled = true;
    const samples = [], views = {}, track = [];
    try {
      const { trackFrame, trackersLoaded } = await import('../vision/trackers.js');
      if (!trackersLoaded()) setStatus('Loading the body and hand tracker (about 23 MB, only the first time)…');
      // 12 frames a second, by seeking: the result is the same however fast the computer is
      const step = 1 / 12, end = v.usableDuration;
      let prev = null;
      for (let t = 0; t < end; t += step) {
        if (abort.signal.aborted || my !== ticket) throw new DOMException('Cancelled', 'AbortError');
        await seekTo(v, t);
        const cur = await trackFrame(v, 1 + t * 1000);
        const s = movementSample(prev, cur, step);
        samples.push({ t, ...s });
        track.push({ t, body: mainBody(cur.bodies), hands: cur.hands, speed: s.speed });
        if (s.view) views[s.view] = (views[s.view] ?? 0) + 1;
        prev = cur;
        ui.bar.value = t / end;
        setStatus(`Watching the moves… ${Math.round((100 * t) / end)}%`);
      }
      const view = Object.entries(views).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const seen = samples.filter((x) => x.present).length / Math.max(1, samples.length);
      if (seen < 0.2) {
        setStatus('No one (and no hands) was found in most of the video, so the music stays as it was.');
        film.following = false;
        ui.dancer.setAttribute('aria-pressed', 'false'); ui.dancer.textContent = '🕺 Follow the dancer';
        return;
      }
      const a = analyzeMovement(samples, { duration: end, styleTempo: film.timeline.style.tempo });
      film.motion = { samples, onsets: a.onsets, beat: a.beat, view, track };
    } catch (err) {
      if (err.name !== 'AbortError') { console.error(err); setStatus(`Could not follow the moves: ${err.message}`, true); }
      film.following = false;
      ui.dancer.setAttribute('aria-pressed', 'false'); ui.dancer.textContent = '🕺 Follow the dancer';
      return;
    } finally {
      busy = false; abort = null;
      ui.progress.hidden = true;
      ui.play.disabled = ui.exportBtn.disabled = ui.dancer.disabled = false;
      if (my === ticket) await seekTo(v, 0);
    }
    if (my !== ticket || !film) return;
    compose(); renderTips();
    setStatus(`${summary()} · 🕺 Following the ${film.motion.view === 'hands' ? 'hands' : 'dancer'}${film.motion.beat ? ` at their tempo (${film.timeline.tempo} BPM)` : ''}.`);
  }

  ui.dancer.addEventListener('click', () => {
    if (!film || busy || film.kind !== 'video') return;
    film.following = !film.following;
    ui.dancer.setAttribute('aria-pressed', String(film.following));
    ui.dancer.textContent = film.following ? '🕺 Following the dancer ✓' : '🕺 Follow the dancer';
    if (film.following) ui.overlay.checked = true;       // show the body that is being followed
    if (film.following && !film.motion) watchMover();
    else { compose(); renderTips(); }
  });

  function close() {
    ticket++;
    cancelAnimationFrame(raf);
    abort?.abort();
    film?.video?.pause();
    ui.stage.hidden = true;
  }

  return { openSlides, openVideo, close, get active() { return !ui.stage.hidden; } };
}
