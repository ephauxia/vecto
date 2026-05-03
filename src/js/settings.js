// ── VECTO / settings.js ───────────────────────────────────────────────────────
// Round 0 persistence layer.
// Pure data — no DOM access, no notif(), no imports from other app modules.
// Every module that reads or writes localStorage goes through this file.
// Callers own any UI feedback (notif, syncUI, etc.) that follows a read/write.

// ── Storage key registry ──────────────────────────────────────────────────────
// All vecto_* keys defined in one place so there are no magic strings scattered
// across the codebase.
export const KEYS = {
  SUB_CFG:         'vecto_sub_cfg',
  HIST:            'vecto_hist',
  RESUME_PREFIX:   'vecto_r_',       // resume keys are RESUME_PREFIX + item.resumeKey
  HIST_COL_WIDTHS: 'vecto_hist_col_widths',
  SHORTCUT_PREFS:  'vecto_shortcut_prefs',
  // ── Round 2 ────────────────────────────────────────────────────────────────
  HIST_DAYS:       'vecto_hist_days',    // number 1–28; fallback: HIST_DAYS constant
  SC_BAR_HIDDEN:   'vecto_sc_bar_hidden',// boolean; true = shortcut bar hidden
  WINDOW_MEM:      'vecto_window_mem',   // boolean; true = remember window size (Tauri)
  CORS_MEM:        'vecto_cors_mem',     // boolean; true = remember CORS bypass state (Tauri)
  FONT_MEM:        'vecto_font_mem',     // boolean; true = remember subtitle font (Tauri)
};

// ── Generic get / set / remove ────────────────────────────────────────────────

/**
 * Read and JSON-parse a value from localStorage.
 * Returns null if the key is absent or the value is unparseable.
 */
export function getPref(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * JSON-stringify and write a value to localStorage.
 * Silently swallows QuotaExceededError.
 */
export function setPref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

/**
 * Remove a key from localStorage.
 */
export function removePref(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// ── Subtitle settings ─────────────────────────────────────────────────────────

/**
 * Default subtitle configuration.
 * Exported so subtitles.js can use it both for loading (filling missing keys)
 * and for restoring defaults without duplicating the object.
 * Note: `delay` is intentionally excluded — it is session-only and always
 * starts at 0 on load.
 */
export const SUB_DEFAULTS = {
  fontFamily: 'Roboto',
  fontName:   'Roboto',
  bold:       false,
  outline:    true,
  color:      '#ffffff',
  size:       100,
  bg:         true,
  bgOpacity:  30,
  vPos:       83,
};

/**
 * Load the saved subtitle config from localStorage.
 * Returns a partial or complete config object, or null if nothing is saved.
 * The caller (subtitles.js) is responsible for merging into state.subState.
 */
export function loadSubConfig() {
  return getPref(KEYS.SUB_CFG);
}

/**
 * Persist the subtitle config subset (SUB_DEFAULTS keys only) to localStorage.
 * Accepts the live subState object; only the persisted keys are written.
 * The caller is responsible for any UI feedback after this returns.
 */
export function saveSubConfig(subState) {
  const cfg = {};
  Object.keys(SUB_DEFAULTS).forEach(k => { cfg[k] = subState[k]; });
  setPref(KEYS.SUB_CFG, cfg);
}

// ── Playback history ──────────────────────────────────────────────────────────

export const HIST_DAYS = 5;    // fallback default; overridden at runtime by getHistDays()
export const HIST_MAX  = 500;  // hard cap on stored entries

/**
 * Return the effective history retention window in days.
 * Reads the user-set value from localStorage; falls back to HIST_DAYS constant.
 * Always call this at write time rather than caching the result, so changes
 * made in App Settings take effect on the next history write without a reload.
 */
export function getHistDays() {
  const v = getPref(KEYS.HIST_DAYS);
  return (typeof v === 'number' && v >= 1 && v <= 28) ? v : HIST_DAYS;
}

/**
 * Load the raw history array from localStorage.
 * Returns [] if absent or corrupt.
 */
export function loadHistRaw() {
  return getPref(KEYS.HIST) || [];
}

/**
 * Write the raw history array to localStorage.
 */
export function saveHistRaw(hist) {
  setPref(KEYS.HIST, hist);
}

// ── Resume position ───────────────────────────────────────────────────────────

/**
 * Persist the current playback position for an item.
 * Accepts currentTime and duration as arguments so this function stays
 * DOM-free — player.js passes video.currentTime and video.duration in.
 *
 * Position is NOT saved when:
 *   - the item has no resumeKey
 *   - duration is < 10 s (too short to be worth resuming)
 *   - position is within the first 5 s (treat as "not started")
 *   - position is past 95% (treat as "finished")
 */
export function savePosition(item, currentTime, duration) {
  if (!item || !item.resumeKey || !isFinite(duration) || duration < 10) return;
  const pos = currentTime;
  if (pos < 5 || pos > duration * 0.95) {
    removePref(KEYS.RESUME_PREFIX + item.resumeKey);
    return;
  }
  setPref(KEYS.RESUME_PREFIX + item.resumeKey, {
    p: Math.floor(pos),
    d: Math.floor(duration),
    title: item.title,
  });
}

/**
 * Return the saved position data for an item, or null if none exists or it
 * is too early in the file to be meaningful (p ≤ 5 s).
 */
export function getSaved(item) {
  if (!item || !item.resumeKey) return null;
  const d = getPref(KEYS.RESUME_PREFIX + item.resumeKey);
  return (d && d.p > 5) ? d : null;
}

/**
 * Delete the saved position for an item (called on playback end or "start over").
 */
export function clearSaved(item) {
  if (!item || !item.resumeKey) return;
  removePref(KEYS.RESUME_PREFIX + item.resumeKey);
}

// ── History column widths ─────────────────────────────────────────────────────

/**
 * Load the saved column width array for the history table.
 * Returns [] if absent.
 */
export function loadColWidths() {
  return getPref(KEYS.HIST_COL_WIDTHS) || [];
}

/**
 * Persist the column width array for the history table.
 */
export function saveColWidths(widths) {
  setPref(KEYS.HIST_COL_WIDTHS, widths);
}
