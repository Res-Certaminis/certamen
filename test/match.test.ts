import { describe, expect, it } from 'vitest';
import { match, normalize, variants } from '../src/lib/match';

describe('normalize', () => {
  it('strips macrons, case, punctuation and articles', () => {
    expect(normalize('Rōma, the Eternal City!')).toBe('roma eternal city');
  });
  it('treats i/j and u/v as interchangeable at word start', () => {
    expect(normalize('Juppiter')).toBe(normalize('Iuppiter'));
    expect(normalize('Venus')).toBe(normalize('uenus'));
  });
});

describe('variants', () => {
  it('splits alternates and parenthetical accepts', () => {
    expect(variants('MARCUS TULLIUS CICERO (accept TULLY)')).toEqual(
      expect.arrayContaining(['marcus tullius cicero', 'tully', 'cicero', 'marcus', 'tullius']),
    );
  });
  it('ignores rejections and prompts', () => {
    expect(variants('AENEAS (do not accept ANCHISES)')).not.toContain('anchises');
  });
});

describe('match', () => {
  it('accepts exact, partial and slightly misspelled answers', () => {
    expect(match('cicero', 'MARCUS TULLIUS CICERO')).toBe(true);
    expect(match('Marcus Tulius Cicero', 'MARCUS TULLIUS CICERO')).toBe(true);
    expect(match('Ceasar', 'CAESAR')).toBe(true);
  });
  it('rejects wrong and empty answers', () => {
    expect(match('Caesar', 'MARCUS TULLIUS CICERO')).toBe(false);
    expect(match('', 'ROMA')).toBe(false);
    expect(match('Rome', 'ROMA')).toBe(false); // short answers need an exact match
  });
});
