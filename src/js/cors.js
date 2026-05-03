// ── VECTO / cors.js ───────────────────────────────────────────────────────────
// CORS Bypass toggle button + warning modal.
//
// The actual HTTP proxy (axum) is implemented in Round 4 alongside the
// Telegram streaming server. The two Tauri commands it will call are:
//
//   window.__TAURI__.core.invoke('cors_proxy_start') → Promise<number> (port)
//   window.__TAURI__.core.invoke('cors_proxy_stop')  → Promise<void>
//
// Everything else — the button, warning modal, "don't show again", state
// persistence, and the "remember CORS state" boot restore — is fully wired.
//
// Exports: initCors, isCorsEnabled

import { getPref, setPref, KEYS } from './settings.js';
import { notif }                   from './ui.js';
import { openHelpModal }           from './help.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const corsBtn         = document.getElementById('cors-btn');
const warnOverlay     = document.getElementById('cors-warn-overlay');
const warnYes         = document.getElementById('cors-warn-yes');
const warnNo          = document.getElementById('cors-warn-no');
const warnSkipChk     = document.getElementById('cors-warn-skip');
const warnHelpBtn     = document.getElementById('cors-warn-help');

// ── Module-local state ────────────────────────────────────────────────────────
let _enabled            = false;
let _mouseDownOnOverlay = false;

export function isCorsEnabled() { return _enabled; }

// ── Internal enable / disable ─────────────────────────────────────────────────

async function _enable() {
  // ── Round 4: replace this block with the real proxy start ──────────────────
  // const port = await window.__TAURI__.core.invoke('cors_proxy_start');
  // store port somewhere accessible to handleUrl() in main.js
  // ──────────────────────────────────────────────────────────────────────────
  _enabled = true;
  corsBtn.classList.add('btn-cors-on');
  corsBtn.title = 'CORS Bypass: ON — click to disable';
  if (getPref(KEYS.CORS_MEM)) setPref(KEYS.CORS_STATE, true);
  notif('CORS Bypass enabled');
}

async function _disable() {
  // ── Round 4: replace this block with the real proxy stop ───────────────────
  // await window.__TAURI__.core.invoke('cors_proxy_stop');
  // ──────────────────────────────────────────────────────────────────────────
  _enabled = false;
  corsBtn.classList.remove('btn-cors-on');
  corsBtn.title = 'CORS Bypass: OFF — click to enable';
  if (getPref(KEYS.CORS_MEM)) setPref(KEYS.CORS_STATE, false);
  notif('CORS Bypass disabled');
}

// ── Warning modal ─────────────────────────────────────────────────────────────

function _openWarning() {
  warnSkipChk.checked = false;
  warnOverlay.classList.add('open');
}

function _closeWarning() {
  warnOverlay.classList.remove('open');
}

function isWarnOpen() {
  return warnOverlay.classList.contains('open');
}

// ── Toggle (called on button click) ──────────────────────────────────────────

async function _toggle() {
  if (_enabled) {
    await _disable();
    return;
  }

  // Not a Tauri build — silently skip (button is hidden in web mode anyway)
  if (!window.__TAURI__) {
    notif('CORS Bypass requires the desktop app');
    return;
  }

  const skip = getPref(KEYS.CORS_WARN_SKIP) === true;
  if (skip) {
    await _enable();
  } else {
    _openWarning();
  }
}

// ── Module init ───────────────────────────────────────────────────────────────

export function initCors() {
  // Hide the button entirely in non-Tauri builds
  if (!window.__TAURI__) {
    corsBtn.style.display = 'none';
    return;
  }

  // ── Button ───────────────────────────────────────────────────────────────────
  corsBtn.addEventListener('click', _toggle);

  // ── Warning modal: Yes ────────────────────────────────────────────────────────
  warnYes.addEventListener('click', async () => {
    if (warnSkipChk.checked) setPref(KEYS.CORS_WARN_SKIP, true);
    _closeWarning();
    await _enable();
  });

  // ── Warning modal: No ─────────────────────────────────────────────────────────
  warnNo.addEventListener('click', _closeWarning);

  // ── Warning modal: backdrop click ─────────────────────────────────────────────
  warnOverlay.addEventListener('mousedown', e => {
    _mouseDownOnOverlay = (e.target === warnOverlay);
  });
  warnOverlay.addEventListener('click', e => {
    if (e.target === warnOverlay && _mouseDownOnOverlay) _closeWarning();
    _mouseDownOnOverlay = false;
  });

  // ── Warning modal: Help link → CORS section ───────────────────────────────────
  // Note: warning modal does not auto-restore after Help closes in this round.
  // Full modal stack (child→parent restore) is a dedicated modalManager pass.
  warnHelpBtn.addEventListener('click', () => {
    _closeWarning();
    openHelpModal('cors');
  });

  // ── Warning modal: context menu suppression ───────────────────────────────────
  document.getElementById('cors-warn-modal')
    .addEventListener('contextmenu', e => e.preventDefault());

  // ── Boot restore: re-enable if remembered ────────────────────────────────────
  // Only fires if the user has both CORS_MEM and CORS_STATE set.
  // Runs silently — no warning modal, no notif, just restores previous state.
  if (getPref(KEYS.CORS_MEM) && getPref(KEYS.CORS_STATE)) {
    _enable();
  }
}
