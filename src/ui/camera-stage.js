/**
 * Camera mode: live music from the webcam, plus "take a photo" and "record a video"
 * right in the app.
 *
 *   camera ─► every 250 ms: colours + points (worker) and motion (here)
 *          ─► LiveConductor.feed()          (smoothing, no decisions)
 *   transport, one beat before each bar ─► LiveConductor.decide() ─► engine.load(…, anchored on the bar)
 *
 * So the music only ever changes on the first beat of a bar and always stays in time.
 *
 * "Music follows": the picture (colours and shapes, steady) or my moves (body and hand
 * tracking: the notes still come from the picture, the moves bring the layers in and
 * out every two bars, see core/live-moves.js). Live music and recordings use the same choice.
 * The camera picture never leaves the browser.
 */
import { STYLES, getStyle } from '../core/styles.js';
import { LiveConductor } from '../core/live.js';
import { detectMotion, toLuma } from '../vision/motion.js';
import { fillStyleSelect, renderStyleOptions, escapeHtml } from './panels.js';
import { download } from './export-menu.js';
import { thumbnail } from './session-gallery.js';
import { drawCredit, drawSkeleton } from '../video/film-renderer.js';
import { LiveMoves, LEVEL_TEXT } from '../core/live-moves.js';
import { applyMovementPlan } from '../core/dancer.js';
import { loadTrackers, trackFrame } from '../vision/trackers.js';
import { movementSample, mainBody } from '../vision/movement.js';

const MAX_RECORD_SECONDS = 180;
const MW = 48, MH = 36;                    // motion grid frame
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const REASONS = {
  start: 'Music started from what the camera sees.',
  restyle: 'Your new setting took effect on this bar.',
  harmony: 'The colours in the picture changed and stayed that way for two bars, so the key and chords moved on.',
  melody: 'The points moved, so the melody follows them (the chords stay).',
  moves: 'Your moves changed, so the layers changed on this bar (the notes stay).',
};
const HINTS = {
  picture: 'Colours and shapes in the frame make the music. Steady and calm.',
  moves: 'The app follows your body and hands: dance and the bass and drums come in, stand still and the music holds, raise your arms and the melody goes up. The notes still come from the picture.',
};

/**
 * @param {{analyzer, ensureEngine, getEngine, onOpen, onPhoto: (ImageBitmap) => void, onVideo: (File) => void}} deps
 */
export function initCameraStage(deps) {
  const { analyzer, ensureEngine, getEngine, onOpen, onPhoto, onVideo } = deps;
  const gallery = { add: (...a) => deps.gallery.add(...a), markSaved: (...a) => deps.gallery.markSaved(...a), fileName: (...a) => deps.gallery.fileName(...a) };
  const $ = (id) => document.getElementById(id);
  const ui = {
    stage: $('camera-stage'), canvas: $('cam-canvas'), status: $('cam-status'), flash: $('cam-flash'), badge: $('cam-rec-badge'),
    music: $('cam-music'), photo: $('cam-photo'), record: $('cam-record'), close: $('cam-close'),
    style: $('cam-style'), repick: $('cam-repick'), mood: $('cam-mood'), points: $('cam-points'),
    device: $('cam-device'), deviceWrap: $('cam-device-wrap'), mirror: $('cam-mirror'), motion: $('cam-motion'),
    result: $('cam-result'), resultVideo: $('cam-result-video'), score: $('cam-score'), follow: $('cam-follow'), save: $('cam-save'), discard: $('cam-discard'),
    why: $('cam-why'), hint: $('cam-follows-hint'),
    follows: [...document.querySelectorAll('input[name="cam-follows"]')],
  };
  fillStyleSelect(ui.style, STYLES);
  const ctx = ui.canvas.getContext('2d');
  const small = new OffscreenCanvas(MW, MH);
  const smallCtx = small.getContext('2d', { willReadFrequently: true });

  let stream = null, video = null, conductor = null, ticker = 0, raf = 0, prevLuma = null;
  let motionPts = null, motionUntil = 0, motionLevel = 0, lastBoundary = -1, musicOn = false;
  let recorder = null, recStart = 0, recTimer = 0, recorded = null, active = false;
  let flashPoint = new Map(), lastDecision = null;
  // following the moves
  const moves = new LiveMoves();
  let base = null, baseAnchor = 0, pose = null, poseAt = 0, tracking = false, trackersOk = null;
  const following = () => ui.follows.find((r) => r.checked)?.value === 'moves';
  const setStatus = (t, err = false) => { ui.status.textContent = t; ui.status.classList.toggle('error', err); };
  const pointsChoice = () => (ui.points.value === 'default' ? undefined : ui.points.value);

  // ── Camera ──
  async function startCamera(deviceId) {
    stopTracks();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('The camera only works on https:// or on localhost (start the app with python3 serve.py).');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }) },
      audio: false,
    });
    video ??= Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    video.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    video.setAttribute('aria-hidden', 'true');
    if (!video.isConnected) document.body.append(video);
    video.srcObject = stream;
    await video.play();
    const scale = Math.min(1, 960 / video.videoWidth);
    ui.canvas.width = Math.round(video.videoWidth * scale);
    ui.canvas.height = Math.round(video.videoHeight * scale);
    prevLuma = null;
    // camera list (labels are only visible after permission was given)
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const current = stream.getVideoTracks()[0].getSettings().deviceId;
    ui.device.replaceChildren(...cams.map((d, i) => new Option(d.label || `Camera ${i + 1}`, d.deviceId)));
    ui.device.value = current ?? '';
    ui.deviceWrap.hidden = cams.length < 2;
  }

  function stopTracks() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // ── Seeing: colours + points every 250 ms, movement on top ──
  async function analyse() {
    if (!video || video.readyState < 2) return;
    smallCtx.drawImage(video, 0, 0, MW, MH);
    const rgba = smallCtx.getImageData(0, 0, MW, MH).data;
    const luma = toLuma(rgba);
    const now = performance.now();
    if (prevLuma) {
      const m = detectMotion(prevLuma, luma, MW, MH);
      motionLevel = motionLevel * 0.6 + m.energy * 0.4;
      if (!following()) ui.motion.value = Math.min(1, motionLevel * 6);
      if (m.energy > 0.015 && m.points.length >= 2) {
        motionPts = m.points.map((p) => {
          const i = (Math.min(MH - 1, Math.floor(p.y * MH)) * MW + Math.min(MW - 1, Math.floor(p.x * MW))) * 4;
          return { ...p, color: { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] } };
        });
        motionUntil = now + 1200;            // keep the moving points a moment after the hand stops
      }
    }
    prevLuma = luma;
    const job = analyzer.analyzeLatest(video, { colors: 6, maxPoints: 7 });
    if (!job) return;
    try {
      const analysis = await job;
      if (!active) return;
      conductor.feed(analysis);
      if (!musicOn && !lastDecision && !tracking) setStatus(following() ? 'Ready. Press ▶ Music and dance.' : 'Ready. Press ▶ Music, then show colourful things to the camera.');
    } catch (err) { console.warn(err); }
  }

  // ── Drawing + the bar clock ──
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!video || video.readyState < 2) return;
    const W = ui.canvas.width, H = ui.canvas.height, mirror = ui.mirror.checked;
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, W, H);
    if (following() && pose && performance.now() - poseAt < 500) {
      const body = mainBody(pose.bodies);
      drawSkeleton(ctx, { x: 0, y: 0, w: W, h: H }, { body, hands: pose.hands, speed: moves.speed }, W);
    }
    ctx.restore();
    const now = performance.now();
    if (following()) { if (recCtx) drawRecordingFrame(); barClock(); return; }
    const pts = lastDecision?.score ? (conductor.committed?.analysis.keypoints ?? []) : (conductor.latest?.keypoints ?? []);
    pts.forEach((p, i) => {
      const x = (mirror ? 1 - p.x : p.x) * W, y = p.y * H;
      const glow = Math.exp(-(now - (flashPoint.get(i) ?? -1e9)) / 250);
      ctx.beginPath(); ctx.arc(x, y, 7 + 10 * glow, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,102,${0.45 + 0.55 * glow})`; ctx.lineWidth = 3; ctx.stroke();
    });
    if (recCtx) drawRecordingFrame();
    barClock();
  }

  // What gets recorded: the camera picture (not mirrored, like a normal video)
  // with the small credit line in the corner. The music is added as the sound track.
  let recCanvas = null, recCtx = null;
  function drawRecordingFrame() {
    recCtx.drawImage(video, 0, 0, recCanvas.width, recCanvas.height);
    drawCredit(recCtx);
  }

  /** The music settings in use now, so a new soundtrack for the recording starts from them. */
  const settings = () => ({ styleId: ui.style.value === 'auto' ? null : ui.style.value, mood: Number(ui.mood.value), pointsAs: ui.points.value, follows: following() ? 'moves' : 'picture' });

  /** The arrangement as it should sound now: shaped by the moves when following them. */
  const shaped = (d) => (following() ? applyMovementPlan(d.arrangement, moves.plan(), { hasDrums: !!d.style.drums }) : d.arrangement);

  function barClock() {
    const engine = getEngine();
    if (!musicOn || !engine || engine.state !== 'started') return;
    const s = engine.step;
    const boundary = Math.ceil((s + 0.01) / 16) * 16;
    if (boundary - s > 2 || boundary === lastBoundary) return;    // decide one beat-ish before each bar
    lastBoundary = boundary;
    const m = following() ? moves.bar() : null;
    const d = conductor.decide();
    if (d) apply(d, boundary);
    else if (m?.changed && base) {
      // same notes, other layers: carry on from the same point of the loop
      getEngine()?.load(shaped(base), base.style, { anchorStep: boundary, loopOffset: boundary - baseAnchor }).catch((e) => setStatus(e.message, true));
      renderWhy({ ...base, kind: 'moves' });
      setStatus(statusLine(base));
    }
  }

  const statusLine = (d) => `${d.style.name} · ${d.tempo} BPM · ${d.score.key.name} · ${d.score.chords.map((c) => c.symbol).join(' → ')}${following() ? ` · moves: ${moves.level}${moves.lift === 'high' ? ', arms up' : ''}` : ''}`;

  function apply(d, anchorStep) {
    lastDecision = d;
    base = d; baseAnchor = anchorStep;
    getEngine()?.load(shaped(d), d.style, { anchorStep }).catch((e) => setStatus(e.message, true));
    if (d.ranking) renderStyleOptions(ui.style, d.ranking);
    renderWhy(d);
    setStatus(statusLine(d));
  }

  function renderWhy(d) {
    const auto = ui.style.value === 'auto';
    const top = (d.ranking ?? []).slice(0, 3).map((m) => `${escapeHtml(m.style.name)} ${Math.round(m.score * 100)}%`).join(' · ');
    ui.why.innerHTML = `
      <h3>What you hear</h3>
      <p><b>${escapeHtml(d.style.name)}</b> at <b>${d.tempo} BPM</b>, ${auto ? `chosen from what the camera saw when the music started (${top}). Press ↻ to choose again.` : 'picked by you.'}</p>
      <p>Key <b>${escapeHtml(d.score.key.name)}</b>: ${d.score.chords.map((c) => `<span class="chip" style="border-color:rgb(${c.color.r},${c.color.g},${c.color.b})">${escapeHtml(c.symbol)}</span>`).join(' ')}</p>
      <p class="muted">${escapeHtml(REASONS[d.kind] ?? '')}</p>
      ${following() ? `<p><b>Your moves now:</b> ${escapeHtml(LEVEL_TEXT[moves.level])}${moves.lift === 'high' ? ' Arms up: the melody is an octave higher.' : ''}${moves.view ? ` <span class="muted">(seeing: ${escapeHtml(moves.view)})</span>` : ''}</p>` : ''}
      <h3>How to play it</h3>
      <ul class="small">
        ${following() ? `
        <li><b>Dance</b>: bass and drums come in; dance harder for everything, louder. Small moves keep only chords and melody.</li>
        <li><b>Stand still</b> for two bars: the music holds on the chords.</li>
        <li><b>Raise your arms</b> or open your hands: the melody goes an octave higher.</li>
        <li>Only the upper body or just hands in the frame? That works too, fingers count.</li>
        <li>The level changes every two bars, so the music breathes like a song instead of twitching.</li>` : `
        <li><b>Show colours</b>: hold something colourful close to the camera. If it stays for about two bars, the key and chords change to match it.</li>
        <li><b>Change the frame</b> (turn the camera, step aside): the bright and striking spots are the points, so higher = higher notes (or higher drums).</li>
        <li>Everything changes on the first beat of a bar, so the music always stays in time.</li>`}
      </ul>`;
  }

  // ── Music on/off ──
  async function startMusic() {
    const engine = await ensureEngine();
    listen(engine);
    engine.stop();
    conductor.set({});                      // decide now, from the current picture
    const d = conductor.decide();
    base = d; baseAnchor = 0;
    await engine.load(shaped(d), d.style);
    apply(d, 0);
    lastBoundary = 0;
    musicOn = true;
    engine.play();
    ui.music.textContent = '■ Stop music';
    return engine;
  }

  ui.music.addEventListener('click', async () => {
    if (!conductor?.ready) { setStatus('Waiting for the first picture from the camera…'); return; }
    try {
      const engine = getEngine();
      if (musicOn && engine?.state === 'started') {
        if (recorder) { setStatus('The music is part of the recording: stop the recording first.'); return; }
        engine.stop(); musicOn = false; ui.music.textContent = '▶ Music'; return;
      }
      await startMusic();
    } catch (err) { setStatus(`Audio is unavailable: ${err.message}`, true); }
  });

  let listened = null;
  function listen(engine) {
    if (listened === engine) return;
    listened = engine;
    engine.addEventListener('note', (e) => { if (active) flashPoint.set(e.detail.pointIndex, performance.now()); });
    engine.addEventListener('state', (e) => {
      if (active && e.detail.state !== 'started' && musicOn) { musicOn = false; ui.music.textContent = '▶ Music'; }
      if (active && e.detail.state === 'started') ui.music.textContent = '■ Stop music';
    });
  }

  // ── Following the moves: body + hands, about 10 times a second ──
  async function trackLoop() {
    if (tracking) return;
    tracking = true;
    let prev = null, prevT = 0;
    try {
      while (active && following()) {
        const t0 = performance.now();
        if (video?.readyState >= 2) {
          const det = await trackFrame(video, t0);
          if (!active || !following()) break;
          const now = performance.now();
          const smp = movementSample(prev, det, prev ? Math.max(0.03, (now - prevT) / 1000) : 0.1);
          moves.push(smp);
          pose = det; poseAt = now; prev = det; prevT = now;
          ui.motion.value = Math.min(1, moves.speed / 1.2);
        }
        await new Promise((r) => setTimeout(r, Math.max(10, 90 - (performance.now() - t0))));
      }
    } catch (err) { console.warn(err); setStatus('Body tracking stopped working, so the music follows the picture again.', true); setFollows('picture'); }
    tracking = false;
  }

  function setFollows(mode) {
    for (const r of ui.follows) r.checked = r.value === mode;
    onFollows();
  }

  async function onFollows() {
    const on = following();
    ui.hint.textContent = HINTS[on ? 'moves' : 'picture'];
    ui.canvas.setAttribute('aria-label', on ? 'Camera picture with the body the app is following' : 'Camera picture with the points that play');
    moves.reset();
    if (on && trackersOk !== true) {
      setStatus('Loading body tracking (about 23 MB, only the first time; it runs in this tab)…');
      trackersOk = await loadTrackers();
      if (!trackersOk) { setStatus('Body tracking does not work in this browser, so the music follows the picture.', true); setFollows('picture'); return; }
      if (!active) return;
      setStatus(musicOn ? 'Following your moves from the next bars.' : 'Ready. Press ▶ Music and dance.');
    }
    if (on && active) trackLoop();
    if (!on) pose = null;
    conductor?.set({});                     // the next bar is rebuilt with the new choice
    if (lastDecision) renderWhy(lastDecision);
  }
  ui.follows.forEach((r) => r.addEventListener('change', onFollows));

  // ── Settings: applied on the next bar ──
  ui.style.addEventListener('input', () => conductor?.set({ styleId: ui.style.value === 'auto' ? null : ui.style.value }));
  ui.repick.addEventListener('click', () => { ui.style.value = 'auto'; conductor?.set({ styleId: null }); conductor?.repickStyle(); });
  ui.mood.addEventListener('input', () => conductor?.set({ mood: Number(ui.mood.value) }));
  ui.points.addEventListener('input', () => conductor?.set({ pointsAs: pointsChoice() }));
  ui.device.addEventListener('input', () => startCamera(ui.device.value).catch((e) => setStatus(cameraError(e), true)));

  // ── Take a photo ──
  ui.photo.addEventListener('click', async () => {
    if (!video || video.readyState < 2) return;
    ui.flash.classList.remove('go'); void ui.flash.offsetWidth; ui.flash.classList.add('go');
    // the photo is what the camera sees; if the preview is mirrored, so is the photo (like a selfie camera)
    const c = new OffscreenCanvas(video.videoWidth, video.videoHeight);
    const g = c.getContext('2d');
    if (ui.mirror.checked) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0);
    const bitmap = await createImageBitmap(c);
    const jpeg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    gallery.add({ kind: 'photo', blob: jpeg, thumb: await thumbnail(bitmap) });
    setTimeout(() => { close(); onPhoto(bitmap); }, 250);
  });

  // ── Record a video (with the live music, if it is playing) ──
  ui.record.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));

  async function startRecording() {
    if (!stream || typeof MediaRecorder === 'undefined') { setStatus('This browser cannot record video.', true); return; }
    // the music is recorded with the picture: start it if it is not playing yet
    let engine = getEngine();
    if (!musicOn || engine?.state !== 'started') {
      if (!conductor?.ready) { setStatus('Waiting for the first picture from the camera…'); return; }
      try { engine = await startMusic(); } catch (err) { setStatus(`Audio is unavailable: ${err.message}`, true); return; }
    }
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    recCanvas = Object.assign(document.createElement('canvas'), {
      width: Math.round((video.videoWidth * scale) / 2) * 2, height: Math.round((video.videoHeight * scale) / 2) * 2,
    });
    recCtx = recCanvas.getContext('2d', { alpha: false });
    drawRecordingFrame();
    const tracks = [...recCanvas.captureStream(30).getVideoTracks()];
    const music = engine?.outputStream();
    const used = settings();
    if (music) tracks.push(...music.getAudioTracks());
    const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const parts = [];
    const thumb = await thumbnail(video);
    recorder = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type, videoBitsPerSecond: 5e6, audioBitsPerSecond: 192_000 } : {});
    recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
    recorder.onstop = () => {
      const mime = recorder.mimeType || type || 'video/webm';
      const blob = new Blob(parts, { type: mime.split(';')[0] });
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const seconds = (performance.now() - recStart) / 1000;
      // kept in "This session" right away, so nothing is lost when you switch to something else
      const item = gallery.add({ kind: 'video', blob, thumb, seconds, withMusic: !!music, ext, settings: used });
      recorded = { blob, ext, withMusic: !!music, item, settings: used };
      recorder = null;
      recCanvas = null; recCtx = null;
      showResult();
    };
    recorder.start(1000);
    recStart = performance.now();
    ui.record.textContent = '■ Stop recording';
    ui.record.classList.add('recording');
    ui.badge.hidden = false;
    recTimer = setInterval(() => {
      const s = (performance.now() - recStart) / 1000;
      ui.badge.textContent = `● REC ${fmt(s)}`;
      if (s >= MAX_RECORD_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    clearInterval(recTimer);
    ui.badge.hidden = true;
    ui.record.textContent = '● Record video with music';
    ui.record.classList.remove('recording');
    if (recorder?.state === 'recording') recorder.stop();
  }

  function showResult() {
    if (ui.resultVideo.src) URL.revokeObjectURL(ui.resultVideo.src);
    ui.resultVideo.src = URL.createObjectURL(recorded.blob);
    ui.result.hidden = false;
    ui.save.textContent = recorded.withMusic ? '⬇ Save video (picture + music)' : '⬇ Save video';
    const how = recorded.settings.follows === 'moves' ? ' The music in it followed your moves.' : '';
    setStatus(`Recorded ${(recorded.blob.size / 1048576).toFixed(1)} MB.${how} It is also kept under “This session”, so you can come back to it.`);
  }
  const newSoundtrack = (follow) => {
    if (!recorded) return;
    const file = new File([recorded.blob], `camera.${recorded.ext}`, { type: recorded.blob.type });
    ui.resultVideo.pause();
    close();
    // the soundtrack starts with the style and mood you chose; the live music in the file is left out
    onVideo(file, { ...recorded.settings, fromCamera: true, follow });
  };
  ui.score.addEventListener('click', () => newSoundtrack(false));
  ui.follow.addEventListener('click', () => newSoundtrack(true));
  ui.save.addEventListener('click', () => {
    if (!recorded) return;
    download(recorded.blob, gallery.fileName(recorded.item));
    gallery.markSaved(recorded.item);
  });
  ui.discard.addEventListener('click', () => { recorded = null; ui.result.hidden = true; URL.revokeObjectURL(ui.resultVideo.src); ui.resultVideo.removeAttribute('src'); });

  function cameraError(err) {
    if (err.name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera in the address bar and press “Use camera” again.';
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'No camera was found.';
    if (err.name === 'NotReadableError') return 'The camera is busy in another app. Close it there and try again.';
    return err.message;
  }

  // ── Open / close ──
  async function open() {
    onOpen();
    active = true;
    getEngine()?.stop({ hard: true });
    ui.stage.hidden = false;
    ui.result.hidden = true;
    ui.style.value = 'auto'; ui.points.value = 'default'; ui.mood.value = '0';
    ui.music.textContent = '▶ Music';
    musicOn = false; lastDecision = null; lastBoundary = -1; motionPts = null; flashPoint = new Map();
    base = null; pose = null; moves.reset();
    ui.hint.textContent = HINTS[following() ? 'moves' : 'picture'];
    ui.why.innerHTML = '<h3>What you hear</h3><p class="muted">Choose what the music follows (the picture or your moves), then press ▶ Music. The camera picture never leaves this browser tab.</p>';
    conductor = new LiveConductor({ getStyle, mood: 0 });
    setStatus('Starting the camera…');
    try {
      await startCamera();
      if (!active) { stopTracks(); return; }
      setStatus('Looking…');
      clearInterval(ticker);
      ticker = setInterval(analyse, 250);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      if (following()) onFollows();
      ui.stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      setStatus(cameraError(err), true);
    }
  }

  function close() {
    ui.resultVideo.pause();
    if (!active) return;
    active = false;
    if (recorder) stopRecording();
    clearInterval(ticker); cancelAnimationFrame(raf);
    if (musicOn) getEngine()?.stop({ hard: true });
    musicOn = false;
    stopTracks();
    video?.remove(); video = null;
    ui.stage.hidden = true;
  }

  return { open, close, get active() { return active; } };
}
