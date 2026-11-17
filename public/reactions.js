// Reaction soundboard. One entry here is one button.
//
// Sounds are synthesized with the Web Audio API (see play()). There are no audio files,
// so nothing here is sampled from a recording and there is no license to track.
// How to add a sound: README section "Adding a reaction sound".
//
//   { id: 'boing', emoji: '🏀', label: 'Boing', play(fx) {
//     fx.tone({ freq: 180, slide: 500, dur: 0.16, vol: 0.2, type: 'triangle' });
//   } },
//
// id     unique short name the server broadcasts
// emoji  the button
// label  screen-reader name
// play   runs on every phone in the room. Helpers: fx.tone, fx.burst, fx.voice, fx.roar, fx.duck
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.REACTIONS = api;
})(typeof window !== 'undefined' ? window : null, function () {
  return [
    { id: 'plop', emoji: '💩', label: 'Plop', play(fx) {
      // cartoon plop: a bubble drops in pitch, then a wet splat and a smaller after-bubble
      fx.tone({ type: 'sine', freq: 540, slide: -450, dur: 0.16, vol: 0.3 });
      fx.tone({ type: 'sine', freq: 260, slide: -160, dur: 0.12, vol: 0.14, delay: 0.05 });
      fx.burst({ filter: 'lowpass', freq: 650, freqTo: 160, dur: 0.13, vol: 0.24, delay: 0.02, q: 0.9 });
      fx.tone({ type: 'sine', freq: 280, slide: -170, dur: 0.1, vol: 0.12, delay: 0.15 });
    } },
    { id: 'toot', emoji: '🍑', label: 'Squeak', play(fx) {
      // squeaky, airy, high whoopee-cushion: fluttering bandpass noise plus thin whistles
      fx.burst({ filter: 'bandpass', freq: 1500, freqTo: 2400, dur: 0.55, vol: 0.2, q: 6, flutter: 17, flutterDepth: 480, hold: true });
      fx.burst({ filter: 'highpass', freq: 2800, dur: 0.4, vol: 0.05, delay: 0.03, q: 0.6, hold: true });
      fx.tone({ type: 'sine', freq: 1280, slide: 820, dur: 0.11, vol: 0.05, delay: 0.02 });
      fx.tone({ type: 'sine', freq: 2100, slide: -700, dur: 0.14, vol: 0.045, delay: 0.2 });
      fx.tone({ type: 'triangle', freq: 1680, slide: 420, dur: 0.09, vol: 0.035, delay: 0.4 });
    } },
    { id: 'hoo', emoji: '🗣️', label: 'Hype shout', play(fx) {
      // long loud "YOOOOOO": a breathy H, then a bright glide into a big OO vowel
      fx.duck(0.5, 1.15);
      fx.burst({ filter: 'highpass', freq: 1400, dur: 0.07, vol: 0.09, q: 0.5 });
      fx.voice({ f0: 196, f0to: 294, dur: 1.2, vol: 0.2, f1: 480, f1to: 360, f2: 2100, f2to: 780, vibrato: 7, breath: 0.05 });
      fx.voice({ f0: 202, f0to: 288, dur: 1.16, vol: 0.11, delay: 0.02, f1: 500, f1to: 390, f2: 1900, f2to: 840, vibrato: 6 });
    } },
    { id: 'boo', emoji: '👎', label: 'Boo', play(fx) {
      // a small crowd falling into "BOOOOO"
      fx.duck(0.55, 1.05);
      [128, 146, 116, 162, 136, 108].forEach((f0, i) => {
        fx.voice({ f0, f0to: f0 * 0.76, dur: 1.05, vol: 0.065, delay: i * 0.04, f1: 420, f1to: 300, f2: 880, f2to: 680, vibrato: 4, breath: 0.03 });
      });
      fx.burst({ filter: 'lowpass', freq: 480, dur: 0.9, vol: 0.045, q: 0.4, hold: true });
    } },
    { id: 'yay', emoji: '👍', label: 'Cheer', play(fx) {
      // a small crowd rising into "YAYYYYY"
      fx.duck(0.55, 1);
      [247, 294, 330, 220, 370, 196].forEach((f0, i) => {
        fx.voice({ f0, f0to: f0 * 1.32, dur: 0.95, vol: 0.06, delay: i * 0.03, f1: 520, f1to: 820, f2: 2200, f2to: 1750, vibrato: 6, breath: 0.035 });
      });
      fx.burst({ filter: 'highpass', freq: 1700, dur: 0.8, vol: 0.05, delay: 0.04, q: 0.5, hold: true });
      fx.burst({ filter: 'bandpass', freq: 1500, dur: 0.045, vol: 0.12, q: 0.6 });
      fx.burst({ filter: 'bandpass', freq: 1800, dur: 0.04, vol: 0.09, delay: 0.13, q: 0.6 });
    } },
    { id: 'laugh', emoji: '😂', label: 'Laugh', play(fx) {
      [0, 0.11, 0.22, 0.34].forEach((delay, i) => {
        fx.voice({ f0: 300 + i * 36, f0to: 460 + i * 28, dur: 0.09, vol: 0.1, delay, f1: 720, f2: 1700, breath: 0.02 });
      });
    } },
    { id: 'fire', emoji: '🔥', label: 'Fire', play(fx) {
      fx.burst({ filter: 'bandpass', freq: 380, freqTo: 2600, dur: 0.42, vol: 0.16, q: 0.8, hold: true });
      fx.burst({ filter: 'highpass', freq: 3200, dur: 0.3, vol: 0.045, delay: 0.04 });
    } },
    { id: 'skull', emoji: '💀', label: 'Skull', play(fx) {
      fx.tone({ type: 'sine', freq: 196, slide: -130, dur: 0.42, vol: 0.22 });
      fx.tone({ type: 'triangle', freq: 98, slide: -40, dur: 0.5, vol: 0.1, delay: 0.02 });
      fx.burst({ filter: 'highpass', freq: 4200, dur: 0.07, vol: 0.05, delay: 0.04 });
    } },
    { id: 'clap', emoji: '👏', label: 'Clap', play(fx) {
      [0, 0.09, 0.17, 0.28].forEach((delay, i) => {
        fx.burst({ filter: 'bandpass', freq: 1700 + i * 80, dur: 0.035, vol: 0.2 - i * 0.02, delay, q: 0.55 });
      });
    } },
    { id: 'gasp', emoji: '😱', label: 'Gasp', play(fx) {
      fx.burst({ filter: 'bandpass', freq: 1200, freqTo: 3000, dur: 0.22, vol: 0.15, q: 2.2, hold: true });
      fx.tone({ type: 'sine', freq: 640, slide: 480, dur: 0.16, vol: 0.05 });
    } },
    { id: 'roar', emoji: '🦖', label: 'Roar', play(fx) {
      fx.duck(0.4, 0.8);
      fx.roar(0.7);
    } },
  ];
});
