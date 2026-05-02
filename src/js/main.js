// ── VECTO / main.js ───────────────────────────────────────────────────────────
// Application entry point.
// Imports all modules, wires cross-module callbacks, registers file/URL
// handlers, drag-drop, and keyboard shortcuts.

import { state, hashKey }                        from './state.js';
import { notif, closeAllPanels }                 from './ui.js';
import { initPlayer, playIndex, destroyEngines,
         resetPlayerUI, toggleTrueFS, toggleWFS,
         toggleSpeedDialog, closeSpeedDialog,
         toggleSettings, closeSettings,
         cycleLoopMode, togglePiP,
         isAudioFile, readAudioMeta }             from './player.js';
import { initQueue, setPlayerCallbacks,
         addItems, renderPlaylist, parseM3U }     from './queue.js';
import { initHistory, setHistoryCallbacks,
         openHistoryModal, closeHistoryModal }    from './history.js';
import { initSubtitles, setSubEnabled,
         convertSubsToVtt,
         attachSubtitleToCurrentItem }            from './subtitles.js';
import { toggleFsQueue }                          from './queue.js';

// ── DOM refs used only in main.js ─────────────────────────────────────────────
const video       = document.getElementById('video');
const urlInput    = document.getElementById('url-input');
const urlAdd      = document.getElementById('url-add');
const playerWrap  = document.getElementById('player-wrap');
const dropOverlay = document.getElementById('drop-overlay');
const subSetPanel = document.getElementById('sub-settings-panel');
const subBtn      = document.getElementById('sub-btn');
const speedMenu   = document.getElementById('speed-menu');
const speedDialog = document.getElementById('speed-dialog');
const settingsPanel = document.getElementById('settings-panel');
const histOverlay = document.getElementById('history-overlay');
const notifEl     = document.getElementById('notif');
const queueBtn    = document.getElementById('queue-btn');
const tempBadge   = document.getElementById('temp-badge');

// ── Cross-module callback wiring ──────────────────────────────────────────────
// Done before any init call so callbacks are in place before any event fires.
setPlayerCallbacks({ playIndex, destroyEngines, resetPlayerUI });
setHistoryCallbacks({ handleUrl });

// ── URL handler ───────────────────────────────────────────────────────────────
export async function handleUrl(raw) {
  const url = raw.trim();
  if (!url) return;

  // Plain M3U playlist (not M3U8 stream) — fetch and parse
  if (/\.m3u($|\?)/i.test(url) && !/\.m3u8($|\?)/i.test(url)) {
    try {
      const res   = await fetch(url);
      const text  = await res.text();
      const items = parseM3U(text);
      if (items.length) { addItems(items); return; }
    } catch (e) {}
  }

  const title    = url.split('/').pop().split('?')[0] || 'Stream';
  const wasEmpty = state.playlist.length === 0;
  state.playlist.push({ title, url, dur: -1, subtitles: [], resumeKey: 'n' + hashKey(url) });
  renderPlaylist();
  if (wasEmpty) playIndex(0);
  else notif('Added to queue');
}

// ── Web file list handler (non-Tauri) ─────────────────────────────────────────
async function handleFileList(files) {
  const m3u = [], vid = [], subs = [];
  for (const f of files) {
    if      (/\.(m3u|m3u8)$/i.test(f.name))    m3u.push(f);
    else if (/\.(vtt|srt|ass|ssa)$/i.test(f.name)) subs.push(f);
    else                                         vid.push(f);
  }

  for (const f of m3u) {
    const t = await f.text();
    addItems(parseM3U(t));
  }

  if (vid.length) {
    // Detect a cover art image in the same dropped batch
    let batchCoverFile = null;
    for (const f of files) {
      if (/^(cover|album|folder|art|front|back)\./i.test(f.name) &&
          /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name)) {
        batchCoverFile = f; break;
      }
    }

    const items = [];
    for (const f of vid) {
      const item = {
        title:     f.name,
        url:       URL.createObjectURL(f),
        dur:       -1,
        subtitles: [],
        resumeKey: 'l' + hashKey(f.name + ':' + f.size),
        audioMeta: null,
        filePath:  (window.__TAURI__ && f.path) ? f.path : null,
      };

      if (isAudioFile(f)) {
        item.audioMeta = await readAudioMeta(f);
        if (item.audioMeta?.title) item.title = item.audioMeta.title;
        if (item.audioMeta && !item.audioMeta.art && batchCoverFile) {
          item.audioMeta.art = URL.createObjectURL(batchCoverFile);
        } else if (!item.audioMeta && batchCoverFile) {
          item.audioMeta = { art: URL.createObjectURL(batchCoverFile), artist: null, album: null, title: null };
        }
      }
      items.push(item);
    }
    addItems(items);
  }

  if (subs.length) {
    try {
      const vttText = convertSubsToVtt(await subs[0].text(), subs[0].name);
      const blobUrl = URL.createObjectURL(new Blob([vttText], { type: 'text/vtt' }));
      attachSubtitleToCurrentItem(subs[0].name.replace(/\.[^/.]+$/, ''), 'en', blobUrl);
    } catch (e) {}
  }
}

// ── Tauri native path handler ─────────────────────────────────────────────────
async function handleTauriPaths(paths, autoPlay = false) {
  const m3u = [], vid = [], subs = [];
  let batchCoverPath = null;

  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    if      (/\.(m3u|m3u8)$/i.test(name))   m3u.push(p);
    else if (/\.(vtt|srt|ass|ssa)$/i.test(name)) subs.push(p);
    else if (/^(cover|album|folder|art|front|back)\./i.test(name) &&
             /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name)) batchCoverPath = p;
    else vid.push(p);
  }

  for (const p of m3u) {
    try {
      const text = await window.__TAURI__.fs.readTextFile(p);
      addItems(parseM3U(text));
    } catch (e) { notif('Error reading M3U'); }
  }

  if (vid.length) {
    const items = [];
    for (const p of vid) {
      const name     = p.split(/[\\/]/).pop();
      const tauriUrl = window.__TAURI__.core.convertFileSrc(p);
      const item     = {
        title:     name,
        url:       tauriUrl,
        dur:       -1,
        subtitles: [],
        resumeKey: 'l' + hashKey(p),
        audioMeta: null,
        filePath:  p,
      };

      if (/^audio\//i.test(name) || /\.(mp3|flac|aac|ogg|wav|m4a|opus|wma|ape)$/i.test(name)) {
        try {
          item.audioMeta = await readAudioMeta(tauriUrl);
          if (item.audioMeta?.title) item.title = item.audioMeta.title;
        } catch (e) {}

        if (batchCoverPath) {
          const coverUrl = window.__TAURI__.core.convertFileSrc(batchCoverPath);
          if (!item.audioMeta)          item.audioMeta = { art: coverUrl, artist: null, album: null, title: null };
          else if (!item.audioMeta.art) item.audioMeta.art = coverUrl;
        }
      }
      items.push(item);
    }
    addItems(items, autoPlay);
  }

  if (subs.length) {
    try {
      const p       = subs[0];
      const name    = p.split(/[\\/]/).pop();
      const text    = await window.__TAURI__.fs.readTextFile(p);
      const vttText = convertSubsToVtt(text, name);
      const blobUrl = URL.createObjectURL(new Blob([vttText], { type: 'text/vtt' }));
      attachSubtitleToCurrentItem(name.replace(/\.[^/.]+$/, ''), 'en', blobUrl);
    } catch (e) {}
  }
}

// ── URL bar ───────────────────────────────────────────────────────────────────
urlAdd.addEventListener('click',  () => { handleUrl(urlInput.value); urlInput.value = ''; });
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { handleUrl(urlInput.value); urlInput.value = ''; }
});

// ── File picker ───────────────────────────────────────────────────────────────
const fileLabelBtn = document.getElementById('file-label');
const fileInput    = document.getElementById('file-input');

fileLabelBtn.addEventListener('click', async e => {
  if (window.__TAURI__) {
    e.preventDefault();
    try {
      const selected = await window.__TAURI__.dialog.open({
        multiple: true,
        filters: [{ name: 'Media', extensions: [
          'm3u','m3u8','mpd','mkv','avi','mov','wmv','flv','ts','webm','mp4',
          'mp3','flac','aac','ogg','wav','m4a','opus',
        ]}],
      });
      if (selected) handleTauriPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (err) { console.error('Tauri dialog failed:', err); }
  } else {
    fileInput.click();
  }
});

fileInput.addEventListener('change', e => {
  handleFileList(Array.from(e.target.files));
  e.target.value = '';
});

// ── Drag and drop ─────────────────────────────────────────────────────────────
playerWrap.addEventListener('dragover',  e => { e.preventDefault(); dropOverlay.style.display = 'flex'; });
playerWrap.addEventListener('dragleave', () => { dropOverlay.style.display = ''; });
playerWrap.addEventListener('drop', e => {
  e.preventDefault();
  dropOverlay.style.display = '';
  if (!window.__TAURI__) handleFileList(Array.from(e.dataTransfer.files));
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop',     e => {
  e.preventDefault();
  if (!window.__TAURI__) handleFileList(Array.from(e.dataTransfer.files));
});

if (window.__TAURI__) {
  window.__TAURI__.event.listen('tauri://drag-enter', () => { dropOverlay.style.display = 'flex'; });
  window.__TAURI__.event.listen('tauri://drag-over',  () => { dropOverlay.style.display = 'flex'; });
  window.__TAURI__.event.listen('tauri://drag-leave', () => { dropOverlay.style.display = ''; });
  window.__TAURI__.event.listen('tauri://drag-drop',  event => {
    dropOverlay.style.display = '';
    if (event.payload?.paths?.length > 0) handleTauriPaths(event.payload.paths, true);
  });
}

// ── Global panel dismiss on outside click ─────────────────────────────────────
document.addEventListener('click', () => {
  speedMenu.classList.remove('open');
  closeSpeedDialog();
  closeSettings();
});
speedMenu.addEventListener('click', e => e.stopPropagation());

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', async e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Escape — close modals/panels in priority order
  if (e.key === 'Escape') {
    if (histOverlay.classList.contains('open')) { closeHistoryModal(); e.preventDefault(); return; }
    if (speedDialog.classList.contains('open')) { closeSpeedDialog(); e.preventDefault(); return; }
    if (settingsPanel.classList.contains('open')) { closeSettings(); e.preventDefault(); }
    return;
  }

  // Space — play/pause or hold for 2× temp speed
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    state.spaceDown   = true;
    state.lpActivated = false;
    state.lpTimer     = setTimeout(() => {
      if (!state.spaceDown) return;
      state.lpActivated       = true;
      state.prevRate          = video.playbackRate;
      state.isTempSpeed       = true;
      video.playbackRate      = 2;
      tempBadge.style.display = 'block';
      notif('▶▶  2× Speed', 9999);
      if (video.paused) video.play();
    }, 400);
    return;
  }
  if (e.code === 'Space' && e.repeat) { e.preventDefault(); return; }

  // Suppress repeat on non-repeatable keys
  const noRepeat = ['s','g','r','k','m','f','c','n','p','home','end'];
  if (e.repeat && noRepeat.includes(e.key.toLowerCase())) return;

  const d = video.duration;

  switch (e.key) {
    case 's': case 'S':
      e.preventDefault(); closeSettings(); toggleSpeedDialog(); break;

    case 'g': case 'G':
      e.preventDefault(); closeSpeedDialog(); speedMenu.classList.remove('open'); toggleSettings(); break;

    case 'r': case 'R':
      e.preventDefault(); cycleLoopMode(); break;

    case 'q': case 'Q':
      e.preventDefault();
      if (document.fullscreenElement) toggleFsQueue();
      else queueBtn.click();
      break;

    case 'k': case 'K':
      e.preventDefault(); video.paused ? video.play() : video.pause(); break;

    case 'ArrowRight':
      e.preventDefault(); video.currentTime = Math.min(d || 0, video.currentTime + 5); notif('+5s'); break;

    case 'ArrowLeft':
      e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); notif('−5s'); break;

    case 'l': case 'L':
      e.preventDefault(); video.currentTime = Math.min(d || 0, video.currentTime + 10); notif('+10s'); break;

    case 'j': case 'J':
      e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10); notif('−10s'); break;

    case 'ArrowUp':
      e.preventDefault();
      video.volume = Math.min(1, Math.round((video.volume + .05) * 100) / 100);
      video.muted  = false;
      notif('Vol ' + Math.round(video.volume * 100) + '%');
      break;

    case 'ArrowDown':
      e.preventDefault();
      video.volume = Math.max(0, Math.round((video.volume - .05) * 100) / 100);
      video.muted  = false;
      notif('Vol ' + Math.round(video.volume * 100) + '%');
      break;

    case 'm': case 'M':
      e.preventDefault(); video.muted = !video.muted; notif(video.muted ? 'Muted' : 'Unmuted'); break;

    case 'f': case 'F':
      e.preventDefault(); e.shiftKey ? toggleWFS() : toggleTrueFS(); break;

    case '>':
      e.preventDefault(); {
        const r = Math.min(4, Math.round((video.playbackRate + .25) * 100) / 100);
        video.playbackRate = r; notif(r + '× Speed');
      } break;

    case '<':
      e.preventDefault(); {
        const r = Math.max(0.05, Math.round((video.playbackRate - .25) * 100) / 100);
        video.playbackRate = r; notif(r + '× Speed');
      } break;

    case '.':
      e.preventDefault();
      if (video.paused && isFinite(d)) video.currentTime = Math.min(d, video.currentTime + 1 / 30);
      break;

    case ',':
      e.preventDefault();
      if (video.paused) video.currentTime = Math.max(0, video.currentTime - 1 / 30);
      break;

    case 'c': case 'C':
      e.preventDefault();
      if (e.shiftKey) {
        const alreadyOpen = subSetPanel.classList.contains('open');
        closeAllPanels();
        if (!alreadyOpen) { subSetPanel.classList.add('open'); subBtn.classList.add('active-ctrl'); }
      } else {
        const tracks = Array.from(video.textTracks)
          .filter(t => t.kind === 'subtitles' || t.kind === 'captions');
        if (tracks.length) {
          setSubEnabled(!state.subState.enabled);
          notif(state.subState.enabled ? 'Subtitles On' : 'Subtitles Off');
        } else {
          notif('No subtitles');
        }
      }
      break;

    case 'n': case 'N':
      if (e.shiftKey) {
        e.preventDefault();
        if (state.currentIdx < state.playlist.length - 1) playIndex(state.currentIdx + 1);
      }
      break;

    case 'p': case 'P':
      e.preventDefault();
      if (e.shiftKey) { if (state.currentIdx > 0) playIndex(state.currentIdx - 1); }
      else togglePiP();
      break;

    case 'Home':
      e.preventDefault(); video.currentTime = 0; notif('Beginning'); break;

    case 'End':
      e.preventDefault();
      if (isFinite(d)) { video.currentTime = Math.max(0, d - 5); notif('Near end'); }
      break;

    default:
      if (e.key >= '1' && e.key <= '9' && isFinite(d)) {
        e.preventDefault(); video.currentTime = d * parseInt(e.key) / 10; notif(e.key + '0%');
      } else if (e.key === '0' && isFinite(d)) {
        e.preventDefault(); video.currentTime = 0; notif('0%');
      }
  }
});

document.addEventListener('keyup', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    clearTimeout(state.lpTimer);
    notifEl.classList.remove('show');
    if (state.lpActivated) {
      video.playbackRate      = state.prevRate;
      state.isTempSpeed       = false;
      tempBadge.style.display = 'none';
      notif(state.prevRate + '× Speed');
    } else {
      video.paused ? video.play() : video.pause();
    }
    state.spaceDown   = false;
    state.lpActivated = false;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
initSubtitles();
initQueue();
initPlayer();
initHistory();
