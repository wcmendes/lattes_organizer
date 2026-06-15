/**
 * Hidden View — Itens Ocultos
 *
 * Exibe categorias desativadas e entradas individualmente ocultas,
 * com opção de reativação para cada item.
 *
 * - Categorias: reativar altera ativa=true na planilha e cria subpasta no Drive
 * - Entradas: tornar visível altera oculta=false na planilha
 *
 * Requirements: 6.5, 6.6
 * @module views/hidden
 */

import { loadCategories, toggleCategory, unhideEntry, getHiddenItems } from '../core/category-manager.js';
import { loadEntries } from '../core/entry-manager.js';
import { loadConfig } from '../config.js';
import { showSuccess, showError } from '../ui/toast.js';

/** @type {Array<Object>} cached categories */
let categories = [];

/** @type {Array<Object>} cached entries */
let entries = [];

/** @type {boolean} loading state */
let isLoading = true;

/**
 * Renders the hidden items view HTML.
 * @returns {string} HTML string
 */
export function render() {
  return `
    <div class="container">
      <div class="hidden-view">
        <h1 class="hidden-view__title">Itens Ocultos</h1>
        <div id="hidden-view-content">
          <div class="hidden-view__loading">
            <div class="spinner spinner--sm"></div>
            <span>Carregando...</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mounts the hidden view: loads data and renders content.
 */
export function mount() {
  _loadData();
}

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

/**
 * Loads categories and entries, then renders the view content.
 * @private
 */
async function _loadData() {
  const config = loadConfig();
  const spreadsheetId = config.spreadsheet_id;

  if (!spreadsheetId) {
    _renderContent({ hiddenCategories: [], hiddenEntries: [] });
    return;
  }

  isLoading = true;

  try {
    [categories, entries] = await Promise.all([
      loadCategories(spreadsheetId),
      loadEntries(spreadsheetId)
    ]);

    const hiddenItems = getHiddenItems(entries, categories);
    _renderContent(hiddenItems);
  } catch (error) {
    showError(`Erro ao carregar itens ocultos: ${error.message}`);
    _renderContent({ hiddenCategories: [], hiddenEntries: [] });
  } finally {
    isLoading = false;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Renders the hidden items content into the container.
 * @param {{hiddenCategories: Array, hiddenEntries: Array}} hiddenItems
 * @private
 */
function _renderContent(hiddenItems) {
  const container = document.getElementById('hidden-view-content');
  if (!container) return;

  const { hiddenCategories, hiddenEntries } = hiddenItems;

  // Empty state
  if (hiddenCategories.length === 0 && hiddenEntries.length === 0) {
    container.innerHTML = `
      <div class="hidden-view__empty">
        <p class="hidden-view__empty-text">Nenhum item oculto.</p>
      </div>
    `;
    return;
  }

  let html = '';

  // Section 1: Categorias Inativas
  if (hiddenCategories.length > 0) {
    html += `
      <section class="hidden-view__section" aria-labelledby="hidden-categories-heading">
        <h2 id="hidden-categories-heading" class="hidden-view__section-title">Categorias Inativas</h2>
        <ul class="hidden-view__list" role="list">
          ${hiddenCategories.map(cat => `
            <li class="hidden-view__item card" data-category-id="${_escapeAttr(cat.id)}">
              <div class="hidden-view__item-info">
                <span class="hidden-view__item-name">${_escapeHtml(cat.nome_display || cat.nome_xml)}</span>
              </div>
              <button
                class="btn btn--outline btn--sm hidden-view__btn-reactivate"
                data-action="reactivate-category"
                data-category-id="${_escapeAttr(cat.id)}"
                type="button"
              >
                Reativar
              </button>
            </li>
          `).join('')}
        </ul>
      </section>
    `;
  }

  // Section 2: Entradas Ocultas (from active categories only)
  const activeCategoryIds = new Set(categories.filter(c => c.ativa).map(c => c.id));
  const visibleHiddenEntries = hiddenEntries.filter(e => activeCategoryIds.has(e.categoria));

  if (visibleHiddenEntries.length > 0) {
    // Group by category
    const groupedByCategory = new Map();
    for (const entry of visibleHiddenEntries) {
      if (!groupedByCategory.has(entry.categoria)) {
        groupedByCategory.set(entry.categoria, []);
      }
      groupedByCategory.get(entry.categoria).push(entry);
    }

    html += `
      <section class="hidden-view__section" aria-labelledby="hidden-entries-heading">
        <h2 id="hidden-entries-heading" class="hidden-view__section-title">Entradas Ocultas</h2>
    `;

    for (const [categoryId, entriesInCat] of groupedByCategory) {
      const category = categories.find(c => c.id === categoryId);
      const categoryName = category ? (category.nome_display || category.nome_xml) : 'Sem Categoria';

      html += `
        <h3 style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-secondary); margin: 1rem 0 0.5rem; padding-left: 0.5rem;">${_escapeHtml(categoryName)} (${entriesInCat.length})</h3>
        <ul class="hidden-view__list" role="list">
          ${entriesInCat.map(entry => `
            <li class="hidden-view__item card" data-entry-id="${_escapeAttr(entry.id)}">
              <div class="hidden-view__item-info">
                <span class="hidden-view__item-name">${_escapeHtml(entry.titulo)}</span>
                <span class="hidden-view__item-detail">${_escapeHtml(entry.instituicao || '')}${entry.ano ? ' • ' + _escapeHtml(entry.ano) : ''}</span>
              </div>
              <button
                class="btn btn--outline btn--sm hidden-view__btn-reactivate"
                data-action="unhide-entry"
                data-entry-id="${_escapeAttr(entry.id)}"
                type="button"
              >
                Tornar Visível
              </button>
            </li>
          `).join('')}
        </ul>
      `;
    }

    html += `</section>`;
  }

  // If we have hidden categories but no visible hidden entries in active categories,
  // and no entries at all, re-check empty state for entries section
  if (hiddenCategories.length > 0 && visibleHiddenEntries.length === 0 && hiddenEntries.length > 0) {
    // Some entries are hidden but belong to inactive categories — no need for extra message
  }

  container.innerHTML = html;
  _attachListeners(container);
}

// ---------------------------------------------------------------------------
// Event Handling
// ---------------------------------------------------------------------------

/**
 * Attaches click listeners for reactivation buttons.
 * @param {HTMLElement} container
 * @private
 */
function _attachListeners(container) {
  container.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === 'reactivate-category') {
      await _handleReactivateCategory(btn);
    } else if (action === 'unhide-entry') {
      await _handleUnhideEntry(btn);
    }
  });
}

/**
 * Handles category reactivation.
 * @param {HTMLElement} btn
 * @private
 */
async function _handleReactivateCategory(btn) {
  const categoryId = btn.dataset.categoryId;
  btn.disabled = true;
  btn.textContent = 'Reativando...';

  try {
    const updatedCategory = await toggleCategory(categoryId, true, categories);

    // Update local state
    const index = categories.findIndex(c => c.id === categoryId);
    if (index !== -1) {
      categories[index] = updatedCategory;
    }

    showSuccess('Categoria reativada com sucesso.');

    // Re-render with updated state
    const hiddenItems = getHiddenItems(entries, categories);
    _renderContent(hiddenItems);
  } catch (error) {
    showError(`Erro ao reativar categoria: ${error.message}`);
    btn.disabled = false;
    btn.textContent = 'Reativar';
  }
}

/**
 * Handles entry unhide (tornar visível).
 * @param {HTMLElement} btn
 * @private
 */
async function _handleUnhideEntry(btn) {
  const entryId = btn.dataset.entryId;
  btn.disabled = true;
  btn.textContent = 'Restaurando...';

  try {
    const updatedEntry = await unhideEntry(entryId, entries);

    // Update local state
    const index = entries.findIndex(e => e.id === entryId);
    if (index !== -1) {
      entries[index] = updatedEntry;
    }

    showSuccess('Entrada restaurada com sucesso.');

    // Re-render with updated state
    const hiddenItems = getHiddenItems(entries, categories);
    _renderContent(hiddenItems);
  } catch (error) {
    showError(`Erro ao restaurar entrada: ${error.message}`);
    btn.disabled = false;
    btn.textContent = 'Tornar Visível';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes HTML for safe rendering.
 * @param {string} str
 * @returns {string}
 * @private
 */
function _escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escapes a string for use in HTML attributes.
 * @param {string} str
 * @returns {string}
 * @private
 */
function _escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
