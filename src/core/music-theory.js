/**
 * Music theory basics. Pure functions: no DOM, no Tone.js.
 * Pitches are MIDI numbers (60 = C4); pitch classes (pc) are 0..11.
 */

export const NOTE_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/**
 * Modes ordered from brightest to darkest (Persichetti's brightness scale).
 * Locrian is left out on purpose: its tonic chord is diminished.
 */
export const MODES = Object.freeze({
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  ionian:     [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  aeolian:    [0, 2, 3, 5, 7, 8, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
});

export const MODES_BY_BRIGHTNESS = Object.freeze(Object.keys(MODES));

export const MODE_NAMES = Object.freeze({
  lydian: 'Lydian', ionian: 'major', mixolydian: 'Mixolydian',
  dorian: 'Dorian', aeolian: 'minor', phrygian: 'Phrygian',
});

export const MODE_MOODS = Object.freeze({
  lydian: 'dreamy and floating', ionian: 'bright and open', mixolydian: 'sunny with a bluesy edge',
  dorian: 'cool and soulful', aeolian: 'melancholic', phrygian: 'dark and tense',
});

/** Modulo that is correct for negative numbers. */
export const mod = (n, m) => ((n % m) + m) % m;

export const pcName = (pc) => NOTE_NAMES[mod(pc, 12)];

export const midiToName = (midi) => `${pcName(midi)}${Math.floor(midi / 12) - 1}`;

export function scalePitchClasses(rootPc, mode) {
  const steps = MODES[mode];
  if (!steps) throw new RangeError(`Unknown mode: ${mode}`);
  return steps.map((s) => mod(rootPc + s, 12));
}

/**
 * Diatonic chord on a scale degree, stacked in thirds.
 * size: 3 = triad, 4 = seventh, 5 = ninth. Returns pitch classes, root first.
 */
export function diatonicChord(rootPc, mode, degree, size = 3) {
  const steps = MODES[mode];
  if (!steps) throw new RangeError(`Unknown mode: ${mode}`);
  const pcs = [];
  for (let i = 0; i < size; i++) pcs.push(mod(rootPc + steps[mod(degree + 2 * i, 7)], 12));
  return pcs;
}

export function isDiminished(pcs) {
  const [root, third, fifth] = pcs;
  return mod(third - root, 12) === 3 && mod(fifth - root, 12) === 6;
}

export function isMinor(pcs) {
  return mod(pcs[1] - pcs[0], 12) === 3;
}

/**
 * Chord symbol: Am7, Cmaj7(9), Bm7♭5, G5, Dadd9, Esus2 …
 * kind: 'power' | 'add9' | 'sus2' | undefined (stacked thirds)
 */
export function chordSymbol(pcs, kind) {
  const root = pcs[0];
  if (kind === 'power') return `${pcName(root)}5`;
  if (kind === 'sus2') return `${pcName(root)}sus2`;
  const [, third, fifth, seventh, ninth] = pcs;
  const i3 = mod(third - root, 12);
  const i5 = mod(fifth - root, 12);
  const quality = i3 === 3 ? (i5 === 6 ? 'dim' : 'm') : (i5 === 8 ? 'aug' : '');
  let s = pcName(root);
  if (kind === 'add9') return s + quality + (pcs.length > 3 ? 'add9' : '');
  if (seventh === undefined) return s + quality;
  const i7 = mod(seventh - root, 12);
  if (quality === 'dim') s += i7 === 10 ? 'm7♭5' : 'dim7';
  else if (quality === 'm') s += i7 === 10 ? 'm7' : 'm(maj7)';
  else s += quality + (i7 === 11 ? 'maj7' : '7');
  if (ninth !== undefined) s += mod(ninth - root, 12) === 1 ? '(♭9)' : '(9)';
  return s;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Roman numeral: lower case for minor chords, ° for diminished. */
export function romanNumeral(degree, pcs) {
  const r = ROMAN[mod(degree, 7)];
  if (isDiminished(pcs)) return `${r.toLowerCase()}°`;
  return isMinor(pcs) ? r.toLowerCase() : r;
}

/** Interval names (in semitones). */
export const INTERVAL_NAMES = Object.freeze({
  0: 'unison', 1: 'minor 2nd', 2: 'major 2nd', 3: 'minor 3rd', 4: 'major 3rd',
  5: 'perfect 4th', 6: 'tritone', 7: 'perfect 5th', 8: 'minor 6th', 9: 'major 6th',
  10: 'minor 7th', 11: 'major 7th', 12: 'octave',
});

export const INTERVAL_SHORT = Object.freeze({
  0: 'P1', 1: 'm2', 2: 'M2', 3: 'm3', 4: 'M3', 5: 'P4', 6: 'TT',
  7: 'P5', 8: 'm6', 9: 'M6', 10: 'm7', 11: 'M7', 12: 'P8',
});
