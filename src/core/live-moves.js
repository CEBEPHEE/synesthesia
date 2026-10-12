/**
 * "Music follows my moves" for the live camera. Pure (no DOM), unit-tested.
 *
 * Same idea as "Follow the dancer" for videos: the notes still come from the picture,
 * the body only shapes what real songs change slowly. Live, there is no looking ahead,
 * so the level is decided every two bars from the two bars just played:
 *
 *   still   (no movement for two bars)  → only the chords hold
 *   calm    (small moves)               → chords + melody
 *   groove  (dancing)                   → + bass and drums
 *   peak    (dancing hard)              → everything, louder
 *   arms up / open hands                → the melody an octave higher
 *
 * Speeds are in body heights (or hand sizes) per second, from vision/movement.js.
 */
import { LEVELS } from './dancer.js';

export const LIVE_THRESHOLDS = Object.freeze({ still: 0.075, calm: 0.2, groove: 0.45 });
const MARGIN = 0.15;              // a level only changes when clearly past the border (×1 ± 15%)
export const PHRASE_BARS = 2;

function levelFor(speed, prev) {
  const { still, calm, groove } = LIVE_THRESHOLDS;
  const raw = speed < still ? 'still' : speed < calm ? 'calm' : speed < groove ? 'groove' : 'peak';
  if (!prev || raw === prev) return raw;
  // hysteresis: near a border, keep the current level
  const borders = [still, calm, groove];
  const iRaw = LEVELS.indexOf(raw), iPrev = LEVELS.indexOf(prev);
  const border = borders[Math.min(iRaw, iPrev)];
  if (Math.abs(iRaw - iPrev) === 1 && Math.abs(speed - border) < border * MARGIN) return prev;
  return raw;
}

export class LiveMoves {
  constructor() { this.reset(); }

  reset() {
    this.samples = [];            // since the last bar
    this.bars = [];               // per bar: { speed, lift, present }
    this.count = 0;               // bars so far
    this.level = 'calm';
    this.lift = 'mid';
    this.view = null;
    this.speed = 0;               // smoothed, for the meter
  }

  /** One tracked frame: { speed, lift, present, view }. */
  push(sample) {
    this.samples.push(sample);
    if (sample.present) { this.view = sample.view; this.speed = this.speed * 0.8 + sample.speed * 0.2; }
    else this.speed *= 0.9;
  }

  /**
   * Called on every bar line. Every PHRASE_BARS bars the level may change.
   * @returns {{level, lift, changed: boolean}}
   */
  bar() {
    const seen = this.samples.filter((s) => s.present);
    const present = this.samples.length > 0 && seen.length / this.samples.length > 0.4;
    this.bars.push({
      present,
      speed: seen.length ? seen.reduce((s, x) => s + x.speed, 0) / seen.length : 0,
      lift: seen.length ? seen.reduce((s, x) => s + x.lift, 0) / seen.length : 0.5,
    });
    this.samples = [];
    if (this.bars.length > 16) this.bars.shift();
    if (++this.count % PHRASE_BARS !== 0) return { level: this.level, lift: this.lift, changed: false };
    const recent = this.bars.slice(-PHRASE_BARS).filter((b) => b.present);
    let level, lift;
    if (!recent.length) { level = 'calm'; lift = 'mid'; }                 // nobody in the picture: keep it gentle
    else {
      const speed = recent.reduce((s, b) => s + b.speed, 0) / recent.length;
      const l = recent.reduce((s, b) => s + b.lift, 0) / recent.length;
      level = levelFor(speed, this.level);
      lift = l > 0.65 ? 'high' : l < 0.18 ? 'low' : 'mid';
    }
    const changed = level !== this.level || lift !== this.lift;
    this.level = level; this.lift = lift;
    return { level, lift, changed };
  }

  /** A movement plan for applyMovementPlan(): one phrase that covers the whole loop. */
  plan() {
    return { phrases: [{ startBar: 0, bars: 1e6, level: this.level, lift: this.lift }], accents: [] };
  }
}

export const LEVEL_TEXT = Object.freeze({
  still: 'You are still, so the music holds on the chords.',
  calm: 'Small moves: chords and melody.',
  groove: 'You are dancing: bass and drums are in.',
  peak: 'Dancing hard: everything plays, louder.',
});
