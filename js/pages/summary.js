import { getSummarySheet, settleRow } from '../api.js';
import { fmt, parseMonthLabel, showToast, showConfirm } from '../utils.js';

// ── Init ─────────────────────────────────────────────────────────────────────

export function initSummaryPage() {
  document.getElementById('summary-refresh-btn').addEventListener('click', loadSummary);
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

    const rowNumber = idx + 2; // 1-based, row 1 is headers
    const whoText   = isSettled ? 'Settled' : (String(r[iWho] || '') || 'Even');
    const owedText  = isSettled ? '0 kr' : fmt(r[iAmount]);

    return `
      <div class="month-card">
        <div class="month-card-header">
          <span class="month-label">${parseMonthLabel(r[iMonth])}</span>
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
        ${!isSettled ? `<button class="btn-settle" data-row="${rowNumber}">✓ Mark as paid</button>` : ''}
      </div>
    `;
  }).join('');

  const container = document.getElementById('summary-content');
  container.innerHTML = html || '<p class="loading-msg">No data rows found.</p>';

  // Attach settle handlers (event delegation on container)
  container.addEventListener('click', handleSettleClick);
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
