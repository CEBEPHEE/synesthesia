/**
 * Edit mode helpers: which chords to offer for a colour, which of them to
 * recommend, and friendly advice that keeps hand-made changes sounding good.
 * Pure (no DOM), unit-tested.
 *
 * Guard-rails that cannot be switched off:
 *  • only chords that belong to the key are offered, and diminished chords never are;
 *  • melodies always stay in the scale and dodge clashes with the chords (see mapping/arranger);
 *  • points stay inside the photo and there are at most MAX_POINTS of them.
 */
import { diatonicChord, isDiminished, chordSymbol, romanNumeral, mod } from './music-theory.js';
import { buildChord } from './mapping.js';

export const MAX_POINTS = 9;
export const MIN_POINTS_FOR_MELODY = 3;

const commonTones = (a, b) => a.filter((pc) => b.includes(mod(pc, 12))).length;

/**
 * Chords that may replace chord `index` of the score.
 * @returns {Array<{degree, roman, symbol, recommended, current, original, reason}>}
 */
export function chordChoices(score, index, style) {
  const { rootPc, mode } = score.key;
  const chords = score.chords;
  const n = chords.length;
  const prev = n > 1 ? chords[(index - 1 + n) % n] : null;
  const next = n > 1 ? chords[(index + 1) % n] : null;
  const extension = score.decisions?.extension ?? 0;
  const out = [];
  for (let degree = 0; degree < 7; degree++) {
    if (isDiminished(diatonicChord(rootPc, mode, degree, 3))) continue;      // never offered
    const { pcs, kind } = buildChord(rootPc, mode, degree, style.vocab, extension);
    const sameAsNeighbour = (prev && prev.degree === degree && n > 1) || (next && next.degree === degree && n > 2);
    const withPrev = prev ? commonTones(pcs, prev.pcs) : 1;
    const withNext = next ? commonTones(pcs, next.pcs) : 1;
    let reason;
    if (sameAsNeighbour) reason = 'same as a neighbouring chord: the music would stand still';
    else if (withPrev === 0 || withNext === 0) reason = 'shares no notes with a neighbour: the change may sound abrupt';
    else if (degree === 0) reason = 'the home chord: restful';
    else reason = `shares notes with both neighbours: a smooth change`;
    out.push({
      degree, pcs, roman: romanNumeral(degree, pcs), symbol: chordSymbol(pcs, kind),
      recommended: !sameAsNeighbour && withPrev > 0 && withNext > 0,
      current: chords[index].degree === degree,
      original: chords[index].chosen ? false : chords[index].degree === degree,
      reason,
    });
  }
  return out;
}

/** 0–100: how smooth and clear the chord loop is (common tones, voice movement, variety, home chord). */
export function harmonyScore(score) {
  const ch = score.chords;
  const n = ch.length;
  if (n < 2) return 70;
  let common = 0, move = 0, repeats = 0;
  for (let i = 0; i < n; i++) {
    const a = ch[i], b = ch[(i + 1) % n];
    common += Math.min(2, commonTones(a.pcs, b.pcs)) / 2;
    const va = [...a.voicing].sort((x, y) => x - y), vb = [...b.voicing].sort((x, y) => x - y);
    let m = 0; for (let k = 0; k < Math.min(va.length, vb.length); k++) m += Math.abs(va[k] - vb[k]);
    move += Math.min(1, m / 12);
    if (a.degree === b.degree) repeats++;
  }
  const distinct = new Set(ch.map((c) => c.degree)).size;
  let s = 100;
  s -= 30 * (1 - common / n);                 // few shared notes → jumpy
  s -= 20 * (move / n);                       // big voice jumps
  s -= 40 * (repeats / n);                    // standing still
  if (distinct < 2) s -= 25;                  // only one chord
  if (!ch.some((c) => c.degree === 0)) s -= 10;
  if (repeats) s = Math.min(s, 72);           // a repeated chord is never "smooth"
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Advice for Edit mode.
 * @returns {{score: number, verdict: string, tips: Array<{level: 'ok'|'tip'|'warn', text: string}>}}
 */
export function editAdvice(analysis, score) {
  const tips = [];
  const n = analysis.keypoints?.length ?? 0;
  const info = score.melodyInfo ?? {};

  if (n < MIN_POINTS_FOR_MELODY) tips.push({ level: 'warn', text: `Only ${n} point${n === 1 ? '' : 's'}: click on the photo to add at least ${MIN_POINTS_FOR_MELODY} for a real phrase.` });
  else if (n >= MAX_POINTS) tips.push({ level: 'tip', text: `${MAX_POINTS} points is the maximum; more would make the melody busy. Double-click a point to remove it.` });
  if (info.fallback) tips.push({ level: 'tip', text: 'The points are on a flat line with similar colours, so they play a stock motif. Drag some points up or down to write your own melody.' });
  else if (info.cluster) tips.push({ level: 'tip', text: 'The points are bunched together. Spreading them across the photo gives the melody more room to move.' });

  const ch = score.chords;
  const k = ch.length;
  for (let i = 0; i < k && k > 1; i++) {
    const a = ch[i], b = ch[(i + 1) % k];
    if (i === k - 1 && k === 2) break;
    if (a.degree === b.degree) tips.push({ level: 'warn', text: `${a.symbol} is followed by the same chord: pick a different chord for one of these colours (★ marks good choices).` });
    else if (commonTones(a.pcs, b.pcs) === 0) tips.push({ level: 'tip', text: `${a.symbol} → ${b.symbol} share no notes, so that change can sound abrupt. Try a ★ chord instead.` });
  }
  if (new Set(ch.map((c) => c.degree)).size < 2) tips.push({ level: 'warn', text: 'All colours play the same chord, so the music never moves.' });
  if (ch[0] && ch[0].degree !== 0) tips.push({ level: 'tip', text: 'Starting on the home chord (I or i) makes the key easy to hear.' });

  const s = harmonyScore(score);
  const verdict = s >= 80 ? 'sounds smooth' : s >= 60 ? 'a few rough edges' : 'jumpy, see the tips';
  if (!tips.length) tips.push({ level: 'ok', text: 'Everything sounds balanced. Drag points to reshape the melody, or click a colour to try another chord.' });
  return { score: s, verdict, tips };
}
