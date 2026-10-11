/**
 * Style library + automatic style selection.
 *
 * A style never changes WHAT the photo says (key, chord roots, melody shape —
 * those come from mapping.js). It changes HOW it is played: tempo range,
 * how dark the mode is, the chord vocabulary, rhythm patterns and instruments.
 *
 * Each style has a "visual profile": the photo fingerprint (see
 * vision/features.js) it fits best. Auto-selection picks the style whose
 * profile is closest to the photo, using a weighted mean absolute distance.
 *
 * Pattern strings are one bar of 16th notes:
 *   chords/bass/drums  'x' hit, '.' rest; chords also 'X' = accented hit that rings on
 *   bass               'x' root, 'o' root an octave up, 'f' fifth, 'w' walking bass (quarters)
 *   hats               'x' closed, 'o' open, 'r' 32nd-note roll, 't' triplet roll
 * points: what the photo's points of interest play by default — 'melody' (pitched instrument) or
 *         'drums' (hits chosen by height: pointDrums.high / .low, plus an accent on the strongest point).
 * swing: 0..1 (1 = full triplet feel), applied to off-beat 16ths (or 8ths when swingUnit = 8).
 * A 32-character pattern spans two bars.
 */

/** profile: [target 0..1, weight]. Weight 2 = signature trait, 1 = normal, 0.5 = loose. */
export const STYLES = Object.freeze([
  {
    id: 'classical-piano', name: 'Classical Piano',
    blurb: 'Solo grand piano: flowing Alberti-bass arpeggios with the melody on top. No drums.',
    whyText: 'calm, natural-looking photos with gentle colour',
    profile: { brightness: [0.6, 1], contrast: [0.5, 1], saturation: [0.25, 2], colorfulness: [0.2, 1], warmth: [0.55, 0.5], sharpness: [0.4, 1], grain: [0.35, 0.5], complexity: [0.2, 1] },
    tempo: [66, 92], modeShift: 0, vocab: 'triad', register: { low: 48, high: 84 },
    chords: { type: 'arp', shape: 'alberti', rate: 2 },
    bass: null, drums: null, swing: 0,
    humanize: { time: 0.08, vel: 0.2 },
    melody: { octave: 0, dur: 3 },
    sound: { chords: 'piano', bass: null, kit: null, melody: 'piano' },
    fx: { reverb: [3.5, 0.3], delay: 0, distortion: 0, chorus: 0, lowpass: 12000, vibrato: 0, pump: false },
  },
  {
    id: 'cinematic', name: 'Cinematic',
    blurb: 'Orchestral: cello and violin swells, bowed contrabass, a French horn melody and deep taiko hits.',
    whyText: 'dramatic, high-contrast, restrained-colour scenes',
    profile: { brightness: [0.45, 1], contrast: [0.95, 2], saturation: [0.2, 1], colorfulness: [0.15, 1], warmth: [0.5, 0.5], sharpness: [0.35, 1], grain: [0.4, 1], complexity: [0.2, 1] },
    tempo: [60, 80], modeShift: 1, vocab: 'add9', register: { low: 43, high: 79 },
    chords: { type: 'sustain' },
    bass: { pattern: 'x...............', dur: 16 }, drums: { kick: 'x.........x.x...', snare: null, hat: null }, swing: 0,
    humanize: { time: 0.05, vel: 0.15 },
    melody: { octave: -24, dur: 4 },
    sound: { chords: 'strings', bass: 'contrabass', kit: 'taiko', melody: 'horn' },
    fx: { reverb: [8, 0.45], delay: 0.15, distortion: 0, chorus: 0.2, lowpass: 9000, vibrato: 0, pump: false },
  },
  {
    id: 'ambient', name: 'Ambient',
    blurb: 'A slow, weightless pad with lush ninth chords and a harp melody drifting through a long reverb. No beat.',
    whyText: 'soft, low-contrast, minimal images',
    profile: { brightness: [0.55, 1], contrast: [0.15, 2], saturation: [0.3, 0.5], colorfulness: [0.25, 0.5], warmth: [0.5, 0.5], sharpness: [0.1, 2], grain: [0.05, 1], complexity: [0.05, 1.5] },
    tempo: [56, 70], modeShift: -1, vocab: 'ninth', register: { low: 45, high: 81 },
    chords: { type: 'sustain' },
    bass: null, drums: null, swing: 0,
    melody: { octave: 0, dur: 6 },
    sound: { chords: 'pad', bass: null, kit: null, melody: 'harp' },
    fx: { reverb: [12, 0.55], delay: 0.35, distortion: 0, chorus: 0.4, lowpass: 7000, vibrato: 0, pump: false },
  },
  {
    id: 'shoegaze', name: 'Shoegaze',
    blurb: 'A wall of fuzzy, chorused electric guitars drowned in reverb over bass and washed-out live drums, with a bowed violin line floating inside it.',
    whyText: 'blurry, hazy, warm or glowing photos',
    profile: { brightness: [0.6, 1], contrast: [0.45, 0.5], saturation: [0.55, 1], colorfulness: [0.5, 1], warmth: [0.75, 1], sharpness: [0.05, 2], grain: [0.05, 1], complexity: [0.15, 0.5] },
    tempo: [72, 92], modeShift: 0, vocab: 'add9', register: { low: 47, high: 79 },
    chords: { type: 'hits', pattern: 'x.x.x.x.x.x.x.x.', dur: 3 },
    bass: { pattern: 'x.......x.......', dur: 8 },
    drums: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, swing: 0,
    humanize: { time: 0.1, vel: 0.15 },
    melody: { octave: 0, dur: 6 },
    sound: { chords: 'fuzzGuitar', bass: 'electricBass', kit: 'washed', melody: 'violin' },
    fx: { reverb: [10, 0.5], delay: 0.25, distortion: 0, chorus: 0.8, lowpass: 3200, vibrato: 0.1, pump: false },
  },
  {
    id: 'dream-pop', name: 'Dream Pop',
    blurb: 'Shimmering clean electric-guitar arpeggios, bass guitar, a soft live kit and a glockenspiel-like xylophone melody.',
    whyText: 'bright, pastel, slightly soft photos',
    profile: { brightness: [0.75, 2], contrast: [0.4, 1], saturation: [0.45, 1], colorfulness: [0.45, 1], warmth: [0.65, 0.5], sharpness: [0.25, 1], grain: [0.15, 1], complexity: [0.25, 0.5] },
    tempo: [82, 100], modeShift: -1, vocab: 'seventh', register: { low: 50, high: 84 },
    chords: { type: 'arp', shape: 'up', rate: 2 },
    bass: { pattern: 'x.....x.x.......', dur: 4 },
    drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.' }, swing: 0,
    humanize: { time: 0.08, vel: 0.15 },
    melody: { octave: 0, dur: 4 },
    sound: { chords: 'cleanGuitar', bass: 'electricBass', kit: 'soft', melody: 'xylophone' },
    fx: { reverb: [6, 0.4], delay: 0.3, distortion: 0, chorus: 0.6, lowpass: 9000, vibrato: 0, pump: false },
  },
  {
    id: 'indie-rock', name: 'Indie Rock',
    blurb: 'Two crunchy strummed electric guitars, driving 8th-note bass and a live-sounding rock kit.',
    whyText: 'everyday, textured, medium-contrast scenes',
    profile: { brightness: [0.55, 1], contrast: [0.6, 1], saturation: [0.4, 1], colorfulness: [0.45, 1], warmth: [0.7, 1], sharpness: [0.7, 1.5], grain: [0.6, 1], complexity: [0.4, 1] },
    tempo: [112, 132], modeShift: 0, vocab: 'triad', register: { low: 48, high: 76 },
    chords: { type: 'hits', pattern: 'X..x..x.X..x..x.', strum: true },
    bass: { pattern: 'x.x.x.x.x.x.x.x.', dur: 2 },
    drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', crash: true, fill: true }, swing: 0,
    humanize: { time: 0.12, vel: 0.15 },
    points: 'drums', pointDrums: { high: 'tom', low: 'tom', accent: 'crash' },
    melody: { octave: 0, dur: 3 },
    sound: { chords: 'crunchGuitar', bass: 'rockBass', kit: 'rock', melody: 'guitarLead' },
    fx: { reverb: [2.2, 0.18], delay: 0.12, distortion: 0, chorus: 0, lowpass: 12000, vibrato: 0, pump: false },
  },
  {
    id: 'hard-rock', name: 'Hard Rock',
    blurb: 'Double-tracked high-gain guitars: ringing power chords with palm-muted gallops, a growling bass, crashes and tom fills.',
    whyText: 'dark, harsh, gritty, high-contrast images',
    profile: { brightness: [0.35, 1], contrast: [0.9, 2], saturation: [0.35, 0.5], colorfulness: [0.35, 0.5], warmth: [0.6, 0.5], sharpness: [0.9, 1.5], grain: [0.85, 2], complexity: [0.45, 1] },
    tempo: [124, 150], modeShift: 1, vocab: 'power', register: { low: 40, high: 64 },
    chords: { type: 'hits', pattern: 'X.xxX.x.X.xxX.x.', palmMute: true },
    bass: { pattern: 'x.xxx.x.x.xxx.x.', dur: 2 },
    drums: { kick: 'x.xxx.x.x.xxx.x.', snare: '....x.......x...', hat: 'o.x.x.x.o.x.x.x.', crash: true, fill: true }, swing: 0,
    humanize: { time: 0.1, vel: 0.12 },
    points: 'drums', pointDrums: { high: 'tom', low: 'tom', accent: 'crash' },
    melody: { octave: 0, dur: 3 },
    sound: { chords: 'rockGuitar', bass: 'rockBass', kit: 'rock', melody: 'guitarLead' },
    fx: { reverb: [1.8, 0.15], delay: 0.08, distortion: 0, chorus: 0, lowpass: 12000, vibrato: 0, pump: false },
  },
  {
    id: 'pop', name: 'Pop',
    blurb: 'Bright syncopated piano chords, bass guitar, punchy pop drums with clap and a pumping mix.',
    whyText: 'bright, vivid, colourful and clean photos',
    profile: { brightness: [0.65, 1.5], contrast: [0.6, 1], saturation: [0.85, 1.5], colorfulness: [0.8, 1.5], warmth: [0.65, 0.5], sharpness: [0.45, 1], grain: [0.35, 1], complexity: [0.4, 0.5] },
    tempo: [100, 122], modeShift: -1, vocab: 'add9', register: { low: 52, high: 79 },
    chords: { type: 'hits', pattern: 'x..x..x...x..x..', dur: 2 },
    bass: { pattern: 'x..x..x...x.....', dur: 2 },
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' }, swing: 0,
    humanize: { time: 0.03, vel: 0.08 },
    melody: { octave: 0, dur: 2 },
    sound: { chords: 'piano', bass: 'electricBass', kit: 'pop', melody: 'piano' },
    fx: { reverb: [2.5, 0.25], delay: 0.2, distortion: 0, chorus: 0.3, lowpass: 14000, vibrato: 0, pump: true },
  },
  {
    id: 'synthwave', name: 'Synthwave',
    blurb: '80s retro: supersaw synth chords, rolling octave synth bass and a real LinnDrum machine (synthwave is meant to sound synthetic).',
    whyText: 'neon, saturated, cool-toned or night colours',
    profile: { brightness: [0.3, 1], contrast: [0.5, 0.5], saturation: [0.8, 1.5], colorfulness: [0.7, 1.5], warmth: [0.25, 2], sharpness: [0.25, 0.5], grain: [0.2, 0.5], complexity: [0.5, 1] },
    tempo: [96, 116], modeShift: 1, vocab: 'seventh', register: { low: 50, high: 79 },
    chords: { type: 'sustain' },
    bass: { pattern: 'xoxoxoxoxoxoxoxo', dur: 1 },
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, swing: 0,
    melody: { octave: 0, dur: 3 },
    sound: { chords: 'supersaw', bass: 'synth', kit: 'linn', melody: 'square' },
    fx: { reverb: [4, 0.35], delay: 0.3, distortion: 0, chorus: 0.5, lowpass: 7000, vibrato: 0, pump: false },
  },
  {
    id: 'house', name: 'House',
    blurb: "Classic house: offbeat piano stabs, synth bass, a four-on-the-floor drum machine with claps and open hi-hats; the photo's points add percussion (claps, toms, a ride accent).",
    whyText: 'busy, colourful, energetic images',
    profile: { brightness: [0.5, 1], contrast: [0.7, 1], saturation: [0.65, 1], colorfulness: [0.65, 1], warmth: [0.5, 0.5], sharpness: [0.65, 1], grain: [0.6, 0.5], complexity: [0.85, 2] },
    tempo: [120, 126], modeShift: 0, vocab: 'seventh', register: { low: 53, high: 79 },
    chords: { type: 'hits', pattern: '..x...x...x...x.', dur: 1 },
    bass: { pattern: '..x...x...x...x.', dur: 1 },
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' }, swing: 0.3,
    points: 'drums', pointDrums: { high: 'clap', low: 'tom', accent: 'ride' },
    melody: { octave: 0, dur: 1 },
    sound: { chords: 'piano', bass: 'synth', kit: 'house', melody: 'piano' },
    fx: { reverb: [2, 0.2], delay: 0.2, distortion: 0, chorus: 0, lowpass: 12000, vibrato: 0, pump: true },
  },
  {
    id: 'jazz', name: 'Jazz',
    blurb: 'Jazz combo: swung piano comping, a walking bass line, brushes on the snare and ride cymbal; the points of the photo become the drummer answering the band (brush accents on snare and toms, a ride crash on the strongest point).',
    whyText: 'warm, dim, amber-toned, moody scenes',
    profile: { brightness: [0.3, 1.5], contrast: [0.45, 0.5], saturation: [0.65, 1], colorfulness: [0.45, 0.5], warmth: [0.9, 2], sharpness: [0.35, 0.5], grain: [0.35, 0.5], complexity: [0.2, 0.5] },
    tempo: [100, 132], modeShift: 0, vocab: 'ninth', register: { low: 50, high: 76 },
    chords: { type: 'hits', pattern: 'x.....x...x.....', dur: 3 },
    bass: { pattern: 'w', dur: 4 },
    drums: { kick: null, snare: '..........x.....', hat: 'x...x.x.x...x.x.' }, swing: 0.9, swingUnit: 8,
    humanize: { time: 0.1, vel: 0.2 },
    points: 'drums', pointDrums: { high: 'snare', low: 'tom', accent: 'ride' },
    melody: { octave: -12, dur: 3 },
    sound: { chords: 'piano', bass: 'upright', kit: 'brushes', melody: 'saxophone' },
    fx: { reverb: [2.5, 0.25], delay: 0, distortion: 0, chorus: 0, lowpass: 9000, vibrato: 0, pump: false },
  },
  {
    id: 'lofi', name: 'Lo-fi Hip-Hop',
    blurb: 'Dusty, muffled piano chords, a mellow bass, lazy swung breakbeat drums, a nylon-guitar melody and tape wobble.',
    whyText: 'warm, slightly faded, softly textured photos',
    profile: { brightness: [0.55, 1], contrast: [0.3, 1.5], saturation: [0.5, 0.5], colorfulness: [0.35, 0.5], warmth: [0.85, 1.5], sharpness: [0.35, 1], grain: [0.35, 1], complexity: [0.15, 0.5] },
    tempo: [70, 86], modeShift: 0, vocab: 'seventh', register: { low: 50, high: 76 },
    chords: { type: 'hits', pattern: 'x.........x.....', dur: 10 },
    bass: { pattern: 'x.....x...x.....', dur: 3 },
    drums: { kick: 'x......xx.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, swing: 0.6,
    humanize: { time: 0.12, vel: 0.15 },
    melody: { octave: -12, dur: 3 },
    sound: { chords: 'piano', bass: 'upright', kit: 'lofi', melody: 'nylonGuitar' },
    fx: { reverb: [2, 0.25], delay: 0.15, distortion: 0, chorus: 0.2, lowpass: 2600, vibrato: 0.15, pump: false },
  },
  {
    id: 'boom-bap', name: 'Boom Bap',
    blurb: "90s hip-hop: hard breakbeat kick and snare, chopped piano stabs and swung hats; the photo's points add extra snare and tom hits, like a producer chopping drums.",
    whyText: 'gritty, black-and-white or desaturated, textured photos',
    profile: { brightness: [0.5, 0.5], contrast: [0.7, 1], saturation: [0.05, 1.5], colorfulness: [0.05, 1], warmth: [0.5, 0.5], sharpness: [0.7, 1], grain: [0.8, 2], complexity: [0.25, 0.5] },
    tempo: [86, 96], modeShift: 1, vocab: 'seventh', register: { low: 50, high: 76 },
    chords: { type: 'hits', pattern: 'x.......x.....x.', dur: 2 },
    bass: { pattern: 'x......x..x.....', dur: 3 },
    drums: { kick: 'x......x.x......', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' }, swing: 0.5,
    humanize: { time: 0.05, vel: 0.1 },
    points: 'drums', pointDrums: { high: 'snare', low: 'tom', accent: 'clap' },
    melody: { octave: -12, dur: 2 },
    sound: { chords: 'piano', bass: 'electricBass', kit: 'boombap', melody: 'saxophone' },
    fx: { reverb: [1.5, 0.15], delay: 0, distortion: 0, chorus: 0, lowpass: 5000, vibrato: 0, pump: false },
  },
  {
    id: 'trap', name: 'Trap',
    blurb: 'Dark orchestral strings over a half-time beat, booming 808 bass, rattling hi-hat rolls and a flute melody.',
    whyText: 'very dark, cold, high-contrast night images',
    profile: { brightness: [0.1, 2], contrast: [0.3, 0.5], saturation: [0.55, 0.5], colorfulness: [0.25, 0.5], warmth: [0.35, 1.5], sharpness: [0.15, 0.5], grain: [0.15, 0.5], complexity: [0.15, 0.5] },
    tempo: [130, 150], modeShift: 2, vocab: 'triad', register: { low: 52, high: 76 },
    chords: { type: 'sustain' },
    bass: { pattern: 'x.....x...x.....', dur: 6, glide: true },
    drums: { kick: 'x.....x...x.....', snare: '........x.......', hat: 'x.x.x.x.x.rxx.x.x.x.x.x.x.t.x.xr' }, swing: 0,
    melody: { octave: 0, dur: 2 },
    sound: { chords: 'strings', bass: '808', kit: '808', melody: 'flute' },
    fx: { reverb: [3, 0.3], delay: 0.2, distortion: 0, chorus: 0, lowpass: 6000, vibrato: 0, pump: false },
  },
  {
    id: 'folk', name: 'Folk / Acoustic',
    blurb: "Two acoustic guitars: one fingerpicks the chords, the other plays the photo's melody; a mellow bass and a shaker.",
    whyText: 'natural, earthy, sunlit outdoor scenes',
    profile: { brightness: [0.6, 1], contrast: [0.5, 0.5], saturation: [0.45, 1], colorfulness: [0.35, 1], warmth: [0.6, 1], sharpness: [0.6, 1], grain: [0.55, 1], complexity: [0.35, 1] },
    tempo: [84, 106], modeShift: 0, vocab: 'triad', register: { low: 48, high: 79 },
    chords: { type: 'arp', shape: 'broken', rate: 2 },
    bass: { pattern: 'x.......f.......', dur: 6 },
    drums: { kick: null, snare: null, hat: 'xxxxxxxxxxxxxxxx' }, swing: 0.3,
    humanize: { time: 0.1, vel: 0.15 },
    melody: { octave: -12, dur: 3 },
    sound: { chords: 'acousticGuitar', bass: 'upright', kit: 'shaker', melody: 'acousticGuitar' },
    fx: { reverb: [2, 0.2], delay: 0, distortion: 0, chorus: 0, lowpass: 9000, vibrato: 0, pump: false },
  },
]);

export const STYLE_BY_ID = Object.freeze(Object.fromEntries(STYLES.map((s) => [s.id, s])));

export function getStyle(id) {
  const s = STYLE_BY_ID[id];
  if (!s) throw new RangeError(`Unknown style: ${id}`);
  return s;
}

/**
 * Similarity of a photo fingerprint to one style profile, 0..1.
 * Also returns per-feature contributions so the UI can explain the choice.
 */
export function styleSimilarity(features, style) {
  let num = 0, den = 0;
  const parts = [];
  for (const [id, [target, weight]] of Object.entries(style.profile)) {
    const value = features[id];
    if (typeof value !== 'number') continue;
    const closeness = 1 - Math.abs(value - target);
    num += weight * closeness; den += weight;
    parts.push({ id, value, target, weight, closeness });
  }
  return { score: den ? num / den : 0, parts };
}

/**
 * Ranks every style for this photo.
 * @returns {{best, ranking: Array<{style, score, parts}>}} best === ranking[0]
 */
export function classifyStyle(features) {
  const ranking = STYLES
    .map((style) => ({ style, ...styleSimilarity(features, style) }))
    .sort((a, b) => b.score - a.score || a.style.id.localeCompare(b.style.id));
  return { best: ranking[0], ranking };
}

/**
 * The traits that make a style fit (heavily weighted and close) and the one
 * that fits worst — used for the human-readable explanation.
 */
export function styleReasons(match, count = 3) {
  const supporting = match.parts
    .filter((p) => p.closeness >= 0.75)
    .sort((a, b) => b.weight * b.closeness - a.weight * a.closeness)
    .slice(0, count);
  const worst = [...match.parts].sort((a, b) => a.weight * a.closeness - b.weight * b.closeness)[0];
  return { supporting, worst: worst && worst.closeness < 0.7 ? worst : null };
}
