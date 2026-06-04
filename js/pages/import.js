import { getState } from '../state.js';
import { categorizeExpenses, batchImportExpenses, saveCorrection, getRecentExpenses } from '../api.js';
import { parseCSV, fingerprintHeaders, detectFormat, saveFormat, applyMapping, autoDetectColumns } from '../csv.js';
import { CATEGORIES } from '../categories.js';
import { showToast } from '../utils.js';

const JOINT_CATEGORIES = ['Groceries'];

const SHEET_NAMES = {
  joint:   'Joint Expenses',
  mattias: 'Mattias Expenses',
  melissa: 'Melissas Expenses',
};

// ── Module state ──────────────────────────────────────────────────────────────

let _selectedFile  = null;  // File object from picker / drop
let _rawRows       = [];    // string[][] from parseCSV (excludes header row)
let _headers       = [];    // string[]
let _fingerprint   = '';
let _mapping       = null;  // { name, dateCol, amountCol, itemCol }
let _categorized   = [];    // frozen AI output array

// ── Init ──────────────────────────────────────────────────────────────────────

export function initImportPage() {
  // Drop zone
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });
  dropZone.addEventListener('click', e => {
    if (e.target.id === 'csv-browse-btn') return; // handled below
    document.getElementById('csv-file').click();
  });

  document.getElementById('csv-browse-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('csv-file').click();
  });

  document.getElementById('csv-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) selectFile(file);
    e.target.value = ''; // reset so same file can be re-selected
  });

  // Clear selected file
  document.getElementById('csv-clear-btn').addEventListener('click', clearFile);

  // Continue → triggers processing
  document.getElementById('csv-process-btn').addEventListener('click', processSelectedFile);

  // Mapper confirm
  document.getElementById('mapper-confirm-btn').addEventListener('click', handleMapperConfirm);

  // Payer toggle
  document.getElementById('import-payer-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    document.querySelectorAll('#import-payer-toggle .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Submit
  document.getElementById('import-submit-btn').addEventListener('click', handleImport);
}

export function onImportEnter() {
  // Only reset to upload step if no data is loaded
  if (_categorized.length === 0 && _rawRows.length === 0) {
    showStep('upload');
  }
}

// ── File selection ────────────────────────────────────────────────────────────

function selectFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please select a CSV file', 'error');
    return;
  }
  _selectedFile = file;
  document.getElementById('selected-filename').textContent = file.name;
  document.getElementById('import-format-badge').innerHTML = '';
  document.getElementById('file-pick-area').classList.add('hidden');
  document.getElementById('file-selected-area').classList.remove('hidden');
}

function clearFile() {
  _selectedFile = null;
  document.getElementById('file-pick-area').classList.remove('hidden');
  document.getElementById('file-selected-area').classList.add('hidden');
  document.getElementById('import-format-badge').innerHTML = '';
}

// ── Processing ────────────────────────────────────────────────────────────────

async function processSelectedFile() {
  if (!_selectedFile) return;

  let text;
  try {
    text = await _selectedFile.text();
  } catch {
    showToast('Could not read file', 'error');
    return;
  }

  const { headers, rows } = parseCSV(text);

  if (headers.length === 0 || rows.length === 0) {
    showToast('CSV appears empty or unreadable', 'error');
    return;
  }

  _headers     = headers;
  _rawRows     = rows;
  _fingerprint = fingerprintHeaders(headers);

  const known = detectFormat(_fingerprint);
  if (known) {
    _mapping = known;
    const badge = document.getElementById('import-format-badge');
    badge.innerHTML = '<span class="format-badge">✓ ' + known.name + '</span>';
    await startCategorization();
  } else {
    buildMapperUI();
    showStep('mapper');
  }
}

// ── Column mapper ─────────────────────────────────────────────────────────────

function buildMapperUI() {
  // Preview table (headers + up to 3 data rows)
  const previewRows = [_headers, ..._rawRows.slice(0, 3)];
  const wrap = document.getElementById('mapper-preview-wrap');
  wrap.innerHTML = '';
  const table = document.createElement('table');
  previewRows.forEach((row, ri) => {
    const tr = document.createElement('tr');
    row.forEach(cell => {
      const td = document.createElement(ri === 0 ? 'th' : 'td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);

  // Populate column selects
  ['mapper-date', 'mapper-amount', 'mapper-item'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    _headers.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i + ': ' + h;
      sel.appendChild(opt);
    });
  });

  // Auto-detect best columns
  const { dateIdx, amountIdx, itemIdx } = autoDetectColumns(_headers);
  if (dateIdx   >= 0) document.getElementById('mapper-date').value   = dateIdx;
  if (amountIdx >= 0) document.getElementById('mapper-amount').value = amountIdx;
  if (itemIdx   >= 0) document.getElementById('mapper-item').value   = itemIdx;

  document.getElementById('mapper-name').value = '';
  document.getElementById('mapper-is-amex').checked = false;
}

function handleMapperConfirm() {
  const name = document.getElementById('mapper-name').value.trim();
  if (!name) { showToast('Give this format a name', 'error'); return; }

  _mapping = {
    name,
    dateCol:   parseInt(document.getElementById('mapper-date').value,   10),
    amountCol: parseInt(document.getElementById('mapper-amount').value, 10),
    itemCol:   parseInt(document.getElementById('mapper-item').value,   10),
    isAmexHint: document.getElementById('mapper-is-amex').checked,
  };

  saveFormat(_fingerprint, _mapping);
  startCategorization();
}

// ── Categorization ────────────────────────────────────────────────────────────

async function startCategorization() {
  const parsed = applyMapping(_rawRows, _mapping);

  if (parsed.length === 0) {
    showToast('No valid expenses found — check column mapping', 'error');
    showStep('mapper');
    return;
  }

  const capped   = parsed.length > 200;
  const toReview = capped ? parsed.slice(0, 200) : parsed;

  if (capped) showToast(`File has ${parsed.length} rows — showing first 200 for review`, '');

  showStep('categorizing');

  let categories;
  try {
    const { webAppUrl } = getState();
    if (!webAppUrl) throw new Error('Web App URL not configured');
    categories = await categorizeExpenses(toReview.map(r => ({ item: r.item, amount: r.amount })));
  } catch {
    categories = toReview.map(() => ({ category: 'Other', confidence: 'low' }));
    showToast('Categorization failed — please assign manually', 'error');
  }

  let duplicateKeys = new Set();
  try { duplicateKeys = await checkDuplicates(toReview); } catch { /* non-critical */ }

  _categorized = toReview.map((row, i) => ({
    ...row,
    category:    categories[i]?.category   || 'Other',
    confidence:  categories[i]?.confidence || 'low',
    isDuplicate: duplicateKeys.has(row.date + '|' + row.item + '|' + row.amount),
  }));
  _categorized._allParsed = parsed;

  renderReviewTable();
  showStep('review');

  // Default payer
  const payer = (_mapping.isAmexHint || _mapping.name?.toLowerCase().includes('amex'))
    ? 'Mattias'
    : (getState().user?.name || 'Mattias');
  document.querySelectorAll('#import-payer-toggle .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === payer);
  });
}

// ── Duplicate detection ───────────────────────────────────────────────────────

async function checkDuplicates(parsed) {
  const data = await getRecentExpenses();
  const existing = new Set(
    (data.rows || []).map(r => r[1] + '|' + r[2] + '|' + r[3])
  );
  const keys = new Set();
  parsed.forEach(r => {
    const k = r.date + '|' + r.item + '|' + r.amount;
    if (existing.has(k)) keys.add(k);
  });
  return keys;
}

// ── Review table ──────────────────────────────────────────────────────────────

function renderReviewTable() {
  const list = document.getElementById('import-review-list');
  list.innerHTML = '';

  const total = _categorized._allParsed?.length ?? _categorized.length;
  document.getElementById('import-count-label').textContent =
    _categorized.length + ' shown for review';
  document.getElementById('import-submit-btn').textContent =
    'Import ' + total + ' expense' + (total !== 1 ? 's' : '');
  document.getElementById('import-submit-btn').disabled = false;

  const catOptions = CATEGORIES.map(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    return o;
  });

  _categorized.forEach((item, idx) => list.appendChild(buildReviewCard(item, idx, catOptions)));

  list.addEventListener('change', handleReviewChange);
  list.addEventListener('click',  handleReviewClick);
}

function buildReviewCard(item, idx, catOptions) {
  const isFlagged = item.isDuplicate ||
    item.category === 'Shopping' || item.category === 'Gifts' || item.confidence === 'low';

  const card = document.createElement('div');
  card.className = 'review-item' +
    (item.isDuplicate ? ' review-item-duplicate' : isFlagged ? ' review-item-flagged' : '');
  card.dataset.idx = idx;

  // Top: date + amount
  const top = document.createElement('div');
  top.className = 'review-item-top';
  const dateEl = document.createElement('span');
  dateEl.className = 'review-item-date';
  dateEl.textContent = item.date;
  const amountEl = document.createElement('span');
  amountEl.className = 'review-item-amount';
  amountEl.textContent = item.amount.toLocaleString('sv-SE') + ' kr';
  top.appendChild(dateEl);
  top.appendChild(amountEl);

  // Name input
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'review-item-name';
  nameInput.value = item.item;
  nameInput.dataset.idx = idx;
  nameInput.dataset.role = 'name';

  // Bottom: category + badge + extras
  const bottom = document.createElement('div');
  bottom.className = 'review-item-bottom';

  const catWrap = document.createElement('div');
  catWrap.className = 'review-cat-wrap';

  const catSelect = document.createElement('select');
  catSelect.className = 'review-cat-select';
  catSelect.dataset.idx = idx;
  catSelect.dataset.role = 'category';
  catOptions.forEach(o => catSelect.appendChild(o.cloneNode(true)));
  catSelect.value = item.category;

  const badge = document.createElement('span');
  badge.className = 'badge badge-confidence-' + item.confidence;
  badge.textContent = item.confidence;

  catWrap.appendChild(catSelect);
  catWrap.appendChild(badge);
  bottom.appendChild(catWrap);

  if (item.category === 'Food & Drink') bottom.appendChild(makeDateNightLabel(idx));
  if (item.isDuplicate) {
    const warn = document.createElement('span');
    warn.className = 'duplicate-warn';
    warn.textContent = '⚠ may already exist';
    bottom.appendChild(warn);
  }

  // Budget toggle (Joint / Personal)
  const defaultBudget = JOINT_CATEGORIES.includes(item.category) ? 'joint' : 'personal';
  const budgetRow = document.createElement('div');
  budgetRow.className = 'review-budget-row';

  ['joint', 'personal'].forEach(val => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'budget-btn' + (val === defaultBudget ? ' active' : '');
    btn.dataset.idx = idx;
    btn.dataset.role = 'budget';
    btn.dataset.value = val;
    btn.textContent = val === 'joint' ? 'Joint' : 'Personal';
    budgetRow.appendChild(btn);
  });

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'review-remove-btn';
  removeBtn.dataset.idx = idx;
  removeBtn.dataset.role = 'remove';
  removeBtn.title = 'Skip this row';
  removeBtn.textContent = '×';

  card.appendChild(top);
  card.appendChild(nameInput);
  card.appendChild(bottom);
  card.appendChild(budgetRow);
  card.appendChild(removeBtn);
  return card;
}

function makeDateNightLabel(idx) {
  const label = document.createElement('label');
  label.className = 'date-night-label';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.dataset.idx = idx;
  chk.dataset.role = 'datenight';
  label.appendChild(chk);
  label.appendChild(document.createTextNode('Date night'));
  return label;
}

function handleReviewChange(e) {
  const idx  = parseInt(e.target.dataset.idx, 10);
  if (isNaN(idx)) return;
  const card = e.target.closest('.review-item');

  if (e.target.dataset.role === 'category') {
    const newCat = e.target.value;
    card.classList.toggle('review-item-flagged',
      newCat === 'Shopping' || newCat === 'Gifts' ||
      (_categorized[idx]?.confidence === 'low' && newCat !== 'Date'));
    const bottom   = card.querySelector('.review-item-bottom');
    const existing = bottom.querySelector('.date-night-label');
    if (newCat === 'Food & Drink' && !existing) {
      bottom.insertBefore(makeDateNightLabel(idx), card.querySelector('.review-remove-btn'));
    } else if (newCat !== 'Food & Drink' && existing) {
      existing.remove();
    }
  }

  if (e.target.dataset.role === 'datenight') {
    const sel = card.querySelector('.review-cat-select');
    sel.value = e.target.checked ? 'Date' : 'Food & Drink';
    card.classList.remove('review-item-flagged');
  }
}

function handleReviewClick(e) {
  const btn = e.target.closest('[data-role]');
  if (!btn) return;

  if (btn.dataset.role === 'remove') {
    const card = btn.closest('.review-item');
    card.style.display = 'none';
    card.dataset.removed = 'true';
    return;
  }

  if (btn.dataset.role === 'budget') {
    const card = btn.closest('.review-item');
    card.querySelectorAll('[data-role="budget"]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}

// ── Import submit ─────────────────────────────────────────────────────────────

async function handleImport() {
  const { user, webAppUrl } = getState();
  if (!webAppUrl) { showToast('Configure the Web App URL first', 'error'); return; }
  if (!user)      { showToast('Not signed in', 'error'); return; }

  const paidBy = document.querySelector('#import-payer-toggle .seg-btn.active')?.dataset.value
    || user.name;

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const reviewedRows  = collectReviewState();
  const allParsed     = _categorized._allParsed || [];
  const hiddenRows    = allParsed.slice(_categorized.length).map(r => ({
    date: r.date, item: r.item, amount: r.amount, category: 'Other', originalCategory: 'Other',
  }));
  const finalRows = [...reviewedRows, ...hiddenRows];

  if (finalRows.length === 0) { showToast('No expenses to import', 'error'); return; }

  const btn = document.getElementById('import-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  // Split rows by destination sheet
  const personalSheet = SHEET_NAMES[user.name.toLowerCase()] || SHEET_NAMES.mattias;

  const bySheet = {};
  finalRows.forEach(r => {
    const sheet = r.budget === 'joint' ? SHEET_NAMES.joint : personalSheet;
    const rowPaidBy = r.budget === 'joint' ? paidBy : user.name;
    if (!bySheet[sheet]) bySheet[sheet] = [];
    bySheet[sheet].push([timestamp, r.date, r.item, r.amount, r.category, 'Ja', rowPaidBy]);
  });

  try {
    await Promise.all(
      Object.entries(bySheet).map(([sheet, rows]) => batchImportExpenses(rows, sheet))
    );

    // Fire-and-forget corrections
    reviewedRows.forEach((r, i) => {
      if (r.category !== (_categorized[i]?.category)) {
        saveCorrection(r.item, _categorized[i]?.category || 'Other', r.category).catch(() => {});
      }
    });

    showToast(finalRows.length + ' expenses imported ✓', 'success');
    resetImport();

  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Import ' + finalRows.length + ' expense' + (finalRows.length !== 1 ? 's' : '');
  }
}

function collectReviewState() {
  return Array.from(
    document.querySelectorAll('#import-review-list .review-item:not([data-removed="true"])')
  ).map(card => {
    const idx    = parseInt(card.dataset.idx, 10);
    const active = card.querySelector('[data-role="budget"].active');
    return {
      date:             card.querySelector('.review-item-date').textContent,
      item:             card.querySelector('.review-item-name').value.trim(),
      amount:           _categorized[idx]?.amount ?? 0,
      category:         card.querySelector('.review-cat-select').value,
      originalCategory: _categorized[idx]?.category || 'Other',
      budget:           active?.dataset.value || 'personal',
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showStep(name) {
  ['upload', 'mapper', 'categorizing', 'review'].forEach(s => {
    const el = document.getElementById('import-step-' + s);
    if (el) el.classList.toggle('hidden', s !== name);
  });
}

function resetImport() {
  _selectedFile = null;
  _rawRows      = [];
  _headers      = [];
  _fingerprint  = '';
  _mapping      = null;
  _categorized  = [];

  document.getElementById('file-pick-area').classList.remove('hidden');
  document.getElementById('file-selected-area').classList.add('hidden');
  document.getElementById('import-format-badge').innerHTML = '';
  document.getElementById('import-review-list').innerHTML = '';
  document.getElementById('import-submit-btn').disabled = true;

  showStep('upload');
}
