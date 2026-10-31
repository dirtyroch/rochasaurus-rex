# 🦖 Rochasaurus Rex

**Quip it. Vote it. Roar about it.**

A family-friendly, head-to-head funny-answer party game for **3–10 players**, played in the browser on everyone's phones. No accounts and no app: open the link, pick a nickname and a dino buddy, and join with a 4-letter room code.

Your host is **Rex**, a chibi T-rex with a microphone and tiny arms. RAWR means I love you. ♥

## How it plays

1. **Answer:** each round, every player gets **2 prompts**. Every prompt goes to exactly **2 players**, so type something funnier than your rival. If you're stuck, hit **🦺 Safety quip** (half points). If time runs out, whatever you typed is sent automatically, and blank answers get a safety quip.
2. **Vote:** the answers go head to head, one matchup at a time. Everyone *not* in that matchup (including the audience) picks the funnier one.
3. **Reveal:** authors are unmasked and points split by vote share (1,000 per matchup in round 1, 2,000 in round 2). Take every vote for an **☄️ EXTINCTION!** sweep bonus. Two identical answers are a **JINX** and score nothing.
4. **The Last Roar:** round 3 gives everyone the same prompt. Each player gets **3 votes** (no self-votes). Each vote is worth 400, and the crowd favorite gets +500.
5. **Winner:** a crowned dino, a podium, confetti, and the top quips of the game. Then **Play again**.

### Extras
- **300+ original prompts:** 240 *Family Classics* plus 60 optional *Hot Sauce* prompts (sassier, still clean), 36 final-round prompts and 50+ safety quips. Some prompts drop in a random player's name.
- **Custom prompts:** everyone can add up to 3 of their own in the lobby. They get mixed into rounds 1 and 2.
- **Family filter** (on by default, host can toggle) swaps bad words for `#@$%&!`. Names are always filtered.
- **Audience:** late joiners and anyone past 10 players join as audience and can still vote; the audience together counts as one extra voter. On *Play again*, audience members take any free seats.
- **Big screen:** open `/tv/CODE` on a TV or laptop to show prompts, matchups and scores to the room.
- **Host tools:** pack, pace (chill / normal / hasty), filter, kick, skip ahead.
- **Rejoin:** refresh or lose signal and you're put back in your seat.
- **Original music & SFX** generated live with Web Audio: jungle-marimba lobby, chiptune answering track, tension music for the last seconds, a voting swing, a podium march, and roars. It uses the mobile audio-unlock logic from Roch-a-Doodle (iOS/Android, app switching, lock screen).
- Reactions: 😂🔥💀👏😱🦖 (the dino one roars).

## Run it

```bash
npm install
npm start          # http://localhost:4848
```

Node 20+. Env options: `PORT`, `MIN_PLAYERS` (default 3), `TIME_SCALE` (speeds up every timer, used by the tests).

## Tests

```bash
npm test               # 50 socket-level checks: pairing 3–10 players, full 3- and 10-player games, scoring, sweeps, jinx, safety quips, audience, kick, rejoin, custom prompts, play again, filter
npm run test:browser   # a full game through the real UI in headless Chrome (desktop host, 3 phones, big screen) with screenshots
npm run test:audio     # mobile audio-unlock regression (normal autoplay rules)
npm run test:audio-pages  # the right music actually plays on every screen
```

The browser tests need Chrome at `/usr/bin/google-chrome`.

## Deploy (Render)

`render.yaml` is included. Create a free **Web Service** from this repo with build `npm install`, start `npm start`, health check `/healthz`, and env `NODE_VERSION=20`.

---

All names, art, music, and prompts are original.
