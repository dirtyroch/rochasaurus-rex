// Checks the right music is really playing on every screen, locally or against a deployment:
//   BASE=https://rochasaurus-rex.onrender.com node test/audio-pages.js
// Chrome runs with its NORMAL autoplay rules. For each screen: AudioContext running, music bus gain > 0,
// the expected track, and that the scheduler keeps creating new notes.
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const PORT = 4793; const BASE = process.env.BASE || `http://localhost:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const IPHONE = { viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const results = [];
const INSTRUMENT = () => {
  window.__notes = 0; window.__gains = [];
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  const co = P.createOscillator, cb = P.createBufferSource, cg = P.createGain;
  P.createOscillator = function () { window.__notes++; return co.call(this); };
  P.createBufferSource = function () { window.__notes++; return cb.call(this); };
  P.createGain = function () { const g = cg.call(this); if (window.__gains.length < 3) window.__gains.push(g); return g; };
};
async function probe(page, ms = 1200) {
  return page.evaluate(async (ms) => {
    const n0 = window.__notes; const lv = [];
    for (let t = 0; t < ms; t += 60) { lv.push(Sfx.level()); await new Promise(r => setTimeout(r, 60)); }
    const st = Sfx.state(); const bus = window.__gains[1];
    return { running: st.running, track: st.track, musicGain: bus ? bus.gain.value : 0, notesPerSec: (window.__notes - n0) / (ms / 1000), level: Math.max(...lv) };
  }, ms);
}
async function check(label, page, track, ms) {
  const a = await probe(page, ms);
  const ok = a.running && a.track === track && a.musicGain > 0.05 && a.notesPerSec >= 3 && a.level > 0.0005;
  results.push({ label, ok, ...a });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} track=${a.track} running=${a.running} musicGain=${a.musicGain.toFixed(2)} notes/s=${a.notesPerSec.toFixed(1)} level=${a.level.toFixed(4)}`);
  return ok;
}
const phase = (p) => p.evaluate(() => window.__rrx.S.st?.phase);
(async () => {
  let srv = null;
  if (!process.env.BASE) {
    srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), TIME_SCALE: '0.3', GRACE_MS: '500' }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/healthz'); break; } catch { await sleep(100); } }
  }
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  const mk = async (name, mobile) => {
    const c = await browser.createBrowserContext(); const p = await c.newPage();
    if (mobile) await p.emulate(IPHONE); else await p.setViewport({ width: 1200, height: 820 });
    await p.evaluateOnNewDocument(INSTRUMENT);
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); p.name = name; p.mobile = mobile;
    p.tapEl = (sel) => (mobile ? p.tap(sel) : p.click(sel));
    return p;
  };
  const answerAll = async (p) => { while (await p.$('#answer-input')) { await p.tapEl('#answer-input'); await p.type('#answer-input', p.name + ' says hi'); await p.tapEl('#answer-submit'); await sleep(400); } };
  try {
    const host = await mk('host', false);
    await host.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await host.click('#name-input'); await sleep(800);
    await check('home screen (desktop, after 1st tap)', host, 'lobby');
    await host.type('#name-input', 'AudioRex'); await host.click('#create-btn');
    await host.waitForSelector('#screen-lobby:not(.hidden)'); const code = await host.$eval('#lobby-code', e => e.textContent);
    const p2 = await mk('phone', true), p3 = await mk('laptop', false);
    for (const [p, n] of [[p2, 'PhoneDino'], [p3, 'LaptopDino']]) {
      await p.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle2' });
      await p.tapEl('#name-input'); await p.type('#name-input', n); await p.tapEl('#join-form button');
      await p.waitForSelector('#screen-lobby:not(.hidden)');
    }
    await sleep(1000);
    await check('lobby: host', host, 'lobby');
    await check('lobby: phone via /r/CODE', p2, 'lobby');
    const players = [host, p2, p3];
    await host.click('[data-pace="chill"]'); await sleep(300);
    await host.click('#start-btn');
    await Promise.all(players.map(p => p.waitForSelector('#answer-input', { timeout: 15000 })));
    await sleep(600);
    await check('answering: host', host, 'play');
    await check('answering: phone', p2, 'play', 800);
    await answerAll(p2); await answerAll(p3);
    await host.waitForFunction(() => window.__rrx.S.st.game.deadline - Date.now() < 8000, { timeout: 60000 });
    await sleep(300);
    await check('answering, last 10s: host (tension)', host, 'tense', 900);
    await answerAll(host);
    await host.waitForFunction(() => window.__rrx.S.st.phase === 'vote', { timeout: 15000 });
    await sleep(500);
    await check('voting: host', host, 'vote', 900);
    await check('voting: phone', p2, 'vote', 900);
    // drive the rest: vote via UI, host skips results/scores
    let checkedScores = false, checkedResult = false;
    for (let k = 0; k < 600; k++) {
      const ph = await phase(host);
      if (ph === 'end') break;
      if (ph === 'result' && !checkedResult) { checkedResult = true; await check('result reveal: phone', p2, 'vote', 800); }
      if (ph === 'scores' && !checkedScores) { checkedScores = true; await sleep(300); await check('scoreboard: host', host, 'podium', 900); await check('scoreboard: phone', p2, 'podium', 800); }
      for (const p of players) {
        try {
          if (await p.$('#answer-input')) await answerAll(p);
          const v = await p.$('.answer-opt:not(:disabled)'); if (v) await v.click();
          const f = await p.$$('.final-opt:not(.own):not(:disabled):not(.picked)'); if (f.length && await p.$('#final-submit:not(.hidden)')) { await f[0].click(); await p.click('#final-submit'); }
        } catch { /* re-rendered */ }
      }
      if (['result', 'scores', 'fresult', 'intro'].includes(ph)) { const n = await host.$('[data-next]'); if (n) await n.click().catch(() => {}); }
      await sleep(200);
    }
    await Promise.all(players.map(p => p.waitForSelector('.end', { timeout: 30000 })));
    await sleep(1500);
    await check('winner: host', host, 'podium');
    await check('winner: phone', p2, 'podium');
    await host.evaluate(() => Sfx._debug.ctx().suspend()); await sleep(300);
    await host.click('.winner-name'); await sleep(900);
    await check('recovery after suspend + tap (winner)', host, 'podium');
    await host.click('#again-btn');
    await Promise.all(players.map(p => p.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 10000 })));
    await sleep(1600);
    await check('play again -> lobby (host)', host, 'lobby');
    await check('play again -> lobby (phone)', p2, 'lobby');
  } catch (e) { console.error('ERROR', e.message); results.push({ label: 'script', ok: false }); }
  if (errors.length) { console.log('page errors:', errors); results.push({ label: 'page errors', ok: false }); }
  const bad = results.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} FAILED: ${bad.map(b => b.label).join(', ')}` : `\nALL ${results.length} CHECKS PASSED`);
  await browser.close(); if (srv) srv.kill(); process.exit(bad.length ? 1 : 0);
})();
