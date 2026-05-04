// ── VECTO / cors.js ───────────────────────────────────────────────────────────
// CORS Bypass toggle button, warning modal, and axum proxy lifecycle.
//
// The axum proxy (Rust) listens on 127.0.0.1:<dynamic-port>.
// Route: GET /proxy?url=<encoded-original-url>
// It forwards the request to the real server and injects CORS headers on the
// response. Range headers are forwarded so video seeking works correctly.
//
// URL wrapping: wrapUrl(originalUrl) returns a proxy URL when CORS is enabled,
// or the original URL unchanged when disabled. player.js imports wrapUrl and
// applies it in loadSrc — the playlist items always store the original URL,
// so history and resume keys are unaffected.
//
// HLS segment routing: when CORS is enabled, the HLS instance is created with
// xhrSetup/fetchSetup that route every segment request through the proxy too,
// not just the manifest. This is passed as a config object to player.js via
// getHlsCorsConfig().
//
// Exports: initCors, isCorsEnabled, wrapUrl, getHlsCorsConfig

import { getPref, setPref, KEYS }  from './settings.js';
import { notif, modalManager }      from './ui.js';
import { openHelpModal }            from './help.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const warnOverlay = document.getElementById('cors-warn-overlay');
const warnYes     = document.getElementById('cors-warn-yes');
const warnNo      = document.getElementById('cors-warn-no');
const warnSkipChk = document.getElementById('cors-warn-skip');
const warnHelpBtn = document.getElementById('cors-warn-help');

// Shorthand helpers to sync the settings-modal toggle without creating a
// hard import cycle. Both elements may be absent (web build), so guard.
function _syncToggleEl(checked) {
  const el = document.getElementById('as-cors-toggle');
  if (el) el.checked = checked;
}


// ── Module-local state ────────────────────────────────────────────────────────
let _enabled   = false;
let _proxyPort = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function isCorsEnabled() { return _enabled; }

/**
 * Wrap a URL through the local proxy if CORS bypass is active.
 * Blob URLs, asset.localhost URLs, and already-proxied URLs are passed through.
 */
export function wrapUrl(url) {
  if (!_enabled || !_proxyPort || !url) return url;
  if (url.startsWith('blob:') ||
      /asset\.localhost/i.test(url) ||
      url.startsWith(`http://localhost:${_proxyPort}`)) return url;
  return `http://localhost:${_proxyPort}/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Return extra config for the HLS.js constructor that routes all segment
 * requests through the proxy when CORS bypass is enabled.
 * Returns {} when CORS is off or proxy port is unknown.
 */
export function getHlsCorsConfig() {
  if (!_enabled || !_proxyPort) return {};
  return {
    xhrSetup:   (xhr, url)            => { xhr.open('GET', wrapUrl(url), true); },
    fetchSetup: (context, initParams) => new Request(wrapUrl(context.url), initParams),
  };
}

// ── Internal enable / disable ─────────────────────────────────────────────────

async function _enable() {
  try {
    _proxyPort = await window.__TAURI__.core.invoke('cors_proxy_start');
  } catch (e) {
    notif('Proxy failed to start: ' + e);
    return;
  }
  _enabled = true;
  if (getPref(KEYS.CORS_MEM)) setPref(KEYS.CORS_STATE, true);
  notif('CORS Bypass enabled');
  _syncToggleEl(true);

  if (typeof window._vectoReloadCurrentSrc === 'function') window._vectoReloadCurrentSrc();
}

async function _disable() {
  try {
    await window.__TAURI__.core.invoke('cors_proxy_stop');
  } catch (e) {
    // Proxy may already be stopped; continue regardless
  }
  _enabled   = false;
  _proxyPort = null;
  if (getPref(KEYS.CORS_MEM)) setPref(KEYS.CORS_STATE, false);
  notif('CORS Bypass disabled');
  _syncToggleEl(false);

  if (typeof window._vectoReloadCurrentSrc === 'function') window._vectoReloadCurrentSrc();
}

// ── Warning modal ─────────────────────────────────────────────────────────────

function _openWarning() {
  warnSkipChk.checked = false;
  modalManager.open('cors-warn-overlay');
}

function _closeWarning() {
  modalManager.close('cors-warn-overlay');
}

// ── Toggle (button click) ─────────────────────────────────────────────────────

async function _toggle() {
  if (_enabled) { await _disable(); return; }

  if (!window.__TAURI__) {
    notif('CORS Bypass requires the desktop app');
    return;
  }

  if (getPref(KEYS.CORS_WARN_SKIP) === true) {
    await _enable();
  } else {
    _openWarning();
  }
}

// ── Module init ───────────────────────────────────────────────────────────────

export async function toggleCors() {
  if (_enabled) { await _disable(); return; }
  if (!window.__TAURI__) { notif('CORS Bypass requires the desktop app'); return; }
  if (getPref(KEYS.CORS_WARN_SKIP) === true) {
    await _enable();
  } else {
    _openWarning();
  }
}

export function initCors() {
  if (!window.__TAURI__) return;

  // ── Warning: Yes ──────────────────────────────────────────────────────────
  warnYes.addEventListener('click', async () => {
    if (warnSkipChk.checked) setPref(KEYS.CORS_WARN_SKIP, true);
    _closeWarning();
    await _enable();
  });

  // ── Warning: No — revert the toggle checkbox ──────────────────────────────
  warnNo.addEventListener('click', () => {
    _closeWarning();
    _syncToggleEl(false); // user cancelled; uncheck the toggle they just flipped
  });

  let _mdOnOverlay = false;
  warnOverlay.addEventListener('mousedown', e => { _mdOnOverlay = (e.target === warnOverlay); });
  warnOverlay.addEventListener('click', e => {
    if (e.target === warnOverlay && _mdOnOverlay) {
      _closeWarning();
      _syncToggleEl(false);
    }
    _mdOnOverlay = false;
  });

  warnHelpBtn.addEventListener('click', () => openHelpModal('cors'));

  document.getElementById('cors-warn-modal')
    .addEventListener('contextmenu', e => e.preventDefault());

  // ── Boot restore ──────────────────────────────────────────────────────────
  if (getPref(KEYS.CORS_MEM) && getPref(KEYS.CORS_STATE)) {
    _enable();
  }
}