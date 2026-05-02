// ── VECTO / ui.js ─────────────────────────────────────────────────────────────
// Notification display, panel close helper, and the modal manager.
// The modal manager is a Round 0 placeholder — stubs are wired up here so
// every module that will eventually call openModal/closeModal can import them
// now without modification later.

import { state } from './state.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const notifEl       = document.getElementById('notif');
const speedDialog   = document.getElementById('speed-dialog');
const speedMenu     = document.getElementById('speed-menu');
const settingsPanel = document.getElementById('settings-panel');
const subPanel      = document.getElementById('sub-panel');
const subSetPanel   = document.getElementById('sub-settings-panel');
const gearBtn       = document.getElementById('gear-btn');
const subBtn        = document.getElementById('sub-btn');

// ── Notification ──────────────────────────────────────────────────────────────

/**
 * Show a temporary notification pill over the player.
 * @param {string} msg  - Text to display.
 * @param {number} ms   - Duration in milliseconds (default 1600).
 */
export function notif(msg, ms = 1600) {
  notifEl.textContent = msg;
  notifEl.classList.add('show');
  clearTimeout(state.notifTimer);
  state.notifTimer = setTimeout(() => notifEl.classList.remove('show'), ms);
}

// ── Panel helpers ─────────────────────────────────────────────────────────────

/**
 * Close every floating panel popup (speed dialog, speed quick-menu, settings,
 * subtitle list, subtitle settings). Called before opening any panel so only
 * one is ever visible at a time.
 */
export function closeAllPanels() {
  speedDialog.classList.remove('open');
  speedMenu.classList.remove('open');
  settingsPanel.classList.remove('open');
  subPanel.classList.remove('open');
  subSetPanel.classList.remove('open');
  gearBtn.classList.remove('active-ctrl');
  subBtn.classList.remove('active-ctrl');
}

// ── Modal Manager ─────────────────────────────────────────────────────────────
// Round 0 placeholder.
//
// The full implementation will support modal stacking so that a child modal
// opened from within a parent (e.g. Help opened from CORS Warning, Help opened
// from Telegram Auth) can be closed without destroying the parent's state or
// unsaved input.
//
// Modal pairs that depend on this behaviour:
//   CORS Warning Modal  → Help Modal (CORS section)
//   Telegram Auth Modal → Help Modal (Telegram Instructions section)
//
// Planned public API:
//   modalManager.open(id, options)   — push a modal onto the stack and show it
//   modalManager.close(id)           — pop the top modal; restore parent if any
//   modalManager.closeAll()          — clear the entire stack
//   modalManager.getCurrent()        — return the id of the topmost open modal
//
// The options object will support:
//   { onClose: fn }                  — callback fired when this modal is closed
//   { scrollTo: sectionId }          — scroll to a named section on open
//                                      (used by Help links in other modals)

export const modalManager = {
  _stack: [],

  open(id, options = {}) {
    // TODO: Round 0 — show modal element, push { id, options } onto _stack
  },

  close(id) {
    // TODO: Round 0 — hide modal element, pop from _stack, restore parent
  },

  closeAll() {
    // TODO: Round 0 — close every stacked modal in reverse order
  },

  getCurrent() {
    return this._stack.length ? this._stack[this._stack.length - 1].id : null;
  },
};
