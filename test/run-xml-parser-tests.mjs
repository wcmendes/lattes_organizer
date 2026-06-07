/**
 * Node.js test runner for xml-parser.js
 * Tests XML parsing, category name formatting, slug generation, and file validation.
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.10
 */

// Minimal DOM/DOMParser simulation for Node.js environment
// Uses a lightweight XML parser implementation for testing

class MinimalAttr {
  constructor(name, value) { this.name = name; this.value = value; }
}

class MinimalElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
  }
  get children() { return this.childNodes.filter(n => n instanceof MinimalElement); }
  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    // Simple tag name selector only
    const tag = selector.toUpperCase();
    return this._findByTag(tag);
  }
  _findByTag(tag) {
    for (const child of this.children) {
      if (child.tagName === tag) return child;
      const found = child._findByTag(tag);
      if (found) return found;
    }
    return null;
  }
  getElementsByTagName(tag) {
    const results = [];
    this._collectByTag(tag === '*' ? null : tag.toUpperCase(), results);
    return results;
  }
  _collectByTag(tag, results) {
    for (const child of this.children) {
      if (tag === null || child.tagName === tag) results.push(child);
      child._collectByTag(tag, results);
    }
  }
  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
}

class MinimalDocument extends MinimalElement {
  constructor() { super('#document'); this.documentElement = null; }
  querySelector(selector) {
    if (this.documentElement) {
      if (this.documentElement.tagName === selector.toUpperCase()) return this.documentElement;
      return this.documentElement._findByTag(selector.toUpperCase());
    }
    return null;
  }
  getElementsByTagName(tag) {
    if (!this.documentElement) return [];
    const results = [];
    const upperTag = tag === '*' ? null : tag.toUpperCase();
    if (upperTag === null || this.documentElement.tagName === upperTag) results.push(this.documentElement);
    this.documentElement._collectByTag(upperTag, results);
    return results;
  }
}

/**
 * Minimal XML parser for testing purposes.
 * Parses well-formed XML into MinimalElement tree.
 */
function parseXmlString(str) {
  const doc = new MinimalDocument();
  const stack = [doc];
  let i = 0;

  while (i < str.length) {
    if (str[i] === '<') {
      // Check for XML declaration <?...?>
      if (str.substring(i, i + 2) === '<?') {
        const end = str.indexOf('?>', i);
        if (end === -1) { 
          // Parse error
          const errDoc = new MinimalDocument();
          const errEl = new MinimalElement('PARSERERROR');
          errDoc.appendChild(errEl);
          errDoc.documentElement = errEl;
          return errDoc;
        }
        i = end + 2;
        continue;
      }
      // Check for comment <!--...-->
      if (str.substring(i, i + 4) === '<!--') {
        const end = str.indexOf('-->', i);
        i = end === -1 ? str.length : end + 3;
        continue;
      }
      // Check for closing tag
      if (str[i + 1] === '/') {
        const end = str.indexOf('>', i);
        if (end === -1) break;
        stack.pop();
        i = end + 1;
        continue;
      }
      // Opening tag
      const end = str.indexOf('>', i);
      if (end === -1) break;
      const tagContent = str.substring(i + 1, end).trim();
      const selfClosing = tagContent.endsWith('/');
      const cleanContent = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;
      
      // Extract tag name and attributes
      const parts = cleanContent.match(/^(\S+)([\s\S]*)$/);
      if (!parts) { i = end + 1; continue; }
      
      const tagName = parts[1].toUpperCase();
      const attrsStr = parts[2] || '';
      
      const element = new MinimalElement(tagName);
      
      // Parse attributes: NAME="VALUE"
      const attrRegex = /([A-Za-z_][\w\-:.]*)\s*=\s*"([^"]*)"/g;
      let match;
      while ((match = attrRegex.exec(attrsStr)) !== null) {
        element.setAttribute(match[1].toUpperCase(), match[2]);
      }
      
      const parent = stack[stack.length - 1];
      parent.appendChild(element);
      
      if (!doc.documentElement && parent === doc) {
        doc.documentElement = element;
      }
      
      if (!selfClosing) {
        stack.push(element);
      }
      
      i = end + 1;
    } else {
      // Text content - skip
      const nextTag = str.indexOf('<', i);
      i = nextTag === -1 ? str.length : nextTag;
    }
  }
  
  return doc;
}

// DOMParser mock
class MockDOMParser {
  parseFromString(str, mimeType) {
    try {
      // Check for obviously invalid XML
      if (!str || typeof str !== 'string') {
        const errDoc = new MinimalDocument();
        const errEl = new MinimalElement('PARSERERROR');
        errDoc.appendChild(errEl);
        errDoc.documentElement = errEl;
        return errDoc;
      }
      
      // Quick check: if it has unbalanced tags or invalid structure
      const trimmed = str.trim();
      if (!trimmed.startsWith('<')) {
        const errDoc = new MinimalDocument();
        const errEl = new MinimalElement('PARSERERROR');
        errDoc.appendChild(errEl);
        errDoc.documentElement = errEl;
        return errDoc;
      }
      
      const doc = parseXmlString(str);
      
      // Check if parsing produced a parsererror
      if (doc.documentElement && doc.documentElement.tagName === 'PARSERERROR') {
        return doc;
      }
      
      // Validate: check for obviously broken XML by looking for unclosed structures
      if (!doc.documentElement) {
        const errDoc = new MinimalDocument();
        const errEl = new MinimalElement('PARSERERROR');
        errDoc.appendChild(errEl);
        errDoc.documentElement = errEl;
        return errDoc;
      }
      
      return doc;
    } catch (e) {
      const errDoc = new MinimalDocument();
      const errEl = new MinimalElement('PARSERERROR');
      errDoc.appendChild(errEl);
      errDoc.documentElement = errEl;
      return errDoc;
    }
  }
}

globalThis.DOMParser = MockDOMParser;
globalThis.window = { location: { hash: '' } };
globalThis.document = { getElementById() { return null; } };
// crypto.randomUUID() is available natively in Node.js 19+

const { parseXml, formatCategoryName, categorySlug, validateFile } = await import('../js/core/xml-parser.js');

// --- Test Framework ---
let passed = 0;
let failed = 0;

function describe(name, fn) {
  console.log(`\n  ${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
    console.log(`    \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`    \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      \x1b[33m${e.message}\x1b[0m`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}" but got "${actual}"`);
  }
}

// --- Sample XML Data ---
const VALID_LATTES_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<CURRICULO-VITAE>
  <DADOS-COMPLEMENTARES>
    <FORMACAO-COMPLEMENTAR>
      <FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO>
        <DADOS-BASICOS-DE-CURTA-DURACAO TITULO="Curso de Python Avançado" ANO="2021"/>
        <DETALHAMENTO-DE-CURTA-DURACAO NOME-INSTITUICAO="Universidade Federal" CARGA-HORARIA="40"/>
      </FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO>
      <FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO>
        <DADOS-BASICOS-DE-CURTA-DURACAO TITULO="Machine Learning Basics" ANO="2022"/>
        <DETALHAMENTO-DE-CURTA-DURACAO NOME-INSTITUICAO="MIT Online" CARGA-HORARIA="60"/>
      </FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO>
      <FORMACAO-COMPLEMENTAR-EXTENSAO-UNIVERSITARIA>
        <DADOS-BASICOS-DE-EXTENSAO-UNIVERSITARIA TITULO="Extensão em Educação" ANO="2020"/>
        <DETALHAMENTO-DE-EXTENSAO-UNIVERSITARIA NOME-INSTITUICAO="UFMG" CARGA-HORARIA="120"/>
      </FORMACAO-COMPLEMENTAR-EXTENSAO-UNIVERSITARIA>
    </FORMACAO-COMPLEMENTAR>
    <PARTICIPACAO-EM-EVENTOS-CONGRESSOS>
      <PARTICIPACAO-EM-CONGRESSO>
        <DADOS-BASICOS-DA-PARTICIPACAO-EM-CONGRESSO TITULO="Congresso de IA" ANO="2023"/>
        <DETALHAMENTO-DA-PARTICIPACAO-EM-CONGRESSO NOME-INSTITUICAO="SBC" CARGA-HORARIA="16"/>
      </PARTICIPACAO-EM-CONGRESSO>
    </PARTICIPACAO-EM-EVENTOS-CONGRESSOS>
  </DADOS-COMPLEMENTARES>
</CURRICULO-VITAE>`;

const EMPTY_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<CURRICULO-VITAE>
  <DADOS-COMPLEMENTARES>
  </DADOS-COMPLEMENTARES>
</CURRICULO-VITAE>`;

const MISSING_ATTRIBUTES_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<CURRICULO-VITAE>
  <DADOS-COMPLEMENTARES>
    <FORMACAO-COMPLEMENTAR>
      <FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO>
        <DADOS-BASICOS-DE-CURTA-DURACAO TITULO="Curso sem detalhes"/>
        <DETALHAMENTO-DE-CURTA-DURACAO/>
      </FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO>
    </FORMACAO-COMPLEMENTAR>
  </DADOS-COMPLEMENTARES>
</CURRICULO-VITAE>`;

const INVALID_XML = `This is not XML at all, just plain text without any tags`;

const NO_CURRICULO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<root><data>some content</data></root>`;

// --- Tests ---

describe('validateFile — File validation (Req 2.2)', () => {
  it('should reject null file', () => {
    const result = validateFile(null);
    assertEqual(result.valid, false);
    assert(result.error !== null);
  });

  it('should reject file without .xml extension', () => {
    const result = validateFile({ name: 'curriculo.pdf', size: 1000 });
    assertEqual(result.valid, false);
    assert(result.error.includes('.xml'));
  });

  it('should reject file with .txt extension', () => {
    const result = validateFile({ name: 'data.txt', size: 1000 });
    assertEqual(result.valid, false);
  });

  it('should accept file with .xml extension and valid size', () => {
    const result = validateFile({ name: 'curriculo.xml', size: 5000 });
    assertEqual(result.valid, true);
    assertEqual(result.error, null);
  });

  it('should accept file with .XML extension (case insensitive)', () => {
    const result = validateFile({ name: 'curriculo.XML', size: 5000 });
    assertEqual(result.valid, true);
  });

  it('should reject file exceeding 20MB', () => {
    const result = validateFile({ name: 'large.xml', size: 21 * 1024 * 1024 });
    assertEqual(result.valid, false);
    assert(result.error.includes('20MB'));
  });

  it('should accept file exactly 20MB', () => {
    const result = validateFile({ name: 'exact.xml', size: 20 * 1024 * 1024 });
    assertEqual(result.valid, true);
  });
});

describe('formatCategoryName — Category name formatting (Req 2.10)', () => {
  it('should convert FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO correctly', () => {
    const result = formatCategoryName('FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO');
    assertEqual(result, 'Formação Complementar — Curso De Curta Duração');
  });

  it('should convert FORMACAO-COMPLEMENTAR-EXTENSAO-UNIVERSITARIA correctly', () => {
    const result = formatCategoryName('FORMACAO-COMPLEMENTAR-EXTENSAO-UNIVERSITARIA');
    assertEqual(result, 'Formação Complementar — Extensão Universitária');
  });

  it('should convert PARTICIPACAO-EM-EVENTOS-CONGRESSOS-PARTICIPACAO-EM-CONGRESSO', () => {
    const result = formatCategoryName('PARTICIPACAO-EM-EVENTOS-CONGRESSOS-PARTICIPACAO-EM-CONGRESSO');
    assert(result.includes('Participação'));
    assert(result.includes('—'));
  });

  it('should handle single word', () => {
    const result = formatCategoryName('CONGRESSO');
    assertEqual(result, 'Congresso');
  });

  it('should handle empty string', () => {
    const result = formatCategoryName('');
    assertEqual(result, '');
  });

  it('should handle null/undefined', () => {
    assertEqual(formatCategoryName(null), '');
    assertEqual(formatCategoryName(undefined), '');
  });

  it('should apply Portuguese diacritics to known words', () => {
    const result = formatCategoryName('FORMACAO');
    assertEqual(result, 'Formação');
  });

  it('should title-case unknown words', () => {
    const result = formatCategoryName('UNKNOWN-WORD');
    assertEqual(result, 'Unknown Word');
  });

  it('should handle mixed known and unknown words', () => {
    const result = formatCategoryName('PRODUCAO-BIBLIOGRAFICA');
    assert(result.includes('Produção'));
    assert(result.includes('Bibliográfica'));
  });
});

describe('categorySlug — Slug generation (Req 2.5)', () => {
  it('should lowercase the XML section name', () => {
    const result = categorySlug('FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO');
    assertEqual(result, 'formacao-complementar-curso-de-curta-duracao');
  });

  it('should handle single word', () => {
    assertEqual(categorySlug('CONGRESSO'), 'congresso');
  });

  it('should handle empty string', () => {
    assertEqual(categorySlug(''), '');
  });

  it('should handle null/undefined', () => {
    assertEqual(categorySlug(null), '');
    assertEqual(categorySlug(undefined), '');
  });

  it('should preserve hyphens', () => {
    const result = categorySlug('A-B-C');
    assertEqual(result, 'a-b-c');
  });
});

describe('parseXml — Valid XML parsing (Req 2.2, 2.4, 2.5)', () => {
  it('should extract all entries from valid XML', () => {
    const result = parseXml(VALID_LATTES_XML);
    assertEqual(result.entries.length, 4);
    assertEqual(result.errors.length, 0);
  });

  it('should extract correct titles', () => {
    const result = parseXml(VALID_LATTES_XML);
    const titles = result.entries.map(e => e.titulo);
    assert(titles.includes('Curso de Python Avançado'));
    assert(titles.includes('Machine Learning Basics'));
    assert(titles.includes('Extensão em Educação'));
    assert(titles.includes('Congresso de IA'));
  });

  it('should extract correct institutions', () => {
    const result = parseXml(VALID_LATTES_XML);
    const institutions = result.entries.map(e => e.instituicao);
    assert(institutions.includes('Universidade Federal'));
    assert(institutions.includes('MIT Online'));
    assert(institutions.includes('UFMG'));
    assert(institutions.includes('SBC'));
  });

  it('should extract correct years', () => {
    const result = parseXml(VALID_LATTES_XML);
    const years = result.entries.map(e => e.ano);
    assert(years.includes('2021'));
    assert(years.includes('2022'));
    assert(years.includes('2020'));
    assert(years.includes('2023'));
  });

  it('should extract correct carga_horaria', () => {
    const result = parseXml(VALID_LATTES_XML);
    const hours = result.entries.map(e => e.carga_horaria);
    assert(hours.includes('40'));
    assert(hours.includes('60'));
    assert(hours.includes('120'));
    assert(hours.includes('16'));
  });

  it('should discover categories dynamically', () => {
    const result = parseXml(VALID_LATTES_XML);
    assertEqual(result.categories.length, 3);
    const xmlNames = result.categories.map(c => c.nome_xml);
    assert(xmlNames.includes('FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO'));
    assert(xmlNames.includes('FORMACAO-COMPLEMENTAR-EXTENSAO-UNIVERSITARIA'));
    assert(xmlNames.includes('PARTICIPACAO-EM-CONGRESSO'));
  });

  it('should set all categories as inactive by default', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.categories.forEach(cat => {
      assertEqual(cat.ativa, false);
    });
  });

  it('should generate UUIDs for entries', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.entries.forEach(entry => {
      assert(entry.id && entry.id.length > 0, 'Entry should have an id');
    });
  });

  it('should generate UUIDs for categories', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.categories.forEach(cat => {
      assert(cat.id && cat.id.length > 0, 'Category should have an id');
    });
  });

  it('should set entry status to pendente', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.entries.forEach(entry => {
      assertEqual(entry.status, 'pendente');
    });
  });

  it('should set entry oculta to false', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.entries.forEach(entry => {
      assertEqual(entry.oculta, false);
    });
  });

  it('should link entries to their category by id', () => {
    const result = parseXml(VALID_LATTES_XML);
    const categoryIds = result.categories.map(c => c.id);
    result.entries.forEach(entry => {
      assert(categoryIds.includes(entry.categoria), `Entry "${entry.titulo}" should reference a valid category id`);
    });
  });

  it('should generate display names for categories', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.categories.forEach(cat => {
      assert(cat.nome_display && cat.nome_display.length > 0, `Category ${cat.nome_xml} should have nome_display`);
    });
  });
});

describe('parseXml — Missing attributes (Req 2.4)', () => {
  it('should use empty string for missing attributes', () => {
    const result = parseXml(MISSING_ATTRIBUTES_XML);
    assertEqual(result.entries.length, 1);
    const entry = result.entries[0];
    assertEqual(entry.titulo, 'Curso sem detalhes');
    assertEqual(entry.instituicao, '');
    assertEqual(entry.ano, '');
    assertEqual(entry.carga_horaria, '');
  });
});

describe('parseXml — Error handling (Req 2.3)', () => {
  it('should return error for invalid XML content', () => {
    const result = parseXml(INVALID_XML);
    assertEqual(result.entries.length, 0);
    assertEqual(result.categories.length, 0);
    assert(result.errors.length > 0);
    assert(result.errors[0].includes('XML válido') || result.errors[0].includes('parsear'));
  });

  it('should return error for non-Lattes XML', () => {
    const result = parseXml(NO_CURRICULO_XML);
    assertEqual(result.entries.length, 0);
    assertEqual(result.categories.length, 0);
    assert(result.errors.length > 0);
    assert(result.errors[0].includes('CURRICULO-VITAE'));
  });

  it('should return error for empty string', () => {
    const result = parseXml('');
    assert(result.errors.length > 0);
  });

  it('should return error for null', () => {
    const result = parseXml(null);
    assert(result.errors.length > 0);
  });

  it('should return error for undefined', () => {
    const result = parseXml(undefined);
    assert(result.errors.length > 0);
  });

  it('should return warning when no entries found in valid structure', () => {
    const result = parseXml(EMPTY_XML);
    assertEqual(result.entries.length, 0);
    assert(result.errors.length > 0);
    assert(result.errors.some(e => e.includes('Nenhuma entrada')));
  });
});

describe('parseXml — Entry field completeness', () => {
  it('should ensure all entries have all required fields', () => {
    const result = parseXml(VALID_LATTES_XML);
    const requiredFields = ['id', 'titulo', 'instituicao', 'ano', 'carga_horaria', 'categoria', 'status', 'oculta', 'arquivo_drive_id', 'arquivo_nome', 'confianca', 'data_mapeamento'];
    result.entries.forEach(entry => {
      requiredFields.forEach(field => {
        assert(field in entry, `Entry missing field: ${field}`);
      });
    });
  });

  it('should ensure entries have string type for text fields', () => {
    const result = parseXml(VALID_LATTES_XML);
    result.entries.forEach(entry => {
      assertEqual(typeof entry.titulo, 'string');
      assertEqual(typeof entry.instituicao, 'string');
      assertEqual(typeof entry.ano, 'string');
      assertEqual(typeof entry.carga_horaria, 'string');
    });
  });
});

// --- Summary ---
console.log(`\n  \x1b[${failed > 0 ? '31' : '32'}m${passed} passing, ${failed} failing\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
