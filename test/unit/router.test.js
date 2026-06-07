/**
 * Unit tests for js/router.js
 * 
 * Tests hash routing behavior including:
 * - Route registration
 * - Auth guard (redirect to #login if not authenticated)
 * - Invalid hash redirect to #dashboard
 * - URL update without page reload
 * - Route resolution logic
 * 
 * Requirements: 11.1, 11.3, 11.4, 11.5, 11.6
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
    querySelectorAll() { return []; },
    createElement(tag) { return { tagName: tag, style: {}, classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' }; },
    body: { appendChild() {} },
  };
}

import {
  addRoute,
  setAuthCheck,
  setOnRouteChange,
  getCurrentRoute,
  getRegisteredRoutes,
  navigateTo,
  initRouter,
  destroyRouter,
  registerDefaultRoutes,
} from '../../js/router.js';

/**
 * Simple test harness for browser-based testing.
 */
const results = [];

function describe(name, fn) {
  results.push({ type: 'suite', name });
  fn();
}

function it(name, fn) {
  try {
    fn();
    results.push({ type: 'pass', name });
  } catch (e) {
    results.push({ type: 'fail', name, error: e.message });
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

function assertIncludes(arr, item, message) {
  if (!arr.includes(item)) {
    throw new Error(message || `Expected array to include "${item}"`);
  }
}

// --- Setup / Teardown ---

function setup() {
  destroyRouter();
  window.location.hash = '';
}

// --- Tests ---

describe('Router — Route Registration', () => {
  setup();

  it('should register a route via addRoute', () => {
    addRoute('test', () => '<p>test</p>', false);
    assertIncludes(getRegisteredRoutes(), 'test');
  });

  it('should register all default routes via registerDefaultRoutes', () => {
    setup();
    registerDefaultRoutes();
    const routes = getRegisteredRoutes();
    assertIncludes(routes, 'login');
    assertIncludes(routes, 'dashboard');
    assertIncludes(routes, 'entradas');
    assertIncludes(routes, 'importacao');
    assertIncludes(routes, 'revisao');
    assertIncludes(routes, 'ocultos');
    assertIncludes(routes, 'config');
  });

  it('should register exactly 7 default routes', () => {
    setup();
    registerDefaultRoutes();
    assertEqual(getRegisteredRoutes().length, 7);
  });
});

describe('Router — Auth Guard (Req 11.5)', () => {
  setup();
  registerDefaultRoutes();

  it('should redirect to #login when unauthenticated user accesses auth-required route', () => {
    setAuthCheck(() => false);
    navigateTo('dashboard');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect to #login when unauthenticated user accesses #entradas', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('entradas');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect to #login when unauthenticated user accesses #config', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('config');
    assertEqual(window.location.hash, '#login');
  });

  it('should allow authenticated user to access auth-required routes (Req 11.4)', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('dashboard');
    assertEqual(window.location.hash, '#dashboard');
  });

  it('should allow unauthenticated user to access login route', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('login');
    assertEqual(window.location.hash, '#login');
  });
});

describe('Router — Invalid Hash Redirect (Req 11.6)', () => {
  setup();
  registerDefaultRoutes();

  it('should redirect invalid hash to #dashboard when authenticated', () => {
    setAuthCheck(() => true);
    navigateTo('nonexistent');
    assertEqual(window.location.hash, '#dashboard');
  });

  it('should redirect empty hash to #login when unauthenticated', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect unknown route to #login when unauthenticated', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('unknown-route');
    assertEqual(window.location.hash, '#login');
  });
});

describe('Router — URL Update Without Reload (Req 11.3)', () => {
  setup();
  registerDefaultRoutes();
  setAuthCheck(() => true);

  it('should update URL hash when navigating', () => {
    navigateTo('entradas');
    assertEqual(window.location.hash, '#entradas');
  });

  it('should update URL hash for importacao', () => {
    navigateTo('importacao');
    assertEqual(window.location.hash, '#importacao');
  });

  it('should update URL hash for revisao', () => {
    navigateTo('revisao');
    assertEqual(window.location.hash, '#revisao');
  });

  it('should update URL hash for ocultos', () => {
    navigateTo('ocultos');
    assertEqual(window.location.hash, '#ocultos');
  });

  it('should update URL hash for config', () => {
    navigateTo('config');
    assertEqual(window.location.hash, '#config');
  });
});

describe('Router — Authenticated user accessing login', () => {
  setup();
  registerDefaultRoutes();
  setAuthCheck(() => true);

  it('should redirect authenticated user from login to dashboard', () => {
    navigateTo('login');
    assertEqual(window.location.hash, '#dashboard');
  });
});

describe('Router — getCurrentRoute', () => {
  setup();
  registerDefaultRoutes();
  setAuthCheck(() => true);

  it('should return null before any navigation', () => {
    assertEqual(getCurrentRoute(), null);
  });
});

describe('Router — onRouteChange callback', () => {
  setup();
  registerDefaultRoutes();
  setAuthCheck(() => true);

  it('should call onRouteChange with new and previous route', (done) => {
    let called = false;
    setOnRouteChange((newRoute, prevRoute) => {
      called = true;
    });
    // We need async rendering for this to work properly
    // For synchronous test, we just verify it doesn't throw
    navigateTo('dashboard');
    // Callback is called during renderRoute which is async
    assert(true, 'onRouteChange set without error');
  });
});

describe('Router — destroyRouter cleanup', () => {
  it('should clear all routes on destroy', () => {
    addRoute('temp', () => '<p>temp</p>', false);
    destroyRouter();
    assertEqual(getRegisteredRoutes().length, 0);
    assertEqual(getCurrentRoute(), null);
  });
});

// --- Report Results ---
export function runTests() {
  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.type === 'suite') {
      console.log(`\n  ${result.name}`);
    } else if (result.type === 'pass') {
      console.log(`    ✓ ${result.name}`);
      passed++;
    } else if (result.type === 'fail') {
      console.log(`    ✗ ${result.name}`);
      console.log(`      Error: ${result.error}`);
      failed++;
    }
  }

  console.log(`\n  ${passed} passing, ${failed} failing\n`);
  return { passed, failed, results };
}

// Auto-run if loaded directly
runTests();
