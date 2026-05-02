// ── VECTO / history.js ───────────────────────────────────────────────────────
// Playback history modal: rendering, filtering, sorting, column resize,
// bulk select/remove, add-to-queue, and the pause/resume history toggle.
//
// CIRCULAR DEPENDENCY NOTE
// handleUrl lives in main.js, which imports history.js. To break that cycle,
// main.js calls setHistoryCallbacks({ handleUrl }) after both modules load.
// All other dependencies (playIndex, openFileLocation, addItems, renderPlaylist)
// are imported directly — none of those modules import history.js.
//
// Exports: initHistory, setHistoryCallbacks, openHistoryModal, closeHistoryModal

import { state, fmt, hashKey }           from './state.js';
import { notif }                          from './ui.js';
import { loadHistRaw, saveHistRaw,
         loadColWidths, saveColWidths }   from './settings.js';
import { renderPlaylist, addItems }       from './queue.js';
import { playIndex, openFileLocation }    from './player.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const histOverlay   = document.getElementById('history-overlay');
const histTbody     = document.getElementById('hist-tbody');
const histSelectBtn = document.getElementById('hist-select-btn');
const histClearBtn  = document.getElementById('hist-clear-btn');
const histCloseBtn  = document.getElementById('hist-close-btn');
const histPauseBtn  = document.getElementById('hist-pause-btn');
const histCheckAll  = document.getElementById('hist-check-all');
const histBulk      = document.getElementById('history-bulk');
const histBulkCount = document.getElementById('hist-bulk-count');
const histRemoveSel = document.getElementById('hist-remove-sel');
const histAddQueue  = document.getElementById('hist-add-queue');
const historyBtn    = document.getElementById('history-btn');

// ── Injected callbacks ────────────────────────────────────────────────────────
let _handleUrl = () => {};

export function setHistoryCallbacks({ handleUrl }) {
  _handleUrl = handleUrl;
}

// ── Module-local state ────────────────────────────────────────────────────────
let histSelecting            = false;
let histSelected             = new Set();
let histSortCol              = 'lastPlayed';
let histSortAsc              = false;
let histFilters              = new Set();
let _colResizeDid            = false;
let _histMouseDownOnOverlay  = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const TYPE_LABEL = { local:'LOCAL', hls:'HLS', dash:'DASH', m3u:'M3U', stream:'STREAM' };
const TYPE_CLS   = { local:'ht-local', hls:'ht-hls', dash:'ht-dash', m3u:'ht-m3u', stream:'ht-stream' };

// ── Filtered + sorted history ─────────────────────────────────────────────────
function getFilteredHistory() {
  let hist = loadHistRaw();
  hist.sort((a, b) => {
    const va = a[histSortCol] ?? '', vb = b[histSortCol] ?? '';
    if (typeof va === 'number') return histSortAsc ? va - vb : vb - va;
    return histSortAsc
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
  if (histFilters.size === 0) return hist;
  return hist.filter(h => {
    if (histFilters.has('hls')    && (h.type === 'hls' || h.type === 'm3u')) return true;
    if (histFilters.has('local')  && h.type === 'local')  return true;
    if (histFilters.has('dash')   && h.type === 'dash')   return true;
    if (histFilters.has('stream') && h.type === 'stream') return true;
    return false;
  });
}

// ── Bulk bar ──────────────────────────────────────────────────────────────────
function updateHistBulkBar() {
  const show = histSelecting && histSelected.size > 0;
  histBulk.style.display = show ? 'flex' : 'none';
  if (show) histBulkCount.textContent = histSelected.size + ' selected';
}

function syncCheckAll(hist) {
  if (histCheckAll) {
    histCheckAll.checked = hist.length > 0 && hist.every(h => histSelected.has(h.id));
  }
}

// ── Row: source cell ──────────────────────────────────────────────────────────
function buildSourceCell(entry) {
  const ltd = document.createElement('td');
  ltd.className = 'hist-td-link';

  if (entry.rawUrl) {
    const a       = document.createElement('a');
    a.className   = 'hl';
    a.href        = '#';
    a.title       = entry.rawUrl;
    a.textContent = entry.rawUrl;
    a.addEventListener('click',       ev => { ev.stopPropagation(); ev.preventDefault(); });
    a.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      navigator.clipboard.writeText(entry.rawUrl)
        .then(() => notif('Link copied to clipboard'))
        .catch(() => notif('Could not copy link'));
    });
    ltd.appendChild(a);

  } else if (entry.filePath) {
    const span      = document.createElement('span');
    span.className  = 'hist-filepath' + (window.__TAURI__ ? ' hist-filepath-clickable' : '');
    span.title      = window.__TAURI__
      ? 'Ctrl+click to reveal in Explorer · Right-click to copy path'
      : entry.filePath;
    span.textContent = entry.filePath;

    // Ctrl+click → reveal in Explorer (mousedown so WebView2 doesn't intercept)
    span.addEventListener('mousedown', ev => {
      if (ev.button === 0 && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault(); ev.stopPropagation();
        if (window.__TAURI__) openFileLocation(entry.filePath);
      }
    });
    span.addEventListener('click',       ev => ev.stopPropagation());
    span.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      navigator.clipboard.writeText(entry.filePath)
        .then(() => notif('Path copied to clipboard'))
        .catch(() => notif('Could not copy path'));
    });
    ltd.appendChild(span);

  } else {
    const em = document.createElement('em');
    em.textContent = 'local file';
    ltd.appendChild(em);
  }

  return ltd;
}

// ── Local history entry → queue (Tauri only) ──────────────────────────────────
async function queueLocalHistoryEntry(entry) {
  if (!window.__TAURI__) { notif('This feature requires the Tauri app'); return; }
  try {
    const exists = await window.__TAURI__.core.invoke('file_exists', { path: entry.filePath });
    if (!exists) { notif('File not found. It may have been moved or deleted.'); return; }

    const src = window.__TAURI__.core.convertFileSrc(entry.filePath);
    const item = {
      title:     entry.title,
      url:       src,
      dur:       entry.duration > 0 ? entry.duration : -1,
      subtitles: [],
      resumeKey: entry.key || ('l' + hashKey(entry.filePath)),
      filePath:  entry.filePath,
    };

    const wasEmpty = state.playlist.length === 0;
    state.playlist.push(item);
    renderPlaylist();
    closeHistoryModal();
    if (wasEmpty) playIndex(0);
    else notif('Added to queue');
  } catch (e) {
    notif('Could not load local file.');
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderHistory() {
  const hist = getFilteredHistory();
  histTbody.innerHTML = '';
  const tbl = document.getElementById('history-table');

  if (hist.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" class="hist-empty">No history${histFilters.size > 0 ? ' matching filters' : ' yet'}</td>`;
    histTbody.appendChild(tr);
    updateHistBulkBar();
    return;
  }

  hist.forEach(entry => {
    const tr    = document.createElement('tr');
    tr.dataset.id = entry.id;
    if (histSelected.has(entry.id)) tr.classList.add('hist-sel');

    // Checkbox
    const cktd = document.createElement('td');
    cktd.className = 'hist-check-col';
    const cb   = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = histSelected.has(entry.id);
    cb.addEventListener('change', ev => {
      ev.stopPropagation();
      histSelected[cb.checked ? 'add' : 'delete'](entry.id);
      tr.classList.toggle('hist-sel', cb.checked);
      updateHistBulkBar();
      syncCheckAll(hist);
    });
    cb.addEventListener('click',  ev => ev.stopPropagation());
    cktd.addEventListener('click', ev => ev.stopPropagation());
    cktd.appendChild(cb);
    tr.appendChild(cktd);

    // Name
    const ntd = document.createElement('td');
    ntd.className   = 'hist-td-name';
    ntd.title       = entry.title;
    ntd.textContent = entry.title;
    tr.appendChild(ntd);

    // Type
    const ttd = document.createElement('td');
    ttd.className   = `hist-td-type ${TYPE_CLS[entry.type] || ''}`;
    ttd.textContent = TYPE_LABEL[entry.type] || entry.type.toUpperCase();
    tr.appendChild(ttd);

    // Source
    tr.appendChild(buildSourceCell(entry));

    // Duration
    const dtd = document.createElement('td');
    dtd.className   = 'hist-td-num';
    dtd.textContent = entry.duration > 0 ? fmt(entry.duration) : '—';
    tr.appendChild(dtd);

    // Plays
    const ptd = document.createElement('td');
    ptd.className   = 'hist-td-plays';
    ptd.textContent = entry.playCount || 1;
    tr.appendChild(ptd);

    // Last played
    const ld = document.createElement('td');
    ld.className   = 'hist-td-date';
    ld.title       = new Date(entry.lastPlayed).toLocaleString();
    ld.textContent = fmtDate(entry.lastPlayed);
    tr.appendChild(ld);

    // Row click
    tr.addEventListener('click', () => {
      if (histSelecting) {
        cb.checked = !cb.checked;
        histSelected[cb.checked ? 'add' : 'delete'](entry.id);
        tr.classList.toggle('hist-sel', cb.checked);
        updateHistBulkBar();
        syncCheckAll(hist);
        return;
      }
      if (entry.rawUrl) {
        closeHistoryModal();
        _handleUrl(entry.rawUrl);
        return;
      }
      if (entry.filePath) {
        queueLocalHistoryEntry(entry);
      }
    });

    histTbody.appendChild(tr);
  });

  syncCheckAll(hist);
  updateHistBulkBar();
}

// ── Modal open / close ────────────────────────────────────────────────────────
export function openHistoryModal() {
  histSelecting = false;
  histSelected.clear();
  histSelectBtn.textContent = 'SELECT';
  histSelectBtn.classList.remove('active');
  histBulk.style.display = 'none';
  document.getElementById('history-table').classList.remove('select-mode');
  renderHistory();
  histOverlay.classList.add('open');
  // Defer column init until after the modal is painted so offsetWidths are real
  requestAnimationFrame(initResizableColumns);
}

export function closeHistoryModal() {
  histOverlay.classList.remove('open');
}

// ── Resizable columns ─────────────────────────────────────────────────────────
function initResizableColumns() {
  const table     = document.getElementById('history-table');
  const wrap      = document.getElementById('history-table-wrap');
  const isSelMode = table.classList.contains('select-mode');
  const CHECK_COL_WIDTH = 32;

  // Remove any existing resizers before re-init
  table.querySelectorAll('.col-resizer').forEach(r => r.remove());

  const ths  = Array.from(table.querySelectorAll('thead th'));
  const cols = Array.from(table.querySelectorAll('col'));

  if (cols[0]) cols[0].style.width = isSelMode ? CHECK_COL_WIDTH + 'px' : '0px';

  const dataColIndices = ths.map((_, i) => i).filter(i => i > 0);
  const savedWidths    = loadColWidths();
  let widths;

  if (savedWidths.length === dataColIndices.length) {
    widths = savedWidths;
  } else {
    // Measure natural widths then scale to fill the wrapper
    table.style.tableLayout = 'auto';
    table.style.width       = '';
    void table.offsetWidth; // force reflow

    const natural      = dataColIndices.map(i => ths[i].offsetWidth);
    const totalNatural = natural.reduce((a, b) => a + b, 0);
    const wrapW        = wrap.clientWidth;
    const availableWrap = wrapW - (isSelMode ? CHECK_COL_WIDTH : 0);
    const scale         = totalNatural < availableWrap ? availableWrap / totalNatural : 1;
    widths = natural.map(w => Math.round(w * scale));

    // Fix rounding drift
    const target = Math.max(Math.round(totalNatural * scale), availableWrap);
    const got    = widths.reduce((a, b) => a + b, 0);
    if (got !== target) widths[widths.length - 1] += target - got;
  }

  table.style.tableLayout = 'fixed';
  let tableW = isSelMode ? CHECK_COL_WIDTH : 0;
  dataColIndices.forEach((thIdx, arrIdx) => {
    if (cols[thIdx]) cols[thIdx].style.width = widths[arrIdx] + 'px';
    tableW += widths[arrIdx];
  });
  table.style.width = tableW + 'px';

  // Per-column resize limits [min, max] px
  const limits = [
    null,        // 0: checkbox — not resizable
    [100, 380],  // 1: name
    [52,   90],  // 2: type
    [100, 520],  // 3: source
    [58,  120],  // 4: duration
    [36,   72],  // 5: plays
    [110, 220],  // 6: last played
  ];

  ths.forEach((th, i) => {
    if (i === 0) return;

    const resizer           = document.createElement('div');
    resizer.className       = 'col-resizer';
    resizer.style.display   = 'flex';
    resizer.style.alignItems    = 'center';
    resizer.style.justifyContent = 'center';
    resizer.style.color     = '#50506a';
    resizer.style.fontSize  = '10px';
    resizer.innerHTML       = '|';
    th.appendChild(resizer);

    resizer.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      resizer.classList.add('dragging');
      resizer.style.color = 'var(--accent)';

      const startX    = e.clientX;
      const col       = cols[i];
      const startColW = parseInt(col?.style.width) || th.offsetWidth;
      const [minW, maxW] = limits[i] || [50, 500];

      const onMove = ev => {
        _colResizeDid   = true;
        const delta     = ev.clientX - startX;
        const newW      = Math.max(minW, Math.min(maxW, startColW + delta));
        const curW      = parseInt(col?.style.width) || th.offsetWidth;
        const curTblW   = parseInt(table.style.width) || table.offsetWidth;
        const newTblW   = curTblW + (newW - curW);
        if (newTblW < wrap.clientWidth) return;
        if (col) col.style.width = newW + 'px';
        table.style.width = newTblW + 'px';
      };

      const onUp = () => {
        resizer.classList.remove('dragging');
        resizer.style.color = '#50506a';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        const currentWidths = dataColIndices.map(idx =>
          parseInt(cols[idx].style.width) || ths[idx].offsetWidth
        );
        saveColWidths(currentWidths);
        // Delay flag clear so the click handler doesn't also fire a sort
        setTimeout(() => { _colResizeDid = false; }, 80);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  });
}

// ── Module initialisation ─────────────────────────────────────────────────────
export function initHistory() {
  // History button → open modal
  historyBtn.addEventListener('click', openHistoryModal);

  // Close: button, overlay click (only if mousedown also started on overlay)
  histCloseBtn.addEventListener('click', closeHistoryModal);
  histOverlay.addEventListener('mousedown', e => {
    _histMouseDownOnOverlay = (e.target === histOverlay);
  });
  histOverlay.addEventListener('click', e => {
    if (e.target === histOverlay && _histMouseDownOnOverlay) closeHistoryModal();
    _histMouseDownOnOverlay = false;
  });

  // Suppress browser context menu inside the modal (right-click on source
  // cells is handled individually above)
  document.getElementById('history-modal').addEventListener('contextmenu', ev => ev.preventDefault());

  // Select mode toggle
  histSelectBtn.addEventListener('click', () => {
    histSelecting = !histSelecting;
    histSelectBtn.textContent = histSelecting ? 'CANCEL' : 'SELECT';
    histSelectBtn.classList.toggle('active', histSelecting);
    document.getElementById('history-table').classList.toggle('select-mode', histSelecting);
    if (!histSelecting) { histSelected.clear(); histBulk.style.display = 'none'; }
    renderHistory();
    requestAnimationFrame(initResizableColumns);
  });

  // Select-all checkbox
  histCheckAll.addEventListener('change', e => {
    getFilteredHistory().forEach(h => { histSelected[e.target.checked ? 'add' : 'delete'](h.id); });
    renderHistory();
  });

  // Clear all
  histClearBtn.addEventListener('click', () => {
    if (!confirm('Clear all playback history?')) return;
    saveHistRaw([]);
    histSelected.clear();
    renderHistory();
  });

  // Remove selected
  histRemoveSel.addEventListener('click', () => {
    let hist = loadHistRaw();
    hist = hist.filter(h => !histSelected.has(h.id));
    saveHistRaw(hist);
    histSelected.clear();
    if (hist.length === 0) {
      histSelecting = false;
      histSelectBtn.textContent = 'SELECT';
      histSelectBtn.classList.remove('active');
      document.getElementById('history-table').classList.remove('select-mode');
    }
    renderHistory();
  });

  // Add selected to queue
  histAddQueue.addEventListener('click', async () => {
    const hist  = loadHistRaw();
    const toAdd = [...histSelected].map(id => hist.find(h => h.id === id)).filter(Boolean);
    if (!toAdd.length) { notif('Nothing selected'); return; }

    const networkItems = toAdd.filter(e => e.rawUrl);
    const localItems   = toAdd.filter(e => !e.rawUrl && e.filePath && window.__TAURI__);

    if (!networkItems.length && !localItems.length) {
      notif('No re-addable items selected');
      return;
    }

    const wasEmpty = state.playlist.length === 0;

    // Network items — push directly then trigger addItems-style play
    networkItems.forEach(entry => {
      state.playlist.push({
        title:     entry.title,
        url:       entry.rawUrl,
        dur:       entry.duration || -1,
        subtitles: [],
        resumeKey: 'n' + hashKey(entry.rawUrl),
      });
    });

    // Local items — verify existence first (Tauri only)
    for (const entry of localItems) {
      try {
        const exists = await window.__TAURI__.core.invoke('file_exists', { path: entry.filePath });
        if (!exists) { notif(`Not found: ${entry.title}`); continue; }
        const src = window.__TAURI__.core.convertFileSrc(entry.filePath);
        state.playlist.push({
          title:     entry.title,
          url:       src,
          dur:       entry.duration || -1,
          subtitles: [],
          resumeKey: entry.key || ('l' + hashKey(entry.filePath)),
          filePath:  entry.filePath,
        });
      } catch (e) { notif(`Could not load: ${entry.title}`); }
    }

    renderPlaylist();
    closeHistoryModal();
    const total = networkItems.length + localItems.length;
    notif(`Added ${total} item${total > 1 ? 's' : ''} to queue`);
    if (wasEmpty) playIndex(0);
  });

  // Pause / resume history recording
  histPauseBtn.addEventListener('click', () => {
    state.historyPaused = !state.historyPaused;
    histPauseBtn.textContent = state.historyPaused ? 'RESUME HISTORY' : 'PAUSE HISTORY';
    histPauseBtn.classList.toggle('paused', state.historyPaused);
    notif(state.historyPaused ? 'History paused' : 'History resumed');
  });

  // Column sort (suppressed if user just finished a column resize drag)
  document.querySelectorAll('#history-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      if (_colResizeDid) return;
      const col = th.dataset.col;
      if (histSortCol === col) histSortAsc = !histSortAsc;
      else { histSortCol = col; histSortAsc = col !== 'lastPlayed'; }
      document.querySelectorAll('#history-table th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(histSortAsc ? 'sort-asc' : 'sort-desc');
      renderHistory();
    });
  });

  // Type filters
  document.querySelectorAll('.hist-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.type;
      histFilters[histFilters.has(t) ? 'delete' : 'add'](t);
      btn.classList.toggle('on', histFilters.has(t));
      renderHistory();
    });
  });
}
