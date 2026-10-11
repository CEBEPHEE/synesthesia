/**
 * Frame sources. Everything returned here is a CanvasImageSource that
 * VisionAnalyzer understands. Files are only ever read locally.
 */

export const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** Photo file → ImageBitmap (honours EXIF orientation). No network requests. */
export async function loadImageFile(file) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('The image is larger than 30 MB.');
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * Ready for live video: the webcam as an async generator of frames.
 * Usage:
 *   const cam = new WebcamSource({ fps: 4 });
 *   await cam.start();
 *   for await (const frame of cam.frames()) {
 *     const job = analyzer.analyzeLatest(frame);
 *     if (job) job.then((a) => engine.load(buildMusicalScore(a, { prevVoicing })));
 *   }
 */
export class WebcamSource {
  #stream = null; #running = false;

  constructor({ fps = 4, constraints = { video: { width: { ideal: 640 } }, audio: false } } = {}) {
    this.fps = fps;
    this.constraints = constraints;
    this.video = null;
  }

  async start() {
    this.#stream = await navigator.mediaDevices.getUserMedia(this.constraints);
    this.video = Object.assign(document.createElement('video'), { playsInline: true, muted: true });
    this.video.srcObject = this.#stream;
    await this.video.play();
    this.#running = true;
  }

  async *frames() {
    while (this.#running) {
      yield this.video;
      await new Promise((r) => setTimeout(r, 1000 / this.fps));
    }
  }

  stop() {
    this.#running = false;
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }
}
