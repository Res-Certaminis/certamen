<script lang="ts">
  import { configured, getSet, listSets, LEVELS } from '../lib/supabase';
  import { savedSets, saveOffline, playerName, setPlayerName, roomCode } from '../lib/store';
  import type { QuestionSet } from '../lib/types';
  import { nav } from './nav';

  let name = $state(playerName());
  let code = $state('');
  let level = $state('');
  const saved = savedSets(); // sets played before are available offline
  let remote = $state<QuestionSet[]>([]);
  let error = $state('');
  let busy = $state('');
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
  const meta = (s: QuestionSet) => [s.year, s.tournament, s.region, s.round].filter(Boolean).join(' · ');

  async function full(s: QuestionSet) {
    return s.questions.length ? s : getSet(s.id!);
  }
  async function go(s: QuestionSet, path: string) {
    setPlayerName(name.trim());
    busy = s.id!;
    try {
      const f = await full(s);
      saveOffline(f);
      sessionStorage.setItem('deck', JSON.stringify(f));
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
{#if !configured}
  <p class="muted">Supabase is not configured, so only sets saved on this device are shown.</p>
{:else if !navigator.onLine}
  <p class="muted">You're offline: showing sets you have played before.</p>
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
        </p>
      </div>
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
  Sets you have played are kept on this device for offline practice. ·
  <a href="https://github.com/Res-Certaminis/certamen">Open source on GitHub</a>
</p>

<style>
  .hero {
    padding: 0.5rem 0 1rem;
  }
</style>
