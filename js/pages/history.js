import { getState, setState } from '../state.js';
import { getExpenseSheet } from '../api.js';
import { fmt, showToast } from '../utils.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Init ─────────────────────────────────────────────────────────────────────

export function initHistoryPage() {
  document.getElementById('history-budget-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    const value = btn.dataset.value;
    setState({ historyBudget: value });
    updateToggle(value);
    loadHistory(value);
  });

  document.getElementById('history-refresh-btn').addEventListener('click', () => {
    const { historyBudget } = getState();
    loadHistory(historyBudget, /* forceRefresh */ true);
  });
}

/** Called by app.js when navigating to this page */
export function onHistoryEnter() {
  const { historyBudget } = getState();
  updateToggle(historyBudget);
  loadHistory(historyBudget);
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadHistory(budgetType, forceRefresh = false) {
  const cacheKey = `history_cache_${budgetType}`;

  // Serve from cache if fresh
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) { renderHistory(cached, budgetType); return; }
  }

  setLoading();

  try {
    const data = await getExpenseSheet(budgetType);
    writeCache(cacheKey, data.rows);
    renderHistory(data.rows, budgetType);
  } catch (err) {
    document.getElementById('history-list').innerHTML =
      `<p class="loading-msg">Could not load history.<br><span style="font-size:0.7rem;opacity:0.7">${err.message}</span></p>`;
    showToast('Error loading history', 'error');
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderHistory(rows, budgetType) {
  const list = document.getElementById('history-list');

  if (!rows || rows.length < 2) {
    list.innerHTML = '<p class="loading-msg">No entries found.</p>';
    return;
  }

  // First row is headers, rest is data — newest first
  const headers = rows[0].map(h => String(h).toLowerCase().trim());
  const dataRows = rows.slice(1).filter(r => r[1]); // require a date

  const iDate     = col(headers, ['purchase date', 'date', 'datum']) ?? 1;
  const iItem     = col(headers, ['item', 'artikel', 'vad']) ?? 2;
  const iAmount   = col(headers, ['amount', 'belopp']) ?? 3;
  const iCategory = col(headers, ['category', 'kategori']) ?? 4;
  const iPaidBy   = col(headers, ['paid by', 'vem betalade', 'betalad av']) ?? 6;

  const isJoint = budgetType === 'joint';

  const html = [...dataRows].reverse().map(r => {
    const date     = String(r[iDate] || '').substring(0, 10);
    const item     = r[iItem] || '—';
    const amount   = r[iAmount];
    const category = r[iCategory] || '';
    const paidBy   = isJoint ? (r[iPaidBy] || '') : '';

    const meta = [date, category, paidBy].filter(Boolean).join(' · ');

    return `
      <div class="entry">
        <div class="entry-left">
          <span class="entry-name">${item}</span>
          <span class="entry-meta">${meta}</span>
        </div>
        <span class="entry-amount">${fmt(amount)}</span>
      </div>
    `;
  }).join('');

  list.innerHTML = html || '<p class="loading-msg">No entries found.</p>';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateToggle(value) {
  document.querySelectorAll('#history-budget-toggle .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function setLoading() {
  document.getElementById('history-list').innerHTML = '<p class="loading-msg">Loading…</p>';
}

/** Find first matching column index */
function col(headers, candidates) {
  for (const c of candidates) {
    const i = headers.findIndex(h => h.includes(c));
    if (i !== -1) return i;
  }
  return null;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* ignore quota errors */ }
}
