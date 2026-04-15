/**
 * Centralised app state.
 * Use getState() to read, setState() to patch.
 * No direct mutation outside this module.
 */

const _state = {
  /** @type {{ name: string, email: string, idToken: string } | null} */
  user: null,

  /** @type {string} Apps Script web app URL */
  webAppUrl: '',

  /** @type {'joint'|'mattias'|'melissa'} */
  budget: 'joint',

  /** @type {'Mattias'|'Melissa'|null} */
  payer: null,

  /** @type {'joint'|'mattias'|'melissa'} */
  historyBudget: 'joint',

  /** Locally cached recent additions (keyed by budget type) */
  recentEntries: { joint: [], mattias: [], melissa: [] },
};

export function getState() {
  return _state;
}

/** Shallow-merge patch into state */
export function setState(patch) {
  Object.assign(_state, patch);
}
