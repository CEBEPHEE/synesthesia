import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chordChoices, editAdvice, harmonyScore, MAX_POINTS } from '../src/core/editing.js';
import { buildMusicalScore } from '../src/core/mapping.js';
import { isDiminished } from '../src/core/music-theory.js';
import { getStyle, STYLES } from '../src/core/styles.js';

const analysis = {
  palette: [
    { h: 30, s: 0.7, v: 0.8, weight: 0.4 }, { h: 200, s: 0.5, v: 0.5, weight: 0.3 },
    { h: 100, s: 0.4, v: 0.6, weight: 0.2 }, { h: 300, s: 0.4, v: 0.5, weight: 0.1 },
  ],
  keypoints: [{ x: 0.1, y: 0.5, score: 0.8 }, { x: 0.4, y: 0.2, score: 0.6 }, { x: 0.7, y: 0.8, score: 0.7 }, { x: 0.9, y: 0.4, score: 0.6 }],
  features: { contrast: 0.5, saturation: 0.5, sharpness: 0.5 },
};
const style = getStyle('pop');
const score = (opts = {}) => buildMusicalScore(analysis, { style, ...opts });

describe('mood slider', () => {
  const order = ['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian'];
  it('+ makes the mode brighter, − darker, 0 changes nothing', () => {
    const base = order.indexOf(score().key.mode);
    assert.ok(order.indexOf(score({ mood: 1 }).key.mode) <= base);
    assert.ok(order.indexOf(score({ mood: -2 }).key.mode) > base);
    assert.equal(score({ mood: 0 }).key.mode, score().key.mode);
  });
  it('is clamped to ±2', () => {
    assert.equal(score({ mood: 9 }).key.mode, score({ mood: 2 }).key.mode);
  });
});

describe('chord overrides', () => {
  it('a colour can be given another chord; it is marked as chosen', () => {
    const s0 = score();
    const choices = chordChoices(s0, 1, style).filter((c) => !c.current);
    const pick = choices[0].degree;
    const s1 = score({ chordOverrides: { [s0.chords[1].paletteIndex]: pick } });
    assert.equal(s1.chords[1].degree, pick);
    assert.equal(s1.chords[1].chosen, true);
  });
  it('a diminished degree cannot be forced', () => {
    const s0 = score();
    const dimDegree = [0, 1, 2, 3, 4, 5, 6].find((d) => !chordChoices(s0, 1, style).some((c) => c.degree === d));
    const s1 = score({ chordOverrides: { [s0.chords[1].paletteIndex]: dimDegree } });
    assert.ok(!isDiminished(s1.chords[1].pcs));
  });
});

describe('chordChoices', () => {
  for (const st of STYLES) {
    it(`${st.name}: offers in-key, non-diminished chords and recommends some`, () => {
      const s = buildMusicalScore(analysis, { style: st });
      const c = chordChoices(s, 1, st);
      assert.ok(c.length >= 5 && c.length <= 7);
      assert.ok(c.every((x) => !isDiminished(x.pcs)));
      assert.ok(c.some((x) => x.recommended));
      assert.equal(c.filter((x) => x.current).length, 1);
    });
  }
  it('a chord equal to its neighbour is never recommended', () => {
    const s = score();
    const prevDegree = s.chords[0].degree;
    const same = chordChoices(s, 1, style).find((c) => c.degree === prevDegree);
    assert.equal(same.recommended, false);
  });
});

describe('advice', () => {
  it('a normal photo gets a good score', () => {
    const a = editAdvice(analysis, score());
    assert.ok(a.score >= 60, `score ${a.score}`);
  });
  it('warns about too few points', () => {
    const few = { ...analysis, keypoints: analysis.keypoints.slice(0, 2) };
    assert.ok(editAdvice(few, buildMusicalScore(few, { style })).tips.some((t) => t.level === 'warn' && /add at least/.test(t.text)));
  });
  it('mentions the maximum number of points', () => {
    const many = { ...analysis, keypoints: Array.from({ length: MAX_POINTS }, (_, i) => ({ x: i / MAX_POINTS, y: (i % 3) / 3, score: 0.5 })) };
    assert.ok(editAdvice(many, buildMusicalScore(many, { style })).tips.some((t) => /maximum/.test(t.text)));
  });
  it('a repeated chord lowers the score and produces a warning', () => {
    const s0 = score();
    const same = score({ chordOverrides: { [s0.chords[1].paletteIndex]: s0.chords[0].degree } });
    assert.ok(harmonyScore(same) < harmonyScore(s0));
    assert.ok(editAdvice(analysis, same).tips.some((t) => t.level === 'warn'));
  });
});
