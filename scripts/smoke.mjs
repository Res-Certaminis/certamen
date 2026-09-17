#!/usr/bin/env node
/**
 * End-to-end smoke test against a running Worker (`pnpm exec wrangler dev --port 8787`).
 * Two clients join a room, the host loads a deck, both buzz, and we assert ordering,
 * redaction, lockout, scoring, and reconnect. No dependencies beyond Node ≥ 22.
 *   pnpm smoke [ws://host]
 */
const base = process.argv[2] ?? 'ws://localhost:8787';
const code = 'SMK' + Math.random().toString(36).slice(2, 6).toUpperCase();
const deck = {
  title: 'Smoke',
  public: true,
  questions: [
    {
      tossup: 'one two three four five six seven eight nine ten',
      answer: 'ROMA',
      bonuses: [{ q: 'b1', a: 'AQUA' }],
    },
    { tossup: 'second', answer: 'X', bonuses: [] },
  ],
};
let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = () =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${base}/ws/${code}`);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'state') ws.latest = m.state;
    };
    ws.onopen = () => res(Object.assign(ws, { s: (m) => ws.send(JSON.stringify(m)) }));
    ws.onerror = () => rej(new Error(`cannot connect to ${base}`));
  });
const until = (fn, ms = 2000) =>
  new Promise((res, rej) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      if (fn()) (clearInterval(i), res());
      else if (Date.now() - t0 > ms) (clearInterval(i), rej(new Error('timeout')));
    }, 2);
  });
const scores = (g) =>
  g.teams.map((_, t) =>
    g.results
      .filter((r) => r.correct && r.team === t)
      .reduce((s, r) => s + 10 + 5 * r.bonuses.filter(Boolean).length, 0),
  );

const host = await open();
const p2 = await open();
host.s({ t: 'join', id: 'H', name: 'Host', team: 0 });
p2.s({ t: 'join', id: 'P', name: 'Pat', team: 1 });
host.s({ t: 'load', set: deck });
host.s({ t: 'config', wpm: 600 });
await until(() => host.latest?.total === 2 && host.latest.players.P);
check('first joiner is host and deck loaded', host.latest.hostId === 'H');
p2.s({ t: 'start' });
await wait(100);
check('non-host cannot start', host.latest.phase === 'lobby');
host.s({ t: 'start' });
await until(() => p2.latest.phase === 'reading');
await wait(300);
check(
  'answer redacted for player, visible to host',
  p2.latest.question.answer === '' && host.latest.question.answer === 'ROMA',
);
const t0 = performance.now();
p2.s({ t: 'buzz', id: 'P' });
host.s({ t: 'buzz', id: 'H' });
await until(() => p2.latest.phase === 'buzzed');
check(
  `first buzz wins (round trip ${(performance.now() - t0).toFixed(0)} ms)`,
  p2.latest.buzz.player === 'P' && p2.latest.buzz.word >= 2,
);
host.s({ t: 'answer', id: 'P', text: 'roma' });
await wait(100);
check('host cannot answer for a player', p2.latest.phase === 'buzzed');
p2.s({ t: 'answer', id: 'P', text: 'Athens' });
await until(() => p2.latest.phase === 'reading');
check('wrong answer locks the team and resumes', p2.latest.locked.includes(1));
host.s({ t: 'buzz', id: 'H' });
await until(() => host.latest.phase === 'buzzed');
host.s({ t: 'answer', id: 'H', text: 'Roma' });
await until(() => host.latest.phase === 'bonus');
check(
  'tossup answer revealed, bonus answer still hidden',
  p2.latest.question.answer === 'ROMA' && p2.latest.question.bonuses[0].a === '',
);
host.s({ t: 'bonus', correct: true });
await until(() => host.latest.phase === 'dead');
check('scores 15 / 0 / 0', JSON.stringify(scores(host.latest)) === '[15,0,0]');
p2.close();
const p2b = await open();
p2b.s({ t: 'join', id: 'P', name: 'Pat' });
await until(() => p2b.latest?.players?.P);
check('reconnect keeps team and game state', p2b.latest.players.P.team === 1 && p2b.latest.phase === 'dead');
host.close();
p2b.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
