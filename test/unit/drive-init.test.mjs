/**
 * Unit tests for js/core/drive-init.js
 *
 * Tests initialization of Google Drive folder structure:
 * - Creates "ComprovaLattes" root folder if not present
 * - Creates subfolders: files/, files/novos/, xml/
 * - Reuses existing folders if already present
 * - Saves root_folder_id in config
 * - Handles errors gracefully without crashing
 *
 * Requirements: 14.1
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

globalThis.document = {
  getElementById() { return null; },
};

// --- Fetch tracking ---
let fetchCalls = [];
let fetchHandler = null;

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  if (fetchHandler) {
    return fetchHandler(url, options);
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};

// --- Token setup ---
const TOKEN_KEY = 'comprova_lattes_token';
const CONFIG_KEY = 'comprova_config';

function setValidToken() {
  const tokenData = {
    access_token: 'ya29.test-drive-init-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/drive.file',
    stored_at: Date.now(),
    user_name: 'Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function setConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function getConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

function clearAll() {
  localStorage.clear();
  window.location.hash = '';
  fetchCalls = [];
  fetchHandler = null;
}

function resetFetch() {
  fetchCalls = [];
  fetchHandler = null;
}

// --- Import module under test ---
const { initDriveFolders } = await import('../../js/core/drive-init.js');

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

function assertIncludes(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to include "${substr}"`);
  }
}

// --- Helper: create fetch handler that simulates Drive folder operations ---
function createDriveMock({ existingFolders = {}, createdFolders = {} } = {}) {
  // existingFolders: { 'parentId/name': folderId } — folders that "exist"
  // createdFolders: list of created folder calls (populated during test)
  const created = [];

  return async (url, options) => {
    const method = options?.method || 'GET';

    // Find folder query
    if (url.includes('drive/v3/files') && method === 'GET') {
      // Decode the full URL to match folder names and parents
      const decodedUrl = decodeURIComponent(url).replace(/\+/g, ' ');
      for (const [key, folderId] of Object.entries(existingFolders)) {
        const [parentId, folderName] = key.split('/');
        if (decodedUrl.includes(`name='${folderName}'`) && decodedUrl.includes(`'${parentId}' in parents`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [{ id: folderId, name: folderName }] })
          };
        }
      }
      // Not found
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [] })
      };
    }

    // Create folder
    if (url.includes('drive/v3/files') && method === 'POST') {
      const body = JSON.parse(options.body);
      const newId = `new-${body.name}-${Date.now()}`;
      created.push({ name: body.name, parentId: body.parents[0], id: newId });
      createdFolders.items = created;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: newId, name: body.name })
      };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };
}

// --- Tests ---

describe('initDriveFolders — fresh install (no existing folders)', () => {
  it('should create root folder and all subfolders when nothing exists', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    const createdFolders = {};
    fetchHandler = createDriveMock({ existingFolders: {}, createdFolders });

    await initDriveFolders();

    const items = createdFolders.items;
    assert(items.length >= 4, `Expected at least 4 folders created, got ${items.length}`);

    // Check root folder was created
    const root = items.find(f => f.name === 'ComprovaLattes' && f.parentId === 'root');
    assert(root, 'Root folder "ComprovaLattes" should be created under root');

    // Check subfolders
    const files = items.find(f => f.name === 'files');
    assert(files, 'Subfolder "files" should be created');

    const novos = items.find(f => f.name === 'novos');
    assert(novos, 'Subfolder "novos" should be created');

    const xml = items.find(f => f.name === 'xml');
    assert(xml, 'Subfolder "xml" should be created');
  });

  it('should save root_folder_id in config after creation', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    const createdFolders = {};
    fetchHandler = createDriveMock({ existingFolders: {}, createdFolders });

    await initDriveFolders();

    const config = getConfig();
    assert(config.root_folder_id !== null, 'root_folder_id should be set in config');
    assertIncludes(config.root_folder_id, 'new-ComprovaLattes', 'root_folder_id should contain created ID');
  });
});

describe('initDriveFolders — existing root folder', () => {
  it('should reuse existing root folder and create missing subfolders', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: 'existing-root-123' });

    const createdFolders = {};
    fetchHandler = createDriveMock({
      existingFolders: {
        'root/ComprovaLattes': 'existing-root-123'
      },
      createdFolders
    });

    await initDriveFolders();

    const items = createdFolders.items || [];
    // Root should NOT have been created (already exists)
    const root = items.find(f => f.name === 'ComprovaLattes');
    assertEqual(root, undefined, 'Root folder should NOT be re-created');

    // Subfolders should be created since they don't exist
    const files = items.find(f => f.name === 'files');
    assert(files, 'Subfolder "files" should be created');
  });

  it('should not overwrite root_folder_id when it already exists', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: 'existing-root-123' });

    fetchHandler = createDriveMock({
      existingFolders: {
        'root/ComprovaLattes': 'existing-root-123',
        'existing-root-123/files': 'files-id',
        'files-id/novos': 'novos-id',
        'existing-root-123/xml': 'xml-id'
      }
    });

    await initDriveFolders();

    const config = getConfig();
    assertEqual(config.root_folder_id, 'existing-root-123', 'root_folder_id should remain unchanged');
  });
});

describe('initDriveFolders — all folders already exist', () => {
  it('should not create any folders when all exist', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: 'root-abc' });

    const createdFolders = {};
    fetchHandler = createDriveMock({
      existingFolders: {
        'root/ComprovaLattes': 'root-abc',
        'root-abc/files': 'files-abc',
        'files-abc/novos': 'novos-abc',
        'root-abc/xml': 'xml-abc'
      },
      createdFolders
    });

    await initDriveFolders();

    const items = createdFolders.items || [];
    assertEqual(items.length, 0, 'No folders should be created when all exist');
  });
});

describe('initDriveFolders — root folder deleted from Drive', () => {
  it('should re-create root folder when configured ID no longer exists in Drive', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: 'deleted-folder-id' });

    const createdFolders = {};
    // No folders exist in Drive at all
    fetchHandler = createDriveMock({ existingFolders: {}, createdFolders });

    await initDriveFolders();

    const items = createdFolders.items || [];
    const root = items.find(f => f.name === 'ComprovaLattes' && f.parentId === 'root');
    assert(root, 'Root folder should be re-created when missing from Drive');

    const config = getConfig();
    assert(config.root_folder_id !== 'deleted-folder-id', 'root_folder_id should be updated');
  });
});

describe('initDriveFolders — error handling', () => {
  it('should not throw when Drive API returns an error', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    fetchHandler = async () => {
      return { ok: false, status: 403, text: async () => 'Forbidden' };
    };

    // Should NOT throw — errors are handled gracefully
    let threw = false;
    try {
      await initDriveFolders();
    } catch (e) {
      threw = true;
    }
    assertEqual(threw, false, 'initDriveFolders should not throw on API errors');
  });

  it('should not throw on network errors', async () => {
    clearAll();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    fetchHandler = async () => {
      throw new TypeError('Failed to fetch');
    };

    let threw = false;
    try {
      await initDriveFolders();
    } catch (e) {
      threw = true;
    }
    assertEqual(threw, false, 'initDriveFolders should not throw on network errors');
  });

  it('should not throw when no token is available', async () => {
    clearAll();
    // No token set
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    let threw = false;
    try {
      await initDriveFolders();
    } catch (e) {
      threw = true;
    }
    assertEqual(threw, false, 'initDriveFolders should not throw when unauthenticated');
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
