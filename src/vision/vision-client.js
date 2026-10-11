/**
 * Facade over the analysis Web Worker. Accepts ANY CanvasImageSource:
 * ImageBitmap (photo), HTMLVideoElement (webcam), HTMLCanvasElement.
 * Moving from photos to live video needs no changes in this module.
 */
export class VisionAnalyzer {
  #worker; #seq = 0; #pending = new Map(); #inFlight = 0; #canvas; #ctx;

  constructor({ maxSide = 192 } = {}) {
    this.maxSide = maxSide;
    this.#worker = new Worker(new URL('./analyzer.worker.js', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      const p = this.#pending.get(data.id);
      if (!p) return;
      this.#pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
    this.#worker.onerror = (e) => {
      for (const p of this.#pending.values()) p.reject(new Error(e.message || 'Worker error'));
      this.#pending.clear();
    };
    this.#canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    this.#ctx = this.#canvas.getContext('2d', { willReadFrequently: true });
  }

  get busy() { return this.#inFlight > 0; }

  /**
   * Downscales the frame (≤ maxSide px is plenty for palette and geometry)
   * and sends the pixels to the worker.
   */
  analyze(source, options = {}) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return Promise.reject(new Error('Source has no size yet'));
    const scale = Math.min(1, this.maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    this.#canvas.width = w; this.#canvas.height = h;
    this.#ctx.drawImage(source, 0, 0, w, h);
    const { data } = this.#ctx.getImageData(0, 0, w, h);

    const id = ++this.#seq;
    this.#inFlight++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, width: w, height: h, buffer: data.buffer, options }, [data.buffer]);
    }).finally(() => { this.#inFlight--; });
  }

  /** For video: if the previous frame is still being analysed, skip this one (backpressure). */
  analyzeLatest(source, options) {
    return this.busy ? null : this.analyze(source, options);
  }

  dispose() {
    this.#worker.terminate();
    this.#pending.clear();
  }
}
