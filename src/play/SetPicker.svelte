<script lang="ts">
  /** Pick sets to add to the room's question pool. Fetches full sets and caches them for offline play. */
  import { configured, getSet, listSets, LEVELS } from '../lib/supabase';
  import { savedSets, saveOffline } from '../lib/store';
  import type { QuestionSet } from '../lib/types';

  let {
    exclude = [],
    onadd,
  }: { exclude?: string[]; onadd: (sets: QuestionSet[], shuffle: boolean) => void } = $props();

  let all = $state<QuestionSet[]>(savedSets());
  let picked = $state<string[]>([]);
  let shuffle = $state(false);
  let level = $state('');
  let busy = $state(false);
  let error = $state('');

  if (configured && navigator.onLine)
    listSets()
      .then((r) => (all = [...all, ...r.filter((x) => !all.some((a) => a.id === x.id))]))
      .catch((e) => (error = e.message));

  const shown = $derived(all.filter((s) => !exclude.includes(s.title) && (!level || s.level === level)));
  const meta = (s: QuestionSet) => [s.year, s.tournament, s.round].filter(Boolean).join(' · ');
  const toggle = (id: string) =>
    (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  async function add() {
    busy = true;
    try {
      const fulls = await Promise.all(
        all
          .filter((s) => picked.includes(s.id!))
          .map(async (s) => {
            const f = s.questions.length ? s : await getSet(s.id!);
            saveOffline(f);
            return f;
          }),
      );
      onadd(fulls, shuffle);
      picked = [];
    } catch (e) {
      error = (e as Error).message;
    }
    busy = false;
  }
</script>

<div class="stack">
  <div class="bar">
    <strong>Add sets to the pool</strong>
    <select class="sm" bind:value={level} aria-label="Filter by level">
      <option value="">All levels</option>
      {#each LEVELS as l}<option value={l}>{l}</option>{/each}
    </select>
  </div>
  {#if error}<p class="bad-text">{error}</p>{/if}
  <div class="list">
    {#each shown as s (s.id)}
      <label class="pick">
        <input type="checkbox" checked={picked.includes(s.id!)} onchange={() => toggle(s.id!)} />
        <span class="min">
          <span style="color:var(--fg)">{s.title}</span>
          <span class="muted"> · {s.questions.length || s.count || 0} q{meta(s) ? ` · ${meta(s)}` : ''}</span>
        </span>
      </label>
    {:else}
      <p class="muted">No other sets available.</p>
    {/each}
  </div>
  <div class="row">
    <button class="primary sm" onclick={add} disabled={!picked.length || busy}>
      {busy ? 'Loading…' : `Add ${picked.length || ''} ${picked.length === 1 ? 'set' : 'sets'}`}
    </button>
    <label class="muted" style="gap:.35rem"
      ><input type="checkbox" bind:checked={shuffle} /> Shuffle unplayed questions</label
    >
  </div>
</div>

<style>
  .list {
    max-height: 14rem;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.5rem;
  }
  .pick {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
    flex-wrap: nowrap;
    align-items: flex-start;
  }
  .pick:last-child {
    border-bottom: 0;
  }
  .pick input {
    margin-top: 0.25rem;
  }
</style>
