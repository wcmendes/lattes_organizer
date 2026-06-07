/**
 * Config Module — Application Configuration Management
 * 
 * Manages application settings stored in localStorage with
 * Google Sheets as authoritative source (synced when online).
 * 
 * Lifecycle:
 * 1. Load from localStorage on startup (fast, immediate)
 * 2. Sync with Sheets asynchronously (Planilha is authoritative per Req 10.9)
 * 3. On change: localStorage immediate + debounced Sheets write (≤5s per Req 10.5)
 * 
 * Requirements: 10.5, 10.6, 10.9
 * @module config
 */

import { getRows, appendRows, updateRow } from './services/sheets.js';

const CONFIG_KEY = 'comprova_config';
const SHEET_NAME = 'config';
const DEBOUNCE_MAX_MS = 5000;

/** @type {import('./design').AppConfig} */
const DEFAULT_CONFIG = {
  threshold: 50,
  spreadsheet_id: null,
  root_folder_id: null
};

/** @type {number|null} debounce timer for Sheets persistence */
let _debounceTimer = null;

/** @type {number|null} timestamp of first pending change (to enforce ≤5s max) */
let _firstPendingChange = null;

/** @type {Array<function>} listeners notified on config save to Sheets */
let _saveListeners = [];

/**
 * Loads configuration from localStorage.
 * @returns {Object} AppConfig
 */
export function loadConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('[Config] Failed to parse stored config, using defaults', e);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Saves configuration to localStorage.
 * @param {Object} config
 */
export function saveConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('[Config] Failed to save config', e);
  }
}

/**
 * Returns current threshold value.
 * @returns {number}
 */
export function getThreshold() {
  return loadConfig().threshold;
}

/**
 * Returns current spreadsheet ID or null.
 * @returns {string|null}
 */
export function getSpreadsheetId() {
  return loadConfig().spreadsheet_id;
}

/**
 * Returns the root folder ID in Google Drive or null.
 * @returns {string|null}
 */
export function getRootFolderId() {
  return loadConfig().root_folder_id;
}

/**
 * Returns the default configuration.
 * @returns {Object}
 */
export function getDefaults() {
  return { ...DEFAULT_CONFIG };
}

/**
 * Reads configuration from the "config" sheet of the Planilha.
 * The sheet has columns: chave | valor
 * 
 * @param {string} spreadsheetId — ID of the Google Sheets spreadsheet
 * @returns {Promise<Object>} config key-value pairs from Sheets
 */
export async function loadFromSheets(spreadsheetId) {
  const rows = await getRows(spreadsheetId, SHEET_NAME);
  const config = {};

  for (const row of rows) {
    const key = row.chave;
    const rawValue = row.valor;

    if (!key) continue;

    // Deserialize value: numbers, booleans, null, or keep as string
    config[key] = deserializeValue(rawValue);
  }

  return config;
}

/**
 * Persists current config to the "config" sheet.
 * Overwrites existing rows by matching keys, appends new ones.
 * 
 * @param {string} spreadsheetId — ID of the Google Sheets spreadsheet
 * @returns {Promise<void>}
 */
export async function saveToSheets(spreadsheetId) {
  const config = loadConfig();
  const existingRows = await getRows(spreadsheetId, SHEET_NAME);

  // Build a map of existing keys to their row index (1-based, header=1)
  const existingKeyMap = new Map();
  for (let i = 0; i < existingRows.length; i++) {
    if (existingRows[i].chave) {
      existingKeyMap.set(existingRows[i].chave, i + 2); // +2: header is row 1, data starts at row 2
    }
  }

  const newRows = [];

  for (const [key, value] of Object.entries(config)) {
    const serialized = serializeValue(value);

    if (existingKeyMap.has(key)) {
      // Update existing row
      await updateRow(spreadsheetId, SHEET_NAME, existingKeyMap.get(key), {
        chave: key,
        valor: serialized
      });
    } else {
      // Queue for append
      newRows.push([key, serialized]);
    }
  }

  if (newRows.length > 0) {
    await appendRows(spreadsheetId, SHEET_NAME, newRows);
  }

  // Notify listeners
  _notifySaveListeners();
}

/**
 * Syncs local config with the "config" sheet.
 * Planilha values are authoritative in case of conflict (Req 10.9).
 * 
 * @param {string} spreadsheetId — ID of the Google Sheets spreadsheet
 * @returns {Promise<Object>} the resolved config after sync
 */
export async function syncWithSheets(spreadsheetId) {
  const localConfig = loadConfig();
  let sheetsConfig;

  try {
    sheetsConfig = await loadFromSheets(spreadsheetId);
  } catch (e) {
    console.warn('[Config] Failed to load from Sheets, keeping local values', e);
    return localConfig;
  }

  // If Sheets has no config data, push local config as initial state
  if (Object.keys(sheetsConfig).length === 0) {
    try {
      await saveToSheets(spreadsheetId);
    } catch (e) {
      console.warn('[Config] Failed to push initial config to Sheets', e);
    }
    return localConfig;
  }

  // Planilha is authoritative: merge Sheets values over local
  const resolved = { ...DEFAULT_CONFIG, ...localConfig };
  let hasConflict = false;

  for (const [key, sheetValue] of Object.entries(sheetsConfig)) {
    if (key in resolved && resolved[key] !== sheetValue) {
      hasConflict = true;
    }
    resolved[key] = sheetValue;
  }

  // Update localStorage to match Planilha
  saveConfig(resolved);

  if (hasConflict) {
    console.info('[Config] Conflict resolved: Planilha values used as authoritative');
  }

  return resolved;
}

/**
 * Updates a single config key.
 * Saves to localStorage immediately and debounces save to Sheets (≤5s max).
 * 
 * @param {string} key — config key to update
 * @param {*} value — new value
 * @returns {void}
 */
export function updateConfig(key, value) {
  const config = loadConfig();
  config[key] = value;

  // Persist to localStorage immediately (Req 10.5)
  saveConfig(config);

  // Schedule debounced save to Sheets (max 5s from first change)
  _scheduleSheetsWrite();
}

/**
 * Registers a listener to be called when config is saved to Sheets.
 * Useful for UI save indicators (Req 10.5).
 * 
 * @param {function} listener — callback invoked after successful Sheets save
 * @returns {function} unsubscribe function
 */
export function onSheetsSave(listener) {
  _saveListeners.push(listener);
  return () => {
    _saveListeners = _saveListeners.filter(l => l !== listener);
  };
}

/**
 * Forces immediate flush of pending config to Sheets.
 * Useful during page unload or explicit "save now" actions.
 * 
 * @returns {Promise<void>}
 */
export async function flushToSheets() {
  _clearDebounce();

  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) {
    console.warn('[Config] No spreadsheet ID configured, cannot flush to Sheets');
    return;
  }

  await saveToSheets(spreadsheetId);
}

// ─── Internal Helpers ────────────────────────────────────────────────

/**
 * Schedules a debounced write to Sheets.
 * Ensures the write happens within 5 seconds of the first pending change.
 * @private
 */
function _scheduleSheetsWrite() {
  const now = Date.now();

  // Track when the first pending change happened
  if (_firstPendingChange === null) {
    _firstPendingChange = now;
  }

  // Clear existing timer
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Calculate remaining time until the 5s deadline
  const elapsed = now - _firstPendingChange;
  const remaining = Math.max(0, DEBOUNCE_MAX_MS - elapsed);

  // If we've already exceeded the max window, flush immediately
  if (remaining === 0) {
    _executeSheetsWrite();
    return;
  }

  // Otherwise, schedule at the remaining time (or sooner if another change comes)
  _debounceTimer = setTimeout(() => {
    _executeSheetsWrite();
  }, remaining);
}

/**
 * Executes the actual Sheets write and resets debounce state.
 * @private
 */
async function _executeSheetsWrite() {
  _clearDebounce();

  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) {
    console.warn('[Config] No spreadsheet ID configured, skipping Sheets write');
    return;
  }

  try {
    await saveToSheets(spreadsheetId);
  } catch (e) {
    console.error('[Config] Failed to persist config to Sheets', e);
  }
}

/**
 * Clears the debounce timer and resets tracking state.
 * @private
 */
function _clearDebounce() {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _firstPendingChange = null;
}

/**
 * Notifies all save listeners.
 * @private
 */
function _notifySaveListeners() {
  for (const listener of _saveListeners) {
    try {
      listener();
    } catch (e) {
      console.error('[Config] Save listener error', e);
    }
  }
}

/**
 * Serializes a config value for storage in Sheets.
 * @param {*} value
 * @returns {string}
 * @private
 */
function serializeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Deserializes a value read from Sheets into its proper JS type.
 * @param {string} raw
 * @returns {*}
 * @private
 */
function deserializeValue(raw) {
  if (raw === '' || raw === undefined || raw === null) return null;
  if (raw === 'TRUE') return true;
  if (raw === 'FALSE') return false;

  // Try parsing as number
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;

  return raw;
}
