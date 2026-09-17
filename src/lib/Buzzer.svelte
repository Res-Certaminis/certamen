<script lang="ts">
  /** Hand-held quiz buzzer: grey paddle, red dome button, cord. Used as the brand mark. */
  let { size = 22 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M32 54v5c0 5-9 4-9 9" fill="none" stroke="#8d8d99" stroke-width="3.5" stroke-linecap="round" />
  <rect x="19" y="6" width="26" height="48" rx="9" fill="#a7a7b3" stroke="#70707d" stroke-width="2" />
  <rect x="23" y="34" width="18" height="12" rx="3" fill="#8d8d99" />
  <circle cx="32" cy="20" r="9.5" fill="#b3261e" />
  <circle cx="32" cy="19" r="8" fill="#e03b31" />
  <ellipse cx="29.5" cy="15.5" rx="3" ry="1.8" fill="#ff9a94" opacity="0.85" />
</svg>
