/**
 * Export menu: full mix (WAV), MIDI, or stems + MIDI (ZIP).
 * Everything is rendered and packed in the browser; nothing is uploaded.
 */
import { SAMPLE_CREDITS } from '../audio/sample-library.js';

export function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export function creditsText() {
  return [
    'Music made with Synesthesia (photo → music, runs in the browser).',
    '',
    'Instrument recordings (Creative Commons Attribution 3.0, CC BY 3.0):',
    ...SAMPLE_CREDITS.map((c) => `  - ${c}`),
    'Audio engine: Tone.js (MIT).',
    '',
    'If you publish this music, please keep a credit line such as:',
    '  "Music: Synesthesia · instruments: VSCO 2 (Versilian Studios), Karoryfer Samples,',
    '   University of Iowa MIS, OLPC Berklee Sound Library — CC BY 3.0"',
  ].join('\n');
}

/**
 * @param {{root: HTMLDetailsElement, getJob: () => object|null, setStatus: Function, withPausedPlayback: Function}} deps
 *   getJob() → { arrangement, style, score, tempo, reverb } for the current music
 */
export function initExportMenu({ root, getJob, setStatus, withPausedPlayback }) {
  const summary = root.querySelector('summary');
  let busy = false;

  root.addEventListener('toggle', () => {
    if (root.open && (busy || !getJob())) root.open = false;
  });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) root.open = false; });

  const baseName = (job) =>
    `synesthesia-${job.style.id}-${job.score.key.name.replace(/[^\w#]+/g, '-')}-${job.tempo}bpm`.toLowerCase();

  async function run(kind) {
    const job = getJob();
    if (!job || busy) return;
    busy = true;
    root.open = false;
    summary.classList.add('busy');
    try {
      if (kind === 'photo' || kind === 'card') {
        const { photoBlob, musicCardBlob } = await import('./photo-save.js');
        const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const blob = kind === 'photo' ? await photoBlob(job.image) : await musicCardBlob(job);
        const file = kind === 'photo' ? `synesthesia-photo-${stamp}.jpg` : `${baseName(job)}-card.png`;
        download(blob, file);
        setStatus(`Saved ${file} (${(blob.size / 1048576).toFixed(1)} MB)`);
        return;
      }
      await withPausedPlayback(async () => {
        const { exportLength } = await import('../audio/wav.js');
        const len = exportLength(job.arrangement.loopSteps, job.tempo);
        const name = baseName(job);

        if (kind === 'midi') {
          const { arrangementToMidi } = await import('../export/midi.js');
          const mid = arrangementToMidi(job.arrangement, job.style, { loops: len.loops, tempo: job.tempo, title: `${job.style.name} in ${job.score.key.name}` });
          download(new Blob([mid], { type: 'audio/midi' }), `${name}.mid`);
          setStatus(`Saved ${name}.mid — open it in any music app (Ableton, FL Studio, GarageBand, MuseScore…).`);
          return;
        }

        const { renderToWav, renderStems } = await import('../audio/exporter.js');
        if (kind === 'wav') {
          setStatus(`Rendering ${Math.round(len.totalSeconds)} seconds of audio…`);
          const { blob } = await renderToWav(job);
          download(blob, `${name}.wav`);
          setStatus(`Saved ${name}.wav (${(blob.size / 1048576).toFixed(1)} MB)`);
          return;
        }

        // stems + MIDI in one ZIP
        const stems = await renderStems(job, (i, n, group) => setStatus(`Rendering stems… ${group} (${i + 1} of ${n})`));
        const [{ arrangementToMidi }, { createZip }] = await Promise.all([import('../export/midi.js'), import('../export/zip.js')]);
        const files = stems.map(({ group, wav }) => ({ name: `${name}/${group === 'melody' ? 'points' : group}.wav`, data: wav }));
        files.push({ name: `${name}/${name}.mid`, data: arrangementToMidi(job.arrangement, job.style, { loops: len.loops, tempo: job.tempo }) });
        files.push({ name: `${name}/README.txt`, data: [
          `${job.style.name} in ${job.score.key.name}, ${job.tempo} BPM, 4/4.`,
          'Each WAV is one instrument group with the same length and start, so they line up when dropped into a DAW at bar 1.',
          'mix.wav is the full mix. points.wav is what the photo\'s points play (melody or drums).',
          '',
          creditsText(),
        ].join('\n') });
        const zip = createZip(files);
        download(new Blob([zip], { type: 'application/zip' }), `${name}-stems.zip`);
        setStatus(`Saved ${name}-stems.zip (${(zip.length / 1048576).toFixed(1)} MB): ${stems.length - 1} stems, the mix and a MIDI file.`);
      });
    } catch (err) {
      console.error(err);
      setStatus(`Export failed: ${err.message}`, true);
    } finally {
      busy = false;
      summary.classList.remove('busy');
    }
  }

  root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => run(b.dataset.export)));
  return { setEnabled: (on) => summary.classList.toggle('disabled', !on) };
}
