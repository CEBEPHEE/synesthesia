import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rgbToHsv, kMeans } from '../src/vision/color-quantizer.js';
import { detectKeypoints } from '../src/vision/keypoints.js';
import { computeFeatures, hueSpread, FEATURES } from '../src/vision/features.js';

/** Synthetic image: a fill plus an optional rectangle. */
function makeImage(w, h, bg, rect) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inRect = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const [r, g, b] = inRect ? rect.color : bg;
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

describe('rgbToHsv', () => {
  it('primary colours', () => {
    assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
    assert.equal(rgbToHsv(0, 255, 0).h, 120);
    assert.equal(rgbToHsv(0, 0, 255).h, 240);
    assert.deepEqual(rgbToHsv(128, 128, 128).s, 0);
  });
});

describe('kMeans', () => {
  const img = makeImage(40, 40, [20, 40, 200], { x: 0, y: 0, w: 20, h: 20, color: [240, 200, 30] });

  it('finds two colours with the right shares (75% / 25%)', () => {
    const palette = kMeans(img.data, { k: 4 });
    assert.equal(palette.length, 2);
    assert.ok(Math.abs(palette[0].weight - 0.75) < 1e-9);
    assert.deepEqual([palette[0].r, palette[0].g, palette[0].b], [20, 40, 200]);
  });

  it('is deterministic for the same seed', () => {
    assert.deepEqual(kMeans(img.data, { k: 3, seed: 7 }), kMeans(img.data, { k: 3, seed: 7 }));
  });

  it('ignores transparent pixels', () => {
    const transparent = new Uint8ClampedArray(16).fill(0);
    assert.deepEqual(kMeans(transparent), []);
  });
});

describe('detectKeypoints', () => {
  it('a flat frame has no points', () => {
    assert.deepEqual(detectKeypoints(makeImage(50, 50, [100, 100, 100])), []);
  });

  it('finds an object in the bottom-right corner', () => {
    const img = makeImage(100, 100, [240, 240, 240], { x: 70, y: 70, w: 16, h: 16, color: [200, 20, 20] });
    const [top] = detectKeypoints(img);
    assert.ok(top.x > 0.6 && top.y > 0.6, `point (${top.x.toFixed(2)}, ${top.y.toFixed(2)})`);
  });
});

/** Image with random per-pixel noise around a base colour. */
function noisyImage(w, h, [r, g, b], amount, seed = 1) {
  let a = seed;
  const rnd = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2 * amount;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const n = rnd(); data.set([r + n, g + n, b + n, 255], i * 4); }
  return { data, width: w, height: h };
}

describe('computeFeatures: photo fingerprint', () => {
  it('returns all eight features in 0..1', () => {
    const f = computeFeatures(makeImage(60, 40, [200, 120, 40], { x: 10, y: 10, w: 20, h: 10, color: [20, 60, 200] }));
    for (const { id } of FEATURES) assert.ok(f[id] >= 0 && f[id] <= 1, `${id}=${f[id]}`);
  });

  it('brightness: white is brighter than black', () => {
    assert.ok(computeFeatures(makeImage(30, 30, [250, 250, 250])).brightness > computeFeatures(makeImage(30, 30, [10, 10, 10])).brightness);
  });

  it('a grey image has zero saturation and colourfulness', () => {
    const f = computeFeatures(makeImage(30, 30, [128, 128, 128]));
    assert.equal(f.saturation, 0);
    assert.equal(f.colorfulness, 0);
  });

  it('warmth: orange is warmer than blue', () => {
    assert.ok(computeFeatures(makeImage(30, 30, [240, 140, 40])).warmth > computeFeatures(makeImage(30, 30, [40, 90, 230])).warmth);
  });

  it('grain: a noisy image has more texture than a flat one', () => {
    assert.ok(computeFeatures(noisyImage(60, 60, [128, 128, 128], 40)).grain > computeFeatures(makeImage(60, 60, [128, 128, 128])).grain);
  });

  it('sharpness: hard edges are sharper than a flat image', () => {
    const stripes = makeImage(60, 60, [0, 0, 0]);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (x % 6 < 3) stripes.data.set([255, 255, 255, 255], (y * 60 + x) * 4);
    assert.ok(computeFeatures(stripes).sharpness > 0.5);
    assert.equal(computeFeatures(makeImage(60, 60, [90, 90, 90])).sharpness, 0);
  });

  it('hueSpread: one hue = 0, opposite hues > 0.9', () => {
    assert.ok(hueSpread([{ h: 10, s: 0.8, weight: 1 }, { h: 10, s: 0.8, weight: 1 }]) < 1e-9);
    assert.ok(hueSpread([{ h: 0, s: 0.8, weight: 1 }, { h: 180, s: 0.8, weight: 1 }]) > 0.9);
  });
});
