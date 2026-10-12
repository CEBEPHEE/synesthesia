/**
 * Standard MIDI File (format 1) from an arrangement — open it in Ableton, FL Studio,
 * Logic, GarageBand, MuseScore… Pure: no Web Audio, unit-tested in Node.
 *
 * Tracks: tempo map, Chords, Bass, Melody (or the point drums), Drums.
 * Pitched parts get the closest General MIDI instrument; drums use channel 10
 * with the General MIDI drum map, so any DAW plays sensible sounds right away.
 */
import { APP_CREDIT } from '../credit.js';

export const PPQ = 480;
const TICKS_PER_STEP = PPQ / 4;                 // one 16th note

/** General MIDI programs (0-based) for each of the app's instruments. */
export const GM_PROGRAMS = Object.freeze({
  piano: 0, strings: 48, acousticGuitar: 25, nylonGuitar: 24, harp: 46, cleanGuitar: 27,
  crunchGuitar: 29, rockGuitar: 30, fuzzGuitar: 30, pad: 89, supersaw: 81,
  saxophone: 65, flute: 73, violin: 40, horn: 60, xylophone: 13, guitarLead: 29, square: 80,
  electricBass: 33, rockBass: 34, upright: 32, contrabass: 43, synth: 38, '808': 38,
});

/** General MIDI drum map. */
export const GM_DRUMS = Object.freeze({
  kick: 36, snare: 38, clap: 39, hatClosed: 42, hatOpen: 46, crash: 49, ride: 51, shaker: 82,
  toms: [41, 43, 45, 47, 48, 50],               // low floor tom … high tom
});

/** The app's tom pitches (E2…G3) → the six General MIDI toms. */
export function gmTom(midi) {
  const t = Math.min(1, Math.max(0, (midi - 40) / 15));
  return GM_DRUMS.toms[Math.round(t * (GM_DRUMS.toms.length - 1))];
}

/** Variable-length quantity (MIDI delta times). */
export function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const text = (s) => [...new TextEncoder().encode(s)];
const vel7 = (v) => Math.max(1, Math.min(127, Math.round(v * 127)));

/** Builds one MTrk chunk from absolute-tick events [{tick, data:[…bytes]}]. */
function trackChunk(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(Math.max(0, e.tick - last)), ...e.data);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);                   // end of track
  return [...text('MTrk'), ...u32(body.length), ...body];
}

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];

function noteEvents(list, channel, loops, loopSteps, { drumNote = null, minDur = 0.25 } = {}) {
  const out = [];
  for (let l = 0; l < loops; l++) {
    for (const e of list) {
      const notes = drumNote ? [drumNote(e)] : e.notes;
      if (!notes) continue;
      const on = Math.round((e.step + l * loopSteps) * TICKS_PER_STEP);
      const off = on + Math.max(1, Math.round(Math.max(minDur, drumNote ? 1 : e.dur) * TICKS_PER_STEP));
      for (const n of notes) {
        out.push({ tick: on, order: 1, data: [0x90 | channel, n & 127, vel7(e.vel)] });
        out.push({ tick: off, order: 0, data: [0x80 | channel, n & 127, 0] });
      }
    }
  }
  return out;
}

const header = (name, channel, program) => [
  { tick: 0, order: -2, data: [0xff, 0x03, ...vlq(text(name).length), ...text(name)] },
  ...(program === null ? [] : [{ tick: 0, order: -1, data: [0xc0 | channel, program & 127] }]),
];

/**
 * @param {object} arrangement  from core/arranger.js
 * @param {object} style        from core/styles.js
 * @param {{loops?: number, tempo?: number, title?: string}} options
 * @returns {Uint8Array} the .mid file
 */
export function arrangementToMidi(arrangement, style, { loops = 4, tempo = arrangement.tempo, title = 'Synesthesia' } = {}) {
  const { tracks, loopSteps } = arrangement;
  const kit = style.sound.kit;
  const chunks = [];

  // Conductor track: name, tempo, 4/4
  const usPerBeat = Math.round(60_000_000 / tempo);
  chunks.push(trackChunk([
    { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(text(title).length), ...text(title)] },
    { tick: 0, order: 0, data: [0xff, 0x02, ...vlq(text(APP_CREDIT).length), ...text(APP_CREDIT)] },   // copyright notice
    { tick: 0, order: 1, data: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255] },
    { tick: 0, order: 2, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ]));

  chunks.push(trackChunk([...header('Chords', 0, GM_PROGRAMS[style.sound.chords] ?? 0), ...noteEvents(tracks.chords, 0, loops, loopSteps)]));
  if (tracks.bass.length) {
    chunks.push(trackChunk([...header('Bass', 1, GM_PROGRAMS[style.sound.bass] ?? 33), ...noteEvents(tracks.bass, 1, loops, loopSteps)]));
  }
  if (tracks.melody.length) {
    chunks.push(trackChunk([...header('Melody (points)', 2, GM_PROGRAMS[style.sound.melody] ?? 0), ...noteEvents(tracks.melody, 2, loops, loopSteps)]));
  }

  const hat = (e) => (kit === 'brushes' ? GM_DRUMS.ride : kit === 'shaker' ? GM_DRUMS.shaker : e.open ? GM_DRUMS.hatOpen : GM_DRUMS.hatClosed);
  const drumEvents = [
    ...noteEvents(tracks.kick, 9, loops, loopSteps, { drumNote: () => (kit === 'taiko' ? GM_DRUMS.toms[0] : GM_DRUMS.kick) }),
    ...noteEvents(tracks.snare, 9, loops, loopSteps, { drumNote: () => GM_DRUMS.snare }),
    ...noteEvents(tracks.hat, 9, loops, loopSteps, { drumNote: hat }),
    ...noteEvents(tracks.tom, 9, loops, loopSteps, { drumNote: (e) => gmTom(e.notes[0]) }),
    ...noteEvents(tracks.crash, 9, loops, loopSteps, { drumNote: () => GM_DRUMS.crash }),
  ];
  if (drumEvents.length) chunks.push(trackChunk([...header('Drums', 9, null), ...drumEvents]));

  if (tracks.pointDrums?.length) {
    const voice = (e) => (e.voice === 'tom' ? gmTom(e.notes[0]) : e.voice === 'ride' ? GM_DRUMS.ride : GM_DRUMS[e.voice] ?? GM_DRUMS.snare);
    chunks.push(trackChunk([...header('Points (drums)', 9, null), ...noteEvents(tracks.pointDrums, 9, loops, loopSteps, { drumNote: voice })]));
  }

  const file = [...text('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ), ...chunks.flat()];
  return new Uint8Array(file);
}
