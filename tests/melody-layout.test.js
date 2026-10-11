/**
 * Melody from awkward layouts: tight clusters, horizontal lines, identical colours.
 * The photo's points must still produce a varied phrase spread over the 2 bars.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMelody, pointLayout, CONSONANCE_LADDER } from '../src/core/mapping.js';
import { scalePitchClasses, mod } from '../src/core/music-theory.js';

const scale = scalePitchClasses(7, 'ionian');            // G major
const c = (r, g, b) => ({ r, g, b });
const pts = (list) => list.map(([x, y, col]) => ({ x, y, score: 0.7, color: col }));

const SPREAD = pts([[0.1, 0.6, c(200, 120, 60)], [0.3, 0.2, c(240, 230, 120)], [0.55, 0.7, c(90, 40, 90)], [0.8, 0.35, c(120, 200, 190)], [0.9, 0.8, c(60, 90, 60)]]);
const CLUSTER = pts([[0.48, 0.5, c(200, 60, 60)], [0.5, 0.53, c(90, 90, 200)], [0.52, 0.49, c(230, 230, 90)], [0.47, 0.52, c(40, 90, 40)], [0.51, 0.47, c(200, 200, 200)]]);
const LINE_COLOURS = pts([[0.1, 0.5, c(40, 40, 60)], [0.3, 0.51, c(230, 220, 200)], [0.5, 0.5, c(120, 110, 90)], [0.7, 0.49, c(200, 180, 60)], [0.9, 0.5, c(60, 70, 90)]]);
const LINE_GREY = pts([[0.1, 0.5, c(120, 120, 120)], [0.3, 0.51, c(122, 120, 121)], [0.5, 0.5, c(119, 121, 120)], [0.7, 0.49, c(121, 119, 120)], [0.9, 0.5, c(120, 120, 122)]]);

const distinct = (arr) => new Set(arr).size;

describe('reading the layout', () => {
  it('a spread-out photo uses height and brightness', () => {
    assert.equal(pointLayout(SPREAD).contourFrom, 'height+brightness');
  });
  it('a horizontal line with different colours uses brightness', () => {
    const L = pointLayout(LINE_COLOURS);
    assert.equal(L.horizontal, true);
    assert.equal(L.contourFrom, 'brightness');
  });
  it('a horizontal line of identical colours falls back to a motif', () => {
    assert.equal(pointLayout(LINE_GREY).fallback, 'line');
  });
  it('a tight cluster is recognised and stretched', () => {
    const L = pointLayout(CLUSTER);
    assert.equal(L.cluster, true);
    assert.deepEqual([Math.min(...L.xs), Math.max(...L.xs)], [0, 1]);
  });
});

describe('melody from awkward layouts', () => {
  for (const [name, layout] of Object.entries({ spread: SPREAD, cluster: CLUSTER, 'horizontal line': LINE_COLOURS, 'grey line': LINE_GREY })) {
    it(`${name}: notes spread over the phrase, in the scale, not monotone`, () => {
      const { notes, edges } = buildMelody(layout, scale);
      const steps = notes.map((n) => n.step);
      assert.equal(distinct(steps), notes.length, 'no two notes on the same 16th');
      assert.ok(Math.max(...steps) - Math.min(...steps) >= 20, `phrase spans only ${Math.min(...steps)}..${Math.max(...steps)}`);
      assert.ok(notes.every((n) => scale.includes(mod(n.midi, 12))), 'all notes in the scale');
      assert.ok(distinct(notes.map((n) => n.midi)) >= 3, `only ${distinct(notes.map((n) => n.midi))} different notes`);
      assert.equal(edges.length, notes.length - 1);
    });
  }

  it('the cluster no longer plays every note in one burst (was steps 15–19)', () => {
    const steps = buildMelody(CLUSTER, scale).notes.map((n) => n.step);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] - steps[i - 1] >= 3, `notes ${steps[i - 1]} → ${steps[i]}`);
  });

  it('a horizontal line no longer repeats one interval', () => {
    const iv = buildMelody(LINE_COLOURS, scale).edges.map((e) => e.interval);
    assert.ok(distinct(iv) >= 2, `intervals ${iv}`);
  });

  it('with a contour, intervals still come from the consonance ladder', () => {
    for (const layout of [SPREAD, CLUSTER, LINE_COLOURS]) {
      for (const n of buildMelody(layout, scale).notes.slice(1)) assert.ok(CONSONANCE_LADDER.includes(Math.abs(n.interval)));
    }
  });

  it('a brighter point on a flat line plays higher than a darker one', () => {
    const notes = buildMelody(LINE_COLOURS, scale).notes;
    const byPoint = Object.fromEntries(notes.map((n) => [n.pointIndex, n.midi]));
    assert.ok(byPoint[1] > byPoint[0], 'bright cream (point 2) above dark navy (point 1)');
  });
});
