/**
 * Instruments and drum kits.
 *
 * Acoustic and electric instruments are played from REAL RECORDINGS (Tone.Sampler,
 * see assets/samples and sample-library.js): grand piano, electric/acoustic/nylon
 * guitars, electric bass, contrabass, cello + violin, flute, saxophone, French horn,
 * harp, xylophone, and recorded drum kits. Synthesizers are kept only where the
 * genre itself is synthetic: synthwave leads and pads, house and synth bass, 808.
 *
 * Every factory is async (samples are fetched once, decoded, and cached for the
 * whole session) and resolves to { output, play(time, event, secondsPerStep),
 * release(), dispose() }.
 */
import { INSTRUMENT_SAMPLES, DRUM_SAMPLES } from './sample-library.js';
import { SAMPLE_PACKS } from './sample-packs.js';

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

const BASE_URL = new URL('../../assets/samples/', import.meta.url).href;

// ─── Sample loading (shared across rigs, so switching styles is instant) ────
// Recordings come in packs (one file per instrument, see sample-packs.js).
// A pack is downloaded once; each recording is cut out of it and decoded.

const packCache = new Map();            // pack key → Promise<ArrayBuffer>
const bufferCache = new Map();          // path → Promise<AudioBuffer>

function loadPack(key) {
  if (!packCache.has(key)) {
    const pack = SAMPLE_PACKS[key];
    if (!pack) return Promise.reject(new Error(`Unknown sample pack "${key}"`));
    const url = BASE_URL + pack.file;
    const p = fetch(url).then((r) => {
      if (!r.ok) {
        throw new Error(`The instrument recordings were not found on the server (${r.status} for assets/samples/${pack.file}). `
          + 'Upload the whole "assets" folder next to index.html.');
      }
      return r.arrayBuffer();
    });
    p.catch(() => packCache.delete(key));     // allow a retry after a failed load
    packCache.set(key, p);
  }
  return packCache.get(key);
}

/** path: "piano/A1.mp3" or "drums/acoustic/kick.mp3" → AudioBuffer (decoded once per session). */
function loadBuffer(Tone, path) {
  if (!bufferCache.has(path)) {
    const cut = path.lastIndexOf('/');
    const key = path.slice(0, cut), file = path.slice(cut + 1);
    const p = loadPack(key).then(async (data) => {
      const entry = SAMPLE_PACKS[key].entries[file];
      if (!entry) throw new Error(`Missing recording ${path}`);
      const bytes = data.slice(entry[0], entry[0] + entry[1]);       // decodeAudioData takes ownership, so copy
      const audio = await Tone.getContext().decodeAudioData(bytes);
      return audio;
    });
    p.catch(() => bufferCache.delete(path));
    bufferCache.set(path, p);
  }
  return bufferCache.get(path);
}

/** { 'C4': AudioBuffer, … } for a sampled instrument (or a merged set). */
async function noteBuffers(Tone, ids) {
  const entries = [];
  for (const id of [].concat(ids)) {
    for (const [note, file] of Object.entries(INSTRUMENT_SAMPLES[id].notes)) entries.push([note, `${id}/${file}`]);
  }
  const loaded = await Promise.all(entries.map(([note, path]) => loadBuffer(Tone, path).then((b) => [note, b])));
  return Object.fromEntries(loaded);
}

async function makeSampler(Tone, ids, { volume = -8, attack = 0, release = 0.6, curve = 'exponential' } = {}) {
  return new Tone.Sampler({ urls: await noteBuffers(Tone, ids), attack, release, curve, volume });
}

/** Number of samples a set of instruments needs (for progress / tests). */
export function sampleCount(ids) {
  return [].concat(ids).reduce((n, id) => n + Object.keys(INSTRUMENT_SAMPLES[id].notes).length, 0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function wrap(nodes, output, play, voice = nodes[0]) {
  const release = () => (voice.releaseAll ? voice.releaseAll() : voice.triggerRelease?.());
  return { output, play, release, dispose: () => nodes.forEach((n) => n.dispose()) };
}

const playNotes = (inst, { minDur = 0.05, maxDur = Infinity } = {}) => (time, ev, sps) => {
  const freqs = ev.notes.map(midiToHz);
  const dur = Math.min(maxDur, Math.max(minDur, ev.dur * sps));
  inst.triggerAttackRelease(freqs.length === 1 ? freqs[0] : freqs, dur, time, ev.vel);
};

/** Sampler → optional chain of effects. */
async function sampled(Tone, ids, opts = {}, chain = () => [], playOpts) {
  const s = await makeSampler(Tone, ids, opts);
  const fx = chain(Tone);
  if (fx.length) s.chain(...fx);
  const out = fx.length ? fx[fx.length - 1] : s;
  return wrap([s, ...fx], out, playNotes(s, playOpts), s);
}

const lowpass = (frequency, Q = 0.7) => (Tone) => [new Tone.Filter({ frequency, type: 'lowpass', Q })];
/** A touch of high-end "presence" so the piano is clear rather than muffled. */
const presence = (Tone) => [new Tone.EQ3({ low: 0, mid: 0, high: 4, highFrequency: 2800 })];

// ─── Electric guitar amp (driven real guitar recordings) ───────────────────
//
// Real distorted guitar = a real guitar signal pushed through an amp: tighten the
// lows, drive (oversampled to avoid digital fizz), then a "cabinet" EQ.
// Two takes are panned left/right with a small timing offset: double tracking.

function ampChain(Tone, { drive, cab, pan }) {
  const nodes = [new Tone.Filter({ frequency: 100, type: 'highpass' })];
  if (drive > 0) nodes.push(new Tone.Distortion({ distortion: drive, oversample: '4x' }));
  nodes.push(
    new Tone.EQ3({ low: -2, mid: drive > 0.6 ? 4 : 2, high: drive > 0.6 ? -6 : -2, lowFrequency: 280, highFrequency: 2800 }),
    new Tone.Filter({ frequency: cab, type: 'lowpass', rolloff: -24 }),
    new Tone.Panner(pan),
  );
  return nodes;
}

async function guitarRig(Tone, { drive, cab, volume, double = true }) {
  const sides = [];
  for (const [pan, delay] of double ? [[-0.7, 0], [0.7, 0.016]] : [[0, 0]]) {
    const open = await makeSampler(Tone, 'electric-guitar', { volume, release: 0.4 });
    const muted = await makeSampler(Tone, 'electric-guitar', { volume: volume - 1, release: 0.05 });
    const mutedTone = new Tone.Filter({ frequency: 1500, type: 'lowpass' });
    const chain = ampChain(Tone, { drive, cab, pan });
    muted.connect(mutedTone); mutedTone.connect(chain[0]); open.connect(chain[0]);
    chain.reduce((a, b) => (a.connect(b), b));
    sides.push({ open, muted, delay, out: chain[chain.length - 1], nodes: [open, muted, mutedTone, ...chain] });
  }
  const out = new Tone.Gain(1);
  sides.forEach((s) => s.out.connect(out));
  return {
    output: out,
    play(time, ev, sps) {
      const freqs = ev.notes.map(midiToHz);
      const dur = ev.muted ? Math.min(0.14, ev.dur * sps) : Math.max(0.08, ev.dur * sps);
      for (const s of sides) (ev.muted ? s.muted : s.open).triggerAttackRelease(freqs, dur, time + s.delay, ev.vel);
    },
    release() { sides.forEach((s) => { s.open.releaseAll(); s.muted.releaseAll(); }); },
    dispose() { out.dispose(); sides.forEach((s) => s.nodes.forEach((n) => n.dispose())); },
  };
}

// ─── Synths (only for genres that are synthetic by nature) ─────────────────

const fat = (Tone, count, spread, envelope, volume) =>
  new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count, spread }, envelope, volume });

function synthWithFilter(Tone, synth, frequency) {
  const f = new Tone.Filter({ frequency, type: 'lowpass', rolloff: -24 });
  synth.connect(f);
  return wrap([synth, f], f, playNotes(synth), synth);
}

// ─── Chord instruments ──────────────────────────────────────────────────────

export const CHORD_INSTRUMENTS = {
  piano: (Tone) => sampled(Tone, 'piano', { volume: -9, release: 1.2 }, presence),
  strings: (Tone) => sampled(Tone, ['cello', 'violin'], { volume: -13, attack: 0.25, release: 2.2 }, lowpass(6000)),
  acousticGuitar: (Tone) => sampled(Tone, 'acoustic-guitar', { volume: -8, release: 0.9 }),
  nylonGuitar: (Tone) => sampled(Tone, 'nylon-guitar', { volume: -7, release: 0.8 }),
  harp: (Tone) => sampled(Tone, 'harp', { volume: -9, release: 1.5 }),
  cleanGuitar: (Tone) => guitarRig(Tone, { drive: 0, cab: 7000, volume: -10, double: true }),
  crunchGuitar: (Tone) => guitarRig(Tone, { drive: 0.4, cab: 5200, volume: -17 }),
  rockGuitar: (Tone) => guitarRig(Tone, { drive: 0.85, cab: 4200, volume: -22 }),
  fuzzGuitar: (Tone) => guitarRig(Tone, { drive: 0.65, cab: 3200, volume: -20 }),
  // synthetic on purpose
  // electronic: a short, bright pluck for 16th-note arpeggios
  pluck: async (Tone) => synthWithFilter(Tone, new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 2, spread: 12 }, envelope: { attack: 0.002, decay: 0.16, sustain: 0.05, release: 0.12 }, volume: -22,
  }), 3600),
  // phonk: a dark, filtered pad that stays out of the cowbell's way
  darkPad: async (Tone) => synthWithFilter(Tone, fat(Tone, 3, 14, { attack: 0.6, decay: 0.4, sustain: 0.7, release: 2 }, -27), 900),
  pad: async (Tone) => synthWithFilter(Tone, fat(Tone, 3, 18, { attack: 1.2, decay: 0.4, sustain: 0.8, release: 3 }, -24), 1400),
  supersaw: async (Tone) => synthWithFilter(Tone, fat(Tone, 7, 40, { attack: 0.05, decay: 0.3, sustain: 0.8, release: 1.2 }, -27), 4500),
};

// ─── Melody instruments ─────────────────────────────────────────────────────

export const MELODY_INSTRUMENTS = {
  piano: (Tone) => sampled(Tone, 'piano', { volume: -8, release: 1 }, presence),
  saxophone: (Tone) => sampled(Tone, 'saxophone', { volume: -10, attack: 0.02, release: 0.25 }),
  flute: (Tone) => sampled(Tone, 'flute', { volume: -11, attack: 0.03, release: 0.3 }),
  violin: (Tone) => sampled(Tone, 'violin', { volume: -12, attack: 0.04, release: 0.4 }),
  horn: (Tone) => sampled(Tone, 'french-horn', { volume: -10, attack: 0.05, release: 0.6 }),
  harp: (Tone) => sampled(Tone, 'harp', { volume: -8, release: 1.5 }),
  xylophone: (Tone) => sampled(Tone, 'xylophone', { volume: -12, release: 0.8 }),
  nylonGuitar: (Tone) => sampled(Tone, 'nylon-guitar', { volume: -7, release: 0.6 }),
  // a second, brighter steel-string guitar picking the melody over the fingerpicked chords
  acousticGuitar: (Tone) => sampled(Tone, 'acoustic-guitar', { volume: -6, release: 0.7 }, (T) => [new T.EQ3({ low: -4, mid: 1, high: 3, highFrequency: 3000 }), new T.Panner(0.35)]),
  guitarLead: (Tone) => sampled(Tone, 'electric-guitar', { volume: -20, release: 0.4 }, (T) => [
    ...ampChain(T, { drive: 0.6, cab: 3800, pan: 0.1 }),
    new T.Vibrato({ frequency: 5.2, depth: 0.05 }),
  ]),
  // Shoegaze "glide guitar": every note swells in (volume-knob swell), wobbles slowly
  // like a held tremolo arm, through fuzz and chorus, with a quiet octave on top,
  // and the style's huge reverb does the rest.
  glideGuitar: (Tone) => glideGuitar(Tone),
  // electronic: a detuned saw lead (the style adds a dotted-8th echo)
  sawLead: async (Tone) => synthWithFilter(Tone, new Tone.Synth({
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.25 }, volume: -24,
  }), 5000),
  // Brazilian phonk: the TR-808-style cowbell, tuned to the melody (two square waves a fifth-ish apart through a band-pass)
  cowbell: async (Tone) => cowbell(Tone),
  // synthetic on purpose (synthwave)
  square: async (Tone) => synthWithFilter(Tone, new Tone.Synth({
    oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.5 }, volume: -22,
  }), 3000),
};

async function glideGuitar(Tone) {
  const s = await makeSampler(Tone, 'electric-guitar', { volume: -17, attack: 0.22, release: 2.2, curve: 'linear' });
  const fuzz = new Tone.Distortion({ distortion: 0.35, oversample: '2x', wet: 0.55 });
  const tone = new Tone.Filter({ frequency: 3400, type: 'lowpass', Q: 0.5 });
  const wobble = new Tone.Vibrato({ frequency: 3.2, depth: 0.12 });
  const chorus = new Tone.Chorus({ frequency: 0.9, delayTime: 4, depth: 0.7, spread: 160, wet: 0.6 }).start();
  s.chain(fuzz, tone, wobble, chorus);
  const play = (time, ev, sps) => {
    const dur = Math.max(0.3, ev.dur * sps * 1.4);           // let notes overlap into each other
    for (const m of ev.notes) {
      s.triggerAttackRelease(midiToHz(m), dur, time, ev.vel);
      if (m + 12 <= 88) s.triggerAttackRelease(midiToHz(m + 12), dur, time + 0.03, ev.vel * 0.3);   // octave shimmer
    }
  };
  return wrap([s, fuzz, tone, wobble, chorus], chorus, play, s);
}

async function cowbell(Tone) {
  const bp = new Tone.Filter({ frequency: 2600, type: 'bandpass', Q: 1.2 });
  const hp = new Tone.Filter({ frequency: 400, type: 'highpass' });
  const out = new Tone.Gain(0.9);
  bp.connect(hp); hp.connect(out);
  const env = { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 };
  const a = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'square' }, envelope: env, volume: -14 }).connect(bp);
  const b = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'square' }, envelope: env, volume: -16 }).connect(bp);
  const play = (time, ev) => {
    for (const m of ev.notes) {
      const f = midiToHz(m);
      a.triggerAttackRelease(f, 0.25, time, ev.vel);
      b.triggerAttackRelease(f * 1.48, 0.25, time, ev.vel);      // the classic 808 cowbell interval (≈ 540 / 800 Hz)
    }
  };
  const release = () => { a.releaseAll(); b.releaseAll(); };
  return { output: out, play, release, dispose: () => [a, b, bp, hp, out].forEach((n) => n.dispose()) };
}

// ─── Bass instruments ───────────────────────────────────────────────────────

export const BASS_INSTRUMENTS = {
  electricBass: (Tone) => sampled(Tone, 'electric-bass', { volume: -5, release: 0.15 }, lowpass(2400)),
  rockBass: (Tone) => sampled(Tone, 'electric-bass', { volume: -9, release: 0.1 }, (T) => [
    new T.Distortion({ distortion: 0.3, oversample: '2x', wet: 0.5 }), new T.Filter({ frequency: 2200, type: 'lowpass' }),
  ]),
  // fingered upright-style tone: rolled-off highs and a short release
  upright: (Tone) => sampled(Tone, 'electric-bass', { volume: -3, release: 0.12 }, lowpass(750, 1.2), { maxDur: 0.6 }),
  contrabass: (Tone) => sampled(Tone, 'contrabass', { volume: -7, attack: 0.15, release: 1.5 }),
  // synthetic on purpose
  synth: async (Tone) => {
    const s = new Tone.MonoSynth({
      oscillator: { type: 'square' }, filter: { Q: 1, type: 'lowpass', rolloff: -24 },
      filterEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.3, release: 0.3, baseFrequency: 150, octaves: 3 },
      envelope: { attack: 0.003, decay: 0.3, sustain: 0.6, release: 0.2 }, volume: -15,
    });
    return wrap([s], s, playNotes(s));
  },
  '808': async (Tone) => {
    const s = new Tone.Synth({
      portamento: 0.06, oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 1.2, sustain: 0.4, release: 0.5 }, volume: -7,
    });
    const sat = new Tone.Distortion({ distortion: 0.25, wet: 0.5 });
    s.connect(sat);
    return wrap([s, sat], sat, playNotes(s), s);
  },
};

// ─── Drum kits (recorded hits) ──────────────────────────────────────────────

/**
 * kit: recorded set for kick / snare / hats / toms; extras from the percussion set.
 * synthKick: an analogue-style 808 kick (synthesised — that is what an 808 is).
 */
export const KIT_SETTINGS = {
  rock:     { set: 'acoustic', crash: true, toms: true, vol: { kick: -2, snare: -4, hat: -14, tom: -6, crash: -16 }, lowpass: 16000, reverbSend: 0.18 },
  washed:   { set: 'acoustic', crash: true, vol: { kick: -5, snare: -7, hat: -16, crash: -18 }, lowpass: 7000, reverbSend: 0.6 },
  soft:     { set: 'acoustic', vol: { kick: -8, snare: -11, hat: -18 }, lowpass: 10000, reverbSend: 0.25 },
  brushes:  { set: 'acoustic', brush: true, ride: true, vol: { kick: -14, snare: -10, hat: -15 }, lowpass: 12000, reverbSend: 0.15 },
  lofi:     { set: 'breakbeat', vol: { kick: -3, snare: -5, hat: -14 }, lowpass: 4200, reverbSend: 0.1 },
  boombap:  { set: 'breakbeat', vol: { kick: -1, snare: -3, hat: -13 }, lowpass: 9000, reverbSend: 0.06 },
  pop:      { set: 'kit8', clap: true, vol: { kick: -2, snare: -5, hat: -14, clap: -10 }, lowpass: 18000, reverbSend: 0.12 },
  house:    { set: 'techno', clap: true, vol: { kick: -1, snare: -9, hat: -12, clap: -8 }, lowpass: 18000, reverbSend: 0.1 },
  linn:     { set: 'linn', vol: { kick: -3, snare: -5, hat: -14 }, lowpass: 16000, reverbSend: 0.25 },
  '808':    { set: 'techno', synthKick: true, clap: true, vol: { kick: -4, snare: -8, hat: -15, clap: -7 }, lowpass: 18000, reverbSend: 0.08 },
  taiko:    { set: 'acoustic', taiko: true, vol: { tom: -2 }, lowpass: 6000, reverbSend: 0.45 },
  shaker:   { shaker: true, vol: { hat: -12 }, lowpass: 7500, reverbSend: 0.12 },
};

async function oneShot(Tone, path, volume, release = 0.08) {
  const buf = await loadBuffer(Tone, `drums/${path}`);
  return new Tone.Sampler({ urls: { C3: buf }, release, volume });
}

/**
 * @param {{forPoints?: boolean}} options  a kit that plays the photo's points: always has
 *   toms, a crash and a ride, whatever the style's main kit contains.
 * @returns {{output, reverbSend, kick, snare, hat, tom, crash, ride, clap, dispose}}
 */
export async function createKit(Tone, kitId, { forPoints = false } = {}) {
  const base = KIT_SETTINGS[kitId] ?? KIT_SETTINGS.soft;
  const cfg = forPoints
    ? { ...base, set: base.set ?? 'acoustic', toms: true, crash: true, taiko: false,
        vol: { kick: -8, snare: -6, tom: -4, crash: -14, ride: -12, ...base.vol, hat: base.vol.hat ?? -14 } }
    : base;
  const v = cfg.vol;
  const nodes = [];
  const out = new Tone.Filter({ frequency: cfg.lowpass, type: 'lowpass' });
  nodes.push(out);
  const kit = { output: out, reverbSend: cfg.reverbSend, kick() {}, snare() {}, hat() {}, tom() {}, crash() {}, ride() {}, clap() {} };
  const add = (n) => { n.connect(out); nodes.push(n); return n; };
  const set = cfg.set && DRUM_SAMPLES[cfg.set] ? cfg.set : null;

  if (cfg.synthKick) {
    const k = add(new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 7, envelope: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.1 }, volume: v.kick }));
    kit.kick = (time, vel) => k.triggerAttackRelease(46, 0.1, time, vel);
  } else if (set && v.kick !== undefined) {
    const k = add(await oneShot(Tone, `${set}/kick.mp3`, v.kick));
    kit.kick = (time, vel) => k.triggerAttackRelease('C3', 0.6, time, vel);
  }

  if (cfg.brush) {
    const b1 = add(await oneShot(Tone, 'perc/brush.mp3', v.snare, 0.2));
    const b2 = add(await oneShot(Tone, 'perc/brush2.mp3', v.snare - 3, 0.2));
    let alt = 0;
    kit.snare = (time, vel) => ((alt++ % 2 ? b2 : b1).triggerAttackRelease('C3', 1, time, vel));
  } else if (set && v.snare !== undefined) {
    const s = add(await oneShot(Tone, `${set}/snare.mp3`, v.snare));
    let clap = null;
    if (cfg.clap) clap = add(await oneShot(Tone, 'perc/clap.mp3', v.clap));
    kit.snare = (time, vel) => { s.triggerAttackRelease('C3', 0.5, time, vel); clap?.triggerAttackRelease('C3', 0.2, time + 0.005, vel); };
  }

  if (cfg.ride) {
    const r = add(await oneShot(Tone, 'perc/ride.mp3', v.hat, 0.4));
    kit.hat = (time, vel) => r.triggerAttackRelease('C3', 1.2, time, vel);
  } else if (cfg.shaker) {
    const sh = add(await oneShot(Tone, 'perc/shaker.mp3', v.hat, 0.05));
    kit.hat = (time, vel) => sh.triggerAttackRelease('C3', 0.25, time, vel);
  } else if (set && v.hat !== undefined) {
    const h = add(await oneShot(Tone, `${set}/hihat.mp3`, v.hat, 0.03));
    // closed = cut short; open = let the recording ring
    kit.hat = (time, vel, isOpen) => h.triggerAttackRelease('C3', isOpen ? 0.45 : 0.07, time, vel);
  }

  if (cfg.toms || cfg.taiko) {
    const bufs = await Promise.all(['tom1', 'tom2', 'tom3'].map((t) => loadBuffer(Tone, `drums/${set}/${t}.mp3`)));
    // each tom recording is mapped to a pitch, so fills (and taiko hits) can be played at any pitch
    const t = add(new Tone.Sampler({ urls: { C3: bufs[0], A2: bufs[1], F2: bufs[2] }, release: 0.3, volume: v.tom }));
    kit.tom = (time, vel, midi) => t.triggerAttackRelease(midiToHz(midi), 1.2, time, vel);
    if (cfg.taiko) kit.kick = (time, vel) => t.triggerAttackRelease(midiToHz(31), 2, time, vel);   // tom pitched way down = taiko
  }

  if (forPoints) {
    const cl = add(await oneShot(Tone, 'perc/clap.mp3', v.clap ?? -8, 0.05));
    kit.clap = (time, vel) => cl.triggerAttackRelease('C3', 0.3, time, vel);
  }

  if (forPoints || cfg.ride) {
    const rd = add(await oneShot(Tone, 'perc/ride.mp3', v.ride ?? v.hat, 0.4));
    kit.ride = (time, vel) => rd.triggerAttackRelease('C3', 1.5, time, vel);
  }

  if (cfg.crash) {
    const c = add(await oneShot(Tone, 'perc/crash.mp3', v.crash, 1));
    kit.crash = (time, vel) => c.triggerAttackRelease('C3', 3, time, vel);
  }

  kit.dispose = () => nodes.forEach((n) => n.dispose());
  return kit;
}
