// ── VECTO / ui.js ─────────────────────────────────────────────────────────────
// Notification display, panel close helper, and the modal manager.

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
//
// Manages a stack of open modals so that a child modal opened from within a
// parent (e.g. Help opened from CORS Warning, Help opened from Telegram Auth)
// can be closed without destroying the parent's state or unsaved input.
//
// Stack semantics
// ───────────────
// open(id)  → pushes the modal onto the stack and shows it. The parent modal's
//             DOM element is left untouched — it stays visible underneath.
// close(id) → removes that entry from the stack by id and hides its element.
//             Every other modal in the stack — including any parent — remains
//             exactly as it was.
// closeAll  → tears down the stack in reverse open order.
//
// Options
// ───────
// onClose  {Function} — fired synchronously after the element is hidden and
//                       the entry is removed from the stack.
// scrollTo {string}   — a data-section attribute value or bare element id to
//                       smooth-scroll to after the modal is shown. Used by
//                       Help links inside other modals to land on the right
//                       section without a separate navigate step.
//
// Modal pairs that depend on stacking
// ────────────────────────────────────
//   CORS Warning Modal  → Help Modal (CORS section)
//   Telegram Auth Modal → Help Modal (Telegram Instructions section)
//
// Public API
// ──────────
//   modalManager.open(id, options)   open a modal; push onto stack
//   modalManager.close(id)           close a specific modal by id
//   modalManager.closeAll()          close all open modals
//   modalManager.getCurrent()        id of the topmost open modal, or null
//   modalManager.isOpen(id)          true if the named modal is in the stack

export const modalManager = {
  _stack: /** @type {{ id: string, options: Object }[]} */ ([]),

  /**
   * Open a modal and push it onto the stack.
   *
   * No-ops if the modal is already in the stack — prevents double-push from
   * rapid clicks or keyboard shortcuts.
   *
   * @param {string} id
   * @param {{ onClose?: Function, scrollTo?: string }} [options]
   */
  open(id, options = {}) {
    if (this._stack.some(e => e.id === id)) return;
    const el = document.getElementById(id);
    if (!el) return;

    this._stack.push({ id, options });
    el.classList.add('open');

    // Scroll to a named section after the browser has painted the modal.
    // Callers use data-section="<name>" on section wrapper elements; a plain
    // id also works as a fallback.
    if (options.scrollTo) {
      requestAnimationFrame(() => {
        const target =
          el.querySelector(`[data-section="${options.scrollTo}"]`) ??
          el.querySelector(`#${options.scrollTo}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  },

  /**
   * Close a specific modal by id.
   *
   * Removes the entry from the stack (regardless of position) and hides the
   * element. All other stacked modals — including any parent — are unaffected.
   * Fires the onClose callback if one was registered.
   *
   * @param {string} id
   */
  close(id) {
    const idx = this._stack.findIndex(e => e.id === id);
    if (idx === -1) return;

    const { options } = this._stack[idx];
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
    this._stack.splice(idx, 1);

    if (typeof options.onClose === 'function') options.onClose();
  },

  /**
   * Close all open modals in reverse open order (top-most first).
   * Fires each modal's onClose callback.
   */
  closeAll() {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      const { id, options } = this._stack[i];
      const el = document.getElementById(id);
      if (el) el.classList.remove('open');
      if (typeof options.onClose === 'function') options.onClose();
    }
    this._stack = [];
  },

  /**
   * Return the id of the topmost open modal, or null if the stack is empty.
   * @returns {string|null}
   */
  getCurrent() {
    return this._stack.length ? this._stack[this._stack.length - 1].id : null;
  },

  /**
   * Return true if the named modal is currently in the stack (open).
   * @param {string} id
   * @returns {boolean}
   */
  isOpen(id) {
    return this._stack.some(e => e.id === id);
  },
};