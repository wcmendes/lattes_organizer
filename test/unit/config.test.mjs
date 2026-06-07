/**
 * Unit tests for js/config.js
 *
 * Tests configuration management:
 * - loadConfig: loading from localStorage with defaults
 * - saveConfig: persisting to localStorage
 * - loadFromSheets: reading config from Sheets
 * - saveToSheets: persisting config to Sheets
 * - syncWithSheets: conflict resolution (Planilha wins)
 * - updateConfig: localStorage immediate + debounced Sheets write
 * - getThreshold, getSpreadsheetId, getRootFolderId, getDefaults
 *
 * Requirements: 10.5, 10.6, 10.9
 */

// --- Minimal browser API simulation ---
const store = {};
globalThis.localStorage = {
  getItem(key) { return store[key] ?? null; },
  setItem(key, value) { store[key] = String(value); },
  removeItem(key) { delete store[key]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); },
};

let _hash = '';
globalThis.window = {
  location: {
    get hash() { return _hash; },
    set hash(v) { _hash = v; },
    href: ''
  },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.document = {
  getElementById() { return null; },
};

// --- Token setup ---
const TOKEN_KEY = 'comprova_lattes_token';

function setValidToken() {
  const tokenData = {
    access_token: 'ya29.test-config-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    stored_at: Date.now(),
    user_name: 'Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function clearStorage() {
  Object.keys(store).forEach(k => delete store[k]);
  _hash = '';
}

// --- Fetch mock infrastructure ---
let fetchCalls = [];
let fetchResponses = [];

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  if (fetchResponses.length > 0) {
    const resp = fetchResponses.shift();
    if (typeof resp === 'function') return resp(url, options);
    return resp;
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mockFetch(responses) {
  fetchCalls = [];
  fetchResponses = Array.isArray(responses) ? [...responses] : [responses];
}

function resetFetch() {
  fetchCalls = [];
  fetchResponses = [];
}

// --- Import config module ---
const {
  loadConfig,
  saveConfig,
  getThreshold,
  getSpreadsheetId,
  getRootFolderId,
  getDefaults,
  loadFromSheets,
  saveToSheets,
  syncWithSheets,
  updateConfig,
  onSheetsSave,
  flushToSheets,
} = await import('../../js/config.js');

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

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(message || `Expected ${b} but got ${a}`);
  }
}

// --- Tests ---

describe('loadConfig — Load from localStorage', () => {
  it('should return defaults when localStorage is empty', () => {
    clearStorage();
    const config = loadConfig();
    assertEqual(config.threshold, 50);
    assertEqual(config.spreadsheet_id, null);
    assertEqual(config.root_folder_id, null);
  });

  it('should merge stored values with defaults', () => {
    clearStorage();
    localStorage.setItem('comprova_config', JSON.stringify({ threshold: 75 }));
    const config = loadConfig();
    assertEqual(config.threshold, 75);
    assertEqual(config.spreadsheet_id, null);
    assertEqual(config.root_folder_id, null);
  });

  it('should return defaults when stored JSON is invalid', () => {
    clearStorage();
    localStorage.setItem('comprova_config', 'not-json{{{');
    const config = loadConfig();
    assertEqual(config.threshold, 50);
  });
});

describe('saveConfig — Persist to localStorage', () => {
  it('should store config as JSON in localStorage', () => {
    clearStorage();
    saveConfig({ threshold: 80, spreadsheet_id: 'abc123', root_folder_id: 'folder1' });
    const stored = JSON.parse(localStorage.getItem('comprova_config'));
    assertEqual(stored.threshold, 80);
    assertEqual(stored.spreadsheet_id, 'abc123');
    assertEqual(stored.root_folder_id, 'folder1');
  });
});

describe('getThreshold — Returns current threshold', () => {
  it('should return the stored threshold', () => {
    clearStorage();
    saveConfig({ threshold: 65, spreadsheet_id: null, root_folder_id: null });
    assertEqual(getThreshold(), 65);
  });

  it('should return default 50 when no config stored', () => {
    clearStorage();
    assertEqual(getThreshold(), 50);
  });
});

describe('getSpreadsheetId — Returns spreadsheet ID', () => {
  it('should return stored spreadsheet_id', () => {
    clearStorage();
    saveConfig({ threshold: 50, spreadsheet_id: 'my-sheet-id', root_folder_id: null });
    assertEqual(getSpreadsheetId(), 'my-sheet-id');
  });

  it('should return null when not configured', () => {
    clearStorage();
    assertEqual(getSpreadsheetId(), null);
  });
});

describe('getRootFolderId — Returns root folder ID', () => {
  it('should return stored root_folder_id', () => {
    clearStorage();
    saveConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: 'folder-xyz' });
    assertEqual(getRootFolderId(), 'folder-xyz');
  });
});

describe('getDefaults — Returns default config', () => {
  it('should return default values', () => {
    const defaults = getDefaults();
    assertEqual(defaults.threshold, 50);
    assertEqual(defaults.spreadsheet_id, null);
    assertEqual(defaults.root_folder_id, null);
  });

  it('should return a new object each time (not a reference)', () => {
    const d1 = getDefaults();
    const d2 = getDefaults();
    d1.threshold = 99;
    assertEqual(d2.threshold, 50);
  });
});

describe('loadFromSheets — Read config from Sheets', () => {
  it('should parse config rows from Sheets into key-value object', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['chave', 'valor'],
          ['threshold', '75'],
          ['spreadsheet_id', 'sheet-abc'],
          ['root_folder_id', 'folder-def']
        ]
      })
    });

    const config = await loadFromSheets('test-spreadsheet-id');
    assertEqual(config.threshold, 75);
    assertEqual(config.spreadsheet_id, 'sheet-abc');
    assertEqual(config.root_folder_id, 'folder-def');
  });

  it('should return empty object when sheet has no data rows', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({ values: [] })
    });

    const config = await loadFromSheets('test-spreadsheet-id');
    assertDeepEqual(config, {});
  });

  it('should handle null/empty valores as null', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['chave', 'valor'],
          ['spreadsheet_id', ''],
          ['root_folder_id', '']
        ]
      })
    });

    const config = await loadFromSheets('test-spreadsheet-id');
    assertEqual(config.spreadsheet_id, null);
    assertEqual(config.root_folder_id, null);
  });

  it('should skip rows with empty chave', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['chave', 'valor'],
          ['', 'ignored'],
          ['threshold', '60']
        ]
      })
    });

    const config = await loadFromSheets('test-spreadsheet-id');
    assertEqual(config.threshold, 60);
    assert(!('' in config), 'Should not have empty key');
  });
});

describe('saveToSheets — Persist config to Sheets', () => {
  it('should update existing keys and append new ones', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 80, spreadsheet_id: 'sheet-1', root_folder_id: 'folder-1' });

    // First call: getRows (to read existing config)
    // Then: updateRow calls for existing keys, appendRows for new
    mockFetch([
      // getRows response: only threshold exists in sheet
      {
        ok: true, status: 200,
        json: async () => ({
          values: [
            ['chave', 'valor'],
            ['threshold', '50']
          ]
        })
      },
      // updateRow for threshold (PUT)
      { ok: true, status: 200, json: async () => ({}) },
      // appendRows for spreadsheet_id and root_folder_id (POST)
      { ok: true, status: 200, json: async () => ({}) }
    ]);

    await saveToSheets('test-spreadsheet-id');

    // First call was GET (getRows)
    assertEqual(fetchCalls[0].options.method, 'GET');
    // Second call was PUT (updateRow for threshold)
    assertEqual(fetchCalls[1].options.method, 'PUT');
    assert(fetchCalls[1].url.includes('A2'), 'Should update row 2 (first data row after header)');
    // Third call was POST (appendRows for new keys)
    assertEqual(fetchCalls[2].options.method, 'POST');
    assert(fetchCalls[2].url.includes(':append'), 'Should append new rows');
  });

  it('should append all keys when sheet is empty', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    mockFetch([
      // getRows: empty sheet
      { ok: true, status: 200, json: async () => ({ values: [] }) },
      // appendRows
      { ok: true, status: 200, json: async () => ({}) }
    ]);

    await saveToSheets('test-spreadsheet-id');

    assertEqual(fetchCalls.length, 2);
    assertEqual(fetchCalls[1].options.method, 'POST');
    assert(fetchCalls[1].url.includes(':append'), 'Should append all rows');
  });
});

describe('syncWithSheets — Conflict resolution (Planilha wins)', () => {
  it('should use Planilha values when they differ from localStorage (Req 10.9)', async () => {
    clearStorage();
    setValidToken();
    // Local config has threshold=75
    saveConfig({ threshold: 75, spreadsheet_id: 'local-sheet', root_folder_id: 'local-folder' });

    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['chave', 'valor'],
          ['threshold', '60'],
          ['spreadsheet_id', 'sheets-value'],
          ['root_folder_id', 'sheets-folder']
        ]
      })
    });

    const resolved = await syncWithSheets('test-spreadsheet-id');

    // Planilha values should win
    assertEqual(resolved.threshold, 60);
    assertEqual(resolved.spreadsheet_id, 'sheets-value');
    assertEqual(resolved.root_folder_id, 'sheets-folder');

    // localStorage should be updated to match Planilha
    const stored = loadConfig();
    assertEqual(stored.threshold, 60);
    assertEqual(stored.spreadsheet_id, 'sheets-value');
    assertEqual(stored.root_folder_id, 'sheets-folder');
  });

  it('should push local config to Sheets when sheet is empty (first use)', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 50, spreadsheet_id: 'my-sheet', root_folder_id: 'my-folder' });

    mockFetch([
      // loadFromSheets: empty sheet
      { ok: true, status: 200, json: async () => ({ values: [] }) },
      // saveToSheets: getRows (empty)
      { ok: true, status: 200, json: async () => ({ values: [] }) },
      // saveToSheets: appendRows
      { ok: true, status: 200, json: async () => ({}) }
    ]);

    const resolved = await syncWithSheets('my-sheet');

    // Local values should be returned since sheet was empty
    assertEqual(resolved.threshold, 50);
    assertEqual(resolved.spreadsheet_id, 'my-sheet');
  });

  it('should keep local config when Sheets read fails', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 80, spreadsheet_id: 'local', root_folder_id: null });

    // Simulate network failure
    mockFetch({
      ok: false, status: 500,
      json: async () => ({})
    });

    const resolved = await syncWithSheets('test-spreadsheet-id');

    // Should keep local values as fallback
    assertEqual(resolved.threshold, 80);
    assertEqual(resolved.spreadsheet_id, 'local');
  });

  it('should preserve non-conflicting keys from both sources', async () => {
    clearStorage();
    setValidToken();
    // Local has threshold and spreadsheet_id
    saveConfig({ threshold: 50, spreadsheet_id: 'same-id', root_folder_id: 'local-only' });

    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['chave', 'valor'],
          ['threshold', '50'],
          ['spreadsheet_id', 'same-id']
          // Note: root_folder_id not in sheet
        ]
      })
    });

    const resolved = await syncWithSheets('same-id');

    // threshold and spreadsheet_id match, root_folder_id kept from local defaults
    assertEqual(resolved.threshold, 50);
    assertEqual(resolved.spreadsheet_id, 'same-id');
    // root_folder_id was in local config but Sheets didn't override it
    assertEqual(resolved.root_folder_id, 'local-only');
  });
});

describe('updateConfig — Immediate localStorage + debounced Sheets', () => {
  it('should save to localStorage immediately', () => {
    clearStorage();
    saveConfig({ threshold: 50, spreadsheet_id: 'test-sheet', root_folder_id: null });
    resetFetch();

    updateConfig('threshold', 80);

    // localStorage should be updated immediately
    const stored = loadConfig();
    assertEqual(stored.threshold, 80);
  });

  it('should preserve other config keys when updating one key', () => {
    clearStorage();
    saveConfig({ threshold: 50, spreadsheet_id: 'my-sheet', root_folder_id: 'my-folder' });

    updateConfig('threshold', 90);

    const stored = loadConfig();
    assertEqual(stored.threshold, 90);
    assertEqual(stored.spreadsheet_id, 'my-sheet');
    assertEqual(stored.root_folder_id, 'my-folder');
  });
});

describe('onSheetsSave — Save notification listener', () => {
  it('should notify listeners when saveToSheets succeeds', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    let notified = false;
    const unsub = onSheetsSave(() => { notified = true; });

    mockFetch([
      // getRows: empty
      { ok: true, status: 200, json: async () => ({ values: [] }) },
      // appendRows
      { ok: true, status: 200, json: async () => ({}) }
    ]);

    await saveToSheets('test-spreadsheet-id');

    assert(notified, 'Listener should have been called');
    unsub(); // Cleanup
  });

  it('should unsubscribe correctly', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    let callCount = 0;
    const unsub = onSheetsSave(() => { callCount++; });
    unsub();

    mockFetch([
      { ok: true, status: 200, json: async () => ({ values: [] }) },
      { ok: true, status: 200, json: async () => ({}) }
    ]);

    await saveToSheets('test-spreadsheet-id');

    assertEqual(callCount, 0, 'Listener should not be called after unsubscribe');
  });
});

describe('flushToSheets — Force immediate Sheets write', () => {
  it('should not throw when no spreadsheet ID is configured', async () => {
    clearStorage();
    saveConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });
    resetFetch();

    // Should not throw, just warn
    await flushToSheets();
    assertEqual(fetchCalls.length, 0);
  });

  it('should write to Sheets immediately when spreadsheet ID is set', async () => {
    clearStorage();
    setValidToken();
    saveConfig({ threshold: 70, spreadsheet_id: 'flush-sheet', root_folder_id: null });

    mockFetch([
      // getRows for saveToSheets
      { ok: true, status: 200, json: async () => ({ values: [] }) },
      // appendRows
      { ok: true, status: 200, json: async () => ({}) }
    ]);

    await flushToSheets();

    assert(fetchCalls.length > 0, 'Should have made fetch calls');
    assertEqual(fetchCalls[0].options.method, 'GET');
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
