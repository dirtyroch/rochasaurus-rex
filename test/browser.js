// Drives real headless Chrome tabs (desktop host, 3 phones, 1 big screen) through a full game via the UI and saves screenshots.
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const PORT = 4796; const BASE = process.env.BASE || `http://localhost:${PORT}`;
const OUT = process.env.OUT || '/workspace/game-screens';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const QUIPS = ['A llama in a tuxedo', 'Grandma\'s secret meatloaf', 'Three raccoons in a trench coat', 'Interpretive dance', 'A very confident goose',
  'Socks with sandals', 'Free church potluck', 'Yelling "BINGO" at the wrong time', 'A tiny cowboy hat', 'Microwaved fish at work', 'Mom\'s Facebook comments', 'Spaghetti, but angrier'];
let qi = 0;

(async () => {
  let srv = null;
  if (!process.env.BASE) {
    srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, TIME_SCALE: process.env.TIME_SCALE || '0.45', GRACE_MS: '600' }, stdio: 'inherit' });
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/healthz'); break; } catch { await sleep(100); } }
  }
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = []; let fail = null;
  async function newPage(name, kind) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    if (kind === 'phone') await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
    else if (kind === 'tv') await page.setViewport({ width: 1600, height: 900 });
    else await page.setViewport({ width: 1280, height: 860 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    page.on('dialog', d => d.accept().catch(() => {}));
    page.name = name; return page;
  }
  const st = (p) => p.evaluate(() => { const s = window.__rrx.S.st; return s && { phase: s.phase, round: s.game?.round, pid: s.game?.phaseId, match: s.match, final: s.final, role: s.role }; });
  const shot = async (p, file, wait = 0) => { if (wait) await sleep(wait); await p.screenshot({ path: path.join(OUT, file) }); console.log('  📸', file); };

  try {
    const host = await newPage('Mike', 'desktop');
    await host.goto(BASE, { waitUntil: 'networkidle2' });
    await sleep(700);
    await shot(host, 'rex-home.png');
    await host.type('#name-input', 'Mike');
    await host.click('#emoji-picker button:nth-child(1)');
    await host.click('#create-btn');
    await host.waitForSelector('#screen-lobby:not(.hidden)');
    const code = await host.$eval('#lobby-code', e => e.textContent);
    console.log('room', code);
    const phoneHome = await newPage('Sarah', 'phone');
    await phoneHome.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle2' });
    await sleep(400);
    await shot(phoneHome, 'rex-join-phone.png');
    const players = [host, phoneHome];
    await phoneHome.type('#name-input', 'Sarah'); await phoneHome.click('#emoji-picker button:nth-child(2)');
    await phoneHome.click('#join-form button');
    for (const [n, e] of [['Caleb', 12], ['Grandma Jo', 17]]) {
      const p = await newPage(n, 'phone');
      await p.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle2' });
      await p.type('#name-input', n); await p.click(`#emoji-picker button:nth-child(${e})`);
      await p.click('#join-form button');
      await p.waitForSelector('#screen-lobby:not(.hidden)');
      players.push(p);
    }
    await host.type('#custom-input', 'The worst thing to bring to a church potluck');
    await host.click('#custom-form button');
    const tv = await newPage('TV', 'tv');
    await tv.goto(`${BASE}/tv/${code}`, { waitUntil: 'networkidle2' });
    await tv.waitForSelector('#screen-lobby:not(.hidden)');
    await host.waitForFunction(() => document.querySelectorAll('#player-list .player:not(.empty)').length === 4);
    await shot(host, 'rex-lobby.png', 500);
    await shot(phoneHome, 'rex-lobby-phone.png');
    await shot(tv, 'rex-tv-lobby.png');

    await host.click('#start-btn');
    await host.waitForSelector('.intro-card');
    await shot(host, 'rex-intro.png', 2100);
    await phoneHome.waitForSelector('#answer-input', { timeout: 15000 });
    await phoneHome.type('#answer-input', 'A raptor doing the church announcements');
    await shot(phoneHome, 'rex-answer-phone.png', 200);
    await shot(host, 'rex-answer.png');

    // bots: answer and vote through the real UI
    let stop = false; const snaps = {};
    const drive = async (p, i) => {
      while (!stop) {
        try {
          const s = await st(p);
          if (s?.phase === 'answer' && await p.$('#answer-input')) {
            const val = await p.$eval('#answer-input', e => e.value);
            if (!val) await p.type('#answer-input', QUIPS[qi++ % QUIPS.length]);
            if (i === 3 && s.round === 2 && Math.random() < .5) await p.click('#safety-btn'); else await p.click('#answer-submit');
            await sleep(250);
          } else if (s?.phase === 'vote' && s.match && !s.match.inIt && !s.match.myVote) {
            await sleep(1300); // leave time for the "pick one" screenshot
            const opts = await p.$$('.answer-opt:not(:disabled)');
            if (opts.length) await opts[i % 2 === 0 ? 0 : (Math.random() < .7 ? 0 : 1)].click();
          } else if (s?.phase === 'fvote' && s.final && !s.final.myVote) {
            await sleep(1400);
            const opts = await p.$$('.final-opt:not(.own):not(:disabled)');
            for (const o of opts.slice(0, 2 + (i % 2))) { await o.click(); await sleep(120); }
            if (i === 1) await shot(p, 'rex-final-vote-phone.png');
            await p.click('#final-submit');
          }
        } catch (e) { if (!/context|detached|Target closed|not clickable|Node is/.test(e.message)) console.log('drive', p.name, e.message); }
        await sleep(150);
      }
    };
    const drivers = players.map((p, i) => drive(p, i));

    // watch the host's phase and grab screenshots of each kind of moment
    const t0 = Date.now(); let lastPid = null;
    while (Date.now() - t0 < 240000) {
      const s = await st(host);
      if (s && s.pid !== lastPid) {
        lastPid = s.pid;
        if (s.phase === 'vote' && !snaps.vote) {
          snaps.vote = 1;
          for (const p of players.slice(1)) { const ps = await st(p); if (!ps.match.inIt) { await shot(p, 'rex-vote-phone.png', 500); break; } }
          await shot(tv, 'rex-tv-vote.png'); await shot(host, 'rex-vote.png');
        } else if (s.phase === 'result' && !snaps.result && !s.match.result.jinx) {
          snaps.result = 1; await shot(host, 'rex-result.png', 2100); await shot(tv, 'rex-tv-result.png');
          await shot(players[2], 'rex-result-phone.png');
        } else if (s.phase === 'result' && s.match.result.sweep && !snaps.sweep) {
          snaps.sweep = 1; await shot(host, 'rex-sweep.png', 2400);
        } else if (s.phase === 'scores' && !snaps.scores) {
          snaps.scores = 1; await shot(host, 'rex-scores.png', 2000); await shot(phoneHome, 'rex-scores-phone.png');
        } else if (s.phase === 'fvote' && !snaps.fvote) {
          snaps.fvote = 1; await shot(tv, 'rex-tv-final.png', 900);
        } else if (s.phase === 'fresult' && !snaps.fresult) {
          snaps.fresult = 1; await shot(host, 'rex-final-result.png', 2000);
        } else if (s.phase === 'end') {
          await sleep(3200);
          await shot(host, 'rex-winner.png'); await shot(phoneHome, 'rex-winner-phone.png'); await shot(tv, 'rex-tv-winner.png');
          await host.screenshot({ path: path.join(OUT, 'rex-winner-full.png'), fullPage: true });
          break;
        }
      }
      await sleep(80);
    }
    stop = true; await Promise.all(drivers);
    const fin = await st(host);
    if (fin.phase !== 'end') throw new Error('game did not reach the end: ' + fin.phase);
    const crowned = await host.$('.winner-dino .crown-svg');
    if (!crowned) throw new Error('no crowned dino on the winner screen');
    const sc = await host.evaluate(() => window.__rrx.S.st.scores);
    console.log('final scores', sc.map(s => s.score).join(', '));
    if (!sc.some(s => s.score > 0)) throw new Error('nobody scored');
    // play again
    await host.click('#again-btn');
    await Promise.all(players.map(p => p.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 5000 })));
    console.log('  ✔ play again → lobby on every device');
    for (const k of ['vote', 'result', 'scores', 'fvote', 'fresult']) if (!snaps[k]) console.log('  (missed snapshot)', k);
  } catch (e) { fail = e; }
  await browser.close(); if (srv) srv.kill();
  if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exit(1); }
  if (fail) { console.error('❌', fail); process.exit(1); }
  console.log('Browser game OK ✅ (no page errors)');
  process.exit(0);
})();
