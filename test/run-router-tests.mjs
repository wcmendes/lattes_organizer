/**
 * Node.js test runner for router.js
 * Uses minimal DOM simulation to test routing logic.
 */

// Minimal DOM simulation
class MinimalElement {
  constructor(tag) {
    this.tagName = tag;
    this.innerHTML = '';
    this.children = [];
  }
}

// Simulate window and document for Node.js
const listeners = {};
globalThis.window = {
  location: { hash: '', href: '' },
  addEventListener(event, handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
  },
  removeEventListener(event, handler) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(h => h !== handler);
    }
  },
};

// Override location.hash setter to track changes
let _hash = '';
Object.defineProperty(globalThis.window.location, 'hash', {
  get() { return _hash; },
  set(value) { _hash = value; },
});

globalThis.document = {
  getElementById(id) {
    if (id === 'app') return new MinimalElement('div');
    return null;
  },
};

// Now import and run router tests
const {
  addRoute,
  setAuthCheck,
  setOnRouteChange,
  getCurrentRoute,
  getRegisteredRoutes,
  navigateTo,
  initRouter,
  destroyRouter,
  registerDefaultRoutes,
} = await import('../js/router.js');

// --- Test Framework ---
let passed = 0;
let failed = 0;
let currentSuite = '';

function describe(name, fn) {
  currentSuite = name;
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

function setup() {
  destroyRouter();
  _hash = '';
}

// --- Tests ---

describe('Router — Route Registration (Req 11.1)', () => {
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

  it('should have login as the only non-auth route', () => {
    setup();
    registerDefaultRoutes();
    // Verify login works without auth
    setAuthCheck(() => false);
    navigateTo('login');
    assertEqual(window.location.hash, '#login');
  });
});

describe('Router — Auth Guard (Req 11.5)', () => {
  it('should redirect to #login when unauthenticated user accesses #dashboard', () => {
    setup();
    registerDefaultRoutes();
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

  it('should redirect to #login when unauthenticated user accesses #importacao', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('importacao');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect to #login when unauthenticated user accesses #revisao', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('revisao');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect to #login when unauthenticated user accesses #ocultos', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('ocultos');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect to #login when unauthenticated user accesses #config', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('config');
    assertEqual(window.location.hash, '#login');
  });
});

describe('Router — Authenticated Access (Req 11.4)', () => {
  it('should allow authenticated user to access #dashboard', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('dashboard');
    assertEqual(window.location.hash, '#dashboard');
  });

  it('should allow authenticated user to access #entradas', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('entradas');
    assertEqual(window.location.hash, '#entradas');
  });

  it('should allow authenticated user to access #importacao', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('importacao');
    assertEqual(window.location.hash, '#importacao');
  });

  it('should allow authenticated user to access #config', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('config');
    assertEqual(window.location.hash, '#config');
  });
});

describe('Router — Invalid Hash Redirect (Req 11.6)', () => {
  it('should redirect invalid hash to #dashboard when authenticated', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('nonexistent');
    assertEqual(window.location.hash, '#dashboard');
  });

  it('should redirect random string to #dashboard when authenticated', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('xyz-random');
    assertEqual(window.location.hash, '#dashboard');
  });

  it('should redirect invalid hash to #login when unauthenticated', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('nonexistent');
    assertEqual(window.location.hash, '#login');
  });

  it('should redirect empty path to #login when unauthenticated', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => false);
    navigateTo('');
    assertEqual(window.location.hash, '#login');
  });
});

describe('Router — URL Update Without Reload (Req 11.3)', () => {
  it('should update URL hash to #entradas', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('entradas');
    assertEqual(window.location.hash, '#entradas');
  });

  it('should update URL hash to #revisao', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('revisao');
    assertEqual(window.location.hash, '#revisao');
  });

  it('should update URL hash to #ocultos', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('ocultos');
    assertEqual(window.location.hash, '#ocultos');
  });
});

describe('Router — Authenticated user on login page', () => {
  it('should redirect authenticated user from #login to #dashboard', () => {
    setup();
    registerDefaultRoutes();
    setAuthCheck(() => true);
    navigateTo('login');
    assertEqual(window.location.hash, '#dashboard');
  });
});

describe('Router — getCurrentRoute', () => {
  it('should return null before navigation', () => {
    setup();
    registerDefaultRoutes();
    assertEqual(getCurrentRoute(), null);
  });
});

describe('Router — destroyRouter cleanup', () => {
  it('should clear all routes on destroy', () => {
    registerDefaultRoutes();
    assert(getRegisteredRoutes().length > 0, 'Should have routes before destroy');
    destroyRouter();
    assertEqual(getRegisteredRoutes().length, 0);
    assertEqual(getCurrentRoute(), null);
  });
});

describe('Router — setAuthCheck is injectable', () => {
  it('should allow changing auth check dynamically', () => {
    setup();
    registerDefaultRoutes();

    // First unauthenticated
    setAuthCheck(() => false);
    navigateTo('dashboard');
    assertEqual(window.location.hash, '#login');

    // Now authenticate
    setAuthCheck(() => true);
    navigateTo('dashboard');
    assertEqual(window.location.hash, '#dashboard');
  });
});

// --- Summary ---
console.log(`\n  \x1b[${failed > 0 ? '31' : '32'}m${passed} passing, ${failed} failing\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
