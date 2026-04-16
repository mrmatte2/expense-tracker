/**
 * Google Sign-In (Identity Services) auth module.
 *
 * SETUP REQUIRED:
 * 1. Go to https://console.cloud.google.com
 * 2. Create a project → APIs & Services → Credentials
 * 3. Create an OAuth 2.0 Client ID (Web application)
 * 4. Add your GitHub Pages URL to "Authorised JavaScript origins"
 *    e.g. https://YOUR_USERNAME.github.io
 * 5. Paste the Client ID below.
 * 6. Add both Gmail addresses to ALLOWED_EMAILS.
 */

const CLIENT_ID = '408791431371-2k4ribtvhm4jc40p1p6mlec4lglo8fp5.apps.googleusercontent.com';

export const USERS = {
  'mattias.backstrom1993@gmail.com': { name: 'Mattias', swish: '0739669684' },
  'melissa.steffansson@gmail.com':   { name: 'Melissa',  swish: '0760247910' },
};

const SESSION_KEY = 'ug_user';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise auth. Calls onSuccess(user) if already signed in or once
 * sign-in completes, or onError(msg) if the account is not allowed.
 */
export function initAuth({ onSuccess, onError }) {
  // Restore from sessionStorage so the user isn't prompted on every page reload
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    try {
      const user = JSON.parse(stored);
      onSuccess(user);
      return;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  // Wait for the GIS library then initialise
  waitForGIS().then(() => {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (response) => handleCredential(response, { onSuccess, onError }),
      auto_select: true,
      cancel_on_tap_outside: false,
    });

    google.accounts.id.renderButton(
      document.getElementById('google-btn'),
      { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' }
    );

    // One Tap prompt (silently re-signs returning users)
    google.accounts.id.prompt();
  });
}

/** Clear the session and reload to show the auth screen again */
export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  if (window.google?.accounts?.id) {
    google.accounts.id.disableAutoSelect();
  }
  location.reload();
}

// ── Internal ────────────────────────────────────────────────────────────────

function handleCredential(response, { onSuccess, onError }) {
  const payload = decodeJwt(response.credential);

  if (!USERS[payload.email]) {
    const errEl = document.getElementById('auth-error');
    if (errEl) errEl.textContent = 'This Google account is not authorised.';
    if (onError) onError('Unauthorised account');
    return;
  }

  const profile = USERS[payload.email];
  const user = {
    name:    profile.name,
    swish:   profile.swish,
    email:   payload.email,
    idToken: response.credential,
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  onSuccess(user);
}

/** Decode a JWT payload without verifying the signature (verification is server-side) */
function decodeJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

/** Poll until window.google.accounts.id is available */
function waitForGIS() {
  return new Promise(resolve => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const id = setInterval(() => {
      if (window.google?.accounts?.id) { clearInterval(id); resolve(); }
    }, 50);
  });
}
