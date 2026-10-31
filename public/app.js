(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const EMOJIS = ['🦖','🦕','🐊','🐢','🦎','🐉','🐲','🥚','🌋','🦴','🌵','🤠','🐸','🦊','🐼','🐙','🦄','🐧'];
  const COLORS = ['#ff6b5b','#ffb238','#ffe066','#5ad1a7','#4cc9f0','#7b8cff','#c77dff','#ff7eb6','#9bdb4d','#f4a261'];
  const PACK_META = { family: { icon: '🦕', desc: '240 clean, silly prompts for all ages.' }, spicy: { icon: '🌶️', desc: 'Adds 60 sassier roast-y prompts. Still clean!' } };
  const PACES = [['chill', '🐢 Chill'], ['normal', '🦖 Normal'], ['hasty', '⚡ Hasty']];
  const REACTS = ['😂','🔥','💀','👏','😱','🦖'];
  const ROUND_INFO = {
    1: { title: 'Round 1', sub: 'Two prompts each. Make \'em laugh!' },
    2: { title: 'Round 2', sub: 'Double points! Bring the heat.' },
    3: { title: 'The Last Roar', sub: 'Everyone answers one prompt. 3 votes each!' },
  };
  const BUBBLES = ['Rawr! Welcome!', 'Tiny arms, big jokes!', 'Bring your best quips!', 'I\'m a Roch star!', 'Jurassic snark ahead!'];

  // ---------- identity ----------
  let playerId = sessionStorage.getItem('rrx-pid');
  if (!playerId) { playerId = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); sessionStorage.setItem('rrx-pid', playerId); }
  const profile = (() => { try { return JSON.parse(localStorage.getItem('rrx-profile') || 'null'); } catch { return null; } })() || {
    name: '', avatar: { emoji: EMOJIS[Math.floor(Math.random() * 6)], color: COLORS[Math.floor(Math.random() * COLORS.length)] },
  };
  const saveProfile = () => { try { localStorage.setItem('rrx-profile', JSON.stringify(profile)); } catch { /* ignore */ } };

  const TV = /^\/tv(\/|$)/.test(location.pathname);
  const urlCode = ((location.pathname.match(/^\/(?:r|tv)\/([A-Za-z]{4})/) || [])[1] || '').toUpperCase();
  if (TV) document.body.classList.add('tv');

  // ---------- state ----------
  const S = { st: null, prev: null, skew: 0, drafts: {}, viewKey: null, timerRAF: null, lastTick: -1, fx: {}, finalPicks: [], showPromptIdx: 0 };
  try { S.drafts = JSON.parse(sessionStorage.getItem('rrx-drafts') || '{}'); } catch { S.drafts = {}; }
  const saveDrafts = () => { try { sessionStorage.setItem('rrx-drafts', JSON.stringify(S.drafts)); } catch { /* ignore */ } };
  const socket = io({ transports: ['websocket', 'polling'] });

  // ---------- helpers ----------
  let toastT;
  function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
  function curtain(text, sub, sound) {
    const c = $('#curtain'); $('#curtain-text').textContent = text; $('#curtain-sub').textContent = sub || '';
    c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    if (sound) sound();
    clearTimeout(curtain.t); curtain.t = setTimeout(() => c.classList.add('hidden'), 1900);
  }
  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));
  }
  const member = (id) => {
    const st = S.st; if (!st) return null;
    return st.players.find(p => p.id === id) || st.audience.find(p => p.id === id) || (st.game && st.game.roster[id]) || null;
  };
  const pname = (id) => member(id)?.name || '???';
  function avatarHTML(av, cls = '') { av = av || { emoji: '❔', color: '#ccc' }; return `<span class="avatar ${cls}" style="background:${esc(av.color)}">${esc(av.emoji)}</span>`; }
  const avatarOf = (id, cls) => avatarHTML(member(id)?.avatar, cls);
  const isHost = () => S.st && S.st.hostId === S.st.you && S.st.role === 'player';
  const now = () => Date.now() + S.skew;
  const left = () => (S.st?.game?.deadline ? Math.max(0, S.st.game.deadline - now()) : 0);
  function setMusicFor(phase) {
    const m = { lobby: 'lobby', intro: 'play', answer: 'play', vote: 'vote', result: 'vote', fvote: 'vote', fresult: 'vote', scores: 'podium', end: 'podium' }[phase] || 'lobby';
    Sfx.music(m);
  }
  function confetti(n = 120) {
    const box = $('#confetti'); const cols = ['#ff6b5b', '#ffd43b', '#5ad1a7', '#4cc9f0', '#c77dff', '#ff7eb6', '#9bdb4d'];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      d.style.left = Math.random() * 100 + '%'; d.style.background = cols[i % cols.length];
      d.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px'); d.style.setProperty('--rot', (Math.random() * 1080 - 540) + 'deg');
      d.style.animationDelay = (Math.random() * 0.8) + 's'; d.style.animationDuration = (2.4 + Math.random() * 1.6) + 's';
      if (i % 3 === 0) d.className = 'round';
      box.appendChild(d); setTimeout(() => d.remove(), 5200);
    }
  }

  // ---------- home ----------
  function renderProfile() {
    const ap = $('#avatar-preview'); ap.textContent = profile.avatar.emoji; ap.style.background = profile.avatar.color;
    $('#emoji-picker').innerHTML = EMOJIS.map(e => `<button type="button" class="${e === profile.avatar.emoji ? 'sel' : ''}" data-e="${e}" aria-label="avatar ${e}">${e}</button>`).join('');
    $('#color-picker').innerHTML = COLORS.map(c => `<button type="button" class="${c === profile.avatar.color ? 'sel' : ''}" data-c="${c}" style="background:${c}" aria-label="color ${c}"></button>`).join('');
  }
  $('#emoji-picker').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; profile.avatar.emoji = b.dataset.e; saveProfile(); renderProfile(); Sfx.pop(); });
  $('#color-picker').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; profile.avatar.color = b.dataset.c; saveProfile(); renderProfile(); Sfx.pop(); });
  $('#avatar-preview').addEventListener('click', () => { profile.avatar = { emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] }; saveProfile(); renderProfile(); Sfx.pop(); });
  $('#name-input').value = profile.name;
  $('#name-input').addEventListener('input', e => { profile.name = e.target.value; saveProfile(); });

  if (urlCode && !TV) {
    $('#code-input').value = urlCode;
    $('#create-btn').classList.add('hidden');
    $('.or span').textContent = 'you were invited to room ' + urlCode;
    $('#join-form button').textContent = 'Join the herd →';
    $('#join-form button').classList.replace('btn-mint', 'btn-primary');
  }
  if (TV) { // big-screen setup: no nickname needed
    $('.profile-row').classList.add('hidden'); $$('#screen-home .lbl, #emoji-picker, #color-picker, #create-btn, .or, #tv-btn').forEach(e => e.classList.add('hidden'));
    $('.hero-sub').textContent = 'Big-screen mode. Type the room code from a player\'s phone and this screen will show the prompts, answers and scores for everyone.';
    $('#join-form button').textContent = '📺 Show room';
    if (urlCode) $('#code-input').value = urlCode;
  }
  function needName() {
    const n = $('#name-input').value.trim();
    if (!n) { $('#home-error').textContent = 'Give yourself a nickname first!'; $('#name-input').focus(); return null; }
    return n;
  }
  $('#create-btn').addEventListener('click', () => {
    Sfx.unlock(); const name = needName(); if (!name) return;
    $('#create-btn').disabled = true;
    socket.emit('create', { name, avatar: profile.avatar, playerId }, (res) => {
      $('#create-btn').disabled = false;
      if (res.error) return ($('#home-error').textContent = res.error);
      entered(res);
    });
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault(); Sfx.unlock();
    const code = $('#code-input').value.trim().toUpperCase();
    if (code.length !== 4) return ($('#home-error').textContent = 'Room codes are 4 letters.');
    if (TV) return watch(code);
    const name = needName(); if (!name) return;
    socket.emit('join', { code, name, avatar: profile.avatar, playerId }, (res) => {
      if (res.error) return ($('#home-error').textContent = res.error);
      entered(res);
    });
  });
  $('#tv-btn').addEventListener('click', () => {
    const code = $('#code-input').value.trim().toUpperCase();
    location.href = '/tv' + (code.length === 4 ? '/' + code : '');
  });
  function entered(res) {
    $('#home-error').textContent = '';
    sessionStorage.setItem('rrx-room', res.code);
    if (location.pathname !== '/r/' + res.code) history.replaceState(null, '', '/r/' + res.code);
    if (res.role === 'audience' && !res.rejoined) toast('Game in progress, so you\'re in the audience 🍿 You can still vote!', 4200);
    Sfx.join();
  }
  function watch(code) {
    socket.emit('watch', { code }, (res) => {
      if (res.error) { $('#home-error').textContent = res.error; return; }
      sessionStorage.setItem('rrx-room', res.code);
      if (location.pathname !== '/tv/' + res.code) history.replaceState(null, '', '/tv/' + res.code);
    });
  }

  // ---------- connection ----------
  socket.on('connect', () => {
    const code = sessionStorage.getItem('rrx-room');
    if (TV) { const c = urlCode || code; if (c) watch(c); return; }
    if (code && (S.st || (urlCode && code === urlCode))) {
      socket.emit('join', { code, playerId }, (res) => {
        if (res.error) { sessionStorage.removeItem('rrx-room'); if (S.st) { toast(res.error); leaveToHome(); } }
      });
    }
  });
  socket.on('disconnect', () => { if (S.st) toast('Connection lost… reconnecting 🦖', 4000); });
  socket.on('kicked', ({ reason }) => { toast(reason, 4200); leaveToHome(); });
  function leaveToHome() {
    sessionStorage.removeItem('rrx-room'); S.st = null; S.prev = null; S.viewKey = null;
    document.body.classList.remove('is-host'); $('#room-chip').classList.add('hidden');
    history.replaceState(null, '', TV ? '/tv' : '/'); stopTimer();
    if (!TV) $('#create-btn').classList.remove('hidden');
    show('screen-home'); Sfx.music('lobby'); Sfx.tension(false);
  }
  socket.on('force', ({ phaseId }) => { if (S.st?.game?.phaseId === phaseId) submitDrafts(); });
  socket.on('state', (st) => {
    S.prev = S.st; S.st = st; S.skew = st.serverNow - Date.now();
    onState();
  });

  // ---------- state transitions + sound cues ----------
  function onState() {
    const st = S.st, prev = S.prev;
    document.body.classList.toggle('is-host', isHost());
    document.body.classList.toggle('is-audience', st.role === 'audience');
    $('#room-chip').textContent = st.code; $('#room-chip').classList.remove('hidden');
    const phaseKey = st.phase + ':' + (st.game?.phaseId || '');
    const changed = !prev || (prev.phase + ':' + (prev.game?.phaseId || '')) !== phaseKey;
    setMusicFor(st.phase);
    if (changed) {
      Sfx.tension(false); S.lastTick = -1;
      if (st.phase === 'intro') { const ri = ROUND_INFO[st.game.round] || ROUND_INFO[1]; curtain(ri.title, ri.sub, st.game.round === 1 ? Sfx.start : Sfx.roar); }
      if (st.phase === 'vote' || st.phase === 'fvote') { S.finalPicks = []; Sfx.versus(); }
      if (st.phase === 'result') resultFx(st);
      if (st.phase === 'fresult') { Sfx.drumroll(0.9); setTimeout(() => Sfx.reveal(), 950); }
      if (st.phase === 'end') { Sfx.winner(); setTimeout(() => confetti(160), 1300); }
      if (st.phase === 'lobby' && prev && prev.phase !== 'lobby') { S.drafts = {}; saveDrafts(); }
      if (prev && prev.phase === 'answer' && st.phase !== 'answer' && prev.game?.deadline && prev.game.deadline - now() < 1500) Sfx.timesUp();
    }
    if (st.phase === 'lobby') {
      if (prev && prev.phase === 'lobby') {
        const before = new Set([...prev.players, ...prev.audience].map(p => p.id)), nowIds = new Set([...st.players, ...st.audience].map(p => p.id));
        if ([...nowIds].some(id => !before.has(id))) Sfx.join(); else if ([...before].some(id => !nowIds.has(id))) Sfx.leave();
      }
      show('screen-lobby'); renderLobby(); stopTimer();
    } else {
      show('screen-game'); renderGame(changed); startTimer();
    }
  }
  function resultFx(st) {
    const r = st.match?.result; if (!r) return;
    if (r.jinx) { Sfx.jinx(); return; }
    Sfx.drumroll(0.75);
    const pid = st.game.phaseId;
    setTimeout(() => { if (S.st?.game?.phaseId !== pid) return; if (r.sweep) { Sfx.sweep(); setTimeout(() => confetti(60), 700); } else Sfx.reveal(); }, 800);
  }

  // ---------- lobby ----------
  function renderLobby() {
    const st = S.st; const host = isHost();
    $('#lobby-code').textContent = st.code;
    if (TV) $('.tv-tip').innerHTML = `📱 <span>Grab your phone and go to <b>${esc(location.host)}/r/${esc(st.code)}</b>, or open the site and type code <b>${esc(st.code)}</b>.</span>`;
    else $('#tv-link').textContent = `${location.host}/tv/${st.code}`;
    const n = st.players.filter(p => p.connected).length;
    $('#player-count').textContent = `(${st.players.length}/${st.maxPlayers})`;
    const items = st.players.map(p => `
      <li class="player ${p.id === st.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
        ${p.id === st.hostId ? '<span class="crown" title="Host">👑</span>' : ''}
        ${avatarHTML(p.avatar)}
        <span class="pname">${esc(p.name)}${p.id === st.you ? ' <small class="muted">(you)</small>' : ''}</span>
        ${host && p.id !== st.you ? `<button class="kick" data-kick="${esc(p.id)}" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </li>`);
    const empties = Math.max(0, Math.min(st.maxPlayers, Math.max(st.minPlayers, st.players.length + 1)) - st.players.length);
    for (let i = 0; i < empties; i++) items.push('<li class="player empty">waiting for a friend…</li>');
    $('#player-list').innerHTML = items.join('');
    $('#audience-box').classList.toggle('hidden', !st.audience.length);
    $('#audience-list').innerHTML = st.audience.map(a => `<span class="aud-chip">${esc(a.avatar.emoji)} ${esc(a.name)}${host ? ` <button class="kick" data-kick="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">✕</button>` : ''}</span>`).join(' ');
    $('#pack-list').innerHTML = Object.entries(st.packs).map(([k, label]) => `
      <button class="mode ${st.settings.pack === k ? 'sel' : ''}" data-pack="${k}" ${host ? '' : 'disabled'}>
        <span class="mi">${PACK_META[k].icon}</span><span><b>${esc(label)}</b><small>${PACK_META[k].desc}</small></span>
      </button>`).join('');
    $('#pace-list').innerHTML = PACES.map(([v, l]) => `<button data-pace="${v}" class="${st.settings.pace === v ? 'sel' : ''}" ${host ? '' : 'disabled'}>${l}</button>`).join('');
    $('#filter-toggle').checked = st.settings.filter; $('#filter-toggle').disabled = !host;
    $('#settings-note').textContent = host ? 'You\'re the host, so you make the rules.' : `Only the host (${pname(st.hostId)}) can change these.`;
    const sb = $('#start-btn'); sb.classList.toggle('hidden', !host || TV); sb.disabled = n < st.minPlayers;
    $('#start-hint').textContent = host
      ? (n < st.minPlayers ? `Need ${st.minPlayers - n} more player${st.minPlayers - n > 1 ? 's' : ''} to start. Send them the link!` : `${n} players ready. Let's roar!`)
      : (TV ? `Waiting for ${pname(st.hostId)} to start…` : `Waiting for ${pname(st.hostId)} to start…`);
    $('.custom-box').classList.toggle('hidden', TV || st.role === 'tv');
    $('#my-custom').innerHTML = (st.myCustom || []).map((t, i) => `<li><span>${esc(t)}</span><button data-rm="${i}" aria-label="Remove prompt">✕</button></li>`).join('');
    $('#custom-note').textContent = st.customCount ? `${st.customCount} custom prompt${st.customCount > 1 ? 's' : ''} in the hat. They get mixed into rounds 1 and 2.` : 'Inside jokes welcome. Use a player\'s name and it gets extra funny.';
    if (navigator.share && !TV) $('#share-link').classList.remove('hidden');
    if (!renderLobby.bubbleSet) { renderLobby.bubbleSet = true; $('#lobby-bubble').textContent = BUBBLES[Math.floor(Math.random() * BUBBLES.length)]; }
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-kick]'); if (b && isHost()) socket.emit('kick', b.dataset.kick); });
  $('#pack-list').addEventListener('click', e => { const b = e.target.closest('[data-pack]'); if (b && isHost()) { socket.emit('settings', { pack: b.dataset.pack }); Sfx.pop(); } });
  $('#pace-list').addEventListener('click', e => { const b = e.target.closest('[data-pace]'); if (b && isHost()) { socket.emit('settings', { pace: b.dataset.pace }); Sfx.pop(); } });
  $('#filter-toggle').addEventListener('change', e => { socket.emit('settings', { filter: e.target.checked }); Sfx.pop(); });
  $('#custom-form').addEventListener('submit', e => {
    e.preventDefault(); const inp = $('#custom-input'); const t = inp.value.trim(); if (!t) return;
    socket.emit('custom', t, (res) => { if (res.error) toast(res.error); else { inp.value = ''; Sfx.send(); toast('Prompt added to the hat 🎩'); } });
  });
  $('#my-custom').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) socket.emit('custom:remove', Number(b.dataset.rm)); });
  const inviteLink = () => `${location.origin}/r/${S.st.code}`;
  $('#copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(inviteLink()); toast('Invite link copied! 📋'); } catch { prompt('Copy this link:', inviteLink()); }
  });
  $('#share-link').addEventListener('click', () => navigator.share({ title: 'Rochasaurus Rex', text: `Join my Rochasaurus Rex room ${S.st.code}! 🦖`, url: inviteLink() }).catch(() => {}));
  $('#start-btn').addEventListener('click', () => {
    socket.emit('start', null, (res) => { $('#lobby-error').textContent = res && res.error ? res.error : ''; });
  });
  $('#leave-btn').addEventListener('click', () => { socket.emit('leave'); leaveToHome(); });

  // ---------- game views ----------
  const view = $('#view');
  // Only rebuild a view when its key changes, so typing and taps are never clobbered by state updates.
  function ensure(key, build) { if (S.viewKey !== key) { S.viewKey = key; view.innerHTML = build(); view.scrollTop = 0; window.scrollTo({ top: 0 }); return true; } return false; }

  function renderGame() {
    const st = S.st, g = st.game; if (!g) return;
    $('#round-pill').textContent = g.round === g.totalRounds ? '🌋 Last Roar' : `Round ${g.round} / ${g.totalRounds}`;
    renderMiniRoster();
    const reactOn = ['result', 'fresult', 'scores', 'end'].includes(st.phase) && !TV;
    $('#react-bar').classList.toggle('hidden', !reactOn);
    ({ intro: viewIntro, answer: viewAnswer, vote: viewVote, result: viewVote, scores: viewScores, fvote: viewFinal, fresult: viewFinal, end: viewEnd }[st.phase] || (() => {}))();
  }
  function renderMiniRoster() {
    const st = S.st, g = st.game;
    let done = new Set();
    if (st.phase === 'answer' && st.answer) done = new Set(st.answer.done);
    if (st.phase === 'vote' && st.match) done = new Set(st.match.voted);
    const ids = Object.keys(g.roster).filter(id => st.players.some(p => p.id === id));
    $('#mini-roster').innerHTML = ids.map(id => { const off = !st.players.find(p => p.id === id)?.connected; return `<span class="mr ${done.has(id) ? 'done' : ''} ${off ? 'off' : ''}" title="${esc(pname(id))}">${avatarOf(id, 'sm')}</span>`; }).join('');
  }

  function viewIntro() {
    const st = S.st; const ri = ROUND_INFO[st.game.round] || ROUND_INFO[1];
    ensure('intro:' + st.game.phaseId, () => `
      <div class="intro-card">
        <svg class="intro-dino" viewBox="0 0 220 220" aria-hidden="true"><use href="#dino"/></svg>
        <h2 class="intro-title">${esc(ri.title)}</h2>
        <p class="intro-sub">${esc(ri.sub)}</p>
        ${st.game.round < 3 ? `<p class="intro-note">Points per matchup: <b>${st.game.round * 1000}</b> · Clean sweep bonus: <b>EXTINCTION!</b></p>` : '<p class="intro-note">Each vote is worth <b>400</b> points, and the crowd favorite gets <b>+500</b>.</p>'}
        <button class="btn btn-ghost btn-small host-only skip-btn" data-next>Skip ▶</button>
      </div>`);
  }

  // ----- answering -----
  function myOpen() { return (S.st.answer?.mine || []).filter(p => !p.answer); }
  function viewAnswer() {
    const st = S.st, a = st.answer;
    if (st.role === 'player' && myOpen().length) {
      const open = myOpen(); const p = open[0];
      const idx = a.mine.findIndex(x => x.id === p.id);
      const built = ensure('answer:' + p.id, () => `
        <div class="card answer-card">
          <div class="answer-meta"><span class="tag">${a.final ? '🌋 Everyone answers this one' : `Prompt ${idx + 1} of ${a.mine.length}`}</span><span class="muted small">${a.final ? '' : 'Someone else got this prompt too. Be funnier!'}</span></div>
          <h2 class="prompt-text">${esc(p.text)}</h2>
          <form id="answer-form">
            <textarea id="answer-input" class="input input-lg" maxlength="80" rows="2" placeholder="Your funniest answer…" autocomplete="off" enterkeyhint="send"></textarea>
            <div class="answer-row">
              <span id="char-count" class="muted small">0/80</span>
              <button type="button" id="safety-btn" class="btn btn-ghost btn-small" title="Auto-answer with a random safety quip (half points)">🦺 Safety quip</button>
            </div>
            <button type="submit" id="answer-submit" class="btn btn-primary btn-xl full">Lock it in 🔒</button>
          </form>
        </div>`);
      if (built) {
        const inp = $('#answer-input'); inp.value = S.drafts[p.id] || ''; $('#char-count').textContent = `${inp.value.length}/80`;
        inp.addEventListener('input', () => { S.drafts[p.id] = inp.value; saveDrafts(); $('#char-count').textContent = `${inp.value.length}/80`; });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAnswer(p.id, false); } });
        $('#answer-form').addEventListener('submit', e => { e.preventDefault(); sendAnswer(p.id, false); });
        $('#safety-btn').addEventListener('click', () => sendAnswer(p.id, true));
        if (matchMedia('(pointer:fine)').matches) setTimeout(() => inp.focus(), 60);
      }
      return;
    }
    const isPlayer = st.role === 'player';
    ensure('answer-wait:' + st.game.phaseId + ':' + st.role, () => `
      <div class="card wait-card">
        <svg class="wait-dino" viewBox="0 0 220 220" aria-hidden="true"><use href="#dino"/></svg>
        <h2>${isPlayer ? 'Answers locked! 🦖' : TV ? 'Answer on your phones! 📱' : 'You\'re in the audience 🍿'}</h2>
        <p class="muted" id="wait-text"></p>
        <ul id="wait-list" class="wait-list"></ul>
        ${isPlayer ? '<div id="my-answers" class="my-answers"></div>' : ''}
        ${TV ? `<p class="tv-join">Join at <b>${esc(location.host)}</b> · code <b>${esc(st.code)}</b></p>` : ''}
      </div>`);
    const waiting = a.waiting.map(pname);
    $('#wait-text').textContent = !waiting.length ? 'Everyone\'s done! Here come the matchups…' : waiting.length <= 2 ? `Waiting on ${waiting.join(' & ')}…` : `Waiting on ${waiting.length} players…`;
    $('#wait-list').innerHTML = [...a.done, ...a.waiting].map(id => `<li class="${a.done.includes(id) ? 'done' : 'pending'}" title="${esc(pname(id))}">${avatarOf(id)}<small>${esc(pname(id))}</small></li>`).join('');
    if ($('#my-answers')) $('#my-answers').innerHTML = a.mine.map(m => `<div class="mine"><small>${esc(m.text)}</small><b>${esc(m.answer)}${m.safety ? ' <em class="safety-tag">🦺</em>' : ''}</b></div>`).join('');
  }
  function sendAnswer(promptId, safety) {
    const st = S.st; if (!st?.game || st.phase !== 'answer') return;
    const inp = $('#answer-input'); const text = (inp?.value || '').trim();
    if (!safety && !text) { toast('Type something first, or grab a safety quip 🦺'); inp?.focus(); return; }
    const btn = $('#answer-submit'); if (btn) btn.disabled = true;
    socket.emit('answer', { promptId, text, safety, phaseId: st.game.phaseId }, (res) => {
      if (btn) btn.disabled = false;
      if (res.error) { if (!/over/.test(res.error)) toast(res.error); return; }
      delete S.drafts[promptId]; saveDrafts();
      safety ? Sfx.safety() : Sfx.send();
      if (safety) toast(`Safety quip: "${res.text}" 🦺`, 2600);
    });
  }
  function submitDrafts() { // deadline hit: send whatever is typed so nobody loses an answer
    const st = S.st; if (!st?.answer || st.role !== 'player') return;
    for (const p of myOpen()) {
      const text = (S.drafts[p.id] || '').trim();
      if (text) socket.emit('answer', { promptId: p.id, text, phaseId: st.game.phaseId }, () => {});
    }
  }

  // ----- head to head -----
  function viewVote() {
    const st = S.st, m = st.match; if (!m) return;
    const reveal = st.phase === 'result';
    const canVote = !reveal && !m.inIt && st.role !== 'tv';
    const built = ensure(`vote:${st.game.round}:${m.index}:${reveal ? 'r' : 'v'}`, () => `
      <div class="match">
        <div class="match-top"><span class="tag">Matchup ${m.index + 1} of ${m.total}</span>${m.by ? `<span class="tag tag-custom">✍️ prompt by ${esc(m.by)}</span>` : ''}</div>
        <h2 class="prompt-text big">${esc(m.prompt)}</h2>
        <div class="versus ${reveal ? 'revealed' : ''}">
          ${answerCard(m.answers[0], 0, m, reveal)}
          <div class="vs-badge" aria-hidden="true">VS</div>
          ${answerCard(m.answers[1], 1, m, reveal)}
        </div>
        <p class="vote-status" id="vote-status"></p>
        ${reveal ? '<div id="result-banner" class="result-banner"></div><div class="center"><button class="btn btn-ghost btn-small host-only" data-next>Next ▶</button></div>' : ''}
      </div>`);
    if (built && !reveal && canVote) $$('.answer-opt', view).forEach(b => b.addEventListener('click', () => vote(b.dataset.key)));
    // dynamic parts
    $$('.answer-opt', view).forEach(b => { b.classList.toggle('picked', m.myVote === b.dataset.key); b.disabled = !canVote || !!m.myVote; });
    const status = $('#vote-status');
    if (!reveal) {
      status.textContent = m.inIt ? 'This is your matchup! Fingers crossed 🤞' : st.role === 'tv' ? `${m.votedCount} vote${m.votedCount === 1 ? '' : 's'} in…` : m.myVote ? `Vote locked! ${m.votedCount} in so far…` : 'Tap the funnier answer!';
    } else {
      status.textContent = '';
      const r = m.result; const ban = $('#result-banner');
      if (r.jinx) ban.innerHTML = '<span class="jinx">🤝 JINX! Same answer, no points!</span>';
      else if (r.sweep) ban.innerHTML = `<span class="sweep">☄️ EXTINCTION! ${esc(pname(r.sweep))} took every vote!</span>`;
      else ban.innerHTML = '';
    }
  }
  function answerCard(a, i, m, reveal) {
    const r = m.result;
    let extra = '';
    if (reveal && r && !r.jinx) {
      const c = r.counts[a.key] || { players: 0, audience: 0, voters: [] };
      extra = `
        <div class="res">
          <div class="pct-bar"><i style="--w:${r.pct[a.key]}%"></i><span>${r.pct[a.key]}%</span></div>
          <div class="voters">${c.voters.map(v => avatarOf(v, 'xs')).join('')}${c.audience ? `<span class="aud-votes">🍿×${c.audience}</span>` : ''}</div>
          <div class="pts">+${r.points[a.key]}${r.sweep === a.key ? ' <span class="sweep-tag">☄️ sweep</span>' : ''}</div>
        </div>`;
    }
    const author = reveal ? `<div class="author">${avatarOf(a.authorId, 'sm')}<b>${esc(pname(a.authorId))}</b>${a.safety ? `<em class="safety-tag" title="Safety quip, half points">🦺 ${a.timedOut ? 'ran out of time' : 'safety quip'}</em>` : ''}</div>` : '';
    const win = reveal && r && !r.jinx && r.pct[a.key] > 50 ? ' winner' : '';
    return `<button class="answer-opt side-${i}${win}" data-key="${esc(a.key)}" ${reveal ? 'disabled' : ''}>
      <span class="atext">${esc(a.text)}</span>${a.mine && !reveal ? '<span class="yours">yours</span>' : ''}${author}${extra}</button>`;
  }
  function vote(key) {
    const st = S.st; if (!st.match || st.match.myVote) return;
    socket.emit('vote', { choice: key }, (res) => { if (res.error) toast(res.error); else Sfx.vote(); });
  }

  // ----- scores -----
  function viewScores() {
    const st = S.st;
    const built = ensure('scores:' + st.game.phaseId, () => `
      <div class="card scores-card">
        <h2 class="center">🏆 Scoreboard <small class="muted">after round ${st.game.round}</small></h2>
        <ol class="scoreboard" id="scoreboard"></ol>
        <div class="center"><button class="btn btn-primary host-only" data-next>${st.game.round + 1 >= st.game.totalRounds ? 'On to the Last Roar ▶' : 'Next round ▶'}</button></div>
      </div>`);
    if (built) renderScoreboard($('#scoreboard'), st.scores, true);
  }
  function renderScoreboard(el, scores, animate) {
    const max = Math.max(1, ...scores.map(s => s.score));
    el.innerHTML = scores.map((s, i) => `
      <li class="${s.id === S.st.you ? 'me' : ''}" style="--d:${i * 0.12}s">
        <span class="rank">${i + 1}</span>${avatarOf(s.id)}<span class="sname">${esc(pname(s.id))}</span>
        <span class="sbar"><i style="--w:${Math.round(s.score / max * 100)}%"></i></span>
        <span class="sval" data-to="${s.score}">${animate ? Math.max(0, s.score - s.gain) : s.score}</span><span class="gain ${s.gain ? '' : 'none'}">${s.gain ? '+' + s.gain : ''}</span>
      </li>`).join('');
    if (!animate) return;
    const els = $$('.sval', el); const from = els.map(e => Number(e.textContent)); const t0 = performance.now(), D = 1400;
    const step = (t) => {
      const k = Math.min(1, (t - t0 - 300) / D); if (k < 0) return requestAnimationFrame(step);
      els.forEach((e, i) => { e.textContent = Math.round(from[i] + (Number(e.dataset.to) - from[i]) * (1 - Math.pow(1 - k, 3))); });
      if (k < 1) { if (Math.random() < 0.35) Sfx.score(); requestAnimationFrame(step); }
    };
    requestAnimationFrame(step);
  }

  // ----- the Last Roar -----
  function viewFinal() {
    const st = S.st, f = st.final; if (!f) return;
    const reveal = st.phase === 'fresult';
    const canVote = !reveal && st.role !== 'tv' && !f.myVote;
    const built = ensure(`final:${reveal ? 'r' : 'v'}:${st.game.phaseId}`, () => {
      let list = f.answers;
      if (reveal) list = [...list].sort((a, b) => (f.result.votes[b.key] || 0) - (f.result.votes[a.key] || 0));
      return `
      <div class="final">
        <div class="match-top"><span class="tag">🌋 The Last Roar</span><span class="muted small" id="final-hint"></span></div>
        <h2 class="prompt-text big">${esc(f.prompt)}</h2>
        <div class="final-grid ${reveal ? 'revealed' : ''}">
          ${list.map((a, i) => finalCard(a, i, f, reveal)).join('')}
        </div>
        ${!reveal && canVote ? `<button id="final-submit" class="btn btn-primary btn-xl full" disabled>Pick up to ${f.maxVotes}</button>` : ''}
        <p class="vote-status" id="vote-status"></p>
        ${reveal ? '<div class="center"><button class="btn btn-ghost btn-small host-only" data-next>See the winner ▶</button></div>' : ''}
      </div>`;
    });
    if (built && canVote) {
      $$('.final-opt', view).forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.key; if (b.classList.contains('own')) return toast('No voting for yourself! 😄');
        const i = S.finalPicks.indexOf(k);
        if (i >= 0) S.finalPicks.splice(i, 1); else if (S.finalPicks.length < f.maxVotes) S.finalPicks.push(k); else return toast(`Only ${f.maxVotes} votes! Tap one to un-pick it.`);
        Sfx.pop(); paintPicks();
      }));
      $('#final-submit').addEventListener('click', () => {
        if (!S.finalPicks.length) return;
        socket.emit('vote', { choice: S.finalPicks.slice() }, (res) => { if (res.error) toast(res.error); else Sfx.vote(); });
      });
    }
    paintPicks();
    const status = $('#vote-status');
    if (!reveal) status.textContent = st.role === 'tv' ? `${f.votedCount} of ${f.voterCount} voted…` : f.myVote ? `Votes locked! ${f.votedCount} of ${f.voterCount} in…` : `Tap up to ${f.maxVotes} favorites (not your own).`;
    else status.textContent = '';
  }
  function paintPicks() {
    const f = S.st.final; const locked = f.myVote;
    $$('.final-opt', view).forEach(b => {
      const k = b.dataset.key; const picked = locked ? locked.includes(k) : S.finalPicks.includes(k);
      b.classList.toggle('picked', picked);
      if (locked || S.st.role === 'tv') b.disabled = true;
    });
    const btn = $('#final-submit');
    if (btn) { btn.classList.toggle('hidden', !!locked); btn.disabled = !S.finalPicks.length; btn.textContent = S.finalPicks.length ? `Cast ${S.finalPicks.length} vote${S.finalPicks.length > 1 ? 's' : ''} 🗳️` : `Pick up to ${f.maxVotes}`; }
  }
  function finalCard(a, i, f, reveal) {
    let extra = '', author = '';
    if (reveal) {
      const r = f.result; const c = r.counts[a.key] || { voters: [], audience: 0 };
      author = `<div class="author">${avatarOf(a.authorId, 'sm')}<b>${esc(pname(a.authorId))}</b>${a.safety ? '<em class="safety-tag">🦺</em>' : ''}</div>`;
      extra = `<div class="res"><div class="voters">${c.voters.map(v => avatarOf(v, 'xs')).join('')}${c.audience ? `<span class="aud-votes">🍿×${c.audience}</span>` : ''}</div>
        <div class="pts">+${r.points[a.key]}${r.fave.includes(a.key) ? ' <span class="sweep-tag">👑 crowd favorite</span>' : ''}</div></div>`;
    }
    const own = a.mine && S.st.role === 'player';
    return `<button class="final-opt ${own ? 'own' : ''} ${reveal && f.result.fave.includes(a.key) ? 'winner' : ''}" data-key="${esc(a.key)}" style="--d:${i * 0.07}s" ${reveal ? 'disabled' : ''}>
      <span class="atext">${esc(a.text)}</span>${own && !reveal ? '<span class="yours">yours</span>' : ''}${author}${extra}</button>`;
  }

  // ----- winner -----
  function viewEnd() {
    const st = S.st; const sc = st.scores; if (!sc || !sc.length) return;
    const top = sc[0].score; const winners = sc.filter(s => s.score === top);
    const built = ensure('end:' + st.game.id, () => {
      const podium = sc.slice(0, 3);
      const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium.length === 2 ? [podium[1], podium[0]] : podium;
      const best = (st.history || []).flatMap(h => h.answers.map(a => ({ ...a, prompt: h.prompt }))).sort((a, b) => b.points - a.points).slice(0, 3);
      return `
      <div class="end">
        <div class="winner-stage">
          <div class="winner-dino"><svg class="crown-svg" viewBox="0 0 80 54" aria-hidden="true"><use href="#crown"/></svg><svg viewBox="0 0 220 220" aria-hidden="true"><use href="#dino"/></svg></div>
          <div>
            <div class="lbl light">${winners.length > 1 ? 'It\'s a tie! Co-kings of the jungle' : 'King of the jungle'}</div>
            <h2 class="winner-name">${winners.map(w => esc(pname(w.id))).join(' & ')}</h2>
            <p class="winner-sub">${top.toLocaleString()} points · RAWR! 🦖</p>
          </div>
        </div>
        <div class="podium">${order.map(s => { const place = sc.indexOf(s) + 1; return `<div class="pod p${place}">${avatarOf(s.id, 'big')}<b>${esc(pname(s.id))}</b><span>${s.score.toLocaleString()}</span><div class="block">${place}</div></div>`; }).join('')}</div>
        <div class="end-grid">
          <div class="card"><h3>🏆 Final scores</h3><ol class="scoreboard" id="final-board"></ol></div>
          ${best.length ? `<div class="card"><h3>🔥 Top quips of the game</h3><ul class="best">${best.map(b => `<li><small>${esc(b.prompt)}</small><b>“${esc(b.text)}”</b><span>${avatarOf(b.id, 'xs')} ${esc(pname(b.id))} · +${b.points}</span></li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="end-actions">
          <button class="btn btn-mint btn-xl host-only" id="again-btn">🔁 Play again</button>
          <span class="muted guest-only" id="end-wait">${TV ? 'Waiting for the host to start another game…' : 'Waiting for the host to start another game…'}</span>
          ${TV ? '' : '<button class="btn btn-ghost btn-small" id="end-leave">← Leave room</button>'}
        </div>
      </div>`;
    });
    if (built) {
      renderScoreboard($('#final-board'), sc, false);
      $('#again-btn')?.addEventListener('click', () => socket.emit('lobby'));
      $('#end-leave')?.addEventListener('click', () => { socket.emit('leave'); leaveToHome(); });
    }
  }

  view.addEventListener('click', e => { if (e.target.closest('[data-next]') && isHost()) socket.emit('next'); });

  // ---------- timer ----------
  function needsAction() {
    const st = S.st; if (!st) return false;
    if (st.phase === 'answer') return st.role === 'player' && myOpen().length > 0;
    if (st.phase === 'vote') return !!st.match && !st.match.inIt && !st.match.myVote && st.role !== 'tv';
    if (st.phase === 'fvote') return !!st.final && !st.final.myVote && st.role !== 'tv';
    return false;
  }
  function startTimer() {
    stopTimer();
    const loop = () => {
      const st = S.st; if (!st || !st.game) return;
      const timed = ['answer', 'vote', 'fvote'].includes(st.phase) && st.game.deadline;
      $('#timer').classList.toggle('invisible', !timed);
      if (timed) {
        const l = left(); const frac = st.game.duration ? l / st.game.duration : 0; const secs = Math.ceil(l / 1000);
        $('#timer-fill').style.transform = `scaleX(${frac})`;
        $('#timer-text').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        const act = needsAction() || TV;
        $('#timer').classList.toggle('warn', frac < 0.35 && secs > 5);
        $('#timer').classList.toggle('danger', secs <= 5 && l > 0 && act);
        const tickFrom = st.phase === 'answer' ? 10 : 5;
        if (secs <= tickFrom && secs > 0 && secs !== S.lastTick && act) { S.lastTick = secs; Sfx.tick(secs); }
        Sfx.tension(secs <= (st.phase === 'answer' ? 10 : 5) && l > 0 && (act || st.phase !== 'answer'));
      } else Sfx.tension(false);
      S.timerRAF = requestAnimationFrame(loop);
    };
    loop();
  }
  function stopTimer() { cancelAnimationFrame(S.timerRAF); }

  // ---------- reactions ----------
  $('#react-bar').innerHTML = REACTS.map(r => `<button data-r="${r}" aria-label="React ${r}">${r}</button>`).join('');
  $('#react-bar').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) socket.emit('react', b.dataset.r); });
  socket.on('react', ({ emoji }) => {
    const f = document.createElement('div'); f.className = 'floater'; f.textContent = emoji;
    f.style.left = (10 + Math.random() * 80) + '%'; f.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px'); f.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
    $('#floaters').appendChild(f); setTimeout(() => f.remove(), 2500);
    if (emoji === '🦖') Sfx.roar(0.7); else Sfx.react();
  });

  // ---------- sound panel ----------
  const panel = $('#audio-panel');
  function renderAudio(st = Sfx.state()) {
    $('#mute-btn').textContent = (!st.music && !st.sfx) ? '🔇' : (st.music ? '🎵' : '🔊');
    $('#music-toggle').setAttribute('aria-pressed', String(st.music)); $('#music-toggle').classList.toggle('off', !st.music);
    $('#sfx-toggle').setAttribute('aria-pressed', String(st.sfx)); $('#sfx-toggle').classList.toggle('off', !st.sfx);
    $('#music-state').textContent = st.music ? 'on' : 'off'; $('#sfx-state').textContent = st.sfx ? 'on' : 'off';
    if (document.activeElement !== $('#music-vol')) $('#music-vol').value = Math.round(st.musicVol * 100);
    if (document.activeElement !== $('#sfx-vol')) $('#sfx-vol').value = Math.round(st.sfxVol * 100);
    $('#mute-btn').classList.toggle('needs-tap', !st.running && (st.music || st.sfx));
    $('#audio-hint').textContent = st.running ? 'All music & sounds are made live in your browser.' : 'Tap anywhere to start the music.';
  }
  Sfx.onChange(renderAudio); renderAudio();
  const setPanel = (open) => { panel.classList.toggle('hidden', !open); $('#mute-btn').setAttribute('aria-expanded', String(open)); if (open) renderAudio(); };
  $('#mute-btn').addEventListener('click', (e) => { e.stopPropagation(); Sfx.unlock(); setPanel(panel.classList.contains('hidden')); });
  $('#music-toggle').addEventListener('click', () => Sfx.setMusic(!Sfx.state().music));
  $('#sfx-toggle').addEventListener('click', () => Sfx.setSfx(!Sfx.state().sfx));
  $('#music-vol').addEventListener('input', e => Sfx.setMusicVol(e.target.value / 100));
  $('#sfx-vol').addEventListener('input', e => Sfx.setSfxVol(e.target.value / 100));
  $('#sfx-vol').addEventListener('change', () => Sfx.pop());
  document.addEventListener('click', (e) => { if (!panel.classList.contains('hidden') && !e.target.closest('.audio-ctl')) setPanel(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.classList.contains('hidden')) { setPanel(false); $('#mute-btn').focus(); } });
  document.addEventListener('click', (e) => { if (e.target.closest('button:not(:disabled)')) Sfx.click(); });
  window.addEventListener('beforeunload', (e) => { if (S.st && !TV && ['answer', 'vote', 'fvote'].includes(S.st.phase)) { e.preventDefault(); e.returnValue = ''; } });

  renderProfile();
  if (!urlCode && sessionStorage.getItem('rrx-room')) sessionStorage.removeItem('rrx-room');
  show('screen-home'); Sfx.music('lobby');
  window.__rrx = { S, socket };
})();
