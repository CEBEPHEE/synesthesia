/**
 * Web Worker: the heavy pixel work (k-means, Sobel, features) runs off the main
 * thread. Pixels arrive as a Transferable buffer (no copy); nothing is stored
 * and nothing is sent anywhere.
 */
import { kMeans } from './color-quantizer.js';
import { detectKeypoints } from './keypoints.js';
import { computeFeatures } from './features.js';

self.onmessage = ({ data }) => {
  const { id, width, height, buffer, options = {} } = data;
  try {
    const t0 = performance.now();
    const pixels = new Uint8ClampedArray(buffer);
    const img = { data: pixels, width, height };
    const palette = kMeans(pixels, { k: options.colors ?? 6, seed: options.seed ?? 1337 });
    const keypoints = detectKeypoints(img, { maxPoints: options.maxPoints ?? 7 });
    const features = computeFeatures(img, palette);
    self.postMessage({ id, ok: true, result: { palette, keypoints, features, width, height, ms: performance.now() - t0 } });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
