// ── VECTO / subtitles.js ──────────────────────────────────────────────────────
// Subtitle parsing (SRT / VTT / ASS / SSA → WebVTT), track management,
// style rendering, cue layout (position + delay), and settings UI.
//
// Exports: convertSubsToVtt, attachSubtitleToCurrentItem, loadItemSubtitles,
//          setSubEnabled, initSubtitles

import { state, escHtml }              from './state.js';
import { notif, closeAllPanels }       from './ui.js';
import { loadSubConfig, saveSubConfig,
         SUB_DEFAULTS }                from './settings.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video          = document.getElementById('video');
const dynSubStyles   = document.getElementById('dynamic-sub-styles');
const subPanel       = document.getElementById('sub-panel');
const subList        = document.getElementById('sub-list');
const subMasterToggle= document.getElementById('sub-master-toggle');
const addSubBtn      = document.getElementById('add-sub-btn');
const localSubInput  = document.getElementById('local-sub-input');
const subBtn         = document.getElementById('sub-btn');
const subClose       = document.getElementById('sub-close');
const subGearBtn     = document.getElementById('sub-gear-btn');
const subSetPanel    = document.getElementById('sub-settings-panel');
const subSetClose    = document.getElementById('sub-settings-close');
const subBackBtn     = document.getElementById('sub-back-btn');
const subSaveBtn     = document.getElementById('sub-save-btn');
const subResetBtn    = document.getElementById('sub-reset-btn');
const sBoldTgl       = document.getElementById('sub-bold-toggle');
const sOutTgl        = document.getElementById('sub-outline-toggle');
const sBgTgl         = document.getElementById('sub-bg-toggle');
const sColors        = document.getElementById('sub-color-presets');
const sSizeSld       = document.getElementById('sub-size-slider');
const sSizeVal       = document.getElementById('sub-size-val');
const sBgOpSld       = document.getElementById('sub-bg-op-slider');
const sBgOpVal       = document.getElementById('sub-bg-op-val');
const syncInput      = document.getElementById('sync-input');
const syncSlider     = document.getElementById('sync-slider');
const syncHeard      = document.getElementById('sync-heard');
const syncSaw        = document.getElementById('sync-saw');
const sFontBtn       = document.getElementById('sub-font-btn');
const sFontInput     = document.getElementById('sub-font-input');

// ── Style rendering ───────────────────────────────────────────────────────────

function renderSubStyles() {
  const s = state.subState;
  const outline = s.outline
    ? `text-shadow: 1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000;`
    : `text-shadow: none;`;
  const bg = s.bg
    ? `background-color: rgba(0,0,0,${s.bgOpacity / 100});`
    : `background-color: rgba(0,0,0,0);`;
  dynSubStyles.textContent = `
    ::cue {
      font-family: "${s.fontFamily}", sans-serif !important;
      font-size: ${s.size}% !important;
      font-weight: ${s.bold ? 'bold' : 'normal'} !important;
      color: ${s.color} !important;
      ${bg}
      ${outline}
    }
  `;
}

// ── Cue layout (position + delay) ─────────────────────────────────────────────

function applySubLayout() {
  const tracks    = Array.from(video.textTracks).filter(t => t.mode === 'showing');
  const offsetSec = state.subState.delay / 1000;
  tracks.forEach(t => {
    if (!t.cues) return;
    Array.from(t.cues).forEach(cue => {
      // Record original times once — before any delay mutation
      if (!state.cueOriginalTimes.has(cue)) {
        state.cueOriginalTimes.set(cue, { start: cue.startTime, end: cue.endTime });
      }
      const orig     = state.cueOriginalTimes.get(cue);
      cue.startTime  = Math.max(0, orig.start + offsetSec);
      cue.endTime    = Math.max(0.001, orig.end + offsetSec);
      // snapToLines:false → `line` is a percentage from the top (0–100)
      cue.snapToLines = false;
      cue.line        = state.subState.vPos;
      cue.lineAlign   = 'end';
    });
  });
}

// ── Track visibility ──────────────────────────────────────────────────────────

function updateSubTracksVisibility() {
  const tracks = Array.from(video.textTracks)
    .filter(t => t.kind === 'subtitles' || t.kind === 'captions');
  tracks.forEach((t, i) => {
    t.mode = (state.subState.enabled && i === state.subState.selectedTrackIndex)
      ? 'showing'
      : 'hidden';
  });
  setTimeout(applySubLayout, 30);
  populateSubtitlesList();
}

export function setSubEnabled(enabled) {
  state.subState.enabled  = enabled;
  subMasterToggle.checked = enabled;
  updateSubTracksVisibility();
}

// ── Track loading (called by player.js on every playIndex) ────────────────────

/**
 * Remove all existing <track> elements from the video, then inject the
 * subtitle blobs stored on the playlist item.
 * Clamps selectedTrackIndex so it never points past the end of the new list.
 */
export function loadItemSubtitles(item) {
  Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
  if (!item.subtitles) return;
  item.subtitles.forEach(sub => {
    const track    = document.createElement('track');
    track.kind     = 'subtitles';
    track.label    = sub.label;
    track.srclang  = sub.srclang;
    track.src      = sub.src;
    video.appendChild(track);
  });
  const count = (item.subtitles || []).length;
  state.subState.selectedTrackIndex = Math.min(
    state.subState.selectedTrackIndex,
    Math.max(0, count - 1)
  );
}

// ── Subtitle list UI ──────────────────────────────────────────────────────────

function populateSubtitlesList() {
  subList.innerHTML = '';
  const tracks = Array.from(video.textTracks)
    .filter(t => t.kind === 'subtitles' || t.kind === 'captions');

  if (tracks.length === 0) {
    const d = document.createElement('div');
    d.className   = 'sp-empty';
    d.textContent = 'No subtitles available';
    subList.appendChild(d);
    return;
  }

  tracks.forEach((t, i) => {
    const btn       = document.createElement('button');
    const isSel     = state.subState.selectedTrackIndex === i;
    btn.className   = 'sp-opt' + (isSel ? ' sel' : '');
    btn.innerHTML   = `<span class="sp-dot">${isSel ? '●' : '○'}</span>${escHtml(t.label || t.language || `Track ${i + 1}`)}`;
    btn.addEventListener('click', () => {
      state.subState.selectedTrackIndex = i;
      if (!state.subState.enabled) {
        state.subState.enabled  = true;
        subMasterToggle.checked = true;
      }
      updateSubTracksVisibility();
    });
    subList.appendChild(btn);
  });
}

function toggleSubPanel() {
  const isOpen = subPanel.classList.contains('open');
  closeAllPanels();
  if (!isOpen) {
    subPanel.classList.add('open');
    subBtn.classList.add('active-ctrl');
    populateSubtitlesList();
  }
}

// ── Settings UI sync ──────────────────────────────────────────────────────────

function syncSubUI() {
  const s = state.subState;
  sBoldTgl.checked    = s.bold;
  sOutTgl.checked     = s.outline;
  sBgTgl.checked      = s.bg;

  const bgLabel = document.getElementById('sub-bg-op-label');
  if (bgLabel) bgLabel.style.opacity = s.bg ? '1' : '0.4';
  sBgOpSld.disabled   = !s.bg;

  sSizeSld.value      = s.size;
  sSizeVal.textContent= s.size + '%';
  sBgOpSld.value      = s.bgOpacity;
  sBgOpVal.textContent= s.bgOpacity + '%';

  syncSlider.value    = s.delay;
  syncInput.value     = (s.delay / 1000).toFixed(1) + 's';

  const vPosSld = document.getElementById('sub-vpos-slider');
  const vPosVal = document.getElementById('sub-vpos-val');
  if (vPosSld) vPosSld.value = s.vPos;
  if (vPosVal) vPosVal.textContent = Math.round(100 - s.vPos) + '% from bottom';

  Array.from(sColors.children).forEach(b => {
    b.classList.toggle('sel', b.dataset.color === s.color);
  });
  sFontBtn.textContent = s.fontName;

  renderSubStyles();
}

// ── Settings persistence ──────────────────────────────────────────────────────

function saveSubSettings() {
  saveSubConfig(state.subState);
  notif('Subtitle settings saved');
}

function restoreSubDefaults() {
  Object.assign(state.subState, { ...SUB_DEFAULTS, delay: 0 });
  syncSubUI();
  renderSubStyles();
  notif('Subtitle settings reset');
}

function loadSubSettings() {
  const cfg = loadSubConfig();
  if (cfg) {
    Object.keys(SUB_DEFAULTS).forEach(k => {
      if (cfg[k] !== undefined) state.subState[k] = cfg[k];
    });
  }
}

// ── Delay controls ────────────────────────────────────────────────────────────

function setDelay(ms) {
  state.subState.delay = Math.max(-25000, Math.min(25000, ms));
  applySubLayout();
  syncSubUI();
}

// ── Subtitle file attachment ──────────────────────────────────────────────────

/**
 * Push a subtitle blob URL onto the current playlist item and reload all
 * tracks for that item. Auto-selects the newly added track.
 * Called by main.js file-drop and Tauri path handlers.
 */
export function attachSubtitleToCurrentItem(label, srclang, blobUrl) {
  if (state.currentIdx < 0 || !state.playlist[state.currentIdx]) {
    notif('No video loaded');
    URL.revokeObjectURL(blobUrl);
    return;
  }
  const item = state.playlist[state.currentIdx];
  if (!item.subtitles) item.subtitles = [];
  item.subtitles.push({ label, srclang, src: blobUrl });
  loadItemSubtitles(item);
  setTimeout(() => {
    const tracks = Array.from(video.textTracks)
      .filter(t => t.kind === 'subtitles' || t.kind === 'captions');
    state.subState.selectedTrackIndex = tracks.length - 1;
    setSubEnabled(true);
    notif('Subtitle added');
  }, 80);
}

// ── Format conversion: any subtitle format → WebVTT ──────────────────────────

/**
 * Convert SRT, ASS, or SSA text to WebVTT.
 * Already-valid VTT is returned unchanged.
 *
 * Known limitations:
 *   - SRT: <font> tags are passed through (not valid in WebVTT but browsers
 *     ignore them gracefully rather than breaking)
 *   - ASS: complex karaoke / animated effects are stripped entirely
 */
export function convertSubsToVtt(text, filename) {
  text = text.trim();

  // ── Already WebVTT ──────────────────────────────────────────────────────────
  if (text.startsWith('WEBVTT')) return text;

  // ── SRT ─────────────────────────────────────────────────────────────────────
  // Detect: a cue counter line (digits only) followed by a timestamp line.
  // The timestamp may or may not include the hours component:
  //   standard:   00:01:23,456 --> 00:01:25,789
  //   no-hours:      01:23,456 --> 01:25,789
  if (text.match(/^\d+\r?\n\d{2}:\d{2}[,:]\d{3}/m)) {
    return 'WEBVTT\n\n' + text
      // Normalise all line endings to \n
      .replace(/\r\n|\r/g, '\n')
      // Convert SRT comma separator to WebVTT dot separator
      // Handles both hh:mm:ss,mmm and mm:ss,mmm forms
      .replace(/(\d{2}:\d{2}(?::\d{2})?)(?:,)(\d{3})/g, '$1.$2');
  }

  // ── ASS / SSA ───────────────────────────────────────────────────────────────
  if (text.includes('[Events]')) {
    // Normalise line endings before anything else
    const lines = text.replace(/\r\n|\r/g, '\n').split('\n');

    // Locate the Format: line inside [Events] to find the Text column index.
    // The ASS spec defines a fixed order (Layer, Start, End, Style, Name,
    // MarginL, MarginR, MarginV, Effect, Text) but we read it dynamically
    // rather than assuming the index, in case a non-standard encoder reorders.
    let textIdx = 9; // default: Text is the 10th field (index 9)
    const eventsStart = lines.findIndex(l => l.trim() === '[Events]');
    if (eventsStart !== -1) {
      const fmtLine = lines.slice(eventsStart).find(l => l.startsWith('Format:'));
      if (fmtLine) {
        const fields = fmtLine.substring(7).split(',').map(f => f.trim());
        const idx    = fields.indexOf('Text');
        if (idx !== -1) textIdx = idx;
      }
    }

    // Convert ASS centisecond timestamps (H:MM:SS.cc) to WebVTT milliseconds
    // (HH:MM:SS.mmm).
    //
    // fixTime('0:01:23.45') → '00:01:23.450'
    //
    // Bug fixed vs original: (cs + '0').substring(0,3) produced only 2 chars
    // for single-digit centisecond strings. Using (cs + '00').substring(0,3)
    // is safe for 1-, 2-, and 3-digit inputs.
    const fixTime = t => {
      const [hms, cs = '00'] = t.split('.');
      const ms  = (cs + '00').substring(0, 3);  // centiseconds → milliseconds
      const [h, m, s] = hms.split(':');
      return `${h.padStart(2, '0')}:${m}:${s}.${ms}`;
    };

    let vtt = 'WEBVTT\n\n';

    for (const line of lines) {
      if (!line.startsWith('Dialogue:')) continue;

      // Split on commas, then rejoin the Text part (it may itself contain commas)
      const parts    = line.substring(9).trim().split(',');
      const textPart = parts.slice(textIdx).join(',');

      // Skip drawing commands:
      //   {\\p1}–{\\p9}  start a drawing layer
      //   {\\p0}          resets drawing mode — also safe to skip as standalone
      if (textPart.match(/\{\\[pP][0-9]\}/)) continue;

      const start = parts[1].trim();
      const end   = parts[2].trim();

      const cleanText = textPart
        // Strip all override tags: {\an8}, {\pos(...)}, etc.
        .replace(/\{[^}]*\}/g, '')
        // Soft line break tags
        .replace(/\\[Nn]/g, '\n')
        // Non-breaking space tag
        .replace(/\\h/g, ' ')
        .trim();

      if (cleanText) {
        vtt += `${fixTime(start)} --> ${fixTime(end)}\n${cleanText}\n\n`;
      }
    }

    return vtt;
  }

  // ── Unrecognised format ─────────────────────────────────────────────────────
  // Return as-is with a WEBVTT header and let the browser try to parse it.
  // This handles obscure VTT variants that lack the WEBVTT header line.
  return 'WEBVTT\n\n' + text;
}

// ── Module initialisation ─────────────────────────────────────────────────────

/**
 * Wire up all subtitle event listeners and load persisted settings.
 * Called once from main.js during app startup.
 */
export function initSubtitles() {
  // Load saved settings into state before rendering anything
  loadSubSettings();
  syncSubUI();

  // Periodic cue layout pass — catches cues that load asynchronously after
  // the track is already showing (common with HLS streams and some browsers)
  setInterval(() => {
    if (state.subState.enabled) applySubLayout();
  }, 1000);

  // Master on/off toggle
  subMasterToggle.addEventListener('change', () => setSubEnabled(subMasterToggle.checked));

  // New track added to the video element (HLS / DASH can add tracks mid-stream)
  video.textTracks.addEventListener('addtrack', e => {
    populateSubtitlesList();
    if (e.track) e.track.addEventListener('cuechange', applySubLayout);
  });

  // Panel open/close
  subBtn.addEventListener('click', e => { toggleSubPanel(); e.stopPropagation(); });
  subClose.addEventListener('click', closeAllPanels);

  // Navigate to subtitle settings panel and back
  subGearBtn.addEventListener('click', e => {
    subPanel.classList.remove('open');
    subSetPanel.classList.add('open');
    e.stopPropagation();
  });
  subBackBtn.addEventListener('click', e => {
    subSetPanel.classList.remove('open');
    subPanel.classList.add('open');
    e.stopPropagation();
  });
  subSetClose.addEventListener('click', closeAllPanels);

  // Save / restore defaults buttons
  subSaveBtn.addEventListener('click',  e => { saveSubSettings();    e.stopPropagation(); });
  subResetBtn.addEventListener('click', e => { restoreSubDefaults(); e.stopPropagation(); });

  // Style controls
  sBoldTgl.addEventListener('change', e => { state.subState.bold      = e.target.checked; syncSubUI(); });
  sOutTgl.addEventListener('change',  e => { state.subState.outline   = e.target.checked; syncSubUI(); });
  sBgTgl.addEventListener('change',   e => { state.subState.bg        = e.target.checked; syncSubUI(); });
  sSizeSld.addEventListener('input',  e => { state.subState.size      = e.target.value;   syncSubUI(); });
  sBgOpSld.addEventListener('input',  e => { state.subState.bgOpacity = e.target.value;   syncSubUI(); });

  sColors.addEventListener('click', e => {
    if (e.target.classList.contains('cp-btn')) {
      state.subState.color = e.target.dataset.color;
      syncSubUI();
    }
  });

  // Custom font loader
  sFontBtn.addEventListener('click', () => sFontInput.click());
  sFontInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const url        = URL.createObjectURL(file);
    const fontNameId = 'SubFont_' + Date.now();
    new FontFace(fontNameId, `url(${url})`).load()
      .then(loaded => {
        document.fonts.add(loaded);
        state.subState.fontFamily = fontNameId;
        state.subState.fontName   = file.name.replace(/\.[^/.]+$/, '').substring(0, 15);
        syncSubUI();
      })
      .catch(() => notif('Invalid font file'));
    e.target.value = '';
  });

  // Delay controls
  syncSlider.addEventListener('input',  e => setDelay(parseInt(e.target.value)));
  syncHeard.addEventListener('click',   () => setDelay(state.subState.delay - 100));
  syncSaw.addEventListener('click',     () => setDelay(state.subState.delay + 100));
  syncInput.addEventListener('change',  e => {
    const val = parseFloat(e.target.value.replace(/[^-\d.]/g, ''));
    if (!isNaN(val)) setDelay(val * 1000);
    else syncSubUI();
  });
  syncInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') syncInput.blur();
    e.stopPropagation(); // prevent keyboard shortcuts from firing
  });

  // Vertical position slider (delegated — the element is inside a dynamic panel)
  document.addEventListener('input', e => {
    if (e.target.id === 'sub-vpos-slider') {
      state.subState.vPos = parseInt(e.target.value);
      applySubLayout();
      syncSubUI();
    }
  });

  // Local subtitle file picker
  addSubBtn.addEventListener('click', () => localSubInput.click());
  localSubInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const vttText = convertSubsToVtt(await file.text(), file.name);
      const blobUrl = URL.createObjectURL(new Blob([vttText], { type: 'text/vtt' }));
      attachSubtitleToCurrentItem(file.name.replace(/\.[^/.]+$/, ''), 'en', blobUrl);
    } catch (err) {
      notif('Error parsing subtitle file');
    }
  });
}
