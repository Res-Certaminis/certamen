<script lang="ts">
  import { configured, getSet, listSets, LEVELS } from '../lib/supabase';
  import { savedSets, saveOffline, removeOffline, playerName, setPlayerName, roomCode } from '../lib/store';
  import type { QuestionSet } from '../lib/types';
  import { nav } from './nav';

  let name = $state(playerName());
  let code = $state('');
  let level = $state('');
  let saved = $state(savedSets());
  let remote = $state<QuestionSet[]>([]);
  let error = $state('');
  let busy = $state('');

  if (configured && navigator.onLine)
    listSets()
      .then((s) => (remote = s))
      .catch((e) => (error = e.message));

  const sets = $derived(
    [...saved, ...remote.filter((r) => !saved.some((s) => s.id === r.id))].filter(
      (s) => !level || s.level === level,
    ),
  );
  const isSaved = (s: QuestionSet) => saved.some((x) => x.id === s.id);
  const meta = (s: QuestionSet) =>
    [s.level, s.year, s.tournament, s.region, s.round].filter(Boolean).join(' · ');

  /** Full set (questions included), from the offline copy or the server. */
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
  function join() {
    setPlayerName(name.trim());
    if (code.trim()) nav(`/r/${code.trim().toUpperCase()}`);
  }
  async function toggleSave(s: QuestionSet) {
    if (isSaved(s)) removeOffline(s.id!);
    else saveOffline(await full(s));
    saved = savedSets();
  }
</script>

<h1>Certamen</h1>
<p class="muted">Latin quiz bowl buzzer and practice. Works offline once a set is saved.</p>

<div class="card row">
  <label>Your name <input type="text" bind:value={name} placeholder="Marcus" maxlength="24" /></label>
  <label
    >Join a room <input
      type="text"
      bind:value={code}
      placeholder="CODE"
      maxlength="8"
      style="width:7rem"
    /></label
  >
  <button class="primary" onclick={join} disabled={!code.trim() || !name.trim()}>Join</button>
</div>

<div class="bar">
  <h2>Question sets</h2>
  <select bind:value={level}>
    <option value="">All levels</option>
    {#each LEVELS as l}<option value={l}>{l}</option>{/each}
  </select>
</div>
{#if !configured}
  <p class="muted">Supabase is not configured, so only sets saved on this device are shown.</p>
{/if}
{#if error}<p class="bad-text">{error}</p>{/if}
{#if !sets.length}
  <p class="muted">No sets yet. <a href="/upload/">Upload a packet</a> to get started.</p>
{/if}
{#each sets as s (s.id)}
  <div class="card">
    <div class="bar">
      <div>
        <strong>{s.title}</strong>
        <div class="muted">
          {meta(s)}
          · {s.questions.length || s.count || 0} questions
          {#if isSaved(s)}<span class="tag">offline</span>{/if}
        </div>
      </div>
      <button onclick={() => toggleSave(s)} title="Save for offline play">{isSaved(s) ? '★' : '☆'}</button>
    </div>
    <div class="row">
      <button onclick={() => go(s, '/solo')} disabled={!name.trim() || busy === s.id}>Practice solo</button>
      <button
        class="primary"
        onclick={() => go(s, `/r/${roomCode()}`)}
        disabled={!name.trim() || !navigator.onLine || busy === s.id}
      >
        Host a room
      </button>
      {#if configured}<a
          href="/s/{s.id}"
          onclick={(e) => {
            e.preventDefault();
            nav(`/s/${s.id}`);
          }}>Buzz stats</a
        >{/if}
    </div>
  </div>
{/each}

<p class="muted">
  <a href="/upload/">Upload or edit question sets</a> ·
  <a href="https://github.com/Res-Certaminis/certamen">Source</a>
</p>
