// ── VECTO / help.js ───────────────────────────────────────────────────────────
// Help modal (Telegram setup instructions, keyboard shortcuts reference,
// CORS bypass explanation) and shortcut bar favourites management.
//
// The Help modal is standalone in Round 1 — no parent stacking needed.
// Stacking support (CORS Warning → Help, Auth → Help) is implemented in
// the modal manager upgrade scheduled for Round 2.
//
// Exports: initHelp, openHelpModal, closeHelpModal

import { getPref, setPref, KEYS } from './settings.js';

// ── Canonical shortcut list ───────────────────────────────────────────────────
// Single source of truth for the bar chips. The Help modal shortcuts section
// is a static full-reference table in HTML — it does not use this array.
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
let _scEditing              = false;
let _helpMouseDownOnOverlay = false;

// ── Shortcut prefs helpers ────────────────────────────────────────────────────
function loadScPrefs() {
  const saved = getPref(KEYS.SHORTCUT_PREFS);
  // Merge with defaults so new shortcuts added in future rounds appear visible
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
}

// ── Edit mode ─────────────────────────────────────────────────────────────────
function enterEditMode() {
  _scEditing = true;
  shortcutBar.classList.add('sc-editing');
  scEditBtn.textContent = '✓';
  scEditBtn.title       = 'Done';

  // Show all chips; mark off-state visually
  const prefs = loadScPrefs();
  scChips.querySelectorAll('.sc-item').forEach(el => {
    el.classList.remove('sc-hidden');
    el.classList.toggle('sc-off', !prefs[el.dataset.id]);
  });

  // Shrink collapsed bar back to normal height for editing
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

/**
 * Open the help modal and navigate to a named section.
 * @param {string} sectionId  'telegram' | 'shortcuts' | 'cors'
 */
export function openHelpModal(sectionId = 'shortcuts') {
  _activateSection(sectionId);
  helpOverlay.classList.add('open');
}

export function closeHelpModal() {
  helpOverlay.classList.remove('open');
}

export function isHelpOpen() {
  return helpOverlay.classList.contains('open');
}

function _activateSection(sectionId) {
  helpNavBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
  helpSections.forEach(sec => {
    sec.classList.toggle('active', sec.id === 'help-sec-' + sectionId);
  });
  // Scroll section body to top on switch
  const activeEl = document.getElementById('help-sec-' + sectionId);
  if (activeEl) activeEl.scrollTop = 0;
  const body = document.getElementById('help-body');
  if (body) body.scrollTop = 0;
}

// ── Module init ───────────────────────────────────────────────────────────────
export function initHelp() {
  // Render shortcut bar from saved prefs
  renderShortcutBar();

  // ── Help modal ──────────────────────────────────────────────────────────────
  helpBtn.addEventListener('click', () => openHelpModal('shortcuts'));

  helpCloseBtn.addEventListener('click', closeHelpModal);

  helpOverlay.addEventListener('mousedown', e => {
    _helpMouseDownOnOverlay = (e.target === helpOverlay);
  });
  helpOverlay.addEventListener('click', e => {
    if (e.target === helpOverlay && _helpMouseDownOnOverlay) closeHelpModal();
    _helpMouseDownOnOverlay = false;
  });

  helpNavBtns.forEach(btn => {
    btn.addEventListener('click', () => _activateSection(btn.dataset.section));
  });

  // Suppress context menu inside the modal
  document.getElementById('help-modal')
    .addEventListener('contextmenu', e => e.preventDefault());

  // ── Shortcut bar ────────────────────────────────────────────────────────────
  scEditBtn.addEventListener('click', e => {
    e.stopPropagation();
    _scEditing ? exitEditMode() : enterEditMode();
  });

  scChips.addEventListener('click', handleChipClick);

  // Exit edit mode on outside click
  document.addEventListener('click', e => {
    if (_scEditing && !shortcutBar.contains(e.target)) exitEditMode();
  });
}
