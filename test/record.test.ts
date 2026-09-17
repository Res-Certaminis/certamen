import { describe, expect, it } from 'vitest';
import { newGame, reduce, type Deck } from '../src/lib/game';
import { buzzRows, withRecording } from '../src/lib/record';
import type { Event } from '../src/lib/types';

const deck: Deck = {
  title: 'T',
  questions: [
    { id: 'q1', tossup: 'a b c d e f g h', answer: 'ROMA', bonuses: [], category: 'History' },
    { tossup: 'no id so never recorded', answer: 'X', bonuses: [] },
  ],
};
const play = (events: [Event, number][]) =>
  events.reduce((g, [e, t]) => reduce(g, e, t, deck), newGame('ROOM1'));

describe('buzzRows', () => {
  it('emits one row per tossup buzz on the current question, with position and outcome', () => {
    const g = play([
      [{ t: 'join', id: 'a', name: 'Ann', team: 0 }, 0],
      [{ t: 'join', id: 'b', name: 'Bob', team: 1 }, 0],
      [{ t: 'config', wpm: 600 }, 0],
      [{ t: 'start' }, 1000],
      [{ t: 'buzz', id: 'b' }, 1250],
      [{ t: 'answer', id: 'b', text: 'Athens' }, 2000],
      [{ t: 'buzz', id: 'a' }, 2300],
      [{ t: 'answer', id: 'a', text: 'roma' }, 3000],
    ]);
    expect(buzzRows(g)).toEqual([
      {
        question_id: 'q1',
        room: 'ROOM1',
        mode: 'reader',
        player: 'Bob',
        team: 1,
        word: 2,
        words: 8,
        correct: false,
        answer: 'Athens',
      },
      {
        question_id: 'q1',
        room: 'ROOM1',
        mode: 'reader',
        player: 'Ann',
        team: 0,
        word: 5,
        words: 8,
        correct: true,
        answer: 'roma',
      },
    ]);
  });

  it('reflects host overrides made before advancing', () => {
    let g = play([
      [{ t: 'join', id: 'a', name: 'Ann', team: 0 }, 0],
      [{ t: 'start' }, 0],
      [{ t: 'buzz', id: 'a' }, 100],
      [{ t: 'answer', id: 'a', text: 'wrong' }, 200],
    ]);
    g = reduce(g, { t: 'judge', correct: true }, 300, deck);
    expect(buzzRows(g).map((r) => r.correct)).toEqual([true]);
  });

  it('skips questions without an id (local or unsaved sets)', () => {
    const g = play([
      [{ t: 'join', id: 'a', name: 'Ann' }, 0],
      [{ t: 'start' }, 0],
      [{ t: 'next' }, 10],
    ]);
    expect(g.qi).toBe(1);
    expect(buzzRows(g)).toEqual([]);
  });
});

describe('withRecording', () => {
  it('snapshots the question being left, then forwards the event', () => {
    let g = play([
      [{ t: 'join', id: 'a', name: 'Ann' }, 0],
      [{ t: 'start' }, 0],
      [{ t: 'buzz', id: 'a' }, 100],
      [{ t: 'answer', id: 'a', text: 'roma' }, 200],
    ]);
    const seen: Event[] = [];
    const send = withRecording<Event>(
      () => g,
      (e) => {
        seen.push(e);
        g = reduce(g, e, 500, deck);
      },
    );
    send({ t: 'next' });
    expect(seen).toEqual([{ t: 'next' }]);
    expect(g.qi).toBe(1);
  });
});
