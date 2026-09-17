<script lang="ts">
  /** The game UI. Used by multiplayer rooms (state from the server) and solo mode (local reducer). */
  import type { Event, Game, Mode } from '../lib/types';
  import { BONUS_POINTS, current, revealedWords, scores } from '../lib/game';
  import { buzzKey, setBuzzKey, setPlayerName } from '../lib/store';

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
</script>

<svelte:window onkeydown={onKey} />

<div class="bar">
  <strong>{g.setTitle || (solo ? 'Solo practice' : `Room ${g.code}`)}</strong>
  <span class="muted">{g.total ? `Q${Math.min(g.qi + 1, g.total)}/${g.total}` : ''} {g.phase}</span>
</div>

<div class="grid side">
  <div>
    {#if g.phase === 'lobby'}
      <div class="card">
        {#if !solo}
          <h2>Room {g.code}</h2>
          <p class="muted">
            Share this code or the page link. Players buzz with <kbd>{key}</kbd> or the button.
          </p>
          <label
            >Name
            <input
              type="text"
              value={mine?.name ?? ''}
              maxlength="24"
              onchange={(e) => {
                setPlayerName(val(e));
                send({ t: 'rename', id: me, name: val(e) });
              }}
            /></label
          >
          <p>Team:</p>
          <div class="row">
            {#each g.teams as t, i}
              <button class:primary={myTeam === i} onclick={() => send({ t: 'team', id: me, team: i })}
                >{t}</button
              >
            {/each}
          </div>
        {/if}
        {#if isHost}
          <fieldset>
            <legend>{solo ? 'Settings' : 'Host settings'}</legend>
            {#if !solo}
              <label
                >Mode
                <select value={g.mode} onchange={(e) => send({ t: 'config', mode: val(e) as Mode })}>
                  <option value="reader">App reads the question</option>
                  <option value="live">Moderator reads aloud (buzzers + scoring only)</option>
                </select></label
              >
              <label
                >Teams (comma separated)
                <input
                  type="text"
                  value={g.teams.join(', ')}
                  onchange={(e) => send({ t: 'config', teams: val(e).split(',') })}
                /></label
              >
            {/if}
            <label
              >Reading speed
              <input
                type="range"
                min="100"
                max="400"
                step="10"
                value={g.wpm}
                oninput={(e) => send({ t: 'config', wpm: +val(e) })}
              />
              {g.wpm} wpm</label
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
        {#each g.teams as t, i}<p><span class="score">{totals[i]}</span> {t}</p>{/each}
        {#if isHost}<button class="primary" onclick={() => send({ t: 'reset' })}>Back to lobby</button>{/if}
      </div>
    {:else}
      <div class="card">
        <h3>
          Tossup {g.qi + 1}
          {#if g.question?.category}<span class="tag">{g.question.category}</span>{/if}
        </h3>
        {#if g.mode === 'reader' || isHost}
          <p class="q">
            {g.phase === 'reading' || g.phase === 'buzzed'
              ? tossup.slice(0, isHost && g.mode === 'live' ? tossup.length : words).join(' ')
              : tossup.join(' ')}
          </p>
        {:else}
          <p class="q muted">Listen to the moderator…</p>
        {/if}

        {#if g.phase === 'reading'}
          {#if g.locked.includes(myTeam)}
            <p class="bad-text">Your team is locked out of this tossup.</p>
          {/if}
          <button class="buzz" class:hot={canBuzz && !buzzed} onclick={buzz} disabled={!canBuzz || buzzed}>
            {buzzed ? '…' : 'BUZZ'}
          </button>
        {:else if g.phase === 'buzzed'}
          {#if myBuzz && g.mode === 'reader'}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              class="row"
            >
              <input
                type="text"
                bind:this={input}
                bind:value={answer}
                placeholder="Your answer"
                autocomplete="off"
                autocapitalize="off"
                style="flex:1"
              />
              <button class="primary" type="submit">Answer ({secondsLeft})</button>
            </form>
          {:else}
            <p>
              <strong>{pname(g.buzz?.player ?? '')}</strong> buzzed{g.mode === 'reader'
                ? ` (${secondsLeft}s)`
                : ''}.
            </p>
          {/if}
        {:else if g.phase === 'bonus' && g.question}
          <p class="ok-text">Tossup: {pname(result?.player ?? '')} — {g.question.answer || '✓'}</p>
          {#each g.question.bonuses as b, i}
            {#if i <= g.bonusIdx}
              <p>
                <strong>B{i + 1}.</strong>
                {#if g.mode === 'reader' || isHost}{b.q}{/if}
                {#if result?.bonuses[i] === true}<span class="ok-text"> ✓ {b.a}</span>
                {:else if result?.bonuses[i] === false}<span class="bad-text"> ✗ {b.a}</span>{/if}
              </p>
            {/if}
          {/each}
          {#if g.mode === 'reader' && onBonusTeam && !isHost}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                submitBonus();
              }}
              class="row"
            >
              <input
                type="text"
                bind:value={answer}
                placeholder="Team answer"
                autocomplete="off"
                autocapitalize="off"
                style="flex:1"
              />
              <button class="primary" type="submit">Answer</button>
            </form>
          {:else if g.mode === 'reader' && solo}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                submitBonus();
              }}
              class="row"
            >
              <input
                type="text"
                bind:value={answer}
                placeholder="Your answer"
                autocomplete="off"
                autocapitalize="off"
                style="flex:1"
              />
              <button class="primary" type="submit">Answer</button>
            </form>
          {/if}
        {:else if g.phase === 'dead' && g.question}
          {#if g.mode === 'reader' && g.results.some((r) => r.qi === g.qi)}
            <p class="q">
              {#each tossup as w, i}
                {w}{#each g.results.filter((r) => r.qi === g.qi && r.word === i + 1) as r}<span
                    class={r.correct ? 'ok-text' : 'bad-text'}
                    title={pname(r.player)}>▮</span
                  >{/each}{' '}
              {/each}
            </p>
          {/if}
          <p><strong>Answer:</strong> {g.question.answer}</p>
          {#each g.results.filter((r) => r.qi === g.qi) as r}
            <p class={r.correct ? 'ok-text' : 'bad-text'}>
              {pname(r.player)} buzzed at word {r.word}/{tossup.length}{r.answer
                ? ` with "${r.answer}"`
                : ''}: {r.correct ? 'correct' : 'incorrect'}
            </p>
          {/each}
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
      </div>

      {#if isHost}
        <div class="card row">
          {#if g.phase === 'reading'}
            {#if g.mode === 'live' && g.question}<span><strong>Answer:</strong> {g.question.answer}</span
              >{/if}
            <button onclick={() => send({ t: 'dead' })}>No answer / dead</button>
          {:else if g.phase === 'buzzed'}
            <button class="ok" onclick={() => send({ t: 'judge', correct: true })}>Correct</button>
            <button class="bad" onclick={() => send({ t: 'judge', correct: false })}>Incorrect</button>
          {:else if g.phase === 'bonus' && g.question}
            <span><strong>B{g.bonusIdx + 1} answer:</strong> {g.question.bonuses[g.bonusIdx]?.a}</span>
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
  </div>

  <aside>
    <div class="card">
      {#each g.teams as t, i}
        <div class="bar">
          <span>
            <strong>{t}</strong>
            {#if g.locked.includes(i) && (g.phase === 'reading' || g.phase === 'buzzed')}<span class="tag"
                >locked</span
              >{/if}
          </span>
          <span class="score">{totals[i]}</span>
        </div>
        {#if !solo}
          <p class="muted">
            {#each Object.values(g.players).filter((p) => p.team === i) as p (p.id)}
              <span
                ><span class="dot" class:on={p.online}></span>{p.name}{p.id === g.hostId ? ' (host)' : ''}
              </span>
            {/each}
          </p>
        {/if}
      {/each}
      <p class="muted">Tossup 10 · bonus {BONUS_POINTS} each</p>
    </div>
    <div class="card">
      <button onclick={() => (capturing = true)}>{capturing ? 'Press any key…' : `Buzz key: ${key}`}</button>
    </div>
    <div class="card log">
      {#each [...g.log].reverse() as line}<div>{line}</div>{/each}
    </div>
  </aside>
</div>
