/**
 * Unit tests for js/app.js
 * 
 * Tests bootstrap behavior including:
 * - CDN library verification (warning on missing, no blocking)
 * - Configuration loading on startup
 * - Router initialization with auth guard
 * - Initial navigation based on auth state (Req 11.7)
 * 
 * Requirements: 11.7, 12.7
 */

// --- Minimal DOM/Window simulation ---
const listeners = {};
let _hash = '';

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

Object.defineProperty(globalThis.window.location, 'hash', {
  get() { return _hash; },
  set(value) { _hash = value; },
});

globalThis.document = {
  readyState: 'complete',
  getElementById(id) {
    if (id === 'app') return { tagName: 'div', innerHTML: '' };
    return null;
  },
  addEventListener() {},
};

// Mock localStorage
const storage = {};
globalThis.localStorage = {
  getItem(key) { return storage[key] || null; },
  setItem(key, value) { storage[key] = value; },
  removeItem(key) { delete storage[key]; },
  clear() { Object.keys(storage).forEach(k => delete storage[k]); },
};

// Capture console output
const logs = [];
const warns = [];
const originalLog = console.log;
const originalWarn = console.warn;
console.log = (...args) => { logs.push(args.join(' ')); };
console.warn = (...args) => { warns.push(args.join(' ')); };

// --- Test Framework ---
let passed = 0;
let failed = 0;

function describe(name, fn) {
  console.log = originalLog;
  originalLog(`\n  ${name}`);
  console.log = (...args) => { logs.push(args.join(' ')); };
  fn();
}

function it(name, fn) {
  try {
    fn();
    console.log = originalLog;
    originalLog(`    \x1b[32m✓\x1b[0m ${name}`);
    console.log = (...args) => { logs.push(args.join(' ')); };
    passed++;
  } catch (e) {
    console.log = originalLog;
    originalLog(`    \x1b[31m✗\x1b[0m ${name}`);
    originalLog(`      \x1b[33m${e.message}\x1b[0m`);
    console.log = (...args) => { logs.push(args.join(' ')); };
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

// --- Import modules under test ---
// Import verifyCDNLibraries from app.js (initApp already ran on import)
const { verifyCDNLibraries } = await import('../../js/app.js');

// Import router for verification
const { getCurrentRoute, getRegisteredRoutes, destroyRouter } = await import('../../js/router.js');

// --- Tests ---

describe('App — CDN Library Verification (Req 12.7)', () => {
  it('should report missing libraries when globals are undefined', () => {
    // Clear any CDN globals
    delete globalThis.window.pdfjsLib;
    delete globalThis.window.Tesseract;
    delete globalThis.window.fuzzball;
    delete globalThis.window.JSZip;

    logs.length = 0;
    warns.length = 0;

    const result = verifyCDNLibraries();
    assertEqual(result.missing.length, 4, `Expected 4 missing, got ${result.missing.length}`);
    assertEqual(result.available.length, 0);
  });

  it('should report available libraries when globals exist', () => {
    globalThis.window.pdfjsLib = {};
    globalThis.window.Tesseract = {};
    globalThis.window.fuzzball = {};
    globalThis.window.JSZip = {};

    logs.length = 0;
    warns.length = 0;

    const result = verifyCDNLibraries();
    assertEqual(result.available.length, 4);
    assertEqual(result.missing.length, 0);
  });

  it('should handle partial library availability', () => {
    delete globalThis.window.pdfjsLib;
    delete globalThis.window.Tesseract;
    globalThis.window.fuzzball = {};
    globalThis.window.JSZip = {};

    const result = verifyCDNLibraries();
    assertEqual(result.available.length, 2);
    assertEqual(result.missing.length, 2);
    assert(result.missing.includes('PDF.js'), 'PDF.js should be listed as missing');
    assert(result.missing.includes('Tesseract.js'), 'Tesseract.js should be listed as missing');
    assert(result.available.includes('fuzzball.js'), 'fuzzball.js should be listed as available');
    assert(result.available.includes('JSZip'), 'JSZip should be listed as available');
  });

  it('should not block app startup when libraries are missing', () => {
    // App already initialized (imported), routes should be registered
    const routes = getRegisteredRoutes();
    assert(routes.length > 0, 'Routes should be registered even if CDN libs are missing');
  });
});

describe('App — Router Initialization', () => {
  it('should register default routes on init', () => {
    const routes = getRegisteredRoutes();
    assert(routes.includes('login'), 'login route should be registered');
    assert(routes.includes('dashboard'), 'dashboard route should be registered');
    assert(routes.includes('entradas'), 'entradas route should be registered');
    assert(routes.includes('importacao'), 'importacao route should be registered');
    assert(routes.includes('revisao'), 'revisao route should be registered');
    assert(routes.includes('ocultos'), 'ocultos route should be registered');
    assert(routes.includes('config'), 'config route should be registered');
  });

  it('should register exactly 7 routes', () => {
    assertEqual(getRegisteredRoutes().length, 7);
  });
});

describe('App — Auth-Based Initial Navigation (Req 11.7)', () => {
  it('should navigate to login when not authenticated', () => {
    // On import, isAuthenticated() returns false (no token in localStorage)
    // so the router should have redirected to login
    assertEqual(window.location.hash, '#login');
  });
});

// Import config for testing
const { loadConfig } = await import('../../js/config.js');

describe('App — Configuration Loading', () => {
  it('should load default config when localStorage is empty', () => {
    localStorage.removeItem('comprova_config');
    const config = loadConfig();
    assertEqual(config.threshold, 50);
    assertEqual(config.spreadsheet_id, null);
    assertEqual(config.root_folder_id, null);
  });

  it('should load config from localStorage when present', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 75,
      spreadsheet_id: 'test-sheet-123',
      root_folder_id: null
    }));

    const config = loadConfig();
    assertEqual(config.threshold, 75);
    assertEqual(config.spreadsheet_id, 'test-sheet-123');

    // Cleanup
    localStorage.removeItem('comprova_config');
  });
});

// --- Summary ---
console.log = originalLog;
console.warn = originalWarn;
console.log(`\n  \x1b[${failed > 0 ? '31' : '32'}m${passed} passing, ${failed} failing\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
