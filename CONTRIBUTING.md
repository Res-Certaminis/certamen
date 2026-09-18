# Contributing

Small, focused pull requests are welcome. Please keep the codebase small: prefer deleting to adding.

## Setup

```sh
pnpm install
cp .env.example .env   # fill in Supabase URL + publishable key (optional for solo/offline play)
pnpm dev               # Vite on :5173, Worker + Durable Object on :8787
```

## Checks

```sh
pnpm check   # svelte-check + worker type check
pnpm test    # vitest (reducer, parser, matcher)
pnpm fmt     # prettier
```

CI runs all three plus a production build. Please run them before opening a PR.

For a live end-to-end check of the Durable Object (buzz ordering, redaction, lockout, reconnect):

```sh
pnpm build && pnpm exec wrangler dev --port 8787   # in one terminal
pnpm smoke                                          # in another
```

## Where things live

- `src/lib/game.ts` — the pure game reducer plus deck/pool helpers. All rules live here; it runs on both the server and in solo mode. Every rule change needs a test in `test/game.test.ts`.
- `worker/index.ts` — Cloudflare Worker + `Room` Durable Object. Thin: authorises messages, calls `reduce`, manages the deck, broadcasts.
- `src/lib/parse.ts` — packet text → rounds → questions (rule-based), metadata and category guessing, round-label normalisation, and the sanity check for AI outlines. Add a sample to `test/parse.test.ts` (or `test/harvard.test.ts`) when you fix a format.
- `src/lib/ai.ts` — optional Anthropic calls: packet outline and per-round structured parse. Loads lazily.
- `src/lib/match.ts` — answer normalisation and fuzzy matching.
- `src/lib/record.ts` — buzz analytics rows.
- `src/play/` — player app (Svelte 5). `Table.svelte` renders every phase; `SetPicker.svelte` grows the pool; `Stats.svelte` is the analytics page.
- `src/upload/App.svelte` — the import pipeline and editor.
- `src/app.css` — design tokens and components; contrast is enforced by `test/contrast.test.ts`.
- `supabase/migrations/` — database schema and row-level security.
- `scripts/smoke.mjs` — end-to-end WebSocket test against a running worker.
