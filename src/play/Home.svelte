<script lang="ts">
  import { configured, getSet, listSets, LEVELS } from '../lib/supabase';
  import { savedSets, saveOffline, removeOffline, playerName, setPlayerName, roomCode } from '../lib/store';
  import type { QuestionSet } from '../lib/types';
  import { mergeSets } from '../lib/game';
  import { nav } from './nav';

  let name = $state(playerName());
  let code = $state('');
  let level = $state('');
  let saved = $state(savedSets());
  let remote = $state<QuestionSet[]>([]);
  let error = $state('');
  let busy = $state('');
  let picked = $state<string[]>([]); // set ids in the pool
  let shuffle = $state(false);
  const online = configured && navigator.onLine;
  let loading = $state(online);

  if (online)
    listSets()
      .then((s) => (remote = s))
      .catch((e) => (error = e.message))
      .finally(() => (loading = false));

  const sets = $derived(
    [...saved, ...remote.filter((r) => !saved.some((s) => s.id === r.id))].filter(
      (s) => !level || s.level === level,
    ),
  );
  const isSaved = (s: QuestionSet) => saved.some((x) => x.id === s.id);
  const meta = (s: QuestionSet) => [s.year, s.tournament, s.region, s.round].filter(Boolean).join(' · ');

  async function full(s: QuestionSet) {
    return s.questions.length ? s : getSet(s.id!);
  }
  async function go(s: QuestionSet, path: string) {
    setPlayerName(name.trim());
    busy = s.id!;
    try {
      sessionStorage.setItem('deck', JSON.stringify(await full(s)));
      nav(path);
    } catch (e) {
      error = (e as Error).message;
    }
    busy = '';
  }
  const inPool = (s: QuestionSet) => picked.includes(s.id!);
  const togglePool = (s: QuestionSet) =>
    (picked = inPool(s) ? picked.filter((id) => id !== s.id) : [...picked, s.id!]);
  /** Build one deck from every picked set (optionally shuffled) and start solo or a room. */
  async function goPool(path: string) {
    setPlayerName(name.trim());
    busy = 'pool';
    try {
      const fulls = await Promise.all(sets.filter(inPool).map(full));
      sessionStorage.setItem('deck', JSON.stringify(mergeSets(fulls, shuffle)));
      nav(path);
    } catch (e) {
      error = (e as Error).message;
    }
    busy = '';
  }
  function join() {
    setPlayerName(name.trim());
    const c = code
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 8);
    if (c) nav(`/r/${c}`);
  }
  async function toggleSave(s: QuestionSet) {
    if (isSaved(s)) removeOffline(s.id!);
    else saveOffline(await full(s));
    saved = savedSets();
  }
</script>

<section class="hero">
  <h1>Certamen.<br />Play to win.</h1>
  <p class="muted">Host a room, join from any phone, or drill a set offline.</p>
</section>

<div class="card stack">
  <label
    >Your name <input
      type="text"
      bind:value={name}
      placeholder="Marcus"
      maxlength="24"
      autocomplete="nickname"
    /></label
  >
  <form
    class="answer-form"
    onsubmit={(e) => {
      e.preventDefault();
      join();
    }}
  >
    <input
      type="text"
      bind:value={code}
      placeholder="Room code"
      maxlength="8"
      autocapitalize="characters"
      autocomplete="off"
    />
    <button class="primary" type="submit" disabled={!code.trim() || !name.trim()}>Join</button>
  </form>
</div>

<div class="bar" style="margin-top:1.5rem">
  <h2>Question sets</h2>
  <div class="seg" role="tablist" aria-label="Level">
    <button class:on={level === ''} onclick={() => (level = '')}>All</button>
    {#each LEVELS as l}<button class:on={level === l} onclick={() => (level = l)}>{l}</button>{/each}
  </div>
</div>
{#if picked.length}
  <div class="card pool">
    <div class="bar">
      <span
        ><strong>{picked.length} set{picked.length === 1 ? '' : 's'} in the pool</strong>
        <span class="muted"
          >· {sets.filter(inPool).reduce((n, s) => n + (s.questions.length || s.count || 0), 0)} questions</span
        ></span
      >
      <label class="muted" style="gap:.35rem"><input type="checkbox" bind:checked={shuffle} /> Shuffle</label>
    </div>
    <div class="row" style="margin-top:.6rem">
      <button
        class="primary"
        onclick={() => goPool(`/r/${roomCode()}`)}
        disabled={!name.trim() || !navigator.onLine || !!busy}>Host a room</button
      >
      <button onclick={() => goPool('/solo')} disabled={!name.trim() || !!busy}>Practice solo</button>
      <button class="ghost" onclick={() => (picked = [])}>Clear</button>
    </div>
  </div>
{/if}
{#if !configured}
  <p class="muted">Supabase is not configured, so only sets saved on this device are shown.</p>
{/if}
{#if error}<p class="bad-text">{error}</p>{/if}
{#if loading && !sets.length}
  <p class="empty">Loading sets…</p>
{:else if !sets.length}
  <p class="empty">No sets yet. <a href="/upload/">Upload a packet</a> to get started.</p>
{/if}
{#each sets as s (s.id)}
  <article class="card">
    <div class="bar">
      <div>
        <h3>{s.title}</h3>
        <p class="muted" style="margin:0">
          {#if s.level}<span class="tag accent">{s.level}</span>{/if}
          {meta(s)}{meta(s) ? ' · ' : ''}{s.questions.length || s.count || 0} questions
          {#if isSaved(s)}<span class="tag">offline</span>{/if}
        </p>
      </div>
      <span class="row">
        <label class="muted" style="gap:.35rem"
          ><input type="checkbox" checked={inPool(s)} onchange={() => togglePool(s)} /> Pool</label
        >
        <button
          class="ghost sm"
          onclick={() => toggleSave(s)}
          aria-label={isSaved(s) ? 'Remove offline copy' : 'Save for offline'}
          title="Save for offline play"
        >
          {isSaved(s) ? '★' : '☆'}
        </button>
      </span>
    </div>
    <div class="row" style="margin-top:.75rem">
      <button
        class="primary"
        onclick={() => go(s, `/r/${roomCode()}`)}
        disabled={!name.trim() || !navigator.onLine || busy === s.id}
      >
        Host a room
      </button>
      <button onclick={() => go(s, '/solo')} disabled={!name.trim() || busy === s.id}>Practice solo</button>
      {#if configured}
        <button class="ghost" onclick={() => nav(`/s/${s.id}`)}>Buzz stats</button>
      {/if}
    </div>
  </article>
{/each}

<p class="muted" style="margin-top:2rem">
  Tick "Pool" on several sets to play them together, in order or shuffled. ·
  <a href="https://github.com/Res-Certaminis/certamen">Open source on GitHub</a>
</p>

<style>
  .hero {
    padding: 0.5rem 0 1rem;
  }
  .pool {
    position: sticky;
    top: 0.5rem;
    z-index: 2;
    border-color: rgba(196, 181, 253, 0.45);
  }
</style>
