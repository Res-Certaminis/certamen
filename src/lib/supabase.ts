import { createClient } from '@supabase/supabase-js';
import type { BuzzRow, Question, QuestionSet } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url!, key!) : null;

const need = () => {
  if (!supabase) throw new Error('Supabase is not configured (see .env.example)');
  return supabase;
};

const SET_COLS = 'id,owner,title,level,year,tournament,region,round,public,created_at';

/** Sets without their questions (a count only); use getSet to load one for play. */
export async function listSets(ownerOnly?: string): Promise<QuestionSet[]> {
  let q = need()
    .from('sets')
    .select(`${SET_COLS},questions(count)`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (ownerOnly) q = q.eq('owner', ownerOnly);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(
    ({ questions, ...s }) => ({ ...s, questions: [], count: questions[0]?.count ?? 0 }) as QuestionSet,
  );
}

export async function getSet(id: string): Promise<QuestionSet> {
  const { data, error } = await need()
    .from('sets')
    .select(`${SET_COLS},questions(id,idx,tossup,answer,bonuses,category,subcategory)`)
    .eq('id', id)
    .order('idx', { referencedTable: 'questions' })
    .single();
  if (error) throw error;
  return data as unknown as QuestionSet;
}

/** Upsert the set row, then its questions by id (keeping ids so buzz history survives edits). */
export async function saveSet(set: QuestionSet): Promise<QuestionSet> {
  const sb = need();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) throw new Error('Sign in to save a set');
  const { questions, count: _c, created_at: _t, ...row } = set;
  const { data: saved, error } = await sb
    .from('sets')
    .upsert({ ...row, owner: u.user.id })
    .select(SET_COLS)
    .single();
  if (error) throw error;
  const rows = questions.map((q, idx) => ({
    ...q,
    set_id: saved.id,
    idx,
    category: q.category || null,
    subcategory: q.subcategory?.trim() || null,
  }));
  const { data: qs, error: qe } = await sb
    .from('questions')
    .upsert(rows, { defaultToNull: false })
    .select('id');
  if (qe) throw qe;
  const keep = qs.map((q) => q.id);
  const { error: de } = await sb
    .from('questions')
    .delete()
    .eq('set_id', saved.id)
    .not('id', 'in', `(${keep.join(',')})`);
  if (de) throw de;
  return getSet(saved.id);
}

/** Public sets that share tournament, year and level: used to warn about re-uploading a round. */
export async function findPublicSets(m: {
  tournament: string | null;
  year: number | null;
  level: string | null;
}) {
  if (!m.tournament || !m.year || !m.level) return [] as QuestionSet[];
  const { data, error } = await need()
    .from('sets')
    .select(`${SET_COLS},questions(count)`)
    .eq('public', true)
    .ilike('tournament', m.tournament.trim())
    .eq('year', m.year)
    .eq('level', m.level);
  if (error) throw error;
  return data.map(
    ({ questions, ...s }) => ({ ...s, questions: [], count: questions[0]?.count ?? 0 }) as QuestionSet,
  );
}

export async function deleteSet(id: string) {
  const { error } = await need().from('sets').delete().eq('id', id);
  if (error) throw error;
}

export async function listBuzzes(questions: Question[]): Promise<BuzzRow[]> {
  const ids = questions.map((q) => q.id).filter(Boolean) as string[];
  if (!ids.length) return [];
  const { data, error } = await need()
    .from('buzzes')
    .select('question_id,room,mode,player,team,word,words,correct,answer,created_at')
    .in('question_id', ids)
    .limit(5000);
  if (error) throw error;
  return data as BuzzRow[];
}

export const LEVELS = ['novice', 'intermediate', 'advanced'] as const;
export { CATEGORIES, REGIONS } from './types';
