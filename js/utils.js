// ── Number / date formatting ────────────────────────────────────────────────

/** Format a number as Swedish kronor, e.g. "1 234 kr" */
export function fmt(v) {
  const n = parseFloat(v);
  return isNaN(n) ? (v || '—') : n.toLocaleString('sv-SE', { maximumFractionDigits: 0 }) + ' kr';
}

/**
 * Parse a month value coming from Google Sheets into a Swedish month label.
 * Sheets can send ISO timestamps (UTC end-of-month) or plain YYYY-MM-DD strings.
 */
export function parseMonthLabel(val) {
  if (!val) return '—';
  const s = String(val).trim();

  // ISO timestamp — Sheets sends last-day-of-month in UTC which can roll back
  // one day in Stockholm time, so add 1 day before extracting the month.
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) {
    const d = new Date(s);
    d.setUTCDate(d.getUTCDate() + 1);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1)
      .toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  }

  // Plain YYYY-MM-DD
  const plain = s.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (plain) {
    return new Date(+plain[1], +plain[2] - 1, 1)
      .toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  }

  return s;
}

/** Format a YYYY-MM string as a Swedish month label */
export function formatYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
}

// ── Toast ───────────────────────────────────────────────────────────────────

let _toastTimer = null;

/** Show a temporary toast message. type = '' | 'success' | 'error' */
export function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  if (_toastTimer) clearTimeout(_toastTimer);
  el.textContent = msg;
  el.className = `toast ${type} show`;
  _toastTimer = setTimeout(() => { el.className = `toast ${type}`; }, 2800);
}

// ── Confirm modal ───────────────────────────────────────────────────────────

/**
 * Show a confirmation modal. Returns a Promise<boolean>.
 * Usage: if (await showConfirm('Are you sure?')) { ... }
 */
export function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-message').textContent = message;
    overlay.classList.remove('hidden');

    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn  = document.getElementById('modal-cancel');

    function cleanup(result) {
      overlay.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onCancel()  { cleanup(false); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}
