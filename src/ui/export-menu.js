/**
 * Export menu: full mix (WAV), MIDI, or stems + MIDI (ZIP).
 * Everything is rendered and packed in the browser; nothing is uploaded.
 */
import { SAMPLE_CREDITS } from '../audio/sample-library.js';
import { APP_CREDIT, APP_URL, AUTHOR, CONTACT, LICENSE_NAME } from '../credit.js';

export function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export function creditsText() {
  return [
    `${APP_CREDIT} — ${APP_URL}`,
    `Synesthesia app by ${AUTHOR}: free for noncommercial use (${LICENSE_NAME}); commercial licence: ${CONTACT}.`,
    '',
    'Instrument recordings (Creative Commons Attribution 3.0, CC BY 3.0):',
    ...SAMPLE_CREDITS.map((c) => `  - ${c}`),
    'Audio engine: Tone.js (MIT).',
    '',
    'If you publish this music, please keep a credit line such as:',
    `  "Music: Synesthesia by ${AUTHOR} · instruments: VSCO 2 (Versilian Studios), Karoryfer Samples,`,
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
      if (kind === 'video') {
        await withPausedPlayback(() => photoVideo(job, baseName(job)));
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

  /** One photo + its music → a short MP4 (slow push-in, points lighting up on their notes). */
  async function photoVideo(job, name) {
    const [{ loopArrangement, stepsToSeconds }, { renderSoundtrack }, { exportMp4 }, { drawFilmFrame, pointHits }, { outputSize }] = await Promise.all([
      import('../core/timeline.js'), import('../audio/exporter.js'), import('../video/export-mp4.js'),
      import('../video/film-renderer.js'), import('../video/scenes.js'),
    ]);
    const loopSec = stepsToSeconds(job.arrangement.loopSteps, job.tempo);
    const loops = Math.max(2, Math.min(8, Math.round(20 / loopSec)));
    const arrangement = loopArrangement(job.arrangement, loops);
    const musicSec = loops * loopSec, length = musicSec + 2;
    const timeline = { tempo: job.tempo, totalSeconds: musicSec, sections: [{ startSec: 0, seconds: length, startStep: 0, steps: arrangement.loopSteps }] };
    const film = { kind: 'slides', items: [{ image: job.image, analysis: job.analysis }], timeline, hits: pointHits(timeline, arrangement) };
    setStatus(`Composing ${Math.round(length)} seconds of music…`);
    const audio = await renderSoundtrack({ arrangement, style: job.style, tempo: job.tempo, reverb: job.reverb, length });
    const { width, height } = outputSize('original', 720, job.image.width, job.image.height);
    setStatus('Making the video… 0%');
    const { blob, extension } = await exportMp4({
      width, height, fps: 30, duration: length, audio,
      drawFrame: (c, t) => drawFilmFrame(c, film, t, { fit: 'fit', overlay: job.pointsAs !== 'off' }),
      onProgress: (f) => setStatus(`Making the video… ${Math.round(f * 100)}%`),
    });
    download(blob, `${name}.${extension}`);
    setStatus(`Saved ${name}.${extension} (${(blob.size / 1048576).toFixed(1)} MB, ${Math.round(length)} s): the photo with its music. ${APP_CREDIT}.`);
  }

  root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => run(b.dataset.export)));
  return { setEnabled: (on) => summary.classList.toggle('disabled', !on) };
}
