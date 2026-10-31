'use strict';
// Rochasaurus Rex: a quip-off party game. Two players answer each prompt, everyone else votes.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const P = require('./prompts');

const PORT = process.env.PORT || 4848;
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 3);
const MAX_PLAYERS = 10;
const MAX_AUDIENCE = 100;
const GRACE_MS = Number(process.env.GRACE_MS || 1500);   // after a deadline, wait for clients to send typed drafts
const OFFLINE_WAIT_MS = Number(process.env.OFFLINE_WAIT_MS || 4000);
const TS = () => Number(process.env.TIME_SCALE || 1);   // tests speed every timer up

// seconds, before pace + TIME_SCALE
const T = { intro: 4, answer: 80, finalAnswer: 55, vote: 20, result: 7, finalVote: 30, finalResult: 11, scores: 9 };
const PACES = { chill: 1.5, normal: 1, hasty: 0.7 };
const PACKS = { family: 'Family Classics', spicy: 'Family + Hot Sauce' };
const MATCH_POOL = [0, 1000, 2000];       // points shared per matchup in round 1 / 2
const SWEEP_BONUS = [0, 250, 500];         // "EXTINCTION!" bonus for taking every vote
const FINAL_VOTE_PTS = 400;
const FINAL_VOTES = 3;
const FINAL_FAVE_BONUS = 500;
const MAX_ANSWER = 80;
const MAX_CUSTOM_EACH = 3;

const AVATAR_EMOJI = ['🦖','🦕','🐊','🐢','🦎','🐉','🐲','🥚','🌋','🦴','🌵','🤠','🐸','🦊','🐼','🐙','🦄','🐧'];
const AVATAR_COLORS = ['#ff6b5b','#ffb238','#ffe066','#5ad1a7','#4cc9f0','#7b8cff','#c77dff','#ff7eb6','#9bdb4d','#f4a261'];

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get(['/health', '/healthz'], (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get(['/r/:code', '/tv', '/tv/:code'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 15000 });
/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- helpers ----------
const CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rid = () => Math.random().toString(36).slice(2, 10);

// Family filter: masks common profanity with grawlix so the game stays clean.
const BAD = /\b(f+u+c+k\w*|sh+i+t+\w*|bullshit\w*|bitch\w*|asshole\w*|ass(es)?|bastard\w*|damn\w*|goddamn\w*|hell|dick(s|head)?|cock(s)?|cunt\w*|slut\w*|whore\w*|porn\w*|nigg\w*|fag\w*|retard\w*|crap\w*|piss\w*|wtf|stfu|boob(s|ies)?|tits?|titties|penis\w*|vagina\w*|sex|sexy|horny|douche\w*|jackass|dumbass|wh0re|f\*ck|sh\*t)\b/gi;
const GRAWLIX = '#@$%&!';
function familyFilter(s) { return s.replace(BAD, (w) => Array.from(w, (_, i) => GRAWLIX[i % GRAWLIX.length]).join('')); }
function cleanLine(s, max, filter) {
  let t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (filter) t = familyFilter(t);
  return t;
}
const cleanName = (s) => cleanLine(s, 16, true);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Pair prompts so that every player answers exactly 2 prompts and every prompt has exactly 2 different
 * players. Seat players around a circle; prompt i goes to seats i and i+1. Works for any n >= 3, and
 * nobody faces the same opponent twice in a round.
 */
function makePairs(ids) {
  const o = shuffle(ids); const n = o.length;
  if (n < 2) return [];
  if (n === 2) return [[o[0], o[1]]];
  return o.map((id, i) => [id, o[(i + 1) % n]]);
}

// ---------- room/state ----------
function makeRoom() {
  const code = newCode();
  const r = {
    code, hostId: null, phase: 'lobby', players: new Map(), audience: new Map(), sockets: new Map(),
    settings: { pack: 'family', pace: 'normal', filter: true },
    custom: [], used: new Set(), game: null, timer: null, created: Date.now(),
  };
  rooms.set(code, r);
  return r;
}
function makeMember(data) {
  const id = (data && typeof data.playerId === 'string' && /^[a-z0-9-]{8,40}$/i.test(data.playerId)) ? data.playerId : 'p' + rid() + Date.now().toString(36);
  const av = (data && data.avatar) || {};
  return {
    id, name: cleanName(data && data.name) || 'Dino',
    avatar: { emoji: AVATAR_EMOJI.includes(av.emoji) ? av.emoji : AVATAR_EMOJI[0], color: AVATAR_COLORS.includes(av.color) ? av.color : AVATAR_COLORS[0] },
    socketId: null, connected: false, dropTimer: null,
  };
}
const connectedPlayers = (r) => [...r.players.values()].filter(p => p.connected);
const dur = (r, secs) => Math.max(200, Math.round(secs * 1000 * (PACES[r.settings.pace] || 1) * TS()));
const fixedDur = (secs) => Math.max(150, Math.round(secs * 1000 * TS()));
function clearTimer(r) { if (r.timer) { clearTimeout(r.timer); r.timer = null; } if (r.offlineTimer) { clearTimeout(r.offlineTimer); r.offlineTimer = null; } }
function setPhase(r, phase, ms, next) {
  clearTimer(r);
  r.phase = phase;
  const g = r.game;
  if (g) { g.duration = ms || 0; g.deadline = ms ? Date.now() + ms : 0; g.phaseId = rid(); }
  if (ms && next) { const pid = g && g.phaseId; r.timer = setTimeout(() => { r.timer = null; if (!g || g.phaseId === pid) next(); }, ms); }
  sync(r);
}
function uniqueName(r, name, selfId) {
  const taken = new Set([...r.players.values(), ...r.audience.values()].filter(x => x.id !== selfId).map(x => x.name.toLowerCase()));
  let n = name, k = 2; while (taken.has(n.toLowerCase())) n = `${name.slice(0, 13)} ${k++}`;
  return n;
}
function nameOf(r, id) { const p = r.players.get(id) || r.audience.get(id) || (r.game && r.game.roster[id]); return p ? p.name : '???'; }

// ---------- prompts ----------
function drawPrompts(r, count, final) {
  const pool = final
    ? [...P.FINALS, ...(r.settings.pack === 'spicy' ? P.SPICY_FINALS : [])]
    : [...P.FAMILY, ...(r.settings.pack === 'spicy' ? P.SPICY : [])];
  let fresh = pool.filter(p => !r.used.has(p));
  if (fresh.length < count) { pool.forEach(p => r.used.delete(p)); fresh = pool.slice(); }
  const out = [];
  if (!final) {
    // custom prompts from the lobby go first, but at most half of a round so they spread out
    const customs = shuffle(r.custom.filter(c => !c.used));
    for (const c of customs.slice(0, Math.ceil(count / 2))) { if (out.length >= count) break; c.used = true; out.push({ text: c.text, by: c.by }); }
  }
  for (const t of shuffle(fresh)) { if (out.length >= count) break; r.used.add(t); out.push({ text: t, by: null }); }
  return shuffle(out);
}
function fillPlayer(r, text, exclude) {
  if (!text.includes('{player}')) return text;
  const roster = Object.values(r.game.roster);
  const others = roster.filter(p => !exclude.includes(p.id));
  return text.split('{player}').join((pick(others.length ? others : roster) || { name: 'Rex' }).name);
}

// ---------- game flow ----------
function startGame(r) {
  for (const p of [...r.players.values()]) if (!p.connected) r.players.delete(p.id);
  const ids = connectedPlayers(r).map(p => p.id);
  r.game = {
    id: rid(), round: 0, totalRounds: 3, ids,
    roster: Object.fromEntries(ids.map(id => { const p = r.players.get(id); return [id, { id, name: p.name, avatar: p.avatar }]; })),
    scores: Object.fromEntries(ids.map(id => [id, 0])), roundGain: {},
    prompts: [], order: [], mi: 0, deadline: 0, duration: 0, phaseId: null, history: [],
  };
  nextRound(r);
}
function nextRound(r) {
  const g = r.game;
  g.round++;
  g.roundGain = Object.fromEntries(g.ids.map(id => [id, 0]));
  const final = g.round === g.totalRounds;
  // players kicked mid-game are no longer dealt prompts
  const live = g.ids.filter(id => r.players.has(id));
  g.live = live;
  if (final) {
    const [pr] = drawPrompts(r, 1, true);
    g.prompts = [{ id: rid(), text: fillPlayer(r, pr.text, []), by: null, players: live.slice(), answers: {} }];
  } else {
    const pairs = makePairs(live);
    const drawn = drawPrompts(r, pairs.length, false);
    g.prompts = pairs.map((pair, i) => ({ id: rid(), text: fillPlayer(r, drawn[i].text, pair), by: drawn[i].by, players: pair, answers: {} }));
  }
  g.order = shuffle(g.prompts.map((_, i) => i)); g.mi = 0;
  setPhase(r, 'intro', fixedDur(T.intro), () => startAnswering(r));
}
function startAnswering(r) {
  const g = r.game; const final = g.round === g.totalRounds;
  setPhase(r, 'answer', dur(r, final ? T.finalAnswer : T.answer), () => {
    io.to(r.code).emit('force', { phaseId: g.phaseId });
    const pid = g.phaseId;
    r.timer = setTimeout(() => { if (g.phaseId === pid && r.phase === 'answer') finishAnswering(r); }, GRACE_MS);
  });
  checkAnswersDone(r);
}
function promptsFor(g, id) { return g.prompts.filter(p => p.players.includes(id)); }
function allAnswered(g, ids) { return ids.every(id => promptsFor(g, id).every(p => p.answers[id])); }
function checkAnswersDone(r) {
  const g = r.game; if (r.phase !== 'answer') return;
  if (allAnswered(g, g.live)) { clearTimer(r); const pid = g.phaseId; r.timer = setTimeout(() => { if (g.phaseId === pid) finishAnswering(r); }, 700); return; }
  // everyone still online is done: don't make them wait out the clock for someone who left
  const online = g.live.filter(id => r.players.get(id)?.connected);
  if (online.length && allAnswered(g, online) && !r.offlineTimer) {
    const pid = g.phaseId;
    r.offlineTimer = setTimeout(() => { r.offlineTimer = null; if (g.phaseId === pid && r.phase === 'answer' && allAnswered(g, g.live.filter(id => r.players.get(id)?.connected))) finishAnswering(r); }, OFFLINE_WAIT_MS);
  }
}
function safetyQuip(g, prompt) {
  const taken = new Set(Object.values(prompt.answers).map(a => norm(a.text)));
  const opts = P.SAFETY.filter(s => !taken.has(norm(s)));
  return pick(opts.length ? opts : P.SAFETY);
}
function recordAnswer(r, playerId, promptId, text, safety) {
  const g = r.game; if (!g || r.phase !== 'answer') return { error: 'Answer time is over.' };
  const pr = g.prompts.find(p => p.id === promptId);
  if (!pr || !pr.players.includes(playerId)) return { error: 'That prompt isn\'t yours.' };
  if (pr.answers[playerId]) return { error: 'Already answered.' };
  let t = safety ? safetyQuip(g, pr) : cleanLine(text, MAX_ANSWER, r.settings.filter);
  if (!t) return { error: 'Type something first!' };
  pr.answers[playerId] = { text: t, safety: !!safety };
  return { ok: true, text: t };
}
function finishAnswering(r) {
  const g = r.game;
  for (const pr of g.prompts) for (const id of pr.players) if (!pr.answers[id]) pr.answers[id] = { text: safetyQuip(g, pr), safety: true, timedOut: true };
  if (g.round === g.totalRounds) return startFinalVote(r);
  startMatchup(r);
}

// ---------- head-to-head voting ----------
function currentPrompt(g) { return g.prompts[g.order[g.mi]]; }
function eligibleVoters(r, pr) { return connectedPlayers(r).filter(p => g_has(r, p.id) && !pr.players.includes(p.id)).map(p => p.id); }
function g_has(r, id) { return r.game && r.game.ids.includes(id); }
function startMatchup(r) {
  const g = r.game; const pr = currentPrompt(g);
  pr.votes = {}; pr.side = shuffle(pr.players.slice()); pr.result = null;
  const [a, b] = pr.side;
  if (norm(pr.answers[a].text) && norm(pr.answers[a].text) === norm(pr.answers[b].text)) {
    pr.jinx = true; return showResult(r);
  }
  setPhase(r, 'vote', dur(r, T.vote), () => showResult(r));
  checkVotesDone(r);
}
function castVote(r, voterId, choice, isAudience) {
  const g = r.game;
  if (r.phase === 'vote') {
    const pr = currentPrompt(g);
    if (pr.players.includes(voterId)) return { error: 'No voting in your own matchup!' };
    if (!pr.players.includes(choice)) return { error: 'Pick one of the two answers.' };
    if (pr.votes[voterId]) return { error: 'Already voted.' };
    pr.votes[voterId] = { choice, audience: !!isAudience };
    checkVotesDone(r);
    return { ok: true };
  }
  if (r.phase === 'fvote') {
    const pr = g.prompts[0];
    const list = Array.isArray(choice) ? [...new Set(choice.map(String))] : [];
    if (!list.length || list.length > FINAL_VOTES) return { error: `Pick up to ${FINAL_VOTES} answers.` };
    if (list.some(id => !pr.answers[id])) return { error: 'Unknown answer.' };
    if (!isAudience && list.includes(voterId)) return { error: 'You can\'t vote for yourself!' };
    if (pr.votes[voterId]) return { error: 'Already voted.' };
    pr.votes[voterId] = { choice: list, audience: !!isAudience };
    checkVotesDone(r);
    return { ok: true };
  }
  return { error: 'Not voting right now.' };
}
function checkVotesDone(r) {
  const g = r.game;
  const pr = r.phase === 'fvote' ? g.prompts[0] : currentPrompt(g);
  const voters = r.phase === 'fvote' ? connectedPlayers(r).filter(p => g_has(r, p.id)).map(p => p.id) : eligibleVoters(r, pr);
  sync(r);
  if (voters.length && voters.every(id => pr.votes[id])) {
    const pid = g.phaseId; clearTimer(r);
    r.timer = setTimeout(() => { if (g.phaseId === pid) (r.phase === 'fvote' ? showFinalResult(r) : showResult(r)); }, 900);
  }
}
// Audience votes count as one extra voter, split by how the audience voted.
function tally(pr, options) {
  const w = Object.fromEntries(options.map(o => [o, 0])); const counts = Object.fromEntries(options.map(o => [o, { players: 0, audience: 0, voters: [] }]));
  let aud = 0; const audCounts = Object.fromEntries(options.map(o => [o, 0]));
  for (const [vid, v] of Object.entries(pr.votes || {})) {
    const choices = Array.isArray(v.choice) ? v.choice : [v.choice];
    for (const c of choices) {
      if (!(c in w)) continue;
      if (v.audience) { aud++; audCounts[c]++; counts[c].audience++; }
      else { w[c] += 1; counts[c].players++; counts[c].voters.push(vid); }
    }
  }
  return { w, counts, aud, audCounts };
}
function showResult(r) {
  const g = r.game; const pr = currentPrompt(g); const round = g.round;
  const [a, b] = pr.side;
  const res = { jinx: !!pr.jinx, points: { [a]: 0, [b]: 0 }, pct: { [a]: 0, [b]: 0 }, counts: {}, sweep: null };
  if (!pr.jinx) {
    const { w, counts, aud, audCounts } = tally(pr, [a, b]);
    if (aud) { const per = 1 / aud; for (const o of [a, b]) w[o] += audCounts[o] * per; }
    const total = w[a] + w[b];
    for (const o of [a, b]) {
      const share = total ? w[o] / total : 0;
      let pts = Math.round(MATCH_POOL[round] * share / 10) * 10;
      if (pr.answers[o].safety) pts = Math.round(pts / 2 / 10) * 10; // safety quips earn half
      res.points[o] = pts; res.pct[o] = Math.round(share * 100); res.counts[o] = counts[o];
    }
    for (const o of [a, b]) {
      const other = o === a ? b : a;
      if (total > 0 && w[other] === 0 && (counts[o].players + counts[o].audience) >= 1) { res.sweep = o; res.points[o] += SWEEP_BONUS[round]; }
    }
  }
  for (const o of [a, b]) { if (g.scores[o] != null) { g.scores[o] += res.points[o]; g.roundGain[o] += res.points[o]; } }
  pr.result = res;
  g.history.push({ round, prompt: pr.text, answers: [a, b].map(id => ({ id, text: pr.answers[id].text, points: res.points[id] })) });
  setPhase(r, 'result', fixedDur(T.result + (res.sweep ? 1.5 : 0)), () => afterResult(r));
}
function afterResult(r) {
  const g = r.game;
  if (g.mi < g.order.length - 1) { g.mi++; return startMatchup(r); }
  setPhase(r, 'scores', fixedDur(T.scores), () => nextRound(r));
}

// ---------- the Last Roar (final round) ----------
function startFinalVote(r) {
  const g = r.game; const pr = g.prompts[0];
  pr.votes = {}; pr.side = shuffle(Object.keys(pr.answers));
  setPhase(r, 'fvote', dur(r, T.finalVote), () => showFinalResult(r));
  checkVotesDone(r);
}
function showFinalResult(r) {
  const g = r.game; const pr = g.prompts[0];
  const opts = pr.side;
  const { w, counts, aud, audCounts } = tally(pr, opts);
  // the audience is worth FINAL_VOTES votes as a bloc
  // the whole audience counts as one extra voter (with the same 3 votes), split by how they voted
  if (aud) { const audVoters = Object.values(pr.votes).filter(v => v.audience).length; for (const o of opts) w[o] += audCounts[o] / audVoters; }
  const max = Math.max(0, ...opts.map(o => w[o]));
  const res = { points: {}, votes: {}, counts, fave: [] };
  for (const o of opts) {
    let pts = Math.round(w[o] * FINAL_VOTE_PTS / 10) * 10;
    if (pr.answers[o].safety) pts = Math.round(pts / 2 / 10) * 10;
    if (max > 0 && w[o] === max) { pts += FINAL_FAVE_BONUS; res.fave.push(o); }
    res.points[o] = pts; res.votes[o] = Math.round(w[o] * 10) / 10;
    if (g.scores[o] != null) { g.scores[o] += pts; g.roundGain[o] += pts; }
  }
  pr.result = res;
  setPhase(r, 'fresult', fixedDur(T.finalResult), () => setPhase(r, 'end', 0));
}

// ---------- per-viewer state ----------
function publicMember(p) { return { id: p.id, name: p.name, avatar: p.avatar, connected: p.connected }; }
function viewFor(r, viewer) {
  const g = r.game; const you = viewer.memberId; const role = viewer.kind;
  const v = {
    code: r.code, hostId: r.hostId, you, role, phase: r.phase, settings: r.settings, packs: PACKS,
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, serverNow: Date.now(),
    players: [...r.players.values()].map(publicMember),
    audience: [...r.audience.values()].map(publicMember),
    customCount: r.custom.filter(c => !c.used).length,
    myCustom: r.custom.filter(c => c.by === you && !c.used).map(c => c.text),
  };
  if (!g) return v;
  v.game = { id: g.id, round: g.round, totalRounds: g.totalRounds, deadline: g.deadline, duration: g.duration, phaseId: g.phaseId, roster: g.roster };
  v.scores = Object.entries(g.scores).filter(([id]) => r.players.has(id) || r.phase === 'end').map(([id, s]) => ({ id, score: s, gain: g.roundGain[id] || 0 })).sort((x, y) => y.score - x.score);
  if (r.phase === 'intro' || r.phase === 'answer') {
    const final = g.round === g.totalRounds;
    v.answer = {
      final,
      mine: role === 'player' ? promptsFor(g, you).map(p => ({ id: p.id, text: p.text, answer: p.answers[you]?.text || null, safety: !!p.answers[you]?.safety })) : [],
      done: g.live.filter(id => promptsFor(g, id).every(p => p.answers[id])),
      waiting: g.live.filter(id => !promptsFor(g, id).every(p => p.answers[id])),
      promptCount: g.prompts.length,
    };
  }
  if (r.phase === 'vote' || r.phase === 'result') {
    const pr = currentPrompt(g); const reveal = r.phase === 'result';
    const voters = eligibleVoters(r, pr);
    v.match = {
      index: g.mi, total: g.order.length, prompt: pr.text, by: pr.by ? nameOf(r, pr.by) : null,
      inIt: pr.players.includes(you), myVote: pr.votes[you]?.choice || null,
      voted: Object.keys(pr.votes).filter(id => !pr.votes[id].audience), votedCount: Object.keys(pr.votes).length,
      voterCount: voters.length, audienceVotes: Object.values(pr.votes).filter(x => x.audience).length,
      answers: pr.side.map(id => ({ key: id, text: pr.answers[id].text, mine: id === you,
        ...(reveal ? { authorId: id, safety: !!pr.answers[id].safety, timedOut: !!pr.answers[id].timedOut } : {}) })),
      result: reveal ? pr.result : null,
    };
  }
  if (r.phase === 'fvote' || r.phase === 'fresult' || r.phase === 'end') {
    const pr = g.prompts[0]; const reveal = r.phase !== 'fvote';
    v.final = {
      prompt: pr.text, maxVotes: FINAL_VOTES, myVote: pr.votes?.[you]?.choice || null,
      votedCount: Object.keys(pr.votes || {}).length, voterCount: connectedPlayers(r).filter(p => g_has(r, p.id)).length,
      answers: (pr.side || []).map(id => ({ key: id, text: pr.answers[id].text, mine: id === you,
        ...(reveal ? { authorId: id, safety: !!pr.answers[id].safety } : {}) })),
      result: reveal ? pr.result : null,
    };
  }
  if (r.phase === 'end') v.history = g.history;
  return v;
}
function sync(r) {
  for (const [sid, viewer] of r.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) { r.sockets.delete(sid); continue; }
    s.emit('state', viewFor(r, viewer));
  }
}

// ---------- sockets ----------
io.on('connection', (socket) => {
  let room = null; let me = null; let kind = null; // kind: player | audience | tv

  function bind(r, m, k) {
    room = r; me = m; kind = k;
    if (m) { m.socketId = socket.id; m.connected = true; if (m.dropTimer) { clearTimeout(m.dropTimer); m.dropTimer = null; } }
    socket.join(r.code);
    r.sockets.set(socket.id, { kind: k, memberId: m ? m.id : null });
    fixHost(r);
  }
  const ackFn = (a) => (typeof a === 'function' ? a : () => {});
  // re-read the viewer kind: play-again can promote audience members to players
  const K = () => { const v = room && room.sockets.get(socket.id); if (v) kind = v.kind; return kind; };
  const isHost = () => room && me && K() === 'player' && room.hostId === me.id;

  socket.on('create', (data, ack) => {
    const cb = ackFn(ack);
    const name = cleanName(data && data.name);
    if (!name) return cb({ error: 'Pick a nickname first.' });
    const r = makeRoom();
    const p = makeMember(data); r.players.set(p.id, p); r.hostId = p.id;
    bind(r, p, 'player');
    cb({ ok: true, code: r.code, you: p.id, role: 'player' });
    sync(r);
  });

  socket.on('join', (data, ack) => {
    const cb = ackFn(ack);
    const code = String(data && data.code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return cb({ error: 'No room with that code. Double-check it?' });
    const pid = String(data && data.playerId || '');
    const existing = pid && (r.players.get(pid) || r.audience.get(pid));
    if (existing) { // reconnect / refresh / rejoin
      if (existing.connected && existing.socketId && existing.socketId !== socket.id) {
        const old = io.sockets.sockets.get(existing.socketId);
        if (old) { old.emit('kicked', { reason: 'You opened this game in another tab.' }); old.leave(r.code); r.sockets.delete(old.id); }
      }
      if (data.name && r.phase === 'lobby') existing.name = uniqueName(r, cleanName(data.name) || existing.name, existing.id);
      const k = r.players.has(existing.id) ? 'player' : 'audience';
      bind(r, existing, k);
      cb({ ok: true, code, you: existing.id, role: k, rejoined: true });
      sync(r);
      if (r.phase === 'answer') checkAnswersDone(r);
      return;
    }
    if (r.wasKicked && r.wasKicked.has(pid)) return cb({ error: 'The host removed you from this room.' });
    const name = cleanName(data && data.name);
    if (!name) return cb({ error: 'Pick a nickname first.' });
    const m = makeMember(data); m.name = uniqueName(r, name, m.id);
    const asAudience = r.phase !== 'lobby' || r.players.size >= MAX_PLAYERS || (data && data.audience);
    if (asAudience) {
      if (r.audience.size >= MAX_AUDIENCE) return cb({ error: 'This room is packed, even the audience is full!' });
      r.audience.set(m.id, m); bind(r, m, 'audience');
      cb({ ok: true, code, you: m.id, role: 'audience' });
    } else {
      r.players.set(m.id, m);
      if (!r.hostId || !r.players.get(r.hostId)?.connected) r.hostId = m.id;
      bind(r, m, 'player');
      cb({ ok: true, code, you: m.id, role: 'player' });
    }
    sync(r);
  });

  socket.on('watch', (data, ack) => { // big-screen / TV view
    const cb = ackFn(ack);
    const r = rooms.get(String(data && data.code || '').toUpperCase().trim());
    if (!r) return cb({ error: 'No room with that code.' });
    bind(r, null, 'tv'); cb({ ok: true, code: r.code, role: 'tv' }); sync(r);
  });

  socket.on('settings', (s) => {
    if (!isHost() || room.phase !== 'lobby' || !s) return;
    if (PACKS[s.pack]) room.settings.pack = s.pack;
    if (PACES[s.pace]) room.settings.pace = s.pace;
    if (typeof s.filter === 'boolean') room.settings.filter = s.filter;
    sync(room);
  });

  socket.on('custom', (text, ack) => {
    const cb = ackFn(ack);
    if (!room || !me || room.phase !== 'lobby') return cb({ error: 'Add prompts in the lobby.' });
    const mine = room.custom.filter(c => c.by === me.id && !c.used);
    if (mine.length >= MAX_CUSTOM_EACH) return cb({ error: `Up to ${MAX_CUSTOM_EACH} prompts each. Save some for later!` });
    const t = cleanLine(text, 100, true);
    if (t.length < 4) return cb({ error: 'That prompt is a little short.' });
    if (room.custom.some(c => norm(c.text) === norm(t))) return cb({ error: 'Someone already added that one!' });
    room.custom.push({ text: t, by: me.id, used: false });
    cb({ ok: true }); sync(room);
  });
  socket.on('custom:remove', (i) => {
    if (!room || !me || room.phase !== 'lobby') return;
    const mine = room.custom.filter(c => c.by === me.id && !c.used);
    const c = mine[i]; if (c) { room.custom.splice(room.custom.indexOf(c), 1); sync(room); }
  });

  socket.on('kick', (id) => {
    if (!isHost() || id === me.id) return;
    const r = room;
    const target = r.players.get(id) || r.audience.get(id); if (!target) return;
    if (target.socketId) { const s = io.sockets.sockets.get(target.socketId); if (s) { s.emit('kicked', { reason: 'The host removed you from the room.' }); s.leave(r.code); r.sockets.delete(s.id); } }
    (r.wasKicked = r.wasKicked || new Set()).add(id);
    r.players.delete(id); r.audience.delete(id);
    r.custom = r.custom.filter(c => c.by !== id || c.used);
    if (r.game && r.phase === 'answer') checkAnswersDone(r);
    if (r.game && (r.phase === 'vote' || r.phase === 'fvote')) checkVotesDone(r); else sync(r);
  });

  socket.on('start', (_d, ack) => {
    const cb = ackFn(ack);
    if (!room || !me) return cb({ error: 'Not in a room.' });
    if (!isHost()) return cb({ error: 'Only the host can start.' });
    if (room.phase !== 'lobby') return cb({ error: 'Already started.' });
    const n = connectedPlayers(room).length;
    if (n < MIN_PLAYERS) return cb({ error: `Need at least ${MIN_PLAYERS} players (you have ${n}).` });
    cb({ ok: true }); startGame(room);
  });

  socket.on('answer', (data, ack) => {
    const cb = ackFn(ack);
    if (!room || !me || K() !== 'player' || !room.game) return cb({ error: 'Not playing.' });
    if (data && data.phaseId && data.phaseId !== room.game.phaseId) return cb({ error: 'Answer time is over.' });
    const res = recordAnswer(room, me.id, data && data.promptId, data && data.text, !!(data && data.safety));
    cb(res);
    if (res.ok) { sync(room); checkAnswersDone(room); }
  });

  socket.on('vote', (data, ack) => {
    const cb = ackFn(ack);
    if (!room || !me || !room.game || (K() !== 'player' && K() !== 'audience')) return cb({ error: 'Not in this game.' });
    const isAud = kind === 'audience' || !room.game.ids.includes(me.id);
    cb(castVote(room, me.id, data && data.choice, isAud));
  });

  socket.on('next', () => { // host can skip ahead on results/scores screens
    if (!isHost() || !room.game) return;
    const g = room.game;
    if (room.phase === 'intro') startAnswering(room);
    else if (room.phase === 'result') afterResult(room);
    else if (room.phase === 'scores') nextRound(room);
    else if (room.phase === 'fresult') setPhase(room, 'end', 0);
    void g;
  });

  socket.on('react', (emoji) => {
    if (!room || !me || typeof emoji !== 'string' || !['😂','🔥','💀','👏','😱','🦖'].includes(emoji)) return;
    const now = Date.now(); if (me.lastReact && now - me.lastReact < 250) return; me.lastReact = now;
    io.to(room.code).emit('react', { emoji, from: me.id });
  });

  socket.on('lobby', () => { // play again
    if (!isHost() || room.phase !== 'end') return;
    const r = room; clearTimer(r);
    r.phase = 'lobby'; r.game = null;
    for (const p of [...r.players.values()]) if (!p.connected) r.players.delete(p.id);
    for (const a of [...r.audience.values()]) { // promote the audience if there are seats
      if (!a.connected) { r.audience.delete(a.id); continue; }
      if (r.players.size < MAX_PLAYERS) {
        r.audience.delete(a.id); r.players.set(a.id, a);
        const v = r.sockets.get(a.socketId); if (v) v.kind = 'player';
        const s = io.sockets.sockets.get(a.socketId); if (s) s.emit('role', 'player');
      }
    }
    fixHost(r); sync(r);
  });

  socket.on('leave', () => { if (room) drop(true); });
  socket.on('disconnect', () => { if (room && (!me || me.socketId === socket.id)) drop(false); else if (room) room.sockets.delete(socket.id); });

  function drop(intentional) {
    const r = room, m = me, k = K();
    socket.leave(r.code); r.sockets.delete(socket.id);
    room = null; me = null; kind = null;
    if (!m) return;
    m.connected = false; m.socketId = null;
    const remove = () => {
      if (m.connected) return;
      if (k === 'audience') r.audience.delete(m.id);
      else if (r.phase === 'lobby') { r.players.delete(m.id); r.custom = r.custom.filter(c => c.by !== m.id || c.used); }
      fixHost(r); sync(r); cleanupMaybe(r);
    };
    if (intentional) remove(); else m.dropTimer = setTimeout(remove, 15000); // allow refresh/reconnect
    fixHost(r);
    if (r.phase === 'answer') checkAnswersDone(r);
    if (r.phase === 'vote' || r.phase === 'fvote') checkVotesDone(r); else sync(r);
    cleanupMaybe(r);
  }
});

function fixHost(r) {
  const host = r.players.get(r.hostId);
  if (host && host.connected) return;
  const next = connectedPlayers(r)[0];
  if (next) r.hostId = next.id; else if (!host) r.hostId = null;
}
function cleanupMaybe(r) {
  if (connectedPlayers(r).length || [...r.audience.values()].some(a => a.connected)) return;
  setTimeout(() => {
    if (rooms.get(r.code) === r && !connectedPlayers(r).length && ![...r.audience.values()].some(a => a.connected)) { clearTimer(r); rooms.delete(r.code); }
  }, 10 * 60 * 1000).unref();
}

if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`Rochasaurus Rex running on http://localhost:${PORT}`));
module.exports = { server, rooms, makePairs, familyFilter, tally };
