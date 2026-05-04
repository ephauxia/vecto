// ── VECTO / help.js ───────────────────────────────────────────────────────────
// Help modal (keyboard shortcuts, Telegram setup, CORS explanation)
// and shortcut bar favourites management.
//
// openHelpModal / closeHelpModal go through modalManager so the CORS warning
// → Help stacking works correctly: Help sits on top of the warning in the
// modal stack; Escape closes Help first, leaving the warning still open.
//
// Exports: initHelp, openHelpModal, closeHelpModal, isHelpOpen

import { getPref, setPref, KEYS } from './settings.js';
import { modalManager }            from './ui.js';

// ── Canonical shortcut list ───────────────────────────────────────────────────
const SHORTCUTS = [
  { id: 'play',        key: 'SPACE / K',  label: 'Play/Pause'   },
  { id: 'tempspeed',   key: 'HOLD SPACE', label: '2× Temp'      },
  { id: 'skip10',      key: 'J / L',      label: '±10s'         },
  { id: 'skip5',       key: '← →',        label: '±5s'          },
  { id: 'volume',      key: '↑ ↓',        label: 'Volume'       },
  { id: 'mute',        key: 'M',          label: 'Mute'         },
  { id: 'fullscreen',  key: 'F',          label: 'Fullscreen'   },
  { id: 'loop',        key: 'R',          label: 'Loop mode'    },
  { id: 'queue',       key: 'Q',          label: 'Toggle Queue' },
  { id: 'pip',         key: 'P',          label: 'Pic-in-Pic'   },
  { id: 'subs',        key: 'C',          label: 'Toggle Subs'  },
  { id: 'subsettings', key: 'Shift+C',    label: 'Sub Settings' },
  { id: 'speeddial',   key: 'S',          label: 'Speed dial'   },
  { id: 'tracks',      key: 'G',          label: 'Tracks'       },
  { id: 'speedstep',   key: '< >',        label: 'Speed step'   },
  { id: 'seek',        key: '0–9',        label: 'Seek %'       },
];

const DEFAULT_PREFS = Object.fromEntries(SHORTCUTS.map(s => [s.id, true]));

// ── DOM refs ──────────────────────────────────────────────────────────────────
const helpOverlay  = document.getElementById('help-overlay');
const helpCloseBtn = document.getElementById('help-close-btn');
const helpNavBtns  = document.querySelectorAll('.help-nav-btn');
const helpSections = document.querySelectorAll('.help-section');
const scChips      = document.getElementById('sc-chips');
const scEditBtn    = document.getElementById('sc-edit-btn');
const shortcutBar  = document.getElementById('shortcut-bar');
const helpBtn      = document.getElementById('help-btn');

// ── Module-local state ────────────────────────────────────────────────────────
let _scEditing = false;

// ── Shortcut prefs helpers ────────────────────────────────────────────────────
function loadScPrefs() {
  const saved = getPref(KEYS.SHORTCUT_PREFS);
  return saved ? { ...DEFAULT_PREFS, ...saved } : { ...DEFAULT_PREFS };
}

// ── Shortcut bar rendering ────────────────────────────────────────────────────
export function renderShortcutBar() {
  const prefs = loadScPrefs();
  scChips.innerHTML = '';

  SHORTCUTS.forEach(sc => {
    const item       = document.createElement('div');
    item.className   = 'sc-item' + (prefs[sc.id] ? '' : ' sc-hidden');
    item.dataset.id  = sc.id;

    const keyEl       = document.createElement('span');
    keyEl.className   = 'sc-key';
    keyEl.textContent = sc.key;

    const lblEl       = document.createElement('span');
    lblEl.className   = 'sc-label';
    lblEl.textContent = sc.label;

    item.appendChild(keyEl);
    item.appendChild(lblEl);
    scChips.appendChild(item);
  });

  const anyVisible = SHORTCUTS.some(s => prefs[s.id]);
  shortcutBar.classList.toggle('sc-collapsed', !anyVisible);

  requestAnimationFrame(() => {
    shortcutBar.classList.toggle('sc-overflows', scChips.scrollWidth > scChips.clientWidth);
  });
}

// ── Edit mode ─────────────────────────────────────────────────────────────────
function enterEditMode() {
  _scEditing = true;
  shortcutBar.classList.add('sc-editing');
  scEditBtn.textContent = '✓';
  scEditBtn.title       = 'Done';

  const prefs = loadScPrefs();
  scChips.querySelectorAll('.sc-item').forEach(el => {
    el.classList.remove('sc-hidden');
    el.classList.toggle('sc-off', !prefs[el.dataset.id]);
  });

  shortcutBar.classList.remove('sc-collapsed');
}

function exitEditMode() {
  _scEditing = false;
  shortcutBar.classList.remove('sc-editing');
  scEditBtn.textContent = '✏';
  scEditBtn.title       = 'Customize shortcuts';
  renderShortcutBar();
}

// ── Chip click in edit mode ───────────────────────────────────────────────────
function handleChipClick(e) {
  if (!_scEditing) return;
  const item = e.target.closest('.sc-item');
  if (!item || !item.dataset.id) return;

  const prefs      = loadScPrefs();
  const id         = item.dataset.id;
  prefs[id]        = !prefs[id];
  setPref(KEYS.SHORTCUT_PREFS, prefs);
  item.classList.toggle('sc-off', !prefs[id]);
}

// ── Help modal ────────────────────────────────────────────────────────────────

function _activateSection(sectionId) {
  document.getElementById('help-modal').dataset.section = sectionId;
  helpNavBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
  helpSections.forEach(sec => {
    sec.classList.toggle('active', sec.id === 'help-sec-' + sectionId);
  });
  const activeEl = document.getElementById('help-sec-' + sectionId);
  if (activeEl) activeEl.scrollTop = 0;
  const body = document.getElementById('help-body');
  if (body) body.scrollTop = 0;
}

/**
 * Open the help modal and navigate to a named section.
 * Routes through modalManager so Help stacks correctly on top of CORS warning.
 * @param {string} sectionId  'shortcuts' | 'telegram' | 'cors'
 */
export function openHelpModal(sectionId = 'shortcuts') {
  _activateSection(sectionId);
  modalManager.open('help-overlay');
}

export function closeHelpModal() {
  modalManager.close('help-overlay');
}

export function isHelpOpen() {
  return modalManager.isOpen('help-overlay');
}

// ── Module init ───────────────────────────────────────────────────────────────
export function initHelp() {
  renderShortcutBar();

  // ── Help modal ──────────────────────────────────────────────────────────────
  helpBtn.addEventListener('click', () => openHelpModal('shortcuts'));
  helpCloseBtn.addEventListener('click', closeHelpModal);

  // Backdrop click
  let _mdOnOverlay = false;
  helpOverlay.addEventListener('mousedown', e => { _mdOnOverlay = (e.target === helpOverlay); });
  helpOverlay.addEventListener('click', e => {
    if (e.target === helpOverlay && _mdOnOverlay) closeHelpModal();
    _mdOnOverlay = false;
  });

  helpNavBtns.forEach(btn => {
    btn.addEventListener('click', () => _activateSection(btn.dataset.section));
  });

  document.getElementById('help-modal')
    .addEventListener('contextmenu', e => e.preventDefault());

  // ── Shortcut bar ────────────────────────────────────────────────────────────
  scEditBtn.addEventListener('click', e => {
    e.stopPropagation();
    _scEditing ? exitEditMode() : enterEditMode();
  });

  scChips.addEventListener('click', handleChipClick);

  document.addEventListener('click', e => {
    if (_scEditing && !shortcutBar.contains(e.target)) exitEditMode();
  });

  new ResizeObserver(() => {
    shortcutBar.classList.toggle('sc-overflows', scChips.scrollWidth > scChips.clientWidth);
  }).observe(scChips);
}
