/**
 * Unit tests for js/views/login.js
 *
 * Tests the login view render and mount behavior:
 * - render() produces correct HTML structure (Req 1.1)
 * - mount() attaches click listener that calls signIn (Req 1.1)
 * - Error message displayed on signIn failure (Req 1.8)
 *
 * Requirements: 1.1, 1.8
 */

// --- Minimal browser API simulation ---
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

// Minimal DOM simulation
const elements = {};

function createElement() {
  const el = {
    innerHTML: '',
    textContent: '',
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    disabled: false,
    _listeners: {},
    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    },
    async click() {
      const handlers = this._listeners['click'] || [];
      for (const h of handlers) {
        await h();
      }
    }
  };
  return el;
}

globalThis.document = {
  getElementById(id) {
    return elements[id] || null;
  },
  readyState: 'complete',
  addEventListener() {},
};

globalThis.fetch = async () => ({ ok: false, status: 404 });

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

// --- Import module under test ---
const { render, mount } = await import('../../js/views/login.js');

// --- Tests ---

describe('render() — Req 1.1 (display login button)', () => {
  it('should return a string containing the login button text', () => {
    const html = render();
    assert(typeof html === 'string', 'render() should return a string');
    assert(html.includes('Entrar com Google'), 'Should contain "Entrar com Google" button text');
  });

  it('should contain a button with id "btn-google-login"', () => {
    const html = render();
    assert(html.includes('id="btn-google-login"'), 'Should have button with id btn-google-login');
  });

  it('should use .card class for the login card', () => {
    const html = render();
    assert(html.includes('card'), 'Should use .card class');
  });

  it('should use .btn, .btn--primary, .btn--lg classes on the button', () => {
    const html = render();
    assert(html.includes('btn btn--primary btn--lg'), 'Should use btn + btn--primary + btn--lg');
  });

  it('should contain the app name "ComprovaLattes"', () => {
    const html = render();
    assert(html.includes('ComprovaLattes'), 'Should contain app name');
  });

  it('should contain a description text', () => {
    const html = render();
    assert(html.includes('comprovantes'), 'Should contain description text');
  });

  it('should have an error container with hidden class by default', () => {
    const html = render();
    assert(html.includes('id="login-error"'), 'Should have error container');
    assert(html.includes('hidden'), 'Error container should have hidden class');
  });

  it('should have role="alert" on error container for accessibility', () => {
    const html = render();
    assert(html.includes('role="alert"'), 'Should have role=alert for screen readers');
  });

  it('should use .text-center class', () => {
    const html = render();
    assert(html.includes('text-center'), 'Should use text-center class');
  });
});

describe('mount() — Req 1.1, 1.8 (event binding and error display)', () => {
  it('should not throw when DOM elements are not found', () => {
    mount();
    assert(true, 'Did not throw');
  });

  it('should attach click listener to login button', () => {
    const btn = createElement();
    const errorDiv = createElement();
    errorDiv.classList.add('hidden');
    elements['btn-google-login'] = btn;
    elements['login-error'] = errorDiv;

    mount();

    assert(btn._listeners['click'] && btn._listeners['click'].length > 0,
      'Should have attached a click listener');

    delete elements['btn-google-login'];
    delete elements['login-error'];
  });

  it('should show error message when signIn rejects (Req 1.8)', async () => {
    const btn = createElement();
    const errorDiv = createElement();
    errorDiv.classList.add('hidden');
    elements['btn-google-login'] = btn;
    elements['login-error'] = errorDiv;

    mount();
    await btn.click();

    assert(!errorDiv.classList.contains('hidden'),
      'Error container should be visible after failed signIn');
    assert(errorDiv.textContent.includes('autorizar o acesso'),
      `Error message should contain auth requirement text, got: "${errorDiv.textContent}"`);

    delete elements['btn-google-login'];
    delete elements['login-error'];
  });

  it('should re-enable button after signIn attempt fails', async () => {
    const btn = createElement();
    const errorDiv = createElement();
    errorDiv.classList.add('hidden');
    elements['btn-google-login'] = btn;
    elements['login-error'] = errorDiv;

    mount();
    await btn.click();

    assertEqual(btn.disabled, false, 'Button should be re-enabled after signIn completes');

    delete elements['btn-google-login'];
    delete elements['login-error'];
  });

  it('should display the correct error message text', async () => {
    const btn = createElement();
    const errorDiv = createElement();
    errorDiv.classList.add('hidden');
    elements['btn-google-login'] = btn;
    elements['login-error'] = errorDiv;

    mount();
    await btn.click();

    const expectedMsg = 'É necessário autorizar o acesso à sua conta Google para utilizar o ComprovaLattes.';
    assertEqual(errorDiv.textContent, expectedMsg,
      `Error message mismatch`);

    delete elements['btn-google-login'];
    delete elements['login-error'];
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
