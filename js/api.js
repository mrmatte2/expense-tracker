/**
 * All communication with the Google Apps Script web app lives here.
 * No other module should call fetch() directly.
 */

import { getState } from './state.js';

const SHEET_MAP = {
  joint:   'Joint Expenses',
  mattias: 'Mattias Expenses',
  melissa: 'Melissas Expenses',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function getUrl() {
  const { webAppUrl } = getState();
  if (!webAppUrl) throw new Error('Web App URL not configured');
  return webAppUrl;
}

function getToken() {
  const { user } = getState();
  if (!user?.idToken) throw new Error('Not signed in');
  return user.idToken;
}

/** GET request — token passed as query param */
async function apiFetch(params = {}) {
  const url = new URL(getUrl());
  url.searchParams.set('idToken', getToken());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** POST request — token in body. Uses text/plain to avoid CORS preflight. */
async function apiPost(params = {}, body = {}) {
  const url = new URL(getUrl());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...body, idToken: getToken() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Append an expense row to the appropriate sheet.
 */
export async function addExpense({ purchaseDate, item, amount, category, budgetType, paidBy }) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const row = [timestamp, purchaseDate, item, parseFloat(amount), category, 'Ja', paidBy || ''];
  return apiPost({ sheet: SHEET_MAP[budgetType] }, { row });
}

/**
 * Fetch all rows from a given expense sheet.
 * Returns raw array-of-arrays (first row is headers).
 */
export async function getExpenseSheet(budgetType) {
  return apiFetch({ sheet: SHEET_MAP[budgetType] });
}

/**
 * Fetch rows from the "Vem betalade vad" summary sheet.
 */
export async function getSummarySheet() {
  return apiFetch({ sheet: 'Vem betalade vad' });
}

/**
 * Mark a row in the summary sheet as settled.
 */
export async function settleRow(rowNumber) {
  return apiFetch({ sheet: 'Vem betalade vad', action: 'settle', row: rowNumber });
}
