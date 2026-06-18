/**
 * Dashboard View — ComprovaLattes
 *
 * Exibe barras de progresso de mapeamento:
 * - Barra global: % de entradas mapeadas / total visíveis + "X de Y mapeadas"
 * - Barras por categoria ativa: nome, %, "X de Y"
 *
 * Cálculo usa apenas entradas de categorias ativas (ON) e não ocultas.
 * Recalcula automaticamente ao mudar visibilidade (sem recarga).
 * Denominador zero → 0% e "0 de 0 mapeadas".
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 * @module views/dashboard
 */

import { loadEntries } from '../core/entry-manager.js';
import { loadCategories } from '../core/category-manager.js';
import { loadConfig } from '../config.js';
import { showError, showSuccess } from '../ui/toast.js';
import { exportToDrive, exportToZip } from '../core/exporter.js';
import { listFiles, findFolder } from '../services/drive.js';

/**
 * Renders the dashboard view HTML (static shell).
 * Data is loaded and injected during mount().
 * @returns {string} HTML string for the dashboard view
 */
export function render() {
  return `
    <div class="container">
      <div class="dashboard-view">
        <div class="dashboard-view__header">
          <h1 class="dashboard-view__title">Dashboard</h1>
          <p class="dashboard-view__subtitle">Progresso de mapeamento de comprovantes</p>
        </div>
        <div id="dashboard-content" class="dashboard-view__content">
          <div class="dashboard-view__loading">
            <span class="spinner spinner--sm" aria-hidden="true"></span>
            <span>Carregando dados...</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Attaches event listeners, loads data, and renders progress bars.
 * Should be called after render() output is injected into #app.
 */
export function mount() {
  _loadAndRender();
  _attachExportListeners();
  _loadStorageInfo();
}

// ---------------------------------------------------------------------------
// Internal: Data Loading and Rendering
// ---------------------------------------------------------------------------

/**
 * Loads entries and categories, then renders the dashboard content.
 * @private
 */
async function _loadAndRender() {
  const contentEl = document.getElementById('dashboard-content');
  if (!contentEl) return;

  const config = loadConfig();
  const spreadsheetId = config.spreadsheet_id;

  if (!spreadsheetId) {
    contentEl.innerHTML = _renderEmptyState();
    return;
  }

  try {
    const [entries, categories] = await Promise.all([
      loadEntries(spreadsheetId),
      loadCategories(spreadsheetId)
    ]);

    if (entries.length === 0) {
      contentEl.innerHTML = _renderEmptyState();
      return;
    }

    contentEl.innerHTML = _renderDashboard(entries, categories);
  } catch (error) {
    showError(`Falha ao carregar dados: ${error.message}`);
    contentEl.innerHTML = _renderEmptyState();
  }
}

/**
 * Renders the complete dashboard with global and per-category progress bars.
 * @param {Array<Object>} entries - All entries from the spreadsheet
 * @param {Array<Object>} categories - All categories from the spreadsheet
 * @returns {string} HTML string
 * @private
 */
function _renderDashboard(entries, categories) {
  const activeCategories = categories.filter(c => c.ativa);
  const visibleEntries = _getVisibleEntries(entries, categories);
  const mappedEntries = visibleEntries.filter(e => _isMapped(e));

  const globalTotal = visibleEntries.length;
  const globalMapped = mappedEntries.length;
  const globalPercent = globalTotal > 0 ? Math.round((globalMapped / globalTotal) * 100) : 0;

  let html = `
    <!-- Global Progress -->
    <section class="dashboard-section" aria-label="Progresso global de mapeamento">
      <h2 class="dashboard-section__title">Progresso Global</h2>
      <div class="dashboard-global">
        <div class="dashboard-global__stats">
          <span class="dashboard-global__percent">${globalPercent}%</span>
          <span class="dashboard-global__count">${globalMapped} de ${globalTotal} mapeadas</span>
        </div>
        <div class="progress progress--lg" role="progressbar" aria-valuenow="${globalPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso global: ${globalPercent}%">
          <div class="progress__bar${globalPercent === 100 ? ' progress__bar--success' : ''}" style="width: ${globalPercent}%"></div>
        </div>
      </div>
    </section>
  `;

  // Per-category progress
  if (activeCategories.length > 0) {
    html += `
    <!-- Per-category Progress -->
    <section class="dashboard-section" aria-label="Progresso por categoria">
      <h2 class="dashboard-section__title">Por Categoria</h2>
      <div class="dashboard-categories">
    `;

    for (const category of activeCategories) {
      const catEntries = visibleEntries.filter(e => e.categoria === category.id);
      const catMapped = catEntries.filter(e => _isMapped(e));
      const catTotal = catEntries.length;
      const catMappedCount = catMapped.length;
      const catPercent = catTotal > 0 ? Math.round((catMappedCount / catTotal) * 100) : 0;

      html += `
        <div class="progress-group">
          <div class="progress-group__label">
            <span class="progress-group__name">${_escapeHtml(category.nome_display || category.nome_xml)}</span>
            <span class="progress-group__value">${catPercent}% — ${catMappedCount} de ${catTotal}</span>
          </div>
          <div class="progress" role="progressbar" aria-valuenow="${catPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="${_escapeHtml(category.nome_display || category.nome_xml)}: ${catPercent}%">
            <div class="progress__bar${catPercent === 100 ? ' progress__bar--success' : ''}" style="width: ${catPercent}%"></div>
          </div>
        </div>
      `;
    }

    html += `
      </div>
    </section>
    `;
  }

  // Storage section
  html += `
    <section class="dashboard-section">
      <h2 class="dashboard-section__title">Armazenamento</h2>
      <div id="dashboard-storage">
        <p class="text-muted">Calculando tamanho dos arquivos...</p>
      </div>
    </section>
  `;

  // Export section
  html += `
    <section class="dashboard-section">
      <h2 class="dashboard-section__title">Exportação</h2>
      <p class="text-muted mb-md">Exporte seus comprovantes organizados por categoria.</p>
      <div style="display: flex; gap: var(--spacing-md);">
        <button id="btn-export-drive" class="btn btn--primary" type="button">Exportar para Drive</button>
        <button id="btn-export-zip" class="btn btn--outline" type="button">Baixar ZIP</button>
      </div>
    </section>
  `;

  return html;
}

/**
 * Renders an empty state directing the user to import XML first.
 * @returns {string} HTML string
 * @private
 */
function _renderEmptyState() {
  return `
    <div class="dashboard-empty">
      <p class="dashboard-empty__message">
        Nenhuma entrada encontrada. Importe um XML Lattes para começar.
      </p>
      <a href="#importacao" class="btn btn--primary">Importar XML</a>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Internal: Export Listeners
// ---------------------------------------------------------------------------

/**
 * Attaches click handlers for export buttons.
 * Uses MutationObserver to wait for buttons to appear after async render.
 * @private
 */
function _attachExportListeners() {
  // Use a short polling approach since dashboard-content is async-rendered
  const observer = new MutationObserver(() => {
    const btnDrive = document.getElementById('btn-export-drive');
    const btnZip = document.getElementById('btn-export-zip');

    if (btnDrive && btnZip) {
      observer.disconnect();

      btnDrive.addEventListener('click', async () => {
        try {
          const config = loadConfig();
          if (!config.spreadsheet_id || !config.root_folder_id) {
            showError('Configuração incompleta. Verifique Planilha e Pasta raiz.');
            return;
          }
          const [entries, categories] = await Promise.all([
            loadEntries(config.spreadsheet_id),
            loadCategories(config.spreadsheet_id)
          ]);
          await exportToDrive(entries, {
            rootFolderId: config.root_folder_id,
            categories
          });
        } catch (error) {
          showError(`Erro na exportação: ${error.message}`);
        }
      });

      btnZip.addEventListener('click', async () => {
        try {
          const config = loadConfig();
          if (!config.spreadsheet_id) {
            showError('Configuração incompleta. Verifique a Planilha.');
            return;
          }
          const [entries, categories] = await Promise.all([
            loadEntries(config.spreadsheet_id),
            loadCategories(config.spreadsheet_id)
          ]);
          const blob = await exportToZip(entries, { categories });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ComprovaLattes.zip';
          a.click();
          URL.revokeObjectURL(url);
          showSuccess('Download do ZIP iniciado.');
        } catch (error) {
          showError(`Erro ao gerar ZIP: ${error.message}`);
        }
      });
    }
  });

  const contentEl = document.getElementById('dashboard-content');
  if (contentEl) {
    observer.observe(contentEl, { childList: true, subtree: true });
  }
}

// ---------------------------------------------------------------------------
// Internal: Visibility & Mapping Logic
// ---------------------------------------------------------------------------

/**
 * Returns visible entries based on visibility rules (Property 6).
 * A visible entry:
 * 1. Its category is active (ativa = true)
 * 2. It is not hidden (oculta !== true and !== 'TRUE')
 * 3. Its status is NOT "removida" (unless "mantida_manual")
 *
 * @param {Array<Object>} entries
 * @param {Array<Object>} categories
 * @returns {Array<Object>}
 * @private
 */
function _getVisibleEntries(entries, categories) {
  const activeCategoryIds = new Set(
    categories.filter(c => c.ativa).map(c => c.id)
  );

  return entries.filter(entry => {
    // Rule 1: category must be active
    if (!activeCategoryIds.has(entry.categoria)) {
      return false;
    }
    // Rule 2: entry must not be hidden
    if (entry.oculta === true || entry.oculta === 'TRUE') {
      return false;
    }
    // Rule 3: status must not be "removida" (except "mantida_manual")
    if (entry.status === 'removida') {
      return false;
    }
    return true;
  });
}

/**
 * Determines if an entry is mapped.
 * Mapped = status is 'mapeada' OR 'mantida_manual'.
 *
 * @param {Object} entry
 * @returns {boolean}
 * @private
 */
function _isMapped(entry) {
  return entry.status === 'mapeada' || entry.status === 'mantida_manual';
}

/**
 * Escapes HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 * @private
 */
function _escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


// ---------------------------------------------------------------------------
// Internal: Storage Info
// ---------------------------------------------------------------------------

/**
 * Loads storage information: total files count and size from Drive.
 * Scans all subfolders in "files/" (excluding novos/) to get mapped file sizes.
 * @private
 */
async function _loadStorageInfo() {
  const container = document.getElementById('dashboard-storage');
  if (!container) return;

  try {
    const config = loadConfig();
    if (!config.root_folder_id) {
      container.innerHTML = '<p class="text-muted">Pasta raiz não configurada.</p>';
      return;
    }

    const filesFolderId = await findFolder('files', config.root_folder_id);
    if (!filesFolderId) {
      container.innerHTML = '<p class="text-muted">Pasta "files/" não encontrada.</p>';
      return;
    }

    // Get all subfolders (categories)
    const subItems = await listFiles(filesFolderId);
    let totalFiles = 0;
    let totalSize = 0;
    const categoryStats = [];

    for (const item of subItems) {
      if (item.mimeType === 'application/vnd.google-apps.folder' && item.name !== 'novos') {
        const files = await listFiles(item.id);
        const folderFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
        const folderSize = folderFiles.reduce((sum, f) => sum + (parseInt(f.size) || 0), 0);
        totalFiles += folderFiles.length;
        totalSize += folderSize;

        if (folderFiles.length > 0) {
          categoryStats.push({
            name: item.name,
            count: folderFiles.length,
            size: folderSize
          });
        }
      }
    }

    // Also count files in "novos/"
    const novosFolderId = await findFolder('novos', filesFolderId);
    let novosCount = 0;
    let novosSize = 0;
    if (novosFolderId) {
      const novosFiles = await listFiles(novosFolderId);
      const novosActualFiles = novosFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
      novosCount = novosActualFiles.length;
      novosSize = novosActualFiles.reduce((sum, f) => sum + (parseInt(f.size) || 0), 0);
    }

    // Render
    let html = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
        <div class="card" style="padding: 1rem; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-primary);">${totalFiles}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted);">Arquivos mapeados</div>
        </div>
        <div class="card" style="padding: 1rem; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-primary);">${_formatSize(totalSize)}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted);">Tamanho total</div>
        </div>
        <div class="card" style="padding: 1rem; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-muted);">${novosCount}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted);">Sem match (novos/)</div>
        </div>
        <div class="card" style="padding: 1rem; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-muted);">${_formatSize(totalSize + novosSize)}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted);">Total geral</div>
        </div>
      </div>
    `;

    if (categoryStats.length > 0) {
      html += '<details><summary style="cursor:pointer; font-size:0.875rem; color:var(--color-text-secondary);">Detalhes por categoria</summary>';
      html += '<table style="width:100%; font-size:0.8rem; margin-top:0.5rem; border-collapse:collapse;">';
      html += '<tr style="border-bottom:1px solid var(--color-border);"><th style="text-align:left;padding:0.25rem;">Categoria</th><th style="text-align:right;padding:0.25rem;">Arquivos</th><th style="text-align:right;padding:0.25rem;">Tamanho</th></tr>';
      for (const stat of categoryStats.sort((a, b) => b.size - a.size)) {
        html += `<tr style="border-bottom:1px solid var(--color-border);"><td style="padding:0.25rem;">${_escapeHtml(stat.name)}</td><td style="text-align:right;padding:0.25rem;">${stat.count}</td><td style="text-align:right;padding:0.25rem;">${_formatSize(stat.size)}</td></tr>`;
      }
      html += '</table></details>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Erro ao calcular armazenamento: ${err.message}</p>`;
  }
}

/**
 * Formats bytes into human-readable size string.
 * @param {number} bytes
 * @returns {string}
 * @private
 */
function _formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
