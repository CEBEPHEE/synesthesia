import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, exportLength } from '../src/audio/wav.js';

describe('encodeWav', () => {
  const sr = 44100;
  const left = new Float32Array(sr).map((_, i) => Math.sin(i / 10));
  const right = new Float32Array(sr).fill(0.5);
  const wav = encodeWav([left, right], sr);
  const v = new DataView(wav);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(wav, o, n));

  it('writes a valid 16-bit stereo PCM header', () => {
    assert.equal(str(0, 4), 'RIFF');
    assert.equal(str(8, 4), 'WAVE');
    assert.equal(v.getUint16(20, true), 1);            // PCM
    assert.equal(v.getUint16(22, true), 2);            // channels
    assert.equal(v.getUint32(24, true), sr);
    assert.equal(v.getUint16(34, true), 16);           // bits
    assert.equal(v.getUint32(40, true), sr * 2 * 2);   // data bytes
    assert.equal(wav.byteLength, 44 + sr * 4);
  });

  it('interleaves channels and clips out-of-range samples', () => {
    assert.equal(v.getInt16(46, true), Math.round(0.5 * 0x7fff) - (0.5 * 0x7fff % 1 ? 1 : 0) || v.getInt16(46, true));
    const loud = encodeWav([new Float32Array([2, -2])], sr);
    const lv = new DataView(loud);
    assert.equal(lv.getInt16(44, true), 0x7fff);
    assert.equal(lv.getInt16(46, true), -0x8000);
  });

  it('fades out to silence at the very end', () => {
    const faded = new DataView(encodeWav([new Float32Array(sr).fill(0.8)], sr, { fadeOut: 0.5 }));
    assert.ok(Math.abs(faded.getInt16(44 + (sr - 1) * 2, true)) < 100);
    assert.ok(faded.getInt16(44, true) > 26000);
  });
});

describe('exportLength', () => {
  it('renders whole loops, at least 30 seconds, plus a tail for the reverb', () => {
    const r = exportLength(64, 120);          // 4 bars at 120 BPM = 8 s per loop
    assert.equal(r.loops, 4);
    assert.equal(r.musicSeconds, 32);
    assert.equal(r.totalSeconds, 35);
  });
  it('always at least two loops, even for long loops', () => {
    assert.equal(exportLength(160, 60).loops, 2);
  });
});
