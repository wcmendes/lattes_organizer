/**
 * category-manager.js — Gerenciamento de Categorias e Visibilidade
 *
 * Gerencia categorias descobertas do XML Lattes, controle de visibilidade
 * (ON/OFF por categoria e ocultar/restaurar entradas individuais),
 * criação de subpastas no Drive e persistência na Planilha.
 *
 * Regras de visibilidade (Property 6):
 *   Uma entrada é visível se:
 *   1. Sua categoria tem ativa = true, E
 *   2. A entrada possui oculta = false, E
 *   3. O status da entrada NÃO é "removida" (exceto se "mantida_manual")
 *
 * Requirements: 2.5, 2.6, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9, 6.10, 14.2, 14.3
 */

import { getRows, updateRow } from '../services/sheets.js';
import { findFolder, createFolder } from '../services/drive.js';
import { categorySlug } from './xml-parser.js';
import { loadConfig } from '../config.js';

const CATEGORIES_SHEET = 'categorias';
const ENTRIES_SHEET = 'entradas';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Carrega categorias da aba "categorias" da Planilha.
 *
 * @param {string} spreadsheetId — ID da planilha
 * @returns {Promise<Array<import('../design').Category>>} categorias carregadas
 */
export async function loadCategories(spreadsheetId) {
  const rows = await getRows(spreadsheetId, CATEGORIES_SHEET);

  return rows.map(row => ({
    id: row.id || '',
    nome_xml: row.nome_xml || '',
    nome_display: row.nome_display || '',
    ativa: row.ativa === 'TRUE' || row.ativa === true,
    pasta_drive_id: row.pasta_drive_id || null
  }));
}

/**
 * Alterna o estado ativo de uma categoria (toggle ON/OFF).
 *
 * Fluxo:
 * 1. Persiste a alteração na Planilha ANTES de confirmar visualmente (Req 6.7)
 * 2. Se ativando (ON) e subpasta não existe → cria no Drive (Req 14.2, 14.3)
 * 3. Se persistência falhar → lança erro para rollback visual (Req 6.8)
 *
 * @param {string} categoryId — ID da categoria
 * @param {boolean} active — novo estado (true = ON, false = OFF)
 * @param {Array<import('../design').Category>} categories — lista de categorias atual
 * @returns {Promise<import('../design').Category>} categoria atualizada
 * @throws {Error} se persistência falhar (caller deve fazer rollback visual)
 */
export async function toggleCategory(categoryId, active, categories) {
  const categoryIndex = categories.findIndex(c => c.id === categoryId);
  if (categoryIndex === -1) {
    throw new Error(`Categoria não encontrada: ${categoryId}`);
  }

  const category = { ...categories[categoryIndex] };
  const config = loadConfig();
  const spreadsheetId = config.spreadsheet_id;

  if (!spreadsheetId) {
    throw new Error('Planilha não configurada.');
  }

  // Atualiza estado
  category.ativa = active;

  // Se ativando, criar subpasta no Drive se não existir (Req 14.2, 14.3)
  if (active && !category.pasta_drive_id) {
    const rootFolderId = config.root_folder_id;
    if (rootFolderId) {
      const slug = categorySlug(category.nome_xml);
      const folderId = await _ensureCategoryFolder(slug, rootFolderId);
      category.pasta_drive_id = folderId;
    }
  }

  // Persiste na Planilha ANTES de confirmar visualmente (Req 6.7)
  // rowIndex é 1-based: header=1, data começa em 2
  const rowIndex = categoryIndex + 2;
  await updateRow(spreadsheetId, CATEGORIES_SHEET, rowIndex, {
    id: category.id,
    nome_xml: category.nome_xml,
    nome_display: category.nome_display,
    ativa: category.ativa ? 'TRUE' : 'FALSE',
    pasta_drive_id: category.pasta_drive_id || ''
  });

  return category;
}

/**
 * Oculta uma entrada individual (marca oculta = true).
 *
 * Persiste na Planilha ANTES de confirmar visualmente (Req 6.7).
 *
 * @param {string} entryId — ID da entrada
 * @param {Array<Object>} entries — lista de entradas atual
 * @returns {Promise<Object>} entrada atualizada
 * @throws {Error} se persistência falhar (caller deve fazer rollback visual)
 */
export async function hideEntry(entryId, entries) {
  const entryIndex = entries.findIndex(e => e.id === entryId);
  if (entryIndex === -1) {
    throw new Error(`Entrada não encontrada: ${entryId}`);
  }

  const entry = { ...entries[entryIndex] };
  const config = loadConfig();
  const spreadsheetId = config.spreadsheet_id;

  if (!spreadsheetId) {
    throw new Error('Planilha não configurada.');
  }

  entry.oculta = true;

  // Persiste na Planilha ANTES de confirmar visualmente (Req 6.7)
  const rowIndex = entryIndex + 2;
  await updateRow(spreadsheetId, ENTRIES_SHEET, rowIndex, {
    id: entry.id,
    titulo: entry.titulo,
    instituicao: entry.instituicao,
    ano: entry.ano,
    carga_horaria: entry.carga_horaria,
    categoria: entry.categoria,
    status: entry.status,
    oculta: 'TRUE',
    arquivo_drive_id: entry.arquivo_drive_id || '',
    arquivo_nome: entry.arquivo_nome || '',
    confianca: entry.confianca !== null && entry.confianca !== undefined ? String(entry.confianca) : '',
    data_mapeamento: entry.data_mapeamento || ''
  });

  return entry;
}

/**
 * Restaura uma entrada oculta (marca oculta = false).
 *
 * Persiste na Planilha ANTES de confirmar visualmente (Req 6.7).
 *
 * @param {string} entryId — ID da entrada
 * @param {Array<Object>} entries — lista de entradas atual
 * @returns {Promise<Object>} entrada atualizada
 * @throws {Error} se persistência falhar (caller deve fazer rollback visual)
 */
export async function unhideEntry(entryId, entries) {
  const entryIndex = entries.findIndex(e => e.id === entryId);
  if (entryIndex === -1) {
    throw new Error(`Entrada não encontrada: ${entryId}`);
  }

  const entry = { ...entries[entryIndex] };
  const config = loadConfig();
  const spreadsheetId = config.spreadsheet_id;

  if (!spreadsheetId) {
    throw new Error('Planilha não configurada.');
  }

  entry.oculta = false;

  // Persiste na Planilha ANTES de confirmar visualmente (Req 6.7)
  const rowIndex = entryIndex + 2;
  await updateRow(spreadsheetId, ENTRIES_SHEET, rowIndex, {
    id: entry.id,
    titulo: entry.titulo,
    instituicao: entry.instituicao,
    ano: entry.ano,
    carga_horaria: entry.carga_horaria,
    categoria: entry.categoria,
    status: entry.status,
    oculta: 'FALSE',
    arquivo_drive_id: entry.arquivo_drive_id || '',
    arquivo_nome: entry.arquivo_nome || '',
    confianca: entry.confianca !== null && entry.confianca !== undefined ? String(entry.confianca) : '',
    data_mapeamento: entry.data_mapeamento || ''
  });

  return entry;
}

/**
 * Filtra entradas visíveis com base nas regras de visibilidade (Property 6).
 *
 * Uma entrada é visível se:
 * 1. Sua categoria tem ativa = true
 * 2. A entrada possui oculta = false
 * 3. O status NÃO é "removida" (exceto se "mantida_manual")
 *
 * @param {Array<Object>} entries — todas as entradas
 * @param {Array<import('../design').Category>} categories — todas as categorias
 * @returns {Array<Object>} apenas entradas visíveis
 */
export function getVisibleEntries(entries, categories) {
  const activeCategoryIds = new Set(
    categories.filter(c => c.ativa).map(c => c.id)
  );

  return entries.filter(entry => {
    // Regra 1: categoria deve estar ativa
    if (!activeCategoryIds.has(entry.categoria)) {
      return false;
    }

    // Regra 2: entrada não pode estar oculta
    if (entry.oculta === true || entry.oculta === 'TRUE') {
      return false;
    }

    // Regra 3: status não pode ser "removida" (exceto "mantida_manual")
    if (entry.status === 'removida') {
      return false;
    }

    return true;
  });
}

/**
 * Retorna apenas categorias ativas (toggle ON).
 *
 * @param {Array<import('../design').Category>} categories — todas as categorias
 * @returns {Array<import('../design').Category>} categorias ativas
 */
export function getActiveCategories(categories) {
  return categories.filter(c => c.ativa);
}

/**
 * Retorna itens ocultos: categorias desativadas + entradas individualmente ocultas.
 *
 * @param {Array<Object>} entries — todas as entradas
 * @param {Array<import('../design').Category>} categories — todas as categorias
 * @returns {{hiddenCategories: Array<import('../design').Category>, hiddenEntries: Array<Object>}}
 */
export function getHiddenItems(entries, categories) {
  const hiddenCategories = categories.filter(c => !c.ativa);

  const hiddenEntries = entries.filter(entry =>
    (entry.oculta === true || entry.oculta === 'TRUE')
  );

  return { hiddenCategories, hiddenEntries };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Garante que a subpasta da categoria exista dentro de "files/" no Drive.
 * Se não existir, cria a pasta. (Req 14.2, 14.3)
 *
 * @param {string} slug — slug da categoria (ex: "formacao-complementar-curso-de-curta-duracao")
 * @param {string} rootFolderId — ID da pasta raiz "ComprovaLattes"
 * @returns {Promise<string>} ID da pasta da categoria
 * @private
 */
async function _ensureCategoryFolder(slug, rootFolderId) {
  // Primeiro, localizar a pasta "files/" dentro da raiz
  let filesFolderId = await findFolder('files', rootFolderId);
  if (!filesFolderId) {
    filesFolderId = await createFolder('files', rootFolderId);
  }

  // Verificar se a subpasta da categoria já existe
  let categoryFolderId = await findFolder(slug, filesFolderId);
  if (!categoryFolderId) {
    categoryFolderId = await createFolder(slug, filesFolderId);
  }

  return categoryFolderId;
}
