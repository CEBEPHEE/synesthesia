/**
 * Live camera music. Pure (no DOM, no Tone.js), unit-tested.
 *
 * Frames arrive several times a second, but music must not twitch: the
 * conductor is asked once per bar ("decide") and changes the music only when
 * the picture has really changed:
 *
 *  • style and tempo are chosen once, from the first frames (or by the user);
 *  • chords/key change only when the new harmony has been stable for `stableBars`
 *    bars in a row (a passing hand or a flicker of light changes nothing);
 *  • the melody follows the points (e.g. a moving hand) on the next bar, over the
 *    same chords, so movement is heard quickly without the harmony jumping.
 */
import { buildMusicalScore, energyToTempo } from './mapping.js';
import { arrange } from './arranger.js';
import { classifyStyle } from './styles.js';

const harmonySignature = (score) => `${score.key.name}|${score.chords.map((c) => c.degree).join(',')}`;

/** Did the points move enough to be worth a new melody? */
export function pointsMoved(a = [], b = [], tolerance = 0.08) {
  if (a.length !== b.length) return true;
  if (!a.length) return false;
  const sa = [...a].sort((p, q) => p.x - q.x), sb = [...b].sort((p, q) => p.x - q.x);
  const mean = sa.reduce((s, p, i) => s + Math.hypot(p.x - sb[i].x, p.y - sb[i].y), 0) / sa.length;
  return mean > tolerance;
}

export class LiveConductor {
  /**
   * @param {{getStyle, styleId?: string|null, mood?: number, pointsAs?: string, stableBars?: number, smoothing?: number}} options
   */
  constructor({ getStyle, styleId = null, mood = 0, pointsAs, stableBars = 2, smoothing = 0.3 } = {}) {
    Object.assign(this, { getStyle, styleId, mood, pointsAs, stableBars, smoothing });
    this.latest = null;          // latest analysis (features smoothed)
    this.features = null;
    this.style = null; this.tempo = null; this.ranking = null;
    this.committed = null;       // { analysis, score, entryVoicing }
    this.candidate = null; this.stable = 0;
    this.dirty = false;
  }

  get ready() { return this.latest !== null; }

  /** A new analysed frame. Features are smoothed so lighting flicker is ignored. */
  feed(analysis) {
    const a = this.smoothing;
    if (!this.features) this.features = { ...analysis.features };
    else for (const k of Object.keys(analysis.features)) this.features[k] = this.features[k] * (1 - a) + analysis.features[k] * a;
    this.latest = { ...analysis, features: { ...this.features } };
  }

  /** User changes: applied on the next bar. */
  set({ styleId, mood, pointsAs } = {}) {
    if (styleId !== undefined && styleId !== this.styleId) { this.styleId = styleId; this.style = null; }
    if (mood !== undefined) this.mood = mood;
    if (pointsAs !== undefined) this.pointsAs = pointsAs;
    this.dirty = true;
  }

  /** Pick the style again from what the camera sees now (Auto). */
  repickStyle() { this.style = null; this.dirty = true; }

  #chooseStyle() {
    const { best, ranking } = classifyStyle(this.features);
    this.ranking = ranking;
    this.style = this.styleId ? this.getStyle(this.styleId) : best.style;
    const f = this.features;
    this.tempo = energyToTempo((f.contrast + f.saturation + f.sharpness) / 3, this.style.tempo);
  }

  #commit(analysis, prevVoicing, kind) {
    const score = buildMusicalScore(analysis, { style: this.style, prevVoicing, mood: this.mood });
    const arrangement = { ...arrange(score, this.style, { pointsAs: this.pointsAs }), tempo: this.tempo };
    this.committed = { analysis, score, entryVoicing: prevVoicing };
    if (kind !== 'melody') { this.candidate = null; this.stable = 0; }   // a melody change keeps a pending harmony change
    this.dirty = false;
    return { kind, score, arrangement, style: this.style, tempo: this.tempo, ranking: this.ranking };
  }

  /**
   * Called once per bar, just before it starts.
   * @returns {null | {kind: 'start'|'restyle'|'harmony'|'melody', score, arrangement, style, tempo, ranking}}
   */
  decide() {
    if (!this.latest) return null;
    const restyle = !this.style;
    if (restyle) this.#chooseStyle();
    const lastVoicing = this.committed?.score.chords.at(-1).voicing ?? null;
    if (!this.committed || restyle || this.dirty) {
      return this.#commit(this.latest, lastVoicing, this.committed ? 'restyle' : 'start');
    }

    // harmony: switch only after the new one has been the same for `stableBars` bars
    const next = buildMusicalScore(this.latest, { style: this.style, prevVoicing: lastVoicing, mood: this.mood });
    const sig = harmonySignature(next);
    if (sig !== harmonySignature(this.committed.score)) {
      this.stable = this.candidate === sig ? this.stable + 1 : 1;
      this.candidate = sig;
      if (this.stable >= this.stableBars) return this.#commit(this.latest, lastVoicing, 'harmony');
    } else {
      this.candidate = null; this.stable = 0;
    }

    // melody: same chords (same palette), new points
    if (pointsMoved(this.committed.analysis.keypoints, this.latest.keypoints)) {
      const analysis = { ...this.committed.analysis, keypoints: this.latest.keypoints };
      return this.#commit(analysis, this.committed.entryVoicing, 'melody');
    }
    return null;
  }
}
