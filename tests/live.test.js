import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveConductor, pointsMoved } from '../src/core/live.js';
import { detectMotion, toLuma } from '../src/vision/motion.js';
import { getStyle } from '../src/core/styles.js';
import { FEATURES } from '../src/vision/features.js';

const feats = (v) => Object.fromEntries(FEATURES.map(({ id }) => [id, v]));
const kp = (dx = 0) => [{ x: 0.1 + dx, y: 0.5, score: 0.8 }, { x: 0.4 + dx, y: 0.2, score: 0.6 }, { x: 0.7 + dx, y: 0.8, score: 0.7 }];
const frame = (h, { dx = 0, v = 0.5 } = {}) => ({
  palette: [
    { h, s: 0.7, v: 0.8, weight: 0.4 }, { h: (h + 120) % 360, s: 0.5, v: 0.5, weight: 0.3 },
    { h: (h + 60) % 360, s: 0.4, v: 0.6, weight: 0.2 }, { h: (h + 200) % 360, s: 0.4, v: 0.5, weight: 0.1 },
  ],
  keypoints: kp(dx), features: feats(v),
});

describe('live conductor', () => {
  it('says nothing before the first frame, then starts', () => {
    const c = new LiveConductor({ getStyle });
    assert.equal(c.decide(), null);
    c.feed(frame(20));
    const d = c.decide();
    assert.equal(d.kind, 'start');
    assert.ok(d.arrangement.loopSteps > 0);
    assert.equal(d.arrangement.tempo, c.tempo);
  });
  it('keeps the music when nothing changes', () => {
    const c = new LiveConductor({ getStyle });
    c.feed(frame(20)); c.decide();
    for (let i = 0; i < 5; i++) { c.feed(frame(20)); assert.equal(c.decide(), null); }
  });
  it('a brief change of colour does not change the harmony', () => {
    const c = new LiveConductor({ getStyle, styleId: 'pop', smoothing: 1 });
    c.feed(frame(20)); c.decide();
    c.feed(frame(200)); assert.equal(c.decide(), null);       // one bar: not yet
    c.feed(frame(20)); assert.equal(c.decide(), null);        // back again: nothing happened
  });
  it('a lasting change switches the harmony after stableBars, with the same style and tempo', () => {
    const c = new LiveConductor({ getStyle, styleId: 'pop', smoothing: 1, stableBars: 2 });
    c.feed(frame(20)); const first = c.decide();
    c.feed(frame(200)); assert.equal(c.decide(), null);
    c.feed(frame(200)); const d = c.decide();
    assert.equal(d.kind, 'harmony');
    assert.notEqual(d.score.key.name + d.score.chords.map((x) => x.degree), first.score.key.name + first.score.chords.map((x) => x.degree));
    assert.equal(d.style.id, 'pop'); assert.equal(d.tempo, first.tempo);
  });
  it('moving points change only the melody, on the next bar', () => {
    const c = new LiveConductor({ getStyle, styleId: 'pop' });
    c.feed(frame(20)); const first = c.decide();
    c.feed(frame(20, { dx: 0.2 })); const d = c.decide();
    assert.equal(d.kind, 'melody');
    assert.deepEqual(d.score.chords.map((x) => x.degree), first.score.chords.map((x) => x.degree));
    assert.equal(d.score.key.name, first.score.key.name);
  });
  it('user changes apply on the next bar', () => {
    const c = new LiveConductor({ getStyle });
    c.feed(frame(20)); c.decide();
    c.set({ styleId: 'jazz' });
    const d = c.decide();
    assert.equal(d.kind, 'restyle'); assert.equal(d.style.id, 'jazz');
  });
  it('pointsMoved tolerates jitter', () => {
    assert.equal(pointsMoved(kp(), kp(0.01)), false);
    assert.equal(pointsMoved(kp(), kp(0.2)), true);
    assert.equal(pointsMoved(kp(), kp().slice(1)), true);
  });
});

describe('motion', () => {
  const W = 48, H = 36;
  const blank = () => new Uint8Array(W * H).fill(40);
  it('a still picture has no motion', () => {
    const r = detectMotion(blank(), blank(), W, H);
    assert.equal(r.energy, 0); assert.equal(r.points.length, 0);
  });
  it('finds where something moves', () => {
    const cur = blank();
    for (let y = 4; y < 12; y++) for (let x = 36; x < 44; x++) cur[y * W + x] = 230;   // a "hand" top right
    const r = detectMotion(blank(), cur, W, H);
    assert.ok(r.energy > 0.02);
    assert.ok(r.points.length >= 1);
    assert.ok(r.points[0].x > 0.7 && r.points[0].y < 0.35);
  });
  it('toLuma', () => {
    assert.deepEqual([...toLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))], [255, 0]);
  });
});
