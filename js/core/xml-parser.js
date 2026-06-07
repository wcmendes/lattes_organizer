/**
 * xml-parser.js — Parser XML Lattes
 * 
 * Parseia o XML do Currículo Lattes (CNPq) e extrai entradas acadêmicas,
 * categorias e metadados. Trata codificação ISO-8859-1 e valida arquivos.
 * 
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.10
 */

// Mapa de diacríticos para palavras conhecidas em português
const DIACRITICS_MAP = {
  'FORMACAO': 'Formação',
  'PRODUCAO': 'Produção',
  'PARTICIPACAO': 'Participação',
  'EXTENSAO': 'Extensão',
  'COMPLEMENTAR': 'Complementar',
  'BIBLIOGRAFICA': 'Bibliográfica',
  'EDUCACAO': 'Educação',
  'ORGANIZACAO': 'Organização',
  'ORIENTACAO': 'Orientação',
  'APRESENTACAO': 'Apresentação',
  'PUBLICACAO': 'Publicação',
  'AVALIACAO': 'Avaliação',
  'COMUNICACAO': 'Comunicação',
  'INFORMACAO': 'Informação',
  'GRADUACAO': 'Graduação',
  'ESPECIALIZACAO': 'Especialização',
  'POS': 'Pós',
  'TECNICA': 'Técnica',
  'TECNOLOGICA': 'Tecnológica',
  'TECNICO': 'Técnico',
  'TECNOLOGICO': 'Tecnológico',
  'PROFISSIONAL': 'Profissional',
  'ACADEMICA': 'Acadêmica',
  'ACADEMICO': 'Acadêmico',
  'CIENTIFICA': 'Científica',
  'CIENTIFICO': 'Científico',
  'ARTISTICA': 'Artística',
  'ARTISTICO': 'Artístico',
  'JURIDICA': 'Jurídica',
  'JURIDICO': 'Jurídico',
  'DIDATICO': 'Didático',
  'DIDATICA': 'Didática',
  'PERIODICO': 'Periódico',
  'PERIODICOS': 'Periódicos',
  'CAPITULO': 'Capítulo',
  'CAPITULOS': 'Capítulos',
  'SIMPOSIO': 'Simpósio',
  'SEMINARIO': 'Seminário',
  'CONGRESSO': 'Congresso',
  'ENCONTRO': 'Encontro',
  'OFICINA': 'Oficina',
  'PREMIO': 'Prêmio',
  'PREMIOS': 'Prêmios',
  'TITULO': 'Título',
  'TITULOS': 'Títulos',
  'CURTA': 'Curta',
  'DURACAO': 'Duração',
  'LONGA': 'Longa',
  'UNIVERSITARIA': 'Universitária',
  'UNIVERSITARIO': 'Universitário',
  'EVENTOS': 'Eventos',
  'CONGRESSOS': 'Congressos',
  'SEMINARIOS': 'Seminários',
  'CURSO': 'Curso',
  'CURSOS': 'Cursos',
  'DADOS': 'Dados',
  'BASICOS': 'Básicos',
  'DETALHAMENTO': 'Detalhamento',
  'OUTRAS': 'Outras',
  'OUTROS': 'Outros',
  'ATIVIDADES': 'Atividades',
  'ATUACAO': 'Atuação',
};

// Maximum file size: 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Generates a simple UUID v4.
 * Uses crypto.randomUUID() if available, otherwise fallback.
 * @returns {string}
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates a file for XML import.
 * Checks extension (.xml) and size (≤ 20MB).
 * 
 * @param {File|{name: string, size: number}} file — File object or file-like
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateFile(file) {
  if (!file) {
    return { valid: false, error: 'Nenhum arquivo selecionado.' };
  }

  const name = file.name || '';
  const extension = name.split('.').pop().toLowerCase();

  if (extension !== 'xml') {
    return { valid: false, error: 'O arquivo deve ter extensão .xml.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'O arquivo excede o tamanho máximo de 20MB.' };
  }

  return { valid: true, error: null };
}

/**
 * Converts XML section name to readable pt-BR name.
 * Uses " — " (em dash with spaces) to separate major sections from subsections.
 * 
 * Example: "FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO" 
 *        → "Formação Complementar — Curso de Curta Duração"
 * 
 * @param {string} xmlSectionName — ex: "FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO"
 * @returns {string}
 */
export function formatCategoryName(xmlSectionName) {
  if (!xmlSectionName) return '';

  const words = xmlSectionName.split('-');

  // Find the split point for " — " separator.
  // The first group is the "parent" section and the rest is the "subsection".
  // We identify the parent by looking for common parent section patterns.
  // Common parents: FORMACAO-COMPLEMENTAR, PARTICIPACAO-EM-EVENTOS-CONGRESSOS, PRODUCAO-BIBLIOGRAFICA, etc.
  const parentPatterns = [
    'FORMACAO-COMPLEMENTAR',
    'PARTICIPACAO-EM-EVENTOS-CONGRESSOS',
    'PRODUCAO-BIBLIOGRAFICA',
    'PRODUCAO-TECNICA',
    'ORIENTACOES-CONCLUIDAS',
    'DADOS-COMPLEMENTARES',
    'OUTRAS-PRODUCOES',
  ];

  let splitIndex = -1;
  const fullName = xmlSectionName.toUpperCase();

  for (const pattern of parentPatterns) {
    if (fullName.startsWith(pattern + '-')) {
      splitIndex = pattern.split('-').length;
      break;
    }
  }

  // Format each word: apply diacritics or title-case
  const formattedWords = words.map(word => {
    const upper = word.toUpperCase();
    if (DIACRITICS_MAP[upper]) {
      return DIACRITICS_MAP[upper];
    }
    // Title case: first letter uppercase, rest lowercase
    if (word.length === 0) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  // If we found a parent pattern split, use em dash
  if (splitIndex > 0 && splitIndex < formattedWords.length) {
    const parentPart = formattedWords.slice(0, splitIndex).join(' ');
    const childPart = formattedWords.slice(splitIndex).join(' ');
    return `${parentPart} — ${childPart}`;
  }

  // No known parent, return all words joined by spaces
  return formattedWords.join(' ');
}

/**
 * Generates slug from XML category name.
 * Simply lowercases the name (hyphens are already present).
 * 
 * @param {string} xmlSectionName
 * @returns {string} — ex: "formacao-complementar-curso-de-curta-duracao"
 */
export function categorySlug(xmlSectionName) {
  if (!xmlSectionName) return '';
  return xmlSectionName.toLowerCase();
}

/**
 * Extracts the category name from an activity element.
 * In Lattes XML, the activity element's tag name IS the category.
 * 
 * @param {Element} element
 * @returns {string} — the tag name of the element (category)
 */
function getCategoryFromElement(element) {
  return element.tagName;
}

/**
 * Extracts entry data from an activity element.
 * Lattes XML uses attributes extensively - data lives in DADOS-BASICOS-* and DETALHAMENTO-* children.
 * 
 * @param {Element} activityElement — the activity element (e.g., FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO)
 * @returns {{titulo: string, instituicao: string, ano: string, carga_horaria: string}}
 */
function extractEntryData(activityElement) {
  let titulo = '';
  let ano = '';
  let instituicao = '';
  let carga_horaria = '';

  // Look for DADOS-BASICOS-* child (contains TITULO and ANO)
  const children = activityElement.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const tagName = child.tagName;

    if (tagName.startsWith('DADOS-BASICOS')) {
      titulo = child.getAttribute('TITULO') || '';
      ano = child.getAttribute('ANO') || '';
      // Some elements use TITULO-DO-TRABALHO or similar
      if (!titulo) {
        titulo = child.getAttribute('TITULO-DO-TRABALHO') || '';
      }
      if (!titulo) {
        titulo = child.getAttribute('TITULO-DA-APRESENTACAO') || '';
      }
      if (!titulo) {
        titulo = child.getAttribute('NATUREZA') || '';
      }
    }

    if (tagName.startsWith('DETALHAMENTO')) {
      instituicao = child.getAttribute('NOME-INSTITUICAO') || '';
      carga_horaria = child.getAttribute('CARGA-HORARIA') || '';
      // Some elements use NOME-DA-INSTITUICAO
      if (!instituicao) {
        instituicao = child.getAttribute('NOME-DA-INSTITUICAO') || '';
      }
    }
  }

  return { titulo, instituicao, ano, carga_horaria };
}

/**
 * Parseia o XML Lattes e extrai entradas acadêmicas.
 * 
 * @param {string} xmlContent — conteúdo bruto do XML
 * @returns {ParseResult}
 * 
 * @typedef {Object} ParseResult
 * @property {LattesEntry[]} entries
 * @property {Category[]} categories
 * @property {string[]} errors — avisos de parsing
 */
export function parseXml(xmlContent) {
  const errors = [];
  const entries = [];
  const categoriesMap = new Map(); // nome_xml → Category

  if (!xmlContent || typeof xmlContent !== 'string') {
    return { entries: [], categories: [], errors: ['Conteúdo XML vazio ou inválido.'] };
  }

  // Parse XML using DOMParser
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');

  // Check for parsing errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return { entries: [], categories: [], errors: ['Erro ao parsear XML: o arquivo não é um XML válido.'] };
  }

  // Verify it's a Lattes CV
  const curriculo = doc.querySelector('CURRICULO-VITAE');
  if (!curriculo) {
    return { entries: [], categories: [], errors: ['Arquivo não contém a estrutura esperada do Currículo Lattes (elemento CURRICULO-VITAE não encontrado).'] };
  }

  // Sections that contain activities of interest
  // We traverse all descendants looking for activity elements that have DADOS-BASICOS-* children
  const allElements = curriculo.getElementsByTagName('*');

  for (let i = 0; i < allElements.length; i++) {
    const element = allElements[i];
    const children = element.children;

    // Check if this element has DADOS-BASICOS-* child → it's an activity entry
    let hasDadosBasicos = false;
    for (let j = 0; j < children.length; j++) {
      if (children[j].tagName.startsWith('DADOS-BASICOS')) {
        hasDadosBasicos = true;
        break;
      }
    }

    if (!hasDadosBasicos) continue;

    // Extract entry data
    const categoryName = getCategoryFromElement(element);
    const { titulo, instituicao, ano, carga_horaria } = extractEntryData(element);

    // Register category if new
    if (!categoriesMap.has(categoryName)) {
      categoriesMap.set(categoryName, {
        id: generateUUID(),
        nome_xml: categoryName,
        nome_display: formatCategoryName(categoryName),
        ativa: false,
        pasta_drive_id: null,
      });
    }

    const category = categoriesMap.get(categoryName);

    // Create entry
    entries.push({
      id: generateUUID(),
      titulo,
      instituicao,
      ano,
      carga_horaria,
      categoria: category.id,
      status: 'pendente',
      oculta: false,
      arquivo_drive_id: null,
      arquivo_nome: null,
      confianca: null,
      data_mapeamento: null,
    });
  }

  if (entries.length === 0) {
    errors.push('Nenhuma entrada acadêmica encontrada no XML.');
  }

  const categories = Array.from(categoriesMap.values());

  return { entries, categories, errors };
}
