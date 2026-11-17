# 🦖 Rochasaurus Rex

**Quip it. Vote it. Roar about it.**

A head-to-head funny-answer party game for **3–10 players**, played in the browser on everyone's phones. No accounts and no app: open the link, pick a nickname and a dino buddy, and join with a 4-letter room code.

Your host is **Rex**, a chibi T-rex with a microphone and tiny arms. RAWR means I love you. ♥

## How it plays

1. **Answer:** each round, every player gets **2 prompts**. Every prompt goes to exactly **2 players**, so type something funnier than your rival. If you're stuck, hit **🦺 Safety quip** (half points). If time runs out, whatever you typed is sent automatically, and blank answers get a safety quip.
2. **Vote:** the answers go head to head, one matchup at a time. Everyone *not* in that matchup (including the audience) picks the funnier one.
3. **Reveal:** authors are unmasked and points split by vote share (1,000 per matchup in round 1, 2,000 in round 2). Take every vote for an **☄️ EXTINCTION!** sweep bonus. Two identical answers are a **JINX** and score nothing.
4. **The Last Roar:** round 3 gives everyone the same prompt. Each player gets **3 votes** (no self-votes). Each vote is worth 400, and the crowd favorite gets +500.
5. **Winner:** a crowned dino, a podium, confetti, and the top quips of the game. Then **Play again**.

### Extras
- **300+ original prompts:** 240 *Family Classics* plus 60 optional *Hot Sauce* prompts (sassier, still clean), 36 final-round prompts and 50+ safety quips. Some prompts drop in a random player's name.
- **Custom prompts:** everyone can write up to 3 of their own in the lobby, or while they're waiting (after answering, between votes, on the scoreboard). They get mixed into an upcoming round. A player is not dealt their own prompt when another pairing is free, and the matchup is labeled “prompt by [name].”
- **Family filter** is off by default, so answers, prompts, and nicknames are shown as typed. The host can turn it on in the lobby to swap bad words for `#@$%&!`. Length limits and HTML stripping stay on either way.
- **Soundboard:** an emoji bar on every screen (lobby, answering, voting, and results). Tap one and the whole room hears it and sees the emoji float up. Each player can mute reaction sounds, and each player can send one about once a second. The clips are short public-domain recordings, decoded after the same audio unlock the music uses. Rex’s roar is still synthesized.
- **Audience:** late joiners and anyone past 10 players join as audience and can still vote; the audience together counts as one extra voter. On *Play again*, audience members take any free seats.
- **Big screen:** open `/tv/CODE` on a TV or laptop to show prompts, matchups and scores to the room.
- **Host tools:** pack, pace (chill / normal / hasty), family filter, kick, skip ahead.
- **Rejoin:** refresh or lose signal and you're put back in your seat.
- **Original music & SFX** generated live with Web Audio: jungle-marimba lobby, chiptune answering track, tension music for the last seconds, a voting swing, a podium march, and roars. It uses the mobile audio-unlock logic from Roch-a-Doodle (iOS/Android, app switching, lock screen).
- Reactions: 💩🍑🗣️👎👍 plus 😂🔥💀👏😱🦖 (the dino one roars). Buttons are listed in `public/reactions.js`. Sources and licenses are in `public/sounds/README.md`.

## Run it

```bash
npm install
npm start          # http://localhost:4848
```

Node 20+. Env options: `PORT`, `MIN_PLAYERS` (default 3), `TIME_SCALE` (speeds up every timer, used by the tests).

## Adding a reaction sound

Every soundboard button is one object in the `REACTIONS` list in `public/reactions.js`. Point `file` at a clip in `public/sounds/`, or use `play` to synthesize one. You can set both: the file plays, then `play` runs (handy for ducking the music under a recording).

A recorded clip:

```js
{ id: 'boing', emoji: '🏀', label: 'Boing', file: 'sounds/boing.mp3', duck: [0.5, 0.4] },
```

A synthesized sound:

```js
{ id: 'boing', emoji: '🏀', label: 'Boing', play(fx) {
  fx.tone({ freq: 180, slide: 500, dur: 0.16, vol: 0.2, type: 'triangle' });
} },
```

- `id` is a unique short name. The server only broadcasts ids from this list.
- `emoji` is the button. `label` is the screen-reader name.
- `file` is a path under `public/`, such as `sounds/boing.mp3`. The player requests it from the site root (`/sounds/boing.mp3`) so it still works on `/r/CODE`. After the audio unlock, every `file` is fetched and decoded into a Web Audio buffer, so the next tap starts immediately (including on mobile Safari).
- `duck` is an optional `[amount, hold]` pair. It dips the music the same way `fx.duck` does. `gain` is an optional level, default 1.
- `play` runs on every phone in the room when you want a synthesized sound. It receives `fx`:
  - `fx.tone({ freq, slide, dur, vol, type, delay })` — a note. `slide` is how many Hz the pitch moves.
  - `fx.burst({ freq, freqTo, dur, vol, delay, filter, q, flutter, flutterDepth, hold })` — a puff of noise. `filter` is `lowpass`, `highpass`, or `bandpass`.
  - `fx.voice({ f0, f0to, dur, vol, delay, f1, f1to, f2, f2to, vibrato, breath })` — a cartoon shout. `f0` is the pitch in Hz. `f1` and `f2` are vowel formants (`f2` near 800 is “oo”, near 2000 is “ee” / “ay”).
  - `fx.roar(size)` — Rex’s roar. `fx.duck(amount, hold)` — dip the music under a loud reaction.

Use a recording that is CC0 or public domain. Trim it to 2 seconds or less (a shout, boo, or cheer can run to about 2.5 seconds, and the peach fart runs to about 3), match its loudness to the other clips, and encode a small mono MP3 (128 kbps CBR decodes in Safari as well as Chrome and Firefox). Keep the file under 60KB. Add a row to `public/sounds/README.md` with the source URL and the license.

The new button shows up on the bar by itself. The first tap in the room unlocks audio on phones (including mobile Safari); the same unlock the music already uses. Buffers preload on that unlock.

The recorded set is a toilet plop (💩), a long wet fart with a squeaky tail (🍑), a whooping hype shout (🗣️), a crowd “boo” (👎), a group “yay” (👍), a laugh (😂), a fire whoosh (🔥), a bone crack (💀), clapping (👏), and a crowd gasp (😱). Rex (🦖) still uses the synthesized roar.

## Tests

```bash
npm test               # 77 socket-level checks: pairing 3–10 players, full 3- and 10-player games, scoring, sweeps, jinx, safety quips, audience, kick, rejoin, custom prompts, prompts written mid-game, play again, filter off by default, reaction broadcast and cooldown, and that every configured reaction file exists
npm run test:browser   # a full game through the real UI in headless Chrome (desktop host, 3 phones, big screen) with screenshots
npm run test:audio     # mobile audio-unlock regression (normal autoplay rules)
npm run test:audio-pages  # the right music actually plays on every screen
```

The browser tests need Chrome at `/usr/bin/google-chrome`.

## Deploy (Render)

`render.yaml` is included. Create a free **Web Service** from this repo with build `npm install`, start `npm start`, health check `/healthz`, and env `NODE_VERSION=20`.

---

All names, art, music, and prompts are original. The reaction recordings are CC0; see `public/sounds/README.md`.
