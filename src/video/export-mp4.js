/**
 * MP4 export, entirely in the browser and free: WebCodecs encodes the frames
 * and the soundtrack, mp4-muxer (MIT, bundled in /vendor) packs them into an .mp4.
 *
 * Codecs, best first:  video H.264 → VP9 → AV1,  audio AAC → Opus.
 * H.264 + AAC plays everywhere (phones, Instagram, TikTok, YouTube, WhatsApp);
 * the others are used only by browsers without an H.264/AAC encoder.
 * Browsers without WebCodecs fall back to recording the canvas in real time
 * (MediaRecorder), which gives WebM or MP4 depending on the browser.
 */
import { Muxer, ArrayBufferTarget } from '../../vendor/mp4-muxer.mjs';

const VIDEO_CODECS = [
  { codec: 'avc1.640028', mux: 'avc' },     // H.264 High 4.0 (1080p30)
  { codec: 'avc1.4d0028', mux: 'avc' },     // H.264 Main 4.0
  { codec: 'avc1.42001f', mux: 'avc' },     // H.264 Baseline 3.1 (720p)
  { codec: 'vp09.00.40.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
];
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', mux: 'aac' },
  { codec: 'opus', mux: 'opus' },
];

export const canEncode = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

/** First supported pair of codecs, or null. */
export async function pickCodecs(width, height, fps, sampleRate = 48000) {
  if (!canEncode()) return null;
  let video = null, audio = null;
  for (const c of VIDEO_CODECS) {
    const config = { codec: c.codec, width, height, bitrate: videoBitrate(width, height), framerate: fps };
    if (c.mux === 'avc') config.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) { video = { ...c, config }; break; } } catch { /* try next */ }
  }
  for (const c of AUDIO_CODECS) {
    const config = { codec: c.codec, sampleRate, numberOfChannels: 2, bitrate: 192_000 };
    try { if ((await AudioEncoder.isConfigSupported(config)).supported) { audio = { ...c, config }; break; } } catch { /* try next */ }
  }
  return video && audio ? { video, audio } : null;
}

const videoBitrate = (w, h) => Math.round(Math.min(12e6, Math.max(2.5e6, w * h * 30 * 0.12)));

/**
 * @param {object} job
 *   width, height, fps, duration (s)
 *   drawFrame(ctx, t): draws the picture at time t (may be async, e.g. a video seek)
 *   audio: { channels: Float32Array[2], sampleRate }
 *   frames?: async iterator mode — `capture(onFrame)` for real-time video capture (see video-stage)
 *   onProgress(fraction), signal (AbortSignal)
 * @returns {Promise<{blob: Blob, codecs: string}>}
 */
export async function exportMp4({ width, height, fps, duration, drawFrame, capture = null, audio, onProgress = () => {}, signal }) {
  const codecs = await pickCodecs(width, height, fps, audio.sampleRate);
  if (!codecs) return recordFallback({ width, height, fps, duration, drawFrame, capture, audio, onProgress, signal });

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: codecs.video.mux, width, height, frameRate: fps },
    audio: { codec: codecs.audio.mux, numberOfChannels: 2, sampleRate: audio.sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  venc.configure(codecs.video.config);
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } });
  aenc.configure(codecs.audio.config);

  // ── sound first (fast) ──
  const { channels, sampleRate } = audio;
  const total = Math.min(channels[0].length, Math.round(duration * sampleRate));
  const block = 4800;
  for (let i = 0; i < total; i += block) {
    const n = Math.min(block, total - i);
    const data = new Float32Array(n * 2);
    data.set(channels[0].subarray(i, i + n), 0);
    data.set(channels[1].subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sampleRate) * 1e6), data });
    aenc.encode(ad);
    ad.close();
  }

  // ── pictures ──
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  const frameCount = Math.max(1, Math.round(duration * fps));
  const keyEvery = fps * 2;
  const encodeFrame = async (i) => {
    if (failure) throw failure;
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));    // backpressure
    onProgress((i + 1) / frameCount);
  };

  if (capture) {
    // real-time capture (videos): `capture` calls back for each output frame index
    await capture(ctx, frameCount, encodeFrame);
  } else {
    for (let i = 0; i < frameCount; i++) {
      await drawFrame(ctx, i / fps);
      await encodeFrame(i);
    }
  }

  await Promise.all([venc.flush(), aenc.flush()]);
  if (failure) throw failure;
  venc.close(); aenc.close();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  return { blob, codecs: `${codecs.video.mux.toUpperCase()} + ${codecs.audio.mux.toUpperCase()}`, extension: 'mp4' };
}

/** No WebCodecs: play the film in real time and record it (slower, but works in older browsers). */
async function recordFallback({ width, height, fps, duration, drawFrame, capture, audio, onProgress, signal }) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot create videos. Try a recent Chrome, Edge or Safari.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const ac = new AudioContext({ sampleRate: audio.sampleRate });
  const buf = ac.createBuffer(2, audio.channels[0].length, audio.sampleRate);
  buf.copyToChannel(audio.channels[0], 0); buf.copyToChannel(audio.channels[1], 1);
  const src = ac.createBufferSource(); src.buffer = buf;
  const dest = ac.createMediaStreamDestination(); src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: videoBitrate(width, height) });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => { rec.onstop = r; });
  await ac.resume();
  rec.start(1000);
  const t0 = ac.currentTime + 0.05;
  src.start(t0);
  if (capture) {
    await capture(ctx, Math.round(duration * fps), async (i) => onProgress(i / (duration * fps)));
  } else {
    await new Promise((resolve, reject) => {
      const tick = async () => {
        if (signal?.aborted) { reject(new DOMException('Export cancelled', 'AbortError')); return; }
        const t = ac.currentTime - t0;
        if (t >= duration) { resolve(); return; }
        await drawFrame(ctx, Math.max(0, t));
        onProgress(t / duration);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  rec.stop(); src.stop(); await stopped; await ac.close();
  const mime = rec.mimeType || type || 'video/webm';
  return { blob: new Blob(parts, { type: mime }), codecs: mime, extension: mime.includes('mp4') ? 'mp4' : 'webm' };
}
