/**
 * app.js — entry point
 * Bootstraps auth, wires navigation, initialises page modules.
 */

import { initAuth, signOut } from './auth.js';
import { setState } from './state.js';
import { initAddPage } from './pages/add.js';
import { initHistoryPage, onHistoryEnter } from './pages/history.js';
import { initSummaryPage, onSummaryEnter } from './pages/summary.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

initAuth({
  onSuccess(user) {
    setState({ user });
    showApp(user);
  },
  onError(msg) {
    console.warn('Auth error:', msg);
  },
});

// ── Show app after auth ───────────────────────────────────────────────────────

function showApp(user) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').removeAttribute('hidden');

  // Show user name in header
  document.getElementById('header-user').textContent = user.name;

  // Sign out
  document.getElementById('signout-btn').addEventListener('click', signOut);

  // Initialise all pages
  initAddPage();
  initHistoryPage();
  initSummaryPage();

  // Wire bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

let currentPage = 'add';

function navigateTo(page) {
  if (page === currentPage) return;
  currentPage = page;

  // Swap active page
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Swap active nav button
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Page-level enter hooks
  if (page === 'history') onHistoryEnter();
  if (page === 'summary') onSummaryEnter();
}
