import { describe, expect, it } from 'vitest';
import { parseText } from '../src/lib/parse';

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
