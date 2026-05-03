// ── VECTO / appsettings.js ────────────────────────────────────────────────────
// App Settings modal — opened via the gear icon at the far-right of the header.
//
// Fully working this round:
//   • History retention days (overrides the HIST_DAYS constant at runtime)
//   • Shortcut bar show/hide
//
// Pref-save only this round (wired in later rounds):
//   • Remember window size   (Round 3 — Rust restart modal)
//   • Remember CORS state    (Round 2 CORS proxy — separate session)
//   • Remember subtitle font (Round 2 font overhaul — separate session)
//
// Exports: initAppSettings, openAppSettings, closeAppSettings, isAppSettingsOpen

import { getPref, setPref, KEYS, HIST_DAYS } from './settings.js';
import { notif }                               from './ui.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const overlay       = document.getElementById('app-settings-overlay');
const modal         = document.getElementById('app-settings-modal');
const closeBtn      = document.getElementById('as-close-btn');
const appGearBtn    = document.getElementById('app-gear-btn');
const histDaysInput = document.getElementById('as-hist-days');
const scBarToggle   = document.getElementById('as-sc-bar-toggle');
const windowMemTgl  = document.getElementById('as-window-mem-toggle');
const corsMemTgl    = document.getElementById('as-cors-mem-toggle');
const fontMemTgl    = document.getElementById('as-font-mem-toggle');
const shortcutBar   = document.getElementById('shortcut-bar');

// ── Module-local state ────────────────────────────────────────────────────────
let _mouseDownOnOverlay = false;

// ── Populate controls from saved prefs ───────────────────────────────────────
function _loadIntoUI() {
  const days = getPref(KEYS.HIST_DAYS);
  histDaysInput.value = (typeof days === 'number' && days >= 1 && days <= 28) ? days : HIST_DAYS;

  scBarToggle.checked = getPref(KEYS.SC_BAR_HIDDEN) !== true;

  if (window.__TAURI__) {
    windowMemTgl.checked = getPref(KEYS.WINDOW_MEM) !== false; // default on
    corsMemTgl.checked   = getPref(KEYS.CORS_MEM)   === true;  // default off
    fontMemTgl.checked   = getPref(KEYS.FONT_MEM)   !== false; // default on
  }
}

// ── Modal open / close ────────────────────────────────────────────────────────
export function openAppSettings() {
  _loadIntoUI();
  overlay.classList.add('open');
}

export function closeAppSettings() {
  overlay.classList.remove('open');
}

export function isAppSettingsOpen() {
  return overlay.classList.contains('open');
}

// ── Module init ───────────────────────────────────────────────────────────────
export function initAppSettings() {
  // Hide the entire DESKTOP section in web mode
  if (!window.__TAURI__) {
    document.querySelectorAll('.as-tauri-only').forEach(el => { el.style.display = 'none'; });
  }

  // Gear button → open modal
  appGearBtn.addEventListener('click', openAppSettings);

  // Close: button + backdrop click (only if mousedown also started on overlay)
  closeBtn.addEventListener('click', closeAppSettings);
  overlay.addEventListener('mousedown', e => {
    _mouseDownOnOverlay = (e.target === overlay);
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay && _mouseDownOnOverlay) closeAppSettings();
    _mouseDownOnOverlay = false;
  });

  // Suppress browser context menu inside the modal
  modal.addEventListener('contextmenu', e => e.preventDefault());

  // ── History retention days ────────────────────────────────────────────────────
  histDaysInput.addEventListener('change', () => {
    let v = parseInt(histDaysInput.value, 10);
    if (isNaN(v) || v < 1)  v = 1;
    if (v > 28)              v = 28;
    histDaysInput.value = v;
    setPref(KEYS.HIST_DAYS, v);
    notif('History: keep ' + v + ' day' + (v === 1 ? '' : 's'));
  });
  // Prevent the number input's arrow keys from firing video seek shortcuts
  histDaysInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') histDaysInput.blur();
    e.stopPropagation();
  });

  // ── Shortcut bar visibility ───────────────────────────────────────────────────
  scBarToggle.addEventListener('change', () => {
    const visible = scBarToggle.checked;
    setPref(KEYS.SC_BAR_HIDDEN, !visible);
    shortcutBar.classList.toggle('sc-force-hidden', !visible);
    if (!visible) notif('Shortcuts available in Help  (?  button)');
  });

  // ── Tauri-only: pref-save now, runtime wiring in later rounds ────────────────
  if (window.__TAURI__) {
    windowMemTgl.addEventListener('change', () => {
      setPref(KEYS.WINDOW_MEM, windowMemTgl.checked);
      notif(windowMemTgl.checked ? 'Window size: will be remembered' : 'Window size: reset each launch');
    });
    corsMemTgl.addEventListener('change', () => {
      setPref(KEYS.CORS_MEM, corsMemTgl.checked);
    });
    fontMemTgl.addEventListener('change', () => {
      setPref(KEYS.FONT_MEM, fontMemTgl.checked);
    });
  }

  // ── Apply shortcut bar pref on boot ──────────────────────────────────────────
  if (getPref(KEYS.SC_BAR_HIDDEN) === true) {
    shortcutBar.classList.add('sc-force-hidden');
  }
}
