/**
 * Turn a packet (docx/pdf/txt) into questions. Heuristic by design: the upload UI
 * shows an editable preview, so this only has to get most of the way there.
 */
import type { Category, Question } from './types';

const TOSSUP = /^\s*(?:(?:TU|T\.?U\.?|TOSS-?UP|TOSSUP)\s*#?\s*(\d+)?\s*[.:)-]?|(\d{1,2})\s*[.):])\s*/i;
const BONUS = /^\s*(?:B\s*([123])|BONUS\s*#?\s*([123])?)\s*[.:)-]?\s*/i;
// "ANSWER:" / "ANS:" anywhere; a bare "A." or "A:" only at the start of a line (so "312 A.D." is not an answer).
const ANSWER = /\bANS(?:WER)?\s*[.:]\s*|^A\s*[.:]\s*/i;

export function parseText(text: string): Question[] {
  const out: Question[] = [];
  let q: Question | null = null;
  let target: Target = null;

  const append = (s: string) => {
    if (!q || !target) return;
    s = s.trim();
    if (!s) return;
    if (target === 'tossup') q.tossup = join(q.tossup, s);
    else if (target === 'answer') q.answer = join(q.answer, s);
    else {
      const i = Number(target.slice(2));
      const b = (q.bonuses[i] ??= { q: '', a: '' });
      if (target.startsWith('bq')) b.q = join(b.q, s);
      else b.a = join(b.a, s);
    }
  };

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    let line = rawLine.trim();
    if (!line || NOISE.test(line)) continue;
    const tu = TOSSUP.exec(line);
    const num = tu ? Number(tu[1] ?? tu[2]) : NaN;
    // A numbered line is a new tossup only if it is the next expected number (or explicit TU marker).
    const expected = out.length + (q ? 1 : 0) + 1;
    if (tu && (!tu[2] || num === expected || (q === null && !isNaN(num)))) {
      if (q) out.push(q);
      q = { tossup: '', answer: '', bonuses: [] };
      target = 'tossup';
      line = line.slice(tu[0].length);
    } else {
      const bo = BONUS.exec(line);
      if (bo && q) {
        const explicit = bo[1] ?? bo[2];
        const i = explicit ? Number(explicit) - 1 : q.bonuses.length;
        target = `bq${i}`;
        line = line.slice(bo[0].length);
      }
    }
    if (!q) continue;
    // Inline or leading ANSWER: marker.
    const parts = line.split(ANSWER);
    if (parts.length > 1) {
      append(parts[0]);
      target = answerTarget(target);
      append(parts.slice(1).join(' '));
    } else if (isShoutedAnswer(line) && (target === 'tossup' || target?.startsWith('bq'))) {
      // e.g. a question followed by an all-caps line with no ANSWER: marker
      target = answerTarget(target);
      append(line);
    } else append(line);
  }
  if (q) out.push(q);
  return out.map(clean).filter((x) => x.tossup);
}

const join = (a: string, b: string) => (a ? `${a} ${b}` : b);

type Target = 'tossup' | 'answer' | `bq${number}` | `ba${number}` | null;
/** The answer slot matching the question slot currently being filled. */
const answerTarget = (t: Target): Target =>
  t === 'tossup' || t === 'answer' || t === null
    ? 'answer'
    : t.startsWith('bq')
      ? `ba${Number(t.slice(2))}`
      : t;

function isShoutedAnswer(line: string) {
  const letters = line
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/\b(?:and|or|of|the|a|an|to|in|on|is|are|for|with|should be)\b/g, '')
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '');
  // An all-caps line is an answer even when it ends in '?' (translation answers often do).
  return letters.length >= 2 && line.length <= 80 && letters === letters.toUpperCase();
}

function clean(q: Question): Question {
  const t = (s: string) => s.replace(/\s+/g, ' ').trim();
  return {
    tossup: t(q.tossup),
    answer: t(q.answer),
    bonuses: q.bonuses.filter(Boolean).map((b) => ({ q: t(b.q), a: t(b.a) })),
  };
}

/** Extract plain text from a File (docx, pdf, or text). Heavy libraries are loaded lazily. */
export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text);
    }
    return pages.join('\n');
  }
  return file.text();
}

export interface Chunk {
  round: string | null; // e.g. "Round 3", "Semifinal", null when the packet has no round headers
  text: string;
}

const ROUND_LINE =
  /^(?:[^\n?]{0,40}?[—–:-]\s*)?(?:(?:[A-Za-z]+\s+){0,3}(?:round|rd\.?)\s*[#:.-]?\s*(?:\d{1,2}|[IVX]{1,5}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)?\b[^?]{0,30}|(?:semi-?finals?|semis|finals?|preliminar(?:y|ies)\s*\d*|quarter-?finals?)\s*(?:round)?\s*)$/i;
/** Moderator-only lines that are never part of a question. */
const NOISE = /^\W*(?:score\s*check|halftime|time\s*out|end of (?:round|packet))\W*$/i;

/**
 * Split a packet into rounds. Many PDFs hold a whole division (8+ rounds); each round becomes
 * its own question set. Returns one chunk (round = null) when fewer than two headers are found.
 * Text before the first header (cover page, metadata) is returned separately as `preamble`.
 */
export function splitRounds(text: string): { preamble: string; chunks: Chunk[] } {
  const lines = text.replace(/\r/g, '').split('\n');
  const heads: { i: number; label: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.length <= 60 && ROUND_LINE.test(l) && !TOSSUP.test(l) && !NOISE.test(l))
      heads.push({ i, label: normalizeRound(l) ?? titleCase(l) });
  }
  // Same label repeated back-to-back (e.g. page headers) collapses into one chunk.
  const distinct = heads.filter((h, k) => k === 0 || h.label !== heads[k - 1].label);
  if (distinct.length < 2) return { preamble: '', chunks: [{ round: null, text }] };
  const preamble = lines.slice(0, distinct[0].i).join('\n').trim();
  const headIdx = new Set(heads.map((h) => h.i)); // drop repeated page headers inside a round
  const chunks = distinct.map((h, k) => ({
    round: h.label,
    text: lines
      .slice(h.i + 1, distinct[k + 1]?.i ?? lines.length)
      .filter((_, j) => !headIdx.has(h.i + 1 + j))
      .join('\n')
      .trim(),
  }));
  return { preamble, chunks: chunks.filter((c) => c.text) };
}

const titleCase = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/[.:#-]+$/, '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Best-effort set metadata from packet text (used without AI, and as defaults the AI fills in). */
export function guessMeta(text: string): {
  tournament: string | null;
  region: string | null;
  level: 'novice' | 'intermediate' | 'advanced' | null;
  year: number | null;
} {
  const head = text.slice(0, 4000);
  // Title-like lines: the first dozen short lines that are not questions.
  const cover = head
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.length <= 70 && !/\?/.test(l) && !TOSSUP.test(l) && !ROUND_LINE.test(l))
    .slice(0, 12);
  const coverText = cover.join('\n');
  const year = Number(/\b(20\d{2}|19\d{2})\b/.exec(head)?.[1]) || null;
  const level = (/\b(novice|intermediate|advanced)\b/i.exec(head)?.[1].toLowerCase() ?? null) as
    'novice' | 'intermediate' | 'advanced' | null;
  if (/\bN\.?J\.?C\.?L\.?\b|National Junior Classical League/i.test(coverText))
    return { tournament: 'NJCL', region: 'National', level, year };
  const st = STATES.find((s) =>
    new RegExp(`\\b${s}\\s+(?:Junior Classical League|J\\.?C\\.?L\\.?)`, 'i').test(coverText),
  );
  if (st) return { tournament: `${st} JCL`, region: st, level, year };
  const state = STATES.find((s) => new RegExp(`\\b${s}\\b`).test(coverText)) ?? null;
  const clean = (l: string) =>
    l
      .replace(/\b(?:20|19)\d{2}\b/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s—–-]+$/, '')
      .trim();
  const school = cover.find((l) => /\b(?:High School|Academy|Prep(?:aratory)?)\b/i.test(l));
  if (school) return { tournament: clean(school), region: state, level, year };
  const named = cover.find((l) =>
    /\b(?:University|College|Institute|Certamen|Invitational|Tournament)\b/i.test(l),
  );
  if (named) return { tournament: clean(named), region: state ?? 'Competitive Circuit', level, year };
  return { tournament: null, region: state, level, year };
}

const STATES = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
];

/** Keyword guess at the main category for the no-AI path. Grammar wins ties: it is the most common. */
export function guessCategory(q: Question): Category | null {
  const t = `${q.tossup} ${q.bonuses.map((b) => b.q).join(' ')}`.toLowerCase();
  const score = (res: RegExp[]) => res.reduce((n, r) => n + (r.test(t) ? 1 : 0), 0);
  const s: Record<Category, number> = {
    Grammar: score([
      /\btranslat/,
      /\blatin (?:for|word|verb|noun|adjective|phrase)\b/,
      /\bcase\b/,
      /\bform of\b/,
      /\bderiv/,
      /\bsubjunctive|indicative|imperative|infinitive|participle|gerund|supine|ablative|genitive|dative|accusative|vocative|locative\b/,
      /\bconjugat|declension|declin|synonym|antonym|abbreviation|motto\b/,
      /\bwhat (?:latin )?(?:verb|noun|adjective|word|root)\b/,
      /\bmeaning\b/,
      /\bgive the\b/,
    ]),
    History: score([
      /\bemperor|consul|senate|senator|tribune|dictator|praetor|censor|legion|republic|empire\b/,
      /\bbattle|war|treaty|siege|conquer|revolt|reign|assassinat/,
      /\b\d{1,3} ?(?:bc|b\.c\.|ad|a\.d\.)\b/,
      /\bcentury\b/,
      /\bprovince|forum|aqueduct|colosseum|circus maximus\b/,
      /\bdaily life|toga|slave|gladiator|chariot|baths\b/,
    ]),
    Mythology: score([
      /\bgod(?:dess)?\b/,
      /\bmyth|nymph|titan|olymp|underworld|hades|hercules|heracles|jupiter|zeus|juno|hera|minerva|athena|apollo|diana|artemis|venus|aphrodite|mars|ares|mercury|hermes|neptune|poseidon|pluto|vulcan|bacchus|dionysus|ceres|demeter|vesta|cupid|psyche|perseus|theseus|jason|medea|odysseus|ulysses|achilles|hector|trojan|troy|argonaut|monster|centaur|cyclops|gorgon|medusa|minotaur|labyrinth\b/,
      /\bmetamorphos|transform(?:ed|ation) into\b/,
    ]),
    Literature: score([
      /\bauthor|poet|poem|epic|ode|satire|elegy|elegiac|hexameter|meter|metre|epigram|play(?:wright)?|comedy|tragedy|orat(?:or|ion)|speech|letter|epistle\b/,
      /\bvergil|virgil|ovid|horace|catullus|cicero|caesar|livy|tacitus|plautus|terence|seneca|lucretius|propertius|tibullus|martial|juvenal|pliny|sallust|suetonius|quintilian|ennius|lucan|statius|petronius|apuleius\b/,
      /\baeneid|metamorphoses|georgics|eclogues|de bello gallico|ab urbe condita|annales|carmina|odes|amores|ars amatoria|fasti|satyricon|pharsalia\b/,
      /\bwrote|written by|work(?:s)? of\b/,
    ]),
  };
  const best = (Object.keys(s) as Category[]).reduce((a, b) => (s[b] > s[a] ? b : a), 'Grammar');
  return s[best] ? best : null;
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };
const WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
function roman(s: string): number {
  let n = 0;
  for (let k = 0; k < s.length; k++) {
    const v = ROMAN[s[k]];
    const next = ROMAN[s[k + 1]] ?? 0;
    n += v < next ? -v : v;
  }
  return n;
}

/**
 * Canonical round label: "Round 1"…"Round 12", "Quarterfinal", "Semifinal", "Final".
 * Handles "ROUND II", "Round One", "Rd. 3", "Prelim 2", "Semi-Finals", "FINALS". Unknown labels are title-cased.
 */
export function normalizeRound(label: string | null | undefined): string | null {
  if (!label) return null;
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (/\bquarter/.test(s)) return 'Quarterfinal';
  if (/\bsemi/.test(s)) return 'Semifinal';
  if (/\bfinal/.test(s)) return 'Final';
  const digit = /\b(\d{1,2})\b/.exec(s)?.[1];
  if (digit) return `Round ${Number(digit)}`;
  const rom = /\b([ivx]{1,5})\b/.exec(s)?.[1];
  if (rom && !/\bi\b.*\b(am|is)\b/.test(s)) return `Round ${roman(rom)}`;
  const word = WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(s));
  if (word >= 0) return `Round ${word + 1}`;
  return titleCase(label);
}
