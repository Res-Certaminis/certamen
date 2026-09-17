<script lang="ts">
  import type { Session } from '@supabase/supabase-js';
  import {
    configured,
    supabase,
    saveSet,
    deleteSet,
    getSet,
    listSets,
    LEVELS,
    CATEGORIES,
  } from '../lib/supabase';
  import Brand from '../lib/Brand.svelte';
  import { fileToText, parseText } from '../lib/parse';
  import { aiKey, setAiKey, aiModel, setAiModel } from '../lib/store';
  import { AI_MODELS, type AiModel } from '../lib/ai';
  import type { Question, QuestionSet } from '../lib/types';

  let session = $state<Session | null>(null);
  let email = $state('');
  let notice = $state('');
  let busy = $state(false);
  let mine = $state<QuestionSet[]>([]);
  let raw = $state('');
  let showRaw = $state(false);
  let set = $state<QuestionSet | null>(null);
  let key = $state(aiKey());
  let model = $state<AiModel>(aiModel() as AiModel);
  let aiNote = $state('');

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

  async function onFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    busy = true;
    try {
      raw = await fileToText(f);
      const title = f.name.replace(/\.[^.]+$/, '');
      if (key) {
        set = { title, public: true, questions: [] };
        await fromAi();
      } else fromRaw(title);
    } catch (err) {
      notice = String(err);
    }
    busy = false;
  }
  async function fromAi() {
    if (!raw.trim() || !key) return;
    busy = true;
    aiNote = 'Parsing with ' + model + '…';
    try {
      const { aiParse, applyParsed, aiError } = await import('../lib/ai');
      try {
        const p = await aiParse(raw, key, model);
        set = applyParsed(p, { ...set, title: set?.title ?? '' });
        showRaw = false;
        aiNote = `${p.questions.length} questions · ${p.usage.input.toLocaleString()} in / ${p.usage.output.toLocaleString()} out tokens`;
      } catch (e) {
        aiNote = aiError(e);
      }
    } finally {
      busy = false;
    }
  }
  function fromRaw(title = set?.title ?? '') {
    set = { public: true, ...set, title, questions: parseText(raw) };
    showRaw = false;
  }
  async function edit(s: QuestionSet) {
    try {
      set = await getSet(s.id!);
      raw = '';
    } catch (e) {
      notice = (e as Error).message;
    }
  }
  async function save() {
    if (!set) return;
    busy = true;
    try {
      set = await saveSet(set);
      notice = 'Saved.';
      loadMine();
    } catch (e) {
      notice = (e as Error).message ?? String(e);
    }
    busy = false;
  }
  async function remove(s: QuestionSet) {
    if (!confirm(`Delete "${s.title}"?`)) return;
    await deleteSet(s.id!);
    loadMine();
  }
  const blank = (): Question => ({ tossup: '', answer: '', bonuses: [], category: null });
</script>

<main>
  <Brand>
    <a href="/">Play</a>
    {#if session}<button class="ghost sm" onclick={() => supabase!.auth.signOut()}>Sign out</button>{/if}
  </Brand>
  <h1>Question sets</h1>
  <p class="muted">Drop a packet, fix the parse, publish. Everything is editable before it goes live.</p>

  {#if !configured}
    <p class="bad-text">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code>.</p>
  {:else if !session}
    <div class="card">
      <p>Sign in to upload and manage question sets.</p>
      <div class="stack">
        <button class="wide" onclick={() => oauth('google')}>Continue with Google</button>
        <button class="wide" onclick={() => oauth('github')}>Continue with GitHub</button>
      </div>
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
    {#if !set}
      <div class="card">
        <h2>New set</h2>
        <p class="muted">
          Drop a .docx, .pdf or .txt packet. Parsing happens in your browser; you can fix anything before
          saving.
        </p>
        <input type="file" accept=".docx,.pdf,.txt" onchange={onFile} disabled={busy} />
        <p class="muted">…or paste text:</p>
        <textarea bind:value={raw} placeholder="TU 1: ... ANSWER: ... B1: ... ANSWER: ..."></textarea>
        <fieldset>
          <legend>AI parsing (optional)</legend>
          <p class="muted" style="margin:0">
            Bring your own <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer">Anthropic API key</a
            >
            for far more accurate parsing of messy packets. The key is stored only in this browser and sent only
            to Anthropic.
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
          {#if aiNote}<p class="muted" style="margin:0">{aiNote}</p>{/if}
        </fieldset>
        <div class="row" style="margin-top:.75rem">
          <button class="primary" onclick={fromAi} disabled={!raw.trim() || !key || busy}>
            {busy ? 'Parsing…' : 'Parse with AI'}
          </button>
          <button onclick={() => fromRaw()} disabled={!raw.trim() || busy}>Parse without AI</button>
          <button class="ghost" onclick={() => (set = { title: '', public: true, questions: [blank()] })}
            >Start from scratch</button
          >
        </div>
      </div>
      <h2>My sets</h2>
      {#each mine as s (s.id)}
        <div class="card bar">
          <span
            ><strong>{s.title}</strong>
            <span class="muted"
              >{[s.level, s.year, s.tournament, s.region, s.round].filter(Boolean).join(' · ')} · {s.count} q</span
            >
            {#if !s.public}<span class="tag">private</span>{/if}</span
          >
          <span class="row"
            ><button onclick={() => edit(s)}>Edit</button><button class="bad" onclick={() => remove(s)}
              >Delete</button
            ></span
          >
        </div>
      {:else}
        <p class="muted">Nothing uploaded yet.</p>
      {/each}
    {:else}
      <div class="card">
        <div class="fields">
          <label>Title <input type="text" bind:value={set.title} required /></label>
          <label
            >Level
            <select bind:value={set.level}>
              <option value={null}>—</option>
              {#each LEVELS as l}<option value={l}>{l}</option>{/each}
            </select></label
          >
          <label
            >Year <input
              type="number"
              bind:value={set.year}
              min="1990"
              max="2100"
              style="width:6rem"
            /></label
          >
          <label>Tournament <input type="text" bind:value={set.tournament} placeholder="NJCL" /></label>
          <label>Region <input type="text" bind:value={set.region} placeholder="National" /></label>
          <label>Round <input type="text" bind:value={set.round} placeholder="Round 3" /></label>
          <label class="inline"><input type="checkbox" bind:checked={set.public} /> Public</label>
        </div>
        <p class="muted">
          {set.questions.length} questions
          {#if raw}· <button onclick={() => (showRaw = !showRaw)}>{showRaw ? 'Hide' : 'Fix'} raw text</button
            >{/if}
        </p>
        {#if showRaw}
          <textarea bind:value={raw} style="min-height:16rem"></textarea>
          <div class="row">
            {#if key}<button class="primary" onclick={fromAi} disabled={busy}
                >{busy ? 'Parsing…' : 'Re-parse with AI'}</button
              >{/if}
            <button onclick={() => fromRaw()} disabled={busy}>Re-parse without AI</button>
          </div>
          {#if aiNote}<p class="muted">{aiNote}</p>{/if}
        {/if}
      </div>

      {#each set.questions as q, i}
        <div class="card">
          <div class="bar">
            <strong>Tossup {i + 1}</strong>
            <span class="row">
              <input
                type="text"
                bind:value={q.category}
                list="categories"
                placeholder="Category"
                style="width:11rem"
              />
              <button class="bad" onclick={() => set!.questions.splice(i, 1)}>Remove</button>
            </span>
          </div>
          <textarea bind:value={q.tossup} placeholder="Question"></textarea>
          <input type="text" bind:value={q.answer} placeholder="ANSWER" style="width:100%" />
          {#each q.bonuses as b, j}
            <div class="row" style="margin-top:.5rem">
              <span class="tag">B{j + 1}</span>
              <textarea bind:value={b.q} placeholder="Bonus question" style="flex:1;min-height:2.5rem"
              ></textarea>
              <input type="text" bind:value={b.a} placeholder="ANSWER" />
              <button onclick={() => q.bonuses.splice(j, 1)}>×</button>
            </div>
          {/each}
          {#if q.bonuses.length < 3}<button onclick={() => q.bonuses.push({ q: '', a: '' })}>+ bonus</button
            >{/if}
        </div>
      {/each}
      <datalist id="categories"
        >{#each CATEGORIES as c}<option value={c}></option>{/each}</datalist
      >
      <div class="row">
        <button onclick={() => set!.questions.push(blank())}>+ tossup</button>
        <button class="primary" onclick={save} disabled={busy || !set.title.trim() || !set.questions.length}
          >Save</button
        >
        <button onclick={() => (set = null)}>Cancel</button>
      </div>
    {/if}
  {/if}
  {#if notice}<p class="card">{notice}</p>{/if}
</main>
