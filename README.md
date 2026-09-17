# Certamen

Open-source [certamen](https://www.njcl.org/Students/Certamen) (Latin quiz bowl) app. Two small web apps:

- **Play** (`/`): multiplayer rooms with server-ordered buzzing, solo practice, and an installable offline PWA.
- **Upload** (`/upload/`): drop a `.docx`/`.pdf`/`.txt` packet, fix the parse in place, publish the set.

Two game modes:

| Mode            | Who reads                               | The app does                                             |
| --------------- | --------------------------------------- | -------------------------------------------------------- |
| App reads       | The app reveals the tossup word-by-word | Buzz ordering, answer matching, bonuses, scoring         |
| Moderator reads | A human, out loud                       | Buzzers, team lockout, scoring buttons for the moderator |

Buzz with the space bar (rebindable in-game) or the big button on a phone.

## Architecture

```
Browser (Svelte 5 + Vite PWA) ──WebSocket──▶ Cloudflare Worker ──▶ Room Durable Object (one per code)
        │                                                                 └─ src/lib/game.ts reducer
        └──REST──▶ Supabase (Postgres `sets` table, Auth for uploaders)
```

- **Buzz ordering is decided by the Durable Object** in arrival order, so clients can't race each other. Text reveal is time-based from a server timestamp; clients render locally and the server records which word the buzz landed on.
- The **same pure reducer** (`src/lib/game.ts`) runs in the Durable Object and in the browser for solo mode, so rules are tested once.
- **Data model** (Supabase Postgres): `sets` (title, level, year, tournament, region, round) → `questions` (one row each, with `category`) → `buzzes` (one row per tossup buzz: word position, tossup length, correct, mode, team, player). Sets can be starred for offline play; they are cached in `localStorage` and the app shell is precached by the service worker.
- **Buzz analytics**: when the host (or solo player) advances past a question, every buzz on it is appended to `buzzes`, including any overrides. The reveal screen marks where each player buzzed, and `/s/<set id>` shows per-question buzz strips and a by-category conversion table. Buzz rows are appended with the publishable key (insert-only, no edits), so treat them as community data rather than audited results.
- Packet parsing runs in the browser (mammoth for docx, pdf.js for pdf), optionally followed by an AI pass with the uploader's own Anthropic key. No server compute.

### Cost

Everything fits the free tiers: Cloudflare Workers + Durable Objects (static assets included), Supabase free project. There is no server to keep warm. Supabase pauses free projects after a week without activity; unpause from the dashboard, or store sets offline.

## Setup

Prerequisites: Node ≥ 20, [pnpm](https://pnpm.io), a Cloudflare account, a Supabase project.

```sh
pnpm install
cp .env.example .env
```

**Supabase**

1. Dashboard → restore the project if paused → Project Settings → API Keys. Put the project URL and the **publishable** key (`sb_publishable_…`) in `.env`. The secret key is never used.
2. SQL editor → run each file in `supabase/migrations/` in order (or `supabase link` then `pnpm db:push`).
3. Authentication → Providers: enable GitHub and/or Google (OAuth needs no email sending). Email magic links also work but Supabase's built-in mailer only delivers to project members, so configure custom SMTP for that.
4. Authentication → URL configuration: add your deployed origin and `http://localhost:5173` to redirect URLs.

**Run locally**

```sh
pnpm dev          # http://localhost:5173 (Vite) proxies /ws to the Worker on :8787
pnpm test
pnpm check
```

**Deploy**

```sh
pnpm exec wrangler login
pnpm run deploy       # builds and ships static assets + Worker + Durable Object
```

Or set the `DEPLOY` repository variable to `true` and add `CLOUDFLARE_API_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (the publishable key) as GitHub secrets; `.github/workflows/deploy.yml` deploys on push to `main`.

## Importing packets

The upload page walks through three steps: pick a file (or paste text), parse, review and save. A PDF or Word file often holds a whole division, so the text is first split on round headings ("Round 3", "Semifinal", "Finals") and each round becomes its own set, titled from the shared tournament, year and level. Every round shows its own parse status with a retry button, and one "Save all" button publishes them together. Rounds can be opened individually to fix questions before saving. Before saving, the importer looks for **public** sets with the same tournament, year, level and round; matching rounds default to "Skip", with "Replace mine" (keeps question ids by position, so buzz history survives) when you own the existing set, or "Upload anyway". Private sets are never consulted.

## AI parsing (bring your own key)

The built-in parser is heuristic. For messy packets, the upload page instead sends each round's text to Claude automatically when a key is saved with structured output, using the uploader's own Anthropic API key. The key is kept in that browser's `localStorage` and sent only to `api.anthropic.com`; there is no server in between. The model also fills in set metadata (level, year, tournament, round) and a category per tossup when the packet states them. Default model is Claude Opus 5; Sonnet 5 and Haiku 4.5 are offered as cheaper options. A 30-question packet is roughly 8k input and 6k output tokens. Code lives in `src/lib/ai.ts` and loads lazily, so players never download it.

## Question format

The parser is forgiving. Any of these work, and you can edit the result before saving:

```
TU 1: What Roman god of the sea carried a trident?
ANSWER: NEPTUNE
B1: Who was his Greek counterpart?
ANSWER: POSEIDON
B2: Name Neptune's wife.
ANSWER: SALACIA (accept AMPHITRITE)
```

```
1. Give the Latin for "and".
ET
Bonus 1: Now give an enclitic meaning "and".
-QUE
```

Parenthetical `(accept …)` alternates are honoured by the answer matcher; `(do not accept …)` is ignored.

## Metadata

Sets carry `level` (novice / intermediate / advanced), `year`, `tournament`, `region`, and `round`. `region` is "National" for NJCL, a US state for state JCL events and school-hosted tournaments, or "Competitive Circuit" for open invitationals (usually college-hosted). The importer guesses these from the packet's cover text and the AI parser confirms them.

Each question has one of four main categories, `Grammar`, `History`, `Mythology`, `Literature`, plus an optional free-text `subcategory` (e.g. "Subjunctive", "Derivatives", "Second Punic War") for finer analytics. Grammar includes vocabulary, derivatives, translation and mottoes; History includes culture, daily life and geography. The home page filters by level; the stats page groups by category.

## Metadata

Sets carry `level` (novice / intermediate / advanced), `year`, `tournament`, `region`, and `round`. `region` is "National" for NJCL, a US state for state JCL events and school-hosted tournaments, or "Competitive Circuit" for open invitationals (usually college-hosted). The importer guesses these from the packet's cover text and the AI parser confirms them.

Each question has one of four main categories, `Grammar`, `History`, `Mythology`, `Literature`, plus an optional free-text `subcategory` (e.g. "Subjunctive", "Derivatives", "Second Punic War") for finer analytics. Grammar includes vocabulary, derivatives, translation and mottoes; History includes culture, daily life and geography. The home page filters by level; the stats page groups by category.

## Scoring

Tossup 10, each bonus 5 (NJCL). A wrong tossup answer locks out the whole team for that tossup. The host can override any ruling.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
