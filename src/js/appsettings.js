// ── VECTO / appsettings.js ────────────────────────────────────────────────────
// App Settings modal — opened via the ⚙ icon at the far-right of the header.
//
// Fully wired this round:
//   • History retention days  (getHistDays() reads this at every history write)
//   • Shortcut bar show/hide
//   • Tauri-only session prefs: window size, CORS memory, subtitle font memory
//
// Exports: initAppSettings, openAppSettings, closeAppSettings, isAppSettingsOpen

import { getPref, setPref, removePref, KEYS, HIST_DAYS } from './settings.js';
import { notif, modalManager }                             from './ui.js';
import { toggleCors, isCorsEnabled } from './cors.js';
import { openHelpModal }              from './help.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const overlay       = document.getElementById('app-settings-overlay');
const modal         = document.getElementById('app-settings-modal');
const closeBtn      = document.getElementById('as-close-btn');
const appGearBtn    = document.getElementById('app-gear-btn');
const histDaysInput = document.getElementById('as-hist-days');
const scBarToggle   = document.getElementById('as-sc-bar-toggle');
const corsMemTgl    = document.getElementById('as-cors-mem-toggle');
const fontMemTgl    = document.getElementById('as-font-mem-toggle');
const shortcutBar   = document.getElementById('shortcut-bar');
const corsToggleEl  = document.getElementById('as-cors-toggle');
const corsMemTgl    = document.getElementById('as-cors-mem-toggle');
const corsHelpBtn   = document.getElementById('as-cors-help-btn');

// ── Populate controls from saved prefs ───────────────────────────────────────
function _loadIntoUI() {
  const days = getPref(KEYS.HIST_DAYS);
  histDaysInput.value = (typeof days === 'number' && days >= 1 && days <= 28)
    ? days : HIST_DAYS;

  scBarToggle.checked = getPref(KEYS.SC_BAR_HIDDEN) !== true;

  if (window.__TAURI__) {
    corsToggleEl.checked   = isCorsEnabled();
    corsMemTgl.checked     = getPref(KEYS.CORS_MEM) === true;
    fontMemTgl.checked   = getPref(KEYS.FONT_MEM)   !== false; // default on
  }
}

// ── Modal open / close ────────────────────────────────────────────────────────
export function openAppSettings() {
  _loadIntoUI();
  modalManager.open('app-settings-overlay');
}

export function closeAppSettings() {
  modalManager.close('app-settings-overlay');
}

export function isAppSettingsOpen() {
  return modalManager.isOpen('app-settings-overlay');
}

// ── Module init ───────────────────────────────────────────────────────────────
export function initAppSettings() {
  if (!window.__TAURI__) {
    document.querySelectorAll('.as-tauri-only').forEach(el => { el.style.display = 'none'; });
  }

  appGearBtn.addEventListener('click', openAppSettings);
  closeBtn.addEventListener('click', closeAppSettings);

  // Backdrop click
  let _mdOnOverlay = false;
  overlay.addEventListener('mousedown', e => { _mdOnOverlay = (e.target === overlay); });
  overlay.addEventListener('click', e => {
    if (e.target === overlay && _mdOnOverlay) closeAppSettings();
    _mdOnOverlay = false;
  });

  modal.addEventListener('contextmenu', e => e.preventDefault());

  // ── History retention days ────────────────────────────────────────────────────
  histDaysInput.addEventListener('change', () => {
    let v = parseInt(histDaysInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 28)             v = 28;
    histDaysInput.value = v;
    setPref(KEYS.HIST_DAYS, v);
    notif('History: keep ' + v + ' day' + (v === 1 ? '' : 's'));
  });
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

  // ── Tauri-only session prefs ──────────────────────────────────────────────────
  if (window.__TAURI__) {

    corsToggleEl.addEventListener('change', async () => {
      // Defer to cors.js — it handles the warning modal and all state.
      // If the user cancels the warning, cors.js reverts the checkbox itself.
      await toggleCors();
    });

    corsHelpBtn.addEventListener('click', () => openHelpModal('cors'));

    corsMemTgl.addEventListener('change', () => {
      setPref(KEYS.CORS_MEM, corsMemTgl.checked);
      if (corsMemTgl.checked && isCorsEnabled()) {
        // CORS is already running — write the state now so boot restore
        // works if the window is closed before CORS is toggled again.
        setPref(KEYS.CORS_STATE, true);
      } else if (!corsMemTgl.checked) {
        removePref(KEYS.CORS_STATE);
      }
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
