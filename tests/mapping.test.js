/**
 * Unit tests for the "distance / colour → musical interval" mapping.
 * node:test has the same API as Jest (describe/it); to run under Jest, drop
 * the imports and use the global describe/it/expect.
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSONANCE_LADDER, hueToRootPc, distanceToInterval, pixelDistanceToNormalized,
  brightnessToMode, shiftMode, spreadToExtension, quantizeToScale, colorToDegree,
  energyToTempo, buildChord, buildMusicalScore,
} from '../src/core/mapping.js';
import { mod, scalePitchClasses, isDiminished } from '../src/core/music-theory.js';
import { STYLES, getStyle } from '../src/core/styles.js';

describe('hueToRootPc: colour → key', () => {
  it('maps the basic hues onto the circle of fifths', () => {
    assert.equal(hueToRootPc(0), 0);    // red    → C
    assert.equal(hueToRootPc(30), 7);   // orange → G
    assert.equal(hueToRootPc(60), 2);   // yellow → D
    assert.equal(hueToRootPc(120), 4);  // green  → E
  });

  it('wraps around: 360° and 359° equal 0°', () => {
    assert.equal(hueToRootPc(360), hueToRootPc(0));
    assert.equal(hueToRootPc(359), hueToRootPc(0));
    assert.equal(hueToRootPc(-30), hueToRootPc(330));
  });

  it('neighbouring hue sectors always give related keys (a fifth apart)', () => {
    for (let h = 0; h < 360; h += 30) {
      assert.equal(mod(hueToRootPc(h + 30) - hueToRootPc(h), 12), 7, `hue ${h}`);
    }
  });

  it('rejects invalid input', () => {
    assert.throws(() => hueToRootPc(NaN), TypeError);
    assert.throws(() => hueToRootPc('red'), TypeError);
  });
});

describe('distanceToInterval: distance → interval', () => {
  it('identical points → unison, maximum distance → minor 7th', () => {
    assert.equal(distanceToInterval(0), 0);
    assert.equal(distanceToInterval(1), 10);
  });

  it('nearby objects give a perfect consonance (perfect 5th)', () => {
    assert.equal(distanceToInterval(0.02), 7);
  });

  it('typical distances (0.05–0.4) use several different intervals, not one', () => {
    const used = new Set([0.05, 0.1, 0.15, 0.2, 0.3, 0.4].map(distanceToInterval));
    assert.ok(used.size >= 4, `only ${[...used]}`);
  });

  it('clamps values outside [0, 1]', () => {
    assert.equal(distanceToInterval(-5), distanceToInterval(0));
    assert.equal(distanceToInterval(42), distanceToInterval(1));
  });

  it('is monotonic: a larger distance never gives a more consonant interval', () => {
    let prevRank = -1;
    for (let d = 0; d <= 1; d += 0.01) {
      const rank = CONSONANCE_LADDER.indexOf(distanceToInterval(d));
      assert.ok(rank >= prevRank, `d=${d.toFixed(2)}`);
      prevRank = rank;
    }
  });

  it('never produces harsh intervals (minor 2nd, tritone, major 7th)', () => {
    for (let i = 0; i <= 1000; i++) {
      assert.ok(![1, 6, 11].includes(distanceToInterval(i / 1000)));
    }
  });

  it('pixel distances are normalised by the diagonal, so resolution does not matter', () => {
    const small = distanceToInterval(pixelDistanceToNormalized(100, 640, 480));
    const large = distanceToInterval(pixelDistanceToNormalized(300, 1920, 1440));
    assert.equal(small, large);
  });

  it('rejects NaN and Infinity', () => {
    assert.throws(() => distanceToInterval(NaN), TypeError);
    assert.throws(() => distanceToInterval(Infinity), TypeError);
  });
});

describe('other mapping rules', () => {
  it('bright photo → bright mode, dark photo → dark mode', () => {
    assert.equal(brightnessToMode(1, 1), 'lydian');
    assert.equal(brightnessToMode(0, 0), 'phrygian');
  });

  it('styles shift the mood but stay inside the ladder', () => {
    assert.equal(shiftMode('ionian', 2), 'dorian');
    assert.equal(shiftMode('lydian', -3), 'lydian');
    assert.equal(shiftMode('aeolian', 5), 'phrygian');
  });

  it('tightly clustered points add one chord tone', () => {
    assert.equal(spreadToExtension(0.1), 1);
    assert.equal(spreadToExtension(0.4), 0);
  });

  it('tempo stays within the style range', () => {
    assert.equal(energyToTempo(0, [80, 120]), 80);
    assert.equal(energyToTempo(1, [80, 120]), 120);
    assert.equal(energyToTempo(5, [80, 120]), 120);
  });

  it('quantizeToScale pulls a note into the scale', () => {
    const cMajor = scalePitchClasses(0, 'ionian');
    assert.equal(quantizeToScale(61, cMajor), 60);  // C# → C
    assert.equal(quantizeToScale(64, cMajor), 64);  // E stays
  });

  it('a grey colour picks its degree from brightness, not from a noisy hue', () => {
    const key = { h: 0, s: 0.8, v: 0.8 };
    assert.equal(colorToDegree({ h: 200, s: 0.02, v: 1 }, key), 0);
    assert.equal(colorToDegree({ h: 17, s: 0.02, v: 1 }, key), 0);
  });
});

describe('buildChord: chord vocabulary', () => {
  it('power chord = root, fifth, octave', () => {
    assert.deepEqual(buildChord(0, 'ionian', 0, 'power').pcs, [0, 7, 0]);
  });
  it('add9 = triad + ninth', () => {
    assert.deepEqual(buildChord(0, 'ionian', 0, 'add9').pcs, [0, 4, 7, 2]);
  });
  it('the extension adds a seventh to a triad', () => {
    assert.deepEqual(buildChord(0, 'ionian', 0, 'triad', 1).pcs, [0, 4, 7, 11]);
  });
  it('drops a ♭9 above the root (Phrygian tonic)', () => {
    const { pcs } = buildChord(0, 'phrygian', 0, 'add9');
    assert.ok(!pcs.includes(1));
  });
});

describe('buildMusicalScore: integration', () => {
  const analysis = {
    palette: [
      { h: 210, s: 0.6, v: 0.55, r: 56, g: 98, b: 140, weight: 0.42 },
      { h: 25, s: 0.7, v: 0.9, r: 230, g: 140, b: 69, weight: 0.27 },
      { h: 120, s: 0.5, v: 0.4, r: 51, g: 102, b: 51, weight: 0.18 },
      { h: 0, s: 0.05, v: 0.95, r: 242, g: 235, b: 235, weight: 0.13 },
    ],
    keypoints: [
      { x: 0.1, y: 0.6, score: 0.9 }, { x: 0.35, y: 0.3, score: 0.7 },
      { x: 0.6, y: 0.7, score: 0.8 }, { x: 0.9, y: 0.2, score: 0.5 },
    ],
    features: { contrast: 0.6, saturation: 0.5, sharpness: 0.4 },
  };

  for (const style of STYLES) {
    it(`${style.name}: tonic first, no diminished or repeated chords, voicings in range and clash-free`, () => {
      const score = buildMusicalScore(analysis, { style });
      assert.equal(score.chords[0].degree, 0);
      assert.ok(score.tempo >= style.tempo[0] && score.tempo <= style.tempo[1]);
      score.chords.forEach((c, i) => {
        if (c.kind !== 'power') assert.ok(!isDiminished(c.pcs), c.symbol);
        if (i) assert.notEqual(c.degree, score.chords[i - 1].degree);
        assert.ok(c.voicing.every((m) => m >= style.register.low && m <= style.register.high), `${c.symbol} ${c.voicing}`);
        for (let k = 1; k < c.voicing.length; k++) assert.notEqual(c.voicing[k] - c.voicing[k - 1], 1, c.symbol);
      });
    });
  }

  it('is deterministic', () => {
    const style = getStyle('jazz');
    assert.deepEqual(
      buildMusicalScore(analysis, { style }).chords.map((c) => c.voicing),
      buildMusicalScore(analysis, { style }).chords.map((c) => c.voicing),
    );
  });

  it('melody notes are in the scale and use only ladder intervals', () => {
    const score = buildMusicalScore(analysis);
    assert.equal(score.melody.length, 4);
    for (const n of score.melody) {
      assert.ok(score.scale.includes(mod(n.midi, 12)));
      assert.ok(CONSONANCE_LADDER.includes(n.interval));
    }
  });

  it('a darker style makes the mode darker', () => {
    const neutral = buildMusicalScore(analysis, { style: getStyle('folk') });
    const trap = buildMusicalScore(analysis, { style: getStyle('trap') });
    const order = ['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian'];
    assert.ok(order.indexOf(trap.key.mode) > order.indexOf(neutral.key.mode));
  });

  it('an empty palette gives a clear error', () => {
    assert.throws(() => buildMusicalScore({ palette: [] }), /palette is empty/);
  });
});
