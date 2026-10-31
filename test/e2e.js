// End-to-end test: runs the server in-process and plays full games with simulated socket clients.
process.env.TIME_SCALE = process.env.TIME_SCALE || '0.03';
process.env.GRACE_MS = '250'; process.env.OFFLINE_WAIT_MS = '400';
const assert = require('assert');
const { io } = require('socket.io-client');
const { server, rooms, makePairs, familyFilter } = require('../server');
const P = require('../prompts');

const PORT = 4797; const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✔', msg); };

// mode: 'auto' answers "<name> quip N", 'same' answers the same text, 'silent' never answers, 'safety' uses safety quips
function client(name, opts = {}) {
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { s, name, pid: opts.pid || ('t' + Math.random().toString(36).slice(2, 12)), st: null, states: [], kicked: null, forced: 0, roles: [],
    mode: opts.mode || 'auto', vote: opts.vote !== false, pick: opts.pick || 'first', answerText: opts.answerText, results: [], finals: [], ends: 0 };
  s.on('state', st => { c.st = st; c.states.push(st.phase); react(c); });
  s.on('kicked', k => { c.kicked = k; });
  s.on('force', () => { c.forced++; });
  s.on('role', r => c.roles.push(r));
  return c;
}
let n = 0;
function react(c) {
  const st = c.st;
  if (st.phase === 'answer' && st.answer && st.role === 'player' && c.mode !== 'silent') {
    for (const p of st.answer.mine) {
      if (p.answer || (c.sent && c.sent.has(p.id))) continue;
      (c.sent = c.sent || new Set()).add(p.id);
      const text = c.answerText || (c.mode === 'same' ? 'great minds think alike' : `${c.name} quip ${++n}`);
      setTimeout(() => c.s.emit('answer', { promptId: p.id, text, safety: c.mode === 'safety', phaseId: st.game.phaseId }, () => {}), 5 + Math.random() * 30);
    }
  }
  if (st.phase === 'vote' && st.match && !st.match.inIt && !st.match.myVote && c.vote && st.role !== 'tv') {
    const key = c.pick === 'first' ? st.match.answers[0].key : st.match.answers[Math.random() < .5 ? 0 : 1].key;
    const vk = st.game.phaseId; if (c.lastVote === vk) return; c.lastVote = vk;
    setTimeout(() => c.s.emit('vote', { choice: key }, () => {}), 5 + Math.random() * 20);
  }
  if (st.phase === 'fvote' && st.final && !st.final.myVote && c.vote && st.role !== 'tv') {
    const vk = st.game.phaseId; if (c.lastVote === vk) return; c.lastVote = vk;
    const opts = st.final.answers.filter(a => !a.mine).map(a => a.key).slice(0, 3);
    if (opts.length) setTimeout(() => c.s.emit('vote', { choice: opts }, () => {}), 5 + Math.random() * 20);
  }
  if (st.phase === 'result' && st.match?.result) { const k = st.game.phaseId; if (c.lastRes !== k) { c.lastRes = k; c.results.push({ ...st.match, round: st.game.round }); } }
  if (st.phase === 'fresult' && st.final?.result) { const k = st.game.phaseId; if (c.lastF !== k) { c.lastF = k; c.finals.push(st.final); } }
  if (st.phase === 'end') { const k = st.game.id; if (c.lastEnd !== k) { c.lastEnd = k; c.ends++; } }
}
const emitAck = (c, ev, data) => new Promise(r => c.s.emit(ev, data, r));
async function waitFor(fn, ms = 15000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(20); }
  throw new Error('Timed out waiting for ' + label);
}
async function connect(c) { await new Promise(r => c.s.on('connect', r)); return c; }
async function makeRoom(nPlayers, opts = {}) {
  const host = await connect(client('Host', opts.host || {}));
  const res = await emitAck(host, 'create', { name: 'Host', avatar: { emoji: '🦖', color: '#ff6b5b' }, playerId: host.pid });
  assert.ok(res.ok, 'create ok');
  const all = [host];
  for (let i = 1; i < nPlayers; i++) {
    const c = await connect(client('P' + i, (opts.each && opts.each(i)) || {}));
    const r = await emitAck(c, 'join', { code: res.code, name: 'P' + i, avatar: { emoji: '🦕', color: '#5ad1a7' }, playerId: c.pid });
    assert.ok(r.ok, 'join ok ' + (r.error || '')); all.push(c);
  }
  await waitFor(() => all.every(c => c.st && c.st.players.length === nPlayers), 4000, 'lobby sync');
  return { code: res.code, host, all };
}
const close = (cs) => cs.forEach(c => c.s.close());

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log('Rochasaurus Rex e2e');

  // --- pairing ---
  for (let k = 3; k <= 10; k++) {
    const ids = Array.from({ length: k }, (_, i) => 'id' + i);
    for (let trial = 0; trial < 30; trial++) {
      const pairs = makePairs(ids);
      assert.strictEqual(pairs.length, k);
      const cnt = Object.fromEntries(ids.map(i => [i, 0])); const seen = new Set();
      for (const [a, b] of pairs) { assert.notStrictEqual(a, b); cnt[a]++; cnt[b]++; const key = [a, b].sort().join(); assert.ok(!seen.has(key), 'dup pair'); seen.add(key); }
      assert.ok(Object.values(cnt).every(v => v === 2));
    }
  }
  ok(true, 'pairing: 3–10 players → every player gets exactly 2 prompts, every prompt has 2 different players, no repeat pairs');

  // --- prompt library ---
  const all = [...P.FAMILY, ...P.SPICY].map(p => p.toLowerCase());
  ok(P.FAMILY.length >= 200 && new Set(all).size === all.length, `prompt library: ${P.FAMILY.length} family + ${P.SPICY.length} spicy + ${P.FINALS.length} finals, no duplicates`);
  ok(!/jackbox|quiplash|quiplash/i.test(require('fs').readFileSync(require.resolve('../prompts')) + require('fs').readFileSync(require.resolve('../server'))), 'no third-party game names in prompts/server');
  ok(familyFilter('what the hell, damn it') !== 'what the hell, damn it' && familyFilter('hello shell') === 'hello shell', 'family filter masks bad words but not innocent ones');

  // --- full 3-player game: sweeps + scoring ---
  {
    const { host, all: cs, code } = await makeRoom(3);
    await emitAck(host, 'custom', 'The real reason Mike hides snacks');
    await emitAck(cs[1], 'custom', 'A terrible name for a church potluck dish');
    await waitFor(() => host.st.customCount === 2, 2000, 'custom prompts');
    ok(true, 'custom prompts are accepted in the lobby');
    const r = await emitAck(host, 'start');
    ok(r.ok, '3 players can start');
    await waitFor(() => cs.every(c => c.st.phase === 'answer'), 5000, 'answer phase');
    const texts = cs.flatMap(c => c.st.answer.mine.map(m => m.text));
    ok(texts.some(t => /snacks/.test(t)) && texts.some(t => /potluck/.test(t)), 'custom prompts are dealt in round 1');
    ok(cs.every(c => c.st.answer.mine.length === 2), 'each player got 2 prompts in round 1');
    await waitFor(() => cs.every(c => c.ends === 1), 30000, 'game end');
    const rs = host.results; // 3 matchups per round, 2 rounds
    ok(rs.length === 6, `6 head-to-head matchups were played (${rs.length})`);
    const r1 = rs.find(x => x.round === 1 && x.result.sweep);
    ok(r1 && r1.result.points[r1.result.sweep] === 1250, 'round 1 clean sweep = 1000 + 250 EXTINCTION bonus');
    const r2 = rs.find(x => x.round === 2 && x.result.sweep);
    ok(r2 && r2.result.points[r2.result.sweep] === 2500, 'round 2 is double points: 2000 + 500 sweep bonus');
    ok(rs.every(x => x.answers.every(a => a.authorId)), 'authors are revealed on every result');
    const f = host.finals[0];
    ok(f && f.answers.length === 3 && f.maxVotes === 3, 'final round: everyone answers one prompt, 3 votes each');
    const total = Object.values(f.result.votes).reduce((a, b) => a + b, 0);
    ok(total === 6, `final: each of 3 players cast 2 votes (can't self-vote, only 2 others) → 6 total (${total})`);
    ok(f.result.fave.length >= 1 && f.result.fave.every(k => f.result.points[k] === f.result.votes[k] * 400 + 500), 'final scoring: 400 per vote + 500 crowd-favorite bonus');
    const end = host.st;
    ok(end.phase === 'end' && end.scores.length === 3 && end.scores[0].score >= end.scores[2].score, 'end screen has sorted final scores');
    ok(end.history.length === 6, 'game history kept for "top quips"');
    // play again
    host.s.emit('lobby');
    await waitFor(() => cs.every(c => c.st.phase === 'lobby' && !c.st.game), 3000, 'back to lobby');
    ok(true, 'play again returns everyone to the lobby');
    const again = await emitAck(host, 'start');
    ok(again.ok, 'a second game can start in the same room');
    await waitFor(() => cs.every(c => c.st.phase === 'answer'), 5000);
    const t2 = cs.flatMap(c => c.st.answer.mine.map(m => m.text));
    ok(!t2.some(t => texts.includes(t)), 'prompts are not repeated in the next game');
    close(cs); void code;
  }

  // --- 10 players + audience + overflow + late joiner ---
  {
    const { host, all: cs, code } = await makeRoom(10, { each: () => ({ pick: 'random' }) });
    const extra = await connect(client('Extra'));
    const jr = await emitAck(extra, 'join', { code, name: 'Extra', playerId: extra.pid });
    ok(jr.ok && jr.role === 'audience', 'the 11th person joins as audience (room full)');
    const r = await emitAck(host, 'start'); ok(r.ok, '10 players can start');
    const late = await connect(client('Late'));
    const lr = await emitAck(late, 'join', { code, name: 'Late', playerId: late.pid });
    ok(lr.ok && lr.role === 'audience', 'late joiners become audience mid-game');
    await waitFor(() => host.st.phase === 'answer');
    ok(cs.every(c => c.st.answer.mine.length === 2), '10 players: everyone got 2 prompts');
    await waitFor(() => host.results.length >= 1, 20000, 'first result');
    const m = host.results[0];
    ok(m.audienceVotes === 2 && (m.result.counts[m.answers[0].key].audience + m.result.counts[m.answers[1].key].audience) === 2, 'audience votes are counted');
    const tot = m.result.points[m.answers[0].key] + m.result.points[m.answers[1].key];
    ok(tot >= 1000 && tot <= 1250, `vote-share points split the 1000-point pool (${tot})`);
    await waitFor(() => cs.every(c => c.ends === 1), 60000, '10p game end');
    ok(host.results.length === 20, '10 players: 20 matchups over 2 rounds');
    ok(host.finals[0].answers.length === 10, '10 players: 10 answers in the Last Roar');
    host.s.emit('lobby');
    await waitFor(() => host.st.phase === 'lobby');
    ok(host.st.players.length === 10 && host.st.audience.length === 2, 'play again keeps audience when the room is full');
    close([...cs, extra, late]);
  }

  // --- safety quips on timeout, jinx, filter ---
  {
    const { host, all: cs } = await makeRoom(4, { each: (i) => (i === 3 ? { mode: 'silent' } : {}) });
    const r = await emitAck(host, 'start'); ok(r.ok, '4 players start (one AFK)');
    await waitFor(() => host.results.length >= 1, 20000);
    ok(cs[3].forced >= 1, 'server sends "force" at the deadline so clients submit drafts');
    const afkId = cs[3].st.you;
    await waitFor(() => host.results.some(x => x.answers.some(a => a.authorId === afkId)), 20000);
    const mr = host.results.find(x => x.answers.some(a => a.authorId === afkId));
    const afk = mr.answers.find(a => a.authorId === afkId);
    ok(afk.safety && afk.timedOut && afk.text.length > 0, `timed-out player gets a safety quip: "${afk.text}"`);
    close(cs);
  }
  {
    const { host, all: cs } = await makeRoom(3, { each: () => ({ mode: 'same' }), host: { mode: 'same' } });
    await emitAck(host, 'start');
    await waitFor(() => host.results.length >= 3, 20000);
    ok(host.results.slice(0, 3).every(x => x.result.jinx && Object.values(x.result.points).every(p => p === 0)), 'identical answers = JINX, no points');
    const late = await connect(client('Latecomer'));
    const lr = await emitAck(late, 'join', { code: host.st.code, name: 'Latecomer', playerId: late.pid });
    ok(lr.role === 'audience', 'latecomer watches as audience');
    await waitFor(() => host.ends === 1, 30000, 'jinx game end');
    host.s.emit('lobby');
    await waitFor(() => late.st.phase === 'lobby' && late.st.role === 'player' && late.roles.includes('player'), 3000, 'promotion');
    ok(host.st.players.length === 4, 'play again promotes the audience to players when seats are free');
    late.mode = 'auto'; cs.forEach(c => { c.mode = 'auto'; });
    const r2 = await emitAck(host, 'start'); ok(r2.ok, 'next game starts with the promoted player');
    await waitFor(() => late.st.phase === 'answer' && late.st.answer.mine.length === 2, 5000, 'promoted gets prompts');
    ok(true, 'promoted player is dealt prompts');
    close([...cs, late]);
  }
  {
    const { host, all: cs } = await makeRoom(3, { each: () => ({ answerText: 'what the hell' }) });
    await emitAck(host, 'start');
    await waitFor(() => host.st.phase === 'vote', 20000);
    const shown = host.results.length ? host.results[0] : host.st.match;
    const txt = shown.answers.map(a => a.text).join('|');
    ok(!/hell/.test(txt) && /#@\$%/.test(txt), 'family filter masks answers by default: ' + txt);
    close(cs);
  }

  // --- kick, rejoin, host handoff ---
  {
    const { host, all: cs, code } = await makeRoom(4);
    const victim = cs[3]; const vid = victim.st.you;
    host.s.emit('kick', vid);
    await waitFor(() => victim.kicked && host.st.players.length === 3, 3000, 'kick');
    ok(true, 'host can kick a player');
    const again = await connect(client('P3', { pid: victim.pid }));
    const rj = await emitAck(again, 'join', { code, name: 'P3', playerId: victim.pid });
    ok(rj.error, 'kicked players cannot rejoin: ' + rj.error);
    const r = await emitAck(host, 'start'); ok(r.ok, 'start with 3 after kick');
    await waitFor(() => host.st.phase === 'answer');
    // a player drops mid-game and rejoins with the same id
    const p1 = cs[1]; const pid = p1.pid; const meId = p1.st.you; p1.mode = 'silent'; p1.s.close();
    await sleep(150);
    const back = await connect(client('P1', { pid }));
    const rr = await emitAck(back, 'join', { code, playerId: pid });
    await waitFor(() => back.st, 3000);
    ok(rr.ok && rr.rejoined && back.st.role === 'player' && back.st.you === meId && back.st.game, 'a dropped player rejoins mid-game with their seat');
    await waitFor(() => back.ends === 1 || host.ends === 1, 30000, 'game end after rejoin');
    ok(true, 'game finishes after a rejoin');
    // host leaves → host passes on
    host.s.emit('leave');
    await waitFor(() => cs[2].st.hostId && cs[2].st.hostId !== host.st.you, 3000, 'host handoff');
    ok(true, 'host role passes to another player when the host leaves');
    close([...cs, again, back]);
  }

  // --- lobby rules ---
  {
    const { host, all: cs } = await makeRoom(2);
    const r = await emitAck(host, 'start');
    ok(r.error, 'cannot start with 2 players: ' + r.error);
    cs[1].s.emit('settings', { pack: 'spicy' });
    await sleep(100);
    ok(host.st.settings.pack === 'family', 'only the host can change settings');
    host.s.emit('settings', { pack: 'spicy', pace: 'hasty', filter: false });
    await waitFor(() => cs[1].st.settings.pack === 'spicy' && cs[1].st.settings.pace === 'hasty' && cs[1].st.settings.filter === false, 2000);
    ok(true, 'host settings sync to everyone');
    const tv = await connect(client('TV'));
    const w = await emitAck(tv, 'watch', { code: host.st.code });
    await waitFor(() => tv.st, 2000);
    ok(w.ok && tv.st.role === 'tv' && tv.st.players.length === 2, 'big-screen view can watch a room');
    close([...cs, tv]);
  }

  // --- http ---
  const h = await fetch(URL + '/healthz').then(r => r.json());
  ok(h.ok, '/healthz responds');
  const page = await fetch(URL + '/r/ABCD').then(r => r.text());
  ok(page.includes('Rochasaurus'), '/r/CODE serves the app');

  console.log(`\n${passed} checks passed ✅`);
  server.close(); for (const r of rooms.values()) clearTimeout(r.timer);
  process.exit(0);
})().catch(e => { console.error('\n❌', e); process.exit(1); });
