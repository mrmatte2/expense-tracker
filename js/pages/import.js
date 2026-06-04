import { getState } from '../state.js';
import { categorizeExpenses, batchImportExpenses, saveCorrection, getRecentExpenses } from '../api.js';
import { parseCSV, fingerprintHeaders, detectFormat, saveFormat, applyMapping, autoDetectColumns } from '../csv.js';
import { CATEGORIES } from '../categories.js';
import { showToast } from '../utils.js';

// ── Module state ──────────────────────────────────────────────────────────────

let _rawRows    = [];   // string[][] from parseCSV (excludes header row)
let _headers    = [];   // string[]
let _fingerprint = '';
let _mapping    = null; // { name, dateCol, amountCol, itemCol }
let _categorized = [];  // frozen AI output: [{date, item, amount, category, confidence, isDuplicate}]

// ── Init / enter ──────────────────────────────────────────────────────────────

export function initImportPage() {
  // Drop zone
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  dropZone.addEventListener('click', () => document.getElementById('csv-file').click());

  document.getElementById('csv-browse-btn').addEventListener('click', e => {
    e.stopPropagation(); // prevent double-fire from drop zone click
    document.getElementById('csv-file').click();
  });
  document.getElementById('csv-file').addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // Mapper
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
  // Preserve review state if mid-flow; only reset when no data loaded
  if (_categorized.length === 0 && _rawRows.length === 0) {
    showStep('upload');
  }
}

// ── File handling ─────────────────────────────────────────────────────────────

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please upload a CSV file', 'error');
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch {
    showToast('Could not read file', 'error');
    return;
  }

  const { headers, rows } = parseCSV(text);

  if (headers.length === 0 || rows.length === 0) {
    showToast('CSV appears empty or unreadable', 'error');
    return;
  }

  _headers = headers;
  _rawRows = rows;
  _fingerprint = fingerprintHeaders(headers);

  const known = detectFormat(_fingerprint);
  if (known) {
    const badge = document.getElementById('import-format-badge');
    badge.innerHTML = '';
    const pill = document.createElement('span');
    pill.className = 'format-badge';
    pill.textContent = '✓ Format recognized: ' + known.name;
    badge.appendChild(pill);
    badge.classList.remove('hidden');
    _mapping = known;
    await startCategorization();
  } else {
    document.getElementById('import-format-badge').classList.add('hidden');
    buildMapperUI();
    showStep('mapper');
  }
}

// ── Column mapper ─────────────────────────────────────────────────────────────

function buildMapperUI() {
  // Preview table (first 4 rows incl. headers)
  const previewRows = [_headers, ..._rawRows.slice(0, 3)];
  const wrap = document.getElementById('mapper-preview-wrap');
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
  wrap.innerHTML = '';
  wrap.appendChild(table);

  // Populate column selects
  const optionsHTML = _headers.map((h, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i}: ${h}`;
    return opt;
  });

  ['mapper-date', 'mapper-amount', 'mapper-item'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    optionsHTML.forEach(o => sel.appendChild(o.cloneNode(true)));
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
    showToast('No valid expenses found in CSV', 'error');
    showStep('upload');
    return;
  }

  const capped = parsed.length > 200;
  const toReview = capped ? parsed.slice(0, 200) : parsed;
  const toImport = parsed; // all rows go to import, only first 200 shown in review

  if (capped) {
    showToast(`File has ${parsed.length} rows — showing first 200 for review. All will be imported.`, '');
  }

  showStep('categorizing');

  let categories;
  try {
    const { webAppUrl } = getState();
    if (!webAppUrl) throw new Error('Web App URL not configured');
    categories = await categorizeExpenses(toReview.map(r => ({ item: r.item, amount: r.amount })));
  } catch {
    categories = toReview.map(() => ({ category: 'Other', confidence: 'low' }));
    showToast('Categorization failed — defaulted to Other', 'error');
  }

  // Check for duplicates (best-effort — don't block on failure)
  let duplicateKeys = new Set();
  try {
    duplicateKeys = await checkDuplicates(toReview);
  } catch {
    // ignore — duplicate detection is non-critical
  }

  // Freeze AI output as module state
  _categorized = toReview.map((row, i) => ({
    ...row,
    category:     categories[i]?.category    || 'Other',
    confidence:   categories[i]?.confidence  || 'low',
    isDuplicate:  duplicateKeys.has(`${row.date}|${row.item}|${row.amount}`),
    _allRows:     i === 0 ? toImport : undefined, // carry full list on first item
  }));

  // Store all rows for import (may be > 200)
  _categorized._allParsed = toImport;

  renderReviewTable();
  showStep('review');

  // Set default payer
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
  const existing = new Set();
  if (Array.isArray(data.rows)) {
    for (const row of data.rows) {
      // row: [timestamp, purchaseDate, item, amount, category, betalad, paidBy]
      const key = `${row[1]}|${row[2]}|${row[3]}`;
      existing.add(key);
    }
  }
  const keys = new Set();
  for (const r of parsed) {
    if (existing.has(`${r.date}|${r.item}|${r.amount}`)) {
      keys.add(`${r.date}|${r.item}|${r.amount}`);
    }
  }
  return keys;
}

// ── Review table ──────────────────────────────────────────────────────────────

function renderReviewTable() {
  const list = document.getElementById('import-review-list');
  list.innerHTML = '';

  const count = _categorized.length;
  document.getElementById('import-count-label').textContent = `${count} expense${count !== 1 ? 's' : ''}`;

  const totalCount = _categorized._allParsed?.length ?? count;
  const submitBtn = document.getElementById('import-submit-btn');
  submitBtn.textContent = `Import ${totalCount} expense${totalCount !== 1 ? 's' : ''}`;
  submitBtn.disabled = false;

  const catOptions = CATEGORIES.map(c => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    return o;
  });

  _categorized.forEach((item, idx) => {
    const card = buildReviewCard(item, idx, catOptions);
    list.appendChild(card);
  });

  // Single event delegation on the list
  list.addEventListener('change', handleReviewChange);
  list.addEventListener('click',  handleReviewClick);
}

function buildReviewCard(item, idx, catOptions) {
  const flagged = item.confidence === 'low' || item.isDuplicate;
  const card = document.createElement('div');
  card.className = 'review-item' +
    (item.isDuplicate  ? ' review-item-duplicate' :
     item.confidence !== 'high' && item.confidence !== 'medium' ? ' review-item-flagged' :
     item.category === 'Shopping' || item.category === 'Gifts' ? ' review-item-flagged' : '');
  card.dataset.idx = idx;

  // Top row: date + amount
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

  // Bottom row: category select + badge + optional date-night + remove
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

  const confidenceClass = `badge badge-confidence-${item.confidence}`;
  const badge = document.createElement('span');
  badge.className = confidenceClass;
  badge.textContent = item.confidence;

  catWrap.appendChild(catSelect);
  catWrap.appendChild(badge);

  bottom.appendChild(catWrap);

  // Date night toggle for Food & Drink
  if (item.category === 'Food & Drink') {
    bottom.appendChild(makeDateNightLabel(idx));
  }

  // Duplicate warning
  if (item.isDuplicate) {
    const warn = document.createElement('span');
    warn.className = 'duplicate-warn';
    warn.textContent = '⚠ may already exist';
    bottom.appendChild(warn);
  }

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
  const idx = parseInt(e.target.dataset.idx, 10);
  if (isNaN(idx)) return;
  const card = e.target.closest('.review-item');

  if (e.target.dataset.role === 'category') {
    const newCat = e.target.value;
    // Update flagging classes
    card.classList.toggle('review-item-flagged',
      newCat === 'Shopping' || newCat === 'Gifts' ||
      (_categorized[idx]?.confidence === 'low' && newCat !== 'Date'));

    // Show/hide date night toggle
    const bottom = card.querySelector('.review-item-bottom');
    const existing = bottom.querySelector('.date-night-label');
    if (newCat === 'Food & Drink' && !existing) {
      bottom.insertBefore(makeDateNightLabel(idx), bottom.querySelector('.review-remove-btn'));
    } else if (newCat !== 'Food & Drink' && existing) {
      existing.remove();
    }
  }

  if (e.target.dataset.role === 'datenight') {
    const catSelect = card.querySelector('.review-cat-select');
    catSelect.value = e.target.checked ? 'Date' : 'Food & Drink';
    card.classList.remove('review-item-flagged');
  }
}

function handleReviewClick(e) {
  const btn = e.target.closest('[data-role="remove"]');
  if (!btn) return;
  const card = btn.closest('.review-item');
  card.style.display = 'none';
  card.dataset.removed = 'true';
  updateImportCount();
}

function updateImportCount() {
  const visible = document.querySelectorAll('#import-review-list .review-item:not([data-removed="true"])').length;
  const totalImport = (_categorized._allParsed?.length ?? _categorized.length) -
    document.querySelectorAll('#import-review-list .review-item[data-removed="true"]').length;
  document.getElementById('import-count-label').textContent =
    `${visible} expense${visible !== 1 ? 's' : ''}`;
  const submitBtn = document.getElementById('import-submit-btn');
  submitBtn.textContent = `Import ${totalImport} expense${totalImport !== 1 ? 's' : ''}`;
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function handleImport() {
  const { user, webAppUrl } = getState();
  if (!webAppUrl) { showToast('Configure the Web App URL first', 'error'); return; }
  if (!user)      { showToast('Not signed in', 'error'); return; }

  const paidBy = document.querySelector('#import-payer-toggle .seg-btn.active')?.dataset.value
    || user.name;

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // Collect reviewed rows (visible in review UI)
  const reviewedRows = collectReviewState();

  // Rows not shown in review UI (only when file had > 200 rows)
  const allParsed = _categorized._allParsed || [];
  const hiddenRows = allParsed.slice(_categorized.length).map(r => ({
    date: r.date, item: r.item, amount: r.amount,
    category: 'Other', originalCategory: 'Other',
  }));

  const finalRows = [...reviewedRows, ...hiddenRows];

  if (finalRows.length === 0) {
    showToast('No expenses to import', 'error');
    return;
  }

  const btn = document.getElementById('import-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  const sheetRows = finalRows.map(r => [
    timestamp,
    r.date,
    r.item,
    r.amount,
    r.category,
    'Ja',
    paidBy,
  ]);

  try {
    await batchImportExpenses(sheetRows);

    // Fire-and-forget corrections (compare against frozen _categorized)
    reviewedRows.forEach((r, i) => {
      if (r.category !== (_categorized[i]?.category)) {
        saveCorrection(r.item, _categorized[i]?.category || 'Other', r.category).catch(() => {});
      }
    });

    showToast(`${sheetRows.length} expenses imported ✓`, 'success');
    resetImport();

  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = `Import ${finalRows.length} expense${finalRows.length !== 1 ? 's' : ''}`;
  }
}

function collectReviewState() {
  const cards = document.querySelectorAll('#import-review-list .review-item:not([data-removed="true"])');
  return Array.from(cards).map(card => {
    const idx = parseInt(card.dataset.idx, 10);
    return {
      date:              card.querySelector('.review-item-date').textContent,
      item:              card.querySelector('.review-item-name').value.trim(),
      amount:            _categorized[idx]?.amount ?? 0,
      category:          card.querySelector('.review-cat-select').value,
      originalCategory:  _categorized[idx]?.category || 'Other',
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showStep(name) {
  ['upload', 'mapper', 'categorizing', 'review'].forEach(s => {
    const el = document.getElementById(`import-step-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  });
}

function resetImport() {
  _rawRows     = [];
  _headers     = [];
  _fingerprint = '';
  _mapping     = null;
  _categorized = [];

  const fileInput = document.getElementById('csv-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('import-format-badge').classList.add('hidden');
  document.getElementById('import-review-list').innerHTML = '';
  document.getElementById('import-submit-btn').disabled = true;

  showStep('upload');
}
