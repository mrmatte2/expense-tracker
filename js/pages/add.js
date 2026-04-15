import { getState, setState } from '../state.js';
import { addExpense } from '../api.js';
import { showToast } from '../utils.js';

const today = () => new Date().toISOString().split('T')[0];

// ── Init ─────────────────────────────────────────────────────────────────────

export function initAddPage() {
  document.getElementById('purchase-date').value = today();

  // Setup panel
  document.getElementById('save-setup-btn').addEventListener('click', saveSetup);
  document.getElementById('edit-setup-btn').addEventListener('click', showSetup);

  // Load saved URL
  const saved = JSON.parse(localStorage.getItem('expenseSettings') || '{}');
  if (saved.webAppUrl) {
    document.getElementById('web-app-url').value = saved.webAppUrl;
    setState({ webAppUrl: saved.webAppUrl });
    hideSetup();
  }

  // Budget toggle
  document.getElementById('budget-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    setBudget(btn.dataset.value);
  });

  // Payer toggle
  document.getElementById('payer-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    setPayer(btn.dataset.value);
  });

  // Pre-select payer based on signed-in user
  const { user } = getState();
  if (user) {
    const name = user.name; // 'Mattias' or 'Melissa'
    if (name === 'Mattias' || name === 'Melissa') setPayer(name);
  }

  // Submit
  document.getElementById('submit-btn').addEventListener('click', handleSubmit);

  // Allow Enter key on amount to submit
  document.getElementById('amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSubmit();
  });

  renderRecent();
}

// ── Setup panel ──────────────────────────────────────────────────────────────

function saveSetup() {
  const url = document.getElementById('web-app-url').value.trim();
  if (!url) { showToast('Enter the Web App URL', 'error'); return; }
  localStorage.setItem('expenseSettings', JSON.stringify({ webAppUrl: url }));
  setState({ webAppUrl: url });
  hideSetup();
  showToast('Settings saved ✓', 'success');
}

function hideSetup() {
  document.getElementById('setup-open').classList.add('hidden');
  document.getElementById('setup-closed').classList.remove('hidden');
}

function showSetup() {
  document.getElementById('setup-open').classList.remove('hidden');
  document.getElementById('setup-closed').classList.add('hidden');
}

// ── Budget / payer toggles ───────────────────────────────────────────────────

function setBudget(value) {
  setState({ budget: value, payer: null });

  // Update button states
  document.querySelectorAll('#budget-toggle .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });

  // Show payer field only for joint
  document.getElementById('payer-field').style.display = value === 'joint' ? '' : 'none';

  // Clear payer selection visually
  document.querySelectorAll('#payer-toggle .seg-btn').forEach(b => b.classList.remove('active'));

  // Pre-select payer for joint based on current user
  if (value === 'joint') {
    const { user } = getState();
    if (user?.name === 'Mattias' || user?.name === 'Melissa') setPayer(user.name);
  }

  renderRecent();
}

function setPayer(value) {
  setState({ payer: value });
  document.querySelectorAll('#payer-toggle .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

// ── Submit ───────────────────────────────────────────────────────────────────

async function handleSubmit() {
  const { webAppUrl, budget, payer } = getState();

  if (!webAppUrl) { showToast('Configure the Web App URL first', 'error'); showSetup(); return; }

  const purchaseDate = document.getElementById('purchase-date').value;
  const item         = document.getElementById('item').value.trim();
  const amount       = document.getElementById('amount').value;
  const category     = document.getElementById('category').value;

  if (!purchaseDate || !item || !amount || !category) {
    showToast('Please fill in all fields', 'error'); return;
  }
  if (budget === 'joint' && !payer) {
    showToast('Select who paid', 'error'); return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    await addExpense({ purchaseDate, item, amount, category, budgetType: budget, paidBy: payer });

    // Cache locally
    const state = getState();
    const entry = { item, amount: parseFloat(amount), payer, date: purchaseDate, category, budget };
    state.recentEntries[budget].unshift(entry);
    if (state.recentEntries[budget].length > 8) state.recentEntries[budget].pop();

    showToast('Expense added ✓', 'success');
    resetForm();
    renderRecent();

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Expense';
  }
}

function resetForm() {
  document.getElementById('item').value = '';
  document.getElementById('amount').value = '';
  document.getElementById('category').value = '';
  document.getElementById('purchase-date').value = today();

  // Keep payer selected (likely same person is still paying)
  document.getElementById('item').focus();
}

// ── Recent entries ───────────────────────────────────────────────────────────

function renderRecent() {
  const { budget, recentEntries } = getState();
  const list = document.getElementById('recent-list');
  const entries = recentEntries[budget] || [];

  if (entries.length === 0) {
    list.innerHTML = '<p class="loading-msg" style="padding:12px 4px;">No entries yet this session.</p>';
    return;
  }

  list.innerHTML = entries.map(e => `
    <div class="entry">
      <div class="entry-left">
        <span class="entry-name">${e.item}</span>
        <span class="entry-meta">${e.date} · ${e.category}${e.payer ? ' · ' + e.payer : ''}</span>
      </div>
      <span class="entry-amount">${parseFloat(e.amount).toLocaleString('sv-SE')} kr</span>
    </div>
  `).join('');
}
