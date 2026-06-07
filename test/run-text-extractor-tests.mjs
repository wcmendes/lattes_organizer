/**
 * Node.js test runner for text-extractor.js
 * Tests text extraction from PDF, image, and type dispatch.
 * Requirements: 4.1, 4.2, 4.9
 */

// --- Mock globals for PDF.js and Tesseract.js ---

// Default PDF.js mock (successful extraction)
function createPdfjsMock(options = {}) {
  const {
    pages = [{ items: [{ str: 'Texto de teste do PDF' }] }],
    passwordProtected = false,
    corrupted = false,
    emptyText = false
  } = options;

  return {
    getDocument(config) {
      return {
        promise: (async () => {
          if (passwordProtected) {
            const err = new Error('PDF is password protected');
            err.name = 'PasswordException';
            throw err;
          }
          if (corrupted) {
            throw new Error('Invalid PDF structure');
          }

          const pdfPages = emptyText
            ? [{ items: [{ str: '' }] }]
            : pages;

          return {
            numPages: pdfPages.length,
            getPage(num) {
              return Promise.resolve({
                getTextContent() {
                  return Promise.resolve({ items: pdfPages[num - 1].items });
                }
              });
            }
          };
        })()
      };
    }
  };
}

// Default Tesseract.js mock (successful OCR)
function createTesseractMock(options = {}) {
  const {
    text = 'Texto reconhecido via OCR',
    shouldFail = false,
    emptyText = false
  } = options;

  return {
    async recognize(imageData, lang) {
      if (shouldFail) {
        throw new Error('OCR processing failed');
      }
      return {
        data: {
          text: emptyText ? '' : text
        }
      };
    }
  };
}

// Set defaults
globalThis.pdfjsLib = createPdfjsMock();
globalThis.Tesseract = createTesseractMock();

const { extractFromPdf, extractFromImage, extractText } = await import('../js/core/text-extractor.js');

// --- Test Framework ---
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'describe', name, fn });
}

function it(name, fn) {
  tests.push({ type: 'it', name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}" but got "${actual}"`);
  }
}

async function assertRejects(asyncFn, expectedMessage) {
  try {
    await asyncFn();
    throw new Error(`Expected function to throw, but it did not`);
  } catch (e) {
    if (e.message === 'Expected function to throw, but it did not') throw e;
    if (expectedMessage && !e.message.includes(expectedMessage)) {
      throw new Error(`Expected error message to include "${expectedMessage}" but got "${e.message}"`);
    }
  }
}

// --- Tests ---
describe('extractFromPdf — Successful extraction (Req 4.1)', () => {
  it('should extract text from a single-page PDF', async () => {
    globalThis.pdfjsLib = createPdfjsMock({
      pages: [{ items: [{ str: 'Certificado de conclusão' }] }]
    });
    const result = await extractFromPdf(new Uint8Array([1, 2, 3]));
    assertEqual(result, 'Certificado de conclusão');
  });

  it('should concatenate text from multiple pages', async () => {
    globalThis.pdfjsLib = createPdfjsMock({
      pages: [
        { items: [{ str: 'Página 1' }] },
        { items: [{ str: 'Página 2' }] },
        { items: [{ str: 'Página 3' }] }
      ]
    });
    const result = await extractFromPdf(new Uint8Array([1, 2, 3]));
    assert(result.includes('Página 1'));
    assert(result.includes('Página 2'));
    assert(result.includes('Página 3'));
  });

  it('should join text items within a page with spaces', async () => {
    globalThis.pdfjsLib = createPdfjsMock({
      pages: [{ items: [{ str: 'Palavra1' }, { str: 'Palavra2' }, { str: 'Palavra3' }] }]
    });
    const result = await extractFromPdf(new Uint8Array([1, 2, 3]));
    assertEqual(result, 'Palavra1 Palavra2 Palavra3');
  });
});

describe('extractFromPdf — Error handling (Req 4.9)', () => {
  it('should throw for password-protected PDF', async () => {
    globalThis.pdfjsLib = createPdfjsMock({ passwordProtected: true });
    await assertRejects(
      () => extractFromPdf(new Uint8Array([1, 2, 3])),
      'protegido por senha'
    );
  });

  it('should throw for corrupted PDF', async () => {
    globalThis.pdfjsLib = createPdfjsMock({ corrupted: true });
    await assertRejects(
      () => extractFromPdf(new Uint8Array([1, 2, 3])),
      'Falha ao abrir PDF'
    );
  });

  it('should throw when extracted text is empty', async () => {
    globalThis.pdfjsLib = createPdfjsMock({ emptyText: true });
    await assertRejects(
      () => extractFromPdf(new Uint8Array([1, 2, 3])),
      'Texto vazio'
    );
  });

  it('should throw when pdfData is null', async () => {
    await assertRejects(
      () => extractFromPdf(null),
      'Dados do PDF não fornecidos'
    );
  });

  it('should throw when pdfData is undefined', async () => {
    await assertRejects(
      () => extractFromPdf(undefined),
      'Dados do PDF não fornecidos'
    );
  });

  it('should throw when pdfjsLib is not available', async () => {
    const saved = globalThis.pdfjsLib;
    delete globalThis.pdfjsLib;
    await assertRejects(
      () => extractFromPdf(new Uint8Array([1, 2, 3])),
      'PDF.js não está disponível'
    );
    globalThis.pdfjsLib = saved;
  });
});

describe('extractFromImage — Successful OCR (Req 4.2)', () => {
  it('should extract text from image via Tesseract OCR', async () => {
    globalThis.Tesseract = createTesseractMock({ text: 'Certificado de participação' });
    const result = await extractFromImage(new Uint8Array([1, 2, 3]));
    assertEqual(result, 'Certificado de participação');
  });

  it('should use Portuguese language for OCR', async () => {
    let usedLang = null;
    globalThis.Tesseract = {
      async recognize(data, lang) {
        usedLang = lang;
        return { data: { text: 'Texto em português' } };
      }
    };
    await extractFromImage(new Uint8Array([1, 2, 3]));
    assertEqual(usedLang, 'por');
  });

  it('should trim whitespace from OCR result', async () => {
    globalThis.Tesseract = createTesseractMock({ text: '  Texto com espaços  \n\n' });
    const result = await extractFromImage(new Uint8Array([1, 2, 3]));
    assertEqual(result, 'Texto com espaços');
  });
});

describe('extractFromImage — Error handling (Req 4.9)', () => {
  it('should throw when OCR fails', async () => {
    globalThis.Tesseract = createTesseractMock({ shouldFail: true });
    await assertRejects(
      () => extractFromImage(new Uint8Array([1, 2, 3])),
      'Falha no OCR'
    );
  });

  it('should throw when OCR returns empty text', async () => {
    globalThis.Tesseract = createTesseractMock({ emptyText: true });
    await assertRejects(
      () => extractFromImage(new Uint8Array([1, 2, 3])),
      'Texto vazio'
    );
  });

  it('should throw when imageData is null', async () => {
    await assertRejects(
      () => extractFromImage(null),
      'Dados da imagem não fornecidos'
    );
  });

  it('should throw when imageData is undefined', async () => {
    await assertRejects(
      () => extractFromImage(undefined),
      'Dados da imagem não fornecidos'
    );
  });

  it('should throw when Tesseract is not available', async () => {
    const saved = globalThis.Tesseract;
    delete globalThis.Tesseract;
    await assertRejects(
      () => extractFromImage(new Uint8Array([1, 2, 3])),
      'Tesseract.js não está disponível'
    );
    globalThis.Tesseract = saved;
  });
});

describe('extractText — Type dispatch (Req 4.1, 4.2)', () => {
  it('should dispatch to extractFromPdf for application/pdf', async () => {
    globalThis.pdfjsLib = createPdfjsMock({
      pages: [{ items: [{ str: 'PDF content' }] }]
    });
    const result = await extractText(new Uint8Array([1, 2, 3]), 'application/pdf');
    assertEqual(result, 'PDF content');
  });

  it('should dispatch to extractFromImage for image/png', async () => {
    globalThis.Tesseract = createTesseractMock({ text: 'PNG OCR text' });
    const result = await extractText(new Uint8Array([1, 2, 3]), 'image/png');
    assertEqual(result, 'PNG OCR text');
  });

  it('should dispatch to extractFromImage for image/jpeg', async () => {
    globalThis.Tesseract = createTesseractMock({ text: 'JPEG OCR text' });
    const result = await extractText(new Uint8Array([1, 2, 3]), 'image/jpeg');
    assertEqual(result, 'JPEG OCR text');
  });

  it('should dispatch to extractFromImage for image/jpg', async () => {
    globalThis.Tesseract = createTesseractMock({ text: 'JPG OCR text' });
    const result = await extractText(new Uint8Array([1, 2, 3]), 'image/jpg');
    assertEqual(result, 'JPG OCR text');
  });

  it('should be case-insensitive for mimeType', async () => {
    globalThis.pdfjsLib = createPdfjsMock({
      pages: [{ items: [{ str: 'PDF upper case' }] }]
    });
    const result = await extractText(new Uint8Array([1, 2, 3]), 'APPLICATION/PDF');
    assertEqual(result, 'PDF upper case');
  });

  it('should throw for unsupported file type', async () => {
    await assertRejects(
      () => extractText(new Uint8Array([1, 2, 3]), 'text/plain'),
      'Tipo de arquivo não suportado'
    );
  });

  it('should throw for application/msword', async () => {
    await assertRejects(
      () => extractText(new Uint8Array([1, 2, 3]), 'application/msword'),
      'Tipo de arquivo não suportado'
    );
  });

  it('should throw when fileData is null', async () => {
    await assertRejects(
      () => extractText(null, 'application/pdf'),
      'Dados do arquivo não fornecidos'
    );
  });

  it('should throw when mimeType is null', async () => {
    await assertRejects(
      () => extractText(new Uint8Array([1, 2, 3]), null),
      'Tipo MIME não fornecido'
    );
  });

  it('should throw when mimeType is empty string', async () => {
    await assertRejects(
      () => extractText(new Uint8Array([1, 2, 3]), ''),
      'Tipo MIME não fornecido'
    );
  });
});

// --- Run all tests sequentially ---
async function runAll() {
  for (const entry of tests) {
    if (entry.type === 'describe') {
      console.log(`\n  ${entry.name}`);
      entry.fn();
    } else if (entry.type === 'it') {
      try {
        await entry.fn();
        console.log(`    \x1b[32m✓\x1b[0m ${entry.name}`);
        passed++;
      } catch (e) {
        console.log(`    \x1b[31m✗\x1b[0m ${entry.name}`);
        console.log(`      \x1b[33m${e.message}\x1b[0m`);
        failed++;
      }
    }
  }
  console.log(`\n  \x1b[${failed > 0 ? '31' : '32'}m${passed} passing, ${failed} failing\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
