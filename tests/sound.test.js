/**
 * Sound wiring: every style must point at instruments, kits and recordings
 * that actually exist, and every melody must stay inside the range covered by
 * its instrument's recordings (so no note is stretched to an unnatural pitch).
 * These modules import no Tone.js, so they run in Node.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STYLES } from '../src/core/styles.js';
import { INSTRUMENT_SAMPLES, DRUM_SAMPLES, SAMPLE_CREDITS } from '../src/audio/sample-library.js';
import { MIX, mixFor } from '../src/audio/mix.js';

const root = new URL('../', import.meta.url);
const src = fs.readFileSync(new URL('src/audio/instruments.js', root), 'utf8');
const section = (name) => src.slice(src.indexOf(`export const ${name}`), src.indexOf('};', src.indexOf(`export const ${name}`)));
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const toMidi = (n) => { const m = n.match(/^([A-G]#?)(\d)$/); return 12 * (+m[2] + 1) + NOTE[m[1]]; };
const keysOf = (name) => new Set([...section(name).matchAll(/^\s{2}'?([\w]+)'?:/gm)].map((m) => m[1]));

describe('sample library', () => {
  it('every recording listed in the library is inside its pack, and every pack file exists', async () => {
    const { SAMPLE_PACKS } = await import('../src/audio/sample-packs.js');
    const check = (key, file) => {
      const pack = SAMPLE_PACKS[key];
      assert.ok(pack, `pack ${key}`);
      const e = pack.entries[file];
      assert.ok(e, `${key}/${file}`);
      assert.ok(e[0] + e[1] <= pack.bytes);
    };
    for (const [id, inst] of Object.entries(INSTRUMENT_SAMPLES)) for (const file of Object.values(inst.notes)) check(id, file);
    for (const [kit, d] of Object.entries(DRUM_SAMPLES)) for (const file of Object.values(d.files)) check(`drums/${kit}`, file);
    for (const pack of Object.values(SAMPLE_PACKS)) {
      const url = new URL(`assets/samples/${pack.file}`, root);
      assert.ok(fs.existsSync(url), pack.file);
      assert.equal(fs.statSync(url).size, pack.bytes, pack.file);
    }
  });

  it('every style keeps its melody within 4 semitones of a real recording', () => {
    const SAMPLE_OF = { piano: 'piano', saxophone: 'saxophone', flute: 'flute', violin: 'violin', horn: 'french-horn',
      harp: 'harp', xylophone: 'xylophone', nylonGuitar: 'nylon-guitar', guitarLead: 'electric-guitar', glideGuitar: 'electric-guitar', acousticGuitar: 'acoustic-guitar' };
    for (const s of STYLES) {
      const id = SAMPLE_OF[s.sound.melody];
      if (!id) continue;                                   // synthesised lead
      const midi = Object.keys(INSTRUMENT_SAMPLES[id].notes).map(toMidi);
      for (let m = 64 + s.melody.octave; m <= 88 + s.melody.octave; m++) {
        const nearest = Math.min(...midi.map((x) => Math.abs(x - m)));
        assert.ok(nearest <= 4, `${s.id}: melody note ${m} is ${nearest} semitones from the nearest ${id} recording`);
      }
    }
  });

  it('credits every source (CC BY 3.0 requires attribution)', () => {
    assert.ok(SAMPLE_CREDITS.length >= 5);
    assert.ok(SAMPLE_CREDITS.some((c) => /CC BY 3\.0/.test(c)));
  });
});

describe('styles → sound', () => {
  const chords = keysOf('CHORD_INSTRUMENTS'), melody = keysOf('MELODY_INSTRUMENTS');
  const bass = keysOf('BASS_INSTRUMENTS'), kits = keysOf('KIT_SETTINGS');

  for (const s of STYLES) {
    it(`${s.name} uses instruments that exist`, () => {
      assert.ok(chords.has(s.sound.chords), `chords: ${s.sound.chords}`);
      assert.ok(melody.has(s.sound.melody), `melody: ${s.sound.melody}`);
      if (s.sound.bass) assert.ok(bass.has(s.sound.bass), `bass: ${s.sound.bass}`);
      if (s.sound.kit) assert.ok(kits.has(s.sound.kit), `kit: ${s.sound.kit}`);
    });
  }

  it('every style has a calibrated mix', () => {
    for (const s of STYLES) {
      assert.ok(MIX[s.id], s.id);
      const m = mixFor(s.id);
      for (const v of Object.values(m)) assert.ok(Number.isFinite(v) && Math.abs(v) <= 30, `${s.id}: ${v}`);
    }
  });

  it('the app has no CDN dependency: Tone.js is bundled', () => {
    assert.ok(fs.existsSync(new URL('vendor/Tone.js', root)));
    const html = fs.readFileSync(new URL('index.html', root), 'utf8');
    assert.ok(!/cdn\.|jsdelivr|unpkg/.test(html));
    assert.match(html, /script-src 'self';/);
  });
});
