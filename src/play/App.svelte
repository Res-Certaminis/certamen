<script lang="ts">
  import Home from './Home.svelte';
  import Room from './Room.svelte';
  import Solo from './Solo.svelte';
  import Stats from './Stats.svelte';

  let path = $state(location.pathname);
</script>

<svelte:window onpopstate={() => (path = location.pathname)} />

<main>
  {#if path.startsWith('/r/')}
    <Room code={path.slice(3).toUpperCase()} />
  {:else if path.startsWith('/s/')}
    <Stats id={path.slice(3)} />
  {:else if path === '/solo'}
    <Solo />
  {:else}
    <Home />
  {/if}
</main>
