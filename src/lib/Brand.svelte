<script lang="ts">
  import type { Snippet } from 'svelte';
  import Buzzer from './Buzzer.svelte';
  let { children }: { children?: Snippet } = $props();
</script>

<header class="brand">
  <a class="logo" href="/"><Buzzer size={26} />Certamen</a>
  <span class="row">{@render children?.()}</span>
</header>
