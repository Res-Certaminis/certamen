import { describe, expect, it } from 'vitest';
import { newGame, reduce, redact, revealedWords, scores, type Deck } from '../src/lib/game';
import type { Event, Game } from '../src/lib/types';

const deck: Deck = {
  title: 'Test',
  questions: [
    {
      tossup: 'one two three four five six seven eight nine ten',
      answer: 'ROMA',
      bonuses: [
        { q: 'b1', a: 'AQUA' },
        { q: 'b2', a: 'BELLUM' },
      ],
    },
    { tossup: 'second question', answer: 'CAESAR', bonuses: [] },
  ],
};

const run = (events: [Event, number][], g = newGame('TEST')) =>
  events.reduce((s, [e, t]) => reduce(s, e, t, deck), g);

const lobby: [Event, number][] = [
  [{ t: 'join', id: 'a', name: 'Ann', team: 0 }, 0],
  [{ t: 'join', id: 'b', name: 'Bob', team: 1 }, 0],
  [{ t: 'join', id: 'c', name: 'Cy', team: 1 }, 0],
  [{ t: 'config', wpm: 600 }, 0], // 100ms per word
  [{ t: 'start' }, 1000],
];

describe('reduce', () => {
  it('first joiner becomes host and teams auto-balance', () => {
    const g = run([
      [{ t: 'join', id: 'a', name: 'A' }, 0],
      [{ t: 'join', id: 'b', name: 'B' }, 0],
    ]);
    expect(g.hostId).toBe('a');
    expect(g.players.a.team).not.toBe(g.players.b.team);
  });

  it('reveals words by time and records the word index on buzz', () => {
    const g = run(lobby);
    expect(g.phase).toBe('reading');
    expect(revealedWords(g, 1350)).toBe(3);
    const b = reduce(g, { t: 'buzz', id: 'a' }, 1350, deck);
    expect(b.phase).toBe('buzzed');
    expect(b.buzz).toMatchObject({ player: 'a', team: 0, word: 3 });
    const done = reduce(b, { t: 'answer', id: 'a', text: 'roma' }, 1400, deck);
    expect(done.results[0].word).toBe(3); // buzz position is kept on the result for analytics
    expect(revealedWords(b, 5000)).toBe(3); // frozen while buzzed
  });

  it('server order wins: a second buzz is ignored', () => {
    const g = run([...lobby, [{ t: 'buzz', id: 'a' }, 1350], [{ t: 'buzz', id: 'b' }, 1351]]);
    expect(g.buzz?.player).toBe('a');
  });

  it('wrong answer locks the team out and resumes reading from the buzz word', () => {
    const g = run([
      ...lobby,
      [{ t: 'buzz', id: 'b' }, 1350],
      [{ t: 'answer', id: 'b', text: 'Athens' }, 3000],
    ]);
    expect(g.phase).toBe('reading');
    expect(g.locked).toEqual([1]);
    expect(revealedWords(g, 3000)).toBe(3);
    // teammate on the locked team cannot buzz
    expect(reduce(g, { t: 'buzz', id: 'c' }, 3100, deck).phase).toBe('reading');
    expect(reduce(g, { t: 'buzz', id: 'a' }, 3100, deck).phase).toBe('buzzed');
  });

  it('goes dead when every team is locked out', () => {
    const g = run([
      ...lobby,
      [{ t: 'buzz', id: 'b' }, 1350],
      [{ t: 'answer', id: 'b', text: 'x' }, 2000],
      [{ t: 'buzz', id: 'a' }, 2100],
      [{ t: 'answer', id: 'a', text: 'y' }, 2500],
    ]);
    expect(g.phase).toBe('dead');
    expect(g.revealed).toBe(true);
  });

  it('correct answer scores 10, then bonuses score 5 each', () => {
    let g = run([...lobby, [{ t: 'buzz', id: 'a' }, 1350], [{ t: 'answer', id: 'a', text: 'roma' }, 2000]]);
    expect(g.phase).toBe('bonus');
    expect(scores(g)).toEqual([10, 0, 0]);
    g = reduce(g, { t: 'bonusAnswer', id: 'b', text: 'aqua' }, 2100, deck); // wrong team, ignored
    expect(g.bonusIdx).toBe(0);
    g = reduce(g, { t: 'bonusAnswer', id: 'a', text: 'aqua' }, 2100, deck);
    g = reduce(g, { t: 'bonus', correct: false }, 2200, deck); // host rules B2 wrong
    expect(g.phase).toBe('dead');
    expect(scores(g)).toEqual([15, 0, 0]);
  });

  it('host can override the ruling after the fact', () => {
    let g = run([...lobby, [{ t: 'buzz', id: 'a' }, 1350], [{ t: 'answer', id: 'a', text: 'wrong' }, 2000]]);
    expect(scores(g)).toEqual([0, 0, 0]);
    g = reduce(g, { t: 'judge', correct: true }, 2100, deck);
    expect(g.phase).toBe('bonus');
    expect(g.locked).toEqual([]);
    expect(scores(g)).toEqual([10, 0, 0]);
  });

  it('live mode: no text timing, host judges directly', () => {
    let g = run([
      [{ t: 'join', id: 'a', name: 'A', team: 0 }, 0],
      [{ t: 'config', mode: 'live' }, 0],
      [{ t: 'start' }, 0],
    ]);
    g = reduce(g, { t: 'buzz', id: 'a' }, 500, deck);
    expect(g.buzz?.word).toBe(0);
    g = reduce(g, { t: 'judge', correct: true }, 600, deck);
    expect(g.phase).toBe('bonus');
  });

  it('next advances and finishes with done', () => {
    let g = run([...lobby, [{ t: 'dead' }, 2000], [{ t: 'next' }, 2100]]);
    expect(g.qi).toBe(1);
    expect(g.phase).toBe('reading');
    g = reduce(g, { t: 'next' }, 2200, deck);
    expect(g.phase).toBe('done');
  });
});

describe('redact', () => {
  const g = run([...lobby, [{ t: 'buzz', id: 'a' }, 1350], [{ t: 'answer', id: 'a', text: 'roma' }, 2000]]);
  it('hides unrevealed answers and future bonuses from players', () => {
    const r = redact(g, false);
    expect(r.question?.answer).toBe('ROMA'); // tossup already answered correctly
    expect(r.question?.bonuses).toEqual([
      { q: 'b1', a: '' },
      { q: '', a: '' },
    ]);
  });
  it('hides the tossup answer while reading', () => {
    const reading = run(lobby);
    expect(redact(reading, false).question?.answer).toBe('');
    expect(redact(reading, true).question?.answer).toBe('ROMA');
  });
  it('shows everything to the host', () => {
    expect(redact(g, true).question).toEqual(deck.questions[0]);
  });
  it('reveals everything once dead', () => {
    const dead: Game = { ...g, phase: 'dead', revealed: true };
    expect(redact(dead, false).question).toEqual(deck.questions[0]);
  });
});
