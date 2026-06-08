/**
 * Import View — ComprovaLattes
 *
 * Provides "Importar XML" button with file validation (.xml, ≤ 20MB),
 * and "Importar Comprovantes" button with batch upload + auto-match pipeline.
 * Overlay with spinner/timer/counter during processing.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.5, 4.6, 4.7
 * @module views/import
 */

import { validateFile, parseXml, categorySlug } from '../core/xml-parser.js';
import { saveEntries, uploadXmlFile, loadEntries } from '../core/entry-manager.js';
import { loadCategories } from '../core/category-manager.js';
import { showOverlay, updateOverlay, hideOverlay } from '../ui/overlay.js';
import { showSuccess, showError } from '../ui/toast.js';
import { loadConfig } from '../config.js';
import { extractText } from '../core/text-extractor.js';
import { findBestMatch, findBestSnippet } from '../core/matcher.js';
import { uploadFile, moveFile, renameFile, findFolder, createFolder, listFiles } from '../services/drive.js';
import { updateRow } from '../services/sheets.js';
import { addToReviewQueue } from '../core/review-queue.js';
import { computeFileHash } from '../core/hash-utils.js';
import { showInfo } from '../ui/toast.js';

/** Max files per batch upload */
const MAX_FILES = 20;

/** Max file size in bytes (10 MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Accepted file extensions */
const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];

/**
 * Renders the import view HTML.
 * Contains the "Importar XML" button, "Importar Comprovantes" button, and hidden file inputs.
 * @returns {string} HTML string for the import view
 */
export function render() {
  return `
    <div class="container">
      <div class="import-view">
        <h1 class="import-view__title">Importação de XML Lattes</h1>
        <p class="import-view__description">
          Selecione o arquivo XML do seu Currículo Lattes para importar suas atividades acadêmicas.
        </p>

        <div class="import-view__actions">
          <button id="btn-import-xml" class="btn btn--primary btn--lg" type="button">
            Importar XML
          </button>
          <input
            type="file"
            id="input-xml-file"
            accept=".xml"
            class="hidden"
            aria-hidden="true"
          />
        </div>

        <div class="import-view__info">
          <p class="text-muted">
            Formatos aceitos: <strong>.xml</strong> — Tamanho máximo: <strong>20 MB</strong>
          </p>
          <p class="text-muted">
            O arquivo será parseado localmente no navegador usando codificação ISO-8859-1.
          </p>
        </div>

        <hr class="import-view__divider" />

        <h2 class="import-view__title">Upload de Comprovantes</h2>
        <p class="import-view__description">
          Selecione até 20 comprovantes (PDF, JPG, PNG) para upload e associação automática.
        </p>

        <div class="import-view__dropzone" id="comprovantes-dropzone">
          <div class="import-view__actions">
            <button id="btn-import-comprovantes" class="btn btn--secondary btn--lg" type="button">
              Importar Comprovantes
            </button>
            <input
              type="file"
              id="input-comprovantes-files"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              class="hidden"
              aria-hidden="true"
            />
          </div>
          <p class="text-muted mt-sm">ou arraste os arquivos aqui</p>
        </div>

        <div class="import-view__info">
          <p class="text-muted">
            Formatos aceitos: <strong>PDF, JPG, PNG</strong> — Tamanho máximo: <strong>10 MB</strong> por arquivo — Máximo: <strong>20 arquivos</strong>
          </p>
          <p class="text-muted">
            Após o upload, cada arquivo será processado para associação automática com suas entradas Lattes.
          </p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Attaches event listeners after the import view is rendered into the DOM.
 * Should be called after render() output is injected into #app.
 */
export function mount() {
  const importBtn = document.getElementById('btn-import-xml');
  const fileInput = document.getElementById('input-xml-file');

  if (importBtn && fileInput) {
    // Click "Importar XML" → open file dialog
    importBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    // File selected → start import flow
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      await handleImport(file);
    });
  }

  // Comprovantes upload
  const comprovantesBtn = document.getElementById('btn-import-comprovantes');
  const comprovantesInput = document.getElementById('input-comprovantes-files');

  if (comprovantesBtn && comprovantesInput) {
    comprovantesBtn.addEventListener('click', () => {
      comprovantesInput.value = '';
      comprovantesInput.click();
    });

    comprovantesInput.addEventListener('change', async () => {
      const files = comprovantesInput.files;
      if (!files || files.length === 0) return;
      await handleComprovantesUpload(files);
    });
  }

  // Drag-and-drop for comprovantes
  const dropzone = document.getElementById('comprovantes-dropzone');
  if (dropzone) {
    let dragCounter = 0;

    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      dropzone.classList.add('import-view__dropzone--active');
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropzone.classList.remove('import-view__dropzone--active');
      }
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropzone.classList.remove('import-view__dropzone--active');
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await handleComprovantesUpload(files);
      }
    });
  }
}

// ===========================================================================
// XML Import Pipeline (existing functionality)
// ===========================================================================

/**
 * Orchestrates the full XML import pipeline.
 *
 * @param {File} file — The selected XML file
 */
async function handleImport(file) {
  // Step 1: Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    showError(validation.error);
    return;
  }

  // Step 2: Read file content with ISO-8859-1 encoding
  let content;
  try {
    content = await readFileAsText(file, 'ISO-8859-1');
  } catch (error) {
    showError('Erro ao ler o arquivo. Tente novamente.');
    return;
  }

  // Step 3: Show overlay
  showOverlay('Importando XML...');

  try {
    // Step 4: Parse XML
    updateOverlay({ detail: 'Parseando XML...' });
    const parseResult = parseXml(content);

    // Step 5: Check for parse errors
    if (parseResult.errors.length > 0 && parseResult.entries.length === 0) {
      hideOverlay();
      showError(parseResult.errors[0]);
      return;
    }

    const totalEntries = parseResult.entries.length;
    const totalCategories = parseResult.categories.length;

    if (totalEntries === 0) {
      hideOverlay();
      showError('Nenhuma entrada acadêmica encontrada no XML.');
      return;
    }

    // Step 6: Save entries (merge if reimporting)
    const config = loadConfig();
    const spreadsheetId = config.spreadsheet_id;
    const rootFolderId = config.root_folder_id;

    if (!spreadsheetId) {
      hideOverlay();
      showError('Planilha não configurada. Acesse as configurações primeiro.');
      return;
    }

    updateOverlay({ detail: `0 de ${totalEntries} entradas processadas` });

    // Load existing entries and categories for merge
    let existingEntries = [];
    let existingCategories = [];
    try {
      existingEntries = await loadEntries(spreadsheetId);
      existingCategories = await loadCategories(spreadsheetId);
    } catch (error) {
      // First import — no existing data
      console.info('[Import] No existing data found, proceeding with fresh import.');
    }

    // Merge or save entries
    let savedCount = 0;
    const onProgress = (processed) => {
      savedCount = processed;
      updateOverlay({ detail: `${processed} de ${totalEntries} entradas processadas` });
    };

    await saveEntries(
      parseResult.entries,
      parseResult.categories,
      spreadsheetId,
      existingEntries,
      existingCategories,
      onProgress
    );

    // Step 7: Upload XML file to Drive
    if (rootFolderId) {
      updateOverlay({ detail: 'Enviando XML para o Drive...' });
      try {
        await uploadXmlFile(file, rootFolderId);
      } catch (error) {
        // Non-blocking: show toast but continue
        console.warn('[Import] Failed to upload XML to Drive:', error.message);
        showError(`Falha ao enviar XML para o Drive: ${error.message}`);
      }
    }

    // Step 8: Categories are saved as part of saveEntries
    updateOverlay({ detail: 'Finalizando importação...' });

    // Step 9: Success
    hideOverlay();

    // Build summary message
    const summary = buildXmlSummary(totalEntries, totalCategories, parseResult.errors);
    showSuccess(summary);

  } catch (error) {
    hideOverlay();
    showError(`Erro na importação: ${error.message}`);
    console.error('[Import] Import failed:', error);
  }
}

// ===========================================================================
// Comprovantes Upload Pipeline (new functionality)
// ===========================================================================

/**
 * Orchestrates the batch upload + auto-match pipeline for comprovantes.
 *
 * Flow:
 * 1. Validate files (count, type, size)
 * 2. Show overlay
 * 3. Upload each file to "files/novos/" in Drive
 * 4. For each uploaded file: extract text → calculate scores → classify match
 * 5. Based on classification: auto-accept, add to review queue, or leave in novos/
 * 6. Show final summary
 *
 * @param {FileList} fileList — selected files from input
 */
async function handleComprovantesUpload(fileList) {
  const files = Array.from(fileList);

  // Step 1: Validate file count
  if (files.length > MAX_FILES) {
    showError(`Máximo de ${MAX_FILES} arquivos por vez. Você selecionou ${files.length}.`);
    return;
  }

  // Step 1b: Validate each file (type + size)
  const validFiles = [];
  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      showError(`Arquivo "${file.name}" não é um formato aceito (PDF, JPG, PNG).`);
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      showError(`Arquivo "${file.name}" excede 10 MB.`);
      continue;
    }
    validFiles.push(file);
  }

  if (validFiles.length === 0) {
    return;
  }

  // Load config
  const config = loadConfig();
  const spreadsheetId = config.spreadsheet_id;
  const rootFolderId = config.root_folder_id;
  const threshold = config.threshold || 50;

  if (!spreadsheetId) {
    showError('Planilha não configurada. Acesse as configurações primeiro.');
    return;
  }

  if (!rootFolderId) {
    showError('Pasta raiz não configurada. Acesse as configurações primeiro.');
    return;
  }

  // Step 2: Show overlay
  showOverlay('Importando comprovantes...');
  const totalFiles = validFiles.length;

  // Counters for final summary
  let uploaded = 0;
  let autoMatched = 0;
  let failed = 0;

  try {
    // Ensure "files/novos/" folder exists
    const novosFolderId = await ensureNovosFolder(rootFolderId);

    // Check for duplicates: list existing files in novos/
    const existingFiles = await listFiles(novosFolderId);

    // Load candidates (entries from Sheets)
    const entries = await loadEntries(spreadsheetId);
    const categories = await loadCategories(spreadsheetId);

    // Build hash map from existing mapped entries for SHA-256 duplicate detection
    const existingHashes = new Map(); // hash → entry titulo
    for (const entry of entries) {
      if (entry.arquivo_hash) {
        existingHashes.set(entry.arquivo_hash, entry.titulo);
      }
    }

    // Step 3+4: Process each file sequentially
    for (let i = 0; i < totalFiles; i++) {
      const file = validFiles[i];
      const fileIndex = i + 1;

      // Skip duplicates: check by name + size as fast pre-filter
      const isDuplicate = existingFiles.some(f =>
        f.name === file.name && (f.size === undefined || f.size === String(file.size))
      );
      if (isDuplicate) {
        showInfo(`Arquivo duplicado ignorado: ${file.name}`);
        continue;
      }

      // SHA-256 hash-based duplicate detection (definitive check)
      let fileHash = '';
      try {
        fileHash = await computeFileHash(file);
      } catch (hashError) {
        console.warn(`[Import] Could not compute hash for "${file.name}":`, hashError);
      }
      if (fileHash && existingHashes.has(fileHash)) {
        showInfo(`Duplicado (já em: "${existingHashes.get(fileHash)}"). Ignorado: ${file.name}`);
        continue;
      }

      updateOverlay({
        message: `Processando arquivo ${fileIndex} de ${totalFiles}`,
        detail: file.name
      });

      try {
        // Step 3: Upload file to "files/novos/"
        const uploadResult = await uploadFile(file, novosFolderId);
        uploaded++;

        // Step 4: Auto-match pipeline
        await processAutoMatch(
          file,
          uploadResult,
          entries,
          categories,
          threshold,
          novosFolderId,
          spreadsheetId,
          rootFolderId,
          () => { autoMatched++; },
          fileHash
        );

        // Add hash to the map so subsequent files in the batch are also checked
        if (fileHash) {
          existingHashes.set(fileHash, file.name);
        }

      } catch (error) {
        // Step 5 (per-file error): toast + continue
        failed++;
        showError(`Falha em "${file.name}": ${error.message}`);
        console.error(`[Import] File "${file.name}" failed:`, error);
      }
    }
  } catch (error) {
    hideOverlay();
    showError(`Erro no processamento: ${error.message}`);
    console.error('[Import] Batch processing failed:', error);
    return;
  }

  // Step 6: Hide overlay and show final summary
  hideOverlay();
  const summaryMsg = `${uploaded} enviado${uploaded !== 1 ? 's' : ''}, ${autoMatched} associado${autoMatched !== 1 ? 's' : ''} via auto-match, ${failed} com falha`;
  showSuccess(summaryMsg);
}

/**
 * Processes auto-match for a single uploaded file.
 *
 * Steps:
 * a. Read file content (local File object)
 * b. Extract text using text-extractor
 * c. Get eligible candidates (active categories, not hidden, not mapped)
 * d. Call findBestMatch with extracted text, candidates, and threshold
 * e. Based on result: auto_accept, review, or no_match
 *
 * @param {File} file — original File object
 * @param {{id: string, name: string}} uploadResult — Drive upload result
 * @param {Array<Object>} entries — all entries from Sheets
 * @param {Array<Object>} categories — all categories from Sheets
 * @param {number} threshold — match threshold (0–100)
 * @param {string} novosFolderId — Drive folder ID for "novos/"
 * @param {string} spreadsheetId — Sheets spreadsheet ID
 * @param {string} rootFolderId — Drive root folder ID
 * @param {function} onAutoMatch — callback when auto-match succeeds
 * @param {string} fileHash — SHA-256 hash of the file
 */
async function processAutoMatch(
  file,
  uploadResult,
  entries,
  categories,
  threshold,
  novosFolderId,
  spreadsheetId,
  rootFolderId,
  onAutoMatch,
  fileHash
) {
  // a. Read file content from the local File object
  let fileData;
  try {
    fileData = await file.arrayBuffer();
  } catch (error) {
    console.warn(`[Import] Cannot read file "${file.name}" for text extraction:`, error);
    return; // Leave in novos/
  }

  // b. Extract text
  let extractedText;
  try {
    const mimeType = file.type || guessMimeType(file.name);
    extractedText = await extractText(fileData, mimeType);
  } catch (error) {
    // Req 4.9: maintain file in "novos/", show toast
    showError(`Extração de texto falhou para "${file.name}": ${error.message}`);
    console.warn(`[Import] Text extraction failed for "${file.name}":`, error);
    return; // Leave in novos/
  }

  // c. Get eligible candidates: active categories, not hidden, not mapped
  const activeCategoryIds = new Set(
    categories.filter(c => c.ativa).map(c => c.id)
  );

  const candidates = entries.filter(entry => {
    if (!activeCategoryIds.has(entry.categoria)) return false;
    if (entry.oculta === true || entry.oculta === 'TRUE') return false;
    if (entry.status === 'mapeada' || entry.status === 'mantida_manual') return false;
    if (entry.status === 'removida') return false;
    return true;
  });

  if (candidates.length === 0) {
    // No eligible candidates, leave file in novos/
    return;
  }

  // d. Call findBestMatch
  const matchResult = findBestMatch(extractedText, candidates, threshold);

  // e. Based on result
  switch (matchResult.status) {
    case 'auto_accepted':
      await handleAutoAccept(
        uploadResult,
        matchResult,
        extractedText,
        entries,
        categories,
        novosFolderId,
        spreadsheetId,
        rootFolderId,
        file.name,
        fileHash
      );
      onAutoMatch();
      break;

    case 'review':
      handleReview(uploadResult, matchResult, extractedText, file.name);
      break;

    case 'no_match':
    default:
      // Leave file in "novos/"
      break;
  }
}

/**
 * Handles auto-accepted match: save mapping in Sheets, move file to category folder, rename.
 *
 * @param {{id: string, name: string}} uploadResult — uploaded file info
 * @param {Object} matchResult — from findBestMatch
 * @param {string} extractedText — extracted text
 * @param {Array<Object>} entries — all entries
 * @param {Array<Object>} categories — all categories
 * @param {string} novosFolderId — source folder ID
 * @param {string} spreadsheetId — Sheets ID
 * @param {string} rootFolderId — Drive root folder ID
 * @param {string} originalFileName — original file name
 * @param {string} fileHash — SHA-256 hash of the file
 */
async function handleAutoAccept(
  uploadResult,
  matchResult,
  extractedText,
  entries,
  categories,
  novosFolderId,
  spreadsheetId,
  rootFolderId,
  originalFileName,
  fileHash
) {
  const entry = matchResult.bestMatch;
  const score = matchResult.score;

  // Find the entry's category
  const category = categories.find(c => c.id === entry.categoria);
  if (!category) {
    // Cannot resolve category, fall back to review
    handleReview({ id: uploadResult.id, name: uploadResult.name }, matchResult, extractedText, originalFileName);
    return;
  }

  // Ensure category folder exists
  let categoryFolderId = category.pasta_drive_id;
  if (!categoryFolderId) {
    // Create category folder
    let filesFolderId = await findFolder('files', rootFolderId);
    if (!filesFolderId) {
      filesFolderId = await createFolder('files', rootFolderId);
    }
    const slug = categorySlug(category.nome_xml);
    categoryFolderId = await findFolder(slug, filesFolderId);
    if (!categoryFolderId) {
      categoryFolderId = await createFolder(slug, filesFolderId);
    }
  }

  // Generate new file name: "ANO_categoria_INSTITUICAO_Titulo.ext"
  const ext = getFileExtension(originalFileName);
  const newName = formatAutoMatchFileName(entry, category, ext);

  // Move file from novos/ to category folder
  await moveFile(uploadResult.id, novosFolderId, categoryFolderId);

  // Rename file
  await renameFile(uploadResult.id, newName);

  // Save mapping in Sheets
  const entryIndex = entries.findIndex(e => e.id === entry.id);
  if (entryIndex !== -1) {
    const rowIndex = entryIndex + 2; // 1-based, header = row 1
    await updateRow(spreadsheetId, 'entradas', rowIndex, {
      id: entry.id,
      titulo: entry.titulo,
      instituicao: entry.instituicao,
      ano: entry.ano,
      carga_horaria: entry.carga_horaria,
      categoria: entry.categoria,
      status: 'mapeada',
      oculta: entry.oculta === true ? 'TRUE' : 'FALSE',
      arquivo_drive_id: uploadResult.id,
      arquivo_nome: newName,
      confianca: String(score),
      data_mapeamento: new Date().toISOString().split('T')[0],
      arquivo_hash: fileHash || ''
    });

    // Update local entry state for subsequent files in the batch
    entries[entryIndex].status = 'mapeada';
    entries[entryIndex].arquivo_drive_id = uploadResult.id;
    entries[entryIndex].arquivo_nome = newName;
    entries[entryIndex].confianca = score;
    entries[entryIndex].data_mapeamento = new Date().toISOString().split('T')[0];
    entries[entryIndex].arquivo_hash = fileHash || '';
  }
}

/**
 * Handles review match: add to review queue.
 *
 * @param {{id: string, name: string}} uploadResult — uploaded file info
 * @param {Object} matchResult — from findBestMatch
 * @param {string} extractedText — extracted text
 * @param {string} originalFileName — original file name
 */
function handleReview(uploadResult, matchResult, extractedText, originalFileName) {
  const entry = matchResult.bestMatch;
  const reference = entry ? entry.titulo : '';

  // Get best snippet and highlight words
  const { snippet, highlightWords } = findBestSnippet(extractedText, reference);

  addToReviewQueue({
    fileId: uploadResult.id,
    fileName: originalFileName,
    suggestedEntry: entry,
    score: matchResult.score,
    extractedText,
    snippet,
    highlightWords
  });
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Ensures the "files/novos/" folder exists in Drive.
 * @param {string} rootFolderId — root folder ID
 * @returns {Promise<string>} folder ID of "novos/"
 */
async function ensureNovosFolder(rootFolderId) {
  let filesFolderId = await findFolder('files', rootFolderId);
  if (!filesFolderId) {
    filesFolderId = await createFolder('files', rootFolderId);
  }

  let novosFolderId = await findFolder('novos', filesFolderId);
  if (!novosFolderId) {
    novosFolderId = await createFolder('novos', filesFolderId);
  }

  return novosFolderId;
}

/**
 * Formats file name for auto-accepted matches.
 * Pattern: "ANO_categoria_INSTITUICAO_Titulo.ext"
 * Max 200 chars, ASCII-safe.
 *
 * @param {Object} entry — LattesEntry
 * @param {Object} category — Category object
 * @param {string} ext — file extension (e.g., ".pdf")
 * @returns {string} formatted file name
 */
function formatAutoMatchFileName(entry, category, ext) {
  const ano = entry.ano || 'XXXX';
  const tipo = toAsciiSafe(category.nome_display || category.nome_xml || 'categoria');
  const instituicao = toAsciiSafe(entry.instituicao || 'instituicao');
  const titulo = toAsciiSafe(entry.titulo || 'titulo');

  // Build name with max 200 chars including extension
  const maxNameLength = 200 - ext.length;
  let name = `${ano}_${tipo}_${instituicao}_${titulo}`;

  // Truncate if needed
  if (name.length > maxNameLength) {
    name = name.substring(0, maxNameLength);
  }

  return name + ext;
}

/**
 * Converts a string to ASCII-safe filename characters.
 * Removes diacritics, replaces spaces and special chars with underscores.
 *
 * @param {string} str — input string
 * @returns {string} ASCII-safe string
 */
function toAsciiSafe(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-zA-Z0-9\s_-]/g, '') // Keep only alphanumeric, spaces, underscores, hyphens
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Trim leading/trailing underscores
    .trim();
}

/**
 * Gets file extension from filename (including dot).
 * @param {string} fileName
 * @returns {string} e.g., ".pdf"
 */
function getFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.substring(lastDot).toLowerCase();
}

/**
 * Guesses MIME type from file extension.
 * @param {string} fileName
 * @returns {string} MIME type
 */
function guessMimeType(fileName) {
  const ext = getFileExtension(fileName);
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

/**
 * Reads a File object as text with the specified encoding.
 *
 * @param {File} file — File to read
 * @param {string} encoding — Character encoding (e.g., 'ISO-8859-1')
 * @returns {Promise<string>} File content as string
 */
function readFileAsText(file, encoding) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(new Error('Falha ao ler o arquivo.'));
    };

    reader.readAsText(file, encoding);
  });
}

/**
 * Builds a human-readable summary message for the XML import result.
 *
 * @param {number} totalEntries — Total entries parsed
 * @param {number} totalCategories — Total categories discovered
 * @param {string[]} warnings — Parse warnings (non-critical)
 * @returns {string} Summary message
 */
function buildXmlSummary(totalEntries, totalCategories, warnings) {
  let msg = `Importação concluída: ${totalEntries} entrada${totalEntries !== 1 ? 's' : ''} em ${totalCategories} categoria${totalCategories !== 1 ? 's' : ''}.`;

  if (warnings.length > 0) {
    msg += ` (${warnings.length} aviso${warnings.length !== 1 ? 's' : ''})`;
  }

  return msg;
}
