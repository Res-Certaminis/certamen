/** localStorage helpers: identity, settings, and offline question sets. */
import type { QuestionSet } from './types';

const get = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

export const playerId = (): string => {
  let id = get<string>('pid', '');
  if (!id) set('pid', (id = crypto.randomUUID().slice(0, 8)));
  return id;
};

export const playerName = () => get('name', '');
export const setPlayerName = (n: string) => set('name', n);

export const buzzKey = () => get('buzzKey', 'Space');
export const setBuzzKey = (k: string) => set('buzzKey', k);

export const aiKey = () => get('anthropicKey', '');
export const setAiKey = (k: string) => set('anthropicKey', k.trim());
export const aiModel = () => get('anthropicModel', 'claude-opus-5');
export const setAiModel = (m: string) => set('anthropicModel', m);

export const savedSets = () => get<QuestionSet[]>('sets', []);
export function saveOffline(s: QuestionSet) {
  set('sets', [...savedSets().filter((x) => x.id !== s.id), s]);
}
export function removeOffline(id: string) {
  set(
    'sets',
    savedSets().filter((x) => x.id !== id),
  );
}

export const roomCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(5)),
    (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32],
  ).join('');
