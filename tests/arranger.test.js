import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, applySwing, avoidClash, chordTimeline, humanize, tomPitchFor, TRACKS } from '../src/core/arranger.js';
import { buildMusicalScore } from '../src/core/mapping.js';
import { STYLES, getStyle } from '../src/core/styles.js';
import { mod } from '../src/core/music-theory.js';

const analysis = {
  palette: [
    { h: 30, s: 0.7, v: 0.8, r: 220, g: 140, b: 60, weight: 0.4 },
    { h: 200, s: 0.5, v: 0.5, r: 60, g: 110, b: 130, weight: 0.3 },
    { h: 100, s: 0.4, v: 0.6, r: 100, g: 150, b: 90, weight: 0.2 },
    { h: 300, s: 0.3, v: 0.3, r: 80, g: 50, b: 80, weight: 0.1 },
  ],
  keypoints: [{ x: 0.1, y: 0.5, score: 0.8 }, { x: 0.4, y: 0.2, score: 0.6 }, { x: 0.7, y: 0.8, score: 0.7 }],
  features: { contrast: 0.5, saturation: 0.5, sharpness: 0.5 },
};
const make = (id) => { const style = getStyle(id); return { style, ...arrange(buildMusicalScore(analysis, { style }), style) }; };

describe('arrange: every style', () => {
  for (const style of STYLES) {
    it(`${style.name}: all events valid and inside the loop`, () => {
      const a = arrange(buildMusicalScore(analysis, { style }), style);
      assert.ok(a.loopBars >= 2);
      for (const t of TRACKS) {
        for (const e of a.tracks[t]) {
          assert.ok(e.step >= 0 && e.step < a.loopSteps, `${t} step ${e.step}`);
          assert.ok(e.dur > 0, `${t} dur ${e.dur}`);
          assert.ok(e.vel > 0 && e.vel <= 1, `${t} vel ${e.vel}`);
          if (e.notes) assert.ok(e.notes.every((m) => m >= 24 && m <= 108), `${t} notes ${e.notes}`);
        }
      }
      assert.ok(a.tracks.chords.length > 0 && a.tracks.melody.length + a.tracks.pointDrums.length > 0);
    });
  }
});

describe('arrange: genre character', () => {
  it('drumless styles have no drum events', () => {
    for (const id of ['classical-piano', 'ambient']) {
      const a = make(id);
      assert.equal(a.tracks.kick.length + a.tracks.snare.length + a.tracks.hat.length, 0, id);
    }
  });

  it('house has a kick on every beat', () => {
    const a = make('house');
    assert.deepEqual(a.tracks.kick.map((e) => e.step).slice(0, 4), [0, 4, 8, 12]);
  });

  it('trap snare is half-time (one per bar, on beat 3) and hats contain fast rolls', () => {
    const a = make('trap');
    assert.deepEqual(a.tracks.snare.map((e) => e.step).slice(0, 2), [8, 24]);
    const steps = a.tracks.hat.map((e) => e.step);
    assert.ok(steps.some((s, i) => i && s - steps[i - 1] < 1), 'expected 32nd or triplet rolls');
  });

  it('hard rock plays root-position power chords', () => {
    const a = make('hard-rock');
    for (const e of a.tracks.chords) {
      const [r, f, o] = [...e.notes].sort((x, y) => x - y);
      assert.deepEqual([f - r, o - r], [7, 12]);
    }
  });

  it('classical piano is a one-note-at-a-time Alberti arpeggio in 8ths', () => {
    const a = make('classical-piano');
    assert.ok(a.tracks.chords.every((e) => e.notes.length === 1));
    assert.deepEqual(a.tracks.chords.slice(0, 4).map((e) => Math.round(e.step)), [0, 2, 4, 6]);   // humanized: within a few ms
  });

  it('jazz walks the bass: one note per beat', () => {
    const a = make('jazz');
    assert.deepEqual(a.tracks.bass.slice(0, 4).map((e) => Math.round(e.step)), [0, 4, 8, 12]);
  });

  it('bass notes follow the chord roots', () => {
    const a = make('indie-rock');
    for (const seg of a.segments) {
      const first = a.tracks.bass.find((e) => Math.abs(e.step - seg.startStep) < 0.5);   // rock is humanized
      assert.equal(mod(first.notes[0], 12), seg.chord.pcs[0]);
    }
  });
});

describe('arrange: rock', () => {
  it('hard rock mixes ringing accents with short palm-muted chugs', () => {
    const a = make('hard-rock');
    const muted = a.tracks.chords.filter((e) => e.muted);
    const open = a.tracks.chords.filter((e) => !e.muted);
    assert.ok(muted.length > 0 && open.length > 0);
    assert.ok(muted.every((e) => e.dur <= 1));
    assert.ok(open.every((e) => e.dur >= 2));
  });

  it('rock styles crash on every chord change and end the loop with a tom fill', () => {
    for (const id of ['hard-rock', 'indie-rock']) {
      const a = make(id);
      assert.equal(a.tracks.crash.length, a.segments.length, id);
      assert.equal(a.tracks.tom.length, 4, id);
      const fillStart = a.loopSteps - 4;
      assert.ok(a.tracks.snare.every((e) => e.step < fillStart - 0.5), `${id}: snare inside the fill`);
      const toms = a.tracks.tom.map((e) => e.notes[0]);
      assert.deepEqual(toms, [...toms].sort((x, y) => y - x), 'toms go from high to low');
    }
  });

  it('electronic styles have no toms or crashes', () => {
    for (const id of ['house', 'trap', 'synthwave']) {
      const a = make(id);
      assert.equal(a.tracks.tom.length + a.tracks.crash.length, 0, id);
    }
  });

  it('humanize is small, deterministic and keeps the downbeat', () => {
    const amt = { time: 0.1, vel: 0.15 };
    assert.deepEqual(humanize({ step: 0, vel: 0.8 }, amt, 3, 64).step, 0);
    const e = humanize({ step: 10, vel: 0.8 }, amt, 7, 64);
    assert.ok(Math.abs(e.step - 10) <= 0.05 && e.vel <= 0.8 && e.vel >= 0.68);
    assert.deepEqual(humanize({ step: 10, vel: 0.8 }, amt, 7, 64), e);
  });
});

describe('arrange: what the points play', () => {
  const score = (id) => buildMusicalScore(analysis, { style: getStyle(id) });

  it('rock, indie rock, jazz, boom bap and house play the points on drums by default', () => {
    for (const id of ['hard-rock', 'indie-rock', 'jazz', 'boom-bap', 'house']) {
      const a = arrange(score(id), getStyle(id));
      assert.equal(a.pointsAs, 'drums', id);
      assert.equal(a.tracks.melody.length, 0, id);
      assert.ok(a.tracks.pointDrums.length > 0, id);
    }
  });

  it('other styles keep a melody by default', () => {
    for (const id of ['classical-piano', 'trap', 'folk']) assert.equal(arrange(score(id), getStyle(id)).pointsAs, 'melody', id);
  });

  it('the user can override the style default in both directions, or switch the points off', () => {
    const rock = getStyle('hard-rock'), folk = getStyle('folk');
    assert.ok(arrange(score('hard-rock'), rock, { pointsAs: 'melody' }).tracks.melody.length > 0);
    assert.ok(arrange(score('folk'), folk, { pointsAs: 'drums' }).tracks.pointDrums.length > 0);
    const off = arrange(score('folk'), folk, { pointsAs: 'off' });
    assert.equal(off.tracks.melody.length + off.tracks.pointDrums.length, 0);
  });

  it('point drums follow the melody rhythm, one hit per point plus one accent', () => {
    const s = score('hard-rock');
    const a = arrange(s, getStyle('hard-rock'));
    const loops = Math.ceil(a.loopSteps / 32);
    const accents = a.tracks.pointDrums.filter((e) => e.voice === 'crash').length;
    assert.ok(accents >= 1 && accents <= loops);
    assert.ok(a.tracks.pointDrums.every((e) => e.pointIndex !== undefined));
  });

  it('jazz uses brush snare up high, toms down low and a ride accent', () => {
    const voices = new Set(arrange(score('jazz'), getStyle('jazz')).tracks.pointDrums.map((e) => e.voice));
    assert.deepEqual([...voices].sort(), ['ride', 'snare', 'tom']);
  });

  it('higher points hit higher toms', () => {
    assert.ok(tomPitchFor(88) > tomPitchFor(76) && tomPitchFor(76) > tomPitchFor(64));
    assert.equal(tomPitchFor(10), 40);
    assert.equal(tomPitchFor(200), 55);
  });
});

describe('arranger helpers', () => {
  it('chord timeline fills at least two bars', () => {
    const { loopBars, segments } = chordTimeline({ totalBars: 1, chords: [{ bars: 1 }] });
    assert.equal(loopBars, 2);
    assert.equal(segments.length, 2);
  });

  it('16th swing delays only odd 16ths, 8th swing only off-beat 8ths', () => {
    assert.equal(applySwing(4, 0.6), 4);
    assert.ok(applySwing(5, 0.6) > 5);
    assert.ok(applySwing(6, 0.9, 8) > 6);
    assert.equal(applySwing(5, 0.9, 8), 5);
  });

  it('avoidClash moves a melody note off a semitone clash with the chord', () => {
    assert.equal(avoidClash(65, [0, 4, 7]), 64);    // F over C major → E
    assert.equal(avoidClash(62, [0, 4, 7]), 62);    // D does not clash → unchanged
    assert.equal(avoidClash(67, [0, 4, 7]), 67);    // chord tone
  });
});
