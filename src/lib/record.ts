/** Buzz analytics: turn finished tossup results into rows and append them to Supabase. */
import { wordCount } from './game';
import type { BuzzRow, Game } from './types';

/** Rows for the current question. Call when advancing past it so overrides are included. */
export function buzzRows(g: Game): BuzzRow[] {
  const q = g.question;
  if (!q?.id) return [];
  return g.results
    .filter((r) => r.qi === g.qi)
    .map((r) => ({
      question_id: q.id!,
      room: g.code,
      mode: g.mode,
      player: g.players[r.player]?.name ?? '?',
      team: r.team,
      word: r.word,
      words: wordCount(q.tossup),
      correct: r.correct,
      answer: r.answer,
    }));
}

export async function recordBuzzes(rows: BuzzRow[]) {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  if (!rows.length || !url || !key || !navigator.onLine) return;
  try {
    await fetch(`${url}/rest/v1/buzzes`, {
      method: 'POST',
      // Publishable keys are not JWTs: send on `apikey` only, never as a Bearer token.
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
      keepalive: true,
    });
  } catch {
    /* analytics are best-effort */
  }
}

/** Wrap a dispatcher so buzzes are recorded whenever the host leaves a question. */
export function withRecording<E extends { t: string }>(get: () => Game, send: (e: E) => void) {
  return (e: E) => {
    if (e.t === 'next' || e.t === 'goto') recordBuzzes(buzzRows(get()));
    send(e);
  };
}
