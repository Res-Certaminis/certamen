-- Schema: sets → questions (one row each, analyzable) → buzzes (one row per tossup buzz).
-- Run in the Supabase SQL editor or via `pnpm db:push`.

create table if not exists public.sets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  level text check (level in ('novice', 'intermediate', 'advanced')),
  year int,
  tournament text,   -- e.g. "NJCL", "Yale Certamen", "FJCL State Forum"
  region text,       -- e.g. "National", "Virginia", "Northeast"
  round text,        -- e.g. "Round 3", "Semifinal"
  public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists sets_created_idx on public.sets (created_at desc);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  idx int not null,
  tossup text not null,
  answer text not null,
  bonuses jsonb not null default '[]'::jsonb,   -- [{ "q": "...", "a": "..." }]
  category text,                                 -- e.g. Mythology, History, Grammar, Vocabulary, Derivatives, Literature, Culture
  unique (set_id, idx)
);
create index if not exists questions_category_idx on public.questions (category);

create table if not exists public.buzzes (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.questions (id) on delete cascade,
  room text,            -- room code, or 'solo'
  mode text,            -- 'reader' | 'live'
  player text,          -- display name only
  team int,
  word int not null,    -- words revealed when the buzz landed (0 in live mode)
  words int not null,   -- total words in the tossup
  correct boolean not null,
  answer text,          -- what was typed (reader mode)
  created_at timestamptz not null default now()
);
create index if not exists buzzes_question_idx on public.buzzes (question_id);

alter table public.sets enable row level security;
alter table public.questions enable row level security;
alter table public.buzzes enable row level security;

create policy "sets: read public or own" on public.sets for select using (public or owner = auth.uid());
create policy "sets: insert own" on public.sets for insert with check (owner = auth.uid());
create policy "sets: update own" on public.sets for update using (owner = auth.uid());
create policy "sets: delete own" on public.sets for delete using (owner = auth.uid());

create policy "questions: read via set" on public.questions for select
  using (exists (select 1 from public.sets s where s.id = set_id and (s.public or s.owner = auth.uid())));
create policy "questions: write own set" on public.questions for all
  using (exists (select 1 from public.sets s where s.id = set_id and s.owner = auth.uid()))
  with check (exists (select 1 from public.sets s where s.id = set_id and s.owner = auth.uid()));

-- Buzz records are public analytics. Anyone (including anonymous players) may append; nobody may edit.
create policy "buzzes: read" on public.buzzes for select using (true);
create policy "buzzes: append" on public.buzzes for insert with check (true);
