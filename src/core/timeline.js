/**
 * Multi-scene music for slideshows and videos. Pure (no DOM, no Tone.js).
 *
 * One style and one tempo for the whole film (so it sounds like one piece),
 * but every scene gets its own key colour, chords and melody from its own frame.
 * Chords flow from scene to scene (each section starts from the voicing the
 * previous one ended on), and section boundaries sit on beats.
 */
import { buildMusicalScore, energyToTempo } from './mapping.js';
import { arrange, TRACKS } from './arranger.js';
import { classifyStyle } from './styles.js';
import { FEATURES } from '../vision/features.js';

export const STEPS_PER_BEAT = 4;

/** Seconds → 16th steps at a tempo. */
export const secondsToSteps = (sec, tempo) => (sec * tempo * 4) / 60;
export const stepsToSeconds = (steps, tempo) => (steps * 60) / (tempo * 4);

/** Duration-weighted average photo fingerprint of all scenes (chooses the film's style). */
export function averageFeatures(scenes) {
  const total = scenes.reduce((s, sc) => s + sc.seconds, 0) || 1;
  const out = {};
  for (const { id } of FEATURES) out[id] = scenes.reduce((s, sc) => s + (sc.analysis.features?.[id] ?? 0.5) * sc.seconds, 0) / total;
  return out;
}

/**
 * Snap scene boundaries to beats (cumulatively, so rounding never drifts).
 * @param {number[]} durations  seconds per scene
 * @returns {number[]} steps per scene (multiples of a beat, each at least one beat)
 */
export function sectionSteps(durations, tempo) {
  const out = [];
  let t = 0, prevEnd = 0;
  for (const d of durations) {
    t += d;
    let end = Math.round(secondsToSteps(t, tempo) / STEPS_PER_BEAT) * STEPS_PER_BEAT;
    end = Math.max(end, prevEnd + STEPS_PER_BEAT);
    out.push(end - prevEnd);
    prevEnd = end;
  }
  return out;
}

/** Whole bars per photo for a slideshow, close to the requested seconds. */
export function barsPerPhoto(seconds, tempo) {
  return Math.max(1, Math.round(secondsToSteps(seconds, tempo) / 16));
}

/**
 * @param {Array<{analysis, seconds}>} scenes
 * @param {{styleId?: string|null, getStyle, mood?, pointsAs?, tempo?, snap?: 'beat'|'bar'}} options
 *   snap 'bar' (slideshows): every scene lasts whole bars, so slides change on the downbeat.
 * @returns {{style, tempo, ranking, pointsAs, sections, totalSteps, totalSeconds}}
 */
export function buildTimeline(scenes, { styleId = null, getStyle, mood = 0, pointsAs, tempo = null, snap = 'beat' } = {}) {
  if (!scenes.length) throw new Error('no scenes');
  const features = averageFeatures(scenes);
  const { best, ranking } = classifyStyle(features);
  const style = styleId ? getStyle(styleId) : best.style;
  const energy = (features.contrast + features.saturation + features.sharpness) / 3;
  const bpm = tempo ?? energyToTempo(energy, style.tempo);

  const steps = snap === 'bar'
    ? scenes.map((sc) => barsPerPhoto(sc.seconds, bpm) * 16)
    : sectionSteps(scenes.map((sc) => sc.seconds), bpm);

  const sections = [];
  let start = 0, prevVoicing = null, mode = null;
  scenes.forEach((sc, i) => {
    const score = buildMusicalScore(sc.analysis, { style, prevVoicing, mood });
    const arrangement = arrange(score, style, { pointsAs });
    mode = arrangement.pointsAs;
    sections.push({ index: i, score, arrangement, startStep: start, steps: steps[i], startSec: stepsToSeconds(start, bpm), seconds: stepsToSeconds(steps[i], bpm) });
    prevVoicing = score.chords.at(-1).voicing;
    start += steps[i];
  });
  return { style, tempo: bpm, ranking, pointsAs: mode, sections, totalSteps: start, totalSeconds: stepsToSeconds(start, bpm) };
}

/**
 * Flattens the sections into one list of absolutely-timed events per track:
 * each section's loop repeats inside the section and stops at its end.
 * @returns {Record<string, Array>} events with absolute `step`, plus `section`
 */
export function timelineEvents(timeline) {
  const tracks = Object.fromEntries(TRACKS.map((t) => [t, []]));
  for (const sec of timeline.sections) {
    const { arrangement, startStep, steps, index } = sec;
    for (const t of TRACKS) {
      for (let base = 0; base < steps; base += arrangement.loopSteps) {
        for (const e of arrangement.tracks[t]) {
          const local = base + e.step;
          if (local >= steps) continue;
          const dur = e.dur ? Math.min(e.dur, steps - local) : e.dur;   // nothing rings into the next scene
          tracks[t].push({ ...e, dur, step: startStep + local, section: index });
        }
      }
    }
  }
  for (const t of TRACKS) tracks[t].sort((a, b) => a.step - b.step);
  return tracks;
}

/**
 * The whole film as one long "arrangement" the audio engine and exporters already
 * understand: loopSteps = the film's length, segments placed absolutely.
 */
export function timelineArrangement(timeline) {
  const segments = [];
  for (const sec of timeline.sections) {
    const { arrangement, startStep, steps, index } = sec;
    for (let base = 0; base < steps; base += arrangement.loopSteps) {
      for (const g of arrangement.segments) {
        if (base + g.startStep >= steps) continue;
        segments.push({ ...g, startStep: startStep + base + g.startStep, steps: Math.min(g.steps, steps - base - g.startStep), section: index });
      }
    }
  }
  return {
    tempo: timeline.tempo, pointsAs: timeline.pointsAs, loopSteps: timeline.totalSteps,
    loopBars: timeline.totalSteps / 16, segments, tracks: timelineEvents(timeline),
  };
}

/** Which section is playing at a time (seconds). */
export function sectionAt(timeline, seconds) {
  const s = timeline.sections;
  for (let i = s.length - 1; i >= 0; i--) if (seconds >= s[i].startSec) return i;
  return 0;
}
