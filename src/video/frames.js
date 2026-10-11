/**
 * Reading videos in the browser: load a file, seek, sample frames for scene
 * detection, grab stills for analysis, decode the soundtrack. Nothing is uploaded:
 * the file is played from a local blob: URL.
 */
import { frameSignature } from './scenes.js';

export const MAX_VIDEO_SECONDS = 180;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** @returns {Promise<HTMLVideoElement>} ready to seek, muted, with `.file` and `.usableDuration` */
export async function loadVideo(file) {
  if (file.size > MAX_VIDEO_BYTES) throw new Error('The video is larger than 500 MB.');
  const video = document.createElement('video');
  Object.assign(video, { muted: true, playsInline: true, preload: 'auto', src: URL.createObjectURL(file) });
  // Browsers only deliver decoded frames promptly for videos that are in the page,
  // so it sits there invisibly (the visible picture is drawn on the canvas).
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
  document.body.append(video);
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('This browser cannot play that video format. Try MP4 (H.264) or WebM.')), { once: true });
  });
  if (!video.videoWidth) throw new Error('That video has no picture.');
  let duration = video.duration;
  if (!Number.isFinite(duration)) {          // some recordings only report their length after a seek to the end
    video.currentTime = 1e7;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    duration = video.duration;
  }
  video.file = file;
  video.fullDuration = duration;
  video.usableDuration = Math.min(duration, MAX_VIDEO_SECONDS);
  return video;
}

export function seekTo(video, t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) { resolve(); return; }
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
    const timer = setTimeout(done, 3000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

/** Small frames every `step` seconds → colour signatures (for scene cuts). */
export async function sampleSignatures(video, { step = 0.5, onProgress = () => {} } = {}) {
  const duration = video.usableDuration;
  step = Math.max(step, duration / 240);
  const c = new OffscreenCanvas(48, 27);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const signatures = [], times = [];
  for (let t = 0; t < duration; t += step) {
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, 48, 27);
    signatures.push(frameSignature(ctx.getImageData(0, 0, 48, 27).data));
    times.push(t);
    onProgress(t / duration);
  }
  return { signatures, times };
}

/** A still frame (for analysis and the scene strip). */
export async function grabFrame(video, t) {
  await seekTo(video, t);
  return createImageBitmap(video);
}

/** The video's own sound, resampled to `sampleRate`, or null if it has none. */
export async function decodeSoundtrack(file, sampleRate = 48000) {
  try {
    const data = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(2, sampleRate, sampleRate);
    return await ctx.decodeAudioData(data);
  } catch {
    return null;
  }
}
