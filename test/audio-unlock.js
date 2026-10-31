// Regression test for "lobby music doesn't play": real Chrome WITHOUT the autoplay override, so the
// normal gesture rules apply. Host creates on desktop; a phone joins through the /r/CODE link with
// touch taps. Both must hear the lobby loop, and it must come back after the audio gets
// suspended/interrupted (switching apps to text the link, a phone call, the lock screen...).
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const PORT = 4792, BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const IPHONE = { viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

async function audio(page) {
  return page.evaluate(async () => { const lv = []; for (let i = 0; i < 12; i++) { lv.push(Sfx.level()); await new Promise(r => setTimeout(r, 60)); } return { ...Sfx.state(), peak: Math.max(...lv) }; });
}
function check(who, a) {
  console.log(`  ${who}: running=${a.running} track=${a.track} level=${a.peak.toFixed(4)}`);
  if (!a.running || a.track !== 'lobby' || !(a.peak > 0.0005)) throw new Error(`${who}: lobby music not playing`);
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/healthz'); break; } catch { await sleep(100); } }
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const errors = [];
    const mk = async (name, mobile) => {
      const c = await browser.createBrowserContext(); const p = await c.newPage();
      if (mobile) await p.emulate(IPHONE); else await p.setViewport({ width: 1200, height: 800 });
      p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); return p;
    };
    const host = await mk('host', false);
    await host.goto(BASE, { waitUntil: 'networkidle2' });
    const pre = await host.evaluate(() => Sfx.state());
    if (pre.running) throw new Error('audio should wait for a gesture');
    if (!(await host.$eval('#mute-btn', b => b.classList.contains('needs-tap')))) throw new Error('no tap-to-start nudge');
    
    await host.type('#name-input', 'Mike'); await host.click('#create-btn');
    await host.waitForSelector('#screen-lobby:not(.hidden)'); await sleep(1200);
    const code = await host.$eval('#lobby-code', e => e.textContent);
    check('host (desktop) in lobby', await audio(host));

    const phone = await mk('phone', true);
    await phone.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle2' });
    await phone.tap('#name-input'); await phone.type('#name-input', 'Sarah');
    await phone.tap('#join-form button');
    await phone.waitForSelector('#screen-lobby:not(.hidden)'); await sleep(1200);
    check('joiner (phone, via /r/' + code + ') in lobby', await audio(phone));
    if (await phone.$eval('#mute-btn', b => b.classList.contains('needs-tap'))) throw new Error('nudge still showing while playing');

    // audio gets suspended (app switch / call); any later tap in the lobby must bring the music back
    for (const [who, p, tap] of [['phone', phone, () => phone.tap('#lobby-code')], ['host', host, () => host.click('#lobby-code')]]) {
      await p.evaluate(() => Sfx._debug.ctx().suspend()); await sleep(200);
      if ((await p.evaluate(() => Sfx.state())).running) throw new Error('suspend did not take');
      await tap(); await sleep(900);
      check(`${who} after interruption + tap`, await audio(p));
    }
    // page refresh while in the room: silently rejoins, first tap anywhere starts the lobby music
    await phone.reload({ waitUntil: 'networkidle2' });
    await phone.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 5000 });
    await phone.tap('#lobby-code'); await sleep(1000);
    check('phone after refresh + one tap', await audio(phone));

    if (errors.length) throw new Error('page errors: ' + errors.join('; '));
    console.log('audio unlock: all good');
    await browser.close(); srv.kill(); process.exit(0);
  } catch (e) {
    console.error('FAILED', e); if (browser) await browser.close().catch(() => {}); srv.kill(); process.exit(1);
  }
})();
