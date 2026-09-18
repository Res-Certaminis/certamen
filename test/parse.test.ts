import { describe, expect, it } from 'vitest';
import { guessCategory, guessMeta, normalizeRound, parseText, splitRounds } from '../src/lib/parse';

const njcl = `
NJCL 2024 Novice Round 1

TU 1: What Roman god of the sea carried a trident?
ANSWER: NEPTUNE
B1: Who was his Greek counterpart?
ANSWER: POSEIDON
B2: Name Neptune's wife.
ANSWER: SALACIA (accept AMPHITRITE)

TU 2: Translate into English: "Puella aquam portat."
ANSWER: THE GIRL CARRIES (THE) WATER
B1: Now translate: "Puellae aquam portant."
ANSWER: THE GIRLS CARRY WATER
B2: Now translate: "Puella aquam portabit."
ANSWER: THE GIRL WILL CARRY WATER
`;

const numbered = `
1. Give the Latin for "and".
ET
Bonus 1: Now give an enclitic meaning "and".
-QUE
Bonus 2: Give a third word for "and".
ATQUE (or AC)
2. Who was the first king of Rome? Answer: ROMULUS
B1. Who was the second king? Answer: NUMA POMPILIUS
`;

describe('parseText', () => {
  it('parses TU/B1/B2 packets with ANSWER lines', () => {
    const qs = parseText(njcl);
    expect(qs).toHaveLength(2);
    expect(qs[0].tossup).toBe('What Roman god of the sea carried a trident?');
    expect(qs[0].answer).toBe('NEPTUNE');
    expect(qs[0].bonuses).toEqual([
      { q: 'Who was his Greek counterpart?', a: 'POSEIDON' },
      { q: "Name Neptune's wife.", a: 'SALACIA (accept AMPHITRITE)' },
    ]);
    expect(qs[1].bonuses[1].a).toBe('THE GIRL WILL CARRY WATER');
  });

  it('parses numbered tossups, all-caps answers, and inline Answer: markers', () => {
    const qs = parseText(numbered);
    expect(qs).toHaveLength(2);
    expect(qs[0].answer).toBe('ET');
    expect(qs[0].bonuses[0]).toEqual({ q: 'Now give an enclitic meaning "and".', a: '-QUE' });
    expect(qs[0].bonuses[1].a).toBe('ATQUE (or AC)');
    expect(qs[1].tossup).toBe('Who was the first king of Rome?');
    expect(qs[1].answer).toBe('ROMULUS');
    expect(qs[1].bonuses[0].a).toBe('NUMA POMPILIUS');
  });

  it('does not start a tossup on a stray number inside a question', () => {
    const qs = parseText(`TU 1: In 44 BC, who was assassinated?\n15. Not a question start.\nANSWER: CAESAR`);
    expect(qs).toHaveLength(1);
    expect(qs[0].tossup).toContain('15. Not a question start.');
  });

  it('joins wrapped lines', () => {
    const qs = parseText(`TU 1: This question\nwraps onto two lines?\nANSWER: YES`);
    expect(qs[0].tossup).toBe('This question wraps onto two lines?');
  });
});

describe('splitRounds', () => {
  const packet = `NJCL 2024 Certamen
Novice Division

ROUND 1
TU 1: One?
ANSWER: A
ROUND 2
TU 1: Two?
ANSWER: B
Semifinal Round
TU 1: Three?
ANSWER: C
FINALS
TU 1: Four?
ANSWER: D`;

  it('splits a division packet into rounds and keeps the cover page as preamble', () => {
    const { preamble, chunks } = splitRounds(packet);
    expect(preamble).toBe('NJCL 2024 Certamen\nNovice Division');
    expect(chunks.map((c) => c.round)).toEqual(['Round 1', 'Round 2', 'Semifinal', 'Final']);
    expect(parseText(chunks[2].text)[0].answer).toBe('C');
  });

  it('returns a single chunk when there is no round structure', () => {
    const { chunks } = splitRounds('TU 1: Only one round here?\nANSWER: YES');
    expect(chunks).toEqual([{ round: null, text: 'TU 1: Only one round here?\nANSWER: YES' }]);
  });

  it('ignores round-like words inside questions and repeated page headers', () => {
    const t = `Round 1\nTU 1: In which round building did senators meet?\nANSWER: CURIA\nRound 1\nTU 2: Next?\nANSWER: X\nRound 2\nTU 1: Y?\nANSWER: Z`;
    const { chunks } = splitRounds(t);
    expect(chunks.map((c) => c.round)).toEqual(['Round 1', 'Round 2']);
    expect(parseText(chunks[0].text)).toHaveLength(2);
    expect(parseText(chunks[0].text)[0].answer).toBe('CURIA');
  });
});

describe('guessMeta', () => {
  it('recognises NJCL as National', () => {
    expect(guessMeta('2024 NJCL Convention\nCertamen Novice Round 1')).toEqual({
      tournament: 'NJCL',
      region: 'National',
      level: 'novice',
      year: 2024,
    });
  });
  it('recognises a state JCL', () => {
    expect(
      guessMeta('Virginia Junior Classical League\nState Convention 2023\nAdvanced Certamen'),
    ).toMatchObject({
      tournament: 'Virginia JCL',
      region: 'Virginia',
      level: 'advanced',
      year: 2023,
    });
  });
  it('labels college-hosted invitationals as Competitive Circuit', () => {
    expect(guessMeta('Yale University Certamen Invitational 2025\nIntermediate Division')).toMatchObject({
      tournament: 'Yale University Certamen Invitational',
      region: 'Competitive Circuit',
      level: 'intermediate',
      year: 2025,
    });
  });
  it('uses the state for a high-school host and returns nulls when nothing is stated', () => {
    expect(guessMeta('Thomas Jefferson High School Certamen\nAlexandria, Virginia').region).toBe('Virginia');
    expect(guessMeta('TU 1: Who?\nANSWER: X')).toEqual({
      tournament: null,
      region: null,
      level: null,
      year: null,
    });
  });
});

describe('guessCategory', () => {
  const q = (tossup: string) => ({ tossup, answer: '', bonuses: [] });
  it('sorts obvious tossups into the four main categories', () => {
    expect(guessCategory(q('Translate into English: Puella aquam portat.'))).toBe('Grammar');
    expect(guessCategory(q('What Roman god of the sea carried a trident?'))).toBe('Mythology');
    expect(guessCategory(q('Which emperor was assassinated in 41 AD after a short reign?'))).toBe('History');
    expect(guessCategory(q('What poet wrote the Aeneid in dactylic hexameter?'))).toBe('Literature');
    expect(guessCategory(q('Name the capital.'))).toBeNull();
  });
});

describe('normalizeRound', () => {
  it('maps every common heading style onto a canonical label', () => {
    expect(normalizeRound('ROUND II')).toBe('Round 2');
    expect(normalizeRound('Round One')).toBe('Round 1');
    expect(normalizeRound('Rd. 3:')).toBe('Round 3');
    expect(normalizeRound('Preliminary Round 4')).toBe('Round 4');
    expect(normalizeRound('Round IV')).toBe('Round 4');
    expect(normalizeRound('Semi-Finals')).toBe('Semifinal');
    expect(normalizeRound('Semifinal Round')).toBe('Semifinal');
    expect(normalizeRound('FINALS')).toBe('Final');
    expect(normalizeRound('Final Round')).toBe('Final');
    expect(normalizeRound('Quarterfinal 2')).toBe('Quarterfinal');
    expect(normalizeRound(null)).toBeNull();
    expect(normalizeRound('Bonus Round')).toBe('Bonus Round');
  });
});

describe('answer marker', () => {
  it('does not treat "A.D." inside a question as an answer marker', () => {
    const qs = parseText(
      'TU 1: Who won at the Milvian Bridge in 312 A.D. after a vision?\nANSWER: CONSTANTINE',
    );
    expect(qs[0].tossup).toBe('Who won at the Milvian Bridge in 312 A.D. after a vision?');
    expect(qs[0].answer).toBe('CONSTANTINE');
  });
  it('still accepts a bare A: at the start of a line', () => {
    expect(parseText('1. Who?\nA: CAESAR')[0].answer).toBe('CAESAR');
  });
});
