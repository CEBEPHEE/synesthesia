/**
 * "Follow the dancer" for videos. Pure (no DOM), unit-tested.
 *
 * The person in the video never writes the notes: chords and melody still come from
 * the picture. The movement only shapes what changes slowly in real songs too:
 *
 *  1. Tempo: one tempo for the whole film, the dancer's (found from the moves);
 *     the music starts on the dancer's beat.
 *  2. Form: every 4-bar phrase gets a level from how much the person moves:
 *     calm (chords + melody), groove (+ bass and drums), peak (everything, louder).
 *     Levels change only between phrases, so the music breathes like a song.
 *  3. Colour: raised arms / open hands → the melody an octave higher and brighter;
 *     a hunched, closed pose → softer.
 *  4. Stillness: two or more motionless bars → the music holds (chords only).
 *  5. Accents: the few biggest moves get a cymbal (with a short drum fill before it).
 */

const TAU = Math.PI * 2;

// ─── Moves → tempo ──────────────────────────────────────────────────────────

/** Finds the moments a movement "hits" (sudden bursts of speed), like drum hits in audio. */
export class OnsetDetector {
  constructor({ refractory = 0.2, minStrength = 0.25, history = 3 } = {}) {
    Object.assign(this, { refractory, minStrength, history });
    this.samples = [];
    this.lastOnset = -Infinity;
    this.smooth = 0;
  }

  /** @returns {null | {t, strength}} */
  push(t, speed) {
    const dt = this.samples.length ? Math.max(1e-3, t - this.samples.at(-1).t) : 1;
    const k = 1 - Math.exp(-dt / 0.05);                 // light smoothing, frame-rate independent
    this.smooth = this.smooth * (1 - k) + speed * k;
    const prev = this.samples.at(-1);
    const rise = Math.max(0, this.smooth - (prev?.smooth ?? this.smooth));
    this.samples.push({ t, smooth: this.smooth, rise });
    while (this.samples.length && this.samples[0].t < t - this.history) this.samples.shift();
    const n = this.samples.length;
    if (n < 3) return null;
    const a = this.samples[n - 3], b = this.samples[n - 2], c = this.samples[n - 1];
    if (!(b.rise > a.rise && b.rise >= c.rise)) return null;
    const rises = this.samples.map((s) => s.rise);
    const mean = rises.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(rises.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    if (b.rise < Math.max(this.minStrength, mean + sd)) return null;
    if (b.t - this.lastOnset < this.refractory) return null;
    this.lastOnset = b.t;
    return { t: b.t, strength: b.rise };
  }
}

/**
 * The tempo and phase that best explain the moves: every tempo from 70 to 160 BPM is
 * tried; the one whose beat clock lines the moves up most tightly wins.
 * @returns {null | {bpm, period, offset, confidence}}  beats at offset + k·period (s)
 */
export function estimateBeat(onsets, { minBpm = 70, maxBpm = 160, prefer = 112 } = {}) {
  if (!onsets || onsets.length < 4) return null;
  const total = onsets.reduce((s, o) => s + (o.strength ?? 1), 0);
  let best = null;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const period = 60 / bpm;
    let re = 0, im = 0;
    for (const o of onsets) {
      const a = (TAU * o.t) / period, w = o.strength ?? 1;
      re += w * Math.cos(a); im += w * Math.sin(a);
    }
    const r = Math.hypot(re, im) / total;
    const prior = Math.exp(-((Math.log2(bpm / prefer)) ** 2) / (2 * 0.6 ** 2));
    const score = r * (0.85 + 0.15 * prior);
    if (!best || score > best.score) {
      const phase = Math.atan2(im, re) / TAU;
      best = { bpm, period, offset: (((phase % 1) + 1) % 1) * period, confidence: r, score };
    }
  }
  return { bpm: best.bpm, period: best.period, offset: best.offset, confidence: best.confidence };
}

/** Folds a tempo by octaves to the one closest to a style's range (60 steps/min → 120 BPM). */
export function fitTempo(bpm, [lo, hi]) {
  const dist = (b) => (b < lo ? Math.log2(lo / b) : b > hi ? Math.log2(b / hi) : 0);
  let best = bpm;
  for (let k = -3; k <= 3; k++) { const b = bpm * 2 ** k; if (dist(b) < dist(best) - 1e-9) best = b; }
  return Math.round(best * 2) / 2;
}

// ─── Moves → the shape of the piece ─────────────────────────────────────────

export const LEVELS = Object.freeze(['still', 'calm', 'groove', 'peak']);
const PHRASE_BARS = 4;

const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/**
 * @param {Array<{t, speed, lift, present}>} samples  movement over the video (seconds)
 * @param {{duration, tempo, offset}} timing  music tempo and when its first beat falls (s)
 * @returns {{bars, phrases, accents, onsets}}
 *   bars: per bar {energy 0…1, lift 0…1, present}; phrases: {startBar, bars, level, lift};
 *   accents: steps (16ths, music time) for the biggest moves
 */
export function planFromMovement(samples, { duration, tempo, offset = 0, onsets = null } = {}) {
  const barSec = (60 / tempo) * 4;
  const nBars = Math.max(1, Math.ceil((duration - offset) / barSec));
  const bars = Array.from({ length: nBars }, () => ({ speed: 0, lift: 0, n: 0, seen: 0 }));
  for (const s of samples) {
    const b = Math.floor((s.t - offset) / barSec);
    if (b < 0 || b >= nBars) continue;
    bars[b].n++;
    if (s.present) { bars[b].seen++; bars[b].speed += s.speed; bars[b].lift += s.lift; }
  }
  const raw = bars.map((b) => ({
    speed: b.seen ? b.speed / b.seen : 0, lift: b.seen ? b.lift / b.seen : 0.5, present: b.n ? b.seen / b.n > 0.4 : false,
  }));
  // energy relative to this video (so a calm dancer still gets a shape), but very
  // little movement overall stays calm
  const speeds = raw.filter((b) => b.present).map((b) => b.speed);
  const lo = quantile(speeds, 0.1), hi = Math.max(quantile(speeds, 0.9), lo + 1e-6);
  const overall = quantile(speeds, 0.5);
  const scaleDown = overall < 0.15 ? overall / 0.15 : 1;
  let smooth = null;
  const outBars = raw.map((b) => {
    const e = b.present ? Math.min(1, Math.max(0, (b.speed - lo) / (hi - lo))) * scaleDown : 0;
    smooth = smooth === null ? e : smooth * 0.4 + e * 0.6;
    return { energy: smooth, lift: b.lift, present: b.present, speed: b.speed };
  });

  // 4-bar phrases; the level of a phrase is its typical energy, with hysteresis
  const phrases = [];
  let prevLevel = 'calm';
  for (let start = 0; start < nBars; start += PHRASE_BARS) {
    const group = outBars.slice(start, start + PHRASE_BARS);
    const e = group.reduce((s, b) => s + b.energy, 0) / group.length;
    const lift = group.reduce((s, b) => s + b.lift, 0) / group.length;
    const stillBars = group.filter((b) => b.present && b.speed < 0.06).length;
    let level = e < 0.25 ? 'calm' : e < 0.66 ? 'groove' : 'peak';
    // hysteresis: only move one step at a time unless the change is big
    const iPrev = LEVELS.indexOf(prevLevel), iNew = LEVELS.indexOf(level);
    if (Math.abs(iNew - iPrev) === 1 && Math.abs(e - [0.25, 0.25, 0.25, 0.66][Math.max(iNew, iPrev)]) < 0.04) level = prevLevel;   // too close to the border: stay
    if (stillBars >= 2 && stillBars >= group.length / 2) level = 'still';
    phrases.push({ startBar: start, bars: group.length, level, lift: lift > 0.65 ? 'high' : lift < 0.18 ? 'low' : 'mid', energy: e });
    prevLevel = level;
  }

  // accents: the biggest moves, at least 4 bars apart, on the 16th grid
  const sps = 60 / tempo / 4;
  const accents = [];
  const strong = [...(onsets ?? [])].sort((a, b) => b.strength - a.strength);
  const maxAccents = Math.max(1, Math.min(5, Math.round(nBars / 6)));
  for (const o of strong) {
    if (accents.length >= maxAccents) break;
    const step = Math.round((o.t - offset) / sps);
    if (step < 16 || step >= nBars * 16) continue;
    if (accents.some((a) => Math.abs(a - step) < 64)) continue;
    const ph = phrases[Math.floor(step / 16 / PHRASE_BARS)];
    if (ph && (ph.level === 'still' || ph.level === 'calm')) continue;   // a crash in a quiet phrase would jar
    accents.push(step);
  }
  accents.sort((a, b) => a - b);
  return { bars: outBars, phrases, accents };
}

/**
 * Shapes an arrangement (absolute steps, music time) with a movement plan.
 * Notes are never invented: layers are muted or emphasised, the melody can move up an octave.
 * @param {{tracks}} arrangement  e.g. timelineArrangement(...)
 * @param {{hasDrums: boolean}} style info
 */
export function applyMovementPlan(arrangement, plan, { hasDrums = true } = {}) {
  const phraseAt = (step) => plan.phrases[Math.min(plan.phrases.length - 1, Math.floor(step / 16 / PHRASE_BARS))];
  const DRUMS = ['kick', 'snare', 'hat', 'tom', 'crash'];
  const tracks = {};
  for (const [name, events] of Object.entries(arrangement.tracks)) {
    tracks[name] = [];
    for (const e of events) {
      const ph = phraseAt(e.step);
      const level = ph?.level ?? 'groove';
      if (level === 'still' && name !== 'chords') continue;                       // the music holds
      if (level === 'calm' && (DRUMS.includes(name) || name === 'bass' || name === 'pointDrums')) continue;
      if (level === 'groove' && name === 'crash') continue;
      let ev = e;
      const loud = level === 'peak' ? 1.15 : level === 'calm' || level === 'still' ? 0.85 : 1;
      if (e.vel != null && loud !== 1) ev = { ...ev, vel: Math.min(1, e.vel * loud) };
      if (name === 'melody' && ph) {
        if (ph.lift === 'high') ev = { ...ev, notes: ev.notes.map((m) => (m + 12 <= 96 ? m + 12 : m)) };
        if (ph.lift === 'low' && ev.vel != null) ev = { ...ev, vel: ev.vel * 0.8 };
      }
      tracks[name].push(ev);
    }
  }
  if (hasDrums) {
    for (const step of plan.accents) {
      tracks.crash.push({ step, dur: 8, vel: 0.85, section: 0 });
      for (let k = 1; k <= 3; k++) tracks.snare.push({ step: step - k, dur: 1, vel: 0.45 + 0.1 * (3 - k), section: 0 });   // a short fill into it
    }
    tracks.crash.sort((a, b) => a.step - b.step);
    tracks.snare.sort((a, b) => a.step - b.step);
  }
  return { ...arrangement, tracks };
}

/** The whole analysis: tempo from the moves, then the plan. */
export function analyzeMovement(samples, { duration, styleTempo }) {
  const det = new OnsetDetector();
  const onsets = [];
  for (const s of samples) { if (!s.present) continue; const o = det.push(s.t, s.speed); if (o) onsets.push(o); }
  const beat = estimateBeat(onsets);
  const steady = beat && beat.confidence >= 0.45;
  const tempo = steady ? fitTempo(beat.bpm, styleTempo) : null;
  const offset = steady ? beat.offset % (60 / tempo) : 0;
  return { onsets, beat: steady ? beat : null, tempo, offset };
}
