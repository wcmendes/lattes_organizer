/**
 * Unit tests for js/core/exporter.js
 *
 * Tests export functionality including:
 * - formatExportFileName (Req 9.3): pattern, max 200 chars, ASCII-safe, deterministic
 * - exportToDrive (Req 9.2, 9.5, 9.6, 9.7): folder structure, progress, error handling
 * - exportToZip (Req 9.4, 9.5, 9.6, 9.7): ZIP generation, progress, error handling
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
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

// DOM simulation for overlay and toast
const createdElements = [];

function createMockElement(tag) {
  const el = {
    tagName: tag,
    className: '',
    innerHTML: '',
    textContent: '',
    dataset: {},
    children: [],
    childNodes: [],
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    setAttribute() {},
    querySelector(sel) {
      return { textContent: '', addEventListener() {} };
    },
    appendChild(child) { el.children.push(child); },
    addEventListener() {},
    remove() {}
  };
  return el;
}

globalThis.document = {
  body: {
    appendChild(el) { createdElements.push(el); },
    contains() { return false; }
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  getElementById() { return null; }
};

// Timer simulation - execute callbacks immediately for testing
const pendingTimers = [];
let nextTimerId = 1;
globalThis.setTimeout = (fn, ms) => {
  const id = nextTimerId++;
  // Execute immediately for test speed (avoids blocking on retry delays)
  try { fn(); } catch(e) {}
  return id;
};
globalThis.clearTimeout = () => {};
globalThis.setInterval = (fn, ms) => { return nextTimerId++; };
globalThis.clearInterval = () => {};

// --- Fetch simulation ---
let fetchCalls = [];
let fetchHandler = null;

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  if (fetchHandler) {
    return fetchHandler(url, options);
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
};

// --- JSZip simulation ---
class MockJSZipFolder {
  constructor(name) {
    this.name = name;
    this.files = new Map();
  }
  file(name, content) {
    this.files.set(name, content);
  }
}

class MockJSZip {
  constructor() {
    this.folders = new Map();
  }
  folder(name) {
    const f = new MockJSZipFolder(name);
    this.folders.set(name, f);
    return f;
  }
  async generateAsync(options) {
    return new Blob(['mock-zip-content'], { type: 'application/zip' });
  }
}

globalThis.JSZip = MockJSZip;

// Blob and File polyfills for Node.js
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options?.type || '';
      this.size = parts.reduce((sum, p) => sum + (p.byteLength || p.length || 0), 0);
    }
  };
}

if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File extends Blob {
    constructor(parts, name, options) {
      super(parts, options);
      this.name = name;
    }
    async arrayBuffer() {
      return this.parts[0] instanceof ArrayBuffer ? this.parts[0] : new ArrayBuffer(0);
    }
  };
}

// --- Setup token ---
const TOKEN_KEY = 'comprova_lattes_token';

function setValidToken() {
  const tokenData = {
    access_token: 'ya29.test-exporter-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/drive.file',
    stored_at: Date.now(),
    user_name: 'Exporter Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function resetFetch() {
  fetchCalls = [];
  fetchHandler = null;
}

// --- Import module under test ---
const { formatExportFileName, exportToDrive, exportToZip } = await import('../../js/core/exporter.js');

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

function assertTrue(value, message) {
  if (value !== true) {
    throw new Error(message || `Expected true but got "${value}"`);
  }
}

// --- Tests ---

describe('formatExportFileName — Req 9.3 (file name format)', () => {
  it('should produce pattern ANO_categoria_INSTITUICAO_Titulo.ext', () => {
    const entry = {
      ano: '2021',
      categoria_display: 'Formação Complementar',
      instituicao: 'UFMG',
      titulo: 'Curso de Java'
    };
    const result = formatExportFileName(entry, 'pdf');
    assertEqual(result, '2021_Formacao-Complementar_UFMG_Curso-de-Java.pdf');
  });

  it('should remove diacritics (ASCII-safe)', () => {
    const entry = {
      ano: '2020',
      categoria_display: 'Participação em Eventos',
      instituicao: 'USP São Paulo',
      titulo: 'Congresso Científico'
    };
    const result = formatExportFileName(entry, 'pdf');
    // Should not contain accented characters
    assert(!/[àáâãäéèêëíìîïóòôõöúùûüçñ]/i.test(result), 'Should be ASCII-safe');
    assert(result.includes('Participacao-em-Eventos'), 'Should transliterate');
    assert(result.includes('USP-Sao-Paulo'), 'Should transliterate');
    assert(result.includes('Congresso-Cientifico'), 'Should transliterate');
  });

  it('should limit total length to 200 characters including extension', () => {
    const entry = {
      ano: '2022',
      categoria_display: 'Formação Complementar',
      instituicao: 'Universidade',
      titulo: 'A'.repeat(300) // Very long title
    };
    const result = formatExportFileName(entry, 'pdf');
    assert(result.length <= 200, `Expected max 200 chars but got ${result.length}`);
    assert(result.endsWith('.pdf'), 'Should end with extension');
  });

  it('should be deterministic (same input → same output)', () => {
    const entry = {
      ano: '2019',
      categoria_display: 'Eventos',
      instituicao: 'UNICAMP',
      titulo: 'Workshop de IA'
    };
    const result1 = formatExportFileName(entry, 'jpg');
    const result2 = formatExportFileName(entry, 'jpg');
    assertEqual(result1, result2, 'Should produce same output for same input');
  });

  it('should handle missing fields gracefully', () => {
    const entry = {
      ano: '',
      categoria_display: '',
      instituicao: '',
      titulo: ''
    };
    const result = formatExportFileName(entry, 'pdf');
    assert(result.endsWith('.pdf'), 'Should still have extension');
    assert(result.length > 4, 'Should have some content');
    assert(result.length <= 200, 'Should not exceed 200 chars');
  });

  it('should handle extension with or without leading dot', () => {
    const entry = {
      ano: '2021',
      categoria_display: 'Teste',
      instituicao: 'UFMG',
      titulo: 'Documento'
    };
    const result1 = formatExportFileName(entry, 'pdf');
    const result2 = formatExportFileName(entry, '.pdf');
    assertEqual(result1, result2, 'Should normalize extension');
  });

  it('should replace special filesystem characters', () => {
    const entry = {
      ano: '2021',
      categoria_display: 'Formação',
      instituicao: 'UFMG/SP',
      titulo: 'Curso: Intro <C++>'
    };
    const result = formatExportFileName(entry, 'pdf');
    assert(!/[\/\\:*?"<>|]/.test(result), 'Should not contain filesystem-unsafe chars');
  });

  it('should use fallback values for null/undefined fields', () => {
    const entry = {
      ano: null,
      categoria_display: undefined,
      instituicao: null,
      titulo: undefined
    };
    const result = formatExportFileName(entry, 'pdf');
    assert(result.includes('XXXX'), 'Should use XXXX for missing year');
    assert(result.endsWith('.pdf'), 'Should end with extension');
  });
});

describe('exportToDrive — Req 9.2, 9.5, 9.6, 9.7 (Drive export)', () => {
  it('should throw error if no mapped entries exist (Req 9.6)', async () => {
    resetFetch();
    setValidToken();
    const entries = [
      { id: '1', titulo: 'Test', status: 'pendente', arquivo_drive_id: null, categoria: 'cat1' }
    ];
    const config = { rootFolderId: 'root-id', categories: [] };

    try {
      await exportToDrive(entries, config, () => {});
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('mapeados'), 'Should indicate no mappings');
    }
  });

  it('should call onProgress for each file exported', async () => {
    resetFetch();
    setValidToken();

    const progressCalls = [];
    const entries = [
      { id: '1', titulo: 'Doc 1', status: 'mapeada', arquivo_drive_id: 'file-1', arquivo_nome: 'doc1.pdf', categoria: 'cat1', ano: '2021', instituicao: 'UFMG' },
      { id: '2', titulo: 'Doc 2', status: 'mapeada', arquivo_drive_id: 'file-2', arquivo_nome: 'doc2.pdf', categoria: 'cat1', ano: '2022', instituicao: 'USP' }
    ];
    const categories = [
      { id: 'cat1', nome_xml: 'FORMACAO', nome_display: 'Formação', ativa: true }
    ];
    const config = { rootFolderId: 'root-id', categories };

    // Mock Drive API calls
    fetchHandler = async (url, options) => {
      if (url.includes('q=') && url.includes('exportacao')) {
        // findFolder('exportacao')
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
      if (url.includes('q=')) {
        // Other findFolder/listFiles calls
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
      if (options?.method === 'POST' && url.includes('uploadType=multipart')) {
        // uploadFile
        return { ok: true, status: 200, json: async () => ({ id: 'new-file', name: 'test.pdf' }) };
      }
      if (options?.method === 'POST') {
        // createFolder
        return { ok: true, status: 200, json: async () => ({ id: 'new-folder-id' }) };
      }
      if (url.includes('alt=media')) {
        // downloadFile
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const result = await exportToDrive(entries, config, (current, total) => {
      progressCalls.push({ current, total });
    });

    assertEqual(progressCalls.length, 2, 'Should call onProgress for each file');
    assertEqual(progressCalls[0].current, 1);
    assertEqual(progressCalls[0].total, 2);
    assertEqual(progressCalls[1].current, 2);
    assertEqual(progressCalls[1].total, 2);
    assertEqual(result.success, 2);
    assertEqual(result.failed, 0);
  });

  it('should continue on individual file failures and report errors (Req 9.7)', async () => {
    resetFetch();
    setValidToken();

    const entries = [
      { id: '1', titulo: 'Good Doc', status: 'mapeada', arquivo_drive_id: 'file-1', arquivo_nome: 'doc1.pdf', categoria: 'cat1', ano: '2021', instituicao: 'UFMG' },
      { id: '2', titulo: 'Bad Doc', status: 'mapeada', arquivo_drive_id: 'file-bad', arquivo_nome: 'doc2.pdf', categoria: 'cat1', ano: '2022', instituicao: 'USP' }
    ];
    const categories = [
      { id: 'cat1', nome_xml: 'FORMACAO', nome_display: 'Formação', ativa: true }
    ];
    const config = { rootFolderId: 'root-id', categories };

    fetchHandler = async (url, options) => {
      if (url.includes('q=')) {
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
      if (options?.method === 'POST' && url.includes('uploadType=multipart')) {
        return { ok: true, status: 200, json: async () => ({ id: 'new-file', name: 'test.pdf' }) };
      }
      if (options?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'new-folder-id' }) };
      }
      if (url.includes('alt=media')) {
        // Fail for the "bad" file ID, succeed for the good one
        if (url.includes('file-bad')) {
          // Return a non-retryable client error (403) to avoid retry delays
          return { ok: false, status: 403, text: async () => 'Forbidden' };
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const result = await exportToDrive(entries, config, () => {});

    assertEqual(result.success, 1, 'Should have 1 successful export');
    assertEqual(result.failed, 1, 'Should have 1 failed export');
    assertEqual(result.errors.length, 1, 'Should have 1 error message');
  });
});

describe('exportToZip — Req 9.4, 9.5, 9.6 (ZIP export)', () => {
  it('should throw error if no mapped entries exist (Req 9.6)', async () => {
    resetFetch();
    setValidToken();
    const entries = [
      { id: '1', titulo: 'Test', status: 'pendente', arquivo_drive_id: null, categoria: 'cat1' }
    ];
    const config = { categories: [] };

    try {
      await exportToZip(entries, config, () => {});
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('mapeados'), 'Should indicate no mappings');
    }
  });

  it('should generate a Blob from JSZip', async () => {
    resetFetch();
    setValidToken();

    const entries = [
      { id: '1', titulo: 'Doc 1', status: 'mapeada', arquivo_drive_id: 'file-1', arquivo_nome: 'doc1.pdf', categoria: 'cat1', ano: '2021', instituicao: 'UFMG' }
    ];
    const categories = [
      { id: 'cat1', nome_xml: 'FORMACAO', nome_display: 'Formação', ativa: true }
    ];
    const config = { categories };

    fetchHandler = async (url) => {
      if (url.includes('alt=media')) {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const blob = await exportToZip(entries, config, () => {});
    assert(blob instanceof Blob, 'Should return a Blob');
  });

  it('should call onProgress for each file', async () => {
    resetFetch();
    setValidToken();

    const progressCalls = [];
    const entries = [
      { id: '1', titulo: 'Doc 1', status: 'mapeada', arquivo_drive_id: 'file-1', arquivo_nome: 'doc1.pdf', categoria: 'cat1', ano: '2021', instituicao: 'UFMG' },
      { id: '2', titulo: 'Doc 2', status: 'mantida_manual', arquivo_drive_id: 'file-2', arquivo_nome: 'doc2.jpg', categoria: 'cat1', ano: '2022', instituicao: 'USP' }
    ];
    const categories = [
      { id: 'cat1', nome_xml: 'FORMACAO', nome_display: 'Formação', ativa: true }
    ];
    const config = { categories };

    fetchHandler = async (url) => {
      if (url.includes('alt=media')) {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await exportToZip(entries, config, (current, total) => {
      progressCalls.push({ current, total });
    });

    assertEqual(progressCalls.length, 2, 'Should call progress for each file');
    assertEqual(progressCalls[0].total, 2);
    assertEqual(progressCalls[1].current, 2);
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
