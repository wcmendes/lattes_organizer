/**
 * xml-parser.js — Parser XML Lattes
 * 
 * Parseia o XML do Currículo Lattes (CNPq) e extrai entradas acadêmicas,
 * categorias e metadados. Trata codificação ISO-8859-1 e valida arquivos.
 * 
 * Handles two XML patterns:
 *   Pattern A: Elements with DADOS-BASICOS-* + DETALHAMENTO-* children
 *   Pattern B: Elements with attributes directly (GRADUACAO, MESTRADO, etc.)
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
  'ORIENTACOES': 'Orientações',
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
  'CONSELHO': 'Conselho',
  'COMISSAO': 'Comissão',
  'CONSULTORIA': 'Consultoria',
  'PREMIACAO': 'Premiação',
  'TITULACAO': 'Titulação',
  'CONCLUSAO': 'Conclusão',
  'CONCLUIDAS': 'Concluídas',
  'PESQUISA': 'Pesquisa',
  'PROJETO': 'Projeto',
  'PROJETOS': 'Projetos',
  'INFORMACOES': 'Informações',
  'ADICIONAIS': 'Adicionais',
  'JULGADORA': 'Julgadora',
};

// Maximum file size: 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// Sections to skip (metadata only, no entries)
const SKIP_SECTIONS = new Set([
  'DADOS-GERAIS',
]);

// Pattern B: tags that carry attributes directly (no DADOS-BASICOS-* children)
// These are children of known parent sections.
const PATTERN_B_PARENTS = new Set([
  'FORMACAO-ACADEMICA-TITULACAO',
]);

// Title attribute names to look for in Pattern B elements (priority order)
const TITLE_ATTRS = [
  'TITULO-DO-TRABALHO-DE-CONCLUSAO-DE-CURSO',
  'TITULO-DA-DISSERTACAO-TESE',
  'TITULO-DA-MONOGRAFIA',
  'TITULO-DO-CURSO',
  'TITULO',
  'NOME-DO-PREMIO-OU-TITULO',
  'NOME-DO-PROJETO',
  'NOME-DO-EVENTO',
  'ESPECIFICACAO',
  'DESCRICAO-DO-PROJETO',
  'OUTRAS-INFORMACOES',
  'NOME-CURSO',
];

// Institution attribute names for Pattern B (priority order)
const INSTITUTION_ATTRS = [
  'NOME-INSTITUICAO',
  'NOME-DA-INSTITUICAO',
  'NOME-INSTITUICAO-EMPRESA',
];

// Year attribute names for Pattern B (priority order: conclusion first, then start)
const YEAR_ATTRS = [
  'ANO-DE-CONCLUSAO',
  'ANO-DE-OBTENCAO-DO-TITULO',
  'ANO',
  'ANO-DE-INICIO',
];

// Hours attribute names for Pattern B
const HOURS_ATTRS = [
  'CARGA-HORARIA',
  'CARGA-HORARIA-SEMANAL',
];

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
  const parentPatterns = [
    'FORMACAO-COMPLEMENTAR',
    'FORMACAO-ACADEMICA',
    'PARTICIPACAO-EM-EVENTOS-CONGRESSOS',
    'PRODUCAO-BIBLIOGRAFICA',
    'PRODUCAO-TECNICA',
    'ORIENTACOES-CONCLUIDAS',
    'DADOS-COMPLEMENTARES',
    'OUTRAS-PRODUCOES',
    'OUTRA-PRODUCAO',
    'PARTICIPACAO-EM-BANCA',
    'PROJETO-DE',
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
 * Gets the first non-null, non-empty attribute value from a list of attribute names.
 * @param {Element} element
 * @param {string[]} attrNames
 * @returns {string}
 */
function getFirstAttr(element, attrNames) {
  for (const attr of attrNames) {
    const val = element.getAttribute(attr);
    if (val != null && val !== '') return val;
  }
  return '';
}

/**
 * Determines the category name for a Pattern A element.
 * Uses the element's own tag name (which identifies the activity type).
 * 
 * @param {Element} element
 * @returns {string}
 */
function getCategoryForPatternA(element) {
  return element.tagName;
}

/**
 * Determines the category name for a Pattern B element.
 * Combines parent section context with the element's type.
 * 
 * @param {Element} element
 * @param {string} parentSection — the parent section tag name
 * @returns {string}
 */
function getCategoryForPatternB(element, parentSection) {
  // For FORMACAO-ACADEMICA-TITULACAO children, use "FORMACAO-ACADEMICA-{type}"
  if (parentSection === 'FORMACAO-ACADEMICA-TITULACAO') {
    return 'FORMACAO-ACADEMICA-' + element.tagName;
  }
  // Default: use the element's own tag
  return element.tagName;
}

/**
 * Extracts entry data from a Pattern A element (has DADOS-BASICOS-* + DETALHAMENTO-* children).
 * 
 * @param {Element} activityElement
 * @returns {{titulo: string, instituicao: string, ano: string, carga_horaria: string, descricao: string}}
 */
function extractPatternA(activityElement) {
  let titulo = '';
  let ano = '';
  let instituicao = '';
  let carga_horaria = '';
  let descricao = '';

  const children = activityElement.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const tagName = child.tagName;

    if (tagName.startsWith('DADOS-BASICOS')) {
      // Try multiple title attribute patterns
      titulo = child.getAttribute('TITULO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-TRABALHO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-ARTIGO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DA-APRESENTACAO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-TEXTO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-LIVRO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-SOFTWARE') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-PRODUTO-TECNOLOGICO') || '';
      if (!titulo) titulo = child.getAttribute('TITULO-DO-TRABALHO-TECNICO') || '';
      if (!titulo) titulo = child.getAttribute('NATUREZA') || '';

      // Year
      ano = child.getAttribute('ANO') || '';
      if (!ano) ano = child.getAttribute('ANO-DO-TRABALHO') || '';
      if (!ano) ano = child.getAttribute('ANO-DO-ARTIGO') || '';
      if (!ano) ano = child.getAttribute('ANO-DO-TEXTO') || '';
    }

    if (tagName.startsWith('DETALHAMENTO')) {
      const nomeEvento = child.getAttribute('NOME-DO-EVENTO') || '';
      
      instituicao = child.getAttribute('NOME-INSTITUICAO') || '';
      if (!instituicao) instituicao = child.getAttribute('NOME-DA-INSTITUICAO') || '';
      if (!instituicao) instituicao = child.getAttribute('TITULO-DO-PERIODICO-OU-REVISTA') || '';
      if (!instituicao) instituicao = child.getAttribute('NOME-DA-PLATAFORMA') || '';
      carga_horaria = child.getAttribute('CARGA-HORARIA') || '';
      descricao = child.getAttribute('OUTRAS-INFORMACOES') || '';
      
      // Handle NOME-DO-EVENTO:
      const genericTitles = new Set(['OUTRA', 'CONGRESSO', 'SIMPOSIO', 'SEMINARIO', 'ENCONTRO', 'OFICINA', 'CONFERENCIA', 'WORKSHOP', 'FEIRA', 'FESTIVAL', 'EXPOSICAO', 'COMPLETO', 'RESUMO', 'RESUMO_EXPANDIDO']);
      const tituloIsGeneric = genericTitles.has(titulo.toUpperCase().replace(/[^A-Z_]/g, ''));
      
      if (nomeEvento) {
        if (tituloIsGeneric) {
          // Title is generic → use event name as title
          titulo = nomeEvento;
        } else {
          // Title is real → store event name as institution (shown on second line)
          if (!instituicao) {
            instituicao = nomeEvento;
          } else if (instituicao !== nomeEvento) {
            // Has both institution and event name — append event
            instituicao = `${instituicao} • ${nomeEvento}`;
          }
        }
      }
    }
  }

  return { titulo, instituicao, ano, carga_horaria, descricao };
}

/**
 * Extracts entry data from a Pattern B element (attributes directly on element).
 * 
 * @param {Element} element
 * @returns {{titulo: string, instituicao: string, ano: string, carga_horaria: string, descricao: string}}
 */
function extractPatternB(element) {
  const titulo = getFirstAttr(element, TITLE_ATTRS);
  const instituicao = getFirstAttr(element, INSTITUTION_ATTRS);
  const ano = getFirstAttr(element, YEAR_ATTRS);
  const carga_horaria = getFirstAttr(element, HOURS_ATTRS);
  const descricao = element.getAttribute('OUTRAS-INFORMACOES') || '';

  return { titulo, instituicao, ano, carga_horaria, descricao };
}

/**
 * Checks whether an element is inside a section we should skip.
 * 
 * @param {Element} element
 * @returns {boolean}
 */
function isInSkippedSection(element) {
  let parent = element.parentNode;
  while (parent) {
    if (parent.tagName && SKIP_SECTIONS.has(parent.tagName)) {
      return true;
    }
    parent = parent.parentNode;
  }
  return false;
}

/**
 * Checks if an element is a direct child of a Pattern B parent section.
 * Returns the parent section name if yes, null otherwise.
 * 
 * @param {Element} element
 * @returns {string|null}
 */
function getPatternBParent(element) {
  const parent = element.parentNode;
  if (parent && parent.tagName && PATTERN_B_PARENTS.has(parent.tagName)) {
    return parent.tagName;
  }
  return null;
}

/**
 * Creates a standard entry object.
 * 
 * @param {{titulo: string, instituicao: string, ano: string, carga_horaria: string, descricao: string}} data
 * @param {string} categoryId
 * @returns {object}
 */
function createEntry(data, categoryId) {
  return {
    id: generateUUID(),
    titulo: data.titulo,
    instituicao: data.instituicao,
    ano: data.ano,
    carga_horaria: data.carga_horaria,
    categoria: categoryId,
    status: 'pendente',
    oculta: false,
    arquivo_drive_id: null,
    arquivo_nome: null,
    confianca: null,
    data_mapeamento: null,
    descricao: data.descricao || '',
  };
}

/**
 * Registers a category in the map if not already present and returns it.
 * 
 * @param {Map} categoriesMap
 * @param {string} categoryName
 * @returns {object}
 */
function ensureCategory(categoriesMap, categoryName) {
  if (!categoriesMap.has(categoryName)) {
    categoriesMap.set(categoryName, {
      id: generateUUID(),
      nome_xml: categoryName,
      nome_display: formatCategoryName(categoryName),
      ativa: false,
      pasta_drive_id: null,
    });
  }
  return categoriesMap.get(categoryName);
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
  const categoriesMap = new Map();

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

  // Track which elements were already processed (to avoid double-counting)
  const processedElements = new Set();

  // === PASS 1: Pattern B — Direct-attribute elements in known parent sections ===
  // Process FORMACAO-ACADEMICA-TITULACAO children
  try {
    const formacaoTitulacao = curriculo.getElementsByTagName('FORMACAO-ACADEMICA-TITULACAO');
    for (let fi = 0; fi < formacaoTitulacao.length; fi++) {
      const section = formacaoTitulacao[fi];
      const children = section.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // Skip meta elements like PALAVRAS-CHAVE, AREAS-DO-CONHECIMENTO
        if (child.tagName.startsWith('PALAVRAS') || child.tagName.startsWith('AREAS')) continue;

        const data = extractPatternB(child);
        // Use tag name as title fallback if no title found
        if (!data.titulo) {
          data.titulo = child.getAttribute('NOME-CURSO') || child.tagName;
        }

        const categoryName = getCategoryForPatternB(child, 'FORMACAO-ACADEMICA-TITULACAO');
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry(data, category.id));
        processedElements.add(child);
      }
    }
  } catch (e) {
    // Silently skip if section not found
  }

  // === PASS 2: Pattern A — Elements with DADOS-BASICOS-* children ===
  const allElements = curriculo.getElementsByTagName('*');

  for (let i = 0; i < allElements.length; i++) {
    const element = allElements[i];

    // Skip if already processed in Pattern B
    if (processedElements.has(element)) continue;

    // Skip elements inside skipped sections
    if (isInSkippedSection(element)) continue;

    // Check if this element has a DADOS-BASICOS-* child → Pattern A
    const children = element.children;
    let hasDadosBasicos = false;
    for (let j = 0; j < children.length; j++) {
      if (children[j].tagName.startsWith('DADOS-BASICOS')) {
        hasDadosBasicos = true;
        break;
      }
    }

    if (!hasDadosBasicos) continue;

    // Extract entry data
    const categoryName = getCategoryForPatternA(element);
    const data = extractPatternA(element);

    // If no title from DADOS-BASICOS-*, try element's own attributes as fallback
    if (!data.titulo) {
      data.titulo = getFirstAttr(element, TITLE_ATTRS) || element.tagName;
    }

    const category = ensureCategory(categoriesMap, categoryName);
    entries.push(createEntry(data, category.id));
    processedElements.add(element);
  }

  // === PASS 3: Pattern B — FORMACAO-COMPLEMENTAR direct-attribute entries (if no DADOS-BASICOS-*) ===
  // Some FORMACAO-COMPLEMENTAR entries might use direct attributes (older XML formats)
  try {
    const formacaoComplementarSections = curriculo.getElementsByTagName('FORMACAO-COMPLEMENTAR');
    for (let fi = 0; fi < formacaoComplementarSections.length; fi++) {
      const section = formacaoComplementarSections[fi];
      const children = section.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (processedElements.has(child)) continue;

        // Check if this child has DADOS-BASICOS-* children (already handled in Pass 2)
        let hasDados = false;
        const grandchildren = child.children;
        for (let j = 0; j < grandchildren.length; j++) {
          if (grandchildren[j].tagName.startsWith('DADOS-BASICOS')) {
            hasDados = true;
            break;
          }
        }
        if (hasDados) continue; // Already handled

        // Pattern B: attributes directly on element
        const data = extractPatternB(child);
        if (!data.titulo && !data.instituicao) continue; // No meaningful data

        const categoryName = child.tagName;
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry(data, category.id));
        processedElements.add(child);
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 4: PARTICIPACAO-EM-EVENTOS-CONGRESSOS direct entries ===
  try {
    const eventSections = curriculo.getElementsByTagName('PARTICIPACAO-EM-EVENTOS-CONGRESSOS');
    for (let fi = 0; fi < eventSections.length; fi++) {
      const section = eventSections[fi];
      const children = section.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (processedElements.has(child)) continue;

        // Check if already processed via Pattern A
        let hasDados = false;
        const grandchildren = child.children;
        for (let j = 0; j < grandchildren.length; j++) {
          if (grandchildren[j].tagName.startsWith('DADOS-BASICOS')) {
            hasDados = true;
            break;
          }
        }
        if (hasDados) continue; // Already handled in Pass 2

        // Direct attributes pattern
        const titulo = child.getAttribute('NOME-DO-EVENTO') || child.getAttribute('TITULO') || '';
        const ano = child.getAttribute('ANO') || '';
        const instituicao = child.getAttribute('NOME-INSTITUICAO') || '';
        const carga_horaria = child.getAttribute('CARGA-HORARIA') || '';

        if (!titulo && !ano) continue; // No meaningful data

        const categoryName = child.tagName;
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry({ titulo, instituicao, ano, carga_horaria }, category.id));
        processedElements.add(child);
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 5: ORIENTACOES-CONCLUIDAS direct entries (if not already processed) ===
  try {
    const orientSections = curriculo.getElementsByTagName('ORIENTACOES-CONCLUIDAS');
    for (let fi = 0; fi < orientSections.length; fi++) {
      const section = orientSections[fi];
      const children = section.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (processedElements.has(child)) continue;

        // Check if already processed via Pattern A
        let hasDados = false;
        const grandchildren = child.children;
        for (let j = 0; j < grandchildren.length; j++) {
          if (grandchildren[j].tagName.startsWith('DADOS-BASICOS')) {
            hasDados = true;
            break;
          }
        }
        if (hasDados) continue;

        // Direct attributes pattern
        const data = extractPatternB(child);
        if (!data.titulo && !data.instituicao) continue;

        const categoryName = child.tagName;
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry(data, category.id));
        processedElements.add(child);
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 6: PARTICIPACAO-EM-BANCA-TRABALHOS-CONCLUSAO entries ===
  try {
    const bancaSections = curriculo.getElementsByTagName('PARTICIPACAO-EM-BANCA-TRABALHOS-CONCLUSAO');
    for (let fi = 0; fi < bancaSections.length; fi++) {
      const section = bancaSections[fi];
      const children = section.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (processedElements.has(child)) continue;

        let hasDados = false;
        const grandchildren = child.children;
        for (let j = 0; j < grandchildren.length; j++) {
          if (grandchildren[j].tagName.startsWith('DADOS-BASICOS')) {
            hasDados = true;
            break;
          }
        }
        if (hasDados) continue;

        const data = extractPatternB(child);
        if (!data.titulo && !data.instituicao) continue;

        const categoryName = child.tagName;
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry(data, category.id));
        processedElements.add(child);
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 7: ATUACOES-PROFISSIONAIS — Vínculos de trabalho ===
  try {
    const atuacoesSections = curriculo.getElementsByTagName('ATUACOES-PROFISSIONAIS');
    for (let fi = 0; fi < atuacoesSections.length; fi++) {
      const section = atuacoesSections[fi];
      const atuacoes = section.getElementsByTagName('ATUACAO-PROFISSIONAL');
      
      for (let ai = 0; ai < atuacoes.length; ai++) {
        const atuacao = atuacoes[ai];
        const nomeInstituicao = atuacao.getAttribute('NOME-INSTITUICAO') || '';
        
        // Each ATUACAO-PROFISSIONAL can have multiple VINCULOS
        const vinculos = atuacao.getElementsByTagName('VINCULOS');
        for (let vi = 0; vi < vinculos.length; vi++) {
          const vinculo = vinculos[vi];
          if (processedElements.has(vinculo)) continue;
          
          const cargo = vinculo.getAttribute('OUTRO-ENQUADRAMENTO-FUNCIONAL-INFORMADO') || 
                        vinculo.getAttribute('ENQUADRAMENTO-FUNCIONAL') || '';
          const anoInicio = vinculo.getAttribute('ANO-INICIO') || '';
          const anoFim = vinculo.getAttribute('ANO-FIM') || '';
          const cargaHoraria = vinculo.getAttribute('CARGA-HORARIA-SEMANAL') || '';
          const descricao = vinculo.getAttribute('OUTRAS-INFORMACOES') || '';
          
          // Build title from cargo + institution
          const titulo = cargo ? `${cargo} — ${nomeInstituicao}` : nomeInstituicao;
          const ano = anoFim || anoInicio; // Use end year if available, else start
          
          if (!titulo || titulo === ' — ') continue; // Skip empty entries
          
          const categoryName = 'ATUACAO-PROFISSIONAL';
          const category = ensureCategory(categoriesMap, categoryName);
          entries.push(createEntry({ titulo, instituicao: nomeInstituicao, ano, carga_horaria: cargaHoraria, descricao }, category.id));
          processedElements.add(vinculo);
        }
        
        // Also extract ATIVIDADES-DE-CONSELHO-COMISSAO-E-CONSULTORIA if present
        const conselhos = atuacao.getElementsByTagName('CONSELHO-COMISSAO-E-CONSULTORIA');
        for (let ci = 0; ci < conselhos.length; ci++) {
          const conselho = conselhos[ci];
          if (processedElements.has(conselho)) continue;
          
          const especificacao = conselho.getAttribute('ESPECIFICACAO') || '';
          const anoInicioC = conselho.getAttribute('ANO-INICIO') || '';
          const anoFimC = conselho.getAttribute('ANO-FIM') || '';
          
          if (!especificacao) continue;
          
          const categoryName = 'CONSELHO-COMISSAO-E-CONSULTORIA';
          const category = ensureCategory(categoriesMap, categoryName);
          entries.push(createEntry({ 
            titulo: especificacao, 
            instituicao: nomeInstituicao, 
            ano: anoFimC || anoInicioC, 
            carga_horaria: '' 
          }, category.id));
          processedElements.add(conselho);
        }
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 8: PREMIOS-TITULOS — Prêmios e títulos/certificações ===
  try {
    const premiosSections = curriculo.getElementsByTagName('PREMIOS-TITULOS');
    for (let fi = 0; fi < premiosSections.length; fi++) {
      const section = premiosSections[fi];
      const premios = section.getElementsByTagName('PREMIO-TITULO');
      
      for (let pi = 0; pi < premios.length; pi++) {
        const premio = premios[pi];
        if (processedElements.has(premio)) continue;
        
        const titulo = premio.getAttribute('NOME-DO-PREMIO-OU-TITULO') || '';
        const instituicao = premio.getAttribute('NOME-DA-ENTIDADE-PROMOTORA') || '';
        const ano = premio.getAttribute('ANO-DA-PREMIACAO') || '';
        
        if (!titulo) continue;
        
        const categoryName = 'PREMIO-TITULO';
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry({ titulo, instituicao, ano, carga_horaria: '' }, category.id));
        processedElements.add(premio);
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 9: PROJETO-DE-PESQUISA — Projetos de pesquisa ===
  try {
    const projetos = curriculo.getElementsByTagName('PROJETO-DE-PESQUISA');
    for (let pi = 0; pi < projetos.length; pi++) {
      const projeto = projetos[pi];
      if (processedElements.has(projeto)) continue;

      const titulo = projeto.getAttribute('NOME-DO-PROJETO') || '';
      const anoInicio = projeto.getAttribute('ANO-INICIO') || '';
      const anoFim = projeto.getAttribute('ANO-FIM') || '';
      const descricao = projeto.getAttribute('DESCRICAO-DO-PROJETO') || '';
      const situacao = projeto.getAttribute('SITUACAO') || '';

      // Use project name as title, fallback to description
      const tituloFinal = titulo || descricao || 'Projeto de Pesquisa';
      const ano = anoFim || anoInicio;

      if (!tituloFinal || tituloFinal === 'Projeto de Pesquisa') continue;

      const categoryName = 'PROJETO-DE-PESQUISA';
      const category = ensureCategory(categoriesMap, categoryName);
      entries.push(createEntry({ titulo: tituloFinal, instituicao: '', ano, carga_horaria: '' }, category.id));
      processedElements.add(projeto);
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 10: PARTICIPACAO-EM-BANCA-JULGADORA — Bancas julgadoras (if exists) ===
  try {
    const bancaJulgadora = curriculo.getElementsByTagName('PARTICIPACAO-EM-BANCA-JULGADORA');
    for (let fi = 0; fi < bancaJulgadora.length; fi++) {
      const section = bancaJulgadora[fi];
      const children = section.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (processedElements.has(child)) continue;

        let hasDados = false;
        const grandchildren = child.children;
        for (let j = 0; j < grandchildren.length; j++) {
          if (grandchildren[j].tagName.startsWith('DADOS-BASICOS')) {
            hasDados = true;
            break;
          }
        }
        if (hasDados) continue;

        const data = extractPatternB(child);
        if (!data.titulo && !data.instituicao) continue;

        const categoryName = child.tagName;
        const category = ensureCategory(categoriesMap, categoryName);
        entries.push(createEntry(data, category.id));
        processedElements.add(child);
      }
    }
  } catch (e) {
    // Silently skip
  }

  // === PASS 11: OUTRAS-INFORMACOES-RELEVANTES — Informações adicionais ===
  try {
    const outrasInfos = curriculo.getElementsByTagName('INFORMACOES-ADICIONAIS');
    for (let fi = 0; fi < outrasInfos.length; fi++) {
      const info = outrasInfos[fi];
      if (processedElements.has(info)) continue;

      const descricao = info.getAttribute('DESCRICAO-INFORMACOES-ADICIONAIS') || '';
      if (!descricao) continue;

      // Truncate long descriptions for display
      const tituloFinal = descricao.length > 120 ? descricao.substring(0, 120) + '...' : descricao;

      const categoryName = 'INFORMACOES-ADICIONAIS';
      const category = ensureCategory(categoriesMap, categoryName);
      entries.push(createEntry({ titulo: tituloFinal, instituicao: '', ano: '', carga_horaria: '' }, category.id));
      processedElements.add(info);
    }
  } catch (e) {
    // Silently skip
  }

  // Deduplicate entries by titulo + ano + instituicao + categoria + carga_horaria + descricao
  const seen = new Set();
  const deduplicatedEntries = [];
  for (const entry of entries) {
    const descShort = (entry.descricao || '').substring(0, 100).toLowerCase().trim();
    const key = `${(entry.titulo || '').toLowerCase().trim()}|${entry.ano || ''}|${(entry.instituicao || '').toLowerCase().trim()}|${entry.categoria}|${entry.carga_horaria || ''}|${descShort}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicatedEntries.push(entry);
    }
  }

  if (deduplicatedEntries.length === 0) {
    errors.push('Nenhuma entrada acadêmica encontrada no XML.');
  }

  const categories = Array.from(categoriesMap.values());

  return { entries: deduplicatedEntries, categories, errors };
}
