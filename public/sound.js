// Rochasaurus Rex audio engine. Everything here is synthesized live with the Web Audio API:
// original music loops (step sequencer + lookahead scheduler) and sound effects. No audio files.
window.Sfx = (() => {
  'use strict';
  // ---------- settings (persisted) ----------
  const KEY = 'rrx-audio';
  const settings = (() => {
    const d = { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8 };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s) return { ...d, ...s };
    } catch { /* ignore */ }
    return d;
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(api.state()); } catch { /* ignore */ } });

  // ---------- graph ----------
  let ctx = null, master, musicBus, duckGain, sfxBus, noiseBuf, meter;
  let wanted = null;       // track the game wants ('lobby' | 'play' | 'vote' | 'podium')
  let tense = false;       // suspense overlay requested
  let lastSfx = -1;
  const MUSIC_SCALE = 0.7; // music sits well under the sfx

  // Resume a context that isn't running. Safari also has an 'interrupted' state (after a phone call,
  // Siri, the lock screen or switching apps), so treat anything but 'running' as needing a resume.
  function wake() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || document.hidden) return;
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }
  function ac() {
    if (ctx) { wake(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { ctx = null; return null; } }
    // when the context (re)starts, make sure the wanted track is actually playing and the UI knows
    ctx.onstatechange = () => { if (ctx.state === 'running') syncTrack(); emit(); };
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14; master.knee.value = 10; master.ratio.value = 4; master.attack.value = 0.004; master.release.value = 0.2;
    master.connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    duckGain = ctx.createGain(); duckGain.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(duckGain);
    sfxBus = ctx.createGain(); sfxBus.gain.value = settings.sfx ? settings.sfxVol : 0; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    applyMusicVol(0.8);
    wake();
    startScheduler();
    syncTrack();
    emit();
    return ctx;
  }
  const now = () => (ctx ? ctx.currentTime : 0);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function applyMusicVol(fade = 0.4) {
    if (!ctx) return; const t = now();
    const v = settings.music ? settings.musicVol * MUSIC_SCALE : 0;
    musicBus.gain.cancelScheduledValues(t); musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(v, t + fade);
  }
  function applySfxVol() {
    if (!ctx) return; const t = now();
    sfxBus.gain.cancelScheduledValues(t); sfxBus.gain.setTargetAtTime(settings.sfx ? settings.sfxVol : 0, t, 0.03);
  }
  function duck(amount = 0.35, hold = 1.2) {
    if (!ctx || !settings.music) return; const t = now(), g = duckGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.08); g.setValueAtTime(amount, t + hold); g.linearRampToValueAtTime(1, t + hold + 0.9);
  }

  // ---------- instruments (dest = a GainNode) ----------
  function env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  function osc(type, freq, t, stop, dest, detune = 0) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (detune) o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(stop); return o;
  }
  function lp(freq, dest, q = 0.7) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q; f.connect(dest); return f; }
  function noise(t, dur, dest) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02); return s; }

  const I = {
    // ukulele-ish pluck: bright attack, quick decay
    pluck(dest, m, t, vol = 0.12, dec = 0.45) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.004, vol, dec);
      const f = lp(3200, g); f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(900, t + dec);
      osc('triangle', mtof(m), t, t + dec + 0.05, f); osc('sawtooth', mtof(m), t, t + dec + 0.05, lp(1800, g), 4);
    },
    // soft glockenspiel bell
    bell(dest, m, t, vol = 0.07, dec = 0.9) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.003, vol, dec);
      osc('sine', mtof(m), t, t + dec + 0.05, g);
      const g2 = ctx.createGain(); g2.connect(dest); env(g2, t, 0.002, vol * 0.35, dec * 0.35);
      osc('sine', mtof(m) * 2.76, t, t + dec, g2);
    },
    chip(dest, m, t, dur, vol = 0.05, type = 'square', cutoff = 2600) {
      const g = ctx.createGain(); g.connect(dest);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.setValueAtTime(vol * 0.7, t + Math.max(0.01, dur * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc(type, mtof(m), t, t + dur + 0.02, lp(cutoff, g));
    },
    bass(dest, m, t, dur, vol = 0.16, type = 'triangle', cutoff = 900) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.006, vol, dur, 0.0001);
      osc(type, mtof(m), t, t + dur + 0.03, lp(cutoff, g));
      if (type === 'triangle') osc('sine', mtof(m - 12), t, t + dur + 0.03, g);
    },
    brass(dest, notes, t, dur, vol = 0.06, bright = 2200) {
      const g = ctx.createGain(); g.connect(dest);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.025);
      g.gain.setValueAtTime(vol * 0.8, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.5; f.connect(g);
      f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(bright, t + 0.05); f.frequency.exponentialRampToValueAtTime(bright * 0.5, t + dur);
      notes.forEach(m => { osc('sawtooth', mtof(m), t, t + dur + 0.02, f, -6); osc('sawtooth', mtof(m), t, t + dur + 0.02, f, 7); });
    },
    // mellow electric-piano comp
    keys(dest, notes, t, dur, vol = 0.02) {
      notes.forEach(m => {
        const g = ctx.createGain(); g.connect(dest); env(g, t, 0.01, vol, dur);
        osc('sine', mtof(m), t, t + dur + 0.05, g);
        const g2 = ctx.createGain(); g2.connect(dest); env(g2, t, 0.004, vol * 0.4, dur * 0.3);
        osc('triangle', mtof(m) * 2, t, t + dur, g2);
      });
    },
    kick(dest, t, vol = 0.5) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.002, vol, 0.22);
      const o = osc('sine', 150, t, t + 0.25, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    },
    snare(dest, t, vol = 0.16, dec = 0.13, tone = 1800) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.002, vol, dec);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = tone; f.Q.value = 0.8; f.connect(g);
      noise(t, dec + 0.02, f);
      const g2 = ctx.createGain(); g2.connect(dest); env(g2, t, 0.002, vol * 0.5, 0.06);
      osc('triangle', 220, t, t + 0.08, g2);
    },
    hat(dest, t, vol = 0.05, dec = 0.035) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.001, vol, dec);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500; f.connect(g);
      noise(t, dec + 0.02, f);
    },
    shaker(dest, t, vol = 0.03) {
      const g = ctx.createGain(); g.connect(dest); env(g, t, 0.012, vol, 0.05);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 1.2; f.connect(g);
      noise(t, 0.08, f);
    },
  };

  // ---------- tiny seeded RNG so loops repeat identically ----------
  const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // ---------- music tracks ----------
  // Each track: bpm, swing (0..0.33), and step(v, i, t, s16) called for every 16th note i.
  const TRACKS = {
    // Prehistoric jungle groove for home + lobby: marimba, log drums, a lazy bass (G major, G Em C D)
    lobby: {
      bpm: 100, swing: 0.18,
      chords: [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]],
      roots: [43, 40, 36, 38],
      riff: [[0, 2, 1, 2], [2, 1, 0, 1], [0, 1, 2, 1], [2, 0, 1, 2]],
      step(v, i, t, s16) {
        const bar = Math.floor(i / 16), k = i % 16, c = bar % 4, ch = this.chords[c];
        // marimba = short bell + pluck blend
        if (k % 2 === 0 && k !== 6 && k !== 14) {
          const n = ch[this.riff[c][(k / 2) % 4]] + 12;
          I.bell(v.out, n + (k === 8 ? 12 : 0), t, 0.032, 0.32); I.pluck(v.out, n, t, 0.03, 0.22);
        }
        if (k === 0) I.bass(v.out, this.roots[c], t, s16 * 5, 0.14, 'sine', 500);
        if (k === 6) I.bass(v.out, this.roots[c] + 7, t, s16 * 2, 0.1, 'sine', 500);
        if (k === 10) I.bass(v.out, this.roots[c] + 12, t, s16 * 3, 0.09, 'sine', 500);
        // log drums
        if (k === 0 || k === 7 || k === 10) { const g = ctx.createGain(); g.connect(v.out); env(g, t, 0.003, k === 0 ? 0.16 : 0.1, 0.14); const o = osc('sine', k === 0 ? 180 : 260, t, t + 0.18, g); o.frequency.exponentialRampToValueAtTime(k === 0 ? 120 : 190, t + 0.12); }
        if (k % 4 === 2) I.shaker(v.out, t, 0.026);
        if (k === 4 || k === 12) I.snare(v.out, t, 0.03, 0.05, 3200);
        // bird-whistle answer every 4 bars
        if (bar % 4 === 3 && (k === 8 || k === 11)) { const g = ctx.createGain(); g.connect(v.out); env(g, t, 0.01, 0.018, 0.16); const o = osc('sine', mtof(k === 8 ? 86 : 91), t, t + 0.2, g); o.frequency.exponentialRampToValueAtTime(mtof(k === 8 ? 91 : 88), t + 0.14); }
      },
    },
    // Upbeat chiptune party loop for writing/drawing (C major, C G Am F)
    play: {
      bpm: 126, swing: 0,
      chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
      roots: [36, 43, 45, 41],
      melody: [
        [72, 76, 79, 76, 77, 76, 74, 72], [71, 74, 79, 74, 76, 74, 71, 67],
        [69, 72, 76, 72, 74, 72, 71, 69], [65, 69, 72, 77, 76, 74, 72, null],
      ],
      step(v, i, t, s16) {
        const bar = Math.floor(i / 16), k = i % 16, c = bar % 4, ch = this.chords[c];
        // 16th arpeggio
        const arp = [0, 1, 2, 1]; I.chip(v.out, ch[arp[k % 4]] + 12 + (k >= 8 && k % 4 === 2 ? 12 : 0), t, s16 * 0.9, 0.018, 'square', 3000);
        // bouncy octave bass
        if (k % 2 === 0) I.bass(v.out, this.roots[c] + (k % 4 === 2 ? 12 : 0), t, s16 * 1.6, 0.12, 'triangle', 1100);
        if (k % 4 === 0) I.kick(v.out, t, 0.32);
        if (k === 4 || k === 12) I.snare(v.out, t, 0.09);
        if (k % 4 === 2) I.hat(v.out, t, 0.035);
        // lead: phrase A plays the tune, phrase B leaves room with long chord tones
        if (k % 2 === 0) {
          const phraseB = Math.floor(bar / 4) % 2 === 1;
          const n = this.melody[c][k / 2];
          if (!phraseB && n) I.chip(v.out, n, t, s16 * 1.7, 0.03, 'square', 2400);
          if (phraseB && (k === 0 || k === 8)) I.chip(v.out, ch[k === 0 ? 2 : 1] + 12, t, s16 * 7, 0.022, 'triangle', 2600);
        }
      },
    },
    // Suspense version: C minor, faster, pulsing bass, rising ostinato
    tense: {
      bpm: 150, swing: 0,
      chords: [[48, 51, 55], [48, 51, 55], [44, 48, 51], [43, 47, 50]],
      roots: [36, 36, 32, 31],
      step(v, i, t, s16) {
        const bar = Math.floor(i / 16), k = i % 16, c = bar % 4, ch = this.chords[c];
        const lift = Math.min(6, Math.floor(bar / 2)); // climbs a semitone every 2 bars
        I.bass(v.out, this.roots[c], t, s16 * 0.8, k % 4 === 0 ? 0.17 : 0.1, 'sawtooth', 380 + lift * 60);
        if (k % 4 === 0) I.kick(v.out, t, 0.36);
        if (k === 12) I.snare(v.out, t, 0.08, 0.1);
        I.hat(v.out, t, k % 2 ? 0.02 : 0.035, 0.025);
        if (k % 2 === 0) { const o = [0, 1, 2, 1][(k / 2) % 4]; I.chip(v.out, ch[o] + 24 + lift, t, s16 * 1.2, 0.026, 'square', 2200 + lift * 200); }
        if (k === 0) { // rising whistle each bar, louder as it goes
          const g = ctx.createGain(); g.connect(v.out); const d = s16 * 16;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.008 + lift * 0.003, t + d * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          const o = osc('sine', mtof(79 + lift), t, t + d + 0.02, g); o.frequency.exponentialRampToValueAtTime(mtof(86 + lift), t + d);
        }
      },
    },
    // Game-show swing for the head-to-head votes (Bb: Bb6 Gm7 Cm7 F7)
    vote: {
      bpm: 108, swing: 0.22,
      chords: [[58, 62, 65, 67], [55, 58, 62, 65], [51, 55, 58, 60], [53, 57, 60, 63]],
      roots: [46, 43, 48, 41],
      walk: [[0, 4, 7, 9], [0, 3, 7, 10], [0, 3, 7, 5], [0, 4, 7, 6]],
      step(v, i, t, s16) {
        const bar = Math.floor(i / 16), k = i % 16, c = bar % 4, ch = this.chords[c];
        if (k % 4 === 0) {
          const r = this.roots[c]; let n = r + this.walk[c][k / 4];
          if (k === 12) n = this.roots[(c + 1) % 4] + (c % 2 ? -1 : 1); // chromatic approach
          I.bass(v.out, n, t, s16 * 3.9, 0.15, 'triangle', 1000);
        }
        if (k === 0) I.keys(v.out, ch, t, s16 * 9, 0.016);
        if (k === 10) I.keys(v.out, ch, t, s16 * 6, 0.012);
        if (k === 6 || k === 14) I.brass(v.out, ch, t, s16 * 1.2, 0.026, 2400);
        if (k === 4 || k === 12) I.snare(v.out, t, 0.07, 0.08, 2400);
        if (k === 0 || k === 10) I.kick(v.out, t, 0.28);
        if (k % 4 === 0 || k % 4 === 2) I.hat(v.out, t, k % 4 === 0 ? 0.03 : 0.02);
        if (bar % 4 === 3 && k >= 8 && k % 2 === 0) I.brass(v.out, [[70, 72, 74, 77][(k - 8) / 2]], t, s16 * 1.4, 0.03, 3000);
        if (bar % 8 === 0 && k === 0) I.bell(v.out, 82, t, 0.03, 1.2);
      },
    },
    // Triumphant stomping march for the scoreboard + winner (D major)
    podium: {
      bpm: 112, swing: 0,
      chords: [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]],
      roots: [38, 35, 31, 33],
      tune: [[74, null, 78, 81, 78, null, 76, 74], [71, null, 74, 78, 76, null, 74, 71], [67, 71, 74, 79, 78, 76, 74, null], [69, 73, 76, 81, 79, 78, 76, 73]],
      step(v, i, t, s16) {
        const bar = Math.floor(i / 16), k = i % 16, c = bar % 4, ch = this.chords[c];
        if (k === 0 || k === 8) I.kick(v.out, t, 0.4);          // dino stomps
        if (k === 4 || k === 12) { I.snare(v.out, t, 0.1, 0.12); I.kick(v.out, t, 0.18); }
        if (k % 2 === 0) I.hat(v.out, t, 0.025);
        if (k % 4 === 0) I.bass(v.out, this.roots[c] + (k === 8 ? 7 : 0), t, s16 * 3.5, 0.15, 'triangle', 1000);
        if (k === 0) I.brass(v.out, ch, t, s16 * 3, 0.035, 2600);
        if (k === 6 || k === 10) I.brass(v.out, ch, t, s16 * 1.2, 0.025, 2400);
        if (k % 2 === 0) { const n = this.tune[c][k / 2]; if (n && Math.floor(bar / 4) % 2 === 0) I.chip(v.out, n, t, s16 * 1.8, 0.026, 'square', 2600); else if (n && k % 4 === 0) I.bell(v.out, n + 12, t, 0.03, 0.6); }
      },
    },
  };

  // ---------- scheduler with crossfading voices ----------
  const voices = []; // { name, track, out, i, next, stopAt }
  let timerId = null;
  function startScheduler() {
    if (timerId) return;
    timerId = setInterval(tick, 25);
  }
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const t0 = now(), ahead = 0.14;
    for (let n = voices.length - 1; n >= 0; n--) {
      const v = voices[n];
      if (v.stopAt && t0 > v.stopAt) { try { v.out.disconnect(); } catch { /* ignore */ } voices.splice(n, 1); continue; }
      const s16 = 60 / v.track.bpm / 4;
      if (v.next < t0 - 0.05) v.next = t0 + 0.03; // tab was asleep: skip instead of piling up
      while (v.next < t0 + ahead && (!v.stopAt || v.next < v.stopAt)) {
        const swing = (v.i % 4 === 2) ? v.track.swing * s16 * 2 : 0;
        if (settings.music) { try { v.track.step(v, v.i, v.next + swing, s16); } catch { /* never let music break the game */ } }
        v.i++; v.next += s16;
      }
    }
  }
  function currentName() { return (wanted === 'play' || wanted === 'vote') && tense ? 'tense' : wanted; }
  function syncTrack() {
    if (!ctx) return;
    const name = currentName();
    const live = voices.find(v => !v.stopAt);
    if (live && live.name === name) return;
    const t = now();
    const fade = (name === 'tense' || live?.name === 'tense') ? 0.7 : 1.4;
    if (live) {
      live.stopAt = t + fade + 0.05;
      live.out.gain.cancelScheduledValues(t); live.out.gain.setValueAtTime(live.out.gain.value, t);
      live.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    }
    if (!name) { emit(); return; }
    const out = ctx.createGain(); out.connect(musicBus);
    out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(1, t + fade);
    // start on the next 16th of the old voice's grid (if any) so the hand-off feels in time
    voices.push({ name, track: TRACKS[name], out, i: 0, next: t + 0.06, stopAt: 0 });
    emit();
  }

  // ---------- sfx ----------
  function sfxReady() { if (!settings.sfx) return false; if (!ac()) return false; lastSfx = now(); return true; }
  function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0, dest } = {}) {
    const t = now() + delay; const g = ctx.createGain(); g.connect(dest || sfxBus);
    env(g, t, 0.008, vol, dur);
    const o = osc(type, freq, t, t + dur + 0.03, g);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  }
  // a cute chibi "RAWR": buzzy saw voice through moving vowel formants, plus breath noise
  function roar(delay = 0, size = 1) {
    const t = now() + delay, d = 0.62 * size, g = ctx.createGain(); g.connect(sfxBus);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.05); g.gain.setValueAtTime(0.14, t + d * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 3; f1.connect(g);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 5; f2.connect(g);
    f1.frequency.setValueAtTime(500, t); f1.frequency.linearRampToValueAtTime(850, t + d * 0.35); f1.frequency.linearRampToValueAtTime(600, t + d);
    f2.frequency.setValueAtTime(1100, t); f2.frequency.linearRampToValueAtTime(1500, t + d * 0.35); f2.frequency.linearRampToValueAtTime(1000, t + d);
    const base = 210 / size;
    [0, 9, -11].forEach(det => { const o = osc('sawtooth', base, t, t + d + 0.02, f1, det); o.connect(f2); o.frequency.linearRampToValueAtTime(base * 1.25, t + d * 0.3); o.frequency.exponentialRampToValueAtTime(base * 0.62, t + d);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 34; const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + d + 0.02); });
    const ng = ctx.createGain(); ng.connect(sfxBus); env(ng, t, 0.04, 0.05, d);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8; nf.connect(ng); noise(t, d, nf);
  }
  function drumroll(dur = 1.1, delay = 0) {
    const t0 = now() + delay;
    for (let x = 0; x < dur; x += 0.032) I.snare(sfxBus, t0 + x, 0.03 + 0.11 * (x / dur), 0.06, 1900);
  }
  function tada(delay = 0) {
    const t = now() + delay;
    I.brass(sfxBus, [70, 74, 77], t, 0.13, 0.09, 3200);
    I.brass(sfxBus, [70, 74, 77, 82], t + 0.16, 0.9, 0.1, 3400);
    I.kick(sfxBus, t + 0.16, 0.5);
    const g = ctx.createGain(); g.connect(sfxBus); env(g, t + 0.16, 0.004, 0.07, 1.3);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000; f.connect(g); noise(t + 0.16, 1.4, f);
  }

  const api = {
    // ----- state + controls -----
    get muted() { return !settings.sfx && !settings.music; },
    state() { return { ...settings, running: !!ctx && ctx.state === 'running', track: currentName(), voices: voices.length }; },
    onChange(fn) { listeners.add(fn); },
    unlock() { onGesture(); },
    _debug: { ctx: () => ctx, master: () => master },
    level() { // RMS of the final mix, for tests/visual meters
      if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a);
      let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * a[i]; return Math.sqrt(sum / a.length);
    },
    setMusic(on) { settings.music = !!on; save(); applyMusicVol(0.6); emit(); },
    setSfx(on) { settings.sfx = !!on; save(); applySfxVol(); emit(); if (on) api.pop(); },
    setMusicVol(v) { settings.musicVol = Math.min(1, Math.max(0, +v)); if (settings.musicVol > 0 && !settings.music) settings.music = true; save(); applyMusicVol(0.15); emit(); },
    setSfxVol(v) { settings.sfxVol = Math.min(1, Math.max(0, +v)); if (settings.sfxVol > 0 && !settings.sfx) settings.sfx = true; save(); applySfxVol(); emit(); },
    toggle() { const off = !api.muted; settings.music = !off; settings.sfx = !off; save(); applyMusicVol(); applySfxVol(); emit(); return off; },
    // ----- music -----
    music(name) { if (name && !TRACKS[name]) return; wanted = name || null; if (wanted !== 'play' && wanted !== 'vote') tense = false; syncTrack(); },
    tension(on) { on = !!on; if (on === tense) return; tense = on; syncTrack(); },
    // ----- sfx -----
    click() { if (!settings.sfx || !ctx || now() - lastSfx < 0.04) return; lastSfx = now(); tone(2300, 0.025, { type: 'triangle', vol: 0.03 }); },
    pop() { if (!sfxReady()) return; tone(520, 0.09, { type: 'triangle', slide: 300 }); },
    react() { if (!sfxReady()) return; const f = 480 + Math.random() * 420; tone(f, 0.08, { type: 'sine', vol: 0.14, slide: f * 0.9 }); tone(f * 2, 0.05, { type: 'triangle', vol: 0.04, delay: 0.03 }); },
    join() { if (!sfxReady()) return; I.bell(sfxBus, 88, now(), 0.12, 0.6); I.bell(sfxBus, 91, now() + 0.09, 0.12, 0.8); },
    leave() { if (!sfxReady()) return; I.bell(sfxBus, 91, now(), 0.1, 0.5); I.bell(sfxBus, 84, now() + 0.11, 0.1, 0.7); },
    send() { // submit: juicy pop + sparkle
      if (!sfxReady()) return;
      tone(380, 0.1, { type: 'sine', vol: 0.2, slide: 700 });
      I.bell(sfxBus, 96, now() + 0.07, 0.06, 0.4); I.bell(sfxBus, 100, now() + 0.13, 0.05, 0.5);
    },
    tick(secsLeft = 5) {
      if (!sfxReady()) return; const t = now();
      if (secsLeft <= 3) { tone(1900, 0.06, { type: 'square', vol: 0.11 }); tone(950, 0.08, { type: 'triangle', vol: 0.12 }); }
      else if (secsLeft <= 5) { tone(1500, 0.05, { type: 'square', vol: 0.075 }); }
      else { const g = ctx.createGain(); g.connect(sfxBus); env(g, t, 0.001, 0.09, 0.05); osc('triangle', 1150, t, t + 0.07, lp(3000, g)); }
    },
    timesUp() { // buzzer + rooster crow
      if (!sfxReady()) return; duck(0.25, 1.6);
      const t = now(); const g = ctx.createGain(); g.connect(sfxBus);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.setValueAtTime(0.12, t + 0.32); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      const f = lp(1300, g); osc('sawtooth', 110, t, t + 0.45, f); osc('sawtooth', 116.5, t, t + 0.45, f); osc('square', 55, t, t + 0.45, f);
      roar(0.45);
    },
    step() { // whoosh + page flip between rounds
      if (!sfxReady()) return; const t = now();
      const g = ctx.createGain(); g.connect(sfxBus);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.16); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4; bp.connect(g);
      bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.38); noise(t, 0.45, bp);
      [0.3, 0.37].forEach((d, j) => { const g2 = ctx.createGain(); g2.connect(sfxBus); env(g2, t + d, 0.002, 0.12 - j * 0.04, 0.05);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200; hp.connect(g2); noise(t + d, 0.06, hp); });
      I.bell(sfxBus, 84, t + 0.36, 0.05, 0.4);
    },
    start() { // game start fanfare
      if (!sfxReady()) return; duck(0.3, 1.6); const t = now();
      [[60, 0], [64, 0.11], [67, 0.22]].forEach(([m, d]) => I.brass(sfxBus, [m, m + 12], t + d, 0.1, 0.08, 3000));
      I.brass(sfxBus, [60, 64, 67, 72], t + 0.36, 0.85, 0.1, 3400);
      for (let x = 0; x < 0.34; x += 0.035) I.snare(sfxBus, t + x, 0.03 + x * 0.2, 0.05);
      I.kick(sfxBus, t + 0.36, 0.5); I.snare(sfxBus, t + 0.36, 0.14, 0.2);
    },
    roar(size = 1) { if (!sfxReady()) return; duck(0.35, 1); roar(0, size); },
    vote() { // satisfying "ka-chunk" + bell when a vote locks in
      if (!sfxReady()) return; const t = now();
      I.kick(sfxBus, t, 0.25); tone(660, 0.08, { type: 'square', vol: 0.06 }); I.bell(sfxBus, 91, t + 0.05, 0.09, 0.5); I.bell(sfxBus, 98, t + 0.11, 0.07, 0.6);
    },
    versus() { // matchup intro: whoosh + hit
      if (!sfxReady()) return; const t = now();
      const g = ctx.createGain(); g.connect(sfxBus); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.connect(g); bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4000, t + 0.3); noise(t, 0.36, bp);
      I.kick(sfxBus, t + 0.3, 0.55); I.brass(sfxBus, [50, 57, 62], t + 0.3, 0.45, 0.07, 1800); I.snare(sfxBus, t + 0.3, 0.12, 0.25);
    },
    drumroll(d = 1) { if (!sfxReady()) return; duck(0.35, d + 0.4); drumroll(d); },
    reveal() { if (!sfxReady()) return; duck(0.35, 1.2); tada(0); },
    sweep() { // EXTINCTION! clean sweep: meteor whistle, boom, roar
      if (!sfxReady()) return; duck(0.2, 2.4); const t = now();
      const g = ctx.createGain(); g.connect(sfxBus); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      const o = osc('sine', 2400, t, t + 0.8, g); o.frequency.exponentialRampToValueAtTime(300, t + 0.72);
      const bg = ctx.createGain(); bg.connect(sfxBus); env(bg, t + 0.72, 0.005, 0.35, 0.9); const lpf = lp(500, bg); noise(t + 0.72, 1, lpf);
      I.kick(sfxBus, t + 0.72, 0.7); roar(1.0, 1.25);
    },
    jinx() { // boing-boing
      if (!sfxReady()) return; [0, 0.22].forEach((d, j) => { const t = now() + d; const g = ctx.createGain(); g.connect(sfxBus); env(g, t, 0.005, 0.14, 0.3);
        const o = osc('triangle', 180 + j * 60, t, t + 0.32, g); o.frequency.exponentialRampToValueAtTime(520 + j * 80, t + 0.12); o.frequency.exponentialRampToValueAtTime(220, t + 0.3); });
    },
    score() { if (!settings.sfx || !ctx || now() - lastSfx < 0.05) return; lastSfx = now(); tone(1200 + Math.random() * 400, 0.04, { type: 'square', vol: 0.03 }); },
    winner() { if (!sfxReady()) return; duck(0.25, 3); drumroll(1.3); tada(1.33); roar(2.2, 1.1); },
    safety() { if (!sfxReady()) return; tone(300, 0.12, { type: 'triangle', vol: 0.12, slide: -120 }); I.bell(sfxBus, 76, now() + 0.1, 0.08, 0.4); },
  };

  // ---------- unlocking (autoplay rules + iOS quirks) ----------
  // iOS routes Web Audio through the "ambient" audio session, so the ringer/silent switch mutes it
  // completely (music AND sfx). Asking for the "playback" session (Safari 16.4+) and keeping a
  // silent <audio> element playing (older iOS) moves the page to the media channel, which ignores
  // the switch, the same way YouTube/Spotify web do.
  function setSession() { try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* ignore */ } }
  let silentEl = null;
  function silentWavURL() { // 0.5 s of 8 kHz mono silence, built here so there is no extra file
    const n = 4000, b = new ArrayBuffer(44 + n), d = new DataView(b), w = (o, str) => { for (let i = 0; i < str.length; i++) d.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); d.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, 8000, true); d.setUint32(28, 8000, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true); w(36, 'data'); d.setUint32(40, n, true);
    for (let i = 0; i < n; i++) d.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function keepSilentTrack() {
    if (!isIOS || document.hidden || !(settings.music || settings.sfx)) return;
    try {
      if (!silentEl) {
        silentEl = document.createElement('audio');
        silentEl.setAttribute('playsinline', ''); silentEl.setAttribute('webkit-playsinline', ''); silentEl.setAttribute('x-webkit-airplay', 'deny');
        silentEl.preload = 'auto'; silentEl.loop = true; silentEl.src = silentWavURL();
      }
      if (silentEl.paused) { const p = silentEl.play(); if (p && p.catch) p.catch(() => {}); }
    } catch { /* ignore */ }
  }
  // a zero-length buffer started inside the gesture fully "unlocks" older WebKit
  let primed = false;
  function prime() {
    if (primed || !ctx) return;
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); primed = true; } catch { /* ignore */ }
  }
  // Every user gesture (not just the first) re-unlocks: on phones the first touch is often a
  // pointerdown/touchstart, which does NOT count as a gesture for audio, and after switching apps
  // (e.g. to text someone the room link) iOS leaves the context suspended/interrupted until the
  // next real gesture. Cheap when everything is already running.
  function onGesture() {
    setSession();
    ac(); prime(); keepSilentTrack();
    if (ctx && ctx.state === 'running') { syncTrack(); }
  }
  ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'].forEach(ev => window.addEventListener(ev, onGesture, { capture: true, passive: true }));
  setSession();
  function onVisible() {
    if (document.hidden) {
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
      if (silentEl && !silentEl.paused) { try { silentEl.pause(); } catch { /* ignore */ } }
    } else { wake(); keepSilentTrack(); }
  }
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', () => { if (!document.hidden) { wake(); keepSilentTrack(); } });
  window.addEventListener('focus', () => wake());
  return api;
})();
