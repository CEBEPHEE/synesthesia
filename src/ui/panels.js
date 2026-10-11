/**
 * Side panels: "Why it sounds like this", "The numbers", chord strip,
 * voice-leading graph and the style library. All text is escaped before it
 * is inserted; only the **bold** / *italic* markers are turned into tags.
 */
import { midiToName, INTERVAL_NAMES } from '../core/music-theory.js';
import { colorName } from '../core/explain.js';

const rgb = (c) => `rgb(${c.r},${c.g},${c.b})`;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** Minimal markup: **bold** and *italic*, applied after escaping. */
export function rich(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}

function fingerprint(features) {
  return `<div class="fingerprint">${features.map((f) => `
    <div class="fp-row${f.supporting ? ' supporting' : ''}" title="${escapeHtml(`${f.label}: ${f.value.toFixed(2)} (${f.low} → ${f.high})`)}">
      <span class="fp-label">${escapeHtml(f.label)}</span>
      <span class="fp-track">
        <span class="fp-fill" style="width:${(f.value * 100).toFixed(1)}%"></span>
        ${f.target !== undefined ? `<span class="fp-target" style="left:${(f.target * 100).toFixed(1)}%"></span>` : ''}
      </span>
      <span class="fp-value">${f.value.toFixed(2)}</span>
    </div>`).join('')}
    <p class="muted small fp-legend"><span class="fp-swatch"></span> your photo &nbsp; <span class="fp-tick"></span> what the style looks for &nbsp; <b>bold</b> = the traits that decided it</p>
  </div>`;
}

export function renderWhyPanel(el, explanation) {
  el.innerHTML = `
    <p class="headline">${escapeHtml(explanation.headline)}</p>
    ${explanation.sections.map((s, i) => `
      <details class="why" ${i < 2 ? 'open' : ''}>
        <summary>${escapeHtml(s.title)}</summary>
        ${s.features ? fingerprint(s.features) : ''}
        ${s.body.map((p) => `<p>${rich(p)}</p>`).join('')}
        ${s.items ? `<ul class="why-items">${s.items.map((it) => `
          <li>${it.color ? `<span class="swatch" style="background:${rgb(it.color)}"></span>` : ''}
            <b>${escapeHtml(it.chord)}</b> — ${rich(it.text)}</li>`).join('')}</ul>` : ''}
      </details>`).join('')}`;
}

export function renderNumbersPanel(el, analysis, score) {
  const paletteRows = analysis.palette.map((c) => {
    const ch = score.chords.find((x) => x.color === c);
    return `<tr>
      <td><span class="swatch" style="background:${rgb(c)}"></span></td>
      <td>${escapeHtml(colorName(c))}</td>
      <td>${Math.round(c.h)}°</td><td>${c.s.toFixed(2)}</td><td>${c.v.toFixed(2)}</td>
      <td>${Math.round(c.weight * 100)}%</td>
      <td>${ch ? `<b>${escapeHtml(ch.roman)}</b> · ${escapeHtml(ch.symbol)}` : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');

  const edgeRows = score.edges.map((e) => `<tr>
      <td>${e.from + 1} → ${e.to + 1}</td><td>${e.distance ? e.distance.toFixed(3) : 'motif'}</td>
      <td>${INTERVAL_NAMES[e.interval]} (${e.interval} st)</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">Fewer than two points</td></tr>';

  const f = analysis.features;
  el.innerHTML = `
    <dl class="facts">
      <div><dt>Key</dt><dd>${escapeHtml(score.key.name)}</dd></div>
      <div><dt>Tempo</dt><dd>${score.tempo} BPM</dd></div>
      <div><dt>Point spread</dt><dd>${score.spread.toFixed(2)}</dd></div>
      <div><dt>Loop length</dt><dd>${Math.max(2, score.totalBars)} bars</dd></div>
    </dl>
    <h3>Colour → harmony</h3>
    <table><thead><tr><th></th><th>Colour</th><th>H</th><th>S</th><th>V</th><th>Share</th><th>Chord</th></tr></thead>
      <tbody>${paletteRows}</tbody></table>
    <h3>Distance → interval</h3>
    <table><thead><tr><th>Points</th><th>Visual distance</th><th>Interval</th></tr></thead>
      <tbody>${edgeRows}</tbody></table>
    <h3>Photo fingerprint (raw)</h3>
    <table><tbody>
      <tr><td>Mean luminance</td><td>${f.raw.meanLuma.toFixed(1)} / 255</td></tr>
      <tr><td>Luminance std. dev.</td><td>${f.raw.stdLuma.toFixed(1)}</td></tr>
      <tr><td>Mean saturation</td><td>${f.raw.meanSaturation.toFixed(3)}</td></tr>
      <tr><td>Colourfulness (Hasler–Süsstrunk)</td><td>${f.raw.hasler.toFixed(1)}</td></tr>
      <tr><td>Red − blue</td><td>${f.raw.redMinusBlue.toFixed(1)}</td></tr>
      <tr><td>Edge density</td><td>${(f.raw.edgeDensity * 100).toFixed(1)}%</td></tr>
      <tr><td>Fine texture</td><td>${f.raw.meanTexture.toFixed(2)}</td></tr>
      <tr><td>Hue spread</td><td>${f.raw.hueSpread.toFixed(3)}</td></tr>
    </tbody></table>
    <p class="muted small">Analysed at ${analysis.width}×${analysis.height} px in ${analysis.ms.toFixed(1)} ms in a Web Worker.</p>`;
}

export function renderChordStrip(el, score) {
  el.innerHTML = score.chords.map((ch, i) => `
    <div class="chord" data-index="${i}" style="--chord-color:${rgb(ch.color)}; flex-grow:${ch.bars}">
      <div class="roman">${escapeHtml(ch.roman)}</div>
      <div class="symbol">${escapeHtml(ch.symbol)}</div>
      <div class="notes">${ch.voicing.map(midiToName).join(' ')}</div>
    </div>`).join('');
}

export function setActiveChord(stripEl, graphEl, index) {
  stripEl.querySelectorAll('.chord').forEach((n) => n.classList.toggle('active', Number(n.dataset.index) === index));
  graphEl.querySelectorAll('[data-col]').forEach((n) => n.classList.toggle('active', Number(n.dataset.col) === index));
}

/** Voice-leading graph: each line is one voice, chords run left to right. */
export function renderVoiceGraph(svg, score) {
  const chords = score.chords;
  const W = 600, H = 160, pad = 22;
  const all = chords.flatMap((c) => c.voicing);
  const lo = Math.min(...all) - 2, hi = Math.max(...all) + 2;
  const cols = chords.length + 1;                       // +1: back to the first chord (loop)
  const X = (i) => pad + (i * (W - 2 * pad)) / (cols - 1);
  const Y = (m) => H - pad - ((m - lo) * (H - 2 * pad)) / (hi - lo);
  const seq = [...chords, chords[0]];
  const voices = Math.max(...chords.map((c) => c.voicing.length));

  let paths = '';
  for (let v = 0; v < voices; v++) {
    const d = seq.map((c, i) => {
      const m = c.voicing[Math.min(v, c.voicing.length - 1)];
      return `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(m).toFixed(1)}`;
    }).join(' ');
    paths += `<path d="${d}" class="voice"/>`;
  }
  const columns = chords.map((c, i) => `
    <g data-col="${i}" class="col">
      <rect x="${X(i) - 14}" y="6" width="28" height="${H - 12}" rx="6"/>
      ${c.voicing.map((m) => `<circle cx="${X(i)}" cy="${Y(m)}" r="3.5"><title>${midiToName(m)}</title></circle>`).join('')}
      <text x="${X(i)}" y="${H - 4}">${escapeHtml(c.roman)}</text>
    </g>`).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = columns + paths +
    `<text x="${X(cols - 1)}" y="${H - 4}">↺ ${escapeHtml(chords[0].roman)}</text>`;
}

export function renderStyleLibrary(el, styles, ranking = null) {
  const scoreOf = (id) => ranking?.find((m) => m.style.id === id)?.score;
  el.innerHTML = `<div class="library">${styles.map((s) => {
    const sc = scoreOf(s.id);
    return `<div class="lib-item">
      <div class="lib-head"><b>${escapeHtml(s.name)}</b>
        <span class="muted small">${s.tempo[0]}–${s.tempo[1]} BPM${sc !== undefined ? ` · ${Math.round(sc * 100)}% match for your photo` : ''}</span></div>
      <div>${escapeHtml(s.blurb)}</div>
      <div class="muted small">Chosen for ${escapeHtml(s.whyText)}.</div>
    </div>`;
  }).join('')}</div>`;
}

export function fillStyleSelect(select, styles) {
  for (const s of styles) select.add(new Option(s.name, s.id));
}

/**
 * Style menu ordered by how well each style fits the photo, with the match in %.
 * "Auto" stays first; the current choice is kept.
 */
export function renderStyleOptions(select, ranking) {
  const current = select.value;
  const best = ranking[0];
  const opts = [new Option(`Auto · ${best.style.name} (${Math.round(best.score * 100)}%)`, 'auto')];
  for (const m of ranking) opts.push(new Option(`${m.style.name} — ${Math.round(m.score * 100)}%`, m.style.id));
  select.replaceChildren(...opts);
  select.value = current;
}
