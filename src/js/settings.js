// ── VECTO / settings.js ───────────────────────────────────────────────────────
// Round 0 persistence layer.
// Pure data — no DOM access, no notif(), no imports from other app modules.
// Every module that reads or writes localStorage goes through this file.
// Callers own any UI feedback (notif, syncUI, etc.) that follows a read/write.

// ── Storage key registry ──────────────────────────────────────────────────────
export const KEYS = {
  SUB_CFG:         'vecto_sub_cfg',
  HIST:            'vecto_hist',
  RESUME_PREFIX:   'vecto_r_',
  HIST_COL_WIDTHS: 'vecto_hist_col_widths',
  SHORTCUT_PREFS:  'vecto_shortcut_prefs',
  // ── Round 2 ────────────────────────────────────────────────────────────────
  HIST_DAYS:       'vecto_hist_days',
  SC_BAR_HIDDEN:   'vecto_sc_bar_hidden',
  WINDOW_MEM:      'vecto_window_mem',
  CORS_MEM:        'vecto_cors_mem',
  CORS_STATE:      'vecto_cors_state',     // boolean; true = proxy was on last session
  CORS_WARN_SKIP:  'vecto_cors_warn_skip', // boolean; true = skip the warning modal
  FONT_MEM:        'vecto_font_mem',
};

// ── Generic get / set / remove ────────────────────────────────────────────────

export function getPref(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

export function removePref(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// ── Subtitle settings ─────────────────────────────────────────────────────────

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

export function loadSubConfig() {
  return getPref(KEYS.SUB_CFG);
}

export function saveSubConfig(subState) {
  const cfg = {};
  Object.keys(SUB_DEFAULTS).forEach(k => { cfg[k] = subState[k]; });
  setPref(KEYS.SUB_CFG, cfg);
}

// ── Playback history ──────────────────────────────────────────────────────────

export const HIST_DAYS = 5;
export const HIST_MAX  = 500;

/**
 * Return the effective history retention window in days.
 * Always call at write time — changes in App Settings take effect immediately.
 */
export function getHistDays() {
  const v = getPref(KEYS.HIST_DAYS);
  return (typeof v === 'number' && v >= 1 && v <= 28) ? v : HIST_DAYS;
}

export function loadHistRaw() {
  return getPref(KEYS.HIST) || [];
}

export function saveHistRaw(hist) {
  setPref(KEYS.HIST, hist);
}

// ── Resume position ───────────────────────────────────────────────────────────

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

export function getSaved(item) {
  if (!item || !item.resumeKey) return null;
  const d = getPref(KEYS.RESUME_PREFIX + item.resumeKey);
  return (d && d.p > 5) ? d : null;
}

export function clearSaved(item) {
  if (!item || !item.resumeKey) return;
  removePref(KEYS.RESUME_PREFIX + item.resumeKey);
}

// ── History column widths ─────────────────────────────────────────────────────

export function loadColWidths() {
  return getPref(KEYS.HIST_COL_WIDTHS) || [];
}

export function saveColWidths(widths) {
  setPref(KEYS.HIST_COL_WIDTHS, widths);
}
