/**
 * matcher.js — Fuzzy Matching (fuzzball.js Token Set Ratio)
 *
 * Calcula scores de confiança entre texto extraído de comprovantes e
 * entradas Lattes usando Token Set Ratio (fuzzball.js).
 * Classifica matches como auto_accepted, review ou no_match.
 *
 * Fórmula de score:
 *   título (55%, Token Set Ratio) +
 *   instituição (30%, Token Set Ratio) +
 *   ano (10%, match exato ±1) +
 *   carga horária (5%, tolerância ±20%)
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHT_TITULO = 0.55;
const WEIGHT_INSTITUICAO = 0.30;
const WEIGHT_ANO = 0.10;
const WEIGHT_CARGA = 0.05;

const AUTO_ACCEPT_THRESHOLD = 99;
const DEFAULT_THRESHOLD = 50;
const MAX_SNIPPET_CHARS = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calcula score de confiança entre texto extraído e uma entrada Lattes.
 *
 * @param {string} extractedText — texto do comprovante
 * @param {import('../design').LattesEntry} entry — entrada Lattes
 * @returns {number} score 0–100 (arredondado para inteiro)
 */
export function calculateScore(extractedText, entry) {
  if (!extractedText || !entry) {
    return 0;
  }

  const text = String(extractedText).toLowerCase().trim();
  if (!text) {
    return 0;
  }

  // Componente título (55%) — Token Set Ratio
  const tituloScore = _tokenSetRatioScore(text, entry.titulo);

  // Componente instituição (30%) — Token Set Ratio
  const instituicaoScore = _tokenSetRatioScore(text, entry.instituicao);

  // Componente ano (10%) — match exato ±1
  const anoScore = _anoScore(text, entry.ano);

  // Componente carga horária (5%) — tolerância ±20%
  const cargaScore = _cargaHorariaScore(text, entry.carga_horaria);

  // Fórmula ponderada
  const rawScore =
    tituloScore * WEIGHT_TITULO +
    instituicaoScore * WEIGHT_INSTITUICAO +
    anoScore * WEIGHT_ANO +
    cargaScore * WEIGHT_CARGA;

  // Clamp [0, 100] e arredonda
  return Math.round(Math.max(0, Math.min(100, rawScore)));
}

/**
 * Executa auto-match: encontra a melhor entrada para um comprovante.
 *
 * Filtra candidatos: apenas categorias ativas, não ocultas, sem mapeamento existente.
 *
 * @param {string} extractedText — texto extraído do comprovante
 * @param {Array<import('../design').LattesEntry>} candidates — entradas candidatas
 * @param {number} [threshold] — 0–100, padrão 50
 * @returns {import('../design').MatchResult}
 */
export function findBestMatch(extractedText, candidates, threshold) {
  const effectiveThreshold = (threshold !== undefined && threshold !== null)
    ? threshold
    : DEFAULT_THRESHOLD;

  // Resultado default: no_match
  const noMatch = {
    status: 'no_match',
    bestMatch: null,
    score: 0,
    hasTie: false
  };

  if (!extractedText || !candidates || candidates.length === 0) {
    return noMatch;
  }

  // Filtrar candidatos elegíveis:
  // - não ocultas (oculta !== true e oculta !== 'TRUE')
  // - sem mapeamento existente (status !== 'mapeada' e status !== 'mantida_manual')
  // - status não é 'removida'
  const eligible = candidates.filter(entry => {
    if (entry.oculta === true || entry.oculta === 'TRUE') return false;
    if (entry.status === 'mapeada' || entry.status === 'mantida_manual') return false;
    if (entry.status === 'removida') return false;
    return true;
  });

  if (eligible.length === 0) {
    return noMatch;
  }

  // Calcular scores para todos os candidatos elegíveis
  const scored = eligible.map(entry => ({
    entry,
    score: calculateScore(extractedText, entry)
  }));

  // Encontrar o melhor score
  scored.sort((a, b) => b.score - a.score);
  const bestScore = scored[0].score;
  const bestEntry = scored[0].entry;

  // Verificar empate: duas ou mais entradas com o mesmo score máximo
  const hasTie = scored.filter(s => s.score === bestScore).length > 1;

  // Classificar o resultado
  if (bestScore < effectiveThreshold) {
    return {
      status: 'no_match',
      bestMatch: null,
      score: bestScore,
      hasTie: false
    };
  }

  if (bestScore >= AUTO_ACCEPT_THRESHOLD && !hasTie) {
    return {
      status: 'auto_accepted',
      bestMatch: bestEntry,
      score: bestScore,
      hasTie: false
    };
  }

  // Score >= threshold (either >= 99 with tie, or >= threshold and < 99)
  return {
    status: 'review',
    bestMatch: bestEntry,
    score: bestScore,
    hasTie
  };
}

/**
 * Encontra o trecho do texto extraído com maior similaridade à referência.
 *
 * @param {string} text — texto completo do comprovante
 * @param {string} reference — título/instituição de referência
 * @param {number} [maxChars] — máximo de caracteres (padrão 500)
 * @returns {{snippet: string, highlightWords: string[]}}
 */
export function findBestSnippet(text, reference, maxChars) {
  const limit = maxChars || MAX_SNIPPET_CHARS;

  if (!text || !reference) {
    return { snippet: '', highlightWords: [] };
  }

  const fullText = String(text);
  const ref = String(reference).trim();

  if (!fullText.trim() || !ref) {
    return { snippet: '', highlightWords: [] };
  }

  // Se o texto é menor que maxChars, retornar tudo
  if (fullText.length <= limit) {
    const highlightWords = _extractHighlightWords(fullText, ref);
    return { snippet: fullText, highlightWords };
  }

  // Deslizar uma janela pelo texto para encontrar o trecho de maior similaridade
  const windowSize = Math.min(limit, fullText.length);
  const step = Math.max(1, Math.floor(windowSize / 4));
  let bestStart = 0;
  let bestRatio = 0;

  for (let i = 0; i <= fullText.length - windowSize; i += step) {
    const chunk = fullText.substring(i, i + windowSize);
    const ratio = _tokenSetRatio(chunk.toLowerCase(), ref.toLowerCase());
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestStart = i;
    }
  }

  // Refinar: testar posições próximas ao melhor com step menor
  const refineStart = Math.max(0, bestStart - step);
  const refineEnd = Math.min(fullText.length - windowSize, bestStart + step);
  for (let i = refineStart; i <= refineEnd; i++) {
    const chunk = fullText.substring(i, i + windowSize);
    const ratio = _tokenSetRatio(chunk.toLowerCase(), ref.toLowerCase());
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestStart = i;
    }
  }

  const snippet = fullText.substring(bestStart, bestStart + windowSize);
  const highlightWords = _extractHighlightWords(snippet, ref);

  return { snippet, highlightWords };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Calcula Token Set Ratio entre text e field usando fuzzball.js.
 * Retorna 0 se o campo estiver vazio.
 *
 * @param {string} text — texto completo (já lowercase)
 * @param {string} field — campo da entrada
 * @returns {number} score 0–100
 * @private
 */
function _tokenSetRatioScore(text, field) {
  if (!field || !String(field).trim()) {
    return 0;
  }
  const fieldNorm = String(field).toLowerCase().trim();
  return _tokenSetRatio(text, fieldNorm);
}

/**
 * Wrapper para fuzzball.token_set_ratio com fallback.
 *
 * @param {string} str1
 * @param {string} str2
 * @returns {number} 0–100
 * @private
 */
function _tokenSetRatio(str1, str2) {
  if (typeof fuzzball !== 'undefined' && fuzzball.token_set_ratio) {
    return fuzzball.token_set_ratio(str1, str2);
  }
  // Fallback simples se fuzzball não estiver disponível
  return _simpleSimilarity(str1, str2);
}

/**
 * Fallback de similaridade simples (Jaccard de tokens) caso fuzzball não esteja disponível.
 *
 * @param {string} str1
 * @param {string} str2
 * @returns {number} 0–100
 * @private
 */
function _simpleSimilarity(str1, str2) {
  const tokens1 = new Set(str1.split(/\s+/).filter(Boolean));
  const tokens2 = new Set(str2.split(/\s+/).filter(Boolean));

  if (tokens1.size === 0 && tokens2.size === 0) return 100;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) intersection++;
  }

  const union = new Set([...tokens1, ...tokens2]).size;
  return Math.round((intersection / union) * 100);
}

/**
 * Calcula score do componente ano.
 * 100 se o ano da entrada aparece no texto (±1 de tolerância), 0 caso contrário.
 *
 * @param {string} text — texto completo (já lowercase)
 * @param {string} ano — ano da entrada (ex: "2021" ou "")
 * @returns {number} 0 ou 100
 * @private
 */
function _anoScore(text, ano) {
  if (!ano || !String(ano).trim()) {
    return 0;
  }

  const anoNum = parseInt(String(ano).trim(), 10);
  if (isNaN(anoNum)) {
    return 0;
  }

  // Verificar se o ano exato ou ±1 aparece no texto
  const yearsToCheck = [anoNum - 1, anoNum, anoNum + 1];
  for (const y of yearsToCheck) {
    if (text.includes(String(y))) {
      return 100;
    }
  }

  return 0;
}

/**
 * Calcula score do componente carga horária.
 * 100 se um número no texto está dentro de ±20% do valor da entrada, 0 caso contrário.
 *
 * @param {string} text — texto completo (já lowercase)
 * @param {string} cargaHoraria — carga horária da entrada (ex: "40" ou "")
 * @returns {number} 0 ou 100
 * @private
 */
function _cargaHorariaScore(text, cargaHoraria) {
  if (!cargaHoraria || !String(cargaHoraria).trim()) {
    return 0;
  }

  const expected = parseFloat(String(cargaHoraria).trim());
  if (isNaN(expected) || expected <= 0) {
    return 0;
  }

  // Extrair números do texto e verificar se algum está dentro de ±20%
  const numbers = text.match(/\d+/g);
  if (!numbers) {
    return 0;
  }

  const tolerance = expected * 0.20;
  const min = expected - tolerance;
  const max = expected + tolerance;

  for (const numStr of numbers) {
    const num = parseFloat(numStr);
    if (num >= min && num <= max) {
      return 100;
    }
  }

  return 0;
}

/**
 * Extrai palavras de destaque (highlight) que aparecem tanto no snippet quanto na referência.
 *
 * @param {string} snippet — trecho do texto
 * @param {string} reference — texto de referência
 * @returns {string[]} palavras comuns (mínimo 3 caracteres)
 * @private
 */
function _extractHighlightWords(snippet, reference) {
  const refTokens = new Set(
    String(reference).toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 3)
  );

  const snippetTokens = String(snippet).toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 3);

  const highlighted = new Set();
  for (const token of snippetTokens) {
    // Check against each reference token with some flexibility
    for (const refToken of refTokens) {
      if (token === refToken || token.includes(refToken) || refToken.includes(token)) {
        highlighted.add(token);
        break;
      }
    }
  }

  return [...highlighted];
}
