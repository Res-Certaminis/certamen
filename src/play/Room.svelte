<script lang="ts">
  import { connect } from '../lib/ws';
  import { playerId, playerName } from '../lib/store';
  import type { Event, Game } from '../lib/types';
  import { withRecording } from '../lib/record';
  import Table from './Table.svelte';

  let { code }: { code: string } = $props();
  const me = playerId();
  let g = $state<Game | null>(null);
  let status = $state('connecting');
  let skew = $state(0);

  let conn: ReturnType<typeof connect> | undefined;
  $effect(() => {
    conn = connect(
      code,
      (s, serverNow) => {
        g = s;
        skew = Date.now() - serverNow;
      },
      (s) => (status = s),
    );
    const deck = sessionStorage.getItem('deck');
    conn.onOpen(() => {
      conn!.send({ t: 'join', id: me, name: playerName() || 'Player' });
      if (deck) {
        conn!.send({ t: 'load', set: JSON.parse(deck) });
        sessionStorage.removeItem('deck');
      }
    });
    return () => conn?.close();
  });
  // The host records buzz positions when moving past a question (so overrides are included).
  const send = withRecording<Event>(
    () => g!,
    (e) => conn?.send(e),
  );
</script>

{#if g}
  <Table {g} {me} isHost={g.hostId === me} {skew} {send} />
{:else if status === 'offline'}
  <div class="card">
    <h2>Can't reach room {code}</h2>
    <p class="muted">Check the code with the host, or your connection. Retrying automatically…</p>
  </div>
{:else}
  <p><span class="spin"></span> Connecting to room {code}…</p>
{/if}
<p class="bar">
  <a href="/">← Home</a>
  <span class="status"><span class="dot" class:on={status === 'online'}></span>{status}</span>
</p>
