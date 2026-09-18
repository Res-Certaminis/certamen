<script lang="ts">
  import { addToDeck, newGame, playedCount, reduce, toDeck } from '../lib/game';
  import type { Event, QuestionSet } from '../lib/types';
  import { withRecording } from '../lib/record';
  import Table from './Table.svelte';

  const raw = sessionStorage.getItem('deck');
  const initial = raw ? toDeck(JSON.parse(raw)) : null;
  let deck = $state.raw(initial);
  const me = 'me';
  let g = $state({
    ...reduce(newGame('SOLO'), { t: 'join', id: me, name: 'You', team: 0 }, Date.now(), initial),
    teams: ['You'],
    setTitle: initial?.title ?? '',
    sources: initial?.sources ?? [],
    total: initial?.questions.length ?? 0,
  });
  function grow(sets: QuestionSet[], shuffle: boolean) {
    deck = addToDeck(deck ?? { title: '', questions: [], sources: [] }, sets, {
      shuffle,
      played: playedCount(g),
    });
    g = { ...g, setTitle: deck.title, sources: deck.sources, total: deck.questions.length };
  }
  const send = withRecording<Event>(
    () => g,
    (e) => (g = reduce(g, e, Date.now(), deck)),
  );
</script>

{#if initial}
  <Table {g} {me} isHost solo {send} onadd={grow} onshuffle={() => grow([], true)} />
{:else}
  <p>No set selected.</p>
{/if}
<p class="muted"><a href="/">← Home</a></p>
