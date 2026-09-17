<script lang="ts">
  import { newGame, reduce, toDeck } from '../lib/game';
  import type { Event } from '../lib/types';
  import { withRecording } from '../lib/record';
  import Table from './Table.svelte';

  const raw = sessionStorage.getItem('deck');
  const deck = raw ? toDeck(JSON.parse(raw)) : null;
  const me = 'me';
  let g = $state({
    ...reduce(newGame('SOLO'), { t: 'join', id: me, name: 'You', team: 0 }, Date.now(), deck),
    teams: ['You'],
    setTitle: deck?.title ?? '',
    total: deck?.questions.length ?? 0,
  });
  const send = withRecording<Event>(
    () => g,
    (e) => (g = reduce(g, e, Date.now(), deck)),
  );
</script>

{#if deck}
  <Table {g} {me} isHost solo {send} />
{:else}
  <p>No set selected.</p>
{/if}
<p class="muted"><a href="/">← Home</a></p>
