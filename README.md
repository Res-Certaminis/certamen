# Res Certaminis

Open-source [certamen](https://www.njcl.org/Students/Certamen) (Latin quiz bowl) app. Live at **https://play.certamen.workers.dev**.

- **Play** (`/`): multiplayer rooms with server-ordered buzzing, solo practice, buzz analytics, and an installable PWA that works offline.
- **Upload** (`/upload/`): drop a `.pdf`, `.docx` or `.txt` packet (a whole division at once is fine), review the parse, publish one set per round.

## Playing

| Mode            | Who reads                               | The app does                                             |
| --------------- | --------------------------------------- | -------------------------------------------------------- |
| App reads       | The app reveals the tossup word-by-word | Buzz ordering, answer matching, bonuses, scoring         |
| Moderator reads | A human, out loud                       | Buzzers, team lockout, scoring buttons for the moderator |

- **Rooms.** The host picks a set on the home page, shares a short code, players join from any phone or laptop. Default is three teams; the host can rename them and set one to six. Players pick a team in the lobby and can set a nickname for that room only.
- **Buzzing.** Space bar by default (rebindable per device) or the big button on a phone. The server decides buzz order in arrival order, so clients cannot race each other. A wrong tossup answer locks out the whole team for that tossup.
- **Question pool.** In the lobby, or at any point during play, the host can add more sets to the pool and optionally shuffle the unplayed remainder. Shuffling is a permutation, so nothing repeats until the pool is exhausted. Played questions never move.
- **Host controls.** Pause and resume (the reveal freezes and resumes from the same word), reading speed slider that works mid-question, "No answer", correct/incorrect rulings, and an override for the last ruling.
- **Read aloud.** Off by default. Uses the browser's built-in text-to-speech to speak the tossup from the current word and each bonus, following pause and speed.
- **Solo practice.** Same rules, same reducer, self-judged. Any set you have played is cached on the device, so solo works offline.
- **Scoring.** Tossup 10, each bonus 5 (NJCL). Bonuses go to the team that answered the tossup.

### Buzz analytics

When a question is advanced, every buzz on it is recorded: which question, how many words had been revealed, tossup length, correct or not, mode, team and nickname. Overrides made before advancing are included. The reveal screen marks where each player buzzed on the text, and `/s/<set id>` (linked from every set on the home page) shows a buzz strip per question and a by-category conversion table.

Rows are appended with the public key under an insert-only policy, so treat them as community data rather than audited results.

## Importing packets

Three steps: **Packet → Parse → Review & save.**

1. **Packet.** Drop a file or paste text. Text is extracted in the browser (pdf.js, mammoth). Nothing is uploaded until you save.
2. **Parse.** The importer first finds the round structure. With an Anthropic key, one cheap call returns a table of contents (round line ranges plus tournament, year, level, region); it is sanity-checked and otherwise a rule-based heading splitter is used. Each round then parses in parallel, four at a time, with a live "N questions so far" count, per-round retry, and the whole import saved in `localStorage` so closing the tab loses nothing; on return you are offered **Resume**.
3. **Review & save.** Shared tournament / year / level / region fields apply to every round and title them ("Harvard Certamen 2025 Intermediate · Round 3"). Rounds open individually; question cards are read-only until tapped. Before saving, the importer checks for **public** sets with the same tournament, year, level and round: matches are skipped, or replaced in place if you own them (question ids are kept by position so buzz history survives). Second copies of a public round cannot be uploaded. "Save all" publishes every remaining round.

Round labels are normalised to `Round N`, `Quarterfinal`, `Semifinal`, `Final` ("ROUND II", "Round One", "Semis", "FINALS" all map correctly).

### AI parsing (bring your own key)

Uploaders may paste their own Anthropic API key on the upload page. It is stored only in that browser's `localStorage` and sent only to `api.anthropic.com`; there is no server in between. With a key, Claude does the structure pass and parses each round with a structured-output schema (tossup, answer with `(accept …)` alternates kept verbatim, up to three bonuses, category and subcategory, plus set metadata). Default model is Claude Opus 5; Sonnet 5 and Haiku 4.5 are offered as cheaper options. A 20-question round is roughly 6k input and 4k output tokens.

Without a key, a rule-based parser runs. It handles common packet styles and assigns categories by keyword, and the review screen is there to fix what it misses.

### Question format (rule-based parser)

```
TU 1: What Roman god of the sea carried a trident?
ANSWER: NEPTUNE
B1: Who was his Greek counterpart?
ANSWER: POSEIDON
```

```
1. Give the Latin for "and".
ET
B1: Now give an enclitic meaning "and".
-QUE
```

Numbered tossups, `TU`/`Tossup` markers, `B1`/`Bonus` markers, `ANSWER:`/`ANS:`/line-initial `A:`, and bare all-caps answer lines are recognised. Moderator-only lines such as `**SCORE CHECK**` are ignored.

## Data model

Supabase Postgres, schema in `supabase/migrations/`:

- `sets`: title, `level` (novice / intermediate / advanced), `year`, `tournament`, `region`, `round`, `public`, owner.
- `questions`: one row per tossup with `idx`, `tossup`, `answer`, `bonuses` (JSON), `category`, `subcategory`.
- `buzzes`: one row per tossup buzz (question, room, mode, player, team, word, words, correct, answer).

`region` is `National` for NJCL, a US state for state JCL events and school-hosted tournaments, or `Competitive Circuit` for open invitationals (usually college-hosted). Each question has one of four main categories, `Grammar`, `History`, `Mythology`, `Literature`, plus an optional free-text `subcategory` such as "Subjunctive" or "Second Punic War" for finer analytics. Grammar includes vocabulary, derivatives, translation and mottoes; History includes culture, daily life and geography.

Row-level security: anyone can read public sets and their questions; only the owner can write; buzz rows are append-only for everyone.

## Architecture

```
Browser (Svelte 5 + Vite PWA) ──WebSocket──▶ Cloudflare Worker ──▶ Room Durable Object (one per code)
        │                                                                 └─ src/lib/game.ts reducer
        └──REST──▶ Supabase (Postgres, Auth for uploaders)
        └──HTTPS──▶ api.anthropic.com (uploader's own key, optional)
```

- The Durable Object is the single source of truth for a room. It applies events through the pure reducer in `src/lib/game.ts`, persists state, and broadcasts. Solo mode runs the same reducer in the browser, so rules are tested once.
- Text reveal is time-based from a server timestamp; clients render locally and the server records the word each buzz landed on.
- The player bundle is small; the packet parsers and the Anthropic SDK load lazily on the upload page only.
- **Cost.** Everything fits free tiers: Cloudflare Workers + Durable Objects (static assets included), Supabase free project. There is no server to keep warm. Supabase pauses free projects after a week without traffic; restore from the dashboard.

## Setup

Prerequisites: Node ≥ 20, [pnpm](https://pnpm.io), a Cloudflare account, a Supabase project.

```sh
pnpm install
cp .env.example .env
```

**Supabase**

1. Project Settings → API Keys. Put the project URL and the **publishable** key (`sb_publishable_…`) in `.env`. The secret key is never used.
2. SQL editor → run each file in `supabase/migrations/` in order (or `supabase link` then `pnpm db:push`).
3. Authentication → Providers: enable Google and/or GitHub (OAuth needs no email sending). Magic links also work, but Supabase's built-in mailer only delivers to project members unless you configure SMTP.
4. Authentication → URL configuration: add `https://<your worker>.workers.dev/**` and `http://localhost:5173/**` to Redirect URLs.

**Run locally**

```sh
pnpm dev          # Vite on :5173 proxies /ws to the Worker on :8787
pnpm test         # vitest
pnpm check        # svelte-check + worker types
pnpm smoke        # two-client WebSocket test against a running worker
```

**Deploy**

```sh
pnpm exec wrangler login
pnpm run deploy   # builds and ships static assets + Worker + Durable Object
```

Or set the `DEPLOY` repository variable to `true` and add `CLOUDFLARE_API_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` as GitHub secrets; `.github/workflows/deploy.yml` deploys on push to `main`.

## Design

Dark gradient theme, Inter, Roman purple accent. Every foreground/background token pair is checked for WCAG AAA (7:1) contrast in `test/contrast.test.ts`, so CI fails if a colour change drops below it. Mobile-first: 44 px touch targets, safe-area padding, sticky buzz button.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
