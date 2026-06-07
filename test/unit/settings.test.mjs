/**
 * Unit tests for js/views/settings.js
 *
 * Tests the settings view render and mount behavior:
 * - render() detects setup mode when no config exists (Req 10.6)
 * - render() shows normal settings form when config is present
 * - Slider (0–100) with numeric value display (Req 10.2)
 * - Spreadsheet ID field and auto-create (Req 10.3)
 * - Folder ID field and auto-create (Req 10.4)
 * - Error display for invalid IDs (Req 10.7)
 * - Save indicator (Req 10.5)
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8
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
  location: { hash: '#config', href: '' },
  addEventListener() {},
  removeEventListener() {},
};

// Minimal DOM simulation
const elements = {};

function createElement(opts = {}) {
  const el = {
    innerHTML: '',
    textContent: '',
    value: opts.value || '',
    disabled: false,
    classList: {
      _classes: new Set(opts.classes || []),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    _listeners: {},
    _attrs: {},
    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    },
    setAttribute(name, value) { this._attrs[name] = value; },
    getAttribute(name) { return this._attrs[name] || null; },
    async click() {
      const handlers = this._listeners['click'] || [];
      for (const h of handlers) await h();
    },
    async trigger(event) {
      const handlers = this._listeners[event] || [];
      for (const h of handlers) await h();
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

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ values: [['chave', 'valor']] }) });

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
const { render, mount } = await import('../../js/views/settings.js');

// --- Tests ---

describe('render() — Setup Mode (Req 10.6)', () => {
  it('should return setup flow HTML when no spreadsheet_id is configured', () => {
    localStorage.clear();
    const html = render();
    assert(typeof html === 'string', 'render() should return a string');
    assert(html.includes('Configuração Inicial'), 'Should show setup title');
  });

  it('should include spreadsheet creation button in setup mode', () => {
    localStorage.clear();
    const html = render();
    assert(html.includes('btn-create-spreadsheet'), 'Should have create spreadsheet button');
    assert(html.includes('Criar automaticamente'), 'Should have "Criar automaticamente" text');
  });

  it('should include folder creation button in setup mode', () => {
    localStorage.clear();
    const html = render();
    assert(html.includes('btn-create-folder'), 'Should have create folder button');
  });

  it('should include spreadsheet input field in setup mode', () => {
    localStorage.clear();
    const html = render();
    assert(html.includes('setup-spreadsheet-id'), 'Should have spreadsheet input');
    assert(html.includes('ID da planilha existente'), 'Should have placeholder for spreadsheet');
  });

  it('should include folder input field in setup mode', () => {
    localStorage.clear();
    const html = render();
    assert(html.includes('setup-folder-id'), 'Should have folder input');
    assert(html.includes('ID da pasta existente'), 'Should have placeholder for folder');
  });

  it('should include a save button that is disabled initially', () => {
    localStorage.clear();
    const html = render();
    assert(html.includes('btn-save-setup'), 'Should have save setup button');
    assert(html.includes('disabled'), 'Save button should be disabled');
  });

  it('should include error containers for validation (Req 10.7)', () => {
    localStorage.clear();
    const html = render();
    assert(html.includes('setup-spreadsheet-error'), 'Should have spreadsheet error container');
    assert(html.includes('setup-folder-error'), 'Should have folder error container');
  });
});

describe('render() — Normal Settings Form (Req 10.1, 10.2, 10.3, 10.4)', () => {
  it('should return settings form HTML when config is complete', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 65,
      spreadsheet_id: 'abc123',
      root_folder_id: 'folder456'
    }));
    const html = render();
    assert(html.includes('Configurações'), 'Should show settings title');
    assert(!html.includes('Configuração Inicial'), 'Should NOT show setup title');
  });

  it('should include a threshold slider with range 0-100 (Req 10.2)', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 65,
      spreadsheet_id: 'abc123',
      root_folder_id: 'folder456'
    }));
    const html = render();
    assert(html.includes('type="range"'), 'Should have a range input');
    assert(html.includes('min="0"'), 'Should have min=0');
    assert(html.includes('max="100"'), 'Should have max=100');
    assert(html.includes('step="1"'), 'Should have step=1');
  });

  it('should display current threshold value beside the slider', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 65,
      spreadsheet_id: 'abc123',
      root_folder_id: 'folder456'
    }));
    const html = render();
    assert(html.includes('65%'), 'Should show threshold value 65%');
    assert(html.includes('settings-threshold-value'), 'Should have value display element');
  });

  it('should show spreadsheet ID in input field (Req 10.3)', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'mySpreadsheetId',
      root_folder_id: 'myFolderId'
    }));
    const html = render();
    assert(html.includes('settings-spreadsheet-id'), 'Should have spreadsheet input');
    assert(html.includes('mySpreadsheetId'), 'Should show current spreadsheet ID');
  });

  it('should show folder ID in input field (Req 10.4)', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'mySpreadsheetId',
      root_folder_id: 'myFolderId'
    }));
    const html = render();
    assert(html.includes('settings-folder-id'), 'Should have folder input');
    assert(html.includes('myFolderId'), 'Should show current folder ID');
  });

  it('should include create buttons for spreadsheet and folder', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    const html = render();
    assert(html.includes('btn-settings-create-spreadsheet'), 'Should have create spreadsheet button');
    assert(html.includes('btn-settings-create-folder'), 'Should have create folder button');
  });

  it('should include a save indicator element (Req 10.5)', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    const html = render();
    assert(html.includes('settings-save-indicator'), 'Should have save indicator');
  });

  it('should include error containers for validation feedback (Req 10.7)', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    const html = render();
    assert(html.includes('settings-spreadsheet-error'), 'Should have spreadsheet error container');
    assert(html.includes('settings-folder-error'), 'Should have folder error container');
  });

  it('should use .card class for grouping settings', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    const html = render();
    assert(html.includes('class="card'), 'Should use .card class');
  });

  it('should have ARIA attributes on slider for accessibility', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 75,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    const html = render();
    assert(html.includes('aria-valuemin="0"'), 'Should have aria-valuemin');
    assert(html.includes('aria-valuemax="100"'), 'Should have aria-valuemax');
    assert(html.includes('aria-valuenow="75"'), 'Should have aria-valuenow');
  });
});

describe('mount() — Normal Form Event Binding (Req 10.2, 10.5)', () => {
  it('should not throw when DOM elements are not found', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    render(); // set isSetupMode = false
    mount();
    assert(true, 'Did not throw');
  });

  it('should attach input listener to threshold slider', () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    render();

    const slider = createElement({ value: '50' });
    const valueDisplay = createElement();
    const spreadsheetInput = createElement({ value: 'abc' });
    const folderInput = createElement({ value: 'def' });
    const btnCreateSpreadsheet = createElement();
    const btnCreateFolder = createElement();
    const indicator = createElement({ classes: ['hidden'] });

    elements['settings-threshold'] = slider;
    elements['settings-threshold-value'] = valueDisplay;
    elements['settings-spreadsheet-id'] = spreadsheetInput;
    elements['settings-folder-id'] = folderInput;
    elements['btn-settings-create-spreadsheet'] = btnCreateSpreadsheet;
    elements['btn-settings-create-folder'] = btnCreateFolder;
    elements['settings-save-indicator'] = indicator;

    mount();

    assert(slider._listeners['input'] && slider._listeners['input'].length > 0,
      'Should have attached an input listener to slider');

    // Cleanup
    Object.keys(elements).forEach(k => delete elements[k]);
  });

  it('should update displayed value when slider changes', async () => {
    localStorage.setItem('comprova_config', JSON.stringify({
      threshold: 50,
      spreadsheet_id: 'abc',
      root_folder_id: 'def'
    }));
    render();

    const slider = createElement({ value: '73' });
    const valueDisplay = createElement();
    const spreadsheetInput = createElement({ value: 'abc' });
    const folderInput = createElement({ value: 'def' });
    const btnCreateSpreadsheet = createElement();
    const btnCreateFolder = createElement();
    const indicator = createElement({ classes: ['hidden'] });

    elements['settings-threshold'] = slider;
    elements['settings-threshold-value'] = valueDisplay;
    elements['settings-spreadsheet-id'] = spreadsheetInput;
    elements['settings-folder-id'] = folderInput;
    elements['btn-settings-create-spreadsheet'] = btnCreateSpreadsheet;
    elements['btn-settings-create-folder'] = btnCreateFolder;
    elements['settings-save-indicator'] = indicator;

    mount();

    // Simulate slider change
    await slider.trigger('input');
    assertEqual(valueDisplay.textContent, '73%', 'Should display updated threshold value');

    // Cleanup
    Object.keys(elements).forEach(k => delete elements[k]);
  });
});

describe('mount() — Setup Flow Event Binding (Req 10.6)', () => {
  it('should attach listeners in setup mode', () => {
    localStorage.clear();
    render(); // set isSetupMode = true

    const spreadsheetInput = createElement();
    const folderInput = createElement();
    const btnCreateSpreadsheet = createElement();
    const btnCreateFolder = createElement();
    const btnSaveSetup = createElement();

    elements['setup-spreadsheet-id'] = spreadsheetInput;
    elements['setup-folder-id'] = folderInput;
    elements['btn-create-spreadsheet'] = btnCreateSpreadsheet;
    elements['btn-create-folder'] = btnCreateFolder;
    elements['btn-save-setup'] = btnSaveSetup;

    mount();

    assert(btnCreateSpreadsheet._listeners['click'] && btnCreateSpreadsheet._listeners['click'].length > 0,
      'Should attach click to create spreadsheet button');
    assert(btnCreateFolder._listeners['click'] && btnCreateFolder._listeners['click'].length > 0,
      'Should attach click to create folder button');
    assert(btnSaveSetup._listeners['click'] && btnSaveSetup._listeners['click'].length > 0,
      'Should attach click to save setup button');

    // Cleanup
    Object.keys(elements).forEach(k => delete elements[k]);
  });

  it('should enable save button when both fields have values', async () => {
    localStorage.clear();
    render();

    const spreadsheetInput = createElement();
    const folderInput = createElement();
    const btnCreateSpreadsheet = createElement();
    const btnCreateFolder = createElement();
    const btnSaveSetup = createElement();
    btnSaveSetup.disabled = true;

    elements['setup-spreadsheet-id'] = spreadsheetInput;
    elements['setup-folder-id'] = folderInput;
    elements['btn-create-spreadsheet'] = btnCreateSpreadsheet;
    elements['btn-create-folder'] = btnCreateFolder;
    elements['btn-save-setup'] = btnSaveSetup;

    mount();

    // Set values
    spreadsheetInput.value = 'test-sheet-id';
    folderInput.value = 'test-folder-id';

    // Trigger input events
    await spreadsheetInput.trigger('input');
    await folderInput.trigger('input');

    assertEqual(btnSaveSetup.disabled, false, 'Save button should be enabled when both fields have values');

    // Cleanup
    Object.keys(elements).forEach(k => delete elements[k]);
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
