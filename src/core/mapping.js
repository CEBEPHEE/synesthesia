/**
 * Mathematical mapping: visual features → music. Pure and deterministic:
 * the same photo + style always produce the same score.
 *
 *  Hue of the dominant colour         → key (root note) via the circle of fifths
 *  Brightness V + saturation S        → mode (Lydian … Phrygian), shifted by the style
 *  Hue of the other colours           → chord degrees relative to the key colour
 *  Share of each colour in the frame  → chord length (1–2 bars)
 *  Spread of the points of interest   → extra colour tone in chords (tight = richer)
 *  Distance between points            → melodic interval (consonance ladder)
 *  Height + brightness of a point     → melody contour; horizontal (x) → timing.
 *    Points are read relative to each other (stretched to a full phrase), and a
 *    layout with no contour at all falls back to a simple motif.
 *  Contrast + saturation + sharpness  → tempo inside the style's tempo range
 *
 * Every decision is recorded in `score.decisions` so the UI can explain it.
 */
import {
  mod, pcName, scalePitchClasses, diatonicChord, isDiminished,
  chordSymbol, romanNumeral, MODES_BY_BRIGHTNESS, MODE_NAMES, MODES,
} from './music-theory.js';
import { voiceLead, DEFAULT_RANGE } from './voice-leading.js';

/**
 * Intervals (semitones) ordered from most to least consonant. The minor 2nd (1),
 * tritone (6) and major 7th (11) are left out entirely, so the distance mapping
 * physically cannot produce a harsh clash.
 */
export const CONSONANCE_LADDER = Object.freeze([0, 7, 4, 3, 5, 9, 8, 2, 10]);

/** Below this saturation a colour's hue is just noise (greys, whites, blacks). */
export const ACHROMATIC_SATURATION = 0.15;

/** Points closer together than this (mean distance) make chords one tone richer. */
export const TIGHT_SPREAD = 0.22;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

function assertFinite(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new TypeError(`${name} must be a finite number, got ${x}`);
  }
}

/**
 * Hue (0..360°) → root pitch class. The colour wheel is cut into twelve 30°
 * sectors laid out on the circle of fifths, so neighbouring hues give closely
 * related keys (a fifth apart) instead of keys a semitone apart.
 * 0° red → C, 30° orange → G, 60° yellow → D, 120° green → E …
 */
export function hueToRootPc(hue) {
  assertFinite(hue, 'hue');
  const sector = Math.round(mod(hue, 360) / 30) % 12;
  return (sector * 7) % 12;
}

/** Brightness and saturation (0..1) → index into MODES_BY_BRIGHTNESS (0 = brightest). */
export function brightnessToModeIndex(value, saturation = 0.5) {
  assertFinite(value, 'value');
  assertFinite(saturation, 'saturation');
  const b = clamp01(0.7 * value + 0.3 * saturation);
  const n = MODES_BY_BRIGHTNESS.length;
  return Math.min(n - 1, Math.floor((1 - b) * n));
}

/** A bright photo gets a bright mode, a dark photo a dark mode. */
export function brightnessToMode(value, saturation = 0.5) {
  return MODES_BY_BRIGHTNESS[brightnessToModeIndex(value, saturation)];
}

/** Shift a mode darker (+) or brighter (−) by whole steps on the brightness scale. */
export function shiftMode(mode, shift) {
  const i = MODES_BY_BRIGHTNESS.indexOf(mode);
  if (i < 0) throw new RangeError(`Unknown mode: ${mode}`);
  const n = MODES_BY_BRIGHTNESS.length;
  return MODES_BY_BRIGHTNESS[Math.min(n - 1, Math.max(0, i + shift))];
}

/**
 * Normalised distance (0..1, share of the frame diagonal) → interval in semitones.
 * Nearby objects give consonances, distant ones a gentler kind of tension.
 * A square-root curve spreads typical distances (0.05–0.4) across the whole
 * ladder; a linear one would turn almost every step into a perfect 5th.
 */
export function distanceToInterval(distance) {
  assertFinite(distance, 'distance');
  const n = CONSONANCE_LADDER.length;
  return CONSONANCE_LADDER[Math.min(n - 1, Math.floor(Math.sqrt(clamp01(distance)) * n))];
}

/** Pixel distance → share of the diagonal. Works for any resolution (photo or video). */
export function pixelDistanceToNormalized(px, width, height) {
  assertFinite(px, 'px');
  return clamp01(px / Math.hypot(width, height));
}

/** Distance between two points in normalised (0..1) coordinates, as a share of the diagonal. */
export function normalizedDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) / Math.SQRT2;
}

export function meanPairwiseDistance(points) {
  if (!points || points.length < 2) return 0.5;
  let sum = 0, n = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) { sum += normalizedDistance(points[i], points[j]); n++; }
  }
  return sum / n;
}

/** Tightly clustered points → chords get one extra colour tone (7th or 9th). */
export function spreadToExtension(spread) {
  assertFinite(spread, 'spread');
  return spread < TIGHT_SPREAD ? 1 : 0;
}

/** Chord degree for a colour relative to the key colour (seven 51° sectors of the wheel). */
export function colorToDegree(color, keyColor) {
  if (color.s < ACHROMATIC_SATURATION) return Math.round((1 - color.v) * 6) % 7;
  return Math.round(mod(color.h - keyColor.h, 360) / (360 / 7)) % 7;
}

/** Nearest note of the scale (tries below first, then above). */
export function quantizeToScale(midi, scalePcs) {
  for (const off of [0, -1, 1, -2, 2]) {
    if (scalePcs.includes(mod(midi + off, 12))) return midi + off;
  }
  return midi;
}

export function foldIntoRange(midi, low, high) {
  if (high - low < 12) throw new RangeError('range must span at least an octave');
  while (midi < low) midi += 12;
  while (midi > high) midi -= 12;
  return midi;
}

/** Tempo inside the style's range: energetic photos play faster. */
export function energyToTempo(energy, [low, high]) {
  assertFinite(energy, 'energy');
  return Math.round(low + clamp01(energy) * (high - low));
}

const VOCAB_SIZE = { triad: 3, seventh: 4, ninth: 5 };

/**
 * Builds the chord for one degree in the style's vocabulary.
 * Avoid-tones (a ♭9 above the root) are always dropped.
 * @returns {{pcs: number[], kind: string|undefined}}
 */
export function buildChord(rootPc, mode, degree, vocab, extension = 0) {
  const steps = MODES[mode];
  const pc = (step) => mod(rootPc + steps[mod(degree + step, 7)], 12);
  const root = pc(0);
  const ninthOk = mod(pc(1) - root, 12) !== 1;

  if (vocab === 'power') return { pcs: [root, pc(4), root], kind: 'power' };
  if (vocab === 'sus2' && ninthOk) return { pcs: [root, pc(1), pc(4)], kind: 'sus2' };
  if (vocab === 'add9') {
    const triad = diatonicChord(rootPc, mode, degree, 3);
    return { pcs: ninthOk ? [...triad, pc(1)] : triad, kind: 'add9' };
  }
  const size = Math.min(5, (VOCAB_SIZE[vocab] ?? 3) + extension);
  const pcs = diatonicChord(rootPc, mode, degree, size);
  return { pcs: pcs.filter((p, i) => i < 3 || mod(p - root, 12) !== 1), kind: undefined };
}

/** Perceived brightness (0..1) of a point's colour; 0.5 when unknown. */
export function pointBrightness(p) {
  const c = p.color;
  return c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 : 0.5;
}

/** A flat contour needs this much brightness difference between points to carry a melody. */
export const MIN_BRIGHTNESS_SPAN = 0.08;
/** Points count as a horizontal line when their height range is below this share of their width. */
export const FLAT_RATIO = 0.15;
/** Fallback melody shape (scale degrees) for layouts that carry no contour at all. */
export const FALLBACK_MOTIF = Object.freeze([0, 2, 4, 5, 4, 2, 1, 2, 4, 0]);

const minMax = (vals) => { const lo = Math.min(...vals), hi = Math.max(...vals); return { lo, hi, span: hi - lo }; };

/**
 * Reads the layout of the points relative to EACH OTHER rather than to the frame:
 *  • x is stretched so the leftmost point starts the phrase and the rightmost ends it
 *    (a tight cluster becomes a whole phrase instead of a burst of notes);
 *  • the melodic contour comes from height (higher = higher note) and, as a second
 *    voice, from brightness (brighter = higher). A horizontal line therefore still
 *    gets a contour from its colours;
 *  • if neither height nor brightness varies, there is no contour → fallback motif.
 */
export function pointLayout(keypoints) {
  const order = keypoints.map((p, i) => ({ ...p, pointIndex: i })).sort((a, b) => a.x - b.x);
  const n = order.length;
  const X = minMax(order.map((p) => p.x));
  const Y = minMax(order.map((p) => p.y));
  const B = minMax(order.map(pointBrightness));
  const xs = X.span > 0.02 ? order.map((p) => (p.x - X.lo) / X.span) : order.map((_, i) => (n > 1 ? i / (n - 1) : 0));
  const heightInfo = Y.span > 0.015 && Y.span >= FLAT_RATIO * X.span;
  const brightInfo = B.span >= MIN_BRIGHTNESS_SPAN;
  const hy = heightInfo ? order.map((p) => (Y.hi - p.y) / Y.span) : null;     // 1 = highest point
  const hb = brightInfo ? order.map((p) => (pointBrightness(p) - B.lo) / B.span) : null;
  let contour = null, contourFrom = null;
  if (hy && hb) { contour = hy.map((v, i) => 0.7 * v + 0.3 * hb[i]); contourFrom = 'height+brightness'; }
  else if (hy) { contour = hy; contourFrom = 'height'; }
  else if (hb) { contour = hb; contourFrom = 'brightness'; }
  const cluster = n > 1 && X.span < 0.2 && Y.span < 0.2;
  return {
    order, xs, contour, contourFrom,
    fallback: n >= 2 && !contour ? (cluster ? 'cluster' : 'line') : null,
    stretchedX: n > 1 && X.span < 0.75, cluster, horizontal: n > 1 && !heightInfo,
    spans: { x: X.span, y: Y.span, brightness: B.span },
  };
}

/** Scale degree → MIDI note, counting scale steps up/down from a base note. */
function degreeToMidi(base, degree, scalePcs) {
  let m = quantizeToScale(base, scalePcs);
  const dir = Math.sign(degree);
  for (let k = 0; k < Math.abs(degree); k++) {
    do { m += dir; } while (!scalePcs.includes(mod(m, 12)));
  }
  return m;
}

/**
 * Melody: points of interest are read left to right, like a score.
 * Returns the notes plus the edges between consecutive points (with the
 * interval actually played) and a description of how the layout was read.
 */
export function buildMelody(keypoints, scalePcs, { low = 64, high = 88, steps = 32 } = {}) {
  if (!keypoints?.length) return { notes: [], edges: [], info: { contourFrom: null, fallback: null } };
  const L = pointLayout(keypoints);
  const { order, xs, contour } = L;
  const phraseEnd = steps - 4;                     // leave the last beat as a breath before the loop
  const used = new Set();
  const placeStep = (x) => {
    let step = Math.round(x * phraseEnd);
    for (let d = 0; d < steps; d++) {               // nearest free 16th, later first
      for (const c of [step + d, step - d]) if (c >= 0 && c < steps && !used.has(c)) { used.add(c); return c; }
    }
    return step;
  };

  const notes = [], edges = [];
  let prev = null, lastDir = 1;
  order.forEach((p, i) => {
    let midi, interval = 0, distance = 0;
    if (!contour) {
      // no usable height or brightness differences: a simple melodic motif keeps it musical
      midi = foldIntoRange(degreeToMidi(Math.round((low + high) / 2), FALLBACK_MOTIF[i % FALLBACK_MOTIF.length], scalePcs), low, high);
      if (prev !== null) interval = Math.min(12, Math.abs(midi - prev));
    } else {
      const target = low + contour[i] * (high - low);
      if (prev === null) {
        midi = quantizeToScale(Math.round(target), scalePcs);
      } else {
        // the "visual distance" in the stretched layout (position + contour) picks the interval size…
        distance = Math.hypot(xs[i] - xs[i - 1], contour[i] - contour[i - 1]) / Math.SQRT2 * 0.6;
        interval = distanceToInterval(distance);
        // …and the contour picks the direction (ties alternate, so a repeated level does not keep climbing)
        const dir = Math.abs(target - prev) < 1 ? -lastDir : Math.sign(target - prev);
        midi = quantizeToScale(foldIntoRange(prev + dir * interval, low, high), scalePcs);
        lastDir = dir;
      }
    }
    if (i > 0) edges.push({ from: order[i - 1].pointIndex, to: p.pointIndex, distance, interval: Math.abs(interval) });
    notes.push({ midi, step: placeStep(xs[i]), interval, velocity: 0.35 + 0.5 * clamp01(p.score ?? 0.5), pointIndex: p.pointIndex });
    prev = midi;
  });
  notes.sort((a, b) => a.step - b.step);
  return {
    notes, edges,
    info: { contourFrom: L.contourFrom, fallback: L.fallback, stretchedX: L.stretchedX, cluster: L.cluster, horizontal: L.horizontal, spans: L.spans },
  };
}

/** Path edges between points (left to right) as they are played. */
export function pathEdges(keypoints, scalePcs = scalePitchClasses(0, 'ionian')) {
  return buildMelody(keypoints, scalePcs).edges;
}

function weightedMean(palette, key) {
  const w = palette.reduce((s, c) => s + c.weight, 0) || 1;
  return palette.reduce((s, c) => s + c[key] * c.weight, 0) / w;
}

/** Power chords always stay in root position: root, fifth, octave — the root nearest the last bass note. */
function powerVoicing(rootPc, prev, range) {
  const target = prev?.length ? Math.min(...prev) : range.low + 5;
  let root = target + mod(rootPc - target, 12);
  if (root - target > 6) root -= 12;
  while (root < range.low) root += 12;
  while (root + 12 > range.high && root - 12 >= range.low) root -= 12;
  return [root, root + 7, root + 12];
}

/** Neutral style used when none is given (keeps the core usable on its own). */
const NEUTRAL_STYLE = { id: 'neutral', tempo: [70, 110], modeShift: 0, vocab: 'triad', register: DEFAULT_RANGE };

/**
 * Main entry: analysed frame (+ style) → score.
 * @param {{palette, keypoints, features?}} analysis
 * @param {{style?, maxChords?, prevVoicing?}} options
 *   prevVoicing — last chord of the previous photo/frame, for a smooth hand-over.
 */
/**
 * @param {object} options
 *   mood           -2…+2: the user's mood slider (+ brighter, − darker), on top of the photo and the style
 *   chordOverrides { [paletteIndex]: degree } chords picked by hand in Edit mode
 */
export function buildMusicalScore(analysis, { style = NEUTRAL_STYLE, maxChords = 4, prevVoicing = null, mood = 0, chordOverrides = {} } = {}) {
  const { palette, keypoints = [], features } = analysis ?? {};
  if (!palette?.length) throw new Error('palette is empty');

  // Key
  const keyColor = palette.find((c) => c.s >= ACHROMATIC_SATURATION) ?? palette[0];
  const chromaticKey = keyColor.s >= ACHROMATIC_SATURATION;
  const rootPc = chromaticKey ? hueToRootPc(keyColor.h) : 0;

  // Mode
  const avgV = weightedMean(palette, 'v');
  const avgS = weightedMean(palette, 's');
  const photoMode = brightnessToMode(avgV, avgS);
  const moodSteps = Math.round(Math.max(-2, Math.min(2, mood)));
  const mode = shiftMode(photoMode, (style.modeShift ?? 0) - moodSteps);
  const scale = scalePitchClasses(rootPc, mode);

  // Tempo
  const energy = features
    ? (features.contrast + features.saturation + features.sharpness) / 3
    : clamp01(avgS);
  const tempo = energyToTempo(energy, style.tempo);

  // Chords
  const spread = meanPairwiseDistance(keypoints);
  const extension = spreadToExtension(spread);
  const colors = [keyColor, ...palette.filter((c) => c !== keyColor)].slice(0, maxChords);
  const chords = [];
  let prevDegree = -1;
  colors.forEach((color, idx) => {
    const isLast = idx === colors.length - 1 && idx > 0;
    const rawDegree = color === keyColor ? 0 : colorToDegree(color, keyColor);
    const paletteIndex = palette.indexOf(color);
    const override = chordOverrides[paletteIndex];
    let degree = rawDegree;
    const reasons = [];
    if (Number.isInteger(override) && override >= 0 && override < 7 && !isDiminished(diatonicChord(rootPc, mode, override, 3))) {
      degree = override;
      reasons.push('chosen');
    } else
    // Avoid repeating a chord (also across the loop seam) and diminished triads.
    // Moving down a third keeps two common tones (vii° → V, ii° → VII …).
    for (let t = 0; t < 7; t++) {
      const triad = diatonicChord(rootPc, mode, degree, 3);
      if (isDiminished(triad)) { reasons.push('diminished'); degree = (degree + 5) % 7; continue; }
      if (degree === prevDegree) { reasons.push('repeat'); degree = (degree + 5) % 7; continue; }
      if (isLast && degree === 0) { reasons.push('loop'); degree = (degree + 5) % 7; continue; }
      break;
    }
    const { pcs, kind } = buildChord(rootPc, mode, degree, style.vocab, extension);
    chords.push({
      degree, rawDegree, substituted: reasons.filter((r) => r !== 'chosen'), chosen: reasons.includes('chosen'), paletteIndex, pcs, kind,
      symbol: chordSymbol(pcs, kind), roman: romanNumeral(degree, pcs),
      bars: color.weight >= 0.3 ? 2 : 1, color,
      hueOffset: chromaticKey && color.s >= ACHROMATIC_SATURATION ? mod(color.h - keyColor.h, 360) : null,
    });
    prevDegree = degree;
  });

  // Voice leading. Without prevVoicing we run two passes so the loop seam
  // (last chord → first chord) is smooth as well.
  const range = style.register ?? DEFAULT_RANGE;
  const passes = prevVoicing ? 1 : 2;
  let prev = prevVoicing;
  for (let pass = 0; pass < passes; pass++) {
    for (const ch of chords) {
      ch.voicing = ch.kind === 'power' ? powerVoicing(ch.pcs[0], prev, range) : voiceLead(prev, ch.pcs, range);
      prev = ch.voicing;
    }
  }

  const melody = buildMelody(keypoints, scale);
  return {
    styleId: style.id,
    key: { rootPc, mode, name: `${pcName(rootPc)} ${MODE_NAMES[mode]}` },
    scale, tempo, spread, chords,
    melody: melody.notes,
    edges: melody.edges,
    melodyInfo: melody.info,
    totalBars: chords.reduce((s, c) => s + c.bars, 0),
    decisions: {
      keyColor, chromaticKey, hueSector: chromaticKey ? Math.round(mod(keyColor.h, 360) / 30) % 12 : null,
      avgV, avgS, photoMode, modeShift: style.modeShift ?? 0, mood: moodSteps, mode,
      energy, tempoRange: style.tempo, vocab: style.vocab, extension, spread,
    },
  };
}
