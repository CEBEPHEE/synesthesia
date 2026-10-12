/**
 * Body and hand tracking for "Follow the dancer": MediaPipe Pose Landmarker and Hand
 * Landmarker (Google, Apache 2.0), bundled in /vendor/mediapipe and /assets/models,
 * running in this tab (WebAssembly on the CPU). Nothing is sent anywhere.
 * Loaded only when the feature is first used (about 23 MB, then cached by the browser).
 */
const BASE = new URL('../../', import.meta.url).href;
let ready = null;
let lastTs = 0;

async function create() {
  const { PoseLandmarker, HandLandmarker } = await import('../../vendor/mediapipe/vision_bundle.mjs');
  const fileset = {
    wasmLoaderPath: `${BASE}vendor/mediapipe/wasm/vision_wasm_internal.js`,
    wasmBinaryPath: `${BASE}vendor/mediapipe/wasm/vision_wasm_internal.wasm`,
  };
  // The CPU is fast enough for these small models and behaves the same on every computer
  // (the GPU path is very slow where there is only software graphics).
  const base = (file) => ({ modelAssetPath: `${BASE}assets/models/${file}`, delegate: 'CPU' });
  const [pose, hands] = await Promise.all([
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: base('pose_landmarker_lite.task'), runningMode: 'VIDEO', numPoses: 2,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    }),
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: base('hand_landmarker.task'), runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    }),
  ]);
  return { pose, hands };
}

/** Loads the trackers once. Resolves to true if this browser can run them. */
export function loadTrackers() {
  ready ??= create().catch((err) => { console.warn('Body tracking unavailable:', err); ready = null; throw err; });
  return ready.then(() => true, () => false);
}

export const trackersLoaded = () => ready !== null;

/**
 * Bodies and hands in the current frame of a video.
 * @returns {Promise<{bodies: Array<Array<{x,y,z,visibility}>>, hands: Array<Array<{x,y,z}>>}>}
 */
export async function trackFrame(video, timeMs) {
  if (!(await loadTrackers())) return { bodies: [], hands: [] };
  const t = await ready;
  const ts = Math.max(lastTs + 1, Math.round(timeMs));         // timestamps must keep increasing
  lastTs = ts;
  const bodies = t.pose.detectForVideo(video, ts).landmarks ?? [];
  const hands = t.hands.detectForVideo(video, ts).landmarks ?? [];
  return { bodies, hands };
}
