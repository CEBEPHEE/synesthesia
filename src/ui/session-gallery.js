/**
 * "This session": every video recorded and photo taken with the camera is kept
 * here until the tab is closed, so switching to the demo or another photo never
 * loses it. Kept only in this tab's memory: nothing is uploaded or stored on disk.
 * Closing the tab with something unsaved asks for confirmation first.
 */
import { download } from './export-menu.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const stamp = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * @param {{root: HTMLElement, onUsePhoto: (ImageBitmap) => void, onUseVideo: (File) => void}} deps
 */
export function initGallery({ root, onUsePhoto, onUseVideo }) {
  const items = [];
  let seq = 0;
  const list = root.querySelector('.gallery-items');
  const player = root.querySelector('dialog');
  const playerVideo = player.querySelector('video');

  window.addEventListener('beforeunload', (e) => {
    if (items.some((it) => !it.saved)) { e.preventDefault(); e.returnValue = ''; }
  });

  function fileName(it) {
    const d = it.created, p2 = (n) => String(n).padStart(2, '0');
    const t = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    return it.kind === 'video' ? `synesthesia-camera-${t}.${it.ext}` : `synesthesia-photo-${t}.jpg`;
  }

  function render() {
    root.hidden = items.length === 0;
    list.innerHTML = items.map((it) => `
      <div class="gitem" data-id="${it.id}">
        <img src="${it.thumbUrl}" alt="">
        <div class="ginfo">
          <b>${it.kind === 'video' ? `🎥 Video ${fmt(it.seconds)}` : '📸 Photo'}</b>
          <span class="muted small">${stamp(it.created)}${it.kind === 'video' ? (it.withMusic ? ' · with music' : ' · no sound') : ''}${it.saved ? ' · saved ✓' : ''}</span>
        </div>
        <div class="gactions">
          ${it.kind === 'video' ? '<button data-act="watch" title="Watch it">▶</button>' : ''}
          <button data-act="save">${it.kind === 'video' ? '⬇ Save video' : '⬇ Save photo'}</button>
          <button data-act="use">${it.kind === 'video' ? '🎬 New soundtrack' : '♪ Make music'}</button>
          <button data-act="remove" title="Remove from this list">✕</button>
        </div>
      </div>`).join('');
  }

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const it = items.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
    if (!it) return;
    if (b.dataset.act === 'watch') {
      playerVideo.src = it.url;
      player.showModal();
      playerVideo.play().catch(() => {});
    } else if (b.dataset.act === 'save') {
      download(it.blob, fileName(it));
      it.saved = true;
      render();
    } else if (b.dataset.act === 'use') {
      if (it.kind === 'photo') onUsePhoto(await createImageBitmap(it.blob));
      else onUseVideo(new File([it.blob], fileName(it), { type: it.blob.type }), { ...it.settings, fromCamera: true });
    } else if (b.dataset.act === 'remove') {
      if (!it.saved && !confirmRemove(it)) return;
      items.splice(items.indexOf(it), 1);
      URL.revokeObjectURL(it.url); URL.revokeObjectURL(it.thumbUrl);
      render();
    }
  });
  const confirmRemove = (it) => window.confirm(`This ${it.kind} is not saved yet. Remove it anyway?`);
  player.addEventListener('close', () => { playerVideo.pause(); playerVideo.removeAttribute('src'); playerVideo.load(); });
  player.addEventListener('click', (e) => { if (e.target === player) player.close(); });

  /**
   * @param {{kind: 'video'|'photo', blob: Blob, thumb: Blob, seconds?, withMusic?, ext?}} entry
   * @returns {object} the stored item (its `saved` flag can be set by the caller)
   */
  function add(entry) {
    const it = { ...entry, id: ++seq, created: new Date(), saved: false, url: URL.createObjectURL(entry.blob), thumbUrl: URL.createObjectURL(entry.thumb) };
    items.unshift(it);
    render();
    return it;
  }

  /** Mark an item as saved (e.g. when it was downloaded from the camera panel). */
  function markSaved(it) { it.saved = true; render(); }

  return { add, markSaved, fileName, get items() { return items; } };
}

/** A small JPEG of a picture source, for the list. */
export async function thumbnail(source, width = 160) {
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  const h = Math.max(1, Math.round((width * sh) / sw));
  const c = new OffscreenCanvas(width, h);
  c.getContext('2d').drawImage(source, 0, 0, width, h);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

