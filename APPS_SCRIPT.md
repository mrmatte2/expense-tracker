# Apps Script Additions

Add the following to your existing Google Apps Script project.
These are **additions** to your existing `doPost` / `doGet` handlers — do not replace existing code.

---

## 1. Setup: Claude API key

In the Apps Script editor, go to **Project Settings → Script Properties** and add:

| Property | Value |
|---|---|
| `CLAUDE_API_KEY` | Your Anthropic API key |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` |

---

## 2. Re-authorise the script (required for external HTTP calls)

After pasting the new code:
1. Click **Run** on any function (e.g. `doGet`)
2. A new OAuth consent screen will appear asking for permission to access external services
3. Approve it — this enables `UrlFetchApp.fetch` to call the Anthropic API
4. **Re-deploy** the script as a new version (Deploy → Manage deployments → New version)

> **Privacy note:** Merchant names and amounts from your CSV are sent to Anthropic's API for categorisation. Anthropic's standard data retention policies apply.

---

## 3. Add to your `doPost` handler

Find your existing `doPost` function and add these branches alongside your existing ones:

```javascript
function doPost(e) {
  try {
    const parsed = JSON.parse(e.postData.contents);

    // --- YOUR EXISTING AUTH CHECK GOES HERE ---
    // e.g. verifyIdToken(parsed.idToken);

    const action = e.parameter.action;

    // --- YOUR EXISTING BRANCHES GO HERE ---

    // ── New: categorise expenses with Claude ──────────────────────────────
    if (action === 'categorize') {
      const results = categorizeWithClaude(parsed.items);
      return jsonResponse({ results });
    }

    // ── New: batch import rows to Joint Expenses ──────────────────────────
    if (action === 'batchImport') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName('Joint Expenses');
      if (!sh) return jsonResponse({ error: 'Sheet "Joint Expenses" not found' });
      const rows = parsed.rows;
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      return jsonResponse({ ok: true, count: rows.length });
    }

    // ── New: save a category correction ──────────────────────────────────
    if (action === 'saveCorrection') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sh = ss.getSheetByName('Corrections');
      if (!sh) {
        sh = ss.insertSheet('Corrections');
        sh.appendRow(['Merchant', 'Original', 'Corrected', 'Date']);
      }
      sh.appendRow([
        parsed.merchant,
        parsed.original,
        parsed.corrected,
        new Date().toISOString().split('T')[0],
      ]);
      return jsonResponse({ ok: true });
    }

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}
```

---

## 4. Add to your `doGet` handler

```javascript
function doGet(e) {
  try {
    // --- YOUR EXISTING AUTH CHECK GOES HERE ---

    const action = e.parameter.action;

    // --- YOUR EXISTING BRANCHES GO HERE ---

    // ── New: fetch recent expenses for duplicate detection ────────────────
    if (action === 'getExpenses') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName('Joint Expenses');
      if (!sh || sh.getLastRow() < 2) return jsonResponse({ rows: [] });
      const lastRow = sh.getLastRow();
      const startRow = Math.max(2, lastRow - 999); // last 1000 rows
      const numRows = lastRow - startRow + 1;
      const data = sh.getRange(startRow, 1, numRows, 7).getValues();
      return jsonResponse({ rows: data });
    }

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}
```

---

## 5. New helper functions (paste anywhere in the script)

```javascript
// ── Claude categorisation ─────────────────────────────────────────────────────

function categorizeWithClaude(items) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

  const model = PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL')
    || 'claude-haiku-4-5-20251001';

  const corrections = getCorrections();
  const fewShot = corrections.length > 0
    ? '\n\nApply these past corrections:\n' +
      corrections.slice(-30).map(c => `"${c.merchant}" → ${c.category}`).join('\n')
    : '';

  const itemList = items.map((it, i) => `${i + 1}. "${it.item}" — ${it.amount} kr`).join('\n');

  const systemPrompt = `You categorise Swedish household expenses. Return ONLY a valid JSON array, no other text.

Categories and rules:
- Bills: rent (hyra), utilities, insurance (försäkring), phone bills, internet
- Subscriptions: Netflix, Spotify, recurring digital services, app subscriptions
- Entertainment: movies, concerts, events, activities, gaming
- Food & Drink: restaurants, cafes, fast food, bars, takeaway (eating/drinking out)
- Groceries: ICA, Coop, Willys, Lidl, Hemköp, Mathem, Citygross — food stores for cooking at home
- Health & Wellbeing: gym, pharmacy (Apotek, Apoteket), doctor, dental, wellness
- Shopping: clothing, electronics, furniture, home goods, retail stores
- Gifts: presents for others — ALWAYS return confidence "low" (hard to distinguish from Shopping)
- Transport: SL, Uber, Bolt, taxi, parking, gas stations (OKQ8, Circle K, St1), Swiftly, ferry
- Travel: flights (Ryanair, SAS, Norwegian), hotels, vacation bookings, Airbnb
- Investment: stocks, savings, Avanza, Nordnet, pension
- Other: anything that does not fit the above
- Date: do NOT assign this — it is set manually by the user

For Shopping always return confidence "low".
For Gifts always return confidence "low".
For everything else: "high" if you are certain, "medium" if you are fairly sure, "low" if uncertain.`;

  const payload = {
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Categorise these expenses:\n${itemList}${fewShot}\n\nReturn a JSON array with one object per expense in the same order:\n[{"category":"...","confidence":"high|medium|low"},...]`,
    }],
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + response.getResponseCode() + ': ' + response.getContentText());
  }

  const result = JSON.parse(response.getContentText());
  const text = result.content[0].text.trim();

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Claude returned unexpected format: ' + text.substring(0, 200));

  const parsed = JSON.parse(match[0]);
  // Ensure we always return the same number of results as inputs
  return items.map((_, i) => parsed[i] || { category: 'Other', confidence: 'low' });
}

function getCorrections() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Corrections');
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  return data
    .filter(r => r[0] && r[2])
    .map(r => ({ merchant: r[0], category: r[2] }));
}

// Helper used in doPost / doGet
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 6. Corrections sheet format

The script will auto-create this sheet on first correction save. Structure:

| Merchant | Original | Corrected | Date |
|---|---|---|---|
| Temple bar | Other | Food & Drink | 2026-06-04 |

These rows are injected as few-shot examples into future Claude prompts (last 30 used).
