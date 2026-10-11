import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, timelineEvents, sectionSteps, barsPerPhoto, averageFeatures, stepsToSeconds } from '../src/core/timeline.js';
import { frameSignature, signatureDistance, detectScenes, fitRect, outputSize } from '../src/video/scenes.js';
import { getStyle } from '../src/core/styles.js';
import { FEATURES } from '../src/vision/features.js';

const feats = (v) => Object.fromEntries(FEATURES.map(({ id }) => [id, v]));
const analysis = (h, v = 0.5) => ({
  palette: [
    { h, s: 0.7, v: 0.8, weight: 0.4 }, { h: (h + 120) % 360, s: 0.5, v: 0.5, weight: 0.3 },
    { h: (h + 60) % 360, s: 0.4, v: 0.6, weight: 0.2 }, { h: (h + 200) % 360, s: 0.4, v: 0.5, weight: 0.1 },
  ],
  keypoints: [{ x: 0.1, y: 0.5, score: 0.8 }, { x: 0.4, y: 0.2, score: 0.6 }, { x: 0.7, y: 0.8, score: 0.7 }, { x: 0.9, y: 0.4, score: 0.6 }],
  features: feats(v),
});

describe('timeline', () => {
  it('averages fingerprints weighted by duration', () => {
    const f = averageFeatures([{ analysis: analysis(0, 0), seconds: 1 }, { analysis: analysis(0, 1), seconds: 3 }]);
    assert.equal(f.contrast, 0.75);
  });
  it('snaps sections to beats without drifting', () => {
    const steps = sectionSteps([1.3, 1.3, 1.3, 1.3], 120);   // 1.3 s = 10.4 steps at 120 bpm
    steps.forEach((s) => assert.equal(s % 4, 0));
    assert.equal(steps.reduce((a, b) => a + b), 40);           // 5.2 s → 41.6 → 40 (nearest beat)
  });
  it('gives every section at least one beat', () => {
    assert.ok(sectionSteps([0.01, 0.01], 90).every((s) => s >= 4));
  });
  it('barsPerPhoto is at least one bar', () => {
    assert.equal(barsPerPhoto(0.1, 120), 1);
    assert.equal(barsPerPhoto(4, 120), 2);
  });
  it('one style and tempo for the whole film, chords chained across scenes', () => {
    const scenes = [{ analysis: analysis(10), seconds: 4 }, { analysis: analysis(200), seconds: 4 }, { analysis: analysis(90), seconds: 4 }];
    const tl = buildTimeline(scenes, { getStyle, styleId: 'pop', snap: 'bar' });
    assert.equal(tl.style.id, 'pop');
    assert.equal(tl.sections.length, 3);
    tl.sections.forEach((s) => assert.equal(s.steps % 16, 0));
    assert.equal(tl.totalSteps, tl.sections.reduce((a, s) => a + s.steps, 0));
    assert.ok(Math.abs(tl.totalSeconds - stepsToSeconds(tl.totalSteps, tl.tempo)) < 1e-9);
    assert.equal(tl.sections[1].startStep, tl.sections[0].steps);
  });
  it('auto style comes from the ranking', () => {
    const tl = buildTimeline([{ analysis: analysis(10), seconds: 5 }], { getStyle });
    assert.equal(tl.style.id, tl.ranking[0].style.id);
  });
  it('events stay inside their sections and never ring into the next one', () => {
    const scenes = [{ analysis: analysis(10), seconds: 3 }, { analysis: analysis(200), seconds: 5 }];
    const tl = buildTimeline(scenes, { getStyle, styleId: 'jazz' });
    const ev = timelineEvents(tl);
    for (const list of Object.values(ev)) {
      for (const e of list) {
        const s = tl.sections[e.section];
        assert.ok(e.step >= s.startStep && e.step < s.startStep + s.steps);
        if (e.dur) assert.ok(e.step + e.dur <= s.startStep + s.steps + 1e-9);
      }
      for (let i = 1; i < list.length; i++) assert.ok(list[i].step >= list[i - 1].step);
    }
    assert.ok(ev.chords.length > 0);
  });
  it('throws without scenes', () => assert.throws(() => buildTimeline([], { getStyle })));
});

const solid = (r, g, b, n = 64) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set([r, g, b, 255], i * 4); return a; };

describe('scene detection', () => {
  it('identical frames have zero distance, different colours a large one', () => {
    const red = frameSignature(solid(220, 30, 30)), blue = frameSignature(solid(30, 30, 220));
    assert.equal(signatureDistance(red, frameSignature(solid(220, 30, 30))), 0);
    assert.ok(signatureDistance(red, blue) > 1);
  });
  it('finds a cut between two shots', () => {
    const sigs = [], times = [];
    for (let t = 0; t < 10; t += 0.5) { sigs.push(frameSignature(t < 6 ? solid(220, 30, 30) : solid(30, 200, 60))); times.push(t); }
    const scenes = detectScenes(sigs, times, { duration: 10 });
    assert.deepEqual(scenes, [{ start: 0, end: 6 }, { start: 6, end: 10 }]);
  });
  it('ignores cuts closer than minScene and covers the whole video', () => {
    const sigs = [], times = [];
    for (let t = 0; t < 10; t += 0.5) { sigs.push(frameSignature(Math.floor(t * 2) % 2 ? solid(250, 250, 250) : solid(0, 0, 0))); times.push(t); }
    const scenes = detectScenes(sigs, times, { duration: 10, minScene: 2 });
    for (const s of scenes) assert.ok(s.end - s.start >= 2 - 1e-9);
    assert.equal(scenes[0].start, 0);
    assert.equal(scenes.at(-1).end, 10);
  });
  it('a static video is one scene', () => {
    const sigs = Array.from({ length: 8 }, () => frameSignature(solid(100, 100, 100)));
    assert.deepEqual(detectScenes(sigs, sigs.map((_, i) => i), { duration: 8 }), [{ start: 0, end: 8 }]);
  });
});

describe('framing', () => {
  it('cover fills, contain fits', () => {
    const c = fitRect(400, 300, 160, 90, 'cover');
    assert.ok(c.w >= 160 && c.h >= 90);
    const f = fitRect(400, 300, 160, 90, 'contain');
    assert.ok(f.w <= 160 && f.h <= 90 + 1e-9);
  });
  it('output sizes are even', () => {
    for (const a of ['16:9', '9:16', '1:1', 'original']) {
      const s = outputSize(a, 720, 1001, 667);
      assert.equal(s.width % 2, 0); assert.equal(s.height % 2, 0);
    }
    assert.deepEqual(outputSize('16:9', 720), { width: 1280, height: 720 });
    assert.deepEqual(outputSize('9:16', 720), { width: 720, height: 1280 });
    assert.deepEqual(outputSize('original', 720, 400, 300), { width: 960, height: 720 });
    assert.ok(outputSize('original', 720, 5000, 500).width <= 720 * 2.2 + 2);
  });
});

describe('timeline as one arrangement', async () => {
  const { timelineArrangement, sectionAt } = await import('../src/core/timeline.js');
  it('covers the whole film, with segments in every section', () => {
    const scenes = [{ analysis: analysis(10), seconds: 4 }, { analysis: analysis(200), seconds: 6 }];
    const tl = buildTimeline(scenes, { getStyle, styleId: 'pop', snap: 'bar' });
    const a = timelineArrangement(tl);
    assert.equal(a.loopSteps, tl.totalSteps);
    assert.ok(a.segments.some((g) => g.section === 0) && a.segments.some((g) => g.section === 1));
    assert.ok(a.segments.every((g) => g.startStep + g.steps <= tl.totalSteps));
    assert.equal(sectionAt(tl, 0), 0);
    assert.equal(sectionAt(tl, tl.sections[1].startSec + 0.01), 1);
  });
});
