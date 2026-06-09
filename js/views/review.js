/**
 * Review View — ComprovaLattes
 *
 * Two-section page:
 * 1. Auto-match suggestions summary + overlay trigger
 * 2. Unmatched files from "files/novos/" with preview and manual association
 *
 * The fullscreen overlay for reviewing file-to-entry match suggestions is kept intact.
 * Presents one suggestion at a time with side-by-side layout:
 * - Left: entry data + confidence score
 * - Right: file preview + extracted snippet with highlights
 *
 * Navigation: Previous / Skip, Accept / Reject actions.
 * Accept: saves mapping to Sheets, moves file to category folder, renames.
 * Reject: permanently removes from queue.
 * Skip: advances without removing.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11
 * @module views/review
 */

import { getReviewQueue, removeFromReviewQueue } from '../core/review-queue.js';
import { listFiles, moveFile, renameFile, findFolder, createFolder } from '../services/drive.js';
import { updateRow } from '../services/sheets.js';
import { loadEntries } from '../core/entry-manager.js';
import { loadConfig } from '../config.js';
import { showSuccess, showError } from '../ui/toast.js';
import { categorySlug } from '../core/xml-parser.js';

/** @type {HTMLElement|null} overlay container */
let overlayEl = null;

/** @type {ReviewItem[]} current working copy of the queue */
let queue = [];

/** @type {number} current index in the queue */
let currentIndex = 0;

/** @type {boolean} indicates if an async operation is in progress */
let processing = false;

/** @type {Array<Object>} files loaded from "files/novos/" */
let unmatchedFiles = [];

/** @type {Array<Object>} entries without mapping (status pendente) */
let unmappedEntries = [];

/** @type {string|null} currently selected file ID for preview */
let selectedFileId = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders the review page with both sections.
 * @returns {string}
 */
export function render() {
  return `
    <div class="container">
      <div class="review-page">
        <h1 class="review-page__title">Revisão</h1>

        <!-- Auto-match section -->
        <div class="card mb-lg" id="review-automatch-section">
          <div class="card__header">
            <h2 class="card__title">Sugestões de Auto-Match</h2>
          </div>
          <div class="card__body" id="review-automatch-content">Carregando...</div>
        </div>

        <!-- Unmatched files section -->
        <div class="card" id="review-files-section">
          <div class="card__header">
            <h2 class="card__title">Arquivos sem Match</h2>
          </div>
          <div class="card__body" id="review-files-content">Carregando...</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mounts the review view: populates both sections.
 */
export function mount() {
  renderAutomatchSection();
  loadUnmatchedFiles();
}

/**
 * Opens the review overlay. Reads the current queue from localStorage.
 * If queue is empty, shows informational toast and does nothing.
 */
export function show() {
  queue = getReviewQueue();
  currentIndex = 0;

  if (queue.length === 0) {
    showError('Nenhuma sugestão na fila de revisão.');
    return;
  }

  createOverlay();
  renderCurrentItem();
}

// ---------------------------------------------------------------------------
// Section 1: Auto-match suggestions
// ---------------------------------------------------------------------------

/**
 * Renders the auto-match section content based on the review queue size.
 */
function renderAutomatchSection() {
  const container = document.getElementById('review-automatch-content');
  if (!container) return;

  const reviewQueue = getReviewQueue();
  const count = reviewQueue.length;

  if (count === 0) {
    container.innerHTML = `<p class="text-muted">Nenhuma sugestão pendente.</p>`;
  } else {
    container.innerHTML = `
      <p>Há <strong>${count}</strong> sugestão(ões) pendente(s) de revisão do auto-match.</p>
      <button class="btn btn--primary" id="btn-open-review-overlay" type="button">
        Revisar sugestões (${count})
      </button>
    `;
    const btn = document.getElementById('btn-open-review-overlay');
    if (btn) {
      btn.addEventListener('click', () => show());
    }
  }
}

// ---------------------------------------------------------------------------
// Section 2: Unmatched files from "files/novos/"
// ---------------------------------------------------------------------------

/**
 * Loads files from "files/novos/" and unmatched entries, then renders the section.
 */
async function loadUnmatchedFiles() {
  const container = document.getElementById('review-files-content');
  if (!container) return;

  try {
    const config = loadConfig();
    if (!config.root_folder_id || !config.spreadsheet_id) {
      container.innerHTML = '<p class="text-muted">Configure a pasta raiz e planilha nas Configurações.</p>';
      return;
    }

    // Load entries and find unmapped ones
    const allEntries = await loadEntries(config.spreadsheet_id);
    unmappedEntries = allEntries.filter(e => !e.arquivo_drive_id && e.status !== 'removida');

    // Find "files/novos/" folder
    const filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      container.innerHTML = '<p class="text-muted">Pasta "files/" não encontrada no Drive.</p>';
      return;
    }

    const novosFolderId = await findFolder('novos', filesFolderId);
    if (!novosFolderId) {
      container.innerHTML = '<p class="text-muted">Pasta "files/novos/" não encontrada no Drive.</p>';
      return;
    }

    unmatchedFiles = await listFiles(novosFolderId);
    unmatchedFiles.sort((a, b) => a.name.localeCompare(b.name));

    if (unmatchedFiles.length === 0) {
      container.innerHTML = '<p class="text-muted">Nenhum arquivo sem match em "files/novos/".</p>';
      return;
    }

    renderFilesSection(container);
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Erro ao carregar arquivos: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Renders the files list + detail panel layout.
 * @param {HTMLElement} container
 */
function renderFilesSection(container) {
  container.innerHTML = `
    <div class="review-files-layout">
      <div class="review-files-layout__list">
        <p class="text-muted mb-sm">${unmatchedFiles.length} arquivo(s) disponível(is)</p>
        <ul class="review-files__list" id="review-files-list">
          ${unmatchedFiles.map(file => `
            <li class="review-files__item" data-file-id="${file.id}">
              <span class="review-files__name">${escapeHtml(file.name)}</span>
              <button class="btn btn--outline btn--sm review-files__btn-preview" data-file-id="${file.id}" data-file-name="${escapeHtml(file.name)}" type="button" title="Visualizar">
                👁
              </button>
            </li>
          `).join('')}
        </ul>
      </div>
      <div class="review-files-layout__detail" id="review-files-detail">
        <p class="text-muted">Selecione um arquivo para visualizar e vincular.</p>
      </div>
    </div>
  `;

  attachFilesListeners();
}

/**
 * Attaches click listeners to file items and preview buttons.
 */
function attachFilesListeners() {
  const list = document.getElementById('review-files-list');
  if (!list) return;

  list.addEventListener('click', (e) => {
    const previewBtn = e.target.closest('.review-files__btn-preview');
    if (previewBtn) {
      const fileId = previewBtn.dataset.fileId;
      const fileName = previewBtn.dataset.fileName;
      selectFile(fileId, fileName);
      return;
    }

    const item = e.target.closest('.review-files__item');
    if (item) {
      const fileId = item.dataset.fileId;
      const file = unmatchedFiles.find(f => f.id === fileId);
      if (file) {
        selectFile(file.id, file.name);
      }
    }
  });
}

/**
 * Selects a file and shows its preview + entry selector in the detail panel.
 * @param {string} fileId
 * @param {string} fileName
 */
function selectFile(fileId, fileName) {
  selectedFileId = fileId;

  // Highlight selected item in the list
  const items = document.querySelectorAll('.review-files__item');
  items.forEach(item => {
    item.classList.toggle('review-files__item--active', item.dataset.fileId === fileId);
  });

  const detail = document.getElementById('review-files-detail');
  if (!detail) return;

  const previewHtml = buildFilePreview(fileId, fileName);
  const entriesOptions = unmappedEntries.map(entry =>
    `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.titulo || 'Sem título')} (${escapeHtml(entry.ano || '—')})</option>`
  ).join('');

  detail.innerHTML = `
    <div class="review-files-detail__preview">
      <h3 class="review-files-detail__filename">${escapeHtml(fileName)}</h3>
      ${previewHtml}
    </div>
    <div class="review-files-detail__bind">
      <label for="review-entry-select" class="review-files-detail__label">Vincular a entrada:</label>
      ${unmappedEntries.length > 0
        ? `<select id="review-entry-select" class="input review-files-detail__select">
            <option value="">— Selecione uma entrada —</option>
            ${entriesOptions}
          </select>
          <button class="btn btn--primary btn--sm" id="btn-vincular-file" type="button">🔗 Vincular</button>`
        : `<p class="text-muted">Nenhuma entrada sem comprovante disponível.</p>`
      }
    </div>
  `;

  // Attach vincular button listener
  const btnVincular = document.getElementById('btn-vincular-file');
  if (btnVincular) {
    btnVincular.addEventListener('click', () => handleVincularFile(fileId, fileName));
  }
}

/**
 * Builds preview HTML for a file (iframe or img).
 * @param {string} fileId
 * @param {string} fileName
 * @returns {string}
 */
function buildFilePreview(fileId, fileName) {
  const ext = getFileExtension(fileName).replace('.', '');
  const drivePreviewUrl = `https://drive.google.com/file/d/${fileId}/preview`;

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
    const imgUrl = `https://drive.google.com/uc?id=${fileId}`;
    return `<img class="review-files-detail__img" src="${imgUrl}" alt="Preview de ${escapeHtml(fileName)}" />`;
  }

  return `<iframe class="review-files-detail__iframe" src="${drivePreviewUrl}" title="Preview do arquivo ${escapeHtml(fileName)}" allowfullscreen></iframe>`;
}

/**
 * Handles binding the selected file to the chosen entry.
 * @param {string} fileId
 * @param {string} fileName
 */
async function handleVincularFile(fileId, fileName) {
  const select = document.getElementById('review-entry-select');
  if (!select || !select.value) {
    showError('Selecione uma entrada para vincular.');
    return;
  }

  const entryId = select.value;
  const entry = unmappedEntries.find(e => e.id === entryId);
  if (!entry) {
    showError('Entrada não encontrada.');
    return;
  }

  const btnVincular = document.getElementById('btn-vincular-file');
  if (btnVincular) btnVincular.disabled = true;

  try {
    const config = loadConfig();
    const rootFolderId = config.root_folder_id;

    // Determine target folder for the category
    const slug = categorySlug(entry.categoria || '');
    let targetFolderId = await findFolder(slug, rootFolderId);
    if (!targetFolderId) {
      targetFolderId = await createFolder(slug, rootFolderId);
    }

    // Find the source folder (novos)
    const filesFolderId = await findFolder('files', rootFolderId);
    const novosFolderId = await findFolder('novos', filesFolderId);

    // Build the new file name
    const ext = getFileExtension(fileName);
    const newName = buildFileName(entry.ano, slug, entry.instituicao, entry.titulo, ext);

    // Move file to category folder
    await moveFile(fileId, novosFolderId, targetFolderId);

    // Rename file
    await renameFile(fileId, newName);

    // Update entry in spreadsheet
    if (config.spreadsheet_id && entry.id) {
      const now = new Date().toISOString().split('T')[0];
      await updateRow(config.spreadsheet_id, 'entradas', findEntryRow(entry), {
        id: entry.id,
        titulo: entry.titulo || '',
        instituicao: entry.instituicao || '',
        ano: entry.ano || '',
        carga_horaria: entry.carga_horaria || '',
        categoria: entry.categoria || '',
        status: 'mapeada',
        oculta: entry.oculta ? 'TRUE' : 'FALSE',
        arquivo_drive_id: fileId,
        arquivo_nome: newName,
        confianca: '',
        data_mapeamento: now,
        arquivo_hash: entry.arquivo_hash || '',
      });
    }

    // Remove from local lists
    unmatchedFiles = unmatchedFiles.filter(f => f.id !== fileId);
    unmappedEntries = unmappedEntries.filter(e => e.id !== entryId);

    showSuccess(`Arquivo vinculado a "${escapeHtml(entry.titulo || 'entrada')}".`);

    // Re-render the files section
    const container = document.getElementById('review-files-content');
    if (container) {
      if (unmatchedFiles.length === 0) {
        container.innerHTML = '<p class="text-muted">Nenhum arquivo sem match em "files/novos/".</p>';
      } else {
        renderFilesSection(container);
      }
    }
  } catch (err) {
    showError(`Falha ao vincular: ${err.message}`);
    if (btnVincular) btnVincular.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Overlay lifecycle
// ---------------------------------------------------------------------------

/**
 * Creates the fullscreen overlay element and appends to body.
 */
function createOverlay() {
  if (overlayEl && document.body.contains(overlayEl)) {
    overlayEl.remove();
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'review-overlay';
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-modal', 'true');
  overlayEl.setAttribute('aria-label', 'Revisão de sugestões');
  document.body.appendChild(overlayEl);

  // Trap focus inside overlay
  overlayEl.addEventListener('keydown', handleKeydown);
}

/**
 * Closes the overlay and cleans up.
 */
function closeOverlay() {
  if (overlayEl) {
    overlayEl.removeEventListener('keydown', handleKeydown);
    overlayEl.remove();
    overlayEl = null;
  }
  // Refresh the auto-match section count after overlay closes
  renderAutomatchSection();
}

/**
 * Handles keyboard navigation inside the overlay.
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  if (e.key === 'Escape') {
    closeOverlay();
  }
}

// ---------------------------------------------------------------------------
// Rendering (Overlay)
// ---------------------------------------------------------------------------

/**
 * Renders the current review item into the overlay.
 */
function renderCurrentItem() {
  if (!overlayEl) return;
  if (queue.length === 0) {
    closeOverlay();
    showSuccess('Todas as sugestões foram processadas.');
    return;
  }

  const item = queue[currentIndex];
  const total = queue.length;
  const position = currentIndex + 1;

  overlayEl.innerHTML = buildOverlayHTML(item, position, total);
  attachOverlayListeners();
}

/**
 * Builds the full overlay HTML for a given review item.
 * @param {Object} item - ReviewItem
 * @param {number} position - 1-based current position
 * @param {number} total - total items in queue
 * @returns {string}
 */
function buildOverlayHTML(item, position, total) {
  const entry = item.suggestedEntry || {};
  const scoreColor = getScoreColor(item.score);
  const snippetHtml = highlightSnippet(item.snippet || '', item.highlightWords || []);
  const previewHtml = buildPreviewHtml(item.fileId, item.fileName);

  return `
    <div class="review-overlay__header">
      <span class="review-overlay__counter">Sugestão ${position} de ${total}</span>
      <button class="btn btn--outline review-overlay__close" type="button" aria-label="Desistir e voltar">
        Desistir e voltar
      </button>
    </div>

    <div class="review-overlay__body">
      <!-- Left panel: entry data -->
      <div class="review-overlay__left">
        <h2 class="review-overlay__entry-title">${escapeHtml(entry.titulo || 'Sem título')}</h2>
        <dl class="review-overlay__details">
          <div class="review-overlay__detail-row">
            <dt>Instituição</dt>
            <dd>${escapeHtml(entry.instituicao || '—')}</dd>
          </div>
          <div class="review-overlay__detail-row">
            <dt>Ano</dt>
            <dd>${escapeHtml(entry.ano || '—')}</dd>
          </div>
          <div class="review-overlay__detail-row">
            <dt>Categoria</dt>
            <dd>${escapeHtml(entry.categoria || '—')}</dd>
          </div>
          <div class="review-overlay__detail-row">
            <dt>Carga horária</dt>
            <dd>${escapeHtml(entry.carga_horaria || '—')}</dd>
          </div>
        </dl>
        <div class="review-overlay__score">
          <span class="review-overlay__score-badge" style="background-color: ${scoreColor}">
            ${item.score}%
          </span>
          <span class="review-overlay__score-label">Confiança</span>
        </div>
      </div>

      <!-- Right panel: file preview + snippet -->
      <div class="review-overlay__right">
        <div class="review-overlay__preview">
          ${previewHtml}
        </div>
        <div class="review-overlay__snippet">
          <h3 class="review-overlay__snippet-title">Trecho extraído</h3>
          <p class="review-overlay__snippet-text">${snippetHtml}</p>
        </div>
      </div>
    </div>

    <div class="review-overlay__actions">
      <div class="review-overlay__nav">
        <button class="btn btn--outline review-overlay__btn-prev" type="button" ${currentIndex === 0 ? 'disabled' : ''}>
          ← Anterior
        </button>
        <button class="btn btn--outline review-overlay__btn-skip" type="button">
          Pular →
        </button>
      </div>
      <div class="review-overlay__decisions">
        <button class="btn btn--success btn--lg review-overlay__btn-accept" type="button">
          ✓ Aceitar
        </button>
        <button class="btn btn--danger btn--lg review-overlay__btn-reject" type="button">
          ✗ Rejeitar
        </button>
      </div>
    </div>
  `;
}

/**
 * Attaches event listeners to the current overlay buttons.
 */
function attachOverlayListeners() {
  if (!overlayEl) return;

  const btnClose = overlayEl.querySelector('.review-overlay__close');
  const btnPrev = overlayEl.querySelector('.review-overlay__btn-prev');
  const btnSkip = overlayEl.querySelector('.review-overlay__btn-skip');
  const btnAccept = overlayEl.querySelector('.review-overlay__btn-accept');
  const btnReject = overlayEl.querySelector('.review-overlay__btn-reject');

  if (btnClose) btnClose.addEventListener('click', closeOverlay);
  if (btnPrev) btnPrev.addEventListener('click', handlePrevious);
  if (btnSkip) btnSkip.addEventListener('click', handleSkip);
  if (btnAccept) btnAccept.addEventListener('click', handleAccept);
  if (btnReject) btnReject.addEventListener('click', handleReject);
}

// ---------------------------------------------------------------------------
// Navigation handlers
// ---------------------------------------------------------------------------

/**
 * Navigates to the previous item.
 */
function handlePrevious() {
  if (currentIndex > 0) {
    currentIndex--;
    renderCurrentItem();
  }
}

/**
 * Skips to the next item without removing from queue.
 */
function handleSkip() {
  if (currentIndex < queue.length - 1) {
    currentIndex++;
  } else {
    // Wrap around to first
    currentIndex = 0;
  }
  renderCurrentItem();
}

// ---------------------------------------------------------------------------
// Accept / Reject handlers
// ---------------------------------------------------------------------------

/**
 * Accepts the current suggestion:
 * 1. Saves mapping to the spreadsheet
 * 2. Moves file to category folder
 * 3. Renames file to standard format
 * 4. Removes from review queue
 */
async function handleAccept() {
  if (processing) return;
  processing = true;
  setButtonsDisabled(true);

  const item = queue[currentIndex];

  try {
    const config = loadConfig();
    const entry = item.suggestedEntry;

    // Determine target folder for the category
    const slug = categorySlug(entry.categoria || '');
    const rootFolderId = config.root_folder_id;

    let targetFolderId = await findFolder(slug, rootFolderId);
    if (!targetFolderId) {
      targetFolderId = await createFolder(slug, rootFolderId);
    }

    // Build the new file name: ANO_tipo_INSTITUICAO_Titulo.ext (max 200 chars, ASCII-safe)
    const ext = getFileExtension(item.fileName);
    const newName = buildFileName(entry.ano, slug, entry.instituicao, entry.titulo, ext);

    // Move file to category folder
    await moveFile(item.fileId, rootFolderId, targetFolderId);

    // Rename file
    await renameFile(item.fileId, newName);

    // Update entry in spreadsheet: set status=mapeada, arquivo_drive_id, arquivo_nome, confianca, data_mapeamento
    if (config.spreadsheet_id && entry.id) {
      const now = new Date().toISOString().split('T')[0];
      await updateRow(config.spreadsheet_id, 'entradas', findEntryRow(entry), {
        id: entry.id,
        titulo: entry.titulo || '',
        instituicao: entry.instituicao || '',
        ano: entry.ano || '',
        carga_horaria: entry.carga_horaria || '',
        categoria: entry.categoria || '',
        status: 'mapeada',
        oculta: entry.oculta ? 'TRUE' : 'FALSE',
        arquivo_drive_id: item.fileId,
        arquivo_nome: newName,
        confianca: String(item.score),
        data_mapeamento: now,
        arquivo_hash: entry.arquivo_hash || '',
      });
    }

    // Remove from queue (localStorage)
    removeFromReviewQueue(item.fileId);

    // Remove from local working copy
    queue.splice(currentIndex, 1);

    // Adjust index
    if (currentIndex >= queue.length) {
      currentIndex = Math.max(0, queue.length - 1);
    }

    showSuccess(`Comprovante aceito: ${escapeHtml(entry.titulo || item.fileName)}`);

    // Check if all processed
    if (queue.length === 0) {
      closeOverlay();
      showSuccess('Todas as sugestões foram processadas.');
    } else {
      renderCurrentItem();
    }
  } catch (err) {
    showError(`Falha ao aceitar: ${err.message}`);
    // Keep suggestion in position
  } finally {
    processing = false;
    setButtonsDisabled(false);
  }
}

/**
 * Rejects the current suggestion: permanently removes from queue.
 */
async function handleReject() {
  if (processing) return;
  processing = true;
  setButtonsDisabled(true);

  const item = queue[currentIndex];

  try {
    // Remove from persistent queue
    removeFromReviewQueue(item.fileId);

    // Remove from local working copy
    queue.splice(currentIndex, 1);

    // Adjust index
    if (currentIndex >= queue.length) {
      currentIndex = Math.max(0, queue.length - 1);
    }

    // Check if all processed
    if (queue.length === 0) {
      closeOverlay();
      showSuccess('Todas as sugestões foram processadas.');
    } else {
      renderCurrentItem();
    }
  } catch (err) {
    showError(`Falha ao rejeitar: ${err.message}`);
  } finally {
    processing = false;
    setButtonsDisabled(false);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Disables or enables action buttons during processing.
 * @param {boolean} disabled
 */
function setButtonsDisabled(disabled) {
  if (!overlayEl) return;
  const buttons = overlayEl.querySelectorAll('button');
  buttons.forEach(btn => {
    // Don't re-enable prev if at first item
    if (!disabled && btn.classList.contains('review-overlay__btn-prev') && currentIndex === 0) {
      btn.disabled = true;
      return;
    }
    btn.disabled = disabled;
  });
}

/**
 * Builds the standardized file name.
 * Format: ANO_tipo_INSTITUICAO_Titulo.ext (max 200 chars, ASCII-safe)
 * @param {string} ano
 * @param {string} tipo - category slug
 * @param {string} instituicao
 * @param {string} titulo
 * @param {string} ext - file extension with dot
 * @returns {string}
 */
function buildFileName(ano, tipo, instituicao, titulo, ext) {
  const parts = [
    sanitizeForFilename(ano || 'XXXX'),
    sanitizeForFilename(tipo || 'geral'),
    sanitizeForFilename(instituicao || 'inst'),
    sanitizeForFilename(titulo || 'documento'),
  ];

  let name = parts.join('_');
  const maxLen = 200 - ext.length;
  if (name.length > maxLen) {
    name = name.substring(0, maxLen);
  }

  return name + ext;
}

/**
 * Sanitizes a string for use in filenames (ASCII-safe, no special chars).
 * @param {string} str
 * @returns {string}
 */
function sanitizeForFilename(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-zA-Z0-9_\-]/g, '_') // replace special chars with _
    .replace(/_+/g, '_') // collapse multiple underscores
    .replace(/^_|_$/g, '') // trim leading/trailing _
    .substring(0, 50); // limit individual parts
}

/**
 * Returns the file extension (with dot) from a filename.
 * @param {string} fileName
 * @returns {string}
 */
function getFileExtension(fileName) {
  if (!fileName) return '';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.substring(lastDot).toLowerCase();
}

/**
 * Determines the row index for an entry in the spreadsheet.
 * For simplicity, uses the entry's internal row tracking if available,
 * otherwise returns a placeholder (caller should handle).
 * @param {Object} entry
 * @returns {number}
 */
function findEntryRow(entry) {
  // The entry object should carry rowIndex from the entry-manager load
  // If not available, we'll need a lookup. For now, use a default.
  return entry._rowIndex || 2;
}

/**
 * Returns a color for the score badge.
 * @param {number} score - 0–100
 * @returns {string} CSS color
 */
function getScoreColor(score) {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 50) return '#d97706'; // amber
  return 'var(--color-error)';
}

/**
 * Builds the preview HTML for a file (overlay version).
 * PDF → embedded iframe, images → img tag, others → filename display.
 * @param {string} fileId
 * @param {string} fileName
 * @returns {string}
 */
function buildPreviewHtml(fileId, fileName) {
  const ext = getFileExtension(fileName).replace('.', '');
  const drivePreviewUrl = `https://drive.google.com/file/d/${fileId}/preview`;

  if (ext === 'pdf') {
    return `<iframe class="review-overlay__iframe" src="${drivePreviewUrl}" title="Preview do arquivo ${escapeHtml(fileName)}" allowfullscreen></iframe>`;
  }

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
    const imgUrl = `https://drive.google.com/uc?id=${fileId}`;
    return `<img class="review-overlay__img" src="${imgUrl}" alt="Preview de ${escapeHtml(fileName)}" />`;
  }

  // For other types, use Drive's generic preview
  return `<iframe class="review-overlay__iframe" src="${drivePreviewUrl}" title="Preview do arquivo ${escapeHtml(fileName)}" allowfullscreen></iframe>`;
}

/**
 * Highlights words in a snippet using <mark> tags.
 * @param {string} snippet
 * @param {string[]} words
 * @returns {string} HTML string with highlights
 */
function highlightSnippet(snippet, words) {
  if (!snippet) return '<em>Nenhum trecho extraído.</em>';
  if (!words || words.length === 0) return escapeHtml(snippet);

  let html = escapeHtml(snippet);

  for (const word of words) {
    if (!word) continue;
    const escaped = escapeRegex(word);
    const regex = new RegExp(`(${escaped})`, 'gi');
    html = html.replace(regex, '<mark class="review-overlay__highlight">$1</mark>');
  }

  return html;
}

/**
 * Escapes special regex characters.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapes HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
