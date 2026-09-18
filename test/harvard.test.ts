/** Regression test on a real college-hosted packet: division heading with an em dash, "Semis"/"Finals", score checks. */
import { describe, expect, it } from 'vitest';
import { guessMeta, parseText, splitRounds } from '../src/lib/parse';

const packet = `Harvard Certamen 2025 
Written by: Owen Butler, Cristian Colon, and others. 
Edited by: Kyler Hoogendoorn-Ecker, James McCurley, and Dante Minutillo. 
Intermediate — Preliminary Round One 
1.   What sort of event, which often saw the Janiculum seized, led to the creation of the
tribunes and occurred up to five times? 
SĒCESSIŌ PLĒBIS   // SECESSION OF THE PLEBS 
B1: How did Menenius Agrippa end the first secession of the plebs? 
HE TOLD A STORY (OF THE BELLY AND LIMBS) 
B2: What law was passed after the final secession of the plebs? 
LĒX HORTĒNSIA 
2.   Distinguish in meaning between   cūrō   with one   r   and   currō   with two   r s. 
(TO / I) CARE and (TO / I) RUN (RESPECTIVELY) 
B1: Now distinguish in meaning between   legō   and   regō . 
(TO / I) READ/COLLECT and (TO / I) RULE (RESPECTIVELY) 
**SCORE CHECK** 
3.   What U.S. state, which has the motto “ Quī transtulit, sustinet ,” is also home to a university whose
motto is “ Lūx et Vēritās ”? 
CONNECTICUT 
Intermediate — Preliminary Round One 
4.   Who was the first king of Rome? 
ROMULUS 
Intermediate — Preliminary Round Two 
1.   Translate: Puella aquam portat. 
THE GIRL CARRIES WATER 
Intermediate — Semis 
1.   Who wrote the Aeneid? 
VERGIL 
Intermediate — Semifinals 
2.   Who wrote the Metamorphoses? 
OVID 
Intermediate — Finals 
1.   Name the capital of Gaul. 
LUTETIA 
`;

describe('Harvard-style packet', () => {
  const { preamble, chunks } = splitRounds(packet);
  it('splits on "Division — Round" headings and normalises Semis/Finals', () => {
    expect(chunks.map((c) => c.round)).toEqual(['Round 1', 'Round 2', 'Semifinal', 'Final']);
    expect(preamble.split('\n')[0].trim()).toBe('Harvard Certamen 2025');
  });
  it('parses questions past score checks and repeated page headers', () => {
    const qs = parseText(chunks[0].text);
    expect(qs.map((q) => q.answer)).toEqual([
      'SĒCESSIŌ PLĒBIS // SECESSION OF THE PLEBS',
      '(TO / I) CARE and (TO / I) RUN (RESPECTIVELY)',
      'CONNECTICUT',
      'ROMULUS',
    ]);
    expect(qs[0].bonuses[1]).toEqual({
      q: 'What law was passed after the final secession of the plebs?',
      a: 'LĒX HORTĒNSIA',
    });
    expect(qs[2].tossup).not.toMatch(/SCORE CHECK/);
    expect(parseText(chunks[2].text).map((q) => q.answer)).toEqual(['VERGIL', 'OVID']);
  });
  it('guesses metadata from the cover, never from a question', () => {
    expect(guessMeta(preamble)).toEqual({
      tournament: 'Harvard Certamen',
      region: 'Competitive Circuit',
      level: null,
      year: 2025,
    });
    // Even without a split, the cover lines win over the question that mentions a university.
    expect(guessMeta(packet)).toMatchObject({
      tournament: 'Harvard Certamen',
      region: 'Competitive Circuit',
      level: 'intermediate',
      year: 2025,
    });
  });
});
