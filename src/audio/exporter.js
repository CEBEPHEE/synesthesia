/**
 * "Save audio": renders the current arrangement faster than real time with an
 * offline audio context (same engine, same instruments, same mix), then encodes
 * a WAV file. Nothing is uploaded: the file is created in the browser.
 */
import Tone from '../../vendor/tone.mjs';
import { AudioEngine } from './audio-engine.js';
import { encodeWav, exportLength } from './wav.js';

/**
 * @param {{arrangement, style, tempo: number, reverb?: number|null, mutedTracks?: string[]}} job
 * @returns {Promise<{blob: Blob, wav: ArrayBuffer, seconds: number}>}
 */
export async function renderToWav({ arrangement, style, tempo, reverb = null, mutedTracks = [] }) {
  const { musicSeconds, totalSeconds } = exportLength(arrangement.loopSteps, tempo);
  const buffer = await Tone.Offline(async () => {
    const engine = new AudioEngine();
    await engine.init();
    if (reverb !== null) engine.setReverb(reverb);
    engine.mutedTracks = new Set(mutedTracks);
    await engine.load({ ...arrangement, tempo }, style);
    const transport = Tone.getTransport();
    transport.bpm.cancelScheduledValues(0);
    transport.bpm.value = tempo;            // no tempo ramp at the start of a file
    transport.start(0);
    transport.stop(musicSeconds);           // whole loops, then let the last notes ring out
  }, totalSeconds, 2, 44100);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const wav = encodeWav(channels, buffer.sampleRate, { fadeOut: 1.5 });
  return { blob: new Blob([wav], { type: 'audio/wav' }), wav, seconds: totalSeconds };
}

export const STEM_GROUPS = Object.freeze(['chords', 'bass', 'drums', 'melody']);

/**
 * Stems: one WAV per instrument group (same length, same mix, so they line up in
 * any DAW) plus the full mix. Groups the arrangement does not use are skipped.
 * @returns {Promise<Array<{group: string, wav: ArrayBuffer}>>}
 */
export async function renderStems(job, onProgress = () => {}) {
  const t = job.arrangement.tracks;
  const used = {
    chords: t.chords.length > 0,
    bass: t.bass.length > 0,
    drums: t.kick.length + t.snare.length + t.hat.length + t.tom.length + t.crash.length > 0,
    melody: t.melody.length + (t.pointDrums?.length ?? 0) > 0,
  };
  const groups = STEM_GROUPS.filter((g) => used[g]);
  const out = [];
  for (const [i, g] of [...groups, 'mix'].entries()) {
    onProgress(i, groups.length + 1, g);
    const mutedTracks = g === 'mix' ? [] : STEM_GROUPS.filter((x) => x !== g);
    const { wav } = await renderToWav({ ...job, mutedTracks });
    out.push({ group: g, wav });
  }
  return out;
}

/**
 * Soundtrack for a slideshow or video: the whole timeline rendered once, at
 * 48 kHz (the rate video codecs expect), optionally mixed with the video's own
 * sound underneath.
 * @param {{arrangement, style, tempo, reverb?, length: number, original?: AudioBuffer|null, originalLevel?: number}} job
 *   arrangement: timelineArrangement(timeline); length: seconds of the film
 * @returns {Promise<{channels: Float32Array[], sampleRate: number}>}
 */
export async function renderSoundtrack({ arrangement, style, tempo, reverb = null, length, original = null, originalLevel = 0.35, musicLevel = 1 }) {
  const sampleRate = 48000;
  const musicEnd = Math.min(length, (arrangement.loopSteps * 60) / tempo / 4);
  const buffer = await Tone.Offline(async () => {
    const engine = new AudioEngine();
    await engine.init();
    if (reverb !== null) engine.setReverb(reverb);
    await engine.load({ ...arrangement, tempo }, style);
    const transport = Tone.getTransport();
    transport.bpm.cancelScheduledValues(0);
    transport.bpm.value = tempo;
    transport.start(0);
    transport.stop(musicEnd);
  }, length, 2, sampleRate);
  const channels = [new Float32Array(buffer.getChannelData(0)), new Float32Array(buffer.getChannelData(1))];
  if (musicLevel !== 1) for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= musicLevel;
  if (original) {
    for (let c = 0; c < 2; c++) {
      const src = original.getChannelData(Math.min(c, original.numberOfChannels - 1));
      const dst = channels[c];
      const n = Math.min(dst.length, src.length);
      for (let i = 0; i < n; i++) dst[i] += src[i] * originalLevel;
    }
  }
  // gentle fade at the very end, and a safety clip
  const fade = Math.min(channels[0].length, Math.round(sampleRate * 1.2));
  for (const ch of channels) {
    for (let i = 0; i < fade; i++) ch[ch.length - 1 - i] *= i / fade;
    for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-0.99, Math.min(0.99, ch[i]));
  }
  return { channels, sampleRate };
}
