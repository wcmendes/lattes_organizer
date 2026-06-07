/**
 * Unit tests for js/services/sheets.js
 *
 * Testa operações CRUD do Google Sheets API v4:
 * - getRows: leitura de linhas como objetos
 * - appendRows: adição de linhas
 * - updateRow: atualização por índice
 * - batchUpdate: atualização em lote
 * - createSpreadsheet: criação de planilha
 * - Retry exponencial para 429 e 5xx
 * - Tratamento de 401 (signOut) e 403 (erro descritivo)
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
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
    access_token: 'ya29.test-sheets-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    stored_at: Date.now(),
    user_name: 'Test User'
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
}

function clearStorage() {
  localStorage.removeItem(TOKEN_KEY);
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

// --- Import sheets module ---
const {
  getRows,
  appendRows,
  updateRow,
  batchUpdate,
  createSpreadsheet,
} = await import('../../js/services/sheets.js');

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

function assertThrows(fn, expectedMessage) {
  let threw = false;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { throw new Error(`Expected to throw but resolved`); },
        (e) => {
          if (expectedMessage && !e.message.includes(expectedMessage)) {
            throw new Error(`Expected error containing "${expectedMessage}" but got "${e.message}"`);
          }
        }
      );
    }
  } catch (e) {
    threw = true;
    if (expectedMessage && !e.message.includes(expectedMessage)) {
      throw new Error(`Expected error containing "${expectedMessage}" but got "${e.message}"`);
    }
    return;
  }
  if (!threw) throw new Error('Expected to throw but did not');
}

// --- Tests ---

describe('getRows — Leitura de linhas como objetos', () => {
  it('should return empty array when sheet has no data', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({ values: [] }) });

    const rows = await getRows('spreadsheet123', 'entradas');
    assertDeepEqual(rows, []);
  });

  it('should return empty array when response has no values field', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    const rows = await getRows('spreadsheet123', 'entradas');
    assertDeepEqual(rows, []);
  });

  it('should parse rows using first row as headers', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['id', 'titulo', 'ano'],
          ['1', 'Curso A', '2021'],
          ['2', 'Curso B', '2022']
        ]
      })
    });

    const rows = await getRows('spreadsheet123', 'entradas');
    assertEqual(rows.length, 2);
    assertEqual(rows[0].id, '1');
    assertEqual(rows[0].titulo, 'Curso A');
    assertEqual(rows[0].ano, '2021');
    assertEqual(rows[1].id, '2');
    assertEqual(rows[1].titulo, 'Curso B');
  });

  it('should use empty string for missing values in sparse rows', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        values: [
          ['id', 'titulo', 'ano', 'instituicao'],
          ['1', 'Curso A']  // missing ano and instituicao
        ]
      })
    });

    const rows = await getRows('spreadsheet123', 'entradas');
    assertEqual(rows[0].ano, '');
    assertEqual(rows[0].instituicao, '');
  });

  it('should call correct URL with spreadsheetId and sheetName', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({ values: [] }) });

    await getRows('abc123', 'minha_aba');
    assert(fetchCalls[0].url.includes('abc123'), 'URL should contain spreadsheetId');
    assert(fetchCalls[0].url.includes('minha_aba'), 'URL should contain sheetName');
  });

  it('should include Authorization Bearer header', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({ values: [] }) });

    await getRows('spreadsheet123', 'entradas');
    assertEqual(fetchCalls[0].options.headers['Authorization'], 'Bearer ya29.test-sheets-token');
  });
});

describe('appendRows — Adição de linhas', () => {
  it('should not make a request when rows is empty', async () => {
    clearStorage();
    setValidToken();
    resetFetch();

    await appendRows('spreadsheet123', 'entradas', []);
    assertEqual(fetchCalls.length, 0);
  });

  it('should not make a request when rows is null', async () => {
    clearStorage();
    setValidToken();
    resetFetch();

    await appendRows('spreadsheet123', 'entradas', null);
    assertEqual(fetchCalls.length, 0);
  });

  it('should POST rows to :append endpoint with USER_ENTERED', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    const rows = [['1', 'Curso A', '2021'], ['2', 'Curso B', '2022']];
    await appendRows('spreadsheet123', 'entradas', rows);

    assertEqual(fetchCalls[0].options.method, 'POST');
    assert(fetchCalls[0].url.includes(':append'), 'URL should contain :append');
    assert(fetchCalls[0].url.includes('valueInputOption=USER_ENTERED'), 'URL should have valueInputOption');
    const body = JSON.parse(fetchCalls[0].options.body);
    assertDeepEqual(body.values, rows);
  });
});

describe('updateRow — Atualização de linha por índice', () => {
  it('should PUT data to the correct range', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    await updateRow('spreadsheet123', 'entradas', 5, { id: '1', titulo: 'Updated' });

    assertEqual(fetchCalls[0].options.method, 'PUT');
    assert(fetchCalls[0].url.includes('A5'), 'URL should contain row index A5');
    assert(fetchCalls[0].url.includes('Z5'), 'URL should contain row index Z5');
    assert(fetchCalls[0].url.includes('valueInputOption=USER_ENTERED'), 'URL should have valueInputOption');
  });

  it('should convert object values to array', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    await updateRow('spreadsheet123', 'entradas', 2, { id: 'x', titulo: 'Test', ano: '2023' });

    const body = JSON.parse(fetchCalls[0].options.body);
    assertDeepEqual(body.values, [['x', 'Test', '2023']]);
  });
});

describe('batchUpdate — Atualização em lote', () => {
  it('should not make a request when updates is empty', async () => {
    clearStorage();
    setValidToken();
    resetFetch();

    await batchUpdate('spreadsheet123', []);
    assertEqual(fetchCalls.length, 0);
  });

  it('should POST batch updates with correct body structure', async () => {
    clearStorage();
    setValidToken();
    mockFetch({ ok: true, status: 200, json: async () => ({}) });

    const updates = [
      { range: 'entradas!A2:Z2', values: [['1', 'Title A']] },
      { range: 'entradas!A3:Z3', values: [['2', 'Title B']] }
    ];
    await batchUpdate('spreadsheet123', updates);

    assertEqual(fetchCalls[0].options.method, 'POST');
    assert(fetchCalls[0].url.includes(':batchUpdate'), 'URL should contain :batchUpdate');
    const body = JSON.parse(fetchCalls[0].options.body);
    assertEqual(body.valueInputOption, 'USER_ENTERED');
    assertDeepEqual(body.data, updates);
  });
});

describe('createSpreadsheet — Criação de planilha', () => {
  it('should POST to base URL and return spreadsheetId', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({ spreadsheetId: 'new-spreadsheet-id-123' })
    });

    const id = await createSpreadsheet('Minha Planilha', [
      { name: 'entradas', headers: ['id', 'titulo', 'ano'] },
      { name: 'categorias', headers: ['id', 'nome_xml', 'ativa'] }
    ]);

    assertEqual(id, 'new-spreadsheet-id-123');
    assertEqual(fetchCalls[0].options.method, 'POST');

    const body = JSON.parse(fetchCalls[0].options.body);
    assertEqual(body.properties.title, 'Minha Planilha');
    assertEqual(body.sheets.length, 2);
    assertEqual(body.sheets[0].properties.title, 'entradas');
    assertEqual(body.sheets[1].properties.title, 'categorias');
  });

  it('should include headers as first row data', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: true, status: 200,
      json: async () => ({ spreadsheetId: 'abc' })
    });

    await createSpreadsheet('Test', [
      { name: 'config', headers: ['chave', 'valor'] }
    ]);

    const body = JSON.parse(fetchCalls[0].options.body);
    const rowData = body.sheets[0].data[0].rowData[0].values;
    assertEqual(rowData[0].userEnteredValue.stringValue, 'chave');
    assertEqual(rowData[1].userEnteredValue.stringValue, 'valor');
  });
});

describe('Error Handling — 401 triggers signOut', () => {
  it('should call signOut on 401 response', async () => {
    clearStorage();
    setValidToken();
    // 401 response from API + the revoke call during signOut
    mockFetch([
      { ok: false, status: 401, json: async () => ({ error: { message: 'Invalid token' } }) },
      { ok: false, status: 500, json: async () => ({}) } // revoke fails
    ]);

    try {
      await getRows('spreadsheet123', 'entradas');
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('Token inválido') || e.message.includes('expirado'),
        `Expected token error message, got: ${e.message}`);
    }

    // signOut should have cleared localStorage and redirected
    assertEqual(localStorage.getItem(TOKEN_KEY), null);
    assertEqual(_hash, '#login');
  });
});

describe('Error Handling — 403 throws descriptive error', () => {
  it('should throw with permission error message on 403', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: false, status: 403,
      json: async () => ({ error: { message: 'The caller does not have permission' } })
    });

    try {
      await getRows('spreadsheet123', 'entradas');
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('Permissão negada'), `Expected permission error, got: ${e.message}`);
      assert(e.message.includes('does not have permission'), `Should include API message, got: ${e.message}`);
    }
  });

  it('should throw generic permission error when 403 body is empty', async () => {
    clearStorage();
    setValidToken();
    mockFetch({
      ok: false, status: 403,
      json: async () => { throw new Error('no JSON'); }
    });

    try {
      await getRows('spreadsheet123', 'entradas');
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('Permissão negada'), `Expected permission error, got: ${e.message}`);
    }
  });
});

describe('Retry — exponential backoff for 429 and 5xx', () => {
  it('should retry on 429 and succeed on second attempt', async () => {
    clearStorage();
    setValidToken();
    mockFetch([
      { ok: false, status: 429, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ values: [['id'], ['1']] }) }
    ]);

    const rows = await getRows('spreadsheet123', 'entradas');
    assertEqual(fetchCalls.length, 2);
    assertEqual(rows.length, 1);
  });

  it('should retry on 500 and succeed on third attempt', async () => {
    clearStorage();
    setValidToken();
    mockFetch([
      { ok: false, status: 500, json: async () => ({}) },
      { ok: false, status: 502, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ values: [['id'], ['1']] }) }
    ]);

    const rows = await getRows('spreadsheet123', 'entradas');
    assertEqual(fetchCalls.length, 3);
    assertEqual(rows.length, 1);
  });

  it('should throw after exhausting all retries on 5xx', async () => {
    clearStorage();
    setValidToken();
    mockFetch([
      { ok: false, status: 503, json: async () => ({}) },
      { ok: false, status: 503, json: async () => ({}) },
      { ok: false, status: 503, json: async () => ({}) },
      { ok: false, status: 503, json: async () => ({}) }
    ]);

    try {
      await getRows('spreadsheet123', 'entradas');
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('indisponível') || e.message.includes('503'),
        `Expected retry exhaustion error, got: ${e.message}`);
    }
    assertEqual(fetchCalls.length, 4); // initial + 3 retries
  });

  it('should retry on network errors', async () => {
    clearStorage();
    setValidToken();
    let callCount = 0;
    fetchResponses = [];
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      callCount++;
      if (callCount <= 2) {
        throw new Error('Network error');
      }
      return { ok: true, status: 200, json: async () => ({ values: [['id'], ['x']] }) };
    };

    const rows = await getRows('spreadsheet123', 'entradas');
    assertEqual(callCount, 3);
    assertEqual(rows.length, 1);

    // Restore standard fetch mock
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (fetchResponses.length > 0) {
        const resp = fetchResponses.shift();
        if (typeof resp === 'function') return resp(url, options);
        return resp;
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
  });
});

describe('Auth Guard — no token available', () => {
  it('should throw when no token is stored', async () => {
    clearStorage();
    resetFetch();

    try {
      await getRows('spreadsheet123', 'entradas');
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('token') || e.message.includes('login'),
        `Expected no-token error, got: ${e.message}`);
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
