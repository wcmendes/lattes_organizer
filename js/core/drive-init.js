/**
 * Drive Init — Inicialização da estrutura de pastas no Google Drive
 *
 * Verifica e cria a hierarquia de pastas necessária para a aplicação:
 * ComprovaLattes/
 * ├── files/
 * │   └── novos/
 * └── xml/
 *
 * Chamado durante o bootstrap da aplicação após autenticação válida.
 * Falhas são tratadas silenciosamente (log de warning) sem bloquear a app.
 *
 * Requirements: 14.1
 * @module core/drive-init
 */

import { findFolder, createFolder } from '../services/drive.js';
import { loadConfig, saveConfig } from '../config.js';

const ROOT_FOLDER_NAME = 'ComprovaLattes';

/**
 * Garante que uma pasta exista dentro de um parent.
 * Se já existir, retorna o ID existente; caso contrário, cria e retorna o novo ID.
 * @param {string} name - Nome da pasta
 * @param {string} parentId - ID da pasta pai
 * @returns {Promise<string>} ID da pasta (existente ou recém-criada)
 */
async function ensureFolder(name, parentId) {
  const existingId = await findFolder(name, parentId);
  if (existingId) {
    return existingId;
  }
  return await createFolder(name, parentId);
}

/**
 * Inicializa a estrutura de pastas do ComprovaLattes no Google Drive.
 *
 * Fluxo:
 * 1. Verifica se root_folder_id existe na config
 * 2. Se existe, verifica se a pasta ainda existe no Drive
 * 3. Se não existe, cria "ComprovaLattes" na raiz do Drive
 * 4. Garante subpastas: files/, files/novos/, xml/
 * 5. Salva root_folder_id na config se criado
 *
 * Falhas não bloqueiam a aplicação — apenas warnings no console.
 * @returns {Promise<void>}
 */
export async function initDriveFolders() {
  try {
    const config = loadConfig();
    let rootId = config.root_folder_id;

    // Verificar se a pasta raiz existe no Drive
    if (rootId) {
      // Verificar se a pasta ainda existe (pode ter sido excluída pelo usuário)
      const existingRoot = await findFolder(ROOT_FOLDER_NAME, 'root');
      if (!existingRoot) {
        console.warn('[DriveInit] Pasta raiz configurada não encontrada no Drive, recriando...');
        rootId = null;
      }
    }

    // Criar pasta raiz se necessário
    if (!rootId) {
      rootId = await ensureFolder(ROOT_FOLDER_NAME, 'root');
      config.root_folder_id = rootId;
      saveConfig(config);
      console.log('[DriveInit] Pasta raiz "ComprovaLattes" criada:', rootId);
    } else {
      console.log('[DriveInit] Pasta raiz "ComprovaLattes" encontrada:', rootId);
    }

    // Garantir subpastas
    const filesId = await ensureFolder('files', rootId);
    await ensureFolder('novos', filesId);
    await ensureFolder('xml', rootId);

    console.log('[DriveInit] Estrutura de pastas verificada com sucesso');
  } catch (error) {
    console.warn('[DriveInit] Falha ao inicializar pastas no Drive:', error.message);
    console.warn('[DriveInit] O usuário pode configurar manualmente nas configurações');
  }
}
