/**
 * text-extractor.js — Extração de texto de PDFs e imagens
 * 
 * Utiliza PDF.js (global pdfjsLib) para PDFs e Tesseract.js (global Tesseract) para OCR de imagens.
 * Todas as funções lançam erros com mensagens descritivas em caso de falha.
 * 
 * Requirements: 4.1, 4.2, 4.9
 */

/**
 * Extrai texto de um arquivo PDF usando PDF.js.
 * @param {ArrayBuffer|Uint8Array} pdfData — dados binários do PDF
 * @returns {Promise<string>} texto extraído concatenado de todas as páginas
 * @throws {Error} se o PDF for protegido por senha, estiver corrompido ou o texto for vazio
 */
export async function extractFromPdf(pdfData) {
  if (!pdfData) {
    throw new Error('Dados do PDF não fornecidos');
  }

  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js não está disponível. Verifique a conexão com a internet.');
  }

  let pdf;
  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    pdf = await loadingTask.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      throw new Error('PDF protegido por senha: não é possível extrair texto');
    }
    throw new Error(`Falha ao abrir PDF: ${err.message || 'arquivo corrompido ou inválido'}`);
  }

  const numPages = pdf.numPages;
  const textParts = [];

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map(item => item.str)
        .join(' ');
      textParts.push(pageText);
    } catch (err) {
      // Continue with other pages if one fails
      textParts.push('');
    }
  }

  const fullText = textParts.join('\n').trim();

  if (!fullText) {
    throw new Error('Texto vazio: o PDF não contém texto extraível');
  }

  return fullText;
}

/**
 * Extrai texto de uma imagem usando Tesseract.js (OCR, lang: por).
 * @param {Blob|ArrayBuffer|Uint8Array|string} imageData — dados da imagem
 * @returns {Promise<string>} texto reconhecido via OCR
 * @throws {Error} se o OCR falhar ou o texto extraído for vazio
 */
export async function extractFromImage(imageData) {
  if (!imageData) {
    throw new Error('Dados da imagem não fornecidos');
  }

  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js não está disponível. Verifique a conexão com a internet.');
  }

  let result;
  try {
    result = await Tesseract.recognize(imageData, 'por');
  } catch (err) {
    throw new Error(`Falha no OCR: ${err.message || 'imagem ilegível ou formato não suportado'}`);
  }

  const text = (result && result.data && result.data.text) ? result.data.text.trim() : '';

  if (!text) {
    throw new Error('Texto vazio: não foi possível reconhecer texto na imagem');
  }

  return text;
}

/**
 * Detecta tipo do arquivo e despacha para o extrator correto.
 * @param {ArrayBuffer|Uint8Array|Blob} fileData — dados binários do arquivo
 * @param {string} mimeType — tipo MIME do arquivo (ex: 'application/pdf', 'image/png')
 * @returns {Promise<string>} texto extraído
 * @throws {Error} se o tipo de arquivo não for suportado ou a extração falhar
 */
export async function extractText(fileData, mimeType) {
  if (!fileData) {
    throw new Error('Dados do arquivo não fornecidos');
  }

  if (!mimeType || typeof mimeType !== 'string') {
    throw new Error('Tipo MIME não fornecido');
  }

  const normalizedMime = mimeType.toLowerCase().trim();

  if (normalizedMime === 'application/pdf') {
    return extractFromPdf(fileData);
  }

  if (normalizedMime.startsWith('image/')) {
    return extractFromImage(fileData);
  }

  throw new Error(`Tipo de arquivo não suportado: ${mimeType}`);
}
