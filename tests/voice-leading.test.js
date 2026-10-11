import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLead, nearestMidiWithPc, permutations, dissonancePenalty } from '../src/core/voice-leading.js';
import { diatonicChord } from '../src/core/music-theory.js';

describe('voiceLead: smooth voice leading', () => {
  it('C → Am: only one voice moves, by a whole tone (G → A)', () => {
    assert.deepEqual(voiceLead([60, 64, 67], [9, 0, 4]), [60, 64, 69]);
  });

  it('I–vi–IV–V–I: no voice jumps more than a perfect 4th', () => {
    let prev = null;
    for (const d of [0, 5, 3, 4, 0]) {
      const next = voiceLead(prev, diatonicChord(0, 'ionian', d, 3));
      if (prev) next.forEach((m, i) => assert.ok(Math.abs(m - prev[i]) <= 5, `degree ${d}: ${prev} → ${next}`));
      prev = next;
    }
  });

  it('going from 3 to 5 voices works without semitone clashes', () => {
    const v = voiceLead([60, 64, 67], diatonicChord(0, 'ionian', 3, 5)); // Fmaj7(9)
    assert.equal(v.length, 5);
    for (let i = 1; i < v.length; i++) assert.notEqual(v[i] - v[i - 1], 1);
  });

  it('dissonance penalty: a cluster scores worse than an open voicing', () => {
    assert.ok(dissonancePenalty([60, 61, 64]) > dissonancePenalty([60, 64, 67]));
  });
});

describe('helpers', () => {
  it('nearestMidiWithPc picks the nearest octave', () => {
    assert.equal(nearestMidiWithPc(0, 62), 60);
    assert.equal(nearestMidiWithPc(0, 70), 72);
  });

  it('permutations: 4! = 24', () => {
    assert.equal(permutations([1, 2, 3, 4]).length, 24);
  });
});
