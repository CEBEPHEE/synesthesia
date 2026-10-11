/**
 * Arranger: score + style → concrete note events for every track.
 * Pure (no Tone.js), so every genre's rhythm can be unit-tested.
 *
 * Time is measured in 16th-note steps from the start of the loop.
 * Event: { step, dur, vel, notes?: number[] (MIDI), open?: boolean, glide?: boolean, muted?: boolean }
 */
import { mod } from './music-theory.js';

export const TRACKS = Object.freeze(['chords', 'bass', 'kick', 'snare', 'hat', 'tom', 'crash', 'melody', 'pointDrums']);

/** What the points of interest play: a pitched melody, drum hits, or nothing. */
export const POINT_MODES = Object.freeze(['melody', 'drums', 'off']);

const BASS_RANGES = { '808': [28, 40], sub: [31, 43], default: [33, 45] };

/** Chord segments laid out over the loop (the loop is at least 2 bars, for the melody). */
export function chordTimeline(score) {
  const loopBars = Math.max(2, score.totalBars);
  const segments = [];
  let bar = 0, i = 0;
  while (bar < loopBars) {
    const chord = score.chords[i % score.chords.length];
    const bars = Math.min(chord.bars, loopBars - bar);
    segments.push({ chord, index: i % score.chords.length, startStep: bar * 16, steps: bars * 16 });
    bar += bars; i++;
  }
  return { loopBars, segments };
}

/** Character of a pattern at an absolute step (patterns may be 1 or 2 bars long). */
export const patternAt = (pattern, step) => pattern[mod(step, pattern.length)];

/** Delay off-beat notes: 16th swing moves odd 16ths, 8th swing moves off-beat 8ths. */
export function applySwing(step, swing, unit = 16) {
  if (!swing || !Number.isInteger(step)) return step;
  if (unit === 16 && step % 2 === 1) return step + swing / 3;
  if (unit === 8 && step % 4 === 2) return step + (2 * swing) / 3;
  return step;
}

function arpSequence(voicing, shape) {
  const v = [...voicing].sort((a, b) => a - b);
  const top = v[v.length - 1], mid = v[Math.max(1, v.length - 2)];
  switch (shape) {
    case 'alberti': {
      const bass = v[0] - 12 >= 36 ? v[0] - 12 : v[0];
      return [bass, top, mid, top];
    }
    case 'broken': return [v[0], v[2] ?? top, v[1], top, v[2] ?? top, v[1]];
    case 'up':
    default: return v;
  }
}

function chordEvents(seg, style) {
  const { chord, startStep, steps } = seg;
  const rh = style.chords;
  const out = [];
  if (rh.type === 'sustain') {
    out.push({ step: startStep, dur: steps, vel: 0.6, notes: chord.voicing });
  } else if (rh.type === 'arp') {
    const seq = arpSequence(chord.voicing, rh.shape);
    for (let k = 0, s = 0; s < steps; k++, s += rh.rate) {
      out.push({ step: startStep + s, dur: rh.rate * 1.8, vel: s % 16 === 0 ? 0.7 : 0.5, notes: [seq[k % seq.length]] });
    }
  } else if (rh.type === 'hits') {
    // 'X' = accented hit that rings until the next one, 'x' = normal hit
    // (palm-muted and short when the style asks for palmMute)
    const hits = [];
    for (let s = 0; s < steps; s++) {
      const c = patternAt(rh.pattern, s);
      if (c === 'x' || c === 'X') hits.push({ s, accent: c === 'X' });
    }
    hits.forEach(({ s, accent }, i) => {
      const next = i + 1 < hits.length ? hits[i + 1].s : steps;
      const muted = !accent && !!rh.palmMute;
      const dur = Math.min(accent ? next - s : muted ? 1 : (rh.dur ?? next - s), steps - s);
      const vel = accent ? 0.85 : muted ? 0.6 : s % 16 === 0 ? 0.75 : 0.6;
      if (rh.strum) {
        [...chord.voicing].sort((a, b) => a - b).forEach((m, n) => out.push({ step: startStep + s + n * 0.12, dur, vel, notes: [m] }));
      } else {
        out.push({ step: startStep + s, dur, vel, notes: chord.voicing, ...(muted && { muted }) });
      }
    });
  }
  return out;
}

function bassEvents(seg, nextSeg, style) {
  const b = style.bass;
  if (!b) return [];
  const [low, high] = BASS_RANGES[style.sound.bass] ?? BASS_RANGES.default;
  const fold = (m) => { while (m < low) m += 12; while (m > high) m -= 12; return m; };
  const root = low + mod(seg.chord.pcs[0] - low, 12);
  const out = [];

  if (b.pattern === 'w') {                                   // walking bass, one note per beat
    const pcs = seg.chord.pcs;
    const third = fold(root + mod(pcs[1] - pcs[0], 12));
    const fifth = fold(root + mod((pcs[2] ?? pcs[0] + 7) - pcs[0], 12));
    for (let beat = 0; beat < seg.steps / 4; beat++) {
      const lastBeatOfSeg = beat === seg.steps / 4 - 1;
      const nextRootPc = lastBeatOfSeg ? nextSeg.chord.pcs[0] : pcs[0];
      const nextRoot = low + mod(nextRootPc - low, 12);
      const pitches = [root, third, fifth, fold(nextRoot - 1)];   // chromatic approach note
      out.push({ step: seg.startStep + beat * 4, dur: 3.5, vel: beat % 4 === 0 ? 0.8 : 0.65, notes: [pitches[beat % 4]] });
    }
    return out;
  }

  for (let s = 0; s < seg.steps; s++) {
    const c = patternAt(b.pattern, s);
    if (c === '.') continue;
    const midi = c === 'o' ? root + 12 : c === 'f' ? fold(root + 7) : root;
    out.push({ step: seg.startStep + s, dur: Math.min(b.dur, seg.steps - s), vel: s % 16 === 0 ? 0.85 : 0.7, notes: [midi], glide: !!b.glide });
  }
  return out;
}

const FILL_TOMS = [52, 50, 47, 43];             // high → low, one per 16th

function drumEvents(loopSteps, style, segments) {
  const d = style.drums;
  const out = { kick: [], snare: [], hat: [], tom: [], crash: [] };
  if (!d) return out;
  // A drum fill on toms over the last beat of the loop leads back into bar 1
  const fillFrom = d.fill ? loopSteps - FILL_TOMS.length : Infinity;
  if (d.fill) FILL_TOMS.forEach((m, i) => out.tom.push({ step: fillFrom + i, dur: 2, vel: 0.7 + 0.05 * i, notes: [m] }));
  if (d.crash) for (const seg of segments) out.crash.push({ step: seg.startStep, dur: 8, vel: seg.startStep === 0 ? 0.8 : 0.6 });
  for (let s = 0; s < loopSteps; s++) {
    const inFill = s >= fillFrom;
    if (d.kick && patternAt(d.kick, s) === 'x' && !inFill) out.kick.push({ step: s, dur: 2, vel: s % 16 === 0 ? 0.95 : 0.82 });
    if (d.snare && patternAt(d.snare, s) === 'x' && !inFill) out.snare.push({ step: s, dur: 2, vel: 0.8 });
    if (inFill) continue;
    if (d.hat) {
      const c = patternAt(d.hat, s);
      const vel = s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.38 : 0.28;
      if (c === 'x') out.hat.push({ step: s, dur: 1, vel });
      else if (c === 'o') out.hat.push({ step: s, dur: 2, vel: 0.45, open: true });
      else if (c === 'r') [0, 0.5].forEach((o) => out.hat.push({ step: s + o, dur: 0.5, vel: 0.3 }));
      else if (c === 't') [0, 1 / 3, 2 / 3].forEach((o) => out.hat.push({ step: s + o, dur: 0.33, vel: 0.28 }));
    }
  }
  return out;
}

/** Move a melody note off a semitone clash with the chord underneath (to the nearest chord tone). */
export function avoidClash(midi, chordPcs) {
  const pc = mod(midi, 12);
  if (chordPcs.includes(pc)) return midi;
  const clashes = chordPcs.some((c) => mod(pc - c, 12) === 1 || mod(c - pc, 12) === 1);
  if (!clashes) return midi;
  for (const off of [1, -1, 2, -2, 3, -3]) {
    if (chordPcs.includes(mod(midi + off, 12))) return midi + off;
  }
  return midi;
}

function melodyEvents(score, segments, loopSteps, style) {
  const out = [];
  const m = style.melody ?? { octave: 0, dur: 2 };
  const chordAt = (step) => segments.find((g) => step >= g.startStep && step < g.startStep + g.steps)?.chord;
  for (let base = 0; base < loopSteps; base += 32) {
    for (const n of score.melody) {
      const step = base + n.step;
      if (step >= loopSteps) continue;
      const chord = chordAt(step);
      const midi = avoidClash(n.midi + (m.octave ?? 0), chord ? chord.pcs : []);
      out.push({ step, dur: m.dur ?? 2, vel: n.velocity, notes: [midi], pointIndex: n.pointIndex });
    }
  }
  return out;
}

/** Default drum voices for point hits when a style does not define its own. */
const DEFAULT_POINT_DRUMS = Object.freeze({ high: 'tom', low: 'tom', accent: 'crash' });

/** Melody range → tom pitch: the top of the melody range maps to the high tom, the bottom to the floor tom. */
export function tomPitchFor(midi, low = 64, high = 88) {
  const t = Math.min(1, Math.max(0, (midi - low) / (high - low)));
  return Math.round(40 + t * 15);          // E2 (floor tom) … G3 (high tom)
}

/**
 * Points of interest as a drummer's answers: same rhythm as the melody would have,
 * but each point becomes a drum hit. Points in the upper half of the photo's
 * melody range use the "high" voice, the lower half the "low" voice; the single
 * strongest point gets an extra accent (crash or ride).
 */
function pointDrumEvents(score, loopSteps, style) {
  if (!score.melody.length) return [];
  const map = { ...DEFAULT_POINT_DRUMS, ...style.pointDrums };
  const sorted = [...score.melody].map((n) => n.midi).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const strongest = score.melody.reduce((a, b) => (b.velocity > a.velocity ? b : a));
  const out = [];
  for (let base = 0; base < loopSteps; base += 32) {
    for (const n of score.melody) {
      const step = base + n.step;
      if (step >= loopSteps) continue;
      const vel = Math.min(1, n.velocity + 0.15);
      const voice = n.midi >= median ? map.high : map.low;
      out.push({ step, dur: 2, vel, voice, notes: [tomPitchFor(n.midi)], pointIndex: n.pointIndex });
      if (n === strongest && map.accent) out.push({ step, dur: 4, vel: Math.min(1, vel + 0.05), voice: map.accent, notes: [tomPitchFor(n.midi)], pointIndex: n.pointIndex });
    }
  }
  return out;
}

/** Deterministic pseudo-random number in [0, 1) for a given integer seed. */
const hash01 = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/**
 * Small, deterministic timing and velocity variations, like a live player.
 * Notes on the very first step stay put so the loop always starts on time.
 */
export function humanize(e, amount, seed, loopSteps) {
  if (!amount) return e;
  const step = e.step === 0 ? 0 : Math.min(loopSteps - 0.01, Math.max(0, e.step + (hash01(seed) - 0.5) * amount.time));
  const vel = Math.min(1, Math.max(0.05, e.vel * (1 - hash01(seed + 0.5) * amount.vel)));
  return { ...e, step, vel };
}

/**
 * @param {{pointsAs?: 'melody'|'drums'|'off'}} options  overrides the style's default for the points
 * @returns {{tempo, pointsAs, loopBars, loopSteps, segments, tracks: Record<string, Event[]>}}
 */
export function arrange(score, style, { pointsAs } = {}) {
  const mode = POINT_MODES.includes(pointsAs) ? pointsAs : (style.points ?? 'melody');
  if (!score?.chords?.length) throw new Error('score has no chords');
  const { loopBars, segments } = chordTimeline(score);
  const loopSteps = loopBars * 16;
  const tracks = Object.fromEntries(TRACKS.map((t) => [t, []]));

  segments.forEach((seg, i) => {
    tracks.chords.push(...chordEvents(seg, style).map((e) => ({ ...e, chordIndex: seg.index })));
    tracks.bass.push(...bassEvents(seg, segments[(i + 1) % segments.length], style));
  });
  Object.assign(tracks, drumEvents(loopSteps, style, segments));
  if (mode === 'melody') tracks.melody = melodyEvents(score, segments, loopSteps, style);
  if (mode === 'drums') tracks.pointDrums = pointDrumEvents(score, loopSteps, style);

  const unit = style.swingUnit ?? 16;
  TRACKS.forEach((t, ti) => {
    tracks[t] = tracks[t]
      .map((e, i) => humanize({ ...e, step: applySwing(e.step, style.swing, unit) }, style.humanize, ti * 1000 + i, loopSteps))
      .sort((a, b) => a.step - b.step);
  });
  return { tempo: score.tempo, pointsAs: mode, loopBars, loopSteps, segments, tracks };
}
