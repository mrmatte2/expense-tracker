/**
 * CSV parsing utilities.
 * State-machine parser — handles multi-line quoted fields, BOM, both , and ; delimiters.
 */

const FORMATS_KEY = 'csvFormats';

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse raw CSV text into headers + rows.
 * Returns { headers: string[], rows: string[][] } where rows excludes the header row.
 */
export function parseCSV(text) {
  // Strip UTF-8 BOM
  const raw = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  // Detect delimiter by counting unquoted occurrences on the first non-empty line
  const firstLine = raw.split(/\r?\n/).find(l => l.trim());
  const delimiter = detectDelimiter(firstLine || '');

  const allRows = parseRows(raw, delimiter);
  if (allRows.length === 0) return { headers: [], rows: [] };

  const headers = allRows[0].map(h => h.trim());
  const rows = allRows.slice(1);
  return { headers, rows };
}

function detectDelimiter(line) {
  let commas = 0, semis = 0, inQuote = false;
  for (const c of line) {
    if (c === '"') { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (c === ',') commas++;
    if (c === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

function parseRows(text, delimiter) {
  const rows = [];
  let fields = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuote = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === delimiter) {
        fields.push(field.trim());
        field = '';
      } else if (c === '\r' && text[i + 1] === '\n') {
        fields.push(field.trim());
        if (fields.some(f => f !== '')) rows.push(fields);
        fields = [];
        field = '';
        i += 2;
        continue;
      } else if (c === '\n') {
        fields.push(field.trim());
        if (fields.some(f => f !== '')) rows.push(fields);
        fields = [];
        field = '';
        i++;
        continue;
      } else {
        field += c;
      }
    }
    i++;
  }

  // Last field/row
  fields.push(field.trim());
  if (fields.some(f => f !== '')) rows.push(fields);

  return rows;
}

// ── Date / Amount parsing ─────────────────────────────────────────────────────

/**
 * Normalise a date string to YYYY-MM-DD, or return null.
 * Handles: YYYY-MM-DD, DD/MM/YYYY, YYYY/MM/DD, DD-MM-YYYY.
 */
export function parseDate(str) {
  const s = str.replace(/"/g, '').trim();
  if (!s) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  return null;
}

/**
 * Parse a Swedish or English number string to a positive float, or null.
 * Handles: "1 234,56", "1234.56", "-242,00", "1 234,56" (non-breaking space).
 */
export function parseAmount(str) {
  const s = str.replace(/"/g, '').trim();
  if (!s) return null;
  // Remove thousands separators (space, non-breaking space), replace decimal comma
  const normalized = s.replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(normalized);
  if (isNaN(n) || n === 0) return null;
  return Math.abs(n);
}

// ── Format fingerprinting & storage ──────────────────────────────────────────

export function fingerprintHeaders(headers) {
  return [...headers].map(h => h.toLowerCase().trim()).sort().join('|');
}

export function detectFormat(fingerprint) {
  try {
    const formats = JSON.parse(localStorage.getItem(FORMATS_KEY) || '{}');
    return formats[fingerprint] ?? null;
  } catch {
    return null;
  }
}

export function saveFormat(fingerprint, format) {
  try {
    const formats = JSON.parse(localStorage.getItem(FORMATS_KEY) || '{}');
    formats[fingerprint] = format;
    localStorage.setItem(FORMATS_KEY, JSON.stringify(formats));
  } catch {
    // localStorage unavailable — silently skip
  }
}

// ── Column mapping ────────────────────────────────────────────────────────────

/**
 * Apply a saved column mapping to parsed rows.
 * Returns [{date, item, amount}] with nulls filtered out.
 */
export function applyMapping(rows, mapping) {
  const { dateCol, amountCol, itemCol } = mapping;
  const maxCol = Math.max(dateCol, amountCol, itemCol);
  return rows
    .filter(r => r.length > maxCol)
    .map(r => ({
      date:   parseDate(r[dateCol] || ''),
      item:   (r[itemCol] || '').trim(),
      amount: parseAmount(r[amountCol] || ''),
    }))
    .filter(r => r.date !== null && r.amount !== null && r.item !== '');
}

/**
 * Guess the best column index for date, amount, and item description
 * by matching common Swedish/English header keywords.
 * Returns { dateIdx, amountIdx, itemIdx } — values may be -1 if no match found.
 */
export function autoDetectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());

  const find = (keywords) => lower.findIndex(h => keywords.some(k => h.includes(k)));

  return {
    dateIdx:   find(['date', 'datum', 'transaktionsdatum', 'bokföringsdatum', 'booking', 'purchase']),
    amountIdx: find(['amount', 'belopp', 'summa', 'debit', 'kredit', 'sek', 'kronor']),
    itemIdx:   find(['description', 'merchant', 'text', 'specification', 'specifikation', 'butik', 'transaktion', 'benämning', 'mottagare']),
  };
}
