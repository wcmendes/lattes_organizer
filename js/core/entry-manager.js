/**
 * entry-manager.js — Gerenciamento de Entradas e Mapeamentos
 *
 * Responsável por:
 * - Salvar entradas extraídas do XML na aba "entradas" da Planilha
 * - Reimportação: identificar por titulo+instituicao+ano+categoria,
 *   preservar mapeamentos existentes, adicionar novas, marcar ausentes como "removida"
 * - Upload do XML para pasta "ComprovaLattes/xml/"
 * - Carregar entradas da Planilha para objetos LattesEntry
 *
 * Requirements: 2.7, 2.8, 2.9, 16.1
 */

import { getRows, appendRows, batchUpdate } from '../services/sheets.js';
import { uploadFile, findFolder, createFolder } from '../services/drive.js';
import { loadConfig } from '../config.js';

const ENTRIES_SHEET = 'entradas';
const CATEGORIES_SHEET = 'categorias';

/**
 * Colunas da aba "entradas" na ordem correta (header row).
 * Usada para serializar objetos em arrays de valores.
 */
const ENTRY_COLUMNS = [
  'id', 'titulo', 'instituicao', 'ano', 'carga_horaria',
  'categoria', 'status', 'oculta', 'arquivo_drive_id',
  'arquivo_nome', 'confianca', 'data_mapeamento'
];

/**
 * Colunas da aba "categorias" na ordem correta (header row).
 */
const CATEGORY_COLUMNS = [
  'id', 'nome_xml', 'nome_display', 'ativa', 'pasta_drive_id'
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Salva entradas e categorias na Planilha.
 *
 * Se a planilha já contém dados existentes, executa merge (reimportação).
 * Se está vazia, faz append direto.
 *
 * @param {Array<Object>} entries — entradas extraídas do XML (LattesEntry[])
 * @param {Array<Object>} categories — categorias extraídas (Category[])
 * @param {string} spreadsheetId — ID da planilha
 * @returns {Promise<{entries: Array<Object>, categories: Array<Object>}>} dados salvos/mergeados
 */
export async function saveEntries(entries, categories, spreadsheetId) {
  // Carregar dados existentes da planilha
  const existingEntries = await loadEntries(spreadsheetId);
  const existingCategories = await _loadCategories(spreadsheetId);

  // Merge categorias: preservar existentes, adicionar novas
  const mergedCategories = _mergeCategories(existingCategories, categories);

  // Remontar mapa de categorias para resolver IDs durante merge de entradas
  const categoryMap = _buildCategoryMap(mergedCategories);

  // Resolver IDs de categoria nas novas entradas usando o mapa merged
  const resolvedEntries = _resolveCategoryIds(entries, categories, categoryMap);

  // Se há entradas existentes, fazer merge (reimportação)
  let finalEntries;
  if (existingEntries.length > 0) {
    finalEntries = mergeEntries(existingEntries, resolvedEntries);
  } else {
    finalEntries = resolvedEntries;
  }

  // Persistir categorias na planilha
  await _saveCategoriesToSheet(mergedCategories, spreadsheetId);

  // Persistir entradas na planilha
  await _saveEntriesToSheet(finalEntries, spreadsheetId);

  return { entries: finalEntries, categories: mergedCategories };
}

/**
 * Lógica de merge para reimportação (Property 3).
 *
 * Identifica entradas existentes pela chave composta:
 *   titulo + instituicao + ano + categoria
 *
 * Regras:
 * 1. Entradas que existem tanto no antigo quanto no novo:
 *    → preserva mapeamentos existentes (arquivo_drive_id, arquivo_nome,
 *      confianca, data_mapeamento, status se "mapeada")
 * 2. Entradas novas (não no antigo): adiciona com status "pendente"
 * 3. Entradas antigas ausentes no novo XML: marca status = "removida"
 *    (preserva dados, não deleta — Req 16.1)
 *
 * @param {Array<Object>} existingEntries — entradas atuais na planilha
 * @param {Array<Object>} newEntries — entradas extraídas do novo XML
 * @returns {Array<Object>} entradas mergeadas
 */
export function mergeEntries(existingEntries, newEntries) {
  // Indexar entradas existentes pela chave composta
  const existingByKey = new Map();
  for (const entry of existingEntries) {
    const key = _entryKey(entry);
    existingByKey.set(key, entry);
  }

  // Indexar novas entradas pela chave
  const newByKey = new Map();
  for (const entry of newEntries) {
    const key = _entryKey(entry);
    newByKey.set(key, entry);
  }

  const merged = [];
  const processedExistingKeys = new Set();

  // (1) e (2): Processar todas as novas entradas
  for (const newEntry of newEntries) {
    const key = _entryKey(newEntry);
    const existing = existingByKey.get(key);

    if (existing) {
      // Match encontrado: preservar mapeamentos existentes
      processedExistingKeys.add(key);
      merged.push({
        ...newEntry,
        id: existing.id, // preserva o ID original
        oculta: existing.oculta,
        arquivo_drive_id: existing.arquivo_drive_id,
        arquivo_nome: existing.arquivo_nome,
        confianca: existing.confianca,
        data_mapeamento: existing.data_mapeamento,
        // Preserva status se mapeada/mantida_manual, senão mantém status atual
        status: _preserveStatus(existing.status),
      });
    } else {
      // Entrada nova: adicionar com status "pendente"
      merged.push({
        ...newEntry,
        status: 'pendente',
      });
    }
  }

  // (3): Entradas existentes ausentes no novo XML → marcar como "removida"
  for (const existing of existingEntries) {
    const key = _entryKey(existing);
    if (!processedExistingKeys.has(key)) {
      merged.push({
        ...existing,
        status: 'removida',
      });
    }
  }

  return merged;
}

/**
 * Faz upload do arquivo XML para a pasta "ComprovaLattes/xml/" no Drive.
 * Se um arquivo com o mesmo nome já existir, sobrescreve (re-upload).
 *
 * @param {File} file — File API object (o XML selecionado pelo usuário)
 * @param {string} rootFolderId — ID da pasta raiz "ComprovaLattes"
 * @returns {Promise<{id: string, name: string}>} dados do arquivo enviado
 */
export async function uploadXmlFile(file, rootFolderId) {
  // Localizar ou criar a pasta "xml/" dentro da raiz
  let xmlFolderId = await findFolder('xml', rootFolderId);
  if (!xmlFolderId) {
    xmlFolderId = await createFolder('xml', rootFolderId);
  }

  // Upload do arquivo (usa o nome original)
  const result = await uploadFile(file, xmlFolderId, file.name);
  return result;
}

/**
 * Carrega entradas da aba "entradas" da Planilha e converte para objetos LattesEntry.
 *
 * @param {string} spreadsheetId — ID da planilha
 * @returns {Promise<Array<Object>>} entradas como LattesEntry[]
 */
export async function loadEntries(spreadsheetId) {
  const rows = await getRows(spreadsheetId, ENTRIES_SHEET);

  return rows.map(row => ({
    id: row.id || '',
    titulo: row.titulo || '',
    instituicao: row.instituicao || '',
    ano: row.ano || '',
    carga_horaria: row.carga_horaria || '',
    categoria: row.categoria || '',
    status: row.status || 'pendente',
    oculta: row.oculta === 'TRUE' || row.oculta === true,
    arquivo_drive_id: row.arquivo_drive_id || null,
    arquivo_nome: row.arquivo_nome || null,
    confianca: row.confianca !== '' && row.confianca !== undefined ? Number(row.confianca) : null,
    data_mapeamento: row.data_mapeamento || null,
  }));
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Gera a chave composta para identificar uma entrada unicamente.
 * Usa: titulo + instituicao + ano + categoria (Req 2.8)
 *
 * @param {Object} entry — entrada (LattesEntry)
 * @returns {string} chave composta normalizada
 * @private
 */
function _entryKey(entry) {
  const titulo = (entry.titulo || '').trim().toLowerCase();
  const instituicao = (entry.instituicao || '').trim().toLowerCase();
  const ano = (entry.ano || '').trim();
  const categoria = (entry.categoria || '').trim().toLowerCase();
  return `${titulo}|${instituicao}|${ano}|${categoria}`;
}

/**
 * Determina qual status preservar durante o merge.
 * - "mapeada" e "mantida_manual" são preservados (mapeamento ativo)
 * - "removida" que retorna no XML → volta a "pendente" (re-apareceu)
 * - "pendente" permanece
 *
 * @param {string} existingStatus — status atual da entrada existente
 * @returns {string} status a usar na entrada mergeada
 * @private
 */
function _preserveStatus(existingStatus) {
  if (existingStatus === 'mapeada' || existingStatus === 'mantida_manual') {
    return existingStatus;
  }
  // Se era "removida" e reapareceu no XML, volta a "pendente"
  if (existingStatus === 'removida') {
    return 'pendente';
  }
  return existingStatus || 'pendente';
}

/**
 * Merge categorias existentes com novas, preservando IDs e estados.
 *
 * @param {Array<Object>} existing — categorias na planilha
 * @param {Array<Object>} newCategories — categorias do novo XML
 * @returns {Array<Object>} categorias mergeadas
 * @private
 */
function _mergeCategories(existing, newCategories) {
  const existingByXmlName = new Map();
  for (const cat of existing) {
    existingByXmlName.set(cat.nome_xml, cat);
  }

  const merged = [...existing];

  for (const newCat of newCategories) {
    if (!existingByXmlName.has(newCat.nome_xml)) {
      // Categoria nova: adicionar com estado inativo (Req 2.6)
      merged.push({
        ...newCat,
        ativa: false,
      });
    }
  }

  return merged;
}

/**
 * Constrói mapa de nome_xml → category ID para resolução.
 *
 * @param {Array<Object>} categories — categorias
 * @returns {Map<string, string>} nome_xml → category.id
 * @private
 */
function _buildCategoryMap(categories) {
  const map = new Map();
  for (const cat of categories) {
    map.set(cat.nome_xml, cat.id);
  }
  return map;
}

/**
 * Resolve IDs de categoria nas entradas novas.
 * As entradas do parseXml usam IDs gerados durante o parse.
 * Este método atualiza para usar os IDs definitivos do merge de categorias.
 *
 * @param {Array<Object>} entries — entradas com IDs temporários de categoria
 * @param {Array<Object>} parsedCategories — categorias do parse (com IDs temporários)
 * @param {Map<string, string>} categoryMap — nome_xml → ID definitivo
 * @returns {Array<Object>} entradas com IDs de categoria resolvidos
 * @private
 */
function _resolveCategoryIds(entries, parsedCategories, categoryMap) {
  // Construir mapa de ID temporário → nome_xml a partir das categorias do parse
  const tempIdToXmlName = new Map();
  for (const cat of parsedCategories) {
    tempIdToXmlName.set(cat.id, cat.nome_xml);
  }

  return entries.map(entry => {
    const xmlName = tempIdToXmlName.get(entry.categoria);
    if (xmlName && categoryMap.has(xmlName)) {
      return { ...entry, categoria: categoryMap.get(xmlName) };
    }
    return entry;
  });
}

/**
 * Carrega categorias da aba "categorias" da Planilha.
 *
 * @param {string} spreadsheetId
 * @returns {Promise<Array<Object>>}
 * @private
 */
async function _loadCategories(spreadsheetId) {
  const rows = await getRows(spreadsheetId, CATEGORIES_SHEET);

  return rows.map(row => ({
    id: row.id || '',
    nome_xml: row.nome_xml || '',
    nome_display: row.nome_display || '',
    ativa: row.ativa === 'TRUE' || row.ativa === true,
    pasta_drive_id: row.pasta_drive_id || null,
  }));
}

/**
 * Serializa uma entrada LattesEntry para array de valores (na ordem ENTRY_COLUMNS).
 *
 * @param {Object} entry — LattesEntry
 * @returns {Array<string>} valores na ordem das colunas
 * @private
 */
function _serializeEntry(entry) {
  return [
    entry.id || '',
    entry.titulo || '',
    entry.instituicao || '',
    entry.ano || '',
    entry.carga_horaria || '',
    entry.categoria || '',
    entry.status || 'pendente',
    entry.oculta === true ? 'TRUE' : 'FALSE',
    entry.arquivo_drive_id || '',
    entry.arquivo_nome || '',
    entry.confianca !== null && entry.confianca !== undefined ? String(entry.confianca) : '',
    entry.data_mapeamento || '',
  ];
}

/**
 * Serializa uma categoria para array de valores (na ordem CATEGORY_COLUMNS).
 *
 * @param {Object} category
 * @returns {Array<string>}
 * @private
 */
function _serializeCategory(category) {
  return [
    category.id || '',
    category.nome_xml || '',
    category.nome_display || '',
    category.ativa === true ? 'TRUE' : 'FALSE',
    category.pasta_drive_id || '',
  ];
}

/**
 * Persiste todas as entradas na planilha usando batchUpdate.
 * Substitui TODOS os dados da aba (exceto header) por uma escrita completa.
 *
 * @param {Array<Object>} entries — entradas a salvar
 * @param {string} spreadsheetId
 * @returns {Promise<void>}
 * @private
 */
async function _saveEntriesToSheet(entries, spreadsheetId) {
  if (entries.length === 0) {
    return;
  }

  const rows = entries.map(e => _serializeEntry(e));

  // Usa batchUpdate para escrever todas as linhas a partir da linha 2 (header é linha 1)
  const range = `${ENTRIES_SHEET}!A2:L${rows.length + 1}`;
  await batchUpdate(spreadsheetId, [
    { range, values: rows }
  ]);
}

/**
 * Persiste todas as categorias na planilha usando batchUpdate.
 * Substitui TODOS os dados da aba (exceto header) por uma escrita completa.
 *
 * @param {Array<Object>} categories — categorias a salvar
 * @param {string} spreadsheetId
 * @returns {Promise<void>}
 * @private
 */
async function _saveCategoriesToSheet(categories, spreadsheetId) {
  if (categories.length === 0) {
    return;
  }

  const rows = categories.map(c => _serializeCategory(c));

  // Usa batchUpdate para escrever todas as linhas a partir da linha 2
  const range = `${CATEGORIES_SHEET}!A2:E${rows.length + 1}`;
  await batchUpdate(spreadsheetId, [
    { range, values: rows }
  ]);
}
