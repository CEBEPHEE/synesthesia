import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, classifyStyle, styleSimilarity, styleReasons, getStyle } from '../src/core/styles.js';
import { FEATURES } from '../src/vision/features.js';

const profileAsFeatures = (style) => Object.fromEntries(Object.entries(style.profile).map(([k, [t]]) => [k, t]));

describe('style library', () => {
  it('has 15 styles with unique ids and complete definitions', () => {
    assert.equal(STYLES.length, 15);
    assert.equal(new Set(STYLES.map((s) => s.id)).size, 15);
    for (const s of STYLES) {
      assert.ok(s.tempo[0] < s.tempo[1], s.id);
      assert.ok(s.register.high - s.register.low >= 12, s.id);
      for (const { id } of FEATURES) assert.ok(s.profile[id], `${s.id} lacks ${id}`);
      for (const p of [s.chords.pattern, s.bass?.pattern, s.drums?.kick, s.drums?.snare, s.drums?.hat]) {
        if (p && p !== 'w') assert.ok(p.length === 16 || p.length === 32, `${s.id}: pattern length ${p.length}`);
      }
    }
  });

  it('every style wins on a photo that matches its own profile exactly', () => {
    for (const s of STYLES) assert.equal(classifyStyle(profileAsFeatures(s)).best.style.id, s.id);
  });

  it('a perfect match scores 100%', () => {
    const s = getStyle('shoegaze');
    assert.equal(styleSimilarity(profileAsFeatures(s), s).score, 1);
  });

  it('typical photos: blurry+warm → dreamy styles, very dark+cold → trap or ambient', () => {
    const blurryWarm = { brightness: 0.6, contrast: 0.3, saturation: 0.55, colorfulness: 0.45, warmth: 0.8, sharpness: 0.03, grain: 0.03, complexity: 0.1 };
    assert.ok(['shoegaze', 'ambient', 'dream-pop'].includes(classifyStyle(blurryWarm).best.style.id));
    const darkCold = { brightness: 0.05, contrast: 0.2, saturation: 0.5, colorfulness: 0.2, warmth: 0.3, sharpness: 0.1, grain: 0.1, complexity: 0.1 };
    assert.ok(['trap', 'ambient'].includes(classifyStyle(darkCold).best.style.id));
    const gritty = { brightness: 0.55, contrast: 0.7, saturation: 0, colorfulness: 0, warmth: 0.5, sharpness: 0.8, grain: 0.9, complexity: 0.3 };
    assert.equal(classifyStyle(gritty).best.style.id, 'boom-bap');
  });

  it('every style wins somewhere among random photos (no style is unreachable)', () => {
    let a = 7;
    const rnd = () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648;
    const wins = new Set();
    for (let i = 0; i < 4000; i++) {
      const f = Object.fromEntries(FEATURES.map(({ id }) => [id, rnd()]));
      wins.add(classifyStyle(f).best.style.id);
    }
    assert.equal(wins.size, STYLES.length);
  });

  it('the ranking is sorted and the explanation names the deciding traits', () => {
    const { ranking } = classifyStyle(profileAsFeatures(getStyle('trap')));
    for (let i = 1; i < ranking.length; i++) assert.ok(ranking[i - 1].score >= ranking[i].score);
    const { supporting } = styleReasons(ranking[0]);
    assert.ok(supporting.length > 0);
    assert.ok(supporting.every((p) => p.closeness >= 0.75));
  });
});
