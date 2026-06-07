/**
 * Unit tests for js/ui/toast.js
 * Tests run in browser environment via test-runner.html or Node.js with DOM mock
 */

// --- Node.js environment mocks (only applied if not in browser) ---
if (typeof document === 'undefined') {
  class MockElement {
    constructor(tag) {
      this.tagName = tag;
      this._className = '';
      this._textContent = '';
      this._innerHTML = '';
      this.children = [];
      this.parentNode = null;
      this.attrs = {};
      this.dataset = {};
      this._listeners = {};
      this._classList = new Set();
      this.classList = {
        add: (cls) => { this._classList.add(cls); this._className = [...this._classList].join(' '); },
        remove: (cls) => { this._classList.delete(cls); this._className = [...this._classList].join(' '); },
        contains: (cls) => this._classList.has(cls),
      };
    }
    set className(val) {
      this._className = val;
      this._classList.clear();
      val.split(' ').filter(Boolean).forEach(c => this._classList.add(c));
    }
    get className() { return this._className; }
    set textContent(val) {
      this._textContent = String(val);
      this._innerHTML = escapeForMock(String(val));
      this.children = [];
    }
    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join('');
      }
      return this._textContent;
    }
    set innerHTML(html) {
      this._innerHTML = html;
      this.children = [];
      // Parse elements by finding tags with classes
      const tagRegex = /<(\w+)\s+([^>]*)>([\s\S]*?)<\/\1>|<(\w+)\s+([^>]*?)\/>/g;
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const attrs = match[2] || match[5] || '';
        const content = match[3] || '';
        const tag = match[1] || match[4] || 'div';
        const child = new MockElement(tag);
        child.parentNode = this;
        // Parse class attribute
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (classMatch) {
          child.className = classMatch[1];
        }
        // Parse other attributes
        const attrRegex2 = /(\w[\w-]*)="([^"]+)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex2.exec(attrs)) !== null) {
          if (attrMatch[1] !== 'class') {
            child.attrs[attrMatch[1]] = attrMatch[2];
          }
        }
        // Set text content (stripped of inner HTML tags)
        const textOnly = content.replace(/<[^>]+>/g, '');
        if (textOnly.trim()) {
          child._textContent = unescapeHtml(textOnly);
          child._innerHTML = content;
        }
        this.children.push(child);
      }
    }
    get innerHTML() { return this._innerHTML; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(event, handler, opts) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    }
    click() {
      const handlers = this._listeners['click'] || [];
      handlers.forEach(h => h());
    }
    querySelector(selector) {
      return this._querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
      return this._querySelectorAll(selector);
    }
    _querySelectorAll(selector) {
      const results = [];
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      if (!cls) return results;
      for (const child of this.children) {
        if (child._classList.has(cls)) results.push(child);
        results.push(...child._querySelectorAll(selector));
      }
      return results;
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
  }

  function escapeForMock(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function unescapeHtml(str) {
    return String(str).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  }

  const body = new MockElement('body');

  globalThis.document = {
    body,
    createElement(tag) { return new MockElement(tag); },
    querySelector(selector) { return body.querySelector(selector); },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
  };

  globalThis.window = {
    location: { hash: '', href: '' },
    addEventListener() {},
    removeEventListener() {},
  };
}

import { showToast, showSuccess, showError, showInfo } from '../../js/ui/toast.js';

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
  const container = document.querySelector('.toast-container');
  if (container) container.remove();
}

// --- Tests ---

describe('Toast Module', () => {

  describe('showToast()', () => {
    it('creates a toast-container if none exists', () => {
      cleanup();
      showToast('Test message', 'info');
      const container = document.querySelector('.toast-container');
      assert(container !== null, 'Container should exist');
      assert(container.classList.contains('toast-container'), 'Should have correct class');
      cleanup();
    });

    it('creates a toast element with correct type class', () => {
      cleanup();
      showToast('Success msg', 'success');
      const toast = document.querySelector('.toast--success');
      assert(toast !== null, 'Success toast should exist');
      cleanup();
    });

    it('displays the message text', () => {
      cleanup();
      showToast('Hello World', 'info');
      const content = document.querySelector('.toast__content');
      assertEqual(content.textContent, 'Hello World');
      cleanup();
    });

    it('includes a dismiss button', () => {
      cleanup();
      showToast('Msg', 'error');
      const btn = document.querySelector('.toast__dismiss');
      assert(btn !== null, 'Dismiss button should exist');
      cleanup();
    });

    it('includes a progress bar', () => {
      cleanup();
      showToast('Msg', 'info');
      const progress = document.querySelector('.toast__progress');
      assert(progress !== null, 'Progress bar should exist');
      cleanup();
    });

    it('falls back to info type for invalid types', () => {
      cleanup();
      showToast('Msg', 'invalid');
      const toast = document.querySelector('.toast--info');
      assert(toast !== null, 'Should fallback to info');
      cleanup();
    });

    it('supports multiple toasts stacking', () => {
      cleanup();
      showToast('First', 'success');
      showToast('Second', 'error');
      showToast('Third', 'info');
      const toasts = document.querySelectorAll('.toast');
      assertEqual(toasts.length, 3, 'Should have 3 toasts');
      cleanup();
    });

    it('sets role="alert" for accessibility', () => {
      cleanup();
      showToast('Accessible', 'info');
      const toast = document.querySelector('.toast');
      assertEqual(toast.getAttribute('role'), 'alert');
      cleanup();
    });

    it('sets aria-live on container', () => {
      cleanup();
      showToast('Msg', 'info');
      const container = document.querySelector('.toast-container');
      assertEqual(container.getAttribute('aria-live'), 'polite');
      cleanup();
    });
  });

  describe('showSuccess()', () => {
    it('creates a success toast', () => {
      cleanup();
      showSuccess('Done!');
      const toast = document.querySelector('.toast--success');
      assert(toast !== null, 'Should create success toast');
      cleanup();
    });
  });

  describe('showError()', () => {
    it('creates an error toast', () => {
      cleanup();
      showError('Failed!');
      const toast = document.querySelector('.toast--error');
      assert(toast !== null, 'Should create error toast');
      cleanup();
    });
  });

  describe('showInfo()', () => {
    it('creates an info toast', () => {
      cleanup();
      showInfo('FYI');
      const toast = document.querySelector('.toast--info');
      assert(toast !== null, 'Should create info toast');
      cleanup();
    });
  });

  describe('Manual dismiss', () => {
    it('removes toast when dismiss button is clicked', (done) => {
      cleanup();
      const toast = showError('Dismiss me');
      const btn = toast.querySelector('.toast__dismiss');
      btn.click();
      // After click, toast should get exiting class
      assert(toast.classList.contains('toast--exiting'), 'Should add exiting class');
      cleanup();
    });

    it('prevents double dismiss', () => {
      cleanup();
      const toast = showError('Double dismiss');
      const btn = toast.querySelector('.toast__dismiss');
      btn.click();
      btn.click(); // should not throw
      assert(toast.dataset.dismissed === 'true', 'Should be marked dismissed');
      cleanup();
    });
  });

  describe('XSS prevention', () => {
    it('escapes HTML in message', () => {
      cleanup();
      showToast('<script>alert("xss")</script>', 'info');
      const content = document.querySelector('.toast__content');
      assert(!content.innerHTML.includes('<script>'), 'Should escape script tags');
      assert(content.textContent.includes('<script>'), 'Should preserve text content');
      cleanup();
    });
  });
});

// Export results for test runner
if (typeof window !== 'undefined' && typeof window.__toastTestResults !== 'undefined') {
  window.__toastTestResults = results;
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
