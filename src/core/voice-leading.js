/**
 * Voice leading: choose the voicing of the next chord so that voices move as
 * little as possible and adjacent voices never clash (minor 2nds, muddy low
 * intervals).
 *
 * Search: every permutation of the pitch classes (n ≤ 5 → at most 120) × the two
 * nearest octaves for each voice; cost = total movement + clash penalty +
 * a small penalty when the root is not in the bass.
 */
import { mod } from './music-theory.js';

export const DEFAULT_RANGE = Object.freeze({ low: 45, high: 79 }); // A2..G5
/** Below this pitch, intervals narrower than a minor 3rd sound muddy (low interval limit). */
export const LOW_INTERVAL_LIMIT = 55;

export function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

/** MIDI note with pitch class pc nearest to target, kept inside the range. */
export function nearestMidiWithPc(pc, target, range = DEFAULT_RANGE) {
  const up = target + mod(pc - target, 12);
  const down = up - 12;
  let m = (up - target) <= (target - down) ? up : down;
  while (m < range.low) m += 12;
  while (m > range.high) m -= 12;
  return m;
}

/** Penalty for vertical clashes in a voicing. */
export function dissonancePenalty(voicing) {
  const v = [...voicing].sort((a, b) => a - b);
  let p = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (d === 0) p += 20;                              // two voices on the same note
    else if (d === 1) p += 40;                         // minor 2nd between neighbours: practically forbidden
    else if (v[i - 1] < LOW_INTERVAL_LIMIT && d < 3) p += 6;
  }
  const span = v[v.length - 1] - v[0];
  if (span > 28) p += span - 28;                       // voicing spread too wide
  return p;
}

/** Total voice movement (both arrays sorted, same length). */
export function movementCost(from, to) {
  let c = 0;
  for (let i = 0; i < to.length; i++) c += Math.abs(to[i] - from[i]);
  return c;
}

/** Close-position voicing starting from a bass near bassTarget. */
export function closePosition(pcs, range = DEFAULT_RANGE, bassTarget = 52) {
  let cur = nearestMidiWithPc(pcs[0], bassTarget, range);
  const out = [cur];
  for (const pc of pcs.slice(1)) {
    cur += mod(pc - cur, 12) || 12;
    out.push(cur);
  }
  while (out[out.length - 1] > range.high && out[0] - 12 >= range.low) {
    for (let i = 0; i < out.length; i++) out[i] -= 12;
  }
  return out;
}

/** When the voice count changes (3 → 5), spread the targets over the previous voices. */
function targetsFor(prevSorted, n) {
  if (prevSorted.length === n) return prevSorted.slice();
  if (n === 1) return [prevSorted[Math.floor(prevSorted.length / 2)]];
  return Array.from({ length: n }, (_, i) =>
    prevSorted[Math.round((i * (prevSorted.length - 1)) / (n - 1))]);
}

/**
 * @param {number[]|null} prev   previous voicing (MIDI) or null
 * @param {number[]} nextPcs     pitch classes of the next chord, [0] is the root
 * @returns {number[]}           sorted voicing (MIDI)
 */
export function voiceLead(prev, nextPcs, range = DEFAULT_RANGE) {
  if (!nextPcs?.length) return [];
  if (!prev?.length) return closePosition(nextPcs, range);

  const targets = targetsFor([...prev].sort((a, b) => a - b), nextPcs.length);
  const rootPc = nextPcs[0];
  let best = null;
  let bestCost = Infinity;

  const n = nextPcs.length;
  for (const perm of permutations(nextPcs)) {
    // two candidate octaves per voice (n ≤ 5 → 120 permutations × 32 combos, well under 1 ms)
    const options = perm.map((pc, i) => {
      const near = nearestMidiWithPc(pc, targets[i], range);
      const alt = near >= targets[i] ? near - 12 : near + 12;
      return alt >= range.low && alt <= range.high ? [near, alt] : [near];
    });
    for (let mask = 0; mask < 1 << n; mask++) {
      let skip = false;
      const v = options.map((o, i) => {
        const bit = (mask >> i) & 1;
        if (bit && o.length < 2) skip = true;
        return o[bit] ?? o[0];
      });
      if (skip) continue;
      v.sort((a, b) => a - b);
      const bassPenalty = mod(v[0], 12) === rootPc ? 0 : 3; // inversions allowed, but cost a little more
      const cost = movementCost(targets, v) + dissonancePenalty(v) + bassPenalty;
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  return best;
}
