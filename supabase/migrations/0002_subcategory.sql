-- Questions carry one of four main categories (Grammar, History, Mythology, Literature) for display,
-- plus a free-text subcategory (e.g. "Subjunctive", "Derivatives", "Second Punic War") for analytics.
alter table public.questions add column if not exists subcategory text;
create index if not exists questions_subcategory_idx on public.questions (subcategory);
