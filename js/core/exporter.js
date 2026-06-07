/**
 * exporter.js — Exportação Organizada (Drive + JSZip)
 *
 * Exporta comprovantes mapeados para pasta organizada no Google Drive
 * ou como arquivo ZIP para download local.
 *
 * Estrutura de exportação:
 *   ComprovaLattes/
 *   └── exportacao/
 *       ├── 2.1 Formação Complementar/
 *       │   └── 2021_Formacao-Complementar_UFMG_Curso-de-Java.pdf
 *       ├── 3.1 Participação em Eventos/
 *       │   └── ...
 *       └── ...
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 * @module core/exporter
 */

import {
  findFolder,
  createFolder,
  listFiles,
  deleteFile,
  downloadFile,
  uploadFile
} from '../services/drive.js';
import { showOverlay, updateOverlay, hideOverlay } from '../ui/overlay.js';
import { showError, showSuccess } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Exporta arquivos mapeados para pasta organizada no Drive.
 *
 * Fluxo:
 * 1. Valida que existem mapeamentos
 * 2. Encontra ou cria "exportacao/" sob a pasta raiz
 * 3. Limpa conteúdo anterior da pasta de exportação
 * 4. Cria subpastas numeradas por categoria
 * 5. Copia cada arquivo mapeado para a subpasta correspondente
 *
 * @param {Array<Object>} entries — entradas com comprovantes associados (status "mapeada" ou "mantida_manual")
 * @param {Object} config — { rootFolderId, categories }
 * @param {function} onProgress — callback(current, total)
 * @returns {Promise<{success: number, failed: number, errors: string[]}>}
 */
export async function exportToDrive(entries, config, onProgress) {
  const { rootFolderId, categories } = config;

  // Req 9.6: bloquear se nenhum mapeamento existir
  const mappedEntries = _getMappedEntries(entries);
  if (mappedEntries.length === 0) {
    throw new Error('Não há comprovantes mapeados para exportar.');
  }

  const total = mappedEntries.length;
  let current = 0;
  let success = 0;
  let failed = 0;
  const errors = [];

  // Req 9.5: overlay com progresso
  showOverlay('Exportando comprovantes...');

  try {
    // Encontrar ou criar pasta "exportacao/"
    let exportFolderId = await findFolder('exportacao', rootFolderId);
    if (!exportFolderId) {
      exportFolderId = await createFolder('exportacao', rootFolderId);
    } else {
      // Req 9.2: substituir exportação anterior — limpar conteúdo
      await _clearFolder(exportFolderId);
    }

    // Agrupar entradas por categoria
    const entriesByCategory = _groupByCategory(mappedEntries, categories);

    // Criar subpastas e copiar arquivos
    for (const [categoryLabel, categoryEntries] of entriesByCategory.entries()) {
      // Criar subpasta numerada (ex: "2.1 Formação Complementar")
      const subFolderId = await createFolder(categoryLabel, exportFolderId);

      for (const entry of categoryEntries) {
        current++;
        updateOverlay({
          detail: `Exportando ${current} de ${total}`
        });

        try {
          // Determinar extensão do arquivo original
          const extension = _getExtension(entry.arquivo_nome);
          const fileName = formatExportFileName(entry, extension);

          // Download do arquivo original e re-upload na pasta de exportação
          const fileContent = await downloadFile(entry.arquivo_drive_id);
          const blob = new Blob([fileContent], { type: 'application/octet-stream' });
          const file = new File([blob], fileName);
          await uploadFile(file, subFolderId, fileName);

          success++;
        } catch (err) {
          failed++;
          const errorMsg = `Falha ao exportar: ${entry.titulo || entry.arquivo_nome}`;
          errors.push(errorMsg);
          // Req 9.7: toast de erro por arquivo, continuar restantes
          showError(errorMsg);
        }

        if (onProgress) {
          onProgress(current, total);
        }
      }
    }
  } finally {
    hideOverlay();
  }

  // Req 9.7: resumo final
  if (failed === 0) {
    showSuccess(`Exportação concluída: ${success} arquivo(s) exportado(s) com sucesso.`);
  } else {
    showError(`Exportação concluída: ${success} sucesso, ${failed} falha(s).`);
  }

  return { success, failed, errors };
}

/**
 * Gera ZIP com arquivos organizados para download local.
 *
 * Usa JSZip (disponível como global) para criar um ZIP com a mesma
 * estrutura de pastas da exportação para o Drive.
 *
 * @param {Array<Object>} entries — entradas com comprovantes associados
 * @param {Object} config — { categories }
 * @param {function} onProgress — callback(current, total)
 * @returns {Promise<Blob>} ZIP como Blob
 */
export async function exportToZip(entries, config, onProgress) {
  const { categories } = config;

  // Req 9.6: bloquear se nenhum mapeamento existir
  const mappedEntries = _getMappedEntries(entries);
  if (mappedEntries.length === 0) {
    throw new Error('Não há comprovantes mapeados para exportar.');
  }

  const total = mappedEntries.length;
  let current = 0;

  // Req 9.5: overlay com progresso
  showOverlay('Gerando ZIP...');

  try {
    // JSZip disponível como global via CDN
    const zip = new JSZip();

    // Agrupar entradas por categoria
    const entriesByCategory = _groupByCategory(mappedEntries, categories);

    for (const [categoryLabel, categoryEntries] of entriesByCategory.entries()) {
      const folder = zip.folder(categoryLabel);

      for (const entry of categoryEntries) {
        current++;
        updateOverlay({
          detail: `Exportando ${current} de ${total}`
        });

        try {
          const extension = _getExtension(entry.arquivo_nome);
          const fileName = formatExportFileName(entry, extension);

          // Download do conteúdo do arquivo via Drive API
          const fileContent = await downloadFile(entry.arquivo_drive_id);
          folder.file(fileName, fileContent);
        } catch (err) {
          // Req 9.7: toast de erro por arquivo, continuar restantes
          showError(`Falha ao incluir no ZIP: ${entry.titulo || entry.arquivo_nome}`);
        }

        if (onProgress) {
          onProgress(current, total);
        }
      }
    }

    // Gerar o Blob do ZIP
    const blob = await zip.generateAsync({ type: 'blob' });
    return blob;
  } finally {
    hideOverlay();
  }
}

/**
 * Gera nome de arquivo padronizado para exportação.
 *
 * Padrão: "ANO_categoria_INSTITUICAO_Titulo.ext"
 * - Max 200 chars total (incluindo extensão)
 * - ASCII-safe (remove diacríticos, substitui caracteres especiais)
 * - Determinístico (mesma entrada → mesma saída)
 *
 * @param {Object} entry — LattesEntry (titulo, instituicao, ano, categoria)
 * @param {string} extension — extensão do arquivo (ex: "pdf", "jpg")
 * @returns {string} nome formatado, max 200 chars, ASCII-safe
 */
export function formatExportFileName(entry, extension) {
  const ano = _sanitizePart(entry.ano || 'XXXX');
  const categoria = _sanitizePart(entry.categoria_display || entry.categoria || 'Geral');
  const instituicao = _sanitizePart(entry.instituicao || 'Sem-Instituicao');
  const titulo = _sanitizePart(entry.titulo || 'Sem-Titulo');

  // Normalizar extensão (sem ponto, lowercase)
  const ext = extension.replace(/^\./, '').toLowerCase();
  const extWithDot = `.${ext}`;

  // Montar nome base: ANO_categoria_INSTITUICAO_Titulo
  const baseParts = [ano, categoria, instituicao, titulo];
  let baseName = baseParts.join('_');

  // Req 9.3: limitar a 200 caracteres total (incluindo extensão)
  const maxBaseLength = 200 - extWithDot.length;
  if (baseName.length > maxBaseLength) {
    baseName = baseName.substring(0, maxBaseLength);
    // Remover trailing separadores
    baseName = baseName.replace(/[-_]+$/, '');
  }

  return baseName + extWithDot;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Filtra apenas entradas com mapeamento ativo (arquivo associado).
 * @param {Array<Object>} entries
 * @returns {Array<Object>}
 * @private
 */
function _getMappedEntries(entries) {
  return entries.filter(e =>
    e.arquivo_drive_id &&
    (e.status === 'mapeada' || e.status === 'mantida_manual')
  );
}

/**
 * Agrupa entradas por categoria, usando label numerado para subpastas.
 * @param {Array<Object>} entries — entradas mapeadas
 * @param {Array<Object>} categories — lista de categorias com nome_display
 * @returns {Map<string, Array<Object>>} mapa de label → entradas
 * @private
 */
function _groupByCategory(entries, categories) {
  const categoryMap = new Map();
  for (const cat of categories) {
    categoryMap.set(cat.id, cat);
  }

  const grouped = new Map();

  for (const entry of entries) {
    const cat = categoryMap.get(entry.categoria);
    let label;

    if (cat) {
      // Gerar label numerado baseado na posição na lista de categorias
      const index = categories.indexOf(cat);
      const section = Math.floor(index / 10) + 2; // Seções começam em 2
      const subsection = (index % 10) + 1;
      label = `${section}.${subsection} ${cat.nome_display}`;
    } else {
      label = 'Outros';
    }

    // Enriquecer a entrada com categoria display para formatExportFileName
    const enrichedEntry = { ...entry, categoria_display: cat ? cat.nome_display : 'Geral' };

    if (!grouped.has(label)) {
      grouped.set(label, []);
    }
    grouped.get(label).push(enrichedEntry);
  }

  return grouped;
}

/**
 * Remove diacríticos e caracteres especiais de uma parte do nome.
 * Produz string ASCII-safe para nomes de arquivo.
 *
 * @param {string} str — string a sanitizar
 * @returns {string} string ASCII-safe com hífens no lugar de espaços/especiais
 * @private
 */
function _sanitizePart(str) {
  // Normalizar unicode (NFD) para separar diacríticos
  let result = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Substituir espaços e caracteres não alfanuméricos por hífens
  result = result.replace(/[^a-zA-Z0-9]/g, '-');

  // Colapsar múltiplos hífens em um
  result = result.replace(/-+/g, '-');

  // Remover hífens no início e fim
  result = result.replace(/^-|-$/g, '');

  return result;
}

/**
 * Extrai extensão de um nome de arquivo.
 * @param {string|null} fileName — nome do arquivo (ex: "certificado.pdf")
 * @returns {string} extensão sem ponto (ex: "pdf"), default "pdf"
 * @private
 */
function _getExtension(fileName) {
  if (!fileName) return 'pdf';
  const parts = fileName.split('.');
  if (parts.length > 1) {
    return parts[parts.length - 1].toLowerCase();
  }
  return 'pdf';
}

/**
 * Remove todo o conteúdo de uma pasta (arquivos e subpastas).
 * Usado para limpar a exportação anterior antes de gerar nova.
 *
 * @param {string} folderId — ID da pasta a limpar
 * @returns {Promise<void>}
 * @private
 */
async function _clearFolder(folderId) {
  const files = await listFiles(folderId);
  for (const file of files) {
    await deleteFile(file.id);
  }
}
