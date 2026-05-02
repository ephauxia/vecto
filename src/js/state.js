// ── VECTO / state.js ──────────────────────────────────────────────────────────
// Shared mutable application state.
// No imports from other app modules — this is the base layer everything else
// builds on. player.js, queue.js, history.js, subtitles.js and ui.js all
// import from here; nothing here imports from them.

// ── Core playback state ───────────────────────────────────────────────────────
export const state = {
  // Playlist & playback
  playlist:    [],
  currentIdx:  -1,
  hlsInst:     null,
  dashInst:    null,
  loopMode:    'normal', // 'normal' | 'loop-all' | 'loop-one' | 'stop'

  // History
  historyPaused: false,

  // Fullscreen
  isWFS:              false,
  wasWFSBeforeTrueFS: false,

  // Temporary speed (hold-space / long-press)
  spaceDown:    false,
  lpTimer:      null,
  lpActivated:  false,
  prevRate:     1,
  isTempSpeed:  false,

  // Controls auto-hide timer
  ctrlTimer: null,

  // Progress bar drag
  isDraggingProg: false,

  // Notification dismiss timer
  notifTimer: null,

  // Sidebar resize
  isResizing:   false,
  resizeStartX: 0,
  resizeStartW: 0,
  panelW:       268,

  // Fullscreen queue overlay
  fsQueueVisible: false,

  // Queue drag-to-reorder
  dragSrcIdx: null,

  // Queue multi-select
  selectedIndices: new Set(),

  // Subtitle state
  subState: {
    enabled:            true,
    selectedTrackIndex: 0,
    fontFamily:         'Roboto',
    fontName:           'Roboto',
    bold:               false,
    outline:            true,
    color:              '#ffffff',
    size:               100,
    bg:                 true,
    bgOpacity:          30,
    delay:              0,   // ms — positive = delay subs, negative = advance subs
    vPos:               83,  // % from top; 83 keeps subs above the controls bar
  },

  // WeakMap of cue → { start, end } originals before delay is applied
  cueOriginalTimes: new WeakMap(),
};

// ── Loop mode constants ───────────────────────────────────────────────────────
export const LOOP_CYCLE = ['normal', 'loop-all', 'loop-one', 'stop'];
export const LOOP_ICON  = {
  normal:     '⇥',
  'loop-all': '↺',
  'loop-one': '↺¹',
  stop:       '◼',
};
export const LOOP_TITLE = {
  normal:     'Loop: Off (R)',
  'loop-all': 'Loop: All (R)',
  'loop-one': 'Loop: One (R)',
  stop:       'Stop after current (R)',
};

// ── Pure utility helpers ──────────────────────────────────────────────────────
// These have no DOM access and no side effects. Every module may import them.

/**
 * Format seconds as m:ss or h:mm:ss.
 */
export function fmt(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.floor(s);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Escape HTML special characters for safe DOM insertion.
 */
export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * FNV-32a hash — produces short, stable localStorage keys regardless of
 * URL or filename length.
 */
export function hashKey(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h  = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}
