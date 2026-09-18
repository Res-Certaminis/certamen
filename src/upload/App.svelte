<script lang="ts">
  import type { Session } from '@supabase/supabase-js';
  import Brand from '../lib/Brand.svelte';
  import {
    configured,
    supabase,
    saveSet,
    deleteSet,
    getSet,
    listSets,
    findPublicSets,
    LEVELS,
    CATEGORIES,
    REGIONS,
  } from '../lib/supabase';
  import {
    fileToText,
    guessCategory,
    guessMeta,
    normalizeRound,
    parseText,
    splitRounds,
    type Chunk,
  } from '../lib/parse';
  import { aiKey, setAiKey, aiModel, setAiModel } from '../lib/store';
  import { AI_MODELS, type AiModel } from '../lib/ai';
  import type { Level, Question, QuestionSet } from '../lib/types';

  // ---- auth & library --------------------------------------------------------------------
  let session = $state<Session | null>(null);
  let email = $state('');
  let notice = $state('');
  let mine = $state<QuestionSet[]>([]);
  supabase?.auth.getSession().then(({ data }) => (session = data.session));
  supabase?.auth.onAuthStateChange((_e, s) => (session = s));
  $effect(() => {
    if (session) loadMine();
  });
  async function loadMine() {
    try {
      mine = await listSets(session!.user.id);
    } catch (e) {
      notice = (e as Error).message;
    }
  }
  const oauth = (provider: 'github' | 'google') =>
    supabase!.auth.signInWithOAuth({ provider, options: { redirectTo: location.href } });
  async function magic() {
    const { error } = await supabase!.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href },
    });
    notice = error ? error.message : `Check ${email} for a sign-in link.`;
  }

  // ---- import pipeline: pick → parse → review --------------------------------------------
  type Status = 'queued' | 'parsing' | 'done' | 'error';
  interface Job extends Chunk {
    status: Status;
    note: string;
    progress?: number; // questions seen so far while streaming
    set?: QuestionSet;
    dupe?: QuestionSet; // an already-public set for the same tournament/year/level/round
    action?: 'save' | 'skip' | 'replace';
  }
  const normRound = (r: string | null | undefined) => (r ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const CONCURRENCY = 4;
  interface Meta {
    tournament: string | null;
    year: number | null;
    level: Level | null;
    region: string | null;
  }
  let stage = $state<'pick' | 'parse' | 'review'>('pick');
  let source = $state(''); // file name or "Pasted text"
  let raw = $state('');
  let preamble = $state('');
  let jobs = $state<Job[]>([]);
  let meta = $state<Meta>({ tournament: null, year: null, level: null, region: null });
  let key = $state(aiKey());
  let model = $state<AiModel>(aiModel() as AiModel);
  let editing = $state<number | null>(null);
  let editQ = $state<number | null>(null); // which tossup card is in edit mode
  let existing = $state<QuestionSet[]>([]);
  let dupeCheck = $state<'idle' | 'checking' | 'done' | 'skipped' | 'error'>('idle');
  let dupeReq = 0;
  let busy = $state(false);
  let saving = $state('');

  const done = $derived(jobs.filter((j) => j.status === 'done').length);
  const failed = $derived(jobs.filter((j) => j.status === 'error').length);
  const running = $derived(jobs.some((j) => j.status === 'parsing' || j.status === 'queued'));
  const drafts = $derived(jobs.filter((j) => j.set && j.action !== 'skip').map((j) => j.set!));
  const skipped = $derived(jobs.filter((j) => j.action === 'skip').length);
  const totalQ = $derived(drafts.reduce((n, s) => n + s.questions.length, 0));

  async function onFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    busy = true;
    try {
      ingest(await fileToText(f), f.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      notice = String(err);
    }
    busy = false;
  }
  function ingest(text: string, name: string) {
    raw = text;
    source = name;
    const split = splitRounds(text);
    preamble = split.preamble;
    jobs = split.chunks.map((c) => ({ ...c, status: 'queued', note: '', progress: 0 }));
    meta = guessMeta(split.preamble || text);
    if (!meta.level) meta.level = guessMeta(text).level; // the level is often only in the round headings
    stage = 'parse';
    draft = null;
    runAll();
  }
  /** Parse every queued round: with AI (two at a time) when a key is set, otherwise instantly. */
  async function runAll() {
    if (!key) {
      for (const j of jobs) finish(j, { questions: parseText(j.text) });
      return;
    }
    const { aiParse, aiError } = await import('../lib/ai');
    const queue = jobs.filter((j) => j.status === 'queued' || j.status === 'error');
    const worker = async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        j.status = 'parsing';
        j.note = '';
        j.progress = 0;
        try {
          const ctx = preamble || (jobs.length === 1 ? '' : raw.slice(0, 1500));
          const p = await aiParse(j.text, key, model, ctx, (n) => (j.progress = n));
          meta = {
            tournament: meta.tournament ?? p.tournament,
            year: meta.year ?? p.year,
            level: meta.level ?? p.level,
            region: meta.region ?? p.region,
          };
          finish(j, { questions: p.questions, round: p.round, title: p.title });
        } catch (e) {
          j.status = 'error';
          j.note = aiError(e);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    retitle();
  }
  function finish(j: Job, r: { questions: Question[]; round?: string | null; title?: string | null }) {
    j.set = {
      title: '',
      public: true,
      round: normalizeRound(j.round ?? r.round) ?? null,
      questions: r.questions.map((q) => ({
        ...q,
        category: q.category ?? guessCategory(q),
        subcategory: q.subcategory ?? null,
      })),
    };
    j.status = r.questions.length ? 'done' : 'error';
    j.note = r.questions.length ? `${r.questions.length} questions` : 'No questions found';
    retitle();
    persist();
    if (!running) stage = 'review';
  }
  /** Titles follow the shared metadata: "NJCL 2024 Novice · Round 3". */
  function retitle() {
    const base =
      [meta.tournament, meta.year, meta.level && cap(meta.level)].filter(Boolean).join(' ') || source;
    for (const j of jobs) {
      if (!j.set) continue;
      j.set.title = j.set.round ? `${base} · ${j.set.round}` : base;
      Object.assign(j.set, meta);
    }
    checkDupes();
    persist();
  }
  /** Warn about rounds that are already public for this tournament, year and level. */
  async function checkDupes() {
    const req = ++dupeReq;
    if (!meta.tournament || !meta.year || !meta.level) {
      dupeCheck = 'skipped';
      existing = [];
    } else {
      dupeCheck = 'checking';
      try {
        const found = await findPublicSets(meta);
        if (req !== dupeReq) return;
        existing = found;
        dupeCheck = 'done';
      } catch {
        if (req !== dupeReq) return;
        dupeCheck = 'error';
        existing = [];
      }
    }
    for (const j of jobs) {
      if (!j.set) continue;
      const dupe = existing.find((e) => e.id !== j.set!.id && normRound(e.round) === normRound(j.set!.round));
      if (dupe?.id !== j.dupe?.id) j.action = dupe ? 'skip' : 'save';
      j.dupe = dupe;
    }
  }
  const canReplace = (j: Job) => !!j.dupe && j.dupe.owner === session?.user.id;
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  async function retry(j: Job) {
    j.status = 'queued';
    await runAll();
  }
  async function reparseWithAi() {
    for (const j of jobs) j.status = 'queued';
    stage = 'parse';
    await runAll();
    if (!running) stage = 'review';
  }
  async function saveAll() {
    for (const [i, j] of jobs.entries()) {
      if (!j.set || !j.set.questions.length || j.action === 'skip') continue;
      saving = `Saving ${i + 1} of ${jobs.length}…`;
      try {
        let draft = j.set;
        if (j.action === 'replace' && j.dupe) {
          // Reuse the existing set and, by position, its question ids so buzz history survives.
          const old = await getSet(j.dupe.id!);
          draft = {
            ...draft,
            id: old.id,
            questions: draft.questions.map((q, k) => ({ ...q, id: old.questions[k]?.id })),
          };
        }
        j.set = await saveSet(draft);
        j.dupe = undefined;
        j.action = 'save';
        j.note = `saved · ${j.set.questions.length} questions`;
      } catch (e) {
        j.status = 'error';
        j.note = (e as Error).message;
      }
    }
    saving = '';
    notice = failed
      ? 'Some rounds did not save; see the list.'
      : `Saved ${drafts.length} set${drafts.length === 1 ? '' : 's'}.`;
    loadMine();
    if (!failed) reset();
  }
  function reset() {
    stage = 'pick';
    jobs = [];
    raw = '';
    editing = null;
    localStorage.removeItem(DRAFT_KEY);
    draft = null;
  }

  // ---- Resilience: the import lives in localStorage until it is saved, so closing the tab
  // mid-parse loses nothing. Finished rounds are kept; unfinished ones re-run on resume.
  const DRAFT_KEY = 'importDraft';
  interface Draft {
    source: string;
    raw: string;
    preamble: string;
    meta: Meta;
    jobs: Job[];
    savedAt: number;
  }
  let draft = $state<Draft | null>(readDraft());
  function readDraft(): Draft | null {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
      return d?.jobs?.length ? d : null;
    } catch {
      return null;
    }
  }
  function persist() {
    if (!jobs.length || !raw) return;
    const snapshot: Draft = {
      source,
      raw,
      preamble,
      meta,
      jobs: jobs.map((j) => ({ ...j, status: j.status === 'parsing' ? 'queued' : j.status, progress: 0 })),
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot));
    } catch {
      /* quota exceeded: carry on without a safety net */
    }
  }
  function resume() {
    if (!draft) return;
    ({ source, raw, preamble } = draft);
    meta = draft.meta;
    jobs = draft.jobs.map((j) => ({ ...j, status: j.status === 'parsing' ? 'queued' : j.status }));
    draft = null;
    stage = jobs.some((j) => j.status === 'queued') ? 'parse' : 'review';
    if (stage === 'parse') runAll();
    else retitle();
  }
  const draftDone = $derived(draft?.jobs.filter((j) => j.status === 'done').length ?? 0);
  async function edit(s: QuestionSet) {
    try {
      const full = await getSet(s.id!);
      jobs = [{ round: full.round ?? null, text: '', status: 'done', note: '', set: full }];
      meta = {
        tournament: full.tournament ?? null,
        year: full.year ?? null,
        level: full.level ?? null,
        region: full.region ?? null,
      };
      stage = 'review';
      editing = 0;
    } catch (e) {
      notice = (e as Error).message;
    }
  }
  async function remove(s: QuestionSet) {
    if (!confirm(`Delete "${s.title}"?`)) return;
    await deleteSet(s.id!);
    loadMine();
  }
  const blank = (): Question => ({ tossup: '', answer: '', bonuses: [], category: null, subcategory: null });
</script>

<svelte:window
  onbeforeunload={(e) => {
    if (running) e.preventDefault();
  }}
/>

<main>
  <Brand>
    <a href="/">Play</a>
    {#if session}<button class="ghost sm" onclick={() => supabase!.auth.signOut()}>Sign out</button>{/if}
  </Brand>

  {#if !configured}
    <p class="bad-text">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code>.</p>
  {:else if !session}
    <h1>Question sets</h1>
    <p class="muted">Drop a packet, fix the parse, publish. Everything is editable before it goes live.</p>
    <div class="card stack">
      <p>Sign in to upload and manage question sets.</p>
      <button class="wide" onclick={() => oauth('google')}>Continue with Google</button>
      <button class="wide" onclick={() => oauth('github')}>Continue with GitHub</button>
      <p class="muted" style="text-align:center">or</p>
      <form
        class="answer-form"
        onsubmit={(e) => {
          e.preventDefault();
          magic();
        }}
      >
        <input type="email" bind:value={email} placeholder="you@example.com" required />
        <button type="submit">Email me a link</button>
      </form>
    </div>
  {:else}
    <div class="steps" aria-label="Progress">
      <span class:on={stage === 'pick'}>1 Packet</span><span>›</span>
      <span class:on={stage === 'parse'}>2 Parse</span><span>›</span>
      <span class:on={stage === 'review'}>3 Review &amp; save</span>
    </div>

    {#if stage === 'pick'}
      <h1>Import a packet</h1>
      {#if draft}
        <div class="card bar" style="border-color:rgba(196,181,253,.45)">
          <span class="min">
            <strong>Unfinished import: {draft.source}</strong>
            <span class="muted"
              >{draftDone} of {draft.jobs.length} rounds parsed · {new Date(
                draft.savedAt,
              ).toLocaleString()}</span
            >
          </span>
          <span class="row">
            <button class="primary sm" onclick={resume}>Resume</button>
            <button
              class="ghost sm"
              onclick={() => {
                localStorage.removeItem(DRAFT_KEY);
                draft = null;
              }}>Discard</button
            >
          </span>
        </div>
      {/if}
      <p class="muted">A PDF or Word file can hold a whole division. Each round becomes its own set.</p>
      <div class="card stack">
        <input type="file" accept=".docx,.pdf,.txt" onchange={onFile} disabled={busy} />
        <p class="muted" style="margin:0">…or paste text and press Parse:</p>
        <textarea bind:value={raw} placeholder="TU 1: ... ANSWER: ... B1: ... ANSWER: ..."></textarea>
        <div class="row">
          <button class="primary" onclick={() => ingest(raw, 'Pasted text')} disabled={!raw.trim() || busy}
            >Parse</button
          >
          <button
            class="ghost"
            onclick={() => {
              jobs = [
                {
                  round: null,
                  text: '',
                  status: 'done',
                  note: '',
                  set: { title: '', public: true, questions: [blank()] },
                },
              ];
              stage = 'review';
              editing = 0;
            }}
          >
            Start from scratch
          </button>
        </div>
      </div>
      <div class="card stack">
        <div class="bar">
          <h3 style="margin:0">AI parsing {key ? '· on' : '· off'}</h3>
          <span class="tag" class:accent={!!key}>{key ? 'key saved' : 'no key'}</span>
        </div>
        <p class="muted" style="margin:0">
          With your own <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
            >Anthropic API key</a
          >
          every round is parsed by Claude automatically, including categories and metadata. The key stays in this
          browser. Without one, a fast rule-based parser runs instead.
        </p>
        <div class="fields">
          <label
            >API key
            <input
              type="password"
              bind:value={key}
              onchange={() => setAiKey(key)}
              placeholder="sk-ant-…"
              autocomplete="off"
            /></label
          >
          <label
            >Model
            <select bind:value={model} onchange={() => setAiModel(model)}>
              {#each AI_MODELS as m}<option value={m.id}>{m.label}</option>{/each}
            </select></label
          >
        </div>
      </div>

      <h2>My sets</h2>
      {#each mine as s (s.id)}
        <div class="card bar">
          <span class="min"
            ><strong>{s.title}</strong>
            <span class="muted"
              >{[s.level, s.year, s.tournament, s.region].filter(Boolean).join(' · ')} · {s.count} q</span
            >
            {#if !s.public}<span class="tag">private</span>{/if}</span
          >
          <span class="row"
            ><button class="sm" onclick={() => edit(s)}>Edit</button><button
              class="bad sm"
              onclick={() => remove(s)}>Delete</button
            ></span
          >
        </div>
      {:else}
        <p class="empty">Nothing uploaded yet.</p>
      {/each}
    {:else}
      <!-- parse + review share the round list -->
      <div class="bar">
        <div class="min">
          <h1>{source}</h1>
          <p class="muted" style="margin:0">
            {jobs.length === 1 && !jobs[0].round ? 'One round' : `${jobs.length} rounds`}
            {#if running}· <span class="spin"></span> parsing with {key ? model : 'rules'}{:else}· {totalQ} questions{/if}
          </p>
        </div>
        <button class="ghost sm" onclick={reset} disabled={running}>Cancel</button>
      </div>
      <div class="progress" aria-hidden="true">
        <div style="width:{(100 * (done + failed)) / Math.max(1, jobs.length)}%"></div>
      </div>

      {#if editing === null}
        <div class="card stack" style="margin-top:1rem">
          <div class="fields">
            <label
              >Tournament <input
                type="text"
                bind:value={meta.tournament}
                onchange={retitle}
                placeholder="NJCL"
              /></label
            >
            <label
              >Year <input
                type="number"
                bind:value={meta.year}
                onchange={retitle}
                min="1990"
                max="2100"
              /></label
            >
            <label
              >Level
              <select bind:value={meta.level} onchange={retitle}>
                <option value={null}>—</option>
                {#each LEVELS as l}<option value={l}>{l}</option>{/each}
              </select></label
            >
            <label
              >Region <input
                type="text"
                bind:value={meta.region}
                onchange={retitle}
                list="regions"
                placeholder="National, a state, or Competitive Circuit"
              /></label
            >
          </div>
          <p class="muted" style="margin:0">
            Applies to every round below. Titles update automatically.
            {#if dupeCheck === 'checking'}<span class="spin"></span> checking for public copies…
            {:else if dupeCheck === 'skipped'}Duplicate check needs tournament, year and level.
            {:else if dupeCheck === 'error'}Could not check for public copies.
            {:else if dupeCheck === 'done'}{existing.length
                ? `${existing.length} public set${existing.length === 1 ? '' : 's'} already exist for this tournament, year and level.`
                : 'No public copies found.'}{/if}
          </p>
          <datalist id="regions"
            >{#each REGIONS as r}<option value={r}></option>{/each}</datalist
          >
        </div>

        {#each jobs as j, i}
          <div class="card bar">
            <span class="min">
              <strong>{j.set?.title || j.round || source}</strong>
              <span class="muted">
                {#if j.status === 'parsing'}<span class="spin"></span> parsing{j.progress
                    ? ` · ${j.progress} questions so far`
                    : '…'}
                {:else if j.status === 'queued'}queued
                {:else if j.status === 'error'}<span class="bad-text">{j.note}</span>
                {:else}<span class="ok-text">✓</span> {j.note}{/if}
              </span>
            </span>
            <span class="row">
              {#if j.dupe && canReplace(j)}
                <select class="sm" bind:value={j.action} aria-label="Duplicate handling">
                  <option value="skip">Skip</option>
                  {#if canReplace(j)}<option value="replace">Replace mine</option>{/if}
                </select>
              {/if}
              {#if j.status === 'error'}<button class="sm" onclick={() => retry(j)} disabled={running}
                  >Retry</button
                >{/if}
              {#if j.set}<button class="sm" onclick={() => (editing = i)}>Edit</button>{/if}
            </span>
          </div>
          {#if j.dupe}
            <p class="muted" style="margin:-0.4rem 0 0.75rem 0.25rem">
              <span class="tag accent">already public</span>
              “{j.dupe.title}” · {j.dupe.count} questions · {canReplace(j)
                ? 'yours'
                : 'skipped, already available to everyone'}
            </p>
          {/if}
        {/each}

        {#if !running}
          <div class="row" style="margin-top:1rem">
            <button class="primary" onclick={saveAll} disabled={!drafts.length || !!saving}>
              {saving ||
                `Save ${drafts.length === 1 ? 'set' : `all ${drafts.length} sets`}${skipped ? ` · skip ${skipped}` : ''}`}
            </button>
            {#if key && raw}<button onclick={reparseWithAi}>Re-parse everything with AI</button>{/if}
            {#if !key && raw}<button class="ghost" onclick={reset}>Add an API key for better parsing</button
              >{/if}
          </div>
        {/if}
      {:else}
        {@const set = jobs[editing].set!}
        <div class="bar" style="margin-top:1rem">
          <button
            class="ghost sm"
            onclick={() => {
              editing = null;
              editQ = null;
            }}>← All rounds</button
          >
          <span class="muted">{set.questions.length} questions</span>
        </div>
        <div class="card">
          <div class="fields">
            <label>Title <input type="text" bind:value={set.title} required /></label>
            <label>Round <input type="text" bind:value={set.round} placeholder="Round 3" /></label>
            <label
              >Level
              <select bind:value={set.level}>
                <option value={null}>—</option>
                {#each LEVELS as l}<option value={l}>{l}</option>{/each}
              </select></label
            >
            <label>Year <input type="number" bind:value={set.year} min="1990" max="2100" /></label>
            <label>Tournament <input type="text" bind:value={set.tournament} placeholder="NJCL" /></label>
            <label
              >Region <input
                type="text"
                bind:value={set.region}
                list="regions"
                placeholder="National, a state, or Competitive Circuit"
              /></label
            >
            <label class="inline"><input type="checkbox" bind:checked={set.public} /> Public</label>
          </div>
        </div>
        <p class="muted">Tap a question, or focus it and press Enter, to edit.</p>
        {#each set.questions as q, i}
          {#if editQ === i}
            <div class="card">
              <div class="qhead">
                <strong>Tossup {i + 1}</strong>
                <select bind:value={q.category}>
                  <option value={null}>Category…</option>
                  {#each CATEGORIES as c}<option value={c}>{c}</option>{/each}
                </select>
                <button class="sm" onclick={() => (editQ = null)}>Done</button>
              </div>
              <input
                type="text"
                bind:value={q.subcategory}
                placeholder="Subcategory (optional), e.g. Subjunctive"
                style="width:100%;margin-bottom:.4rem"
              />
              <textarea bind:value={q.tossup} placeholder="Question"></textarea>
              <input
                type="text"
                bind:value={q.answer}
                placeholder="ANSWER"
                style="width:100%;margin-top:.4rem"
              />
              {#each q.bonuses as b, j}
                <div class="bonus" style="grid-template-columns:1fr">
                  <span class="tag" style="justify-self:start">B{j + 1}</span>
                  <textarea bind:value={b.q} placeholder="Bonus question" style="min-height:2.75rem"
                  ></textarea>
                  <input type="text" bind:value={b.a} placeholder="ANSWER" />
                  <button class="ghost sm" style="justify-self:start" onclick={() => q.bonuses.splice(j, 1)}>
                    Remove B{j + 1}
                  </button>
                </div>
              {/each}
              <div class="row" style="margin-top:.75rem">
                {#if q.bonuses.length < 3}<button class="sm" onclick={() => q.bonuses.push({ q: '', a: '' })}
                    >+ bonus</button
                  >{/if}
                <button
                  class="bad sm"
                  onclick={() => {
                    set.questions.splice(i, 1);
                    editQ = null;
                  }}>Remove tossup</button
                >
              </div>
            </div>
          {:else}
            <div
              class="card qcard"
              role="button"
              tabindex="0"
              aria-label="Edit tossup {i + 1}"
              onclick={() => (editQ = i)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  editQ = i;
                }
              }}
            >
              <div class="bar">
                <strong>Tossup {i + 1}</strong>
                <span class="row">
                  {#if q.category}<span class="tag accent">{q.category}</span>{:else}<span class="tag"
                      >no category</span
                    >{/if}
                  {#if q.subcategory}<span class="tag">{q.subcategory}</span>{/if}
                </span>
              </div>
              <p class="text">{q.tossup || '—'}</p>
              <p class="ans">{q.answer || '—'}</p>
              {#each q.bonuses as b, j}
                <div class="bonus-ro">
                  <span class="lbl">B{j + 1}</span>
                  <span>{b.q}</span>
                  <span class="ans">{b.a}</span>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
        <datalist id="regions"
          >{#each REGIONS as r}<option value={r}></option>{/each}</datalist
        >
        <div class="row">
          <button
            onclick={() => {
              set.questions.push(blank());
              editQ = set.questions.length - 1;
            }}>+ tossup</button
          >
          <button
            class="primary"
            onclick={async () => {
              busy = true;
              try {
                jobs[editing!].set = await saveSet(set);
                notice = 'Saved.';
                loadMine();
              } catch (e) {
                notice = (e as Error).message;
              }
              busy = false;
            }}
            disabled={busy || !set.title.trim() || !set.questions.length}
          >
            Save this set
          </button>
        </div>
      {/if}
    {/if}
  {/if}
  {#if notice}<p class="card">{notice}</p>{/if}
</main>
