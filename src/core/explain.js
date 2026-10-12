/**
 * Human-readable explanations of every decision ("Why it sounds like this").
 * Pure: takes the analysis, the style choice and the score, returns text.
 * Strings may contain **bold** markers; the UI escapes HTML and renders them.
 */
import { FEATURES } from '../vision/features.js';
import { styleReasons } from './styles.js';
import { pcName, MODE_NAMES, MODE_MOODS, MODES_BY_BRIGHTNESS, INTERVAL_NAMES, midiToName } from './music-theory.js';
import { CONSONANCE_LADDER, TIGHT_SPREAD } from './mapping.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const f2 = (x) => x.toFixed(2);
const FEATURE_BY_ID = Object.fromEntries(FEATURES.map((f) => [f.id, f]));

const HUE_NAMES = ['red', 'orange', 'yellow', 'lime', 'green', 'spring green', 'cyan', 'sky blue', 'blue', 'violet', 'magenta', 'pink'];

/** Plain-language colour name for a palette entry. */
export function colorName(c) {
  if (c.s < 0.15) return c.v > 0.8 ? 'white' : c.v < 0.2 ? 'black' : 'grey';
  const base = HUE_NAMES[Math.round(c.h / 30) % 12];
  if (c.v < 0.35) return `dark ${base}`;
  if (c.s < 0.35 && c.v > 0.7) return `pale ${base}`;
  return base;
}

export function level(v) {
  return v < 0.2 ? 'very low' : v < 0.4 ? 'low' : v < 0.6 ? 'medium' : v < 0.8 ? 'high' : 'very high';
}

/** "blurry, hazy" / "moderately sharp" / "crisp": plain words for a feature value. */
export function featureWord(id, value) {
  const f = FEATURE_BY_ID[id];
  if (value >= 0.6) return f.high;
  if (value <= 0.4) return f.low;
  return f.mid;
}

export const VOCAB_TEXT = {
  triad: 'simple three-note triads',
  seventh: 'seventh chords (four notes) for a smoother, richer colour',
  ninth: 'ninth chords (five notes): lush and open',
  add9: 'add9 chords (a triad plus the 9th) for a shimmering, open sound',
  power: 'power chords (root + fifth, no third): the classic distorted rock sound',
  sus2: 'sus2 chords: open and unresolved',
};

export const INSTRUMENT_NAMES = {
  // recorded instruments
  piano: 'acoustic piano', strings: 'cello and violin section', acousticGuitar: 'fingerpicked steel-string acoustic guitar',
  nylonGuitar: 'nylon-string classical guitar', harp: 'concert harp', cleanGuitar: 'clean electric guitars with chorus (left and right)',
  crunchGuitar: 'two crunchy strummed electric guitars (left and right)', rockGuitar: 'two double-tracked high-gain electric guitars (left and right)',
  fuzzGuitar: 'fuzz electric guitars', glideGuitar: '“glide guitar” (swelling, slowly bending fuzz guitar)', saxophone: 'saxophone', flute: 'flute', violin: 'fiddle (violin)', horn: 'French horn',
  xylophone: 'xylophone', guitarLead: 'overdriven lead guitar',
  electricBass: 'electric bass guitar', rockBass: 'overdriven bass guitar', upright: 'mellow upright-style bass', contrabass: 'bowed contrabass',
  // synthesised on purpose
  pad: 'warm analogue-style pad (synth)', supersaw: '80s supersaw (synth)', square: 'square-wave lead (synth)',
  synth: 'synth bass', '808': '808 bass with glide (synth)',
  // drum kits
  rock: 'recorded rock kit with crash and tom fills', washed: 'recorded kit drenched in reverb', soft: 'soft recorded kit',
  brushes: 'brushes on the snare and a ride cymbal', lofi: 'dusty breakbeat kit', boombap: 'hard-hitting breakbeat kit',
  pop: 'pop drum machine with handclaps', house: 'house drum machine with claps and open hats', linn: 'LinnDrum (classic 80s drum machine)',
  '808_kit': '808 kick with drum-machine hats and claps', taiko: 'deep taiko-style drums', shaker: 'egg shaker',
};

const kitName = (id) => INSTRUMENT_NAMES[`${id}_kit`] ?? INSTRUMENT_NAMES[id] ?? id;

function styleSection({ features, classification, style, auto }) {
  const match = classification.ranking.find((m) => m.style.id === style.id);
  const { supporting, worst } = styleReasons(match);
  const body = [];
  const traits = supporting.map((p) => `**${featureWord(p.id, p.value)}** (${FEATURE_BY_ID[p.id].label.toLowerCase()} ${f2(p.value)})`);

  if (auto) {
    body.push(`Your photo looks ${traits.length ? joinList(traits) : 'balanced'}. ${style.name} fits ${style.whyText}, so it was the closest match: **${pct(match.score)}** similarity.`);
  } else {
    const best = classification.best;
    body.push(`You picked **${style.name}** yourself. It matches this photo at ${pct(match.score)}; auto mode would have chosen **${best.style.name}** (${pct(best.score)}).`);
    if (traits.length) body.push(`What still fits: the photo is ${joinList(traits)}.`);
  }
  if (worst) {
    body.push(`The weakest fit is ${FEATURE_BY_ID[worst.id].label.toLowerCase()}: the photo is ${f2(worst.value)}, while ${style.name} usually goes with about ${f2(worst.target)}.`);
  }
  const runners = classification.ranking.filter((m) => m.style.id !== style.id).slice(0, 3);
  body.push(`Next closest styles: ${runners.map((m) => `${m.style.name} (${pct(m.score)})`).join(', ')}.`);
  body.push('How the match works: every style has a target "photo fingerprint" — eight values from brightness to complexity, some marked as signature traits. The score is how close your photo is to each target, weighted by importance.');
  return {
    id: 'style', title: auto ? `Why ${style.name}?` : `About ${style.name}`, body,
    features: FEATURES.map((f) => ({
      ...f, value: features[f.id],
      target: style.profile[f.id]?.[0], weight: style.profile[f.id]?.[1],
      supporting: supporting.some((p) => p.id === f.id),
    })),
  };
}

function keySection({ score, style }) {
  const d = score.decisions;
  const body = [];
  if (d.chromaticKey) {
    body.push(`The biggest colourful area is **${colorName(d.keyColor)}** (hue ${Math.round(d.keyColor.h)}°, ${pct(d.keyColor.weight)} of the frame). The colour wheel is cut into twelve 30° slices laid out on the circle of fifths, and ${Math.round(d.keyColor.h)}° lands in slice ${d.hueSector} → root note **${pcName(score.key.rootPc)}**.`);
    body.push('Because neighbouring hues map to keys a fifth apart, photos with similar colours end up in related, compatible keys.');
  } else {
    body.push('The photo has no strong colour (it is mostly grey, black or white), so there is no reliable hue to read. It falls back to the root note **C**.');
  }
  const photoIdx = MODES_BY_BRIGHTNESS.indexOf(d.photoMode);
  body.push(`Mood comes from light: average brightness ${f2(d.avgV)} and saturation ${f2(d.avgS)} put the photo at step ${photoIdx + 1} of 6 on the brightness ladder (Lydian → major → Mixolydian → Dorian → minor → Phrygian), which is **${MODE_NAMES[d.photoMode]}**.`);
  if (d.mood) {
    const dir = d.mood > 0 ? 'brighter' : 'darker';
    body.push(`You moved the **Mood** slider ${Math.abs(d.mood)} step${Math.abs(d.mood) > 1 ? 's' : ''} ${dir}, which shifts the mood on the same ladder.`);
  }
  if (d.modeShift) {
    const dir = d.modeShift > 0 ? 'darker' : 'brighter';
    const steps = Math.abs(d.modeShift);
    body.push(`${style.name} leans ${dir}, so the mood moves ${steps} step${steps > 1 ? 's' : ''} ${dir} → **${MODE_NAMES[d.mode]}**: ${MODE_MOODS[d.mode]}.`);
  } else {
    body.push(`${style.name} keeps the photo's own mood: ${MODE_MOODS[d.mode]}.`);
  }
  return { id: 'key', title: `Why ${score.key.name}?`, body };
}

function tempoSection({ score, style, features }) {
  const d = score.decisions;
  const [lo, hi] = d.tempoRange;
  const body = [
    features
      ? `Energy = average of contrast (${f2(features.contrast)}), saturation (${f2(features.saturation)}) and sharpness (${f2(features.sharpness)}) = **${f2(d.energy)}**.`
      : `Energy (from colour saturation) = **${f2(d.energy)}**.`,
    `${style.name} lives between ${lo} and ${hi} BPM. Energy ${f2(d.energy)} places it ${pct(d.energy)} of the way up that range → **${score.tempo} BPM**.`,
    'You can still override the tempo with the slider; the photo only sets the starting point.',
  ];
  return { id: 'tempo', title: `Why ${score.tempo} BPM?`, body };
}

const SUBSTITUTION_TEXT = {
  diminished: 'the colour pointed at a tense diminished chord, so it was swapped for the chord a third lower (they share two notes)',
  repeat: 'the colour pointed at the same chord as the one before it, so it moved a third down for variety',
  loop: 'it would have repeated the home chord right before the loop starts again, so it moved a third down',
};

function chordsSection({ score, style }) {
  const d = score.decisions;
  const items = score.chords.map((ch, i) => {
    const area = `${colorName(ch.color)} area (${pct(ch.color.weight)} of the frame)`;
    let why;
    if (ch.chosen) why = 'you picked this chord yourself in Edit mode';
    else if (i === 0) why = `the key colour itself, so this is the home chord`;
    else if (ch.hueOffset === null) why = `a neutral colour with no reliable hue, so its brightness (${f2(ch.color.v)}) picked the chord`;
    else why = `its hue sits ${Math.round(ch.hueOffset)}° around the wheel from the key colour; the wheel is split into 7 slices, one per scale degree → degree ${ch.rawDegree + 1}`;
    const subs = [...new Set(ch.substituted)].map((s) => SUBSTITUTION_TEXT[s]).join('; ');
    const length = ch.bars === 2 ? 'Lasts 2 bars because the colour covers at least 30% of the photo.' : 'Lasts 1 bar.';
    return {
      chord: `${ch.roman} · ${ch.symbol}`, color: ch.color,
      text: `From the ${area}: ${why}${subs ? `. Then ${subs}` : ''}. ${length} Notes: ${ch.voicing.map(midiToName).join(' ')}.`,
    };
  });

  const body = [`Each of the photo's main colours becomes one chord, in order of how much space it takes up. ${style.name} plays them as ${VOCAB_TEXT[d.vocab] ?? d.vocab}.`];
  if (['triad', 'seventh', 'ninth'].includes(d.vocab)) {
    body.push(d.extension
      ? `The points of interest are tightly clustered (average spread ${f2(d.spread)} < ${TIGHT_SPREAD}), so every chord gets **one extra colour tone**.`
      : `The points of interest are spread out (average spread ${f2(d.spread)}), so chords keep their basic size. A tighter cluster (< ${TIGHT_SPREAD}) would add an extra tone.`);
  }
  const moves = score.chords.map((ch, i) => {
    const prev = score.chords[(i - 1 + score.chords.length) % score.chords.length].voicing;
    const a = [...prev].sort((x, y) => x - y), b = [...ch.voicing].sort((x, y) => x - y);
    let sum = 0; for (let k = 0; k < Math.min(a.length, b.length); k++) sum += Math.abs(a[k] - b[k]);
    return sum;
  });
  const avg = moves.reduce((s, x) => s + x, 0) / moves.length;
  body.push(`Smooth voice leading: each chord picks the inversion closest to the previous one, so the voices move only about **${avg.toFixed(1)} semitones in total** per chord change, and neighbouring voices never sit a semitone apart.`);
  return { id: 'chords', title: 'Why these chords?', body, items };
}

const VOICE_NAMES = { tom: 'toms', snare: 'snare', kick: 'kick drum', crash: 'crash cymbal', ride: 'ride cymbal', clap: 'handclap' };

/** How the layout of the points was read: stretching, contour source, fallback. */
function layoutSentences(info, n) {
  const out = [];
  if (!info) return out;
  if (info.cluster) out.push(`The points sit close together, so they are **stretched to a full phrase**: the leftmost point starts it and the rightmost ends it, instead of all notes bunching up at once.`);
  else if (info.stretchedX) out.push('Timing is read relative to the points themselves: the leftmost point starts the phrase and the rightmost ends it.');
  if (info.fallback) {
    out.push(info.fallback === 'line'
      ? 'The points form an almost **horizontal line with very similar colours**, so neither height nor brightness gives a shape to follow. Instead of a flat, repetitive line, the points play a **simple melodic motif** (rising and falling through the scale), still in the rhythm of the photo.'
      : 'The points are tightly packed and all look alike, so there is no shape to follow. They play a **simple melodic motif** through the scale instead, still in the rhythm of the photo.');
  } else if (info.contourFrom === 'brightness') {
    out.push('The points form an almost **horizontal line**, so height alone would give a flat, repetitive tune. Their **brightness** draws the melody instead: brighter points play higher notes.');
  } else if (info.contourFrom === 'height+brightness') {
    out.push('The melody follows the points\' **height** (higher in the photo = higher note), with their **brightness** as a second influence (brighter = a little higher).');
  } else if (info.contourFrom === 'height') {
    out.push('The melody follows the points\' **height**: higher in the photo = higher note.');
  }
  return out;
}


function melodySection({ score, analysis, style, pointsAs = 'melody' }) {
  const n = analysis.keypoints?.length ?? 0;
  if (!n) return { id: 'melody', title: 'What the points play', body: ['No clear points of interest were found (the photo is very flat), so the points stay silent this time.'] };
  const intro = n === 1
    ? 'The photo has only **one** clear point of interest (a strong edge with distinctive colour), so the phrase is a single note per loop.'
    : `The ${n} numbered points on the photo are its most striking spots: strong edges with distinctive colour. They are read **left to right** like notes on a staff: horizontal position sets *when* each one plays in the 2-bar phrase.`;
  const layout = layoutSentences(score.melodyInfo, n);
  if (analysis.edited) layout.unshift('You moved, added or removed points in **Edit mode**, so the phrase follows your layout.');
  if (pointsAs === 'off') {
    return { id: 'melody', title: 'What the points play', body: [intro, 'The points are switched off ("Points play: Nothing"), so you hear only the chords, bass and beat.'] };
  }
  if (pointsAs === 'drums') {
    const map = { high: 'tom', low: 'tom', accent: 'crash', ...style.pointDrums };
    const voices = map.high === map.low
      ? `higher notes of the phrase hit higher ${VOICE_NAMES[map.high]}, lower ones the deeper ones`
      : `the upper half of the phrase plays the ${VOICE_NAMES[map.high]}, the lower half the ${VOICE_NAMES[map.low]}`;
    return {
      id: 'melody', title: 'What the points play: drums',
      body: [
        intro, ...layout,
        `${style.points === 'drums' ? `In ${style.name} the points are played by a drummer` : 'The points are played on drums ("Points play: Drums")'}: ${voices}, and the single strongest point also gets a ${VOICE_NAMES[map.accent]}. Bright, high-contrast spots hit harder.`,
        'It works like a drummer answering the band: the rhythm comes straight from where things are in your photo.',
      ],
    };
  }
  const body = [intro, ...layout];
  if (!score.melodyInfo?.fallback) {
    body.push('The **visual distance** between two neighbouring points (how far apart they are in position and in height/brightness) picks the interval: close points give the most consonant intervals (unison, perfect 5th, 3rds), distant ones wider, gentler tension (6ths, 7ths). Harsh intervals (minor 2nd, tritone, major 7th) are excluded, and notes that would clash with the chord underneath are nudged onto a chord tone.');
  }
  const items = score.edges.map((e) => ({
    chord: `${e.from + 1} → ${e.to + 1}`,
    text: e.distance
      ? `visual distance ${f2(e.distance)} → ${INTERVAL_NAMES[e.interval]} (consonance rank ${CONSONANCE_LADDER.indexOf(e.interval) + 1} of ${CONSONANCE_LADDER.length})`
      : `motif step → ${INTERVAL_NAMES[e.interval]}`,
  }));
  return { id: 'melody', title: `What the points play: ${INSTRUMENT_NAMES[style.sound.melody] ?? 'melody'}`, body, items };
}

function soundSection({ style, pointsAs = 'melody' }) {
  const s = style.sound;
  const parts = [
    `Chords: ${INSTRUMENT_NAMES[s.chords]}`,
    s.bass && `bass: ${INSTRUMENT_NAMES[s.bass]}`,
    s.kit && `drums: ${kitName(s.kit)}`,
    pointsAs === 'melody' ? `points: ${INSTRUMENT_NAMES[s.melody]}` : pointsAs === 'drums' ? 'points: drums' : null,
  ].filter(Boolean);
  const body = [`${style.blurb}`, `${parts.join('; ')}.`];
  if (style.chords.palmMute) body.push('Guitar rhythm: accented power chords ring out, the notes in between are palm-muted "chugs".');
  if (style.humanize) body.push('Played slightly imperfectly on purpose: tiny timing and velocity variations, like a live band.');
  if (style.swing) body.push(`Played with ${style.swing >= 0.7 ? 'a heavy' : 'a light'} swing feel: off-beat notes are pushed slightly late.`);
  const synthetic = [s.chords, s.bass, s.melody].filter((id) => /\(synth\)|^synth bass/.test(INSTRUMENT_NAMES[id] ?? ''));
  body.push(synthetic.length
    ? 'Acoustic and electric instruments are real recordings; the synth parts are synthesised on purpose, because that is the sound of the genre. Your photo never leaves the browser.'
    : 'Every instrument here is a real recording (piano, guitars, strings, winds, drums), played back note by note in your browser. Your photo never leaves the browser.');
  return { id: 'sound', title: 'What you are hearing', body };
}

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * @param {{analysis, classification, style, auto: boolean, score}} ctx
 * @returns {{headline: string, sections: Array<{id, title, body: string[], items?, features?}>}}
 */
export function buildExplanation(ctx) {
  const { score, style } = ctx;
  const features = ctx.analysis.features;
  const full = { ...ctx, features, pointsAs: ctx.pointsAs ?? style.points ?? 'melody' };
  return {
    headline: `${style.name} in ${score.key.name} at ${score.tempo} BPM`,
    sections: [
      styleSection(full), keySection(full), tempoSection(full),
      chordsSection(full), melodySection(full), soundSection(full),
    ],
  };
}
