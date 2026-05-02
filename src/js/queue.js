// ── VECTO / queue.js ──────────────────────────────────────────────────────────
// Playlist management, drag-to-reorder, multi-select, resume bar,
// fullscreen queue overlay, and M3U parsing.
//
// CIRCULAR DEPENDENCY AVOIDANCE
// player.js needs renderPlaylist / renderFsQueue from here.
// queue.js needs playIndex / destroyEngines / resetPlayerUI from player.js.
// Neither module imports the other. Instead, main.js calls
// setPlayerCallbacks({ playIndex, destroyEngines, resetPlayerUI })
// after both modules are loaded, injecting the player functions in.
//
// Exports: setPlayerCallbacks, renderPlaylist, renderFsQueue,
//          addItems, revokeItemSubs, removeFromQueue,
//          showResumeBar, hideResumeBar,
//          toggleFsQueue, hideFsQueue,
//          parseM3U, initQueue

import { state, fmt, escHtml, hashKey } from './state.js';
import { notif }                         from './ui.js';
import { clearSaved }                    from './settings.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video         = document.getElementById('video');
const emptyState    = document.getElementById('empty-state');
const queueCount    = document.getElementById('queue-count');
const playlistInner = document.getElementById('playlist-inner');
const fsQueue       = document.getElementById('fs-queue');
const fsQInner      = document.getElementById('fs-q-inner');
const fsQBtn        = document.getElementById('fs-q-btn');
const fsQClose      = document.getElementById('fs-q-close');
const resumeBar     = document.getElementById('resume-bar');
const resumeMsg     = document.getElementById('resume-msg');
const resumeYes     = document.getElementById('resume-yes');
const resumeNo      = document.getElementById('resume-no');

// ── Injected player callbacks ─────────────────────────────────────────────────
// Populated by main.js once both modules are loaded.
let _playIndex     = () => {};
let _destroyEngines = () => {};
let _resetPlayerUI  = () => {};

export function setPlayerCallbacks({ playIndex, destroyEngines, resetPlayerUI }) {
  _playIndex      = playIndex;
  _destroyEngines = destroyEngines;
  _resetPlayerUI  = resetPlayerUI;
}

// ── Resume bar ────────────────────────────────────────────────────────────────
let _resumeTimer = null;

export function showResumeBar(saved, item) {
  hideResumeBar();
  let cd = 8;
  resumeMsg.textContent  = `Resume from ${fmt(saved.p)}?`;
  resumeYes.textContent  = `Resume (${cd}s)`;
  resumeBar.classList.add('show');

  _resumeTimer = setInterval(() => {
    cd--;
    resumeYes.textContent = `Resume (${cd}s)`;
    if (cd <= 0) { clearInterval(_resumeTimer); _doResume(saved); }
  }, 1000);

  resumeYes.onclick = () => { clearInterval(_resumeTimer); _doResume(saved); };
  resumeNo.onclick  = () => { clearInterval(_resumeTimer); clearSaved(item); hideResumeBar(); };
}

function _doResume(saved) {
  video.currentTime = saved.p;
  hideResumeBar();
}

export function hideResumeBar() {
  clearInterval(_resumeTimer);
  resumeBar.classList.remove('show');
}

// ── Memory cleanup helper ─────────────────────────────────────────────────────

/**
 * Revoke all subtitle blob URLs stored on a playlist item.
 * Also exported so player.js can call it during clearQueue.
 */
export function revokeItemSubs(item) {
  (item.subtitles || []).forEach(sub => {
    try { URL.revokeObjectURL(sub.src); } catch (e) {}
  });
}

function revokeItemBlobs(item) {
  revokeItemSubs(item);
  if (item.url?.startsWith('blob:'))          URL.revokeObjectURL(item.url);
  if (item.audioMeta?.art?.startsWith('blob:')) URL.revokeObjectURL(item.audioMeta.art);
}

// ── Empty state helper ────────────────────────────────────────────────────────
function showEmptyState() {
  emptyState.style.opacity      = '1';
  emptyState.style.pointerEvents = '';
}

function hideEmptyState() {
  emptyState.style.opacity      = '0';
  emptyState.style.pointerEvents = 'none';
}

// ── Drag-to-reorder ───────────────────────────────────────────────────────────
function handleDragStart(e) {
  state.dragSrcIdx = parseInt(e.currentTarget.dataset.idx);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', state.dragSrcIdx);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const el   = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.classList.remove('drag-over-top', 'drag-over-bot');
  el.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bot');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-top', 'drag-over-bot');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const destEl = e.currentTarget;
  let destIdx  = parseInt(destEl.dataset.idx);
  const rect   = destEl.getBoundingClientRect();
  if (e.clientY >= rect.top + rect.height / 2) destIdx++;
  destEl.classList.remove('drag-over-top', 'drag-over-bot');

  const src = state.dragSrcIdx;
  if (src === null || src === destIdx || destIdx === src + 1) {
    state.dragSrcIdx = null;
    renderPlaylist();
    return;
  }

  const item     = state.playlist.splice(src, 1)[0];
  const insertAt = destIdx > src ? destIdx - 1 : destIdx;
  state.playlist.splice(insertAt, 0, item);

  if      (state.currentIdx === src)                              state.currentIdx = insertAt;
  else if (src < state.currentIdx && insertAt >= state.currentIdx) state.currentIdx--;
  else if (src > state.currentIdx && insertAt <= state.currentIdx) state.currentIdx++;

  const newSel = new Set();
  state.selectedIndices.forEach(si => {
    if (si === src) { newSel.add(insertAt); return; }
    let ni = si;
    if      (si > src && si <= insertAt) ni--;
    else if (si < src && si >= insertAt) ni++;
    newSel.add(ni);
  });
  state.selectedIndices = newSel;
  state.dragSrcIdx = null;
  renderPlaylist();
}

function handleDragEnd() {
  state.dragSrcIdx = null;
  document.querySelectorAll('.pl-item.drag-over-top, .pl-item.drag-over-bot, .pl-item.dragging')
    .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bot', 'dragging'));
}

// ── Playlist item builder ─────────────────────────────────────────────────────
function buildPlItem(item, i, container) {
  const el        = document.createElement('div');
  const isActive  = i === state.currentIdx;
  const isSel     = state.selectedIndices.has(i);
  el.className    = 'pl-item' + (isActive ? ' active' : '') + (isSel ? ' selected' : '');
  el.title        = item.title;
  el.dataset.idx  = i;
  el.draggable    = true;
  const arrow     = isActive && !video.paused ? '▶ ' : '';

  el.innerHTML = `
    <div class="pl-row">
      <span class="pl-drag-handle" title="Drag to reorder">⠿</span>
      <div class="pl-title">${arrow}${escHtml(item.title)}</div>
      <button class="pl-remove" title="Remove from queue">✕</button>
    </div>
    ${item.dur > 0 ? `<div class="pl-dur" style="padding-left:18px">${fmt(item.dur)}</div>` : ''}
  `;

  const removeBtn = el.querySelector('.pl-remove');
  removeBtn.addEventListener('click', e => { e.stopPropagation(); removeFromQueue(i); });

  el.addEventListener('mouseenter', () => removeBtn.style.opacity = '1');
  el.addEventListener('mouseleave', () => removeBtn.style.opacity = '0');

  el.addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      state.selectedIndices[state.selectedIndices.has(i) ? 'delete' : 'add'](i);
      renderPlaylist();
      return;
    }
    state.selectedIndices.clear();
    _playIndex(i);
  });

  el.addEventListener('dragstart', handleDragStart);
  el.addEventListener('dragover',  handleDragOver);
  el.addEventListener('dragleave', handleDragLeave);
  el.addEventListener('drop',      handleDrop);
  el.addEventListener('dragend',   handleDragEnd);

  container.appendChild(el);
}

// ── Render: sidebar queue ─────────────────────────────────────────────────────
export function renderPlaylist() {
  queueCount.textContent = state.playlist.length > 0 ? `(${state.playlist.length})` : '';
  playlistInner.innerHTML = '';

  if (state.playlist.length === 0) {
    playlistInner.innerHTML = '<p class="pl-empty">No items in queue</p>';
    renderFsQueue();
    return;
  }

  if (state.selectedIndices.size > 0) {
    const bar = document.createElement('div');
    bar.className = 'pl-bulk-bar';
    bar.innerHTML = `
      <span class="pl-bulk-count">${state.selectedIndices.size} SELECTED</span>
      <div style="display:flex;gap:6px">
        <button class="pl-bulk-remove">REMOVE</button>
        <button class="pl-bulk-clear">✕</button>
      </div>`;
    bar.querySelector('.pl-bulk-remove').addEventListener('click', removeSelected);
    bar.querySelector('.pl-bulk-clear').addEventListener('click', () => {
      state.selectedIndices.clear();
      renderPlaylist();
    });
    playlistInner.appendChild(bar);
  }

  state.playlist.forEach((item, i) => buildPlItem(item, i, playlistInner));
  renderFsQueue();
}

// ── Render: fullscreen queue overlay ─────────────────────────────────────────
export function renderFsQueue() {
  fsQInner.innerHTML = '';

  if (state.playlist.length === 0) {
    fsQInner.innerHTML = '<p class="pl-empty">No items in queue</p>';
    return;
  }

  state.playlist.forEach((item, i) => {
    const el       = document.createElement('div');
    el.className   = 'pl-item' + (i === state.currentIdx ? ' active' : '');
    el.title       = item.title;
    const arrow    = i === state.currentIdx && !video.paused ? '▶ ' : '';
    el.innerHTML   = `
      <div class="pl-row"><div class="pl-title">${arrow}${escHtml(item.title)}</div></div>
      ${item.dur > 0 ? `<div class="pl-dur">${fmt(item.dur)}</div>` : ''}`;
    el.addEventListener('click', () => _playIndex(i));
    fsQInner.appendChild(el);
  });
}

// ── Fullscreen queue toggle ───────────────────────────────────────────────────
export function toggleFsQueue() {
  state.fsQueueVisible = !state.fsQueueVisible;
  fsQueue.classList.toggle('visible', state.fsQueueVisible);
  fsQBtn.classList.toggle('active-ctrl', state.fsQueueVisible);
}

export function hideFsQueue() {
  state.fsQueueVisible = false;
  fsQueue.classList.remove('visible');
  fsQBtn.classList.remove('active-ctrl');
}

// ── Add items ─────────────────────────────────────────────────────────────────
export function addItems(items, forcePlay = false) {
  const wasEmpty       = state.playlist.length === 0;
  const insertionPoint = state.playlist.length;
  state.playlist.push(...items);
  renderPlaylist();
  if      (wasEmpty)   _playIndex(0);
  else if (forcePlay)  _playIndex(insertionPoint);
}

// ── Remove: single item ───────────────────────────────────────────────────────
export function removeFromQueue(idx) {
  // Remap selectedIndices around the removed slot
  state.selectedIndices.delete(idx);
  const newSel = new Set();
  state.selectedIndices.forEach(si => {
    if (si > idx)  newSel.add(si - 1);
    else if (si !== idx) newSel.add(si);
  });
  state.selectedIndices = newSel;

  const removed = state.playlist.splice(idx, 1)[0];
  revokeItemBlobs(removed);

  if (state.currentIdx === idx) {
    if (state.playlist.length === 0) {
      state.currentIdx = -1;
      _destroyEngines();
      video.src = '';
      Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
      _resetPlayerUI();
      showEmptyState();
    } else {
      const next = Math.min(idx, state.playlist.length - 1);
      state.currentIdx = -1;
      _playIndex(next);
      return;
    }
  } else if (state.currentIdx > idx) {
    state.currentIdx--;
  }

  renderPlaylist();
}

// ── Remove: bulk selection ────────────────────────────────────────────────────
function removeSelected() {
  const toRemove = [...state.selectedIndices].sort((a, b) => b - a);

  toRemove.forEach(idx => {
    const item = state.playlist[idx];
    revokeItemBlobs(item);
    if (idx === state.currentIdx) {
      _destroyEngines();
      video.src = '';
      Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
    }
    state.playlist.splice(idx, 1);
  });

  if (toRemove.includes(state.currentIdx)) {
    if (state.playlist.length === 0) {
      state.currentIdx = -1;
      _resetPlayerUI();
      showEmptyState();
    } else {
      const fallback = Math.min(toRemove[toRemove.length - 1], state.playlist.length - 1);
      state.currentIdx = -1;
      state.selectedIndices = new Set();
      renderPlaylist();
      _playIndex(fallback);
      return;
    }
  } else {
    const aboveCount = toRemove.filter(i => i < state.currentIdx).length;
    state.currentIdx -= aboveCount;
  }

  state.selectedIndices = new Set();
  renderPlaylist();
  if (state.playlist.length === 0) showEmptyState();
}

// ── M3U parser ────────────────────────────────────────────────────────────────
export function parseM3U(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  let title = null, dur = -1;

  for (const line of lines) {
    if (line === '#EXTM3U') continue;
    if (line.startsWith('#EXTINF:')) {
      const m = line.match(/#EXTINF:([^,]*),(.*)/);
      if (m) { dur = parseFloat(m[1]); title = m[2].trim(); }
    } else if (!line.startsWith('#')) {
      items.push({
        title:     title || line.split('/').pop().split('?')[0] || 'Track',
        url:       line,
        dur,
        subtitles: [],
        resumeKey: 'n' + hashKey(line),
      });
      title = null;
      dur   = -1;
    }
  }

  return items;
}

// ── Module initialisation ─────────────────────────────────────────────────────
export function initQueue() {
  fsQBtn.addEventListener('click',   e => { toggleFsQueue(); e.stopPropagation(); });
  fsQClose.addEventListener('click', hideFsQueue);
  fsQueue.addEventListener('click',  e => e.stopPropagation());
}
