import { describe, expect, it } from 'vitest';
import { applyParsed, type ParsedPacket } from '../src/lib/ai';

const parsed: ParsedPacket = {
  title: 'NJCL 2024 Novice Round 1',
  level: 'novice',
  year: 2024,
  tournament: 'NJCL',
  region: null,
  round: 'Round 1',
  questions: [
    {
      tossup: 'Q?',
      answer: 'A',
      category: 'Mythology',
      bonuses: [
        { q: 'b1', a: 'a1' },
        { q: 'b2', a: 'a2' },
        { q: 'b3', a: 'a3' },
        { q: 'b4', a: 'a4' },
      ],
    },
  ],
};

describe('applyParsed', () => {
  it('fills metadata from the model when the uploader left it blank', () => {
    const s = applyParsed(parsed);
    expect(s).toMatchObject({
      title: parsed.title,
      level: 'novice',
      year: 2024,
      tournament: 'NJCL',
      round: 'Round 1',
      public: true,
    });
    expect(s.region).toBeNull();
  });
  it('keeps metadata the uploader already typed and caps bonuses at three', () => {
    const s = applyParsed(parsed, { title: 'My title', level: 'advanced', public: false });
    expect(s.title).toBe('My title');
    expect(s.level).toBe('advanced');
    expect(s.public).toBe(false);
    expect(s.questions[0].bonuses).toHaveLength(3);
    expect(s.questions[0].category).toBe('Mythology');
  });
});
