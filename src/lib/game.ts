/**
 * Pure game reducer. Runs unchanged inside the Cloudflare Durable Object (multiplayer)
 * and in the browser (solo practice). Never touches the network or the DOM.
 */
import type { Buzz, Event, Game, Question, QuestionSet, Result } from './types';
import { match } from './match';

export const TOSSUP_POINTS = 10;
export const BONUS_POINTS = 5;

export function newGame(code: string): Game {
  return {
    code,
    mode: 'reader',
    hostId: null,
    teams: ['Team 1', 'Team 2', 'Team 3'],
    players: {},
    setTitle: '',
    total: 0,
    qi: 0,
    phase: 'lobby',
    startedAt: 0,
    wpm: 200,
    buzz: null,
    locked: [],
    pausedWord: 0,
    results: [],
    bonusIdx: 0,
    question: null,
    revealed: false,
    log: [],
  };
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const msPerWord = (wpm: number) => 60000 / wpm;

/** Words revealed at time `now` for a reading that began at `startedAt`. */
export function revealedWords(g: Game, now: number): number {
  if (!g.question) return 0;
  const n = wordCount(g.question.tossup);
  if (g.phase === 'paused') return g.pausedWord;
  if (g.phase !== 'reading') return g.buzz?.word ?? (g.phase === 'lobby' ? 0 : n);
  return Math.min(n, Math.floor((now - g.startedAt) / msPerWord(g.wpm)));
}

export function scores(g: Game): number[] {
  const s = g.teams.map(() => 0);
  for (const r of g.results) {
    if (r.team < 0 || r.team >= s.length) continue;
    if (r.correct) s[r.team] += TOSSUP_POINTS + BONUS_POINTS * r.bonuses.filter(Boolean).length;
  }
  return s;
}

export function current(g: Game): Result | undefined {
  return g.results.find((r) => r.qi === g.qi && r.correct);
}

const push = (g: Game, line: string) => (g.log = [...g.log.slice(-19), line]);
const name = (g: Game, id: string) => g.players[id]?.name ?? '?';

/** The subset of a set the reducer needs; the full set lives beside the game state. */
export interface Deck {
  title: string;
  questions: Question[];
}

export const toDeck = (s: QuestionSet): Deck => ({ title: s.title, questions: s.questions });

function loadQuestion(g: Game, deck: Deck | null) {
  g.question = deck?.questions[g.qi] ?? null;
  g.buzz = null;
  g.locked = [];
  g.bonusIdx = 0;
  g.revealed = false;
  g.startedAt = 0;
}

function startReading(g: Game, now: number, fromWord = 0) {
  g.phase = 'reading';
  g.startedAt = now - fromWord * msPerWord(g.wpm);
  g.buzz = null;
}

function finishTossup(g: Game, now: number, correct: boolean, answer?: string) {
  const b = g.buzz!;
  const r: Result = { qi: g.qi, team: b.team, player: b.player, correct, word: b.word, answer, bonuses: [] };
  g.results = [...g.results.filter((x) => !(x.qi === g.qi && x.player === b.player)), r];
  if (correct) {
    r.bonuses = (g.question?.bonuses ?? []).map(() => null);
    push(g, `${name(g, b.player)} correct (+${TOSSUP_POINTS})`);
    g.phase = r.bonuses.length ? 'bonus' : 'dead';
    g.revealed = g.phase === 'dead';
    g.bonusIdx = 0;
  } else {
    push(g, `${name(g, b.player)} incorrect`);
    g.locked = [...new Set([...g.locked, b.team])];
    const teamsInPlay = new Set(Object.values(g.players).map((p) => p.team));
    const allLocked = [...teamsInPlay].every((t) => g.locked.includes(t));
    if (allLocked) {
      g.phase = 'dead';
      g.revealed = true;
    } else if (g.mode === 'reader') startReading(g, now, b.word);
    else g.phase = 'reading';
  }
}

export function reduce(g: Game, e: Event, now: number, deck: Deck | null): Game {
  g = { ...g, players: { ...g.players } }; // shallow copy; nested arrays are replaced, never mutated
  switch (e.t) {
    case 'join': {
      const existing = g.players[e.id];
      const team = e.team ?? existing?.team ?? smallestTeam(g);
      g.players[e.id] = { id: e.id, name: e.name || existing?.name || 'Player', team, online: true };
      if (!g.hostId) g.hostId = e.id;
      if (!existing) push(g, `${e.name} joined ${g.teams[team]}`);
      break;
    }
    case 'leave':
      if (g.players[e.id]) g.players[e.id] = { ...g.players[e.id], online: false };
      break;
    case 'team':
      if (g.players[e.id] && e.team >= 0 && e.team < g.teams.length)
        g.players[e.id] = { ...g.players[e.id], team: e.team };
      break;
    case 'rename':
      if (g.players[e.id]) g.players[e.id] = { ...g.players[e.id], name: e.name.slice(0, 24) };
      break;
    case 'host':
      if (g.players[e.id]) g.hostId = e.id;
      break;
    case 'config':
      if (e.mode) g.mode = e.mode;
      if (e.wpm && e.wpm >= 60 && e.wpm <= 600) {
        // Re-anchor the reveal clock so the visible text does not jump when speed changes mid-read.
        const shown = g.phase === 'reading' ? revealedWords(g, now) : 0;
        g.wpm = e.wpm;
        if (g.phase === 'reading') g.startedAt = now - shown * msPerWord(g.wpm);
      }
      if (e.teams && e.teams.length >= 1 && e.teams.length <= 6) {
        g.teams = e.teams.map((t, i) => t.trim() || `Team ${i + 1}`);
        for (const p of Object.values(g.players))
          if (p.team >= g.teams.length) g.players[p.id] = { ...p, team: 0 };
      }
      break;
    case 'start':
      if (!deck?.questions.length) break;
      g.setTitle = deck.title;
      g.total = deck.questions.length;
      if (g.phase === 'lobby' || g.phase === 'done') {
        g.qi = 0;
        g.results = [];
      }
      loadQuestion(g, deck);
      startReading(g, now);
      push(g, `Question ${g.qi + 1}`);
      break;
    case 'buzz': {
      const p = g.players[e.id];
      if (g.phase !== 'reading' || !p || g.locked.includes(p.team) || g.buzz) break;
      const word = g.mode === 'reader' ? revealedWords(g, now) : 0;
      g.buzz = { player: e.id, team: p.team, at: now, word } satisfies Buzz;
      g.phase = 'buzzed';
      push(g, `${p.name} buzzed`);
      break;
    }
    case 'answer': {
      if (g.phase !== 'buzzed' || g.buzz?.player !== e.id || !g.question) break;
      finishTossup(g, now, match(e.text, g.question.answer), e.text);
      break;
    }
    case 'judge': {
      if (g.phase === 'buzzed' && g.buzz) finishTossup(g, now, e.correct);
      else {
        // Override the most recent ruling on this question.
        const r = [...g.results].reverse().find((x) => x.qi === g.qi);
        if (!r) break;
        g.results = g.results.filter((x) => x !== r);
        g.buzz = { player: r.player, team: r.team, at: now, word: r.word };
        g.locked = g.locked.filter((t) => t !== r.team);
        finishTossup(g, now, e.correct, r.answer);
        push(g, `Host overrode: ${e.correct ? 'correct' : 'incorrect'}`);
      }
      break;
    }
    case 'bonusAnswer': {
      const r = current(g);
      if (g.phase !== 'bonus' || !r || !g.question || g.players[e.id]?.team !== r.team) break;
      judgeBonus(g, r, match(e.text, g.question.bonuses[g.bonusIdx]?.a ?? ''));
      break;
    }
    case 'bonus': {
      const r = current(g);
      if (!r) break;
      if (g.phase === 'bonus') judgeBonus(g, r, e.correct);
      else if (r.bonuses.length) {
        // Override the last judged bonus.
        const i = r.bonuses.length - 1;
        const bonuses = [...r.bonuses];
        bonuses[i] = e.correct;
        g.results = g.results.map((x) => (x === r ? { ...x, bonuses } : x));
      }
      break;
    }
    case 'pause':
      if (g.phase === 'reading') {
        g.pausedWord = g.mode === 'reader' ? revealedWords(g, now) : 0;
        g.phase = 'paused';
        push(g, 'Paused');
      }
      break;
    case 'resume':
      if (g.phase === 'paused') {
        startReading(g, now, g.pausedWord);
        push(g, 'Resumed');
      }
      break;
    case 'dead':
      if (g.phase === 'reading' || g.phase === 'paused' || g.phase === 'buzzed') {
        g.phase = 'dead';
        g.revealed = true;
        g.buzz = null;
        push(g, 'No answer');
      }
      break;
    case 'next':
    case 'goto': {
      if (!deck) break;
      const qi = e.t === 'goto' ? e.qi : g.qi + 1;
      if (qi >= deck.questions.length) {
        g.phase = 'done';
        g.question = null;
        push(g, 'Round over');
        break;
      }
      if (qi < 0) break;
      g.qi = qi;
      loadQuestion(g, deck);
      startReading(g, now);
      push(g, `Question ${g.qi + 1}`);
      break;
    }
    case 'reset': {
      const fresh = newGame(g.code);
      g = { ...fresh, players: g.players, teams: g.teams, hostId: g.hostId, mode: g.mode, wpm: g.wpm };
      break;
    }
  }
  return g;
}

function judgeBonus(g: Game, r: Result, correct: boolean) {
  const bonuses = [...r.bonuses];
  bonuses[g.bonusIdx] = correct;
  g.results = g.results.map((x) => (x === r ? { ...x, bonuses } : x));
  push(g, `Bonus ${g.bonusIdx + 1} ${correct ? 'correct' : 'incorrect'}`);
  if (g.bonusIdx + 1 < bonuses.length) g.bonusIdx++;
  else {
    g.phase = 'dead';
    g.revealed = true;
  }
}

function smallestTeam(g: Game): number {
  const counts = g.teams.map(() => 0);
  for (const p of Object.values(g.players)) if (p.online) counts[p.team]++;
  return counts.indexOf(Math.min(...counts));
}

/** Strip answers from the current question for players until the host reveals them. */
export function redact(g: Game, forHost: boolean): Game {
  if (forHost || g.revealed || !g.question) return g;
  const q = g.question;
  const r = current(g);
  const judged = r?.bonuses.filter((b) => b !== null).length ?? 0;
  const bonuses = q.bonuses.map((b, i) =>
    i < judged ? b : i === g.bonusIdx && g.phase === 'bonus' ? { q: b.q, a: '' } : { q: '', a: '' },
  );
  return { ...g, question: { ...q, answer: r ? q.answer : '', bonuses } };
}

/**
 * Combine several sets into one deck. With `shuffle`, the questions are a random permutation
 * (Fisher–Yates), so nothing repeats until the whole pool has been played.
 */
export function mergeSets(
  sets: QuestionSet[],
  shuffle: boolean,
  rand: () => number = Math.random,
): QuestionSet {
  const questions = sets.flatMap((s) => s.questions);
  if (shuffle)
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
  const title =
    sets.length === 1
      ? sets[0].title
      : `${sets.length} sets · ${sets.map((s) => s.title).join(', ')}`.slice(0, 80);
  return { title: shuffle ? `${title} · shuffled` : title, public: true, questions };
}
