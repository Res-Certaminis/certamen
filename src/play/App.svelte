<script lang="ts">
  import Brand from '../lib/Brand.svelte';
  import Home from './Home.svelte';
  import Room from './Room.svelte';
  import Solo from './Solo.svelte';
  import Stats from './Stats.svelte';

  let path = $state(location.pathname);
</script>

<svelte:window onpopstate={() => (path = location.pathname)} />

<main>
  <Brand><a href="/upload/">Upload</a></Brand>
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
