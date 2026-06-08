/**
 * Settings View — ComprovaLattes
 *
 * Provides configuration UI for:
 * - Threshold slider (0–100) for fuzzy matching confidence
 * - Spreadsheet ID (existing or auto-create)
 * - Root folder ID (existing or auto-create)
 * - Initial setup flow for first-time use
 * - Validation of IDs with error messaging
 * - Visual save indicator
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8
 * @module views/settings
 */

import { loadConfig, saveConfig } from '../config.js';
import { createSpreadsheet, getRows } from '../services/sheets.js';
import { createFolder, findFolder, moveFile } from '../services/drive.js';

/** @type {number|null} Debounce timer for save operations */
let saveTimer = null;

/** @type {boolean} Tracks whether initial setup is needed */
let isSetupMode = false;

/**
 * Renders the settings view HTML.
 * Detects if setup mode is needed (no spreadsheet_id or root_folder_id configured).
 * @returns {string} HTML string for the settings view
 */
export function render() {
  const config = loadConfig();
  isSetupMode = !config.spreadsheet_id || !config.root_folder_id;

  if (isSetupMode) {
    return renderSetupFlow(config);
  }

  return renderSettingsForm(config);
}

/**
 * Attaches event listeners after the settings view is rendered into the DOM.
 * Should be called after render() output is injected into #app.
 */
export function mount() {
  if (isSetupMode) {
    mountSetupFlow();
  } else {
    mountSettingsForm();
  }
}

// ---------------------------------------------------------------------------
// Setup Flow (first use — Req 10.6)
// ---------------------------------------------------------------------------

/**
 * Renders the initial setup flow for first-time configuration.
 * @param {Object} config - Current config
 * @returns {string} HTML string
 */
function renderSetupFlow(config) {
  return `
    <div class="container">
      <div class="settings-setup">
        <div class="card settings-setup__card">
          <div class="card__header">
            <h1 class="card__title">Configuração Inicial</h1>
          </div>
          <p class="settings-setup__intro">
            Bem-vindo ao ComprovaLattes! Configure onde seus dados serão armazenados.
          </p>

          <!-- Client ID Setup -->
          <div class="form-group mt-lg">
            <label class="form-label" for="setup-client-id">
              Client ID (Google OAuth2)
            </label>
            <p class="text-muted settings-setup__hint">
              Obtenha no Google Cloud Console → APIs e serviços → Credenciais → ID do cliente OAuth.
            </p>
            <input
              type="text"
              id="setup-client-id"
              class="form-input"
              placeholder="123456789-xxxxx.apps.googleusercontent.com"
              value="${config.client_id || ''}"
            />
          </div>

          <!-- Spreadsheet Setup -->
          <div class="form-group mt-lg">
            <label class="form-label" for="setup-spreadsheet-id">
              Planilha Google Sheets
            </label>
            <p class="text-muted settings-setup__hint">
              Informe o ID de uma planilha existente ou crie uma nova automaticamente.
            </p>
            <div class="settings-setup__row">
              <input
                type="text"
                id="setup-spreadsheet-id"
                class="form-input"
                placeholder="ID da planilha existente"
                value="${config.spreadsheet_id || ''}"
                aria-describedby="setup-spreadsheet-error"
              />
              <button id="btn-create-spreadsheet" class="btn btn--outline" type="button">
                Criar automaticamente
              </button>
            </div>
            <div id="setup-spreadsheet-error" class="settings__error hidden" role="alert" aria-live="polite"></div>
            <div id="setup-spreadsheet-success" class="settings__success hidden" role="status" aria-live="polite"></div>
          </div>

          <!-- Folder Setup -->
          <div class="form-group mt-lg">
            <label class="form-label" for="setup-folder-id">
              Pasta Raiz no Google Drive
            </label>
            <p class="text-muted settings-setup__hint">
              Informe o ID de uma pasta existente ou crie uma nova automaticamente.
            </p>
            <div class="settings-setup__row">
              <input
                type="text"
                id="setup-folder-id"
                class="form-input"
                placeholder="ID da pasta existente"
                value="${config.root_folder_id || ''}"
                aria-describedby="setup-folder-error"
              />
              <button id="btn-create-folder" class="btn btn--outline" type="button">
                Criar automaticamente
              </button>
            </div>
            <div id="setup-folder-error" class="settings__error hidden" role="alert" aria-live="polite"></div>
            <div id="setup-folder-success" class="settings__success hidden" role="status" aria-live="polite"></div>
          </div>

          <!-- Save setup -->
          <div class="mt-lg">
            <button id="btn-save-setup" class="btn btn--primary btn--lg" type="button" disabled>
              Salvar e começar
            </button>
            <span id="setup-save-indicator" class="settings__save-indicator hidden" role="status" aria-live="polite"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mounts event listeners for the setup flow.
 */
function mountSetupFlow() {
  const spreadsheetInput = document.getElementById('setup-spreadsheet-id');
  const folderInput = document.getElementById('setup-folder-id');
  const btnCreateSpreadsheet = document.getElementById('btn-create-spreadsheet');
  const btnCreateFolder = document.getElementById('btn-create-folder');
  const btnSaveSetup = document.getElementById('btn-save-setup');

  if (!spreadsheetInput || !folderInput || !btnCreateSpreadsheet || !btnCreateFolder || !btnSaveSetup) {
    return;
  }

  // Enable save button when both fields have values
  const checkSaveEnabled = () => {
    const clientIdInput = document.getElementById('setup-client-id');
    const hasClientId = clientIdInput && clientIdInput.value.trim();
    btnSaveSetup.disabled = !hasClientId;
  };

  const clientIdInput = document.getElementById('setup-client-id');
  if (clientIdInput) {
    clientIdInput.addEventListener('input', checkSaveEnabled);
  }
  spreadsheetInput.addEventListener('input', checkSaveEnabled);
  folderInput.addEventListener('input', checkSaveEnabled);
  checkSaveEnabled();

  // Create spreadsheet automatically
  btnCreateSpreadsheet.addEventListener('click', async () => {
    const errorEl = document.getElementById('setup-spreadsheet-error');
    const successEl = document.getElementById('setup-spreadsheet-success');

    // Validate: folder must be created/configured first
    if (!folderInput.value.trim()) {
      showError(errorEl, 'Crie ou configure a pasta raiz primeiro (abaixo).');
      return;
    }
    hideMessage(errorEl);
    hideMessage(successEl);
    btnCreateSpreadsheet.disabled = true;
    btnCreateSpreadsheet.textContent = 'Criando...';

    try {
      const spreadsheetId = await createSpreadsheet('ComprovaLattes', [
        { name: 'entradas', headers: ['id', 'titulo', 'instituicao', 'ano', 'carga_horaria', 'categoria', 'status', 'oculta', 'arquivo_drive_id', 'arquivo_nome', 'confianca', 'data_mapeamento', 'arquivo_hash'] },
        { name: 'categorias', headers: ['id', 'nome_xml', 'nome_display', 'ativa', 'pasta_drive_id'] },
        { name: 'config', headers: ['chave', 'valor'] }
      ]);

      // Move spreadsheet into ComprovaLattes folder (if folder exists or create it)
      try {
        let rootFolderId = folderInput.value.trim();
        if (!rootFolderId) {
          rootFolderId = await findFolder('ComprovaLattes', 'root');
          if (!rootFolderId) {
            rootFolderId = await createFolder('ComprovaLattes', 'root');
          }
          folderInput.value = rootFolderId;
          checkSaveEnabled();
        }
        await moveFile(spreadsheetId, 'root', rootFolderId);
      } catch (moveErr) {
        console.warn('[Settings] Não foi possível mover planilha para pasta:', moveErr.message);
      }

      spreadsheetInput.value = spreadsheetId;
      showSuccess(successEl, 'Planilha "ComprovaLattes" criada com sucesso.');
      checkSaveEnabled();
    } catch (error) {
      showError(errorEl, `Falha ao criar planilha: ${error.message}`);
    } finally {
      btnCreateSpreadsheet.disabled = false;
      btnCreateSpreadsheet.textContent = 'Criar automaticamente';
    }
  });

  // Create folder automatically
  btnCreateFolder.addEventListener('click', async () => {
    const errorEl = document.getElementById('setup-folder-error');
    const successEl = document.getElementById('setup-folder-success');
    hideMessage(errorEl);
    hideMessage(successEl);
    btnCreateFolder.disabled = true;
    btnCreateFolder.textContent = 'Criando...';

    try {
      // Check if folder already exists
      let folderId = await findFolder('ComprovaLattes', 'root');
      if (!folderId) {
        folderId = await createFolder('ComprovaLattes', 'root');
      }
      folderInput.value = folderId;
      showSuccess(successEl, 'Pasta "ComprovaLattes" criada com sucesso.');
      checkSaveEnabled();
    } catch (error) {
      showError(errorEl, `Falha ao criar pasta: ${error.message}`);
    } finally {
      btnCreateFolder.disabled = false;
      btnCreateFolder.textContent = 'Criar automaticamente';
    }
  });

  // Save setup
  btnSaveSetup.addEventListener('click', async () => {
    const clientIdVal = document.getElementById('setup-client-id').value.trim();
    const spreadsheetId = spreadsheetInput.value.trim();
    const folderId = folderInput.value.trim();
    const indicator = document.getElementById('setup-save-indicator');
    const spreadsheetError = document.getElementById('setup-spreadsheet-error');
    const folderError = document.getElementById('setup-folder-error');

    hideMessage(spreadsheetError);
    hideMessage(folderError);
    btnSaveSetup.disabled = true;

    // Save config (client_id is always saved, spreadsheet/folder are optional at this stage)
    const config = loadConfig();
    config.client_id = clientIdVal;
    if (spreadsheetId) config.spreadsheet_id = spreadsheetId;
    if (folderId) config.root_folder_id = folderId;
    saveConfig(config);

    // Initialize auth with the new client ID
    if (clientIdVal) {
      const { initAuth } = await import('../auth.js');
      initAuth({ clientId: clientIdVal });
    }

    showSaveIndicator(indicator, 'Salvo ✓ — Agora faça login com o Google');

    // Redirect to login after a brief delay
    setTimeout(() => {
      window.location.hash = '#login';
    }, 1500);
  });
}

// ---------------------------------------------------------------------------
// Normal Settings Form (Req 10.1, 10.2, 10.3, 10.4)
// ---------------------------------------------------------------------------

/**
 * Renders the normal settings form (post-setup).
 * @param {Object} config - Current config
 * @returns {string} HTML string
 */
function renderSettingsForm(config) {
  return `
    <div class="container">
      <div class="settings-view">
        <h1 class="settings-view__title">Configurações</h1>
        <span id="settings-save-indicator" class="settings__save-indicator hidden" role="status" aria-live="polite"></span>

        <!-- Threshold Slider (Req 10.2) -->
        <div class="card mt-lg">
          <div class="card__header">
            <h2 class="card__title">Threshold de Confiança</h2>
          </div>
          <p class="text-muted mb-md">
            Valor mínimo de similaridade para que uma sugestão de match seja apresentada.
          </p>
          <div class="form-group">
            <div class="settings__slider-row">
              <input
                type="range"
                id="settings-threshold"
                class="settings__slider"
                min="0"
                max="100"
                step="1"
                value="${config.threshold}"
                aria-label="Threshold de confiança"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="${config.threshold}"
              />
              <span id="settings-threshold-value" class="settings__slider-value">${config.threshold}%</span>
            </div>
          </div>
        </div>

        <!-- Spreadsheet ID (Req 10.3) -->
        <div class="card mt-lg">
          <div class="card__header">
            <h2 class="card__title">Planilha Google Sheets</h2>
          </div>
          <div class="form-group">
            <label class="form-label" for="settings-spreadsheet-id">
              ID da planilha
            </label>
            <div class="settings-setup__row">
              <input
                type="text"
                id="settings-spreadsheet-id"
                class="form-input"
                placeholder="ID da planilha"
                value="${config.spreadsheet_id || ''}"
                aria-describedby="settings-spreadsheet-error"
              />
              <button id="btn-settings-create-spreadsheet" class="btn btn--outline btn--sm" type="button">
                Criar nova
              </button>
            </div>
            <div id="settings-spreadsheet-error" class="settings__error hidden" role="alert" aria-live="polite"></div>
          </div>
        </div>

        <!-- Root Folder ID (Req 10.4) -->
        <div class="card mt-lg">
          <div class="card__header">
            <h2 class="card__title">Pasta Raiz no Google Drive</h2>
          </div>
          <div class="form-group">
            <label class="form-label" for="settings-folder-id">
              ID da pasta raiz
            </label>
            <div class="settings-setup__row">
              <input
                type="text"
                id="settings-folder-id"
                class="form-input"
                placeholder="ID da pasta raiz"
                value="${config.root_folder_id || ''}"
                aria-describedby="settings-folder-error"
              />
              <button id="btn-settings-create-folder" class="btn btn--outline btn--sm" type="button">
                Criar nova
              </button>
            </div>
            <div id="settings-folder-error" class="settings__error hidden" role="alert" aria-live="polite"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mounts event listeners for the normal settings form.
 */
function mountSettingsForm() {
  const thresholdSlider = document.getElementById('settings-threshold');
  const thresholdValue = document.getElementById('settings-threshold-value');
  const spreadsheetInput = document.getElementById('settings-spreadsheet-id');
  const folderInput = document.getElementById('settings-folder-id');
  const btnCreateSpreadsheet = document.getElementById('btn-settings-create-spreadsheet');
  const btnCreateFolder = document.getElementById('btn-settings-create-folder');
  const indicator = document.getElementById('settings-save-indicator');

  if (!thresholdSlider || !thresholdValue) {
    return;
  }

  // Threshold slider (Req 10.2)
  thresholdSlider.addEventListener('input', () => {
    const value = thresholdSlider.value;
    thresholdValue.textContent = `${value}%`;
    thresholdSlider.setAttribute('aria-valuenow', value);
    debouncedSave({ threshold: parseInt(value, 10) }, indicator);
  });

  // Spreadsheet ID change with validation (Req 10.3, 10.7)
  if (spreadsheetInput) {
    spreadsheetInput.addEventListener('change', async () => {
      const id = spreadsheetInput.value.trim();
      const errorEl = document.getElementById('settings-spreadsheet-error');
      hideMessage(errorEl);

      if (!id) return;

      const valid = await validateSpreadsheet(id, errorEl);
      if (valid) {
        debouncedSave({ spreadsheet_id: id }, indicator);
      }
    });
  }

  // Folder ID change with validation (Req 10.4, 10.7)
  if (folderInput) {
    folderInput.addEventListener('change', async () => {
      const id = folderInput.value.trim();
      const errorEl = document.getElementById('settings-folder-error');
      hideMessage(errorEl);

      if (!id) return;

      const valid = await validateFolder(id, errorEl);
      if (valid) {
        debouncedSave({ root_folder_id: id }, indicator);
      }
    });
  }

  // Create spreadsheet button
  if (btnCreateSpreadsheet) {
    btnCreateSpreadsheet.addEventListener('click', async () => {
      const errorEl = document.getElementById('settings-spreadsheet-error');
      hideMessage(errorEl);
      btnCreateSpreadsheet.disabled = true;
      btnCreateSpreadsheet.textContent = 'Criando...';

      try {
        const spreadsheetId = await createSpreadsheet('ComprovaLattes', [
          { name: 'entradas', headers: ['id', 'titulo', 'instituicao', 'ano', 'carga_horaria', 'categoria', 'status', 'oculta', 'arquivo_drive_id', 'arquivo_nome', 'confianca', 'data_mapeamento', 'arquivo_hash'] },
          { name: 'categorias', headers: ['id', 'nome_xml', 'nome_display', 'ativa', 'pasta_drive_id'] },
          { name: 'config', headers: ['chave', 'valor'] }
        ]);

        // Move spreadsheet into ComprovaLattes folder
        try {
          const config = loadConfig();
          let rootFolderId = config.root_folder_id;
          if (!rootFolderId) {
            rootFolderId = await findFolder('ComprovaLattes', 'root');
          }
          if (rootFolderId) {
            await moveFile(spreadsheetId, 'root', rootFolderId);
          }
        } catch (moveErr) {
          console.warn('[Settings] Não foi possível mover planilha para pasta:', moveErr.message);
        }

        spreadsheetInput.value = spreadsheetId;
        debouncedSave({ spreadsheet_id: spreadsheetId }, indicator);
      } catch (error) {
        showError(errorEl, `Falha ao criar planilha: ${error.message}`);
      } finally {
        btnCreateSpreadsheet.disabled = false;
        btnCreateSpreadsheet.textContent = 'Criar nova';
      }
    });
  }

  // Create folder button
  if (btnCreateFolder) {
    btnCreateFolder.addEventListener('click', async () => {
      const errorEl = document.getElementById('settings-folder-error');
      hideMessage(errorEl);
      btnCreateFolder.disabled = true;
      btnCreateFolder.textContent = 'Criando...';

      try {
        let folderId = await findFolder('ComprovaLattes', 'root');
        if (!folderId) {
          folderId = await createFolder('ComprovaLattes', 'root');
        }
        folderInput.value = folderId;
        debouncedSave({ root_folder_id: folderId }, indicator);
      } catch (error) {
        showError(errorEl, `Falha ao criar pasta: ${error.message}`);
      } finally {
        btnCreateFolder.disabled = false;
        btnCreateFolder.textContent = 'Criar nova';
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (Req 10.7)
// ---------------------------------------------------------------------------

/**
 * Validates access to a spreadsheet by attempting to read from it.
 * @param {string} spreadsheetId - Spreadsheet ID to validate
 * @param {HTMLElement} errorEl - Element to show error message
 * @returns {Promise<boolean>} true if accessible
 */
async function validateSpreadsheet(spreadsheetId, errorEl) {
  try {
    await getRows(spreadsheetId, 'config');
    return true;
  } catch (error) {
    if (error.message.includes('Permissão negada') || error.message.includes('403')) {
      showError(errorEl, 'Planilha inacessível. Verifique se você tem permissão de acesso.');
    } else {
      showError(errorEl, 'ID de planilha inválido ou inacessível. Verifique o ID informado.');
    }
    return false;
  }
}

/**
 * Validates access to a Drive folder by attempting to list its contents.
 * Uses the Drive API to check folder existence and access.
 * @param {string} folderId - Folder ID to validate
 * @param {HTMLElement} errorEl - Element to show error message
 * @returns {Promise<boolean>} true if accessible
 */
async function validateFolder(folderId, errorEl) {
  try {
    // Import listFiles dynamically for validation
    const { listFiles } = await import('../services/drive.js');
    await listFiles(folderId);
    return true;
  } catch (error) {
    if (error.message.includes('403') || error.message.includes('denied')) {
      showError(errorEl, 'Pasta inacessível. Verifique se você tem permissão de acesso.');
    } else {
      showError(errorEl, 'ID de pasta inválido ou inacessível. Verifique o ID informado.');
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistence helpers (Req 10.5, 10.8)
// ---------------------------------------------------------------------------

/**
 * Debounced save: persists config to localStorage immediately and
 * schedules a save to Google Sheets (within 5 seconds).
 * Shows visual save indicator.
 * @param {Object} updates - Partial config to merge
 * @param {HTMLElement} indicator - Save indicator element
 */
function debouncedSave(updates, indicator) {
  // Save to localStorage immediately
  const config = loadConfig();
  const updatedConfig = { ...config, ...updates };
  saveConfig(updatedConfig);

  // Show saving indicator
  showSaveIndicator(indicator, 'Salvando...');

  // Debounce sheets persistence (5 second window)
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(async () => {
    try {
      await persistConfigToSheets(updatedConfig);
      showSaveIndicator(indicator, 'Salvo ✓');
    } catch (error) {
      // Req 10.8: keep localStorage as fallback on sheets failure
      showSaveIndicator(indicator, 'Salvo localmente (falha na planilha)');
      console.warn('[Settings] Falha ao persistir na planilha:', error.message);
    }

    // Hide indicator after 3 seconds
    setTimeout(() => {
      hideSaveIndicator(indicator);
    }, 3000);
  }, 2000);
}

/**
 * Persists config values to the "config" sheet in Google Sheets.
 * Writes each key-value pair as a row.
 * @param {Object} config - Full config object
 * @returns {Promise<void>}
 */
async function persistConfigToSheets(config) {
  const spreadsheetId = config.spreadsheet_id;
  if (!spreadsheetId) return;

  const { appendRows } = await import('../services/sheets.js');

  // Read existing config rows
  let existingRows = [];
  try {
    existingRows = await getRows(spreadsheetId, 'config');
  } catch (e) {
    // If config sheet doesn't exist or is empty, we'll just append
  }

  // Build updates: threshold, root_folder_id
  const configEntries = [
    ['threshold', String(config.threshold)],
    ['root_folder_id', config.root_folder_id || ''],
    ['spreadsheet_id', config.spreadsheet_id || '']
  ];

  if (existingRows.length === 0) {
    // Append all config rows
    await appendRows(spreadsheetId, 'config', configEntries);
  } else {
    // Update existing rows via batch
    const { batchUpdate } = await import('../services/sheets.js');
    const updates = configEntries.map((entry, index) => ({
      range: `config!A${index + 2}:B${index + 2}`,
      values: [entry]
    }));
    await batchUpdate(spreadsheetId, updates);
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Shows an error message in the given element.
 * @param {HTMLElement} el
 * @param {string} message
 */
function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.add('settings__error--visible');
}

/**
 * Shows a success message in the given element.
 * @param {HTMLElement} el
 * @param {string} message
 */
function showSuccess(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Hides a message element.
 * @param {HTMLElement} el
 */
function hideMessage(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
  el.classList.remove('settings__error--visible');
}

/**
 * Shows the save indicator with a message.
 * @param {HTMLElement} el
 * @param {string} message
 */
function showSaveIndicator(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Hides the save indicator.
 * @param {HTMLElement} el
 */
function hideSaveIndicator(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.textContent = '';
}
