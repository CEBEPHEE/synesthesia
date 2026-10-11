/**
 * Camera mode: live music from the webcam, plus "take a photo" and "record a video"
 * right in the app.
 *
 *   camera ─► every 250 ms: colours + points (worker) and motion (here)
 *          ─► LiveConductor.feed()          (smoothing, no decisions)
 *   transport, one beat before each bar ─► LiveConductor.decide() ─► engine.load(…, anchored on the bar)
 *
 * So the music only ever changes on the first beat of a bar and always stays in time.
 * The camera picture never leaves the browser.
 */
import { STYLES, getStyle } from '../core/styles.js';
import { LiveConductor } from '../core/live.js';
import { detectMotion, toLuma } from '../vision/motion.js';
import { fillStyleSelect, renderStyleOptions, escapeHtml } from './panels.js';
import { download } from './export-menu.js';

const MAX_RECORD_SECONDS = 180;
const MW = 48, MH = 36;                    // motion grid frame
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const REASONS = {
  start: 'Music started from what the camera sees.',
  restyle: 'Your new setting took effect on this bar.',
  harmony: 'The colours in the picture changed and stayed that way for two bars, so the key and chords moved on.',
  melody: 'The points moved, so the melody follows them (the chords stay).',
};

/**
 * @param {{analyzer, ensureEngine, getEngine, onOpen, onPhoto: (ImageBitmap) => void, onVideo: (File) => void}} deps
 */
export function initCameraStage({ analyzer, ensureEngine, getEngine, onOpen, onPhoto, onVideo }) {
  const $ = (id) => document.getElementById(id);
  const ui = {
    stage: $('camera-stage'), canvas: $('cam-canvas'), status: $('cam-status'), flash: $('cam-flash'), badge: $('cam-rec-badge'),
    music: $('cam-music'), photo: $('cam-photo'), record: $('cam-record'), close: $('cam-close'),
    style: $('cam-style'), repick: $('cam-repick'), mood: $('cam-mood'), points: $('cam-points'),
    device: $('cam-device'), deviceWrap: $('cam-device-wrap'), mirror: $('cam-mirror'), motion: $('cam-motion'),
    result: $('cam-result'), resultVideo: $('cam-result-video'), score: $('cam-score'), save: $('cam-save'), discard: $('cam-discard'),
    why: $('cam-why'),
  };
  fillStyleSelect(ui.style, STYLES);
  const ctx = ui.canvas.getContext('2d');
  const small = new OffscreenCanvas(MW, MH);
  const smallCtx = small.getContext('2d', { willReadFrequently: true });

  let stream = null, video = null, conductor = null, ticker = 0, raf = 0, prevLuma = null;
  let motionPts = null, motionUntil = 0, motionLevel = 0, lastBoundary = -1, musicOn = false;
  let recorder = null, recStart = 0, recTimer = 0, recorded = null, active = false;
  let flashPoint = new Map(), lastDecision = null;

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
      ui.motion.value = Math.min(1, motionLevel * 6);
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
      const moving = motionPts && now < motionUntil;
      conductor.feed({ ...analysis, keypoints: moving ? motionPts : analysis.keypoints, motion: moving });
      if (!musicOn && !lastDecision) setStatus('Ready. Press ▶ Music, then move or show colourful things to the camera.');
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
    ctx.restore();
    const pts = lastDecision?.score ? (conductor.committed?.analysis.keypoints ?? []) : (conductor.latest?.keypoints ?? []);
    const now = performance.now();
    pts.forEach((p, i) => {
      const x = (mirror ? 1 - p.x : p.x) * W, y = p.y * H;
      const glow = Math.exp(-(now - (flashPoint.get(i) ?? -1e9)) / 250);
      ctx.beginPath(); ctx.arc(x, y, 7 + 10 * glow, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,102,${0.45 + 0.55 * glow})`; ctx.lineWidth = 3; ctx.stroke();
    });
    barClock();
  }

  function barClock() {
    const engine = getEngine();
    if (!musicOn || !engine || engine.state !== 'started') return;
    const s = engine.step;
    const boundary = Math.ceil((s + 0.01) / 16) * 16;
    if (boundary - s > 2 || boundary === lastBoundary) return;    // decide one beat-ish before each bar
    lastBoundary = boundary;
    const d = conductor.decide();
    if (d) apply(d, boundary);
  }

  function apply(d, anchorStep) {
    lastDecision = d;
    getEngine()?.load(d.arrangement, d.style, { anchorStep }).catch((e) => setStatus(e.message, true));
    if (d.ranking) renderStyleOptions(ui.style, d.ranking);
    renderWhy(d);
    setStatus(`${d.style.name} · ${d.tempo} BPM · ${d.score.key.name} · ${d.score.chords.map((c) => c.symbol).join(' → ')}`);
  }

  function renderWhy(d) {
    const auto = ui.style.value === 'auto';
    const top = (d.ranking ?? []).slice(0, 3).map((m) => `${escapeHtml(m.style.name)} ${Math.round(m.score * 100)}%`).join(' · ');
    ui.why.innerHTML = `
      <h3>What you hear</h3>
      <p><b>${escapeHtml(d.style.name)}</b> at <b>${d.tempo} BPM</b>, ${auto ? `chosen from what the camera saw when the music started (${top}). Press ↻ to choose again.` : 'picked by you.'}</p>
      <p>Key <b>${escapeHtml(d.score.key.name)}</b>: ${d.score.chords.map((c) => `<span class="chip" style="border-color:rgb(${c.color.r},${c.color.g},${c.color.b})">${escapeHtml(c.symbol)}</span>`).join(' ')}</p>
      <p class="muted">${escapeHtml(REASONS[d.kind] ?? '')}</p>
      <h3>How to play it</h3>
      <ul class="small">
        <li><b>Move</b> a hand: the moving spots become the points, so higher = higher notes (or higher drums).</li>
        <li><b>Show colours</b>: hold something colourful close to the camera. If it stays for about two bars, the key and chords change to match it.</li>
        <li>Everything changes on the first beat of a bar, so the music always stays in time.</li>
      </ul>`;
  }

  // ── Music on/off ──
  ui.music.addEventListener('click', async () => {
    if (!conductor?.ready) { setStatus('Waiting for the first picture from the camera…'); return; }
    try {
      const engine = await ensureEngine();
      listen(engine);
      if (musicOn && engine.state === 'started') {
        engine.stop(); musicOn = false; ui.music.textContent = '▶ Music'; return;
      }
      engine.stop();
      conductor.set({});                      // decide now, from the current picture
      const d = conductor.decide();
      await engine.load(d.arrangement, d.style);
      apply(d, 0);
      lastBoundary = 0;
      musicOn = true;
      engine.play();
      ui.music.textContent = '■ Music';
    } catch (err) { setStatus(`Audio is unavailable: ${err.message}`, true); }
  });

  let listened = null;
  function listen(engine) {
    if (listened === engine) return;
    listened = engine;
    engine.addEventListener('note', (e) => { if (active) flashPoint.set(e.detail.pointIndex, performance.now()); });
    engine.addEventListener('state', (e) => {
      if (active && e.detail.state !== 'started' && musicOn) { musicOn = false; ui.music.textContent = '▶ Music'; }
    });
  }

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
    setTimeout(() => { close(); onPhoto(bitmap); }, 250);
  });

  // ── Record a video (with the live music, if it is playing) ──
  ui.record.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));

  function startRecording() {
    if (!stream || typeof MediaRecorder === 'undefined') { setStatus('This browser cannot record video.', true); return; }
    const tracks = [...stream.getVideoTracks()];
    const music = musicOn ? getEngine()?.outputStream() : null;
    if (music) tracks.push(...music.getAudioTracks());
    const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const parts = [];
    recorder = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type, videoBitsPerSecond: 5e6 } : {});
    recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
    recorder.onstop = () => {
      const mime = recorder.mimeType || type || 'video/webm';
      recorded = { blob: new Blob(parts, { type: mime.split(';')[0] }), ext: mime.includes('mp4') ? 'mp4' : 'webm', withMusic: !!music };
      recorder = null;
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
    ui.record.textContent = '● Record video';
    ui.record.classList.remove('recording');
    if (recorder?.state === 'recording') recorder.stop();
  }

  function showResult() {
    if (ui.resultVideo.src) URL.revokeObjectURL(ui.resultVideo.src);
    ui.resultVideo.src = URL.createObjectURL(recorded.blob);
    ui.result.hidden = false;
    ui.save.textContent = recorded.withMusic ? '⬇ Save with the live music' : '⬇ Save the recording';
    setStatus(`Recorded ${(recorded.blob.size / 1048576).toFixed(1)} MB.`);
  }
  ui.score.addEventListener('click', () => {
    if (!recorded) return;
    const file = new File([recorded.blob], `camera.${recorded.ext}`, { type: recorded.blob.type });
    close();
    onVideo(file);
  });
  ui.save.addEventListener('click', () => recorded && download(recorded.blob, `synesthesia-camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${recorded.ext}`));
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
    ui.why.innerHTML = '<h3>What you hear</h3><p class="muted">Press ▶ Music to start. The camera picture never leaves this browser tab.</p>';
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
      ui.stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      setStatus(cameraError(err), true);
    }
  }

  function close() {
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
