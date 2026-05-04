// ── VECTO / player.js ────────────────────────────────────────────────────────
// Video engine (HLS / DASH / native), playback controls, fullscreen,
// speed dialog, tracks & quality panel, album art, loop mode, PiP,
// frame capture, and the history recording hook.
//
// Exports: initPlayer, playIndex, destroyEngines, resetPlayerUI,
//          saveToHistory, openFileLocation, isAudioFile, readAudioMeta,
//          toggleTrueFS, toggleWFS, toggleSpeedDialog, closeSpeedDialog,
//          toggleSettings, closeSettings, populateSettings,
//          cycleLoopMode, togglePiP, captureFrame, showControls

import { state, fmt, escHtml,
         LOOP_CYCLE, LOOP_ICON, LOOP_TITLE, hashKey } from './state.js';
import { notif, closeAllPanels }                       from './ui.js';
import { savePosition, getSaved, clearSaved,
         loadHistRaw, saveHistRaw,
         getHistDays, HIST_MAX }                       from './settings.js';
import { loadItemSubtitles }                           from './subtitles.js';
import { renderPlaylist, renderFsQueue,
         revokeItemSubs, hideResumeBar,
         showResumeBar, hideFsQueue }                  from './queue.js';
import { wrapUrl, getHlsCorsConfig }                   from './cors.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video         = document.getElementById('video');
const playerWrap    = document.getElementById('player-wrap');
const emptyState    = document.getElementById('empty-state');
const playBtn       = document.getElementById('play-btn');
const prevBtn       = document.getElementById('prev-btn');
const nextBtn       = document.getElementById('next-btn');
const muteBtn       = document.getElementById('mute-btn');
const volSlider     = document.getElementById('vol-slider');
const timeEl        = document.getElementById('time');
const loopBtn       = document.getElementById('loop-btn');
const progFill      = document.getElementById('prog-fill');
const progDot       = document.getElementById('prog-dot');
const bufFill       = document.getElementById('buf-fill');
const bufSpinner    = document.getElementById('buf-spinner');
const progressWrap  = document.getElementById('progress-wrap');
const controlsEl    = document.getElementById('controls');
const speedBtn      = document.getElementById('speed-btn');
const speedMenu     = document.getElementById('speed-menu');
const speedDialog   = document.getElementById('speed-dialog');
const sdClose       = document.getElementById('sd-close');
const sdNum         = document.getElementById('sd-num');
const sdSlider      = document.getElementById('sd-slider');
const sdPresets     = document.getElementById('sd-presets');
const settingsPanel = document.getElementById('settings-panel');
const spClose       = document.getElementById('sp-close');
const spBody        = document.getElementById('sp-body');
const gearBtn       = document.getElementById('gear-btn');
const fsBtn         = document.getElementById('fs-btn');
const fsQBtn        = document.getElementById('fs-q-btn');
const pipBtn        = document.getElementById('pip-btn');
const shotBtn       = document.getElementById('shot-btn');
const albumArtWrap  = document.getElementById('album-art-wrap');
const albumArtBlur  = document.getElementById('album-art-blur');
const albumArtImg   = document.getElementById('album-art-img');
const audioTrackTitle  = document.getElementById('audio-track-title');
const audioTrackArtist = document.getElementById('audio-track-artist');
const clearBtn      = document.getElementById('clear-btn');
const queueBtn      = document.getElementById('queue-btn');
const playlistPanel = document.getElementById('playlist-panel');
const resizeHandle  = document.getElementById('resize-handle');
const tempBadge     = document.getElementById('temp-badge');

// ── Module-local state ────────────────────────────────────────────────────────
let _saveThrottle     = null;
let _resumeItem       = null;
let _hideArtTimer     = null;
let _pendingSeekRatio = null;
let _isDraggingProg   = false;
let _dragRatio        = 0;

// ── Engine management ─────────────────────────────────────────────────────────
export function destroyEngines() {
  if (state.hlsInst)  { state.hlsInst.destroy();  state.hlsInst  = null; }
  if (state.dashInst) { state.dashInst.reset();   state.dashInst = null; }
}

// ── Source loading ────────────────────────────────────────────────────────────
function loadSrc(src) {
  // src is always the original item URL — used for type detection.
  // effectiveSrc is what actually gets loaded (may be wrapped through proxy).
  const effectiveSrc = wrapUrl(src);
  destroyEngines();
  video.src = '';

  // Type detection always on original URL — proxy URL has no extension.
  const isHLS  = /\.m3u8($|\?)/i.test(src);
  const isDASH = /\.mpd($|\?)/i.test(src);

  if (isHLS && window.Hls && Hls.isSupported()) {
    // Merge base config with CORS routing config (empty object when CORS off).
    // xhrSetup / fetchSetup in getHlsCorsConfig() route every segment request
    // (not just the manifest) through the local proxy.
    const hlsConfig = Object.assign(
      { enableWorker: true, maxBufferLength: 30 },
      getHlsCorsConfig()
    );
    state.hlsInst = new Hls(hlsConfig);
    state.hlsInst.loadSource(effectiveSrc);
    state.hlsInst.attachMedia(video);
    state.hlsInst.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      if (settingsPanel.classList.contains('open')) setTimeout(populateSettings, 100);
    });
    state.hlsInst.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      if (settingsPanel.classList.contains('open')) populateSettings();
    });
    state.hlsInst.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) notif('HLS stream error');
    });
  } else if (isDASH && window.dashjs) {
    state.dashInst = dashjs.MediaPlayer().create();
    state.dashInst.updateSettings({
      streaming: { abr: { autoSwitchBitrate: { video: true, audio: true } } },
    });
    // DASH: proxy wraps initial manifest URL. Segment-level CORS bypass for
    // DASH is not implemented in this round.
    state.dashInst.initialize(video, effectiveSrc, true);
    state.dashInst.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      if (state.dashInst.isDynamic()) {
        state.dashInst.updateSettings({ streaming: { lowLatencyEnabled: true } });
      }
      if (settingsPanel.classList.contains('open')) setTimeout(populateSettings, 100);
    });
    state.dashInst.on(dashjs.MediaPlayer.events.ERROR, e => {
      notif('DASH Error: ' + (e.error ? e.error.message : 'Stream error'));
    });
  } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = effectiveSrc;
    video.play().catch(() => {});
  } else {
    video.src = effectiveSrc;
    video.play().catch(() => {});
  }

  emptyState.style.opacity       = '0';
  emptyState.style.pointerEvents = 'none';
}

// ── Playback ──────────────────────────────────────────────────────────────────
export function playIndex(idx) {
  if (idx < 0 || idx >= state.playlist.length) return;
  hideResumeBar();
  hideAlbumArt();
  state.currentIdx = idx;
  renderPlaylist();
  saveToHistory(state.playlist[idx]);
  const item = state.playlist[idx];
  _resumeItem = item;
  loadItemSubtitles(item);
  loadSrc(item.url);
  if (settingsPanel.classList.contains('open')) setTimeout(populateSettings, 200);
}

// ── History hook ──────────────────────────────────────────────────────────────
function histType(url) {
  if (!url || url.startsWith('blob:') || /^https?:\/\/asset\.localhost/i.test(url)) return 'local';
  if (/\.m3u8($|\?)/i.test(url))  return 'hls';
  if (/\.mpd($|\?)/i.test(url))   return 'dash';
  if (/\.m3u($|\?)/i.test(url))   return 'm3u';
  return 'stream';
}

export function saveToHistory(item) {
  if (!item || state.historyPaused) return;
  // item.url is always the original URL (loadSrc wraps internally, never mutates item).
  const type   = histType(item.url);
  const rawUrl = type === 'local' ? null : item.url;
  const key    = item.resumeKey || hashKey(item.title + (rawUrl || ''));
  const hist   = loadHistRaw();
  const now    = Date.now();
  const ex     = hist.find(h => h.key === key);
  if (ex) {
    ex.lastPlayed = now;
    ex.playCount  = (ex.playCount || 1) + 1;
    ex.title      = item.title;
    if (item.dur > 0 && ex.duration <= 0) ex.duration = item.dur;
    if (item.filePath && !ex.filePath)    ex.filePath = item.filePath;
  } else {
    hist.push({
      id:         now + '_' + Math.random().toString(36).slice(2),
      key, title: item.title, rawUrl, type,
      duration:   item.dur > 0 ? item.dur : -1,
      lastPlayed: now, playCount: 1,
      filePath:   item.filePath || null,
    });
  }
  // getHistDays() reads the user-set value from localStorage at call time,
  // so changes in App Settings take effect on the very next history write.
  const cutoff = now - getHistDays() * 86400000;
  saveHistRaw(hist.filter(h => h.lastPlayed >= cutoff).slice(-HIST_MAX));
}

// ── Reset player UI ───────────────────────────────────────────────────────────
export function resetPlayerUI() {
  progFill.style.width  = '0%';
  progDot.style.left    = '0%';
  bufFill.style.width   = '0%';
  timeEl.textContent    = '0:00 / 0:00';
  bufSpinner.classList.remove('visible');
  playBtn.innerHTML     = '&#9654;';
  hideAlbumArt();
  hideResumeBar();
}

// ── Album art ─────────────────────────────────────────────────────────────────
function setMarquee(el, text) {
  el.innerHTML = '';
  el.classList.remove('mq-active');
  const inner       = document.createElement('span');
  inner.className   = 'mq-inner';
  inner.textContent = text;
  el.appendChild(inner);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const rawOverflow = inner.scrollWidth - el.offsetWidth;
    if (rawOverflow > 4) {
      el.classList.add('mq-active');
      inner.style.paddingLeft  = '40px';
      inner.style.paddingRight = '40px';
      const totalDist = rawOverflow + 80;
      inner.style.setProperty('--mq-dist', `-${totalDist}px`);
      inner.style.setProperty('--mq-dur',  `${Math.max(8, totalDist / 25)}s`);
      inner.classList.add('mq-on');
    }
  }));
}

function showAlbumArt(item) {
  clearTimeout(_hideArtTimer);
  if (!item?.audioMeta?.art) { hideAlbumArt(); return; }
  const { art, artist, album } = item.audioMeta;
  albumArtBlur.style.backgroundImage = `url('${art}')`;
  albumArtImg.src = art;
  const displayTitle = (item.audioMeta?.title || item.title || '').replace(/\.[^/.]+$/, '');
  const displaySub   = [artist, album].filter(Boolean).join(' — ');
  setMarquee(audioTrackTitle,  displayTitle);
  setMarquee(audioTrackArtist, displaySub || '');
  albumArtWrap.classList.add('visible');
}

function hideAlbumArt() {
  clearTimeout(_hideArtTimer);
  albumArtWrap.classList.remove('visible');
  _hideArtTimer = setTimeout(() => {
    albumArtImg.src = '';
    albumArtBlur.style.backgroundImage = '';
  }, 700);
}

// ── Audio metadata ────────────────────────────────────────────────────────────
export function isAudioFile(f) {
  return /^audio\//i.test(f.type) || /\.(mp3|flac|aac|ogg|wav|m4a|opus|wma|ape)$/i.test(f.name);
}

export function readAudioMeta(file) {
  return new Promise(resolve => {
    if (!window.jsmediatags) { resolve(null); return; }
    jsmediatags.read(file, {
      onSuccess(tag) {
        const t      = tag.tags;
        const result = { art: null, artist: t.artist || null, album: t.album || null, title: t.title || null };
        if (t.picture) {
          try {
            const b64 = btoa(t.picture.data.reduce((s, b) => s + String.fromCharCode(b), ''));
            result.art = `data:${t.picture.format};base64,${b64}`;
          } catch (e) {}
        }
        resolve(result);
      },
      onError() { resolve(null); },
    });
  });
}

// ── Tauri: reveal in Explorer ─────────────────────────────────────────────────
export async function openFileLocation(filePath) {
  if (!window.__TAURI__) { notif('Open file location requires the Tauri app'); return; }
  try {
    const exists = await window.__TAURI__.core.invoke('file_exists', { path: filePath });
    if (!exists) { notif('File not found. It may have been moved or deleted.'); return; }
    await window.__TAURI__.core.invoke('reveal_in_explorer', { path: filePath });
  } catch (e) {
    notif('Could not open file location.');
  }
}

// ── Loop mode ─────────────────────────────────────────────────────────────────
export function cycleLoopMode() {
  const idx = (LOOP_CYCLE.indexOf(state.loopMode) + 1) % LOOP_CYCLE.length;
  state.loopMode = LOOP_CYCLE[idx];
  _updateLoopBtn();
  notif('Loop: ' + { normal: 'Off', 'loop-all': 'All', 'loop-one': 'One', stop: 'Stop at end' }[state.loopMode]);
}

function _updateLoopBtn() {
  loopBtn.textContent = LOOP_ICON[state.loopMode];
  loopBtn.title       = LOOP_TITLE[state.loopMode];
  loopBtn.classList.toggle('active-ctrl', state.loopMode !== 'normal');
}

// ── Speed dialog ──────────────────────────────────────────────────────────────
function _syncSpeedDialog(rate) {
  const r = Math.max(0.05, Math.min(4, rate));
  sdSlider.value = r;
  sdNum.value    = parseFloat(r.toFixed(2));
  document.querySelectorAll('#sd-presets .btn').forEach(b => {
    b.classList.toggle('btn-active', parseFloat(b.dataset.rate) === r);
  });
}

function _applySpeed(rate) {
  const r = Math.max(0.05, Math.min(4, parseFloat(rate)));
  if (!isNaN(r)) { video.playbackRate = r; _syncSpeedDialog(r); }
}

export function closeSpeedDialog() { speedDialog.classList.remove('open'); }

export function toggleSpeedDialog() {
  if (speedDialog.classList.contains('open')) {
    closeSpeedDialog();
  } else {
    closeAllPanels();
    _syncSpeedDialog(video.playbackRate);
    speedDialog.classList.add('open');
    sdNum.focus();
    sdNum.select();
  }
}

// ── Tracks & quality panel ────────────────────────────────────────────────────
function _makeOpt(label, selected, onClick) {
  const btn     = document.createElement('button');
  btn.className = 'sp-opt' + (selected ? ' sel' : '');
  btn.innerHTML = `<span class="sp-dot">${selected ? '●' : '○'}</span>${escHtml(label)}`;
  btn.addEventListener('click', () => { onClick(); populateSettings(); });
  return btn;
}

function _makeSection(label) {
  const s   = document.createElement('div'); s.className = 'sp-section';
  const l   = document.createElement('div'); l.className = 'sp-label'; l.textContent = label;
  s.appendChild(l);
  return s;
}

export function populateSettings() {
  spBody.innerHTML = '';
  let hasAny = false;

  if (state.hlsInst?.levels?.length > 1) {
    hasAny = true;
    const sec = _makeSection('QUALITY');
    sec.appendChild(_makeOpt('Auto', state.hlsInst.currentLevel === -1, () => { state.hlsInst.currentLevel = -1; }));
    state.hlsInst.levels.forEach((lv, i) => {
      sec.appendChild(_makeOpt(lv.height ? `${lv.height}p` : `Level ${i + 1}`,
        state.hlsInst.currentLevel === i, () => { state.hlsInst.currentLevel = i; }));
    });
    spBody.appendChild(sec);
  } else if (state.dashInst) {
    const bitrates = state.dashInst.getBitrateInfoListFor('video');
    if (bitrates?.length > 1) {
      hasAny = true;
      const sec    = _makeSection('QUALITY');
      const isAuto = state.dashInst.getSettings().streaming.abr.autoSwitchBitrate.video;
      sec.appendChild(_makeOpt('Auto', isAuto, () => {
        state.dashInst.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
      }));
      bitrates.forEach((br, i) => {
        const lbl = br.height ? `${br.height}p` : `${Math.round(br.bitrate / 1000)} kbps`;
        sec.appendChild(_makeOpt(lbl, !isAuto && state.dashInst.getQualityFor('video') === i, () => {
          state.dashInst.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
          state.dashInst.setQualityFor('video', i);
        }));
      });
      spBody.appendChild(sec);
    }
  }

  if (state.hlsInst?.audioTracks?.length > 1) {
    hasAny = true;
    const sec = _makeSection('AUDIO TRACK');
    state.hlsInst.audioTracks.forEach((t, i) => {
      sec.appendChild(_makeOpt(t.name || t.lang || `Track ${i + 1}`,
        state.hlsInst.audioTrack === i, () => { state.hlsInst.audioTrack = i; }));
    });
    spBody.appendChild(sec);
  } else if (state.dashInst) {
    const audioTracks = state.dashInst.getTracksFor('audio');
    if (audioTracks?.length > 1) {
      hasAny = true;
      const sec     = _makeSection('AUDIO TRACK');
      const current = state.dashInst.getCurrentTrackFor('audio');
      audioTracks.forEach((t, i) => {
        sec.appendChild(_makeOpt(t.lang || t.id || `Track ${i + 1}`,
          current?.id === t.id, () => { state.dashInst.setCurrentTrack(t); }));
      });
      spBody.appendChild(sec);
    }
  } else if (video.audioTracks?.length > 1) {
    hasAny = true;
    const sec = _makeSection('AUDIO TRACK');
    Array.from(video.audioTracks).forEach(t => {
      sec.appendChild(_makeOpt(t.label || t.language || 'Track', t.enabled, () => {
        Array.from(video.audioTracks).forEach(x => x.enabled = false);
        t.enabled = true;
      }));
    });
    spBody.appendChild(sec);
  }

  if (!hasAny) {
    const d = document.createElement('div');
    d.className   = 'sp-empty';
    d.textContent = 'No tracks available for this stream';
    spBody.appendChild(d);
  }
}

export function closeSettings() {
  settingsPanel.classList.remove('open');
  gearBtn.classList.remove('active-ctrl');
}

export function toggleSettings() {
  if (settingsPanel.classList.contains('open')) {
    closeSettings();
  } else {
    closeAllPanels();
    populateSettings();
    settingsPanel.classList.add('open');
    gearBtn.classList.add('active-ctrl');
  }
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function _isAnyFS() {
  return state.isWFS || !!document.fullscreenElement;
}

function _updateFsUI() {
  fsBtn.title          = _isAnyFS()
    ? 'Exit fullscreen (F / Shift+F)'
    : 'Fullscreen (F) · Windowed (Shift+F)';
  fsQBtn.style.display = document.fullscreenElement ? '' : 'none';
  if (!_isAnyFS()) hideFsQueue();
}

async function _exitAllFS() {
  const returnToWFS        = state.wasWFSBeforeTrueFS;
  state.wasWFSBeforeTrueFS = false;
  state.isWFS              = false;
  playerWrap.classList.remove('wfs');
  if (document.fullscreenElement) await document.exitFullscreen();
  if (window.__TAURI__) {
    const win = window.__TAURI__.window.getCurrentWindow();
    if (await win.isFullscreen()) await win.setFullscreen(false);
  }
  if (returnToWFS) await _enterWFS();
  else _updateFsUI();
}

async function _enterTrueFS() {
  if (state.isWFS) state.wasWFSBeforeTrueFS = true;
  state.isWFS = false;
  playerWrap.classList.remove('wfs');
  if (window.__TAURI__) {
    await window.__TAURI__.window.getCurrentWindow().setFullscreen(true);
  }
  await playerWrap.requestFullscreen().catch(() => {});
  _updateFsUI();
}

async function _enterWFS() {
  state.wasWFSBeforeTrueFS = false;
  if (document.fullscreenElement) await document.exitFullscreen();
  if (window.__TAURI__) {
    const win = window.__TAURI__.window.getCurrentWindow();
    if (await win.isFullscreen()) await win.setFullscreen(false);
  }
  state.isWFS = true;
  playerWrap.classList.add('wfs');
  _updateFsUI();
}

export async function toggleTrueFS() {
  _isAnyFS() ? await _exitAllFS() : await _enterTrueFS();
}

export async function toggleWFS() {
  _isAnyFS() ? await _exitAllFS() : await _enterWFS();
}

// ── PiP ───────────────────────────────────────────────────────────────────────
export async function togglePiP() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    else notif('PiP not supported in this browser');
  } catch (e) {
    notif('PiP unavailable');
  }
}

// ── Frame capture ─────────────────────────────────────────────────────────────
export function captureFrame() {
  if (!video.videoWidth) { notif('No video to capture'); return; }
  const canvas  = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const title = state.currentIdx >= 0
    ? state.playlist[state.currentIdx].title.replace(/[^a-z0-9]/gi, '_').substring(0, 40)
    : 'frame';
  const ts  = fmt(video.currentTime).replace(/:/g, '-');
  const a   = document.createElement('a');
  a.download = `${title}_${ts}.png`;
  a.href     = canvas.toDataURL('image/png');
  a.click();
  notif('Frame saved');
}

// ── Controls visibility ───────────────────────────────────────────────────────
export function showControls() {
  controlsEl.classList.add('visible');
  clearTimeout(state.ctrlTimer);
  if (!video.paused) {
    state.ctrlTimer = setTimeout(() => controlsEl.classList.remove('visible'), 2800);
  }
}

// ── Progress bar seeking ──────────────────────────────────────────────────────
function _seekToRatio(r) {
  if (!isFinite(video.duration)) {
    _pendingSeekRatio = r;
    video.addEventListener('loadedmetadata', () => {
      if (_pendingSeekRatio !== null) {
        video.currentTime = Math.max(0, Math.min(1, _pendingSeekRatio)) * video.duration;
        _pendingSeekRatio = null;
      }
    }, { once: true });
    return;
  }
  _pendingSeekRatio = null;
  video.currentTime = Math.max(0, Math.min(1, r)) * video.duration;
}

function _ratioFromEvent(e) {
  const rect = progressWrap.getBoundingClientRect();
  return (e.clientX - rect.left) / rect.width;
}

function _updateProgVisual(r) {
  const clamped = Math.max(0, Math.min(1, r));
  const pct     = (clamped * 100).toFixed(2);
  progFill.style.width = pct + '%';
  progDot.style.left   = pct + '%';
  if (isFinite(video.duration)) {
    timeEl.textContent = fmt(clamped * video.duration) + ' / ' + fmt(video.duration);
  }
}

// ── Module initialisation ─────────────────────────────────────────────────────
export function initPlayer() {

  // ── Video events ────────────────────────────────────────────────────────────
  video.addEventListener('play', () => {
    if (state.currentIdx < 0 || !video.src) { video.pause(); return; }
    playBtn.innerHTML = '&#9646;&#9646;';
    renderPlaylist();
  });
  video.addEventListener('pause', () => {
    playBtn.innerHTML = '&#9654;';
    renderPlaylist();
  });
  video.addEventListener('timeupdate', () => {
    if (state.currentIdx < 0) return;
    if (_isDraggingProg) return;
    const d = video.duration;
    if (!isFinite(d)) return;
    const pct = (video.currentTime / d * 100).toFixed(2);
    progFill.style.width = pct + '%';
    progDot.style.left   = pct + '%';
    if (video.buffered.length > 0) {
      bufFill.style.width = (video.buffered.end(video.buffered.length - 1) / d * 100).toFixed(2) + '%';
    }
    timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(d);
  });
  video.addEventListener('ratechange', () => {
    const r = video.playbackRate;
    speedBtn.textContent = r + '×';
    speedBtn.classList.toggle('active', r !== 1);
    document.querySelectorAll('.speed-opt').forEach(o => {
      o.classList.toggle('sel', parseFloat(o.dataset.rate) === r);
    });
    if (speedDialog.classList.contains('open')) _syncSpeedDialog(r);
  });
  video.addEventListener('volumechange', () => {
    const m = video.muted, v = video.volume;
    volSlider.value    = m ? 0 : v;
    muteBtn.innerHTML  = (m || v === 0) ? '&#128263;' : v < 0.4 ? '&#128264;' : '&#128266;';
  });
  video.addEventListener('waiting',  () => { if (state.currentIdx >= 0 && video.src) bufSpinner.classList.add('visible'); });
  video.addEventListener('playing',  () => bufSpinner.classList.remove('visible'));
  video.addEventListener('canplay',  () => bufSpinner.classList.remove('visible'));
  video.addEventListener('seeked',   () => bufSpinner.classList.remove('visible'));
  video.addEventListener('seeking',  () => hideResumeBar());
  video.addEventListener('contextmenu', e => e.preventDefault());

  video.addEventListener('loadedmetadata', () => {
    if (state.currentIdx < 0) return;
    if (isFinite(video.duration) && video.duration > 0) {
      const cur = state.playlist[state.currentIdx];
      if (!cur.dur || cur.dur <= 0) {
        cur.dur = Math.floor(video.duration);
        renderPlaylist();
        const histKey = cur.resumeKey || hashKey(cur.title + (cur.url.startsWith('blob:') ? '' : cur.url));
        const h       = loadHistRaw();
        const entry   = h.find(e => e.key === histKey);
        if (entry && entry.duration <= 0) { entry.duration = cur.dur; saveHistRaw(h); }
      }
    }
    const isAudioOnly = video.videoWidth === 0 && video.videoHeight === 0;
    if (isAudioOnly) {
      showAlbumArt(state.playlist[state.currentIdx]);
      _resumeItem = null;
      return;
    }
    hideAlbumArt();
    if (!_resumeItem) return;
    const item   = _resumeItem;
    _resumeItem  = null;
    const saved  = getSaved(item);
    if (saved) showResumeBar(saved, item);
  });

  video.addEventListener('ended', () => {
    if (state.currentIdx >= 0) clearSaved(state.playlist[state.currentIdx]);
    if      (state.loopMode === 'loop-one') { video.currentTime = 0; video.play().catch(() => {}); return; }
    else if (state.loopMode === 'stop')     { return; }
    else if (state.loopMode === 'loop-all') {
      if (state.currentIdx < state.playlist.length - 1) playIndex(state.currentIdx + 1);
      else if (state.playlist.length > 0)               playIndex(0);
      return;
    }
    if (state.currentIdx < state.playlist.length - 1) playIndex(state.currentIdx + 1);
  });

  video.addEventListener('timeupdate', () => {
    if (_saveThrottle) return;
    _saveThrottle = setTimeout(() => {
      _saveThrottle = null;
      if (state.currentIdx >= 0) {
        savePosition(state.playlist[state.currentIdx], video.currentTime, video.duration);
      }
    }, 5000);
  });
  video.addEventListener('pause', () => {
    if (state.currentIdx >= 0) {
      savePosition(state.playlist[state.currentIdx], video.currentTime, video.duration);
    }
  });
  window.addEventListener('beforeunload', () => {
    if (state.currentIdx >= 0) {
      savePosition(state.playlist[state.currentIdx], video.currentTime, video.duration);
    }
  });

  video.addEventListener('enterpictureinpicture', () => pipBtn.classList.add('active-ctrl'));
  video.addEventListener('leavepictureinpicture', () => pipBtn.classList.remove('active-ctrl'));

  // ── Controls visibility ──────────────────────────────────────────────────────
  playerWrap.addEventListener('mousemove',  showControls);
  playerWrap.addEventListener('mouseenter', showControls);
  playerWrap.addEventListener('mouseleave', () => {
    if (!video.paused) controlsEl.classList.remove('visible');
  });
  video.addEventListener('pause', () => controlsEl.classList.add('visible'));
  video.addEventListener('play',  () => {
    clearTimeout(state.ctrlTimer);
    state.ctrlTimer = setTimeout(() => controlsEl.classList.remove('visible'), 2800);
  });

  // ── Progress bar ─────────────────────────────────────────────────────────────
  progressWrap.addEventListener('mousedown', e => {
    _isDraggingProg = true;
    _dragRatio = _ratioFromEvent(e);
    _updateProgVisual(_dragRatio);
  });
  document.addEventListener('mousemove', e => {
    if (!_isDraggingProg) return;
    _dragRatio = _ratioFromEvent(e);
    _updateProgVisual(_dragRatio);
  });
  document.addEventListener('mouseup', () => {
    if (!_isDraggingProg) return;
    _isDraggingProg = false;
    _seekToRatio(_dragRatio);
  });
  progressWrap.addEventListener('click',     e => _seekToRatio(_ratioFromEvent(e)));
  progressWrap.addEventListener('touchstart', e => {
    _isDraggingProg = true;
    _seekToRatio((e.touches[0].clientX - progressWrap.getBoundingClientRect().left) / progressWrap.offsetWidth);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (_isDraggingProg) {
      _seekToRatio((e.touches[0].clientX - progressWrap.getBoundingClientRect().left) / progressWrap.offsetWidth);
    }
  }, { passive: true });
  document.addEventListener('touchend', () => { _isDraggingProg = false; });

  // ── Playback controls ─────────────────────────────────────────────────────────
  playBtn.addEventListener('click',  () => video.paused ? video.play() : video.pause());
  prevBtn.addEventListener('click',  () => state.currentIdx > 0 && playIndex(state.currentIdx - 1));
  nextBtn.addEventListener('click',  () => state.currentIdx < state.playlist.length - 1 && playIndex(state.currentIdx + 1));
  muteBtn.addEventListener('click',  () => { video.muted = !video.muted; notif(video.muted ? 'Muted' : 'Unmuted'); });
  volSlider.addEventListener('input', () => { video.volume = parseFloat(volSlider.value); video.muted = false; });
  loopBtn.addEventListener('click',  cycleLoopMode);
  pipBtn.addEventListener('click',   togglePiP);
  shotBtn.addEventListener('click',  captureFrame);

  // ── Speed dialog ──────────────────────────────────────────────────────────────
  sdSlider.addEventListener('input', () => _applySpeed(parseFloat(sdSlider.value)));
  sdNum.addEventListener('input', () => {
    const raw = sdNum.value, v = parseFloat(raw);
    if (!isNaN(v) && !raw.endsWith('.') && !raw.endsWith('-') && v >= 0.05 && v <= 4) _applySpeed(v);
  });
  sdNum.addEventListener('change', () => _applySpeed(isNaN(parseFloat(sdNum.value)) ? 1 : parseFloat(sdNum.value)));
  sdNum.addEventListener('blur',   () => _applySpeed(isNaN(parseFloat(sdNum.value)) ? 1 : Math.max(0.05, Math.min(4, parseFloat(sdNum.value)))));
  sdNum.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { _applySpeed(parseFloat(sdNum.value)); closeSpeedDialog(); e.preventDefault(); }
    if (e.key === 'Escape') { closeSpeedDialog(); e.preventDefault(); }
    if (e.key === 's' || e.key === 'S') { closeSpeedDialog(); e.preventDefault(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.05;
      const cur  = parseFloat(sdNum.value) || video.playbackRate;
      _applySpeed(e.key === 'ArrowUp' ? cur + step : cur - step);
    }
    e.stopPropagation();
  });
  sdPresets.addEventListener('click', e => {
    const b = e.target.closest('.btn');
    if (b) _applySpeed(parseFloat(b.dataset.rate));
  });
  sdClose.addEventListener('click', closeSpeedDialog);
  speedBtn.addEventListener('click', e => { closeAllPanels(); speedMenu.classList.toggle('open'); e.stopPropagation(); });
  document.querySelectorAll('.speed-opt').forEach(o => {
    o.addEventListener('click', () => { video.playbackRate = parseFloat(o.dataset.rate); speedMenu.classList.remove('open'); });
  });
  speedDialog.addEventListener('click', e => e.stopPropagation());

  // ── Settings panel ────────────────────────────────────────────────────────────
  spClose.addEventListener('click', closeSettings);
  settingsPanel.addEventListener('click', e => e.stopPropagation());
  gearBtn.addEventListener('click', e => { toggleSettings(); e.stopPropagation(); });

  // ── Fullscreen ────────────────────────────────────────────────────────────────
  fsBtn.addEventListener('click', e => {
    e.stopPropagation();
    e.shiftKey ? toggleWFS() : toggleTrueFS();
  });
  video.addEventListener('dblclick', e => { e.stopPropagation(); toggleTrueFS(); });
  document.addEventListener('fullscreenchange', async () => {
    if (!document.fullscreenElement && window.__TAURI__) {
      const win = window.__TAURI__.window.getCurrentWindow();
      if (await win.isFullscreen()) await win.setFullscreen(false);
    }
    _updateFsUI();
  });

  // ── Clear queue ────────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    state.playlist.forEach(item => {
      revokeItemSubs(item);
      if (item.url?.startsWith('blob:'))            URL.revokeObjectURL(item.url);
      if (item.audioMeta?.art?.startsWith('blob:')) URL.revokeObjectURL(item.audioMeta.art);
    });
    state.playlist        = [];
    state.currentIdx      = -1;
    state.selectedIndices = new Set();
    renderPlaylist();
    Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
    destroyEngines();
    video.src = '';
    resetPlayerUI();
    emptyState.style.opacity       = '1';
    emptyState.style.pointerEvents = '';
  });

  // ── Sidebar queue panel toggle ────────────────────────────────────────────────
  queueBtn.addEventListener('click', () => {
    const opening = !playlistPanel.classList.contains('open');
    playlistPanel.classList.toggle('open');
    queueBtn.classList.toggle('btn-active');
    if (opening) playlistPanel.style.width = state.panelW + 'px';
    else         playlistPanel.style.width = '';
  });

  // ── Sidebar resize ─────────────────────────────────────────────────────────────
  resizeHandle.addEventListener('mousedown', e => {
    if (!playlistPanel.classList.contains('open')) return;
    e.preventDefault();
    state.isResizing   = true;
    state.resizeStartX = e.clientX;
    state.resizeStartW = playlistPanel.offsetWidth;
    resizeHandle.classList.add('active');
    playlistPanel.classList.add('no-transition');
    document.body.style.cursor     = 'ew-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!state.isResizing) return;
    const delta = state.resizeStartX - e.clientX;
    const newW  = Math.max(150, Math.min(600, state.resizeStartW + delta));
    state.panelW              = newW;
    playlistPanel.style.width = newW + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!state.isResizing) return;
    state.isResizing = false;
    resizeHandle.classList.remove('active');
    playlistPanel.classList.remove('no-transition');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  });

  // ── Mobile long-press for 2× speed ────────────────────────────────────────────
  let _touchLPTimer = null, _touchLPActive = false;
  video.addEventListener('touchstart', e => {
    if (e.touches.length > 1) return;
    clearTimeout(_touchLPTimer);
    _touchLPActive = false;
    _touchLPTimer  = setTimeout(() => {
      _touchLPActive          = true;
      state.prevRate          = video.playbackRate;
      state.isTempSpeed       = true;
      video.playbackRate      = 2;
      tempBadge.style.display = 'block';
      notif('▶▶  2× Speed', 9999);
      if (video.paused) video.play();
    }, 400);
  }, { passive: true });

  const _handleTouchRelease = isCancelled => {
    clearTimeout(_touchLPTimer);
    if (state.isTempSpeed) {
      video.playbackRate      = state.prevRate;
      state.isTempSpeed       = false;
      tempBadge.style.display = 'none';
      notif(state.prevRate + '× Speed');
    } else if (!isCancelled && !_touchLPActive) {
      video.paused ? video.play() : video.pause();
    }
    _touchLPActive = false;
  };
  video.addEventListener('touchend',    () => _handleTouchRelease(false), { passive: true });
  video.addEventListener('touchcancel', () => _handleTouchRelease(true),  { passive: true });

  // ── Initial UI state ───────────────────────────────────────────────────────────
  _updateLoopBtn();
  fsQBtn.style.display = 'none';
  showControls();

  if (window.__TAURI__) {
    setTimeout(() => {
      window.__TAURI__.window.getCurrentWindow().show().catch(console.error);
    }, 50);
  }
}
