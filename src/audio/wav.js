/**
 * WAV encoder (16-bit PCM). Pure function: no Web Audio needed, so it is unit-tested in Node.
 * @param {Float32Array[]} channels  one Float32Array per channel, same length
 * @param {number} sampleRate
 * @param {{fadeOut?: number, info?: Record<string, string>}} options
 *   fadeOut: seconds of linear fade at the end (avoids a click)
 *   info: text tags written into a LIST/INFO chunk, e.g. { ICMT: 'comment', ISFT: 'software' }
 * @returns {ArrayBuffer}
 */
export function encodeWav(channels, sampleRate, { fadeOut = 0, info = null } = {}) {
  const numCh = channels.length;
  const n = channels[0].length;
  const bytesPerSample = 2;
  const dataSize = n * numCh * bytesPerSample;
  // optional LIST/INFO chunk (who made it), after the audio
  const tags = Object.entries(info ?? {}).map(([id, text]) => {
    const bytes = [...new TextEncoder().encode(text), 0];
    if (bytes.length % 2) bytes.push(0);
    return { id, bytes };
  });
  const listSize = tags.length ? 4 + tags.reduce((s, t) => s + 8 + t.bytes.length, 0) : 0;
  const buf = new ArrayBuffer(44 + dataSize + (listSize ? 8 + listSize : 0));
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize + (listSize ? 8 + listSize : 0), true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  const fadeStart = n - Math.round(fadeOut * sampleRate);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const g = i >= fadeStart ? (n - i) / (n - fadeStart) : 1;
    for (let c = 0; c < numCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i] * g));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  if (listSize) {
    str(o, 'LIST'); v.setUint32(o + 4, listSize, true); str(o + 8, 'INFO'); o += 12;
    for (const t of tags) {
      str(o, t.id); v.setUint32(o + 4, t.bytes.length, true); o += 8;
      t.bytes.forEach((b, i) => v.setUint8(o + i, b)); o += t.bytes.length;
    }
  }
  return buf;
}

/** How long to render so a download is a pleasant length: whole loops, at least `minSeconds`. */
export function exportLength(loopSteps, tempo, { minSeconds = 30, tail = 3 } = {}) {
  const loopSeconds = (loopSteps * 60) / tempo / 4;
  const loops = Math.max(2, Math.ceil(minSeconds / loopSeconds));
  return { loops, musicSeconds: loops * loopSeconds, totalSeconds: loops * loopSeconds + tail };
}
