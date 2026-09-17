<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children?: Snippet } = $props();
</script>

<header class="brand">
  <a class="logo" href="/"><i></i>Certamen</a>
  <span class="row">{@render children?.()}</span>
</header>
