/**
 * Serviço Google Sheets API v4 — CRUD de dados na planilha.
 *
 * Fornece operações de leitura, escrita, atualização e criação de planilhas
 * utilizando fetch() com Bearer token. Implementa retry exponencial para
 * erros transientes (429, 5xx) e tratamento adequado de 401/403.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import { getToken } from '../auth.js';
import { signOut } from '../auth.js';

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_JITTER_MS = 500;

/**
 * Calcula o delay para retry exponencial com jitter.
 * Fórmula: attempt^2 * 1000ms + jitter aleatório (0–500ms)
 * @param {number} attempt — número da tentativa (1, 2, 3)
 * @returns {number} delay em milissegundos
 */
function calculateDelay(attempt) {
  const exponential = Math.pow(attempt, 2) * BASE_DELAY_MS;
  const jitter = Math.random() * MAX_JITTER_MS;
  return exponential + jitter;
}

/**
 * Aguarda um tempo determinado.
 * @param {number} ms — milissegundos
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verifica se o status HTTP indica erro transiente passível de retry.
 * @param {number} status — código HTTP
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Executa uma requisição fetch com retry exponencial para erros transientes.
 * Trata 401 (token inválido → signOut) e 403 (acesso negado → erro descritivo).
 *
 * @param {string} url — URL completa da requisição
 * @param {RequestInit} options — opções do fetch (method, headers, body)
 * @returns {Promise<Response>} resposta HTTP bem-sucedida
 * @throws {Error} em caso de erro não-recuperável ou esgotamento de retries
 */
async function fetchWithRetry(url, options) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = calculateDelay(attempt);
      await sleep(delay);
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (networkError) {
      lastError = networkError;
      if (attempt < MAX_RETRIES) {
        continue;
      }
      throw new Error(`[Sheets] Erro de rede após ${MAX_RETRIES + 1} tentativas: ${networkError.message}`);
    }

    // 401 — Token inválido/expirado: aciona signOut para re-autenticação
    if (response.status === 401) {
      await signOut();
      throw new Error('[Sheets] Token inválido ou expirado. Redirecionando para login.');
    }

    // 403 — Acesso negado: erro descritivo sem retry
    if (response.status === 403) {
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody?.error?.message || 'Acesso negado à planilha.';
      throw new Error(`[Sheets] Permissão negada: ${message}. Verifique se a planilha está acessível e se as permissões estão corretas.`);
    }

    // Erros transientes (429, 5xx): retry se ainda houver tentativas
    if (isRetryableStatus(response.status)) {
      lastError = new Error(`[Sheets] HTTP ${response.status}`);
      if (attempt < MAX_RETRIES) {
        continue;
      }
      throw new Error(`[Sheets] Serviço indisponível após ${MAX_RETRIES + 1} tentativas (último status: ${response.status}).`);
    }

    // Outros erros não tratados
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody?.error?.message || `HTTP ${response.status}`;
      throw new Error(`[Sheets] Erro na requisição: ${message}`);
    }

    return response;
  }

  // Fallback (não deve ser alcançado)
  throw lastError || new Error('[Sheets] Falha desconhecida na requisição.');
}

/**
 * Constrói os headers padrão com o token de autorização.
 * @returns {Object} headers para fetch
 * @throws {Error} se não houver token disponível
 */
function buildHeaders() {
  const token = getToken();
  if (!token) {
    throw new Error('[Sheets] Nenhum token de acesso disponível. Faça login novamente.');
  }
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Lê todas as linhas de uma aba e retorna como array de objetos.
 * A primeira linha é tratada como header (nomes das colunas).
 *
 * @param {string} spreadsheetId — ID da planilha
 * @param {string} sheetName — nome da aba
 * @returns {Promise<Array<Object>>} linhas como objetos { coluna: valor }
 */
export async function getRows(spreadsheetId, sheetName) {
  const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}`;
  const headers = buildHeaders();

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers
  });

  const data = await response.json();
  const values = data.values;

  if (!values || values.length === 0) {
    return [];
  }

  const headerRow = values[0];
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const row = {};
    for (let j = 0; j < headerRow.length; j++) {
      row[headerRow[j]] = (values[i] && values[i][j]) || '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Adiciona linhas no final de uma aba.
 *
 * @param {string} spreadsheetId — ID da planilha
 * @param {string} sheetName — nome da aba
 * @param {Array<Array<string>>} rows — linhas a adicionar (cada linha é um array de valores)
 * @returns {Promise<void>}
 */
export async function appendRows(spreadsheetId, sheetName, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`;
  const headers = buildHeaders();

  await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      values: rows
    })
  });
}

/**
 * Atualiza uma linha específica por índice (1-based, onde header = linha 1).
 * Converte o objeto data em array de valores na ordem dos headers.
 *
 * @param {string} spreadsheetId — ID da planilha
 * @param {string} sheetName — nome da aba
 * @param {number} rowIndex — índice da linha (1-based; header = 1, primeira entrada = 2)
 * @param {Object} data — objeto { coluna: valor } com os dados atualizados
 * @returns {Promise<void>}
 */
export async function updateRow(spreadsheetId, sheetName, rowIndex, data) {
  const range = `${sheetName}!A${rowIndex}:Z${rowIndex}`;
  const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const headers = buildHeaders();

  // Converte o objeto em array de valores (preservando a ordem das chaves)
  const values = [Object.values(data)];

  await fetchWithRetry(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      values
    })
  });
}

/**
 * Atualiza múltiplas linhas em batch (até 100 por requisição).
 *
 * @param {string} spreadsheetId — ID da planilha
 * @param {Array<{range: string, values: Array}>} updates — lista de atualizações
 * @returns {Promise<void>}
 */
export async function batchUpdate(spreadsheetId, updates) {
  if (!updates || updates.length === 0) {
    return;
  }

  const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
  const headers = buildHeaders();

  await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates
    })
  });
}

/**
 * Limpa (clear) um range da planilha, removendo todos os valores.
 * Usa o endpoint values:clear do Sheets API.
 *
 * @param {string} spreadsheetId — ID da planilha
 * @param {string} range — range A1 notation (ex: "entradas!A2:Z1000")
 * @returns {Promise<void>}
 */
export async function clearRange(spreadsheetId, range) {
  const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`;
  const headers = buildHeaders();

  await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });
}

/**
 * Deleta uma linha específica de uma aba da planilha.
 * Usa a API de batchUpdate do Sheets para solicitar uma operação deleteDimension.
 *
 * @param {string} spreadsheetId — ID da planilha
 * @param {string} sheetName — nome da aba
 * @param {number} rowIndex — índice da linha (1-based; header = 1, primeira entrada = 2)
 * @returns {Promise<void>}
 */
export async function deleteRow(spreadsheetId, sheetName, rowIndex) {
  // First, get the sheetId (numeric) for the given sheet name
  const metaUrl = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`;
  const headers = buildHeaders();

  const metaResponse = await fetchWithRetry(metaUrl, { method: 'GET', headers });
  const metaData = await metaResponse.json();

  const sheet = metaData.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) {
    throw new Error(`[Sheets] Aba "${sheetName}" não encontrada na planilha.`);
  }

  const sheetId = sheet.properties.sheetId;

  // Delete the row (0-based index for the API)
  const url = `${BASE_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1, // convert 1-based to 0-based
              endIndex: rowIndex         // exclusive end
            }
          }
        }
      ]
    })
  });
}

/**
 * Cria uma planilha nova com abas e headers definidos.
 *
 * @param {string} title — título da planilha
 * @param {Array<{name: string, headers: string[]}>} sheets — definição das abas
 * @returns {Promise<string>} spreadsheetId da planilha criada
 */
export async function createSpreadsheet(title, sheets) {
  const headers = buildHeaders();

  // Monta o corpo da requisição com título e abas
  const body = {
    properties: {
      title
    },
    sheets: sheets.map(sheet => ({
      properties: {
        title: sheet.name
      },
      data: [
        {
          startRow: 0,
          startColumn: 0,
          rowData: [
            {
              values: sheet.headers.map(header => ({
                userEnteredValue: { stringValue: header }
              }))
            }
          ]
        }
      ]
    }))
  };

  const response = await fetchWithRetry(BASE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return data.spreadsheetId;
}
