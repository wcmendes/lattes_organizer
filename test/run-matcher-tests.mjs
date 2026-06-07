/**
 * Node.js test runner for matcher.js
 * Tests fuzzy matching: calculateScore, findBestMatch, findBestSnippet.
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

// --- Mock fuzzball.js global ---

/**
 * Simple Token Set Ratio mock that mimics fuzzball behavior.
 * Tokenizes both strings, computes Jaccard-like similarity,
 * returns a value 0–100.
 */
function mockTokenSetRatio(str1, str2) {
  if (!str1 && !str2) return 100;
  if (!str1 || !str2) return 0;

  const normalize = s => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const tokens1 = new Set(normalize(str1).split(/\s+/).filter(Boolean));
  const tokens2 = new Set(normalize(str2).split(/\s+/).filter(Boolean));

  if (tokens1.size === 0 && tokens2.size === 0) return 100;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Token Set Ratio: intersection tokens sorted vs each full set
  const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
  const sorted_intersection = [...intersection].sort().join(' ');

  if (sorted_intersection.length === 0) return 0;

  // Compare sorted intersection with sorted union of each side
  const sorted1 = [...tokens1].sort().join(' ');
  const sorted2 = [...tokens2].sort().join(' ');

  // Simulated ratio: how much of each set is covered
  const ratio1 = intersection.size / tokens1.size;
  const ratio2 = intersection.size / tokens2.size;
  const maxRatio = Math.max(ratio1, ratio2);

  return Math.round(maxRatio * 100);
}

globalThis.fuzzball = {
  token_set_ratio: mockTokenSetRatio
};

const { calculateScore, findBestMatch, findBestSnippet } = await import('../js/core/matcher.js');

// --- Test Framework ---
let passed = 0;
let failed = 0;
const tests = [];
let currentDescribe = '';

function describe(name, fn) {
  tests.push({ type: 'describe', name });
  fn();
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

function assertInRange(value, min, max, message) {
  if (value < min || value > max) {
    throw new Error(message || `Expected ${value} to be in range [${min}, ${max}]`);
  }
}

// --- Tests: calculateScore ---

describe('calculateScore — Basic functionality (Req 4.3)', () => {
  it('should return 0 for empty text', () => {
    const entry = { titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40' };
    const score = calculateScore('', entry);
    assertEqual(score, 0);
  });

  it('should return 0 for null text', () => {
    const entry = { titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40' };
    const score = calculateScore(null, entry);
    assertEqual(score, 0);
  });

  it('should return 0 for null entry', () => {
    const score = calculateScore('algum texto', null);
    assertEqual(score, 0);
  });

  it('should return score in range [0, 100]', () => {
    const entry = { titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40' };
    const score = calculateScore('certificado curso java 2021 ufmg 40 horas', entry);
    assertInRange(score, 0, 100);
  });

  it('should return high score when text matches all fields', () => {
    const entry = { titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40' };
    const text = 'Certificamos que concluiu o Curso de Java na UFMG em 2021 com 40 horas';
    const score = calculateScore(text, entry);
    assert(score >= 50, `Expected score >= 50, got ${score}`);
  });

  it('should return low score when text has no relation to entry', () => {
    const entry = { titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40' };
    const text = 'Receita de bolo de chocolate com granulado e cobertura de morango';
    const score = calculateScore(text, entry);
    assert(score <= 30, `Expected score <= 30, got ${score}`);
  });

  it('should handle entry with empty optional fields', () => {
    const entry = { titulo: 'Workshop Python', instituicao: '', ano: '', carga_horaria: '' };
    const text = 'workshop python programação avançada';
    const score = calculateScore(text, entry);
    assertInRange(score, 0, 100);
  });
});

describe('calculateScore — Ano component (Req 4.3)', () => {
  it('should give ano score when exact year appears in text', () => {
    const entry = { titulo: '', instituicao: '', ano: '2021', carga_horaria: '' };
    const textWith = 'certificado emitido em 2021';
    const textWithout = 'certificado emitido recentemente';
    const scoreWith = calculateScore(textWith, entry);
    const scoreWithout = calculateScore(textWithout, entry);
    assert(scoreWith > scoreWithout, `Expected ${scoreWith} > ${scoreWithout}`);
  });

  it('should give ano score when year ±1 appears in text', () => {
    const entry = { titulo: '', instituicao: '', ano: '2021', carga_horaria: '' };
    const text2020 = 'certificado emitido em 2020';
    const text2022 = 'certificado emitido em 2022';
    const textNone = 'certificado emitido recentemente';
    const score2020 = calculateScore(text2020, entry);
    const score2022 = calculateScore(text2022, entry);
    const scoreNone = calculateScore(textNone, entry);
    assert(score2020 > scoreNone, `2020 should match ±1: ${score2020} > ${scoreNone}`);
    assert(score2022 > scoreNone, `2022 should match ±1: ${score2022} > ${scoreNone}`);
  });

  it('should not give ano score when year is >1 away', () => {
    const entry = { titulo: '', instituicao: '', ano: '2021', carga_horaria: '' };
    const text2019 = 'certificado de 2019';
    const text2023 = 'certificado de 2023';
    const textExact = 'certificado de 2021';
    const score2019 = calculateScore(text2019, entry);
    const score2023 = calculateScore(text2023, entry);
    const scoreExact = calculateScore(textExact, entry);
    assert(scoreExact > score2019, 'Exact year should score higher than ±2');
    assert(scoreExact > score2023, 'Exact year should score higher than ±2');
  });
});

describe('calculateScore — Carga horária component (Req 4.3)', () => {
  it('should give carga score when exact hours appear in text', () => {
    const entry = { titulo: '', instituicao: '', ano: '', carga_horaria: '40' };
    const textWith = 'carga horária total de 40 horas';
    const textWithout = 'certificado sem informação de horas';
    const scoreWith = calculateScore(textWith, entry);
    const scoreWithout = calculateScore(textWithout, entry);
    assert(scoreWith > scoreWithout, `Expected ${scoreWith} > ${scoreWithout}`);
  });

  it('should give carga score within ±20% tolerance', () => {
    const entry = { titulo: '', instituicao: '', ano: '', carga_horaria: '100' };
    // 80 is exactly at -20%, should match
    const text80 = 'total 80 horas realizadas';
    // 120 is exactly at +20%, should match
    const text120 = 'total 120 horas realizadas';
    const score80 = calculateScore(text80, entry);
    const score120 = calculateScore(text120, entry);
    const textNone = 'certificado sem número de horas';
    const scoreNone = calculateScore(textNone, entry);
    assert(score80 > scoreNone, `80h within ±20% of 100: ${score80} > ${scoreNone}`);
    assert(score120 > scoreNone, `120h within ±20% of 100: ${score120} > ${scoreNone}`);
  });
});

// --- Tests: findBestMatch ---

describe('findBestMatch — Classification (Req 4.5, 4.6, 4.7)', () => {
  const makeCandidates = () => [
    { id: '1', titulo: 'Curso de Java Avançado', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', categoria: 'cat1', status: 'pendente', oculta: false },
    { id: '2', titulo: 'Workshop Python', instituicao: 'USP', ano: '2022', carga_horaria: '20', categoria: 'cat1', status: 'pendente', oculta: false },
    { id: '3', titulo: 'Seminário de IA', instituicao: 'Unicamp', ano: '2020', carga_horaria: '8', categoria: 'cat2', status: 'pendente', oculta: false },
  ];

  it('should return no_match when candidates array is empty', () => {
    const result = findBestMatch('algum texto', [], 50);
    assertEqual(result.status, 'no_match');
    assertEqual(result.bestMatch, null);
    assertEqual(result.score, 0);
    assertEqual(result.hasTie, false);
  });

  it('should return no_match when text is empty', () => {
    const result = findBestMatch('', makeCandidates(), 50);
    assertEqual(result.status, 'no_match');
  });

  it('should return no_match when all scores below threshold', () => {
    const candidates = makeCandidates();
    // Use a very high threshold so no match qualifies
    const result = findBestMatch('algo completamente diferente xyzzy', candidates, 99);
    assertEqual(result.status, 'no_match');
  });

  it('should return review when score >= threshold but < 99', () => {
    const candidates = makeCandidates();
    // Use a very low threshold
    const result = findBestMatch('Curso de Java Avançado UFMG 2021', candidates, 10);
    if (result.score >= 10 && result.score < 99) {
      assertEqual(result.status, 'review');
    }
    // At minimum, should not be no_match for related text
    assert(result.status !== 'no_match' || result.score < 10,
      `Expected review or auto_accepted, got ${result.status} with score ${result.score}`);
  });

  it('should use default threshold of 50 when not provided', () => {
    const candidates = makeCandidates();
    const result = findBestMatch('xyzzy non-matching text', candidates);
    // Should use threshold 50, so low scores → no_match
    assertEqual(result.status, 'no_match');
  });
});

describe('findBestMatch — Filtering candidates (Req 4.4)', () => {
  it('should exclude hidden entries (oculta = true)', () => {
    const candidates = [
      { id: '1', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'pendente', oculta: true },
    ];
    const result = findBestMatch('Curso de Java UFMG 2021 40 horas', candidates, 10);
    assertEqual(result.status, 'no_match');
  });

  it('should exclude entries with status mapeada', () => {
    const candidates = [
      { id: '1', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'mapeada', oculta: false },
    ];
    const result = findBestMatch('Curso de Java UFMG 2021 40 horas', candidates, 10);
    assertEqual(result.status, 'no_match');
  });

  it('should exclude entries with status mantida_manual', () => {
    const candidates = [
      { id: '1', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'mantida_manual', oculta: false },
    ];
    const result = findBestMatch('Curso de Java UFMG 2021 40 horas', candidates, 10);
    assertEqual(result.status, 'no_match');
  });

  it('should exclude entries with status removida', () => {
    const candidates = [
      { id: '1', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'removida', oculta: false },
    ];
    const result = findBestMatch('Curso de Java UFMG 2021 40 horas', candidates, 10);
    assertEqual(result.status, 'no_match');
  });

  it('should include entries with status pendente', () => {
    const candidates = [
      { id: '1', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'pendente', oculta: false },
    ];
    const result = findBestMatch('Curso de Java UFMG 2021 40 horas', candidates, 10);
    assert(result.status !== 'no_match' || result.score < 10,
      `Pendente entry should be eligible. Status: ${result.status}, Score: ${result.score}`);
  });
});

describe('findBestMatch — Tie detection (Req 4.5)', () => {
  it('should set hasTie = true when multiple entries have same max score', () => {
    // Two identical entries should have the same score
    const candidates = [
      { id: '1', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'pendente', oculta: false },
      { id: '2', titulo: 'Curso de Java', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'pendente', oculta: false },
    ];
    const result = findBestMatch('Curso de Java UFMG 2021 40 horas', candidates, 10);
    assertEqual(result.hasTie, true);
  });

  it('should set hasTie = false when one entry clearly beats others', () => {
    const candidates = [
      { id: '1', titulo: 'Curso de Java Avançado', instituicao: 'UFMG', ano: '2021', carga_horaria: '40', status: 'pendente', oculta: false },
      { id: '2', titulo: 'Workshop de Culinária', instituicao: 'SENAC', ano: '2019', carga_horaria: '8', status: 'pendente', oculta: false },
    ];
    const result = findBestMatch('Curso de Java Avançado UFMG 2021 40 horas', candidates, 10);
    assertEqual(result.hasTie, false);
  });
});

// --- Tests: findBestSnippet ---

describe('findBestSnippet — Basic functionality (Req 5.4)', () => {
  it('should return empty snippet for empty text', () => {
    const result = findBestSnippet('', 'referência');
    assertEqual(result.snippet, '');
    assert(Array.isArray(result.highlightWords));
  });

  it('should return empty snippet for empty reference', () => {
    const result = findBestSnippet('algum texto aqui', '');
    assertEqual(result.snippet, '');
  });

  it('should return full text if shorter than maxChars', () => {
    const text = 'Texto curto do certificado';
    const result = findBestSnippet(text, 'certificado', 500);
    assertEqual(result.snippet, text);
  });

  it('should truncate to maxChars when text is longer', () => {
    const text = 'A'.repeat(1000);
    const result = findBestSnippet(text, 'A', 500);
    assertEqual(result.snippet.length, 500);
  });

  it('should return highlight words that appear in both snippet and reference', () => {
    const text = 'Certificado de conclusão do curso de Java avançado na UFMG';
    const result = findBestSnippet(text, 'curso Java UFMG', 500);
    assert(result.highlightWords.length > 0, 'Should have highlight words');
  });

  it('should use default maxChars of 500 when not provided', () => {
    const text = 'X'.repeat(1000);
    const result = findBestSnippet(text, 'X');
    assertEqual(result.snippet.length, 500);
  });

  it('should find the most relevant snippet from a long text', () => {
    const irrelevant = 'Lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(20);
    const relevant = 'Certificado Curso de Java Avançado UFMG 2021 40 horas ';
    const text = irrelevant + relevant + irrelevant;
    const result = findBestSnippet(text, 'Curso Java UFMG', 500);
    // The snippet should contain the relevant part
    assert(result.snippet.includes('Java') || result.snippet.includes('UFMG') || result.snippet.includes('Curso'),
      `Snippet should contain relevant words. Got: ${result.snippet.substring(0, 100)}`);
  });
});

// --- Run all tests sequentially ---
async function runAll() {
  console.log('\n  matcher.js — Unit Tests\n');
  for (const entry of tests) {
    if (entry.type === 'describe') {
      console.log(`\n  ${entry.name}`);
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
