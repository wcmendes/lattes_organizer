/**
 * Auth Module — Google Identity Services OAuth2 (Implicit Grant)
 *
 * Handles authentication via GIS token model for static sites (GitHub Pages).
 * Stores token in localStorage, validates on return, handles expiry/revocation.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
 */

const TOKEN_KEY = 'comprova_lattes_token';
const TOKENINFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** @type {google.accounts.oauth2.TokenClient|null} */
let tokenClient = null;

/** @type {{ resolve: function, reject: function }|null} */
let pendingAuth = null;

/**
 * Initializes the Google Identity Services token client.
 * Must be called once before signIn() is available.
 * @param {Object} config
 * @param {string} config.clientId - Google OAuth2 Client ID
 * @param {string[]} [config.scopes] - OAuth2 scopes (defaults to Sheets + Drive)
 */
export function initAuth(config) {
  const scopes = config.scopes || [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ];

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    console.error('[Auth] Google Identity Services library not loaded.');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope: scopes.join(' '),
    callback: handleTokenResponse,
    error_callback: handleTokenError
  });
}

/**
 * Starts the OAuth2 implicit grant flow.
 * Opens the Google consent screen via GIS.
 * @returns {Promise<string>} Resolves with the access_token on success.
 */
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Auth not initialized. Call initAuth() first.'));
      return;
    }

    pendingAuth = { resolve, reject };
    tokenClient.requestAccessToken();
  });
}

/**
 * Revokes the current token and clears local session.
 * On revocation failure, still clears localStorage (fail-safe per Req 1.9).
 * @returns {Promise<void>}
 */
export async function signOut() {
  const tokenData = getStoredTokenData();
  const accessToken = tokenData ? tokenData.access_token : null;

  if (accessToken) {
    try {
      await revokeToken(accessToken);
    } catch (error) {
      // Req 1.9: Revocation failure → still clear and redirect (fail-safe)
      console.warn('[Auth] Token revocation failed, clearing local session anyway.', error);
    }
  }

  clearToken();
  redirectToLogin();
}

/**
 * Validates the stored token against Google's tokeninfo endpoint.
 * If invalid/expired, clears localStorage and redirects to login (Req 1.5).
 * @returns {Promise<boolean>} true if token is valid, false otherwise.
 */
export async function validateToken() {
  const tokenData = getStoredTokenData();
  if (!tokenData || !tokenData.access_token) {
    return false;
  }

  // Check local expiry first
  if (isTokenExpired(tokenData)) {
    clearToken();
    redirectToLogin();
    return false;
  }

  try {
    const response = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(tokenData.access_token)}`);
    if (!response.ok) {
      clearToken();
      redirectToLogin();
      return false;
    }

    const info = await response.json();
    // Validate that the token has not expired server-side
    if (!info.expires_in || parseInt(info.expires_in, 10) <= 0) {
      clearToken();
      redirectToLogin();
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Auth] Token validation request failed:', error);
    clearToken();
    redirectToLogin();
    return false;
  }
}

/**
 * Returns the active access token string or null if not available.
 * Does NOT trigger validation — use validateToken() for that.
 * @returns {string|null}
 */
export function getToken() {
  const tokenData = getStoredTokenData();
  if (!tokenData || !tokenData.access_token) {
    return null;
  }

  if (isTokenExpired(tokenData)) {
    clearToken();
    return null;
  }

  return tokenData.access_token;
}

/**
 * Returns whether the user has a non-expired token stored.
 * Used as auth guard for the router.
 * @returns {boolean}
 */
export function isAuthenticated() {
  return getToken() !== null;
}

/**
 * Returns the user's display name from the stored token data, or null.
 * Note: GIS implicit grant does not always provide user info.
 * If available from the token response or separately fetched, it is stored.
 * @returns {string|null}
 */
export function getUserName() {
  const tokenData = getStoredTokenData();
  return tokenData ? (tokenData.user_name || null) : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Handles successful token response from GIS.
 * @param {google.accounts.oauth2.TokenResponse} response
 */
function handleTokenResponse(response) {
  if (response.error) {
    handleTokenError(response);
    return;
  }

  const tokenData = {
    access_token: response.access_token,
    token_type: response.token_type || 'Bearer',
    expires_in: response.expires_in,
    scope: response.scope,
    stored_at: Date.now(),
    user_name: null
  };

  storeToken(tokenData);

  // Fetch user info for display name (best-effort, non-blocking for redirect)
  fetchUserInfo(response.access_token).then((name) => {
    if (name) {
      tokenData.user_name = name;
      storeToken(tokenData);
    }
  }).catch(() => { /* ignore — display name is optional */ });

  if (pendingAuth) {
    pendingAuth.resolve(response.access_token);
    pendingAuth = null;
  }

  // Req 1.3: Redirect to main view (dashboard)
  redirectToDashboard();
}

/**
 * Handles errors from GIS token request.
 * Covers: user denies permissions, popup closed, etc.
 * @param {Object} error
 */
function handleTokenError(error) {
  const errorType = error.type || error.error || 'unknown';

  // Req 1.8: Permission denied → stay on login, show message
  if (pendingAuth) {
    pendingAuth.reject(new Error(`Auth error: ${errorType}`));
    pendingAuth = null;
  }
}

/**
 * Fetches the user's display name from Google's userinfo endpoint.
 * @param {string} accessToken
 * @returns {Promise<string|null>}
 */
async function fetchUserInfo(accessToken) {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.ok) {
      const data = await response.json();
      return data.name || data.email || null;
    }
  } catch (e) {
    // Non-critical — ignore
  }
  return null;
}

/**
 * Revokes the token via Google's revoke endpoint.
 * @param {string} token
 * @returns {Promise<void>}
 */
async function revokeToken(token) {
  const response = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!response.ok) {
    throw new Error(`Revocation failed with status ${response.status}`);
  }
}

/**
 * Checks if the stored token has expired based on local timestamp.
 * @param {Object} tokenData
 * @returns {boolean}
 */
function isTokenExpired(tokenData) {
  if (!tokenData.stored_at || !tokenData.expires_in) {
    return false; // Cannot determine — assume valid, let server check
  }
  const expiresAt = tokenData.stored_at + (parseInt(tokenData.expires_in, 10) * 1000);
  return Date.now() >= expiresAt;
}

/**
 * Stores token data as JSON in localStorage.
 * @param {Object} tokenData
 */
function storeToken(tokenData) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
  } catch (e) {
    console.error('[Auth] Failed to store token in localStorage:', e);
  }
}

/**
 * Retrieves stored token data from localStorage.
 * @returns {Object|null}
 */
function getStoredTokenData() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[Auth] Failed to parse stored token:', e);
    return null;
  }
}

/**
 * Removes token data from localStorage.
 */
function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    console.error('[Auth] Failed to clear token from localStorage:', e);
  }
}

/**
 * Redirects to the login view.
 */
function redirectToLogin() {
  window.location.hash = '#login';
}

/**
 * Redirects to the dashboard (main view after login).
 */
function redirectToDashboard() {
  window.location.hash = '#dashboard';
}
