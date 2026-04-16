import { getSummarySheet, settleRow } from '../api.js';
import { getState } from '../state.js';
import { fmt, parseMonthLabel, showToast, showConfirm } from '../utils.js';
import { USERS } from '../auth.js';

// ── Init ─────────────────────────────────────────────────────────────────────

export function initSummaryPage() {
  document.getElementById('summary-refresh-btn').addEventListener('click', loadSummary);
  document.addEventListener('visibilitychange', onReturnFromSwish);
}

/** Called by app.js when navigating to this page */
export function onSummaryEnter() {
  loadSummary();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadSummary() {
  document.getElementById('summary-content').innerHTML = '<p class="loading-msg">Loading…</p>';

  try {
    const data = await getSummarySheet();
    renderSummary(data.rows);
  } catch (err) {
    document.getElementById('summary-content').innerHTML =
      `<p class="loading-msg">Could not load summary.<br><span style="font-size:0.7rem;opacity:0.7">${err.message}</span></p>`;
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderSummary(rows) {
  if (!rows || rows.length < 2) {
    document.getElementById('summary-content').innerHTML = '<p class="loading-msg">No summary data found.</p>';
    return;
  }

  const headers  = rows[0].map(h => String(h).trim().toLowerCase());
  const dataRows = rows.slice(1).filter(r => r[0] !== '' && r[0] != null);

  const iMonth   = col(headers, ['month', 'månad']) ?? 0;
  const iMelissa = col(headers, ['melissa'])         ?? 1;
  const iMattias = col(headers, ['mattias'])         ?? 2;
  const iTotal   = col(headers, ['total'])           ?? 3;
  const iEach    = col(headers, ['each', 'vardera']) ?? 4;
  const iWho     = col(headers, ['who', 'vem'])      ?? 5;
  const iAmount  = col(headers, ['amount', 'belopp', 'how much']) ?? 6;
  const iSettled = col(headers, ['settled', 'reglerad'])          ?? 7;

  const html = dataRows.map((r, idx) => {
    const isSettled = r[iSettled] === true
      || String(r[iSettled]).toLowerCase() === 'true'
      || String(r[iSettled]).toLowerCase() === 'ja'
      || r[iSettled] === 'TRUE';

    const rowNumber  = idx + 2; // 1-based, row 1 is headers
    const whoRaw     = String(r[iWho] || '').trim();
    const whoText    = isSettled ? 'Settled' : (whoRaw || 'Even');
    const owedText   = isSettled ? '0 kr' : fmt(r[iAmount]);
    const monthLabel = parseMonthLabel(r[iMonth]);
    const owedAmount = parseFloat(r[iAmount]) || 0;

    const swishBtn = (!isSettled && owedAmount > 0 && whoRaw)
      ? buildSwishBtn(whoRaw, owedAmount, monthLabel, rowNumber)
      : '';

    return `
      <div class="month-card">
        <div class="month-card-header">
          <span class="month-label">${monthLabel}</span>
          <span class="badge ${isSettled ? 'badge-settled' : 'badge-pending'}">
            ${isSettled ? '✓ Settled' : '⏳ Pending'}
          </span>
        </div>
        <div class="month-grid">
          <div class="month-stat">
            <div class="month-stat-label">Melissa paid</div>
            <div class="month-stat-value">${fmt(r[iMelissa])}</div>
          </div>
          <div class="month-stat">
            <div class="month-stat-label">Mattias paid</div>
            <div class="month-stat-value">${fmt(r[iMattias])}</div>
          </div>
          <div class="month-stat">
            <div class="month-stat-label">Total</div>
            <div class="month-stat-value">${fmt(r[iTotal])}</div>
          </div>
          <div class="month-stat">
            <div class="month-stat-label">Each should pay</div>
            <div class="month-stat-value">${fmt(r[iEach])}</div>
          </div>
        </div>
        <div class="month-footer">
          <span>${whoText}</span>
          <span class="owed-amount">${owedText}</span>
        </div>
        ${swishBtn}
        ${!isSettled ? `<button class="btn-settle" data-row="${rowNumber}">✓ Mark as paid</button>` : ''}
      </div>
    `;
  }).join('');

  const container = document.getElementById('summary-content');
  container.innerHTML = html || '<p class="loading-msg">No data rows found.</p>';

  // Attach settle + swish handlers via event delegation
  container.addEventListener('click', handleSettleClick);
  container.addEventListener('click', handleSwishClick);
}

// ── Swish ─────────────────────────────────────────────────────────────────────

// Tracks which row to prompt settling after returning from the Swish app
let pendingSettleRow = null;

/** Build the Swish button HTML, or '' if we can't determine the payee. */
function buildSwishBtn(whoRaw, amount, monthLabel, rowNumber) {
  const payeeSwish = resolvePayeeSwish(whoRaw);
  if (!payeeSwish) return '';

  const url = buildSwishUrl(payeeSwish, amount, monthLabel);
  return `<a href="${url}" class="btn-swish" data-swish-row="${rowNumber}" target="_blank" rel="noopener">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12h8M12 8l4 4-4 4"/></svg>
    Pay with Swish
  </a>`;
}

/**
 * The "who" column from the sheet says who owes (the debtor).
 * If Mattias owes → Mattias pays → Melissa is payee → return Melissa's Swish.
 * If Melissa owes → Melissa pays → Mattias is payee → return Mattias's Swish.
 */
function resolvePayeeSwish(whoRaw) {
  const lower = whoRaw.toLowerCase();
  if (lower.includes('mattias')) return USERS['melissa.steffansson@gmail.com'].swish;
  if (lower.includes('melissa')) return USERS['mattias.backstrom1993@gmail.com'].swish;
  return null;
}

function buildSwishUrl(payeePhone, amount, monthLabel) {
  const data = JSON.stringify({
    version: 1,
    payee:   { value: payeePhone,            editable: false },
    amount:  { value: Math.round(amount),    editable: false },
    message: { value: `Utgifter ${monthLabel}`, editable: true },
  });
  return `https://app.swish.nu/1/payment/new?data=${encodeURIComponent(data)}`;
}

function handleSwishClick(e) {
  const link = e.target.closest('.btn-swish');
  if (!link) return;
  pendingSettleRow = parseInt(link.dataset.swishRow);
}

async function onReturnFromSwish() {
  if (document.hidden || pendingSettleRow === null) return;

  const row = pendingSettleRow;
  pendingSettleRow = null;

  const confirmed = await showConfirm('Payment sent? Mark this month as settled?');
  if (!confirmed) return;

  try {
    await settleRow(row);
    showToast('Marked as paid ✓', 'success');
    setTimeout(loadSummary, 600);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ── Settle ────────────────────────────────────────────────────────────────────

async function handleSettleClick(e) {
  const btn = e.target.closest('.btn-settle');
  if (!btn) return;

  const rowNumber = parseInt(btn.dataset.row);
  const confirmed = await showConfirm(
    'Mark this month as settled? This updates your Google Sheet and cannot be undone easily.'
  );
  if (!confirmed) return;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await settleRow(rowNumber);
    showToast('Marked as paid ✓', 'success');
    setTimeout(loadSummary, 600);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✓ Mark as paid';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function col(headers, candidates) {
  for (const c of candidates) {
    const i = headers.findIndex(h => h.includes(c));
    if (i !== -1) return i;
  }
  return null;
}
