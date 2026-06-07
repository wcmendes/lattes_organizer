/**
 * Unit tests for js/services/drive.js
 *
 * Tests Google Drive API v3 CRUD operations including:
 * - findFolder (Req 14.1)
 * - createFolder (Req 14.2, 14.3)
 * - uploadFile (Req 14.4)
 * - moveFile (Req 14.5, 14.6)
 * - renameFile (Req 14.5)
 * - listFiles (Req 14.1)
 * - downloadFile
 * - deleteFile
 * - Retry logic for 429/5xx
 * - 401 handling (signOut)
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
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

// TextEncoder/TextDecoder are available natively in Node.js 18+
// If not, provide a minimal polyfill
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = await import('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// --- Fetch tracking ---
let fetchCalls = [];
let fetchHandler = null;

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  if (fetchHandler) {
    return fetchHandler(url, options);
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
};

// --- Setup token ---
const TOKEN_KEY = 'comprova_lattes_token';

function setValidToken() {
  const tokenData = {
    access_token: 'ya29.test-drive-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/drive.file',
    stored_at: Date.now(),
    user_name: 'Drive Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function clearStorage() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.hash = '';
}

function resetFetch() {
  fetchCalls = [];
  fetchHandler = null;
}

// --- Import drive module ---
const {
  findFolder,
  createFolder,
  uploadFile,
  moveFile,
  renameFile,
  listFiles,
  downloadFile,
  deleteFile,
} = await import('../../js/services/drive.js');

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

function assertIncludes(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to include "${substr}"`);
  }
}

// --- Tests ---

describe('findFolder — Req 14.1 (find folder by name)', () => {
  it('should return folderId when folder exists', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url) => {
      assertIncludes(url, 'drive/v3/files');
      assertIncludes(url, 'mimeType');
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ id: 'folder-123', name: 'ComprovaLattes' }] })
      };
    };
    const result = await findFolder('ComprovaLattes', 'root');
    assertEqual(result, 'folder-123');
  });

  it('should return null when folder does not exist', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [] })
    });
    const result = await findFolder('NonExistent', 'root');
    assertNull(result);
  });

  it('should include parent in query', async () => {
    resetFetch();
    setValidToken();
    let capturedUrl = '';
    fetchHandler = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    };
    await findFolder('MyFolder', 'parent-id-123');
    assertIncludes(capturedUrl, 'parent-id-123');
  });

  it('should escape single quotes in folder name', async () => {
    resetFetch();
    setValidToken();
    let capturedUrl = '';
    fetchHandler = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    };
    await findFolder("Folder's Name", 'root');
    // URL-encoded version of \' is %5C%27
    assertIncludes(capturedUrl, '%5C%27');
  });

  it('should send Authorization header with Bearer token', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url, options) => {
      assertEqual(options.headers['Authorization'], 'Bearer ya29.test-drive-token');
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    };
    await findFolder('Test', 'root');
  });

  it('should throw when no token is available', async () => {
    resetFetch();
    clearStorage();
    try {
      await findFolder('Test', 'root');
      assert(false, 'Should have thrown');
    } catch (e) {
      assertIncludes(e.message, 'No auth token');
    }
  });
});

describe('createFolder — Req 14.2, 14.3 (create folder)', () => {
  it('should create folder and return its id', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url, options) => {
      assertEqual(options.method, 'POST');
      const body = JSON.parse(options.body);
      assertEqual(body.name, 'files');
      assertEqual(body.mimeType, 'application/vnd.google-apps.folder');
      assertEqual(body.parents[0], 'root-folder-id');
      return { ok: true, status: 200, json: async () => ({ id: 'new-folder-456' }) };
    };
    const result = await createFolder('files', 'root-folder-id');
    assertEqual(result, 'new-folder-456');
  });

  it('should include parent in request body', async () => {
    resetFetch();
    setValidToken();
    let capturedBody = null;
    fetchHandler = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ id: 'new-id' }) };
    };
    await createFolder('novos', 'parent-xyz');
    assertEqual(capturedBody.parents[0], 'parent-xyz');
  });
});

describe('uploadFile — Req 14.4 (multipart upload)', () => {
  it('should upload file and return id and name', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url, options) => {
      assertIncludes(url, 'upload/drive/v3/files');
      assertEqual(options.method, 'POST');
      assertIncludes(options.headers['Content-Type'], 'multipart/related');
      return { ok: true, status: 200, json: async () => ({ id: 'file-789', name: 'test.pdf' }) };
    };

    // Create a minimal File-like object
    const blob = new Blob(['test content'], { type: 'application/pdf' });
    const file = new File([blob], 'test.pdf', { type: 'application/pdf' });
    const result = await uploadFile(file, 'folder-id', 'test.pdf');
    assertEqual(result.id, 'file-789');
    assertEqual(result.name, 'test.pdf');
  });

  it('should use file.name when fileName is not provided', async () => {
    resetFetch();
    setValidToken();
    let bodyContent = '';
    fetchHandler = async (url, options) => {
      // Read the body as text to check metadata
      const decoder = new TextDecoder();
      bodyContent = decoder.decode(options.body);
      return { ok: true, status: 200, json: async () => ({ id: 'file-abc', name: 'original.png' }) };
    };

    const blob = new Blob(['img'], { type: 'image/png' });
    const file = new File([blob], 'original.png', { type: 'image/png' });
    const result = await uploadFile(file, 'folder-id');
    assertEqual(result.name, 'original.png');
    assertIncludes(bodyContent, 'original.png');
  });

  it('should throw when no token available', async () => {
    resetFetch();
    clearStorage();
    const file = new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' });
    try {
      await uploadFile(file, 'folder-id');
      assert(false, 'Should have thrown');
    } catch (e) {
      assertIncludes(e.message, 'No auth token');
    }
  });
});

describe('moveFile — Req 14.5, 14.6 (move between folders)', () => {
  it('should PATCH with addParents and removeParents', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url, options) => {
      assertEqual(options.method, 'PATCH');
      assertIncludes(url, 'file-id-move');
      assertIncludes(url, 'addParents=dest-folder');
      assertIncludes(url, 'removeParents=src-folder');
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await moveFile('file-id-move', 'src-folder', 'dest-folder');
  });
});

describe('renameFile — Req 14.5 (rename file)', () => {
  it('should PATCH with new name in body', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url, options) => {
      assertEqual(options.method, 'PATCH');
      assertIncludes(url, 'file-id-rename');
      const body = JSON.parse(options.body);
      assertEqual(body.name, '2023_formacao_USP_Curso.pdf');
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await renameFile('file-id-rename', '2023_formacao_USP_Curso.pdf');
  });
});

describe('listFiles — Req 14.1 (list folder contents)', () => {
  it('should return array of files', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url) => {
      assertIncludes(url, 'folder-list-id');
      assertIncludes(url, 'trashed%3Dfalse');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf' },
            { id: 'f2', name: 'img.png', mimeType: 'image/png' }
          ]
        })
      };
    };
    const result = await listFiles('folder-list-id');
    assertEqual(result.length, 2);
    assertEqual(result[0].id, 'f1');
    assertEqual(result[1].name, 'img.png');
  });

  it('should return empty array when folder is empty', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ files: [] }) });
    const result = await listFiles('empty-folder');
    assertEqual(result.length, 0);
  });

  it('should request pageSize=1000', async () => {
    resetFetch();
    setValidToken();
    let capturedUrl = '';
    fetchHandler = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    };
    await listFiles('some-folder');
    assertIncludes(capturedUrl, 'pageSize=1000');
  });
});

describe('downloadFile — binary download', () => {
  it('should request with alt=media and return ArrayBuffer', async () => {
    resetFetch();
    setValidToken();
    const testBuffer = new ArrayBuffer(16);
    fetchHandler = async (url) => {
      assertIncludes(url, 'file-dl-id');
      assertIncludes(url, 'alt=media');
      return { ok: true, status: 200, arrayBuffer: async () => testBuffer };
    };
    const result = await downloadFile('file-dl-id');
    assertEqual(result, testBuffer);
  });
});

describe('deleteFile — permanent deletion', () => {
  it('should send DELETE request', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url, options) => {
      assertEqual(options.method, 'DELETE');
      assertIncludes(url, 'file-del-id');
      return { ok: true, status: 204 };
    };
    await deleteFile('file-del-id');
  });
});

describe('Retry logic — 429 and 5xx', () => {
  it('should retry on 429 and succeed on second attempt', async () => {
    resetFetch();
    setValidToken();
    let callCount = 0;
    fetchHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429 };
      }
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    };
    const result = await listFiles('retry-folder');
    assertEqual(result.length, 0);
    assertEqual(callCount, 2);
  });

  it('should retry on 500 and succeed on second attempt', async () => {
    resetFetch();
    setValidToken();
    let callCount = 0;
    fetchHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500 };
      }
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    };
    const result = await listFiles('retry-folder');
    assertEqual(result.length, 0);
    assertEqual(callCount, 2);
  });

  it('should throw after MAX_RETRIES exhausted', async () => {
    resetFetch();
    setValidToken();
    let callCount = 0;
    fetchHandler = async () => {
      callCount++;
      return { ok: false, status: 503 };
    };
    try {
      await listFiles('doomed-folder');
      assert(false, 'Should have thrown');
    } catch (e) {
      assertIncludes(e.message, 'retries');
      // Should have attempted MAX_RETRIES + 1 times (initial + 3 retries)
      assertEqual(callCount, 4);
    }
  });
});

describe('401 handling — signOut trigger', () => {
  it('should call signOut and throw on 401 response', async () => {
    resetFetch();
    setValidToken();
    fetchHandler = async (url) => {
      if (url.includes('drive/v3/files')) {
        return { ok: false, status: 401 };
      }
      // signOut calls revoke endpoint
      return { ok: true, status: 200, json: async () => ({}) };
    };
    try {
      await listFiles('unauthorized-folder');
      assert(false, 'Should have thrown');
    } catch (e) {
      assertIncludes(e.message, 'Authentication expired');
    }
    // Should have cleared token and redirected
    assertEqual(window.location.hash, '#login');
  });
});

describe('Error handling — non-retryable errors', () => {
  it('should throw on 403 without retry', async () => {
    resetFetch();
    setValidToken();
    let callCount = 0;
    fetchHandler = async () => {
      callCount++;
      return { ok: false, status: 403, text: async () => 'Forbidden' };
    };
    try {
      await findFolder('Test', 'root');
      assert(false, 'Should have thrown');
    } catch (e) {
      assertIncludes(e.message, '403');
      assertEqual(callCount, 1); // No retry for 403
    }
  });

  it('should throw on 404 without retry', async () => {
    resetFetch();
    setValidToken();
    let callCount = 0;
    fetchHandler = async () => {
      callCount++;
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };
    try {
      await createFolder('test', 'root');
      assert(false, 'Should have thrown');
    } catch (e) {
      assertIncludes(e.message, '404');
      assertEqual(callCount, 1);
    }
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
