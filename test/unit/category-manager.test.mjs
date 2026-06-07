/**
 * Unit tests for js/core/category-manager.js
 *
 * Tests category management and visibility:
 * - loadCategories: loading from Sheets
 * - toggleCategory: ON/OFF with persistence and Drive folder creation
 * - hideEntry / unhideEntry: individual entry visibility with persistence
 * - getVisibleEntries: filtering by visibility rules (Property 6)
 * - getActiveCategories: filtering active categories
 * - getHiddenItems: listing hidden categories and entries
 *
 * Requirements: 2.5, 2.6, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9, 6.10, 14.2, 14.3
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

// --- Token setup ---
const TOKEN_KEY = 'comprova_lattes_token';

function setValidToken() {
  const tokenData = {
    access_token: 'ya29.test-category-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    stored_at: Date.now(),
    user_name: 'Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function clearStorage() {
  Object.keys(store).forEach(k => delete store[k]);
}

function setConfig(config) {
  localStorage.setItem('comprova_config', JSON.stringify(config));
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

// --- Import module under test ---
const {
  loadCategories,
  toggleCategory,
  hideEntry,
  unhideEntry,
  getVisibleEntries,
  getActiveCategories,
  getHiddenItems,
} = await import('../../js/core/category-manager.js');

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

// --- Sample Data ---
const SAMPLE_CATEGORIES = [
  { id: 'cat-1', nome_xml: 'FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO', nome_display: 'Formação Complementar — Curso de Curta Duração', ativa: true, pasta_drive_id: 'folder-1' },
  { id: 'cat-2', nome_xml: 'PARTICIPACAO-EM-CONGRESSO', nome_display: 'Participação em Congresso', ativa: false, pasta_drive_id: null },
  { id: 'cat-3', nome_xml: 'PRODUCAO-BIBLIOGRAFICA-ARTIGO', nome_display: 'Produção Bibliográfica — Artigo', ativa: true, pasta_drive_id: 'folder-3' },
];

const SAMPLE_ENTRIES = [
  { id: 'e1', titulo: 'Curso Python', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', categoria: 'cat-1', status: 'pendente', oculta: false, arquivo_drive_id: null, arquivo_nome: null, confianca: null, data_mapeamento: null },
  { id: 'e2', titulo: 'Curso Java', instituicao: 'USP', ano: '2022', carga_horaria: '60', categoria: 'cat-1', status: 'mapeada', oculta: false, arquivo_drive_id: 'file-1', arquivo_nome: 'cert.pdf', confianca: 85, data_mapeamento: '2024-01-15' },
  { id: 'e3', titulo: 'Congresso IA', instituicao: 'SBC', ano: '2023', carga_horaria: '16', categoria: 'cat-2', status: 'pendente', oculta: false, arquivo_drive_id: null, arquivo_nome: null, confianca: null, data_mapeamento: null },
  { id: 'e4', titulo: 'Artigo ML', instituicao: 'IEEE', ano: '2023', carga_horaria: '', categoria: 'cat-3', status: 'pendente', oculta: true, arquivo_drive_id: null, arquivo_nome: null, confianca: null, data_mapeamento: null },
  { id: 'e5', titulo: 'Curso antigo', instituicao: 'PUC', ano: '2019', carga_horaria: '20', categoria: 'cat-1', status: 'removida', oculta: false, arquivo_drive_id: null, arquivo_nome: null, confianca: null, data_mapeamento: null },
  { id: 'e6', titulo: 'Curso mantido', instituicao: 'UNICAMP', ano: '2018', carga_horaria: '30', categoria: 'cat-1', status: 'mantida_manual', oculta: false, arquivo_drive_id: 'file-2', arquivo_nome: 'mantido.pdf', confianca: 90, data_mapeamento: '2024-02-01' },
];

// --- Tests ---

describe('loadCategories — Load from Sheets', () => {
  it('should parse categories from Sheets rows', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['id', 'nome_xml', 'nome_display', 'ativa', 'pasta_drive_id'],
          ['cat-1', 'FORMACAO-COMPLEMENTAR', 'Formação Complementar', 'TRUE', 'folder-abc'],
          ['cat-2', 'PARTICIPACAO-EM-CONGRESSO', 'Participação em Congresso', 'FALSE', ''],
        ]
      })
    });

    const categories = await loadCategories('test-sheet-id');

    assertEqual(categories.length, 2);
    assertEqual(categories[0].id, 'cat-1');
    assertEqual(categories[0].nome_xml, 'FORMACAO-COMPLEMENTAR');
    assertEqual(categories[0].ativa, true);
    assertEqual(categories[0].pasta_drive_id, 'folder-abc');
    assertEqual(categories[1].id, 'cat-2');
    assertEqual(categories[1].ativa, false);
    assertEqual(categories[1].pasta_drive_id, null);
  });

  it('should return empty array when sheet has no data rows', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({ values: [] })
    });

    const categories = await loadCategories('test-sheet-id');
    assertEqual(categories.length, 0);
  });

  it('should handle missing fields gracefully', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['id', 'nome_xml', 'nome_display', 'ativa', 'pasta_drive_id'],
          ['cat-x', '', '', '', ''],
        ]
      })
    });

    const categories = await loadCategories('test-sheet-id');
    assertEqual(categories[0].id, 'cat-x');
    assertEqual(categories[0].nome_xml, '');
    assertEqual(categories[0].nome_display, '');
    assertEqual(categories[0].ativa, false);
    assertEqual(categories[0].pasta_drive_id, null);
  });
});

describe('toggleCategory — Toggle ON/OFF with persistence (Req 6.7, 14.2, 14.3)', () => {
  it('should persist toggle OFF to Sheets', async () => {
    clearStorage();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    // updateRow response
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    const result = await toggleCategory('cat-1', false, SAMPLE_CATEGORIES);

    assertEqual(result.ativa, false);
    assertEqual(result.id, 'cat-1');
    // Verify Sheets was called (PUT for updateRow)
    assertEqual(fetchCalls.length, 1);
    assertEqual(fetchCalls[0].options.method, 'PUT');
  });

  it('should persist toggle ON and create subfolder if needed (Req 14.3)', async () => {
    clearStorage();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    mockFetch([
      // findFolder('files', rootFolderId) → found
      { ok: true, status: 200, json: async () => ({ files: [{ id: 'files-folder-id', name: 'files' }] }) },
      // findFolder(slug, filesFolderId) → not found
      { ok: true, status: 200, json: async () => ({ files: [] }) },
      // createFolder(slug, filesFolderId) → created
      { ok: true, status: 200, json: async () => ({ id: 'new-cat-folder-id' }) },
      // updateRow (persist category)
      { ok: true, status: 200, json: async () => ({}) },
    ]);

    const result = await toggleCategory('cat-2', true, SAMPLE_CATEGORIES);

    assertEqual(result.ativa, true);
    assertEqual(result.pasta_drive_id, 'new-cat-folder-id');
    // Should have called Drive API to find/create folder, then Sheets to persist
    assertEqual(fetchCalls.length, 4);
  });

  it('should not create folder if category already has pasta_drive_id', async () => {
    clearStorage();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    // Only updateRow needed
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    // cat-1 already has pasta_drive_id: 'folder-1'
    const result = await toggleCategory('cat-1', true, SAMPLE_CATEGORIES);

    assertEqual(result.ativa, true);
    assertEqual(result.pasta_drive_id, 'folder-1');
    // Only 1 call: updateRow
    assertEqual(fetchCalls.length, 1);
  });

  it('should throw if category not found', async () => {
    clearStorage();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    let error = null;
    try {
      await toggleCategory('nonexistent', true, SAMPLE_CATEGORIES);
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'Should have thrown');
    assert(error.message.includes('não encontrada'));
  });

  it('should throw if spreadsheet not configured (Req 6.8 rollback trigger)', async () => {
    clearStorage();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    let error = null;
    try {
      await toggleCategory('cat-1', false, SAMPLE_CATEGORIES);
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'Should have thrown');
    assert(error.message.includes('Planilha'));
  });

  it('should propagate Sheets error for rollback (Req 6.8)', async () => {
    clearStorage();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    // Simulate Sheets API failure — sheets.js retries 3 times on 500, so we need 4 failures
    const failResponse = { ok: false, status: 500, json: async () => ({ error: { message: 'Internal error' } }) };
    mockFetch([failResponse, failResponse, failResponse, failResponse]);

    let error = null;
    try {
      await toggleCategory('cat-1', false, SAMPLE_CATEGORIES);
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'Should propagate error for rollback');
  });
});

describe('hideEntry — Hide individual entry (Req 6.4, 6.7)', () => {
  it('should persist oculta=TRUE to Sheets', async () => {
    clearStorage();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    const result = await hideEntry('e1', SAMPLE_ENTRIES);

    assertEqual(result.oculta, true);
    assertEqual(result.id, 'e1');
    assertEqual(fetchCalls.length, 1);
    assertEqual(fetchCalls[0].options.method, 'PUT');
    // Verify the body contains oculta: TRUE
    const body = JSON.parse(fetchCalls[0].options.body);
    assert(body.values[0].includes('TRUE'), 'Should write TRUE for oculta');
  });

  it('should throw if entry not found', async () => {
    clearStorage();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    let error = null;
    try {
      await hideEntry('nonexistent', SAMPLE_ENTRIES);
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'Should have thrown');
    assert(error.message.includes('não encontrada'));
  });

  it('should throw if spreadsheet not configured', async () => {
    clearStorage();
    setConfig({ threshold: 50, spreadsheet_id: null, root_folder_id: null });

    let error = null;
    try {
      await hideEntry('e1', SAMPLE_ENTRIES);
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'Should have thrown');
  });
});

describe('unhideEntry — Restore hidden entry (Req 6.6, 6.7)', () => {
  it('should persist oculta=FALSE to Sheets', async () => {
    clearStorage();
    setValidToken();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    const result = await unhideEntry('e4', SAMPLE_ENTRIES);

    assertEqual(result.oculta, false);
    assertEqual(result.id, 'e4');
    assertEqual(fetchCalls.length, 1);
    assertEqual(fetchCalls[0].options.method, 'PUT');
    const body = JSON.parse(fetchCalls[0].options.body);
    assert(body.values[0].includes('FALSE'), 'Should write FALSE for oculta');
  });

  it('should throw if entry not found', async () => {
    clearStorage();
    setConfig({ threshold: 50, spreadsheet_id: 'sheet-1', root_folder_id: 'root-1' });

    let error = null;
    try {
      await unhideEntry('nonexistent', SAMPLE_ENTRIES);
    } catch (e) {
      error = e;
    }
    assert(error !== null, 'Should have thrown');
  });
});

describe('getVisibleEntries — Visibility filtering (Property 6)', () => {
  it('should return entries from active categories, not hidden, not removed', () => {
    const visible = getVisibleEntries(SAMPLE_ENTRIES, SAMPLE_CATEGORIES);

    // cat-1 active: e1 (visible), e2 (visible), e5 (removida → excluded), e6 (mantida_manual → visible)
    // cat-2 inactive: e3 excluded
    // cat-3 active: e4 (oculta → excluded)
    const ids = visible.map(e => e.id);
    assert(ids.includes('e1'), 'e1 should be visible (active category, not hidden, pendente)');
    assert(ids.includes('e2'), 'e2 should be visible (active category, not hidden, mapeada)');
    assert(!ids.includes('e3'), 'e3 should be hidden (inactive category)');
    assert(!ids.includes('e4'), 'e4 should be hidden (oculta=true)');
    assert(!ids.includes('e5'), 'e5 should be hidden (status=removida)');
    assert(ids.includes('e6'), 'e6 should be visible (mantida_manual is not excluded)');
  });

  it('should return empty array when no categories are active', () => {
    const allInactive = SAMPLE_CATEGORIES.map(c => ({ ...c, ativa: false }));
    const visible = getVisibleEntries(SAMPLE_ENTRIES, allInactive);
    assertEqual(visible.length, 0);
  });

  it('should return empty array when entries is empty', () => {
    const visible = getVisibleEntries([], SAMPLE_CATEGORIES);
    assertEqual(visible.length, 0);
  });

  it('should handle oculta as string "TRUE" from Sheets', () => {
    const entriesWithStringBool = [
      { id: 'x1', titulo: 'Test', instituicao: '', ano: '', carga_horaria: '', categoria: 'cat-1', status: 'pendente', oculta: 'TRUE', arquivo_drive_id: null, arquivo_nome: null, confianca: null, data_mapeamento: null },
      { id: 'x2', titulo: 'Test2', instituicao: '', ano: '', carga_horaria: '', categoria: 'cat-1', status: 'pendente', oculta: 'FALSE', arquivo_drive_id: null, arquivo_nome: null, confianca: null, data_mapeamento: null },
    ];
    const visible = getVisibleEntries(entriesWithStringBool, SAMPLE_CATEGORIES);
    assertEqual(visible.length, 1);
    assertEqual(visible[0].id, 'x2');
  });

  it('should exclude entries with status "removida" but include "mantida_manual"', () => {
    const entries = [
      { id: 'r1', titulo: 'Removida', categoria: 'cat-1', status: 'removida', oculta: false },
      { id: 'r2', titulo: 'Mantida', categoria: 'cat-1', status: 'mantida_manual', oculta: false },
    ];
    const visible = getVisibleEntries(entries, SAMPLE_CATEGORIES);
    assertEqual(visible.length, 1);
    assertEqual(visible[0].id, 'r2');
  });
});

describe('getActiveCategories — Filter active categories (Req 6.1)', () => {
  it('should return only categories with ativa=true', () => {
    const active = getActiveCategories(SAMPLE_CATEGORIES);
    assertEqual(active.length, 2);
    assert(active.every(c => c.ativa === true));
  });

  it('should return empty array when all inactive', () => {
    const allOff = SAMPLE_CATEGORIES.map(c => ({ ...c, ativa: false }));
    const active = getActiveCategories(allOff);
    assertEqual(active.length, 0);
  });

  it('should return all when all active', () => {
    const allOn = SAMPLE_CATEGORIES.map(c => ({ ...c, ativa: true }));
    const active = getActiveCategories(allOn);
    assertEqual(active.length, 3);
  });
});

describe('getHiddenItems — List hidden categories and entries (Req 6.5)', () => {
  it('should return inactive categories as hiddenCategories', () => {
    const { hiddenCategories, hiddenEntries } = getHiddenItems(SAMPLE_ENTRIES, SAMPLE_CATEGORIES);
    assertEqual(hiddenCategories.length, 1);
    assertEqual(hiddenCategories[0].id, 'cat-2');
  });

  it('should return individually hidden entries as hiddenEntries', () => {
    const { hiddenEntries } = getHiddenItems(SAMPLE_ENTRIES, SAMPLE_CATEGORIES);
    assertEqual(hiddenEntries.length, 1);
    assertEqual(hiddenEntries[0].id, 'e4');
  });

  it('should return empty arrays when nothing is hidden', () => {
    const allActive = SAMPLE_CATEGORIES.map(c => ({ ...c, ativa: true }));
    const noHidden = SAMPLE_ENTRIES.map(e => ({ ...e, oculta: false }));
    const { hiddenCategories, hiddenEntries } = getHiddenItems(noHidden, allActive);
    assertEqual(hiddenCategories.length, 0);
    assertEqual(hiddenEntries.length, 0);
  });

  it('should handle oculta as string "TRUE"', () => {
    const entriesStr = [
      { id: 's1', oculta: 'TRUE' },
      { id: 's2', oculta: 'FALSE' },
      { id: 's3', oculta: false },
    ];
    const { hiddenEntries } = getHiddenItems(entriesStr, SAMPLE_CATEGORIES);
    assertEqual(hiddenEntries.length, 1);
    assertEqual(hiddenEntries[0].id, 's1');
  });
});

describe('Visibility round-trip (Property 7 — Req 6.10)', () => {
  it('toggling OFF then ON should restore same visible entries (excluding individually hidden)', () => {
    // Before: cat-1 is active, e1 and e2 and e6 are visible
    const visibleBefore = getVisibleEntries(SAMPLE_ENTRIES, SAMPLE_CATEGORIES);

    // Toggle OFF cat-1
    const catOff = SAMPLE_CATEGORIES.map(c =>
      c.id === 'cat-1' ? { ...c, ativa: false } : c
    );
    const visibleDuring = getVisibleEntries(SAMPLE_ENTRIES, catOff);
    // cat-1 entries should be gone
    assert(!visibleDuring.some(e => e.categoria === 'cat-1'));

    // Toggle ON cat-1
    const catOn = SAMPLE_CATEGORIES.map(c =>
      c.id === 'cat-1' ? { ...c, ativa: true } : c
    );
    const visibleAfter = getVisibleEntries(SAMPLE_ENTRIES, catOn);

    // Should be exactly the same as before
    const beforeIds = visibleBefore.map(e => e.id).sort();
    const afterIds = visibleAfter.map(e => e.id).sort();
    assertEqual(JSON.stringify(beforeIds), JSON.stringify(afterIds));
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
