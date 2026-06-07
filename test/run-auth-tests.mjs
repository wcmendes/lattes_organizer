/**
 * Node.js test runner for auth.js
 * Uses minimal DOM/browser simulation to test auth logic.
 */

// --- Minimal browser API simulation ---

// localStorage simulation
const store = {};
globalThis.localStorage = {
  getItem(key) { return store[key] ?? null; },
  setItem(key, value) { store[key] = String(value); },
  removeItem(key) { delete store[key]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); },
};

// window/location simulation
globalThis.window = {
  location: { hash: '', href: '' },
  addEventListener() {},
  removeEventListener() {},
};

// document simulation
globalThis.document = {
  getElementById() { return null; },
};

// Default fetch simulation
globalThis.fetch = async (url) => {
  if (url.includes('oauth2.googleapis.com/revoke')) {
    return { ok: false, status: 500, json: async () => ({}) };
  }
  if (url.includes('oauth2/v3/tokeninfo')) {
    return { ok: false, status: 401, json: async () => ({}) };
  }
  if (url.includes('oauth2/v3/userinfo')) {
    return { ok: false, status: 401, json: async () => ({}) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

// google GIS is NOT loaded initially
// We intentionally do NOT define globalThis.google

// --- Import auth module ---
const {
  initAuth,
  signIn,
  signOut,
  validateToken,
  getToken,
  isAuthenticated,
  getUserName,
} = await import('../js/auth.js');

// --- Test Framework ---
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'suite', name, fn });
}

function it(name, fn) {
  tests.push({ type: 'test', name, fn });
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

// --- Helpers ---
const TOKEN_KEY = 'comprova_lattes_token';

function clearStorage() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.hash = '';
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
    stored_at: Date.now() - (4000 * 1000), // well past 3600s expiry
    user_name: 'Expired User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

// --- Define Tests ---

describe('getToken — Req 1.3 (token retrieval from localStorage)', () => {
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
    getToken();
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
  });

  it('should handle token with missing stored_at gracefully (assume valid)', () => {
    clearStorage();
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: 'ya29.no-timestamp',
      expires_in: '3600'
    }));
    assertEqual(getToken(), 'ya29.no-timestamp');
  });

  it('should handle token with missing expires_in gracefully (assume valid)', () => {
    clearStorage();
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: 'ya29.no-expiry',
      stored_at: Date.now()
    }));
    assertEqual(getToken(), 'ya29.no-expiry');
  });
});

describe('isAuthenticated — Auth guard for router', () => {
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

describe('getUserName — Display name for nav bar', () => {
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

  it('should return null when user_name is explicitly null', () => {
    clearStorage();
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: 'ya29.test',
      stored_at: Date.now(),
      expires_in: '3600',
      user_name: null
    }));
    assertNull(getUserName());
  });
});

describe('validateToken — Req 1.4, 1.5 (token validation)', () => {
  it('should return false when no token is stored', async () => {
    clearStorage();
    const result = await validateToken();
    assertEqual(result, false);
  });

  it('should return false and clear storage when token is locally expired', async () => {
    clearStorage();
    setExpiredToken();
    const result = await validateToken();
    assertEqual(result, false);
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
  });

  it('should redirect to login when token is expired', async () => {
    clearStorage();
    setExpiredToken();
    window.location.hash = '';
    await validateToken();
    assertEqual(window.location.hash, '#login');
  });

  it('should return false when tokeninfo endpoint rejects', async () => {
    clearStorage();
    setValidToken();
    const result = await validateToken();
    assertEqual(result, false);
  });

  it('should return true when tokeninfo endpoint confirms valid token', async () => {
    clearStorage();
    setValidToken();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('oauth2/v3/tokeninfo')) {
        return { ok: true, json: async () => ({ expires_in: '3500' }) };
      }
      return originalFetch(url);
    };
    const result = await validateToken();
    assertEqual(result, true);
    globalThis.fetch = originalFetch;
  });

  it('should return false when tokeninfo returns expires_in of 0', async () => {
    clearStorage();
    setValidToken();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('oauth2/v3/tokeninfo')) {
        return { ok: true, json: async () => ({ expires_in: '0' }) };
      }
      return originalFetch(url);
    };
    const result = await validateToken();
    assertEqual(result, false);
    globalThis.fetch = originalFetch;
  });
});

describe('signOut — Req 1.6, 1.9 (logout and revocation fail-safe)', () => {
  it('should clear localStorage even when no token exists', async () => {
    clearStorage();
    await signOut();
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
  });

  it('should redirect to #login after sign out', async () => {
    clearStorage();
    setValidToken();
    window.location.hash = '#dashboard';
    await signOut();
    assertEqual(window.location.hash, '#login');
  });

  it('should clear localStorage even when revocation fails (Req 1.9)', async () => {
    clearStorage();
    setValidToken();
    await signOut();
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
    assertEqual(window.location.hash, '#login');
  });

  it('should work when revocation succeeds', async () => {
    clearStorage();
    setValidToken();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('oauth2.googleapis.com/revoke')) {
        return { ok: true, json: async () => ({}) };
      }
      return originalFetch(url);
    };
    await signOut();
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
    assertEqual(window.location.hash, '#login');
    globalThis.fetch = originalFetch;
  });
});

describe('signIn — Req 1.2, 1.8 (OAuth2 flow initiation)', () => {
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
  it('should handle missing GIS library gracefully (no throw)', () => {
    clearStorage();
    try {
      initAuth({ clientId: 'test-client-id.apps.googleusercontent.com' });
      assert(true, 'Did not throw');
    } catch (e) {
      assert(false, `Should not throw: ${e.message}`);
    }
  });

  it('should accept custom scopes without error', () => {
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

  it('should work with GIS library present', () => {
    let initCalled = false;
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient(config) {
            initCalled = true;
            assertEqual(config.client_id, 'my-client-id');
            assert(config.scope.includes('spreadsheets'), 'Should include spreadsheets scope');
            assert(config.scope.includes('drive.file'), 'Should include drive scope');
            return { requestAccessToken() {} };
          }
        }
      }
    };

    initAuth({ clientId: 'my-client-id' });
    assert(initCalled, 'GIS initTokenClient should have been called');
    delete globalThis.google;
  });
});

// --- Run all tests ---
async function runAll() {
  for (const entry of tests) {
    if (entry.type === 'suite') {
      console.log(`\n  ${entry.name}`);
      entry.fn();
    } else if (entry.type === 'test') {
      try {
        const result = entry.fn();
        if (result && typeof result.then === 'function') {
          await result;
        }
        console.log(`    \x1b[32m✓\x1b[0m ${entry.name}`);
        passed++;
      } catch (e) {
        console.log(`    \x1b[31m✗\x1b[0m ${entry.name}`);
        console.log(`      \x1b[33m${e.message}\x1b[0m`);
        failed++;
      }
    }
  }

  console.log(`\n  \x1b[${failed > 0 ? '31' : '32'}m${passed} passing, ${failed} failing\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
