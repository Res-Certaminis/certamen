/** Answer normalisation and fuzzy matching for Latin/classics answers. */

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or']);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip macrons & accents
    .toLowerCase()
    .replace(/\bj/g, 'i') // consonantal i/j
    .replace(/\bv/g, 'u') // u/v are interchangeable in Latin orthography
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ');
}

/**
 * Split an answer line into acceptable variants.
 * "MARCUS TULLIUS CICERO (accept TULLY)" → ["marcus tullius cicero", "tully", "cicero"]
 * Underlined/required parts are not encoded in plain text, so every individual
 * word of 3+ letters in the main answer is also accepted when it is unique-ish.
 */
export function variants(answer: string): string[] {
  const out = new Set<string>();
  const paren = [...answer.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const main = answer.replace(/[([][^)\]]*[)\]]/g, ' ');
  for (const part of main.split(/\/|\bor\b|;/i)) {
    const n = normalize(part);
    if (n) out.add(n);
  }
  for (const p of paren) {
    if (/do not accept|prompt on|reject/i.test(p)) continue;
    for (const alt of p.replace(/^\s*(accept|or|also accept)\s*/i, '').split(/\/|\bor\b|,|;/i)) {
      const n = normalize(alt);
      if (n) out.add(n);
    }
  }
  // Single significant words of the main answer (last name, etc.)
  for (const v of [...out]) for (const w of v.split(' ')) if (w.length >= 4) out.add(w);
  return [...out];
}

/** Edit distance where an adjacent transposition ("Ceasar") counts as one edit. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** True if `given` is an acceptable answer for `expected`. */
export function match(given: string, expected: string): boolean {
  const g = normalize(given);
  if (!g) return false;
  for (const v of variants(expected)) {
    if (g === v) return true;
    const tol = v.length >= 8 ? 2 : v.length >= 5 ? 1 : 0;
    if (tol && levenshtein(g, v) <= tol) return true;
  }
  return false;
}
