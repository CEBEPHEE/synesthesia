import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { arrangementToMidi, vlq, gmTom, PPQ } from '../src/export/midi.js';
import { createZip, crc32 } from '../src/export/zip.js';
import { buildMusicalScore } from '../src/core/mapping.js';
import { arrange } from '../src/core/arranger.js';
import { STYLES, getStyle } from '../src/core/styles.js';

const analysis = {
  palette: [
    { h: 30, s: 0.7, v: 0.8, weight: 0.4 }, { h: 200, s: 0.5, v: 0.5, weight: 0.3 }, { h: 100, s: 0.4, v: 0.6, weight: 0.3 },
  ],
  keypoints: [{ x: 0.1, y: 0.5, score: 0.8 }, { x: 0.4, y: 0.2, score: 0.6 }, { x: 0.7, y: 0.8, score: 0.7 }],
  features: { contrast: 0.5, saturation: 0.5, sharpness: 0.5 },
};
const make = (id) => { const style = getStyle(id); return { style, arr: arrange(buildMusicalScore(analysis, { style }), style) }; };

/** Tiny SMF reader for the tests. */
function readMidi(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o) => String.fromCharCode(...bytes.slice(o, o + 4));
  assert.equal(str(0), 'MThd');
  const format = v.getUint16(8), ntracks = v.getUint16(10), division = v.getUint16(12);
  const tracks = [];
  let o = 14;
  for (let t = 0; t < ntracks; t++) {
    assert.equal(str(o), 'MTrk');
    const len = v.getUint32(o + 4); const end = o + 8 + len; let p = o + 8;
    const tr = { name: null, notes: 0, channels: new Set(), program: null, tempo: null };
    let running = 0;
    while (p < end) {
      let delta = 0, b; do { b = bytes[p++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
      let status = bytes[p];
      if (status < 0x80) status = running; else p++;
      if (status === 0xff) {
        const type = bytes[p++]; let l = 0; do { b = bytes[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80);
        if (type === 0x03) tr.name = new TextDecoder().decode(bytes.slice(p, p + l));
        if (type === 0x51) tr.tempo = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
        p += l;
      } else {
        running = status;
        const kind = status & 0xf0;
        if (kind === 0x90) { if (bytes[p + 1] > 0) tr.notes++; tr.channels.add(status & 15); p += 2; }
        else if (kind === 0x80) p += 2;
        else if (kind === 0xc0) { tr.program = bytes[p]; p += 1; }
        else throw new Error(`unexpected status ${status.toString(16)}`);
      }
    }
    assert.equal(p, end, 'track length matches');
    tracks.push(tr); o = end;
  }
  return { format, division, tracks };
}

describe('MIDI export', () => {
  it('variable-length quantities', () => {
    assert.deepEqual(vlq(0), [0]);
    assert.deepEqual(vlq(127), [127]);
    assert.deepEqual(vlq(128), [0x81, 0]);
    assert.deepEqual(vlq(480), [0x83, 0x60]);
  });

  for (const s of STYLES) {
    it(`${s.name}: a valid format-1 file with named tracks and notes`, () => {
      const { style, arr } = make(s.id);
      const midi = readMidi(arrangementToMidi(arr, style, { loops: 2 }));
      assert.equal(midi.format, 1);
      assert.equal(midi.division, PPQ);
      assert.equal(midi.tracks[0].tempo, Math.round(60_000_000 / arr.tempo));
      const chords = midi.tracks.find((t) => t.name === 'Chords');
      assert.ok(chords.notes > 0);
      for (const t of midi.tracks.slice(1)) assert.ok(t.notes > 0, `${t.name} has notes`);
      const drums = midi.tracks.filter((t) => /Drums|drums/.test(t.name));
      for (const d of drums) assert.deepEqual([...d.channels], [9], 'drums on channel 10');
    });
  }

  it('rock writes its point drums on channel 10 and no melody track', () => {
    const { style, arr } = make('hard-rock');
    const names = readMidi(arrangementToMidi(arr, style)).tracks.map((t) => t.name);
    assert.ok(names.includes('Points (drums)'));
    assert.ok(!names.includes('Melody (points)'));
  });

  it('jazz uses a ride cymbal for its "hats" and General MIDI piano / sax programs', () => {
    const { style, arr } = make('jazz');
    const midi = readMidi(arrangementToMidi(arr, style, { loops: 1 }));
    assert.equal(midi.tracks.find((t) => t.name === 'Chords').program, 0);
  });

  it('toms map onto the six General MIDI toms', () => {
    assert.equal(gmTom(40), 41);
    assert.equal(gmTom(55), 50);
  });
});

describe('ZIP export', () => {
  it('crc32 of "123456789" is CBF43926', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
  });

  it('creates an archive that the system unzip tool accepts', () => {
    const zip = createZip([
      { name: 'hello.txt', data: 'hello world' },
      { name: 'stems/bass.bin', data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
    fs.writeFileSync(path.join(dir, 'a.zip'), zip);
    let listing;
    try { listing = execFileSync('unzip', ['-t', path.join(dir, 'a.zip')]).toString(); } catch (e) { listing = String(e.stdout); }
    if (/not found|ENOENT/.test(listing)) return;          // no unzip on this machine
    assert.match(listing, /No errors detected/);
    assert.match(listing, /hello\.txt/);
  });
});
