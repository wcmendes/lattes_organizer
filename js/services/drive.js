/**
 * Drive Service — Google Drive API v3 CRUD Operations
 *
 * Provides file and folder management via Google Drive API v3.
 * Uses fetch() with Bearer token from auth module.
 * Implements exponential backoff retry for 429/5xx errors.
 * On 401: triggers signOut for re-authentication.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
 */

import { getToken, signOut } from '../auth.js';

const BASE_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Busca pasta por nome dentro de um parent.
 * @param {string} name - Nome da pasta
 * @param {string} parentId - ID da pasta pai ('root' para raiz)
 * @returns {Promise<string|null>} folderId ou null se não encontrada
 */
export async function findFolder(name, parentId) {
  const q = `name='${escapeDriveQuery(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)'
  });

  const data = await driveRequest(`/files?${params.toString()}`);
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Cria pasta no Drive.
 * @param {string} name - Nome da pasta
 * @param {string} parentId - ID da pasta pai
 * @returns {Promise<string>} folderId da pasta criada
 */
export async function createFolder(name, parentId) {
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  };

  const data = await driveRequest('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return data.id;
}

/**
 * Faz upload de arquivo para uma pasta (multipart).
 * Processamento sequencial: caller deve aguardar cada upload antes de iniciar o próximo.
 * @param {File} file - File API object
 * @param {string} folderId - ID da pasta destino
 * @param {string} [fileName] - Nome opcional (usa file.name se omitido)
 * @returns {Promise<{id: string, name: string}>}
 */
export async function uploadFile(file, folderId, fileName) {
  const name = fileName || file.name;

  const metadata = {
    name,
    parents: [folderId]
  };

  const boundary = '---comprovaLattesBoundary' + Date.now();
  const delimiter = '\r\n--' + boundary + '\r\n';
  const closeDelimiter = '\r\n--' + boundary + '--';

  const metadataPart =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata);

  const fileContentType = file.type || 'application/octet-stream';

  // Read file as ArrayBuffer for multipart body
  const fileArrayBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileArrayBuffer);

  // Build multipart body
  const filePart = '\r\n' + delimiter + 'Content-Type: ' + fileContentType + '\r\n\r\n';

  const encoder = new TextEncoder();
  const metadataBytes = encoder.encode(metadataPart);
  const filePartBytes = encoder.encode(filePart);
  const closeBytes = encoder.encode(closeDelimiter);

  // Concatenate all parts into a single Uint8Array
  const bodyLength = metadataBytes.length + filePartBytes.length + fileBytes.length + closeBytes.length;
  const bodyArray = new Uint8Array(bodyLength);
  let offset = 0;
  bodyArray.set(metadataBytes, offset); offset += metadataBytes.length;
  bodyArray.set(filePartBytes, offset); offset += filePartBytes.length;
  bodyArray.set(fileBytes, offset); offset += fileBytes.length;
  bodyArray.set(closeBytes, offset);

  const token = getToken();
  if (!token) {
    throw new Error('No auth token available');
  }

  const response = await fetchWithRetry(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: bodyArray.buffer
  });

  const data = await response.json();
  return { id: data.id, name: data.name };
}

/**
 * Move arquivo entre pastas.
 * @param {string} fileId - ID do arquivo
 * @param {string} fromFolderId - ID da pasta de origem
 * @param {string} toFolderId - ID da pasta de destino
 * @returns {Promise<void>}
 */
export async function moveFile(fileId, fromFolderId, toFolderId) {
  const params = new URLSearchParams({
    addParents: toFolderId,
    removeParents: fromFolderId
  });

  await driveRequest(`/files/${fileId}?${params.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
}

/**
 * Renomeia arquivo.
 * @param {string} fileId - ID do arquivo
 * @param {string} newName - Novo nome
 * @returns {Promise<void>}
 */
export async function renameFile(fileId, newName) {
  await driveRequest(`/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  });
}

/**
 * Lista arquivos em uma pasta.
 * @param {string} folderId - ID da pasta
 * @returns {Promise<Array<{id: string, name: string, mimeType: string}>>}
 */
export async function listFiles(folderId) {
  const q = `'${folderId}' in parents and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: '1000'
  });

  const data = await driveRequest(`/files?${params.toString()}`);
  return data.files || [];
}

/**
 * Obtém conteúdo binário de um arquivo (para PDF.js/Tesseract).
 * @param {string} fileId - ID do arquivo
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadFile(fileId) {
  const params = new URLSearchParams({ alt: 'media' });
  const url = `${BASE_URL}/files/${fileId}?${params.toString()}`;

  const token = getToken();
  if (!token) {
    throw new Error('No auth token available');
  }

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.arrayBuffer();
}

/**
 * Exclui um arquivo permanentemente.
 * @param {string} fileId - ID do arquivo
 * @returns {Promise<void>}
 */
export async function deleteFile(fileId) {
  const token = getToken();
  if (!token) {
    throw new Error('No auth token available');
  }

  const response = await fetchWithRetry(`${BASE_URL}/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  // DELETE returns 204 No Content on success
  if (!response.ok && response.status !== 204) {
    throw new Error(`Drive API error: ${response.status}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Makes an authenticated request to Drive API with retry logic.
 * Handles JSON parsing of response.
 * @param {string} path - API path (appended to BASE_URL)
 * @param {Object} [options] - fetch options (method, headers, body)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function driveRequest(path, options = {}) {
  const token = getToken();
  if (!token) {
    throw new Error('No auth token available');
  }

  const url = `${BASE_URL}${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  const response = await fetchWithRetry(url, {
    ...options,
    headers
  });

  // Handle 204 No Content (e.g., DELETE)
  if (response.status === 204) {
    return {};
  }

  return response.json();
}

/**
 * Fetch wrapper with exponential backoff retry for 429 and 5xx errors.
 * On 401: triggers signOut for re-authentication.
 * @param {string} url - Full URL
 * @param {Object} options - fetch options
 * @returns {Promise<Response>} Successful response
 */
async function fetchWithRetry(url, options) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      // 401: Token expired/invalid → sign out for re-auth
      if (response.status === 401) {
        await signOut();
        throw new Error('Authentication expired. Redirecting to login.');
      }

      // Retryable errors: 429 (rate limit) and 5xx (server errors)
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await sleep(getBackoffDelay(attempt));
          continue;
        }
        throw new Error(`Drive API error after ${MAX_RETRIES} retries: ${response.status}`);
      }

      // Non-retryable client errors (4xx except 401, 429)
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Drive API error: ${response.status} ${errorBody}`);
      }

      return response;
    } catch (error) {
      // Network errors are retryable
      if (error.name === 'TypeError' && attempt < MAX_RETRIES) {
        lastError = error;
        await sleep(getBackoffDelay(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Drive request failed after retries');
}

/**
 * Calculates exponential backoff delay with jitter.
 * Delays: ~1s, ~2s, ~4s (base * 2^attempt + random jitter)
 * @param {number} attempt - Zero-based attempt number
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * BASE_DELAY_MS * 0.5;
  return baseDelay + jitter;
}

/**
 * Promise-based sleep utility.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escapes single quotes in Drive API query strings.
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeDriveQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
