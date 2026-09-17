<script lang="ts">
  /** Buzz analytics for one set: where players buzzed on each tossup, and conversion by category. */
  import { getSet, listBuzzes } from '../lib/supabase';
  import type { BuzzRow, QuestionSet } from '../lib/types';

  let { id }: { id: string } = $props();
  let set = $state<QuestionSet | null>(null);
  let buzzes = $state<BuzzRow[]>([]);
  let error = $state('');
  let mode = $state<'' | 'reader' | 'live'>('');

  $effect(() => {
    getSet(id)
      .then(async (s) => {
        set = s;
        buzzes = await listBuzzes(s.questions);
      })
      .catch((e) => (error = e.message));
  });

  const rows = $derived(buzzes.filter((b) => !mode || b.mode === mode));
  const byQ = $derived(Map.groupBy(rows, (b) => b.question_id));
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
  const summary = (list: BuzzRow[]) => {
    const correct = list.filter((b) => b.correct);
    const pos = (l: BuzzRow[]) => (l.length ? l.reduce((s, b) => s + b.word / b.words, 0) / l.length : NaN);
    return { n: list.length, correct: correct.length, pos: pos(correct) };
  };
  const categories = $derived(
    [...Map.groupBy(set?.questions ?? [], (q) => q.category || 'Uncategorised')].map(([cat, qs]) => ({
      cat,
      qs: qs.length,
      ...summary(qs.flatMap((q) => byQ.get(q.id!) ?? [])),
    })),
  );
</script>

<p class="muted"><a href="/">← Home</a></p>
{#if error}<p class="bad-text">{error}</p>{/if}
{#if set}
  <div class="bar">
    <div>
      <h1>{set.title}</h1>
      <p class="muted">
        {[set.level, set.year, set.tournament, set.region, set.round].filter(Boolean).join(' · ')}
      </p>
    </div>
    <select bind:value={mode}>
      <option value="">All modes</option>
      <option value="reader">App reads</option>
      <option value="live">Moderator reads</option>
    </select>
  </div>

  <div class="card">
    <h3>By category</h3>
    <table>
      <thead
        ><tr><th>Category</th><th>Questions</th><th>Buzzes</th><th>Correct</th><th>Avg. correct buzz</th></tr
        ></thead
      >
      <tbody>
        {#each categories as c}
          <tr>
            <td>{c.cat}</td><td>{c.qs}</td><td>{c.n}</td><td>{pct(c.correct, c.n)}</td>
            <td>{isNaN(c.pos) ? '–' : pct(Math.round(c.pos * 100), 100) + ' through'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="muted">
      "Avg. correct buzz" is how far through the tossup a correct buzz landed, on average (reader mode only).
    </p>
  </div>

  {#each set.questions as q, i (q.id)}
    {@const list = byQ.get(q.id!) ?? []}
    {@const s = summary(list)}
    <div class="card">
      <div class="bar">
        <strong>{i + 1}. {q.answer}</strong>
        <span class="muted"
          >{q.category ?? ''} · {s.n} buzz{s.n === 1 ? '' : 'es'} · {pct(s.correct, s.n)} correct</span
        >
      </div>
      <p class="muted">{q.tossup}</p>
      <div class="strip" title="Each mark is one buzz, placed at the word where it landed">
        {#each list.filter((b) => b.mode === 'reader') as b}
          <span
            class="mark"
            class:bad={!b.correct}
            style="left:{(100 * b.word) / b.words}%"
            title="{b.player}: {b.answer ?? ''}"
          ></span>
        {/each}
      </div>
    </div>
  {/each}
{:else if !error}
  <p>Loading…</p>
{/if}

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--line);
  }
  .strip {
    position: relative;
    height: 14px;
    border-radius: 7px;
    background: var(--line);
    margin-top: 0.5rem;
  }
  .mark {
    position: absolute;
    top: 0;
    width: 6px;
    height: 14px;
    margin-left: -3px;
    border-radius: 3px;
    background: var(--ok);
  }
  .mark.bad {
    background: var(--bad);
  }
</style>
