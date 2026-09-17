<script lang="ts">
  /** The game UI. Used by multiplayer rooms (state from the server) and solo mode (local reducer). */
  import type { Event, Game, Mode } from '../lib/types';
  import { BONUS_POINTS, current, revealedWords, scores } from '../lib/game';
  import { buzzKey, setBuzzKey } from '../lib/store';

  let {
    g,
    me,
    isHost,
    skew = 0,
    solo = false,
    send,
  }: {
    g: Game;
    me: string;
    isHost: boolean;
    skew?: number;
    solo?: boolean;
    send: (e: Event) => void;
  } = $props();

  const ANSWER_MS = 10000;
  let now = $state(Date.now());
  $effect(() => {
    const i = setInterval(() => (now = Date.now()), 40);
    return () => clearInterval(i);
  });
  const serverNow = $derived(now - skew);
  const words = $derived(revealedWords(g, serverNow));
  const tossup = $derived(g.question?.tossup.split(/\s+/).filter(Boolean) ?? []);
  const mine = $derived(g.players[me]);
  const myTeam = $derived(mine?.team ?? 0);
  const canBuzz = $derived(g.phase === 'reading' && !!mine && !g.locked.includes(myTeam));
  const result = $derived(current(g));
  const onBonusTeam = $derived(result?.team === myTeam);
  const totals = $derived(scores(g));
  const myBuzz = $derived(g.phase === 'buzzed' && g.buzz?.player === me);
  const deadline = $derived(g.phase === 'buzzed' && g.buzz ? g.buzz.at + ANSWER_MS : 0);
  const secondsLeft = $derived(
    deadline ? Math.min(ANSWER_MS / 1000, Math.max(0, Math.ceil((deadline - serverNow) / 1000))) : 0,
  );
  const lastRuling = $derived([...g.results].reverse().find((r) => r.qi === g.qi));
  const thisQ = $derived(g.results.filter((r) => r.qi === g.qi));
  const inPlay = $derived(g.phase !== 'lobby' && g.phase !== 'done');
  const showMarkers = $derived(g.phase === 'dead' && g.mode === 'reader' && thisQ.length > 0);

  let key = $state(buzzKey());
  let capturing = $state(false);
  let answer = $state('');
  let buzzed = $state(false); // optimistic, until the server confirms
  let submittedFor = 0;
  let input = $state<HTMLInputElement>();

  $effect(() => {
    g.phase; // reset optimism whenever state moves
    buzzed = false;
  });
  $effect(() => {
    if (myBuzz && g.mode === 'reader') setTimeout(() => input?.focus(), 0);
  });
  $effect(() => {
    if (myBuzz && g.mode === 'reader' && serverNow > deadline) submit();
  });

  function buzz() {
    if (!canBuzz || buzzed) return;
    buzzed = true;
    send({ t: 'buzz', id: me });
  }
  function submit() {
    if (!myBuzz || submittedFor === g.buzz!.at) return;
    submittedFor = g.buzz!.at;
    send({ t: 'answer', id: me, text: answer });
    answer = '';
  }
  function submitBonus() {
    if (!answer.trim()) return;
    send({ t: 'bonusAnswer', id: me, text: answer });
    answer = '';
  }
  function onKey(e: KeyboardEvent) {
    if (capturing) {
      e.preventDefault();
      setBuzzKey((key = e.code));
      capturing = false;
      return;
    }
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === key && !e.repeat) {
      e.preventDefault();
      buzz();
    }
  }
  const pname = (id: string) => g.players[id]?.name ?? '?';
  const val = (e: { currentTarget: HTMLInputElement | HTMLSelectElement }) => e.currentTarget.value;
  const members = (i: number) => Object.values(g.players).filter((p) => p.team === i);
  const keyLabel = (k: string) => k.replace(/^Key|^Digit/, '');
</script>

<svelte:window onkeydown={onKey} />

<div class="bar">
  <div class="min">
    <h2>{g.setTitle || (solo ? 'Solo practice' : `Room ${g.code}`)}</h2>
    <p class="muted" style="margin:0">
      {g.total ? `Question ${Math.min(g.qi + 1, g.total)} of ${g.total} · ` : ''}{g.mode === 'reader'
        ? 'App reads'
        : 'Moderator reads'}
    </p>
  </div>
  {#if !solo}<span class="tag accent" style="font-size:1rem;padding:.25rem .7rem">{g.code}</span>{/if}
</div>

<!-- Team scores. In the lobby these are the team picker. -->
<div class="teams" role={g.phase === 'lobby' && !solo ? 'radiogroup' : undefined}>
  {#each g.teams as t, i}
    <svelte:element
      this={g.phase === 'lobby' && !solo ? 'button' : 'div'}
      class="team"
      class:mine={!solo && myTeam === i}
      role={g.phase === 'lobby' && !solo ? 'radio' : undefined}
      aria-checked={g.phase === 'lobby' && !solo ? myTeam === i : undefined}
      onclick={g.phase === 'lobby' && !solo ? () => send({ t: 'team', id: me, team: i }) : undefined}
    >
      <div class="name">
        <span>{t}</span>
        {#if g.locked.includes(i) && (g.phase === 'reading' || g.phase === 'buzzed')}<span class="tag"
            >locked</span
          >{/if}
      </div>
      <div class="score">{totals[i]}</div>
      {#if !solo}
        <div class="muted" style="font-size:.8rem">
          {#each members(i) as p (p.id)}
            <span><span class="dot" class:on={p.online}></span>{p.name}{p.id === g.hostId ? ' ★' : ''}</span
            >{' '}
          {:else}
            <span>—</span>
          {/each}
        </div>
      {/if}
    </svelte:element>
  {/each}
</div>

{#if g.phase === 'lobby'}
  <div class="card stack">
    {#if !solo}
      <p class="muted" style="margin:0">
        Share the code <strong style="color:var(--fg)">{g.code}</strong> or this page's link. Tap a team above to
        switch.
      </p>
    {/if}
    {#if isHost}
      <fieldset>
        <legend>{solo ? 'Settings' : 'Host settings'}</legend>
        {#if !solo}
          <label
            >Mode
            <select value={g.mode} onchange={(e) => send({ t: 'config', mode: val(e) as Mode })}>
              <option value="reader">App reads the question</option>
              <option value="live">Moderator reads aloud</option>
            </select></label
          >
          <label
            >Teams
            <input
              type="text"
              value={g.teams.join(', ')}
              placeholder="Comma separated"
              onchange={(e) => send({ t: 'config', teams: val(e).split(',') })}
            /></label
          >
        {/if}
        <label
          >Speed
          <input
            type="range"
            min="100"
            max="400"
            step="10"
            value={g.wpm}
            oninput={(e) => send({ t: 'config', wpm: +val(e) })}
          />
          <span style="min-width:4.5rem;text-align:right">{g.wpm} wpm</span></label
        >
        <button class="primary" onclick={() => send({ t: 'start' })} disabled={!g.total}>
          {g.total ? 'Start' : 'Waiting for a question set…'}
        </button>
      </fieldset>
    {:else}
      <p class="muted">Waiting for {pname(g.hostId ?? '')} to start.</p>
    {/if}
  </div>
{:else if g.phase === 'done'}
  <div class="card">
    <h2>Final score</h2>
    {#each g.teams as t, i}
      <div class="bar"><span>{t}</span><span class="score">{totals[i]}</span></div>
    {/each}
    {#if isHost}<button class="primary" style="margin-top:1rem" onclick={() => send({ t: 'reset' })}
        >Back to lobby</button
      >{/if}
  </div>
{:else}
  <div class="card">
    <div class="bar">
      <h3>Tossup {g.qi + 1}</h3>
      {#if g.question?.category}<span class="tag">{g.question.category}</span>{/if}
    </div>

    {#if showMarkers}
      <p class="q">
        {#each tossup as w, i}
          {w}{#each thisQ.filter((r) => r.word === i + 1) as r}<span
              class={r.correct ? 'ok-text' : 'bad-text'}
              title={pname(r.player)}>▮</span
            >{/each}{' '}
        {/each}
      </p>
    {:else if g.mode === 'reader' || isHost}
      <p class="q">
        {g.phase === 'reading' || g.phase === 'buzzed'
          ? tossup.slice(0, isHost && g.mode === 'live' ? tossup.length : words).join(' ')
          : tossup.join(' ')}
      </p>
    {:else}
      <p class="q muted">Listen to the moderator…</p>
    {/if}

    {#if g.phase === 'reading' && g.locked.includes(myTeam)}
      <p class="bad-text">Your team is locked out of this tossup.</p>
    {:else if g.phase === 'buzzed'}
      {#if myBuzz && g.mode === 'reader'}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          class="answer-form"
        >
          <input
            type="text"
            bind:this={input}
            bind:value={answer}
            placeholder="Your answer"
            autocomplete="off"
            autocapitalize="off"
          />
          <button class="primary" type="submit">Answer · {secondsLeft}</button>
        </form>
      {:else}
        <p>
          <strong>{pname(g.buzz?.player ?? '')}</strong> buzzed{g.mode === 'reader'
            ? ` · ${secondsLeft}s`
            : ''}
        </p>
      {/if}
    {:else if g.phase === 'bonus' && g.question}
      <p class="ok-text">{pname(result?.player ?? '')} · {g.question.answer || 'correct'}</p>
      {#each g.question.bonuses as b, i}
        {#if i <= g.bonusIdx}
          <p>
            <span class="tag">B{i + 1}</span>
            {#if g.mode === 'reader' || isHost}{b.q}{/if}
            {#if result?.bonuses[i] === true}<span class="ok-text"> ✓ {b.a}</span>
            {:else if result?.bonuses[i] === false}<span class="bad-text"> ✗ {b.a}</span>{/if}
          </p>
        {/if}
      {/each}
      {#if g.mode === 'reader' && ((onBonusTeam && !isHost) || solo)}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            submitBonus();
          }}
          class="answer-form"
        >
          <input
            type="text"
            bind:value={answer}
            placeholder={solo ? 'Your answer' : 'Team answer'}
            autocomplete="off"
            autocapitalize="off"
          />
          <button class="primary" type="submit">Answer</button>
        </form>
      {/if}
    {:else if g.phase === 'dead' && g.question}
      <p><span class="muted">Answer</span> <strong>{g.question.answer}</strong></p>
      {#each thisQ as r}
        <p class={r.correct ? 'ok-text' : 'bad-text'}>
          {pname(r.player)} buzzed at word {r.word}/{tossup.length}{r.answer ? ` with "${r.answer}"` : ''}: {r.correct
            ? 'correct'
            : 'incorrect'}
        </p>
      {/each}
      {#if g.question.bonuses.length}
        <ul>
          {#each g.question.bonuses as b, i}
            <li>
              {b.q} <strong>{b.a}</strong>
              {#if result?.bonuses[i] === true}<span class="ok-text">✓</span
                >{:else if result?.bonuses[i] === false}<span class="bad-text">✗</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if isHost}
    <div class="card row">
      {#if g.phase === 'reading'}
        {#if g.mode === 'live' && g.question}<span
            ><span class="muted">Answer</span> <strong>{g.question.answer}</strong></span
          >{/if}
        <button onclick={() => send({ t: 'dead' })}>No answer</button>
        {#if g.mode === 'reader'}
          <label style="flex:1;min-width:12rem"
            >Speed
            <input
              type="range"
              min="100"
              max="400"
              step="10"
              value={g.wpm}
              oninput={(e) => send({ t: 'config', wpm: +val(e) })}
            /> <span style="min-width:4.5rem">{g.wpm} wpm</span></label
          >
        {/if}
      {:else if g.phase === 'buzzed'}
        <button class="ok" onclick={() => send({ t: 'judge', correct: true })}>Correct</button>
        <button class="bad" onclick={() => send({ t: 'judge', correct: false })}>Incorrect</button>
      {:else if g.phase === 'bonus' && g.question}
        <span
          ><span class="muted">B{g.bonusIdx + 1}</span>
          <strong>{g.question.bonuses[g.bonusIdx]?.a}</strong></span
        >
        <button class="ok" onclick={() => send({ t: 'bonus', correct: true })}>Correct</button>
        <button class="bad" onclick={() => send({ t: 'bonus', correct: false })}>Incorrect</button>
      {:else if g.phase === 'dead'}
        <button class="primary" onclick={() => send({ t: 'next' })}>Next question</button>
        {#if lastRuling}
          <button onclick={() => send({ t: 'judge', correct: !lastRuling.correct })}>
            {solo
              ? lastRuling.correct
                ? 'I was wrong'
                : 'I was right'
              : `Override: ${lastRuling.correct ? 'incorrect' : 'correct'}`}
          </button>
        {/if}
        {#if result?.bonuses.length}
          <button onclick={() => send({ t: 'bonus', correct: !result.bonuses.at(-1) })}
            >Flip last bonus</button
          >
        {/if}
      {/if}
    </div>
  {/if}
{/if}

{#if inPlay && g.phase === 'reading'}
  <div class="controls">
    <button class="buzz" class:hot={canBuzz && !buzzed} onclick={buzz} disabled={!canBuzz || buzzed}>
      {buzzed ? '…' : g.locked.includes(myTeam) ? 'LOCKED' : 'BUZZ'}
    </button>
  </div>
{/if}

{#if g.log.length}
  <div class="log" style="margin-top:.75rem">
    {#each [...g.log].reverse().slice(0, 4) as line}<div>{line}</div>{/each}
  </div>
{/if}
<div class="bar muted" style="margin-top:.5rem">
  <span>Tossup 10 · bonus {BONUS_POINTS} each</span>
  <span class="row">
    {#if !solo && mine}
      <label class="muted" style="gap:.35rem"
        >Nickname
        <input
          type="text"
          class="sm"
          value={mine.name}
          maxlength="24"
          style="width:9rem"
          onchange={(e) => send({ t: 'rename', id: me, name: val(e).trim() || mine!.name })}
        /></label
      >
    {/if}
    <button class="ghost sm" onclick={() => (capturing = true)} aria-live="polite">
      {capturing ? 'Press any key…' : `Buzz key: ${keyLabel(key)}`}
    </button>
  </span>
</div>
