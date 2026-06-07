/**
 * review-queue.js — Fila de Revisão de Sugestões
 *
 * Armazena itens para revisão manual (matches com score ≥ threshold mas < 99%,
 * ou ≥ 99% com empate). Persistido em localStorage para sobreviver a navegação
 * entre views. Exporta API para adicionar, consumir e limpar a fila.
 *
 * Requirements: 4.5, 4.6, 5.1
 */

const STORAGE_KEY = 'comprova_review_queue';

/**
 * @typedef {Object} ReviewItem
 * @property {string} fileId — Google Drive file ID
 * @property {string} fileName — nome original do arquivo
 * @property {Object} suggestedEntry — LattesEntry sugerida como match
 * @property {number} score — score de confiança (0–100)
 * @property {string} extractedText — texto extraído do comprovante
 * @property {string} snippet — trecho de maior similaridade
 * @property {string[]} highlightWords — palavras em destaque
 */

/**
 * Retorna a fila de revisão atual.
 * @returns {ReviewItem[]}
 */
export function getReviewQueue() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[ReviewQueue] Falha ao ler fila de revisão:', e);
  }
  return [];
}

/**
 * Adiciona um item à fila de revisão.
 * @param {ReviewItem} item
 */
export function addToReviewQueue(item) {
  const queue = getReviewQueue();
  queue.push(item);
  _persist(queue);
}

/**
 * Remove um item da fila por fileId.
 * @param {string} fileId
 */
export function removeFromReviewQueue(fileId) {
  const queue = getReviewQueue().filter(item => item.fileId !== fileId);
  _persist(queue);
}

/**
 * Limpa toda a fila de revisão.
 */
export function clearReviewQueue() {
  _persist([]);
}

/**
 * Retorna o número de itens na fila.
 * @returns {number}
 */
export function getReviewQueueSize() {
  return getReviewQueue().length;
}

/**
 * Persiste a fila no localStorage.
 * @param {ReviewItem[]} queue
 * @private
 */
function _persist(queue) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[ReviewQueue] Falha ao persistir fila de revisão:', e);
  }
}
