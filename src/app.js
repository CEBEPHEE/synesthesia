/**
 * Orchestrator: frame source → analysis → style choice → score → arrangement
 * → sound + UI. Contains no vision algorithms and no music theory itself.
 */
import { VisionAnalyzer } from './vision/vision-client.js';
import { loadImageFile } from './vision/frame-source.js';
import { STYLES, classifyStyle, getStyle } from './core/styles.js';
import { buildMusicalScore } from './core/mapping.js';
import { arrange } from './core/arranger.js';
import { buildExplanation } from './core/explain.js';
import { SAMPLE_CREDITS } from './audio/sample-library.js';
import { initExportMenu } from './ui/export-menu.js';
import { initEditor } from './ui/editor.js';
import { CanvasRenderer } from './ui/canvas-renderer.js';
import { initVideoStage } from './ui/video-stage.js';
import { initCameraStage } from './ui/camera-stage.js';
import {
  renderWhyPanel, renderNumbersPanel, renderChordStrip, renderVoiceGraph,
  setActiveChord, renderStyleLibrary, fillStyleSelect, renderStyleOptions,
} from './ui/panels.js';

const $ = (id) => document.getElementById(id);
const ui = {
  zone: $('upload-zone'), input: $('file-input'), demo: $('demo-btn'),
  stage: $('stage'), canvas: $('canvas'), status: $('status'),
  why: $('why-panel'), numbers: $('numbers-panel'), tabWhy: $('tab-why'), tabNumbers: $('tab-numbers'),
  strip: $('chord-strip'), graph: $('voice-graph'),
  play: $('play-btn'), stop: $('stop-btn'), styleSelect: $('style-select'),
  reverb: $('reverb'), tempo: $('tempo'), tempoOut: $('tempo-out'), points: $('points-select'), mood: $('mood'), edit: $('edit-btn'),
  howBtn: $('how-btn'), howDialog: $('how-dialog'), library: $('style-library'),
};

const analyzer = new VisionAnalyzer({ maxSide: 192 });
const renderer = new CanvasRenderer(ui.canvas);
const state = {
  analysis: null, classification: null, style: null, score: null, arrangement: null,
  engine: null, enginePromise: null, lastVoicing: null, entryVoicing: null, reverbTouched: false, sourceTicket: 0,
  image: null,
  edits: { keypoints: null, chordOverrides: {} },   // Edit mode changes for the current photo
};

/** The analysis with the user's point edits applied. */
const editedAnalysis = () => (state.edits.keypoints ? { ...state.analysis, keypoints: state.edits.keypoints, edited: true } : state.analysis);

const editor = initEditor({
  el: {
    toggle: ui.edit, panel: $('edit-panel'), palette: $('palette-bar'), tips: $('edit-tips'),
    meter: $('harmony-meter'), meterValue: $('harmony-value'), verdict: $('harmony-verdict'),
    reset: $('reset-edits'), done: $('edit-done'), strip: ui.strip,
  },
  renderer,
  getContext: () => ({ analysis: editedAnalysis(), score: state.score, style: state.style, image: state.image }),
  get edits() { return state.edits; },
  onChange: ({ live }) => recompose({ live }).catch((err) => setStatus(err.message, true)),
});

fillStyleSelect(ui.styleSelect, STYLES);
for (const c of [...SAMPLE_CREDITS, 'Tone.js by Yotam Mann and contributors (MIT)', 'mp4-muxer by Vanilagy (MIT)']) {
  document.getElementById('credits').append(Object.assign(document.createElement('li'), { textContent: c }));
}
renderStyleLibrary(ui.library, STYLES);

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('error', isError);
}

const statusLine = () => `${state.style.name} · ${state.score.key.name} · ${state.score.chords.map((c) => c.symbol).join(' → ')}`;

/**
 * Style choice → score → arrangement → panels (and the engine, if running).
 * live: a quick update while a point is being dragged (keeps the tempo slider, skips heavy panels).
 */
async function recompose({ live = false } = {}) {
  const analysis = editedAnalysis();
  const classification = state.classification && live ? state.classification : classifyStyle(analysis.features);
  const auto = ui.styleSelect.value === 'auto';
  const style = auto ? classification.best.style : getStyle(ui.styleSelect.value);
  // prevVoicing: a new photo starts from the chord closest to what was sounding before it
  const score = buildMusicalScore(analysis, {
    style, prevVoicing: state.entryVoicing, mood: Number(ui.mood.value), chordOverrides: state.edits.chordOverrides,
  });
  const pointsChoice = ui.points.value === 'default' ? undefined : ui.points.value;
  const arrangement = arrange(score, style, { pointsAs: pointsChoice });
  Object.assign(state, { classification, style, score, arrangement, lastVoicing: score.chords.at(-1).voicing });

  if (!live) renderStyleOptions(ui.styleSelect, classification.ranking);
  const voices = new Map();
  for (const e of arrangement.tracks.pointDrums) {
    const list = voices.get(e.pointIndex) ?? [];
    const name = e.voice === 'tom' ? 'tom' : e.voice;
    if (!list.includes(name)) list.push(name);
    voices.set(e.pointIndex, list);
  }
  renderer.setAnalysis(analysis, score, {
    mode: arrangement.pointsAs,
    // main hit first, cymbal accent second: "snare + ride"
    voices: new Map([...voices].map(([k, v]) => [k, v.sort((a, b) => /crash|ride/.test(a) - /crash|ride/.test(b)).join(' + ')])),
  });
  ui.points.options[0].text = `Style default (${style.points === 'drums' ? 'drums' : 'melody'})`;
  renderChordStrip(ui.strip, score);
  renderVoiceGraph(ui.graph, score);
  editor.refresh();
  if (!live) {
    renderWhyPanel(ui.why, buildExplanation({ analysis, classification, style, auto, score, pointsAs: arrangement.pointsAs }));
    renderNumbersPanel(ui.numbers, analysis, score);
    renderStyleLibrary(ui.library, STYLES, classification.ranking);
    if (!state.tempoTouched) { ui.tempo.value = score.tempo; ui.tempoOut.textContent = score.tempo; }
    if (!state.reverbTouched) ui.reverb.value = style.fx.reverb[1];
  }
  ui.play.disabled = false; ui.stop.disabled = false; ui.edit.disabled = false; exportMenu.setEnabled(true);
  setStatus(statusLine());

  if (state.engine) {
    await state.engine.load({ ...arrangement, tempo: Number(ui.tempo.value) }, style);
  }
}

async function processSource(image) {
  const ticket = ++state.sourceTicket;        // ignore results of photos that were replaced meanwhile
  film.close();
  camera.close();
  ui.stage.hidden = false;
  // A new photo is a new piece: stop the music (Play starts it from the top)
  // and go back to the automatic style recommendation.
  state.engine?.stop({ hard: true });
  setActiveChord(ui.strip, ui.graph, -1);
  ui.styleSelect.value = 'auto';
  ui.points.value = 'default';
  ui.mood.value = '0';
  state.edits = { keypoints: null, chordOverrides: {} };
  state.tempoTouched = false;
  state.entryVoicing = state.lastVoicing;
  state.image = image;
  editor.close();
  renderer.setImage(image);
  setStatus('Reading colours and shapes…');
  try {
    const analysis = await analyzer.analyze(image, { colors: 6, maxPoints: 7 });
    if (ticket !== state.sourceTicket) return;
    state.analysis = analysis;
    await recompose();
  } catch (err) {
    console.error(err);
    setStatus(`Could not process this image: ${err.message}`, true);
  }
}

async function handleFile(file) {
  try {
    await processSource(await loadImageFile(file));
  } catch (err) {
    ui.stage.hidden = false;
    setStatus(err.message, true);
  }
}

// ── Film mode: several photos → slideshow, a video → scored video ──
const film = initVideoStage({
  analyzer,
  ensureEngine: () => ensureEngine(),
  getEngine: () => state.engine,
  onOpen: () => {
    camera.close();
    leavePhotoMode();
  },
});

function leavePhotoMode() {
  state.sourceTicket++;
  editor.close();
  ui.stage.hidden = true;
  state.analysis = null; state.score = null; state.arrangement = null;
}

// ── Camera mode: live music, take a photo, record a video ──
const camera = initCameraStage({
  analyzer,
  ensureEngine: () => ensureEngine(),
  getEngine: () => state.engine,
  onOpen: () => { film.close(); leavePhotoMode(); },
  onPhoto: async (bitmap) => { await processSource(bitmap); setStatus(`${statusLine()} · Save the photo: ⬇ Export → Photo`); },
  onVideo: (file) => film.openVideo(file),
});
$('camera-btn').addEventListener('click', (e) => { e.stopPropagation(); camera.open(); });
$('cam-close').addEventListener('click', () => camera.close());

/** One photo → photo mode; several photos → slideshow; a video → video mode. */
function handleFiles(list) {
  const files = [...list];
  const video = files.find((f) => f.type.startsWith('video/'));
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (video) film.openVideo(video);
  else if (images.length > 1) film.openSlides(images);
  else if (images.length === 1) handleFile(images[0]);
  else if (files.length) { ui.stage.hidden = false; setStatus('That file is not a photo or a video.', true); }
}

/** The audio engine (and Tone.js) is loaded lazily, on the first Play. */
async function ensureEngine() {
  if (state.engine) return state.engine;
  // Clicking Play twice while Tone.js is still loading must not create two engines
  state.enginePromise ??= createEngine().catch((err) => { state.enginePromise = null; throw err; });
  return state.enginePromise;
}

async function createEngine() {
  setStatus('Starting audio…');
  const { AudioEngine } = await import('./audio/audio-engine.js');
  const engine = new AudioEngine();
  await engine.init();
  engine.addEventListener('chord', (e) => setActiveChord(ui.strip, ui.graph, e.detail.index));
  engine.addEventListener('note', (e) => renderer.setActivePoint(e.detail.pointIndex));
  engine.addEventListener('loading', (e) => { if (state.score) setStatus(`Loading the ${e.detail.style} instruments…`); });
  engine.addEventListener('loaded', () => { if (state.score) setStatus(statusLine()); });
  engine.addEventListener('state', (e) => {
    const playing = e.detail.state === 'started';
    ui.play.textContent = playing ? '❚❚ Pause' : '▶ Play';
    ui.play.setAttribute('aria-pressed', String(playing));
    if (!playing) renderer.setActivePoint(-1);
  });
  if (state.reverbTouched) engine.setReverb(Number(ui.reverb.value));
  if (state.arrangement && !film.active) await engine.load(state.arrangement, state.style);
  state.engine = engine;
  return engine;
}

// Only one tab plays at a time: starting playback here pauses the app in any other open tab.
const tabs = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('synesthesia-playback') : null;
const tabId = Math.random().toString(36).slice(2);
tabs?.addEventListener('message', (e) => {
  if (e.data?.type === 'playing' && e.data.tabId !== tabId && state.engine?.state === 'started') {
    state.engine.pause();
    setStatus('Paused: the music started playing in another tab.');
  }
});

ui.play.addEventListener('click', async () => {
  if (!state.score) return;
  try {
    const engine = await ensureEngine();
    if (engine.state === 'started') engine.pause();
    else { engine.play(); tabs?.postMessage({ type: 'playing', tabId }); }
    setStatus(statusLine());
  } catch (err) {
    console.error(err);
    setStatus(`Audio is unavailable: ${err.message}`, true);
  }
});
// ── Export: WAV / MIDI / stems (rendered in the browser, nothing is uploaded) ──
const exportMenu = initExportMenu({
  root: document.getElementById('export-menu'),
  getJob: () => (state.arrangement ? {
    arrangement: state.arrangement, style: state.style, score: state.score,
    tempo: Number(ui.tempo.value), reverb: state.reverbTouched ? Number(ui.reverb.value) : null,
    image: state.image, analysis: editedAnalysis(), pointsAs: state.arrangement.pointsAs,
  } : null),
  setStatus,
  // the offline render briefly takes over the audio clock, so live playback pauses meanwhile
  withPausedPlayback: async (fn) => {
    const wasPlaying = state.engine?.state === 'started';
    if (wasPlaying) state.engine.pause();
    try { await fn(); } finally { if (wasPlaying) state.engine.play(); }
  },
});

ui.stop.addEventListener('click', () => {
  state.engine?.stop();
  setActiveChord(ui.strip, ui.graph, -1);
});
ui.styleSelect.addEventListener('change', () => {
  if (state.analysis) recompose().catch((err) => setStatus(err.message, true));
});
ui.reverb.addEventListener('input', () => {
  state.reverbTouched = true;
  state.engine?.setReverb(Number(ui.reverb.value));
});
ui.mood.addEventListener('input', () => {
  if (state.analysis) recompose().catch((err) => setStatus(err.message, true));
});
ui.tempo.addEventListener('input', () => {
  state.tempoTouched = true;
  ui.tempoOut.textContent = ui.tempo.value;
  state.engine?.setTempo(Number(ui.tempo.value));
});
ui.points.addEventListener('change', () => {
  if (state.analysis) recompose().catch((err) => setStatus(err.message, true));
});

// ── Tabs ──
function selectTab(which) {
  const why = which === 'why';
  ui.tabWhy.setAttribute('aria-selected', String(why));
  ui.tabNumbers.setAttribute('aria-selected', String(!why));
  ui.why.hidden = !why; ui.numbers.hidden = why;
}
ui.tabWhy.addEventListener('click', () => selectTab('why'));
ui.tabNumbers.addEventListener('click', () => selectTab('numbers'));

// ── "How it works" dialog ──
ui.howBtn.addEventListener('click', () => ui.howDialog.showModal());
ui.howDialog.addEventListener('click', (e) => { if (e.target === ui.howDialog) ui.howDialog.close(); });

// ── Upload zone: click, keyboard, drag-and-drop, paste ──
ui.zone.addEventListener('click', (e) => { if (!e.target.closest('button')) ui.input.click(); });
ui.zone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.input.click(); }
});
ui.input.addEventListener('change', () => { handleFiles(ui.input.files); ui.input.value = ''; });
['dragenter', 'dragover'].forEach((t) => ui.zone.addEventListener(t, (e) => { e.preventDefault(); ui.zone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => ui.zone.addEventListener(t, (e) => { e.preventDefault(); ui.zone.classList.remove('drag'); }));
ui.zone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) handleFile(f);
});

// ── Demo image: a synthetic "painting", so the app can be tried without a photo ──
ui.demo.addEventListener('click', async () => {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 600;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, '#1d3b6e'); sky.addColorStop(0.6, '#e98a5b'); sky.addColorStop(1, '#f3c77a');
  g.fillStyle = sky; g.fillRect(0, 0, 960, 600);
  const blobs = [[180, 380, 70, '#2f6b4f'], [420, 210, 46, '#f6e27f'], [640, 420, 90, '#7a3b6e'], [820, 160, 38, '#e9f1f7']];
  for (const [x, y, r, col] of blobs) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  await processSource(await createImageBitmap(c));
});
