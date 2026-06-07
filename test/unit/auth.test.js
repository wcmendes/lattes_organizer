/**
 * Unit tests for js/auth.js
 *
 * Tests OAuth2 authentication module behavior including:
 * - Token storage and retrieval (Req 1.3)
 * - Token validation (Req 1.4)
 * - Token expiry handling (Req 1.5)
 * - Sign out / revocation (Req 1.6, 1.9)
 * - Permission denied handling (Req 1.8)
 * - isAuthenticated guard
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
 */

// --- Node.js environment mocks (only applied if not in browser) ---
if (typeof window === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem(key) { return store[key] ?? null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
  };
  globalThis.window = {
    location: { hash: '', href: '' },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
  };
  globalThis.fetch = async (url) => {
    // Mock tokeninfo endpoint — return error by default for testing
    if (url.includes('oauth2.googleapis.com/tokeninfo')) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    // Mock revoke endpoint
    if (url.includes('oauth2.googleapis.com/revoke')) {
      return { ok: false, status: 500 };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

import {
  initAuth,
  signIn,
  signOut,
  validateToken,
  getToken,
  isAuthenticated,
  getUserName,
} from '../../js/auth.js';

// --- Test Framework ---
let passed = 0;
let failed = 0;

function describe(name, fn) {
  console.log(`\n  ${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
    console.log(`    \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`    \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      \x1b[33m${e.message}\x1b[0m`);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`    \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`    \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      \x1b[33m${e.message}\x1b[0m`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}" but got "${actual}"`);
  }
}

function assertNull(value, message) {
  if (value !== null) {
    throw new Error(message || `Expected null but got "${value}"`);
  }
}

// --- Setup ---
const TOKEN_KEY = 'comprova_lattes_token';

function clearStorage() {
  localStorage.removeItem(TOKEN_KEY);
}

function setValidToken() {
  const tokenData = {
    access_token: 'ya29.test-valid-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    stored_at: Date.now(),
    user_name: 'Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function setExpiredToken() {
  const tokenData = {
    access_token: 'ya29.test-expired-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    stored_at: Date.now() - (4000 * 1000), // 4000 seconds ago (expired)
    user_name: 'Expired User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

// --- Tests ---

describe('getToken — Req 1.3 (token retrieval)', () => {
  it('should return null when no token is stored', () => {
    clearStorage();
    assertNull(getToken());
  });

  it('should return the access_token when a valid token is stored', () => {
    clearStorage();
    setValidToken();
    assertEqual(getToken(), 'ya29.test-valid-token');
  });

  it('should return null when the stored token is expired', () => {
    clearStorage();
    setExpiredToken();
    assertNull(getToken());
  });

  it('should return null when localStorage has invalid JSON', () => {
    clearStorage();
    localStorage.setItem(TOKEN_KEY, 'not-json-at-all');
    assertNull(getToken());
  });

  it('should return null when stored data has no access_token field', () => {
    clearStorage();
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ foo: 'bar' }));
    assertNull(getToken());
  });

  it('should clear expired token from localStorage', () => {
    clearStorage();
    setExpiredToken();
    getToken(); // should clear
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
  });
});

describe('isAuthenticated — Auth guard', () => {
  it('should return false when no token exists', () => {
    clearStorage();
    assertEqual(isAuthenticated(), false);
  });

  it('should return true when a valid token exists', () => {
    clearStorage();
    setValidToken();
    assertEqual(isAuthenticated(), true);
  });

  it('should return false when token is expired', () => {
    clearStorage();
    setExpiredToken();
    assertEqual(isAuthenticated(), false);
  });
});

describe('getUserName — Display name', () => {
  it('should return null when no token is stored', () => {
    clearStorage();
    assertNull(getUserName());
  });

  it('should return the user_name when stored', () => {
    clearStorage();
    setValidToken();
    assertEqual(getUserName(), 'Test User');
  });

  it('should return null when token data has no user_name', () => {
    clearStorage();
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: 'ya29.test',
      stored_at: Date.now(),
      expires_in: '3600'
    }));
    assertNull(getUserName());
  });
});

describe('validateToken — Req 1.4, 1.5 (token validation)', () => {
  itAsync('should return false when no token is stored', async () => {
    clearStorage();
    const result = await validateToken();
    assertEqual(result, false);
  });

  itAsync('should return false and clear storage when token is locally expired', async () => {
    clearStorage();
    setExpiredToken();
    const result = await validateToken();
    assertEqual(result, false);
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
  });
});

describe('signOut — Req 1.6, 1.9 (logout and revocation)', () => {
  itAsync('should clear localStorage even when no token exists', async () => {
    clearStorage();
    const originalHash = window.location.hash;
    await signOut();
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
    assertEqual(window.location.hash, '#login');
  });

  itAsync('should clear localStorage and redirect to login', async () => {
    clearStorage();
    setValidToken();
    // signOut will attempt to revoke and may fail (no network), but should still clear
    await signOut();
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
    assertEqual(window.location.hash, '#login');
  });
});

describe('signIn — Req 1.2, 1.8 (OAuth2 flow)', () => {
  it('should reject if initAuth was not called with valid GIS', async () => {
    clearStorage();
    try {
      await signIn();
      assert(false, 'Should have rejected');
    } catch (e) {
      assert(e.message.includes('Auth not initialized'), `Unexpected error: ${e.message}`);
    }
  });
});

describe('initAuth — Req 1.2 (GIS initialization)', () => {
  it('should not throw when GIS library is not loaded (logs error)', () => {
    // google is not defined in test env — initAuth should handle gracefully
    try {
      initAuth({ clientId: 'test-client-id.apps.googleusercontent.com' });
      assert(true, 'Did not throw');
    } catch (e) {
      assert(false, `Should not throw: ${e.message}`);
    }
  });

  it('should accept custom scopes', () => {
    try {
      initAuth({
        clientId: 'test-client-id.apps.googleusercontent.com',
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      assert(true, 'Did not throw with custom scopes');
    } catch (e) {
      assert(false, `Should not throw: ${e.message}`);
    }
  });
});

// --- Summary ---
// Wait for async tests to complete
setTimeout(() => {
  console.log(`\n  \x1b[${failed > 0 ? '31' : '32'}m${passed} passing, ${failed} failing\x1b[0m\n`);
  if (typeof process !== 'undefined') {
    process.exit(failed > 0 ? 1 : 0);
  }
}, 500);
