/**
 * Turn a packet (docx/pdf/txt) into questions. Heuristic by design: the upload UI
 * shows an editable preview, so this only has to get most of the way there.
 */
import type { Question } from './types';

const TOSSUP = /^\s*(?:(?:TU|T\.?U\.?|TOSS-?UP|TOSSUP)\s*#?\s*(\d+)?\s*[.:)-]?|(\d{1,2})\s*[.):])\s*/i;
const BONUS = /^\s*(?:B\s*([123])|BONUS\s*#?\s*([123])?)\s*[.:)-]?\s*/i;
const ANSWER = /\b(?:ANS(?:WER)?|A)\s*[.:]\s*/i;

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
    if (!line) continue;
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
  const letters = line.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 && line.length <= 80 && letters === letters.toUpperCase() && !/\?/.test(line);
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
