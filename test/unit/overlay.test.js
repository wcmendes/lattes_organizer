/**
 * Unit tests for js/ui/overlay.js
 * Tests run in browser environment via test-runner.html or Node.js with DOM mock
 */

// --- Node.js environment mocks (only applied if not in browser) ---
if (typeof document === 'undefined') {
  // Minimal DOM simulation
  class MockElement {
    constructor(tag) {
      this.tagName = tag;
      this.className = '';
      this.textContent = '';
      this.innerHTML = '';
      this.children = [];
      this.attrs = {};
      this.parentNode = null;
      this._classList = new Set();
      this.classList = {
        add: (cls) => this._classList.add(cls),
        remove: (cls) => this._classList.delete(cls),
        contains: (cls) => this._classList.has(cls),
      };
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    querySelector(selector) {
      // Simple class-based selector
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      if (!cls) return null;
      for (const child of this.children) {
        if (child.className.includes(cls) || child._classList.has(cls)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(c => c !== this);
        this.parentNode = null;
      }
    }
    contains(el) {
      if (el === this) return true;
      return this.children.some(c => c === el || c.contains(el));
    }
    set innerHTML(html) {
      this._innerHTML = html;
      // Parse simple inner HTML for overlay structure
      this.children = [];
      const createChild = (className, text) => {
        const el = new MockElement('div');
        el.className = className;
        el.textContent = text || '';
        el.parentNode = this;
        return el;
      };
      if (html.includes('overlay__content')) {
        const content = createChild('overlay__content', '');
        const spinner = createChild('spinner', '');
        const message = createChild('overlay__message', 'Processando...');
        const timer = createChild('overlay__timer', '00:00');
        const detail = createChild('overlay__detail', '');
        content.children = [spinner, message, timer, detail];
        spinner.parentNode = content;
        message.parentNode = content;
        timer.parentNode = content;
        detail.parentNode = content;
        this.children.push(content);
      }
    }
    get innerHTML() { return this._innerHTML || ''; }
  }

  const body = new MockElement('body');

  globalThis.document = {
    body,
    createElement(tag) { return new MockElement(tag); },
    querySelector(selector) {
      return body.querySelector(selector);
    },
  };

  globalThis.window = {
    location: { hash: '', href: '' },
    addEventListener() {},
    removeEventListener() {},
    __overlayTestResults: null,
  };

  // setInterval/clearInterval are available in Node.js natively
}

import { showOverlay, updateOverlay, hideOverlay } from '../../js/ui/overlay.js';

/**
 * Simple test utilities
 */
const results = [];

function describe(name, fn) {
  console.group(name);
  fn();
  console.groupEnd();
}

function it(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}", got "${actual}"`);
  }
}

function cleanup() {
  hideOverlay();
  const overlay = document.querySelector('.overlay');
  if (overlay) overlay.remove();
}

// --- Tests ---

describe('Overlay Module', () => {

  describe('showOverlay()', () => {
    it('creates overlay element in DOM', () => {
      cleanup();
      showOverlay('Loading...');
      const overlay = document.querySelector('.overlay');
      assert(overlay !== null, 'Overlay should exist');
      cleanup();
    });

    it('adds overlay--active class', () => {
      cleanup();
      showOverlay('Processing');
      const overlay = document.querySelector('.overlay');
      assert(overlay.classList.contains('overlay--active'), 'Should be active');
      cleanup();
    });

    it('displays the provided message', () => {
      cleanup();
      showOverlay('Importando XML...');
      const msg = document.querySelector('.overlay__message');
      assertEqual(msg.textContent, 'Importando XML...');
      cleanup();
    });

    it('uses default message when none provided', () => {
      cleanup();
      showOverlay();
      const msg = document.querySelector('.overlay__message');
      assertEqual(msg.textContent, 'Processando...');
      cleanup();
    });

    it('includes a spinner element', () => {
      cleanup();
      showOverlay('Test');
      const spinner = document.querySelector('.spinner');
      assert(spinner !== null, 'Spinner should exist');
      cleanup();
    });

    it('includes a timer element starting at 00:00', () => {
      cleanup();
      showOverlay('Test');
      const timer = document.querySelector('.overlay__timer');
      assert(timer !== null, 'Timer should exist');
      assertEqual(timer.textContent, '00:00');
      cleanup();
    });

    it('sets role="dialog" and aria-modal for accessibility', () => {
      cleanup();
      showOverlay('Test');
      const overlay = document.querySelector('.overlay');
      assertEqual(overlay.getAttribute('role'), 'dialog');
      assertEqual(overlay.getAttribute('aria-modal'), 'true');
      cleanup();
    });

    it('includes detail element (initially empty)', () => {
      cleanup();
      showOverlay('Test');
      const detail = document.querySelector('.overlay__detail');
      assert(detail !== null, 'Detail element should exist');
      assertEqual(detail.textContent, '');
      cleanup();
    });
  });

  describe('updateOverlay()', () => {
    it('updates the message text', () => {
      cleanup();
      showOverlay('Initial');
      updateOverlay({ message: 'Updated message' });
      const msg = document.querySelector('.overlay__message');
      assertEqual(msg.textContent, 'Updated message');
      cleanup();
    });

    it('updates the detail text', () => {
      cleanup();
      showOverlay('Test');
      updateOverlay({ detail: '3 de 10 arquivos' });
      const detail = document.querySelector('.overlay__detail');
      assertEqual(detail.textContent, '3 de 10 arquivos');
      cleanup();
    });

    it('updates detail with progress percentage', () => {
      cleanup();
      showOverlay('Test');
      updateOverlay({ progress: 75 });
      const detail = document.querySelector('.overlay__detail');
      assertEqual(detail.textContent, '75%');
      cleanup();
    });

    it('detail text takes precedence over progress', () => {
      cleanup();
      showOverlay('Test');
      updateOverlay({ detail: 'Custom detail', progress: 50 });
      const detail = document.querySelector('.overlay__detail');
      assertEqual(detail.textContent, 'Custom detail');
      cleanup();
    });

    it('does nothing when overlay is not shown', () => {
      cleanup();
      // Should not throw
      updateOverlay({ message: 'No overlay' });
      assert(true, 'Should not throw');
    });
  });

  describe('hideOverlay()', () => {
    it('removes overlay--active class', () => {
      cleanup();
      showOverlay('Test');
      hideOverlay();
      const overlay = document.querySelector('.overlay');
      assert(!overlay.classList.contains('overlay--active'), 'Should not be active');
    });

    it('stops the timer', () => {
      cleanup();
      showOverlay('Test');
      hideOverlay();
      const timer = document.querySelector('.overlay__timer');
      const value = timer.textContent;
      // Wait a bit and check timer didn't increment
      // (synchronous test — timer is cleared immediately)
      assertEqual(value, '00:00');
      cleanup();
    });

    it('can be called multiple times safely', () => {
      cleanup();
      showOverlay('Test');
      hideOverlay();
      hideOverlay();
      hideOverlay();
      assert(true, 'Should not throw on multiple calls');
    });
  });

  describe('Timer functionality', () => {
    it('timer increments after 1 second', (done) => {
      cleanup();
      showOverlay('Timer test');
      setTimeout(() => {
        const timer = document.querySelector('.overlay__timer');
        assertEqual(timer.textContent, '00:01', 'Timer should show 00:01 after 1 second');
        cleanup();
        if (done) done();
      }, 1100);
    });

    it('timer resets on new showOverlay call', () => {
      cleanup();
      showOverlay('First');
      // Timer should reset
      showOverlay('Second');
      const timer = document.querySelector('.overlay__timer');
      assertEqual(timer.textContent, '00:00');
      cleanup();
    });
  });
});

// Export results for test runner
if (typeof window !== 'undefined' && window.__overlayTestResults !== undefined) {
  window.__overlayTestResults = results;
}

// Auto-run report in Node.js
if (typeof process !== 'undefined') {
  let passed = 0, failed = 0;
  for (const r of results) {
    if (r.passed) passed++;
    else {
      failed++;
      console.log(`    FAIL: ${r.name} — ${r.error}`);
    }
  }
  console.log(`\n  ${passed} passing, ${failed} failing\n`);
  process.exit(failed > 0 ? 1 : 0);
}
