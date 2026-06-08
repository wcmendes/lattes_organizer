/**
 * Entries View — Listagem de Entradas e Associação Manual
 *
 * Exibe entradas Lattes agrupadas por categoria com filtros, busca textual,
 * preview de comprovantes mapeados e fluxo de vinculação/desvinculação manual.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10
 * @module views/entries
 */

import { loadEntries } from '../core/entry-manager.js';
import { loadCategories } from '../core/category-manager.js';
import { categorySlug } from '../core/xml-parser.js';
import { listFiles, moveFile, renameFile, findFolder, createFolder, downloadFile, deleteFile, uploadFile } from '../services/drive.js';
import { updateRow, deleteRow } from '../services/sheets.js';
import { showSuccess, showError, showInfo } from '../ui/toast.js';
import { loadConfig } from '../config.js';
import { computeFileHash } from '../core/hash-utils.js';

/** @type {Array<Object>} All entries loaded from sheet */
let allEntries = [];

/** @type {Array<Object>} All categories loaded from sheet */
let allCategories = [];

/** @type {Object|null} Currently selected entry */
let selectedEntry = null;

/** @type {Array<Object>} Files in "novos/" folder */
let novosFiles = [];

/** @type {string} Current search query */
let searchQuery = '';

/** @type {string} Current category filter */
let filterCategory = '';

/** @type {string} Current year filter */
let filterYear = '';

/** @type {string} Current status filter */
let filterStatus = '';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders the entries view HTML (static shell with filters).
 * @returns {string} HTML string
 */
export function render() {
  return `
    <div class="container">
      <div class="entries-view">
        <h1 class="entries-view__title">Entradas Lattes</h1>

        <!-- Filters Bar -->
        <div class="entries-filters">
          <div class="entries-filters__search">
            <input
              type="text"
              id="entries-search"
              class="form-input"
              placeholder="Buscar por título ou instituição..."
              aria-label="Buscar entradas"
            />
          </div>
          <div class="entries-filters__dropdowns">
            <select id="filter-category" class="form-input entries-filters__select" aria-label="Filtrar por categoria">
              <option value="">Todas as categorias</option>
            </select>
            <select id="filter-year" class="form-input entries-filters__select" aria-label="Filtrar por ano">
              <option value="">Todos os anos</option>
            </select>
            <select id="filter-status" class="form-input entries-filters__select" aria-label="Filtrar por status">
              <option value="">Todos os status</option>
              <option value="mapeada">✓ Mapeada</option>
              <option value="pendente">✗ Não mapeada</option>
              <option value="removida">⚠ Removida</option>
            </select>
          </div>
        </div>

        <!-- Main Content: List + Detail Panel -->
        <div class="entries-layout">
          <div class="entries-list" id="entries-list" role="list" aria-label="Lista de entradas">
            <div class="entries-list__loading">Carregando entradas...</div>
          </div>
          <div class="entries-detail" id="entries-detail" aria-live="polite">
            <div class="entries-detail__empty">
              <p class="text-muted">Selecione uma entrada para ver detalhes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mounts the entries view: loads data and attaches event listeners.
 */
export function mount() {
  loadData();
  attachFilterListeners();
}

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

/**
 * Loads entries and categories from the spreadsheet.
 */
async function loadData() {
  const config = loadConfig();
  if (!config.spreadsheet_id) {
    const listEl = document.getElementById('entries-list');
    if (listEl) {
      listEl.innerHTML = '<p class="text-muted">Configure a planilha nas Configurações para visualizar entradas.</p>';
    }
    return;
  }

  try {
    const [entries, categories] = await Promise.all([
      loadEntries(config.spreadsheet_id),
      loadCategories(config.spreadsheet_id)
    ]);

    allEntries = entries;
    allCategories = categories;

    populateFilters();
    renderEntries();
  } catch (error) {
    showError(`Erro ao carregar entradas: ${error.message}`);
    const listEl = document.getElementById('entries-list');
    if (listEl) {
      listEl.innerHTML = '<p class="text-muted">Erro ao carregar dados. Tente novamente.</p>';
    }
  }
}

// ---------------------------------------------------------------------------
// Filtering & Search
// ---------------------------------------------------------------------------

/**
 * Populates the category and year filter dropdowns from loaded data.
 */
function populateFilters() {
  const categorySelect = document.getElementById('filter-category');
  const yearSelect = document.getElementById('filter-year');

  if (!categorySelect || !yearSelect) return;

  // Active categories only
  const activeCategories = allCategories.filter(c => c.ativa);
  activeCategories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat.id;
    option.textContent = cat.nome_display || cat.nome_xml;
    categorySelect.appendChild(option);
  });

  // Years from entries
  const years = [...new Set(allEntries.map(e => e.ano).filter(Boolean))].sort().reverse();
  years.forEach(year => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
  });
}

/**
 * Returns visible entries based on current filters and search.
 * Only entries from active categories and not hidden are shown.
 * @returns {Array<Object>}
 */
function getFilteredEntries() {
  const activeCategoryIds = new Set(allCategories.filter(c => c.ativa).map(c => c.id));

  return allEntries.filter(entry => {
    // Must belong to active category
    if (!activeCategoryIds.has(entry.categoria)) return false;

    // Must not be hidden
    if (entry.oculta === true || entry.oculta === 'TRUE') return false;

    // Category filter
    if (filterCategory && entry.categoria !== filterCategory) return false;

    // Year filter
    if (filterYear && entry.ano !== filterYear) return false;

    // Status filter
    if (filterStatus) {
      if (filterStatus === 'pendente' && entry.status !== 'pendente') return false;
      if (filterStatus === 'mapeada' && entry.status !== 'mapeada' && entry.status !== 'mantida_manual') return false;
      if (filterStatus === 'removida' && entry.status !== 'removida') return false;
    }

    // Search filter (min 2 chars)
    if (searchQuery.length >= 2) {
      const q = searchQuery.toLowerCase();
      const titulo = (entry.titulo || '').toLowerCase();
      const instituicao = (entry.instituicao || '').toLowerCase();
      if (!titulo.includes(q) && !instituicao.includes(q)) return false;
    }

    return true;
  });
}

/**
 * Attaches event listeners to filter controls.
 */
function attachFilterListeners() {
  const searchInput = document.getElementById('entries-search');
  const categorySelect = document.getElementById('filter-category');
  const yearSelect = document.getElementById('filter-year');
  const statusSelect = document.getElementById('filter-status');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderEntries();
    });
  }

  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      filterCategory = categorySelect.value;
      renderEntries();
    });
  }

  if (yearSelect) {
    yearSelect.addEventListener('change', () => {
      filterYear = yearSelect.value;
      renderEntries();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      filterStatus = statusSelect.value;
      renderEntries();
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Renders entries grouped by category into the list container.
 */
function renderEntries() {
  const listEl = document.getElementById('entries-list');
  if (!listEl) return;

  const filtered = getFilteredEntries();

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="entries-list__empty text-muted">Nenhuma entrada encontrada.</p>';
    return;
  }

  // Group by category — preserve original order from spreadsheet (which mirrors XML order)
  const groups = new Map();
  const categoryOrder = allCategories.filter(c => c.ativa).map(c => c.id);
  
  for (const entry of filtered) {
    if (!groups.has(entry.categoria)) {
      groups.set(entry.categoria, []);
    }
    groups.get(entry.categoria).push(entry);
  }

  // Sort groups by the original category order
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const idxA = categoryOrder.indexOf(a[0]);
    const idxB = categoryOrder.indexOf(b[0]);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });

  // Build HTML
  let html = '';
  for (const [categoryId, entries] of sortedGroups) {
    const category = allCategories.find(c => c.id === categoryId);
    const categoryName = category ? (category.nome_display || category.nome_xml) : 'Sem Categoria';

    html += `
      <div class="entries-group">
        <button class="entries-group__header" aria-expanded="true" data-category-id="${categoryId}">
          <span class="entries-group__name">${escapeHtml(categoryName)}</span>
          <span class="entries-group__count">${entries.length}</span>
          <span class="entries-group__chevron" aria-hidden="true">▾</span>
        </button>
        <div class="entries-group__body">
          ${entries.map(entry => renderEntryItem(entry)).join('')}
        </div>
      </div>
    `;
  }

  listEl.innerHTML = html;

  // Attach entry click listeners
  listEl.querySelectorAll('.entry-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger selection if clicking the hide button
      if (e.target.closest('.entry-item__hide-btn')) return;

      const entryId = el.dataset.entryId;
      selectEntry(entryId);

      // Update active state
      listEl.querySelectorAll('.entry-item').forEach(e => e.classList.remove('entry-item--active'));
      el.classList.add('entry-item--active');
    });
  });

  // Attach inline hide buttons
  listEl.querySelectorAll('.entry-item__hide-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const entryId = btn.dataset.hideEntryId;
      const entry = allEntries.find(en => en.id === entryId);
      if (entry) handleOcultarEntry(entry);
    });
  });

  // Attach collapse/expand listeners
  listEl.querySelectorAll('.entries-group__header').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      const body = btn.nextElementSibling;
      if (body) {
        body.classList.toggle('entries-group__body--collapsed');
      }
      const chevron = btn.querySelector('.entries-group__chevron');
      if (chevron) {
        chevron.textContent = expanded ? '▸' : '▾';
      }
    });
  });
}

/**
 * Renders a single entry list item.
 * @param {Object} entry
 * @returns {string} HTML string
 */
function renderEntryItem(entry) {
  const statusIcon = getStatusIcon(entry.status);
  const statusClass = getStatusClass(entry.status);
  const arquivo = entry.arquivo_nome ? escapeHtml(entry.arquivo_nome) : '';

  return `
    <div class="entry-item ${statusClass}" data-entry-id="${entry.id}" role="listitem" tabindex="0">
      <span class="entry-item__status" aria-label="${getStatusLabel(entry.status)}">${statusIcon}</span>
      <div class="entry-item__content">
        <span class="entry-item__title">${escapeHtml(entry.titulo || '(sem título)')}</span>
        <span class="entry-item__meta">
          ${entry.instituicao ? escapeHtml(entry.instituicao) : ''}${entry.instituicao && entry.ano ? ' • ' : ''}${entry.ano || ''}
        </span>
        ${arquivo ? `<span class="entry-item__file">${arquivo}</span>` : ''}
      </div>
      <button class="entry-item__hide-btn" data-hide-entry-id="${entry.id}" type="button" title="Ocultar entrada" aria-label="Ocultar">🚫</button>
    </div>
  `;
}

/**
 * Returns status icon character.
 * @param {string} status
 * @returns {string}
 */
function getStatusIcon(status) {
  switch (status) {
    case 'mapeada':
    case 'mantida_manual':
      return '✓';
    case 'removida':
      return '⚠';
    default:
      return '✗';
  }
}

/**
 * Returns CSS class for entry status.
 * @param {string} status
 * @returns {string}
 */
function getStatusClass(status) {
  switch (status) {
    case 'mapeada':
    case 'mantida_manual':
      return 'entry-item--mapeada';
    case 'removida':
      return 'entry-item--removida';
    default:
      return 'entry-item--pendente';
  }
}

/**
 * Returns accessible label for status.
 * @param {string} status
 * @returns {string}
 */
function getStatusLabel(status) {
  switch (status) {
    case 'mapeada':
    case 'mantida_manual':
      return 'Mapeada';
    case 'removida':
      return 'Removida';
    default:
      return 'Não mapeada';
  }
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

/**
 * Selects an entry and renders its detail panel.
 * @param {string} entryId
 */
async function selectEntry(entryId) {
  selectedEntry = allEntries.find(e => e.id === entryId) || null;
  const detailEl = document.getElementById('entries-detail');
  if (!detailEl || !selectedEntry) return;

  if (selectedEntry.status === 'removida') {
    renderRemovedDetail(detailEl, selectedEntry);
  } else if (selectedEntry.status === 'mapeada' || selectedEntry.status === 'mantida_manual') {
    renderMappedDetail(detailEl, selectedEntry);
  } else {
    await renderUnmappedDetail(detailEl, selectedEntry);
  }
}

/**
 * Renders detail panel for a mapped entry (with file preview).
 * @param {HTMLElement} container
 * @param {Object} entry
 */
function renderMappedDetail(container, entry) {
  const fileName = entry.arquivo_nome || '(arquivo não nomeado)';
  const confidence = entry.confianca !== null ? `${entry.confianca}%` : '—';
  const fileId = entry.arquivo_drive_id;

  let previewHtml = '';
  if (fileId) {
    // Use Google Drive embed for preview
    previewHtml = `
      <div class="entries-detail__preview">
        <iframe
          src="https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview"
          class="entries-detail__iframe"
          title="Preview do comprovante"
          allow="autoplay"
        ></iframe>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="entries-detail__mapped">
      <h3 class="entries-detail__title">${escapeHtml(entry.titulo || '')}</h3>
      <div class="entries-detail__info">
        <p><strong>Arquivo:</strong> ${escapeHtml(fileName)}</p>
        <p><strong>Confiança:</strong> ${confidence}</p>
        ${entry.data_mapeamento ? `<p><strong>Mapeado em:</strong> ${escapeHtml(entry.data_mapeamento)}</p>` : ''}
      </div>
      ${previewHtml}
      <div class="entries-detail__actions mt-md">
        <button class="btn btn--danger btn--sm" id="btn-desvincular" type="button">Desvincular</button>
        <button class="btn btn--secondary btn--sm" id="btn-ocultar" type="button">👁‍🗨 Ocultar</button>
      </div>
    </div>
  `;

  // Desvincular listener
  const btnDesvincular = document.getElementById('btn-desvincular');
  if (btnDesvincular) {
    btnDesvincular.addEventListener('click', () => handleDesvincular(entry));
  }

  // Ocultar listener
  const btnOcultar = document.getElementById('btn-ocultar');
  if (btnOcultar) {
    btnOcultar.addEventListener('click', () => handleOcultarEntry(entry));
  }
}

/**
 * Renders detail panel for a removed entry.
 * Shows warning message and action buttons (Excluir/Manter).
 * @param {HTMLElement} container
 * @param {Object} entry
 */
function renderRemovedDetail(container, entry) {
  const hasFile = !!entry.arquivo_drive_id;
  const fileName = entry.arquivo_nome || '';

  container.innerHTML = `
    <div class="entries-detail__removed">
      <h3 class="entries-detail__title">${escapeHtml(entry.titulo || '(sem título)')}</h3>
      <div class="entries-detail__info">
        ${entry.instituicao ? `<p><strong>Instituição:</strong> ${escapeHtml(entry.instituicao)}</p>` : ''}
        ${entry.ano ? `<p><strong>Ano:</strong> ${escapeHtml(entry.ano)}</p>` : ''}
        ${hasFile ? `<p><strong>Arquivo vinculado:</strong> ${escapeHtml(fileName)}</p>` : ''}
      </div>
      <div class="entries-detail__warning">
        <span class="entries-detail__warning-icon" aria-hidden="true">⚠</span>
        <p class="entries-detail__warning-text">
          Esta entrada foi removida durante a reimportação do XML Lattes. Ela não está mais presente no currículo atual.
          ${hasFile ? ' O comprovante associado também será excluído do Drive se você optar por excluir.' : ''}
        </p>
      </div>
      <div class="entries-detail__actions mt-md">
        <button class="btn btn--danger" id="btn-excluir-removida" type="button">
          Excluir definitivamente
        </button>
        <button class="btn btn--secondary" id="btn-manter-removida" type="button">
          Manter mesmo assim
        </button>
      </div>
    </div>
  `;

  // Excluir listener
  const btnExcluir = document.getElementById('btn-excluir-removida');
  if (btnExcluir) {
    btnExcluir.addEventListener('click', () => handleExcluirRemovida(entry));
  }

  // Manter listener
  const btnManter = document.getElementById('btn-manter-removida');
  if (btnManter) {
    btnManter.addEventListener('click', () => handleManterRemovida(entry));
  }
}

/**
 * Handles permanently deleting a removed entry.
 * If the entry has a linked file, deletes it from Drive first.
 * Then removes the entry row from the spreadsheet.
 * @param {Object} entry
 */
async function handleExcluirRemovida(entry) {
  const config = loadConfig();
  if (!config.spreadsheet_id) {
    showError('Configuração incompleta. Verifique a Planilha nas Configurações.');
    return;
  }

  const entryIndex = allEntries.findIndex(e => e.id === entry.id);
  if (entryIndex === -1) {
    showError('Entrada não encontrada no estado local.');
    return;
  }

  try {
    // If entry has a linked file, delete it from Drive first
    if (entry.arquivo_drive_id) {
      try {
        await deleteFile(entry.arquivo_drive_id);
      } catch (driveError) {
        showError(`Erro ao excluir arquivo do Drive: ${driveError.message}`);
        return; // Keep entry unchanged on Drive failure
      }
    }

    // Remove entry row from spreadsheet (rowIndex is 1-based, header=1)
    const rowIndex = entryIndex + 2;
    await deleteRow(config.spreadsheet_id, 'entradas', rowIndex);

    // Remove from local state
    allEntries.splice(entryIndex, 1);
    selectedEntry = null;

    showSuccess('Entrada excluída com sucesso.');

    // Re-render list and clear detail panel
    renderEntries();
    const detailEl = document.getElementById('entries-detail');
    if (detailEl) {
      detailEl.innerHTML = `
        <div class="entries-detail__empty">
          <p class="text-muted">Selecione uma entrada para ver detalhes.</p>
        </div>
      `;
    }
  } catch (error) {
    showError(`Erro ao excluir entrada: ${error.message}`);
  }
}

/**
 * Handles keeping a removed entry by changing its status to "mantida_manual".
 * Updates the entry in the spreadsheet and local state.
 * @param {Object} entry
 */
async function handleManterRemovida(entry) {
  const config = loadConfig();
  if (!config.spreadsheet_id) {
    showError('Configuração incompleta. Verifique a Planilha nas Configurações.');
    return;
  }

  const entryIndex = allEntries.findIndex(e => e.id === entry.id);
  if (entryIndex === -1) {
    showError('Entrada não encontrada no estado local.');
    return;
  }

  try {
    const updatedEntry = {
      ...entry,
      status: 'mantida_manual'
    };

    // Persist to sheets (rowIndex is 1-based, header=1)
    const rowIndex = entryIndex + 2;
    await updateRow(config.spreadsheet_id, 'entradas', rowIndex, {
      id: updatedEntry.id,
      titulo: updatedEntry.titulo,
      instituicao: updatedEntry.instituicao,
      ano: updatedEntry.ano,
      carga_horaria: updatedEntry.carga_horaria,
      categoria: updatedEntry.categoria,
      status: updatedEntry.status,
      oculta: updatedEntry.oculta === true ? 'TRUE' : 'FALSE',
      arquivo_drive_id: updatedEntry.arquivo_drive_id || '',
      arquivo_nome: updatedEntry.arquivo_nome || '',
      confianca: updatedEntry.confianca !== null ? String(updatedEntry.confianca) : '',
      data_mapeamento: updatedEntry.data_mapeamento || '',
      arquivo_hash: updatedEntry.arquivo_hash || ''
    });

    // Update local state
    allEntries[entryIndex] = updatedEntry;
    selectedEntry = updatedEntry;

    showSuccess('Entrada mantida com sucesso. Status alterado para "mantida_manual".');

    // Re-render list and detail panel
    renderEntries();
    const detailEl = document.getElementById('entries-detail');
    if (detailEl) {
      renderMappedDetail(detailEl, updatedEntry);
    }
  } catch (error) {
    showError(`Erro ao manter entrada: ${error.message}`);
  }
}

/**
 * Renders detail panel for an unmapped entry (file list from novos/).
 * @param {HTMLElement} container
 * @param {Object} entry
 */
async function renderUnmappedDetail(container, entry) {
  container.innerHTML = `
    <div class="entries-detail__unmapped">
      <h3 class="entries-detail__title">${escapeHtml(entry.titulo || '')}</h3>
      <p class="text-muted mb-md">Selecione um arquivo para vincular a esta entrada.</p>
      <div class="entries-detail__actions mb-md">
        <button class="btn btn--secondary btn--sm" id="btn-ocultar-unmapped" type="button">👁‍🗨 Ocultar</button>
      </div>
      <p class="entries-detail__drop-hint text-muted mb-md">Arraste um arquivo aqui para vincular</p>
      <div class="entries-detail__files-loading">Carregando arquivos disponíveis...</div>
    </div>
  `;

  // Ocultar listener for unmapped
  const btnOcultarUnmapped = document.getElementById('btn-ocultar-unmapped');
  if (btnOcultarUnmapped) {
    btnOcultarUnmapped.addEventListener('click', () => handleOcultarEntry(entry));
  }

  // Attach drag-and-drop to the unmapped container
  const unmappedEl = container.querySelector('.entries-detail__unmapped');
  if (unmappedEl) {
    let dragCounter = 0;

    unmappedEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      unmappedEl.classList.add('entries-detail__dropzone--active');
    });

    unmappedEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    unmappedEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        unmappedEl.classList.remove('entries-detail__dropzone--active');
      }
    });

    unmappedEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      unmappedEl.classList.remove('entries-detail__dropzone--active');
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await handleDropVincular(entry, files[0]);
      }
    });
  }

  try {
    const config = loadConfig();
    if (!config.root_folder_id) {
      const el = container.querySelector('.entries-detail__files-loading');
      if (el) el.textContent = 'Pasta raiz não configurada.';
      return;
    }

    // Find novos/ folder
    const filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      const el = container.querySelector('.entries-detail__files-loading');
      if (el) el.textContent = 'Pasta "files/" não encontrada.';
      return;
    }

    const novosFolderId = await findFolder('novos', filesFolderId);
    if (!novosFolderId) {
      const el = container.querySelector('.entries-detail__files-loading');
      if (el) el.textContent = 'Pasta "files/novos/" não encontrada.';
      return;
    }

    novosFiles = await listFiles(novosFolderId);
    novosFiles.sort((a, b) => a.name.localeCompare(b.name));

    const filesContainer = container.querySelector('.entries-detail__files-loading');
    if (!filesContainer) return; // Container may have changed during async operation
    if (novosFiles.length === 0) {
      filesContainer.outerHTML = '<p class="text-muted">Nenhum arquivo disponível em "files/novos/".</p>';
      return;
    }

    let filesHtml = `
      <div class="entries-detail__bulk-actions">
        <button class="btn btn--danger btn--sm" id="btn-excluir-todos-novos" type="button">🗑 Excluir todos sem match</button>
      </div>
    `;
    filesHtml += '<ul class="entries-detail__file-list">';
    for (const file of novosFiles) {
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
      filesHtml += `
        <li class="entries-detail__file-item" data-file-id="${file.id}">
          <span class="entries-detail__file-name">${escapeHtml(file.name)}</span>
          <div class="entries-detail__file-actions">
            <button class="btn btn--outline btn--sm btn-preview-toggle" data-file-id="${file.id}" data-file-name="${escapeHtml(file.name)}" data-is-image="${isImage}" type="button" title="Preview">👁</button>
            <a href="https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view"
               target="_blank"
               rel="noopener noreferrer"
               class="btn btn--outline btn--sm" title="Abrir no Drive">📂</a>
            <button class="btn btn--primary btn--sm btn-vincular" data-file-id="${file.id}" data-file-name="${escapeHtml(file.name)}" type="button" title="Vincular a esta entrada">🔗</button>
            <button class="btn btn--outline btn--sm btn-excluir-file" data-file-id="${file.id}" data-file-name="${escapeHtml(file.name)}" type="button" style="color: var(--color-error); border-color: var(--color-error);" title="Excluir arquivo">🗑</button>
          </div>
          <div class="entries-detail__preview-container" data-preview-for="${file.id}" style="display:none;">
            ${isImage
              ? `<img src="https://drive.google.com/uc?id=${file.id}" class="entries-detail__inline-preview-img" alt="${escapeHtml(file.name)}" />`
              : `<iframe src="https://drive.google.com/file/d/${file.id}/preview" class="entries-detail__inline-preview" title="Preview ${escapeHtml(file.name)}"></iframe>`
            }
          </div>
        </li>
      `;
    }
    filesHtml += '</ul>';

    filesContainer.outerHTML = filesHtml;

    // Attach preview toggle listeners
    container.querySelectorAll('.btn-preview-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const fileId = btn.dataset.fileId;
        const previewDiv = container.querySelector(`[data-preview-for="${fileId}"]`);
        if (previewDiv) {
          const isVisible = previewDiv.style.display !== 'none';
          previewDiv.style.display = isVisible ? 'none' : 'block';
        }
      });
    });

    // Attach vincular listeners
    container.querySelectorAll('.btn-vincular').forEach(btn => {
      btn.addEventListener('click', () => {
        const fileId = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        handleVincular(entry, fileId, fileName);
      });
    });

    // Attach individual delete listeners
    container.querySelectorAll('.btn-excluir-file').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        if (!confirm(`Excluir "${fileName}" permanentemente do Drive?`)) return;
        try {
          await deleteFile(fileId);
          const li = container.querySelector(`li[data-file-id="${fileId}"]`);
          if (li) li.remove();
          showSuccess(`Arquivo "${fileName}" excluído.`);
        } catch (err) {
          showError(`Erro ao excluir "${fileName}": ${err.message}`);
        }
      });
    });

    // Attach bulk delete listener
    const btnBulkDelete = container.querySelector('#btn-excluir-todos-novos');
    if (btnBulkDelete) {
      btnBulkDelete.addEventListener('click', async () => {
        if (!confirm(`Excluir TODOS os ${novosFiles.length} arquivos da pasta "novos/"? Esta ação não pode ser desfeita.`)) return;
        let deleted = 0;
        showInfo(`Excluindo ${novosFiles.length} arquivos...`);
        for (const f of novosFiles) {
          try {
            await deleteFile(f.id);
            deleted++;
            const li = container.querySelector(`li[data-file-id="${f.id}"]`);
            if (li) li.remove();
          } catch (err) {
            showError(`Falha ao excluir "${f.name}": ${err.message}`);
          }
        }
        showSuccess(`${deleted} arquivo(s) excluído(s).`);
        // Remove the bulk button and empty list message
        const bulkDiv = container.querySelector('.entries-detail__bulk-actions');
        if (bulkDiv) bulkDiv.remove();
        const fileList = container.querySelector('.entries-detail__file-list');
        if (fileList && fileList.children.length === 0) {
          fileList.outerHTML = '<p class="text-muted">Nenhum arquivo disponível em "files/novos/".</p>';
        }
      });
    }
  } catch (error) {
    showError(`Erro ao listar arquivos: ${error.message}`);
    const filesEl = container.querySelector('.entries-detail__files-loading');
    if (filesEl) {
      filesEl.textContent = 'Erro ao carregar arquivos.';
    }
  }
}

// ---------------------------------------------------------------------------
// Ocultar Entry
// ---------------------------------------------------------------------------

/**
 * Handles hiding an entry by setting oculta = true.
 * Updates the entry in Sheets, local state, re-renders list and clears detail.
 * @param {Object} entry
 */
async function handleOcultarEntry(entry) {
  const config = loadConfig();
  if (!config.spreadsheet_id) {
    showError('Configuração incompleta. Verifique a Planilha nas Configurações.');
    return;
  }

  const entryIndex = allEntries.findIndex(e => e.id === entry.id);
  if (entryIndex === -1) {
    showError('Entrada não encontrada no estado local.');
    return;
  }

  try {
    const updatedEntry = { ...entry, oculta: true };

    const rowIndex = entryIndex + 2;
    await updateRow(config.spreadsheet_id, 'entradas', rowIndex, {
      id: updatedEntry.id,
      titulo: updatedEntry.titulo,
      instituicao: updatedEntry.instituicao,
      ano: updatedEntry.ano,
      carga_horaria: updatedEntry.carga_horaria,
      categoria: updatedEntry.categoria,
      status: updatedEntry.status,
      oculta: 'TRUE',
      arquivo_drive_id: updatedEntry.arquivo_drive_id || '',
      arquivo_nome: updatedEntry.arquivo_nome || '',
      confianca: updatedEntry.confianca !== null ? String(updatedEntry.confianca) : '',
      data_mapeamento: updatedEntry.data_mapeamento || '',
      arquivo_hash: updatedEntry.arquivo_hash || ''
    });

    allEntries[entryIndex] = updatedEntry;
    selectedEntry = null;

    showSuccess("Entrada oculta. Restaure em 'Itens Ocultos'.");

    renderEntries();
    const detailEl = document.getElementById('entries-detail');
    if (detailEl) {
      detailEl.innerHTML = `
        <div class="entries-detail__empty">
          <p class="text-muted">Selecione uma entrada para ver detalhes.</p>
        </div>
      `;
    }
  } catch (error) {
    showError(`Erro ao ocultar entrada: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Vincular / Desvincular
// ---------------------------------------------------------------------------

/**
 * Handles binding a file to an entry.
 * Flow: save mapping, move file to category folder, rename file.
 * @param {Object} entry
 * @param {string} fileId
 * @param {string} fileName
 */
async function handleVincular(entry, fileId, fileName) {
  const config = loadConfig();
  if (!config.spreadsheet_id || !config.root_folder_id) {
    showError('Configuração incompleta. Verifique Planilha e Pasta raiz.');
    return;
  }

  try {
    // Find category info
    const category = allCategories.find(c => c.id === entry.categoria);
    if (!category) {
      showError('Categoria não encontrada para esta entrada.');
      return;
    }

    // Ensure category folder exists
    const filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      showError('Pasta "files/" não encontrada no Drive.');
      return;
    }

    const novosFolderId = await findFolder('novos', filesFolderId);
    if (!novosFolderId) {
      showError('Pasta "files/novos/" não encontrada no Drive.');
      return;
    }

    const slug = categorySlug(category.nome_xml);
    let categoryFolderId = await findFolder(slug, filesFolderId);
    if (!categoryFolderId) {
      categoryFolderId = await createFolder(slug, filesFolderId);
    }

    // Generate new file name
    const ext = getFileExtension(fileName);
    const newName = buildFileName(entry, slug, ext);

    // Move file to category folder
    await moveFile(fileId, novosFolderId, categoryFolderId);

    // Rename file
    await renameFile(fileId, newName);

    // Update entry in sheet
    const entryIndex = allEntries.findIndex(e => e.id === entry.id);
    if (entryIndex === -1) {
      showError('Entrada não encontrada no estado local.');
      return;
    }

    const updatedEntry = {
      ...entry,
      status: 'mapeada',
      arquivo_drive_id: fileId,
      arquivo_nome: newName,
      confianca: 100,
      data_mapeamento: new Date().toISOString().slice(0, 10)
    };

    // Persist to sheets (rowIndex is 1-based, header=1)
    const rowIndex = entryIndex + 2;
    await updateRow(config.spreadsheet_id, 'entradas', rowIndex, {
      id: updatedEntry.id,
      titulo: updatedEntry.titulo,
      instituicao: updatedEntry.instituicao,
      ano: updatedEntry.ano,
      carga_horaria: updatedEntry.carga_horaria,
      categoria: updatedEntry.categoria,
      status: updatedEntry.status,
      oculta: updatedEntry.oculta === true ? 'TRUE' : 'FALSE',
      arquivo_drive_id: updatedEntry.arquivo_drive_id || '',
      arquivo_nome: updatedEntry.arquivo_nome || '',
      confianca: updatedEntry.confianca !== null ? String(updatedEntry.confianca) : '',
      data_mapeamento: updatedEntry.data_mapeamento || '',
      arquivo_hash: updatedEntry.arquivo_hash || ''
    });

    // Update local state
    allEntries[entryIndex] = updatedEntry;
    selectedEntry = updatedEntry;

    showSuccess(`Comprovante vinculado: ${newName}`);

    // Re-render
    renderEntries();
    const detailEl = document.getElementById('entries-detail');
    if (detailEl) {
      renderMappedDetail(detailEl, updatedEntry);
    }
  } catch (error) {
    showError(`Erro ao vincular: ${error.message}`);
  }
}

/**
 * Handles binding a dropped file to an entry.
 * Flow: upload file to "files/novos/" via Drive API, then call handleVincular.
 * @param {Object} entry
 * @param {File} file — dropped file
 */
async function handleDropVincular(entry, file) {
  const config = loadConfig();
  if (!config.spreadsheet_id || !config.root_folder_id) {
    showError('Configuração incompleta. Verifique Planilha e Pasta raiz.');
    return;
  }

  try {
    // Compute SHA-256 hash from local file before uploading
    let fileHash = '';
    try {
      fileHash = await computeFileHash(file);
    } catch (hashError) {
      console.warn(`[Entries] Could not compute hash for "${file.name}":`, hashError);
    }

    // Find or create "files/novos/" folder
    let filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      showError('Pasta "files/" não encontrada no Drive.');
      return;
    }

    let novosFolderId = await findFolder('novos', filesFolderId);
    if (!novosFolderId) {
      novosFolderId = await createFolder('novos', filesFolderId);
    }

    // Upload the dropped file to "files/novos/"
    const uploadResult = await uploadFile(file, novosFolderId);

    // Now call handleVincular with the uploaded file's Drive ID and name
    // Pass the hash so it's saved with the entry
    await handleVincularWithHash(entry, uploadResult.id, uploadResult.name || file.name, fileHash);
  } catch (error) {
    showError(`Erro ao fazer upload do arquivo: ${error.message}`);
  }
}

/**
 * Handles binding a file to an entry with a pre-computed hash.
 * Same as handleVincular but saves the hash in the entry row.
 * @param {Object} entry
 * @param {string} fileId
 * @param {string} fileName
 * @param {string} fileHash — SHA-256 hash of the file
 */
async function handleVincularWithHash(entry, fileId, fileName, fileHash) {
  const config = loadConfig();
  if (!config.spreadsheet_id || !config.root_folder_id) {
    showError('Configuração incompleta. Verifique Planilha e Pasta raiz.');
    return;
  }

  try {
    // Find category info
    const category = allCategories.find(c => c.id === entry.categoria);
    if (!category) {
      showError('Categoria não encontrada para esta entrada.');
      return;
    }

    // Ensure category folder exists
    const filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      showError('Pasta "files/" não encontrada no Drive.');
      return;
    }

    const novosFolderId = await findFolder('novos', filesFolderId);
    if (!novosFolderId) {
      showError('Pasta "files/novos/" não encontrada no Drive.');
      return;
    }

    const slug = categorySlug(category.nome_xml);
    let categoryFolderId = await findFolder(slug, filesFolderId);
    if (!categoryFolderId) {
      categoryFolderId = await createFolder(slug, filesFolderId);
    }

    // Generate new file name
    const ext = getFileExtension(fileName);
    const newName = buildFileName(entry, slug, ext);

    // Move file to category folder
    await moveFile(fileId, novosFolderId, categoryFolderId);

    // Rename file
    await renameFile(fileId, newName);

    // Update entry in sheet
    const entryIndex = allEntries.findIndex(e => e.id === entry.id);
    if (entryIndex === -1) {
      showError('Entrada não encontrada no estado local.');
      return;
    }

    const updatedEntry = {
      ...entry,
      status: 'mapeada',
      arquivo_drive_id: fileId,
      arquivo_nome: newName,
      confianca: 100,
      data_mapeamento: new Date().toISOString().slice(0, 10),
      arquivo_hash: fileHash || ''
    };

    // Persist to sheets (rowIndex is 1-based, header=1)
    const rowIndex = entryIndex + 2;
    await updateRow(config.spreadsheet_id, 'entradas', rowIndex, {
      id: updatedEntry.id,
      titulo: updatedEntry.titulo,
      instituicao: updatedEntry.instituicao,
      ano: updatedEntry.ano,
      carga_horaria: updatedEntry.carga_horaria,
      categoria: updatedEntry.categoria,
      status: updatedEntry.status,
      oculta: updatedEntry.oculta === true ? 'TRUE' : 'FALSE',
      arquivo_drive_id: updatedEntry.arquivo_drive_id || '',
      arquivo_nome: updatedEntry.arquivo_nome || '',
      confianca: updatedEntry.confianca !== null ? String(updatedEntry.confianca) : '',
      data_mapeamento: updatedEntry.data_mapeamento || '',
      arquivo_hash: updatedEntry.arquivo_hash || ''
    });

    // Update local state
    allEntries[entryIndex] = updatedEntry;
    selectedEntry = updatedEntry;

    showSuccess(`Comprovante vinculado: ${newName}`);

    // Re-render
    renderEntries();
    const detailEl = document.getElementById('entries-detail');
    if (detailEl) {
      renderMappedDetail(detailEl, updatedEntry);
    }
  } catch (error) {
    showError(`Erro ao vincular: ${error.message}`);
  }
}

/**
 * Handles unbinding a file from an entry.
 * Flow: confirm → remove mapping, move file back to novos/.
 * @param {Object} entry
 */
async function handleDesvincular(entry) {
  // Confirmation dialog
  const confirmed = confirm('Deseja realmente desvincular este comprovante? O arquivo será movido de volta para "novos/".');
  if (!confirmed) return;

  const config = loadConfig();
  if (!config.spreadsheet_id || !config.root_folder_id) {
    showError('Configuração incompleta.');
    return;
  }

  try {
    const fileId = entry.arquivo_drive_id;
    if (!fileId) {
      showError('Nenhum arquivo vinculado a esta entrada.');
      return;
    }

    // Find folders
    const filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      showError('Pasta "files/" não encontrada no Drive.');
      return;
    }

    const novosFolderId = await findFolder('novos', filesFolderId);
    if (!novosFolderId) {
      showError('Pasta "files/novos/" não encontrada no Drive.');
      return;
    }

    // Find current folder (category folder)
    const category = allCategories.find(c => c.id === entry.categoria);
    const slug = category ? categorySlug(category.nome_xml) : '';
    let fromFolderId = null;

    if (slug) {
      fromFolderId = await findFolder(slug, filesFolderId);
    }

    if (!fromFolderId) {
      // Fallback: try to move from wherever it is
      fromFolderId = filesFolderId;
    }

    // Move file back to novos/
    await moveFile(fileId, fromFolderId, novosFolderId);

    // Update entry in sheet
    const entryIndex = allEntries.findIndex(e => e.id === entry.id);
    if (entryIndex === -1) {
      showError('Entrada não encontrada no estado local.');
      return;
    }

    const updatedEntry = {
      ...entry,
      status: 'pendente',
      arquivo_drive_id: null,
      arquivo_nome: null,
      confianca: null,
      data_mapeamento: null
    };

    const rowIndex = entryIndex + 2;
    await updateRow(config.spreadsheet_id, 'entradas', rowIndex, {
      id: updatedEntry.id,
      titulo: updatedEntry.titulo,
      instituicao: updatedEntry.instituicao,
      ano: updatedEntry.ano,
      carga_horaria: updatedEntry.carga_horaria,
      categoria: updatedEntry.categoria,
      status: updatedEntry.status,
      oculta: updatedEntry.oculta === true ? 'TRUE' : 'FALSE',
      arquivo_drive_id: '',
      arquivo_nome: '',
      confianca: '',
      data_mapeamento: '',
      arquivo_hash: ''
    });

    // Update local state
    allEntries[entryIndex] = updatedEntry;
    selectedEntry = updatedEntry;

    showSuccess('Comprovante desvinculado com sucesso.');

    // Re-render
    renderEntries();
    const detailEl = document.getElementById('entries-detail');
    if (detailEl) {
      await renderUnmappedDetail(detailEl, updatedEntry);
    }
  } catch (error) {
    showError(`Erro ao desvincular: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// File Naming
// ---------------------------------------------------------------------------

/**
 * Builds the standardized file name for a mapped entry.
 * Pattern: "ANO_tipo_INSTITUICAO_Titulo.ext" (max 200 chars, ASCII-safe)
 *
 * @param {Object} entry — LattesEntry
 * @param {string} slug — category slug
 * @param {string} ext — file extension (with dot)
 * @returns {string}
 */
function buildFileName(entry, slug, ext) {
  const ano = entry.ano || 'SEMANO';
  const tipo = slug || 'sem-tipo';
  const instituicao = sanitizeForFilename(entry.instituicao || 'SEM-INST');
  const titulo = sanitizeForFilename(entry.titulo || 'sem-titulo');

  let name = `${ano}_${tipo}_${instituicao}_${titulo}`;

  // Max 200 chars total (including extension)
  const maxBase = 200 - ext.length;
  if (name.length > maxBase) {
    name = name.slice(0, maxBase);
  }

  return name + ext;
}

/**
 * Sanitizes a string for use in file names.
 * Replaces accents with ASCII equivalents, removes invalid characters.
 * @param {string} str
 * @returns {string}
 */
function sanitizeForFilename(str) {
  if (!str) return '';

  // Normalize and remove diacritics
  let result = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Replace spaces and special chars with hyphens or underscores
  result = result.replace(/[^a-zA-Z0-9._-]/g, '-');

  // Collapse multiple hyphens
  result = result.replace(/-{2,}/g, '-');

  // Trim hyphens from start/end
  result = result.replace(/^-+|-+$/g, '');

  return result;
}

/**
 * Gets the file extension from a filename (including the dot).
 * @param {string} fileName
 * @returns {string}
 */
function getFileExtension(fileName) {
  if (!fileName) return '';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.slice(lastDot);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Escapes HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
