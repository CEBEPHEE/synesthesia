import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExplanation, colorName, featureWord } from '../src/core/explain.js';
import { buildMusicalScore } from '../src/core/mapping.js';
import { classifyStyle, getStyle, STYLES } from '../src/core/styles.js';

const features = { brightness: 0.6, contrast: 0.3, saturation: 0.55, colorfulness: 0.45, warmth: 0.8, sharpness: 0.05, grain: 0.05, complexity: 0.1, raw: {} };
const analysis = {
  palette: [
    { h: 30, s: 0.7, v: 0.8, r: 220, g: 140, b: 60, weight: 0.4 },
    { h: 200, s: 0.5, v: 0.5, r: 60, g: 110, b: 130, weight: 0.3 },
    { h: 0, s: 0.02, v: 0.95, r: 240, g: 240, b: 240, weight: 0.3 },
  ],
  keypoints: [{ x: 0.1, y: 0.5, score: 0.8 }, { x: 0.4, y: 0.2, score: 0.6 }, { x: 0.7, y: 0.8, score: 0.7 }],
  features,
};

function explain(styleId) {
  const classification = classifyStyle(features);
  const auto = !styleId;
  const style = auto ? classification.best.style : getStyle(styleId);
  const score = buildMusicalScore(analysis, { style });
  return { ex: buildExplanation({ analysis, classification, style, auto, score }), style, score, classification };
}

describe('buildExplanation', () => {
  it('auto mode explains the style choice with the deciding traits', () => {
    const { ex, style } = explain();
    const s = ex.sections.find((x) => x.id === 'style');
    assert.equal(s.title, `Why ${style.name}?`);
    assert.match(s.body[0], /similarity/);
    assert.match(s.body[0], /blurry, hazy/);
    assert.equal(s.features.length, 8);
  });

  it('manual mode says what auto would have chosen', () => {
    const { ex, classification } = explain('hard-rock');
    const s = ex.sections.find((x) => x.id === 'style');
    assert.match(s.body[0], /You picked \*\*Hard Rock\*\*/);
    assert.ok(s.body[0].includes(classification.best.style.name));
  });

  it('explains key, tempo, every chord and the melody with real numbers', () => {
    const { ex, score } = explain();
    assert.deepEqual(ex.sections.map((s) => s.id), ['style', 'key', 'tempo', 'chords', 'melody', 'sound']);
    assert.ok(ex.sections.find((s) => s.id === 'key').body[0].includes('orange'));
    assert.ok(ex.sections.find((s) => s.id === 'tempo').title.includes(String(score.tempo)));
    const chords = ex.sections.find((s) => s.id === 'chords');
    assert.equal(chords.items.length, score.chords.length);
    assert.match(chords.items[0].text, /home chord/);
    assert.match(chords.items.find((i) => /neutral colour/.test(i.text)).text, /brightness/);
    assert.equal(ex.sections.find((s) => s.id === 'melody').items.length, 2);
  });

  it('produces text for every style without placeholders', () => {
    for (const style of STYLES) {
      const { ex } = explain(style.id);
      const text = JSON.stringify(ex);
      assert.ok(!/undefined|NaN|\[object/.test(text), `${style.id}: ${text.match(/.{40}(undefined|NaN|\[object).{20}/)?.[0]}`);
    }
  });
});

describe('points explanation', () => {
  it('describes drums for rock and a melody instrument for folk', () => {
    const rock = explain('hard-rock').ex.sections.find((x) => x.id === 'melody');
    assert.match(rock.title, /drums/);
    assert.match(rock.body.join(' '), /toms/);
    const folk = explain('folk').ex.sections.find((x) => x.id === 'melody');
    assert.match(folk.title, /acoustic guitar/);
  });
});

describe('words', () => {
  it('colour names', () => {
    assert.equal(colorName({ h: 0, s: 0.9, v: 0.9 }), 'red');
    assert.equal(colorName({ h: 220, s: 0.05, v: 0.95 }), 'white');
    assert.equal(colorName({ h: 120, s: 0.8, v: 0.2 }), 'dark green');
  });
  it('feature words', () => {
    assert.equal(featureWord('sharpness', 0.05), 'blurry, hazy');
    assert.equal(featureWord('sharpness', 0.5), 'moderately sharp');
    assert.equal(featureWord('brightness', 0.9), 'bright');
  });
});
