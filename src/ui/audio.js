// Synthesized sound effects (SPEC §11). WebAudio only, no files. The context is created on the first
// user gesture (G.Audio.unlock, also self-installed on pointerup/touchend/click/keydown — a touch pointerdown is not
// an activation-triggering event, so it cannot start an AudioContext on mobile). A suspended or iOS-'interrupted'
// context is resumed from the next gesture; resume() is never attempted from the rAF fx loop.
//   G.Audio.play(name, vol?)   name ∈ SOUNDS; the same sound plays at most once per THROTTLE_MS
//   G.Audio.fx(ev)             maps an FxEvent (run._fx) to a sound
//   G.Audio.setEnabled(bool)   settings.sound (master: effects + music)
//   G.Audio.setMusic(bool)     settings.music (background music only)
(function () {
  'use strict';
  var G = globalThis.G;

  var MASTER = 0.2;         // low master volume
  var THROTTLE_MS = 60;     // <= 1 identical sound per 60 ms

  var ctx = null, master = null, noiseBuf = null;
  var enabled = true;
  var last = {};
  var resuming = false;   // one gesture-driven resume in flight at a time

  // ------------------------------------------------------------------ context
  // ctx.resume() returns a promise that may reject (NotAllowedError outside a gesture): always swallow it.
  function resume(then) {
    try {
      var pr = ctx.resume();
      if (pr && pr.then) pr.then(then || null, function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  function unlock() {
    if (!ctx) {
      var AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = MASTER;
        // gentle compression so stacked explosions never clip
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4;
        master.connect(comp);
        comp.connect(ctx.destination);
        noiseBuf = makeNoise();
      } catch (e) { ctx = null; return false; }
    }
    try {
      if (ctx.state !== 'running' && enabled) resume();
      // a silent blip finishes the unlock on iOS
      var b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, 22050);
      b.connect(master);
      b.start(0);
    } catch (e) { /* ignore */ }
    return true;
  }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 1.5);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ------------------------------------------------------------------ building blocks
  // Envelope on a gain node: attack to `peak`, exponential decay to silence at t0 + dur.
  function env(t0, dur, peak, attack) {
    var g = ctx.createGain();
    var a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + 0.01, dur));
    g.connect(master);
    return g;
  }

  // Oscillator with a frequency sweep f0 -> f1.
  function tone(type, f0, f1, t0, dur, peak, attack, out) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    var g = env(t0, dur, peak, attack);
    if (out) { g.disconnect(); g.connect(out); }
    o.connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  // Filtered noise burst; filter frequency sweeps f0 -> f1.
  function noise(filterType, f0, f1, t0, dur, peak, attack, q) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    if (q) f.Q.value = q;
    var g = env(t0, dur, peak, attack);
    s.connect(f);
    f.connect(g);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ sounds
  var SOUNDS = {
    laser: function (t, v) {
      tone('square', 1500, 260, t, 0.13, 0.22 * v);
      tone('sawtooth', 2200, 500, t, 0.08, 0.08 * v);
    },
    ion: function (t, v) {
      var o = tone('sine', 420, 1500, t, 0.24, 0.3 * v, 0.01);
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 38; lg.gain.value = 120;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t); lfo.stop(t + 0.3);
      tone('triangle', 900, 2400, t, 0.18, 0.1 * v);
    },
    missile: function (t, v) {
      noise('lowpass', 2400, 300, t, 0.45, 0.35 * v, 0.02);
      tone('sawtooth', 220, 70, t, 0.4, 0.12 * v, 0.02);
    },
    beam: function (t, v) {
      tone('sawtooth', 140, 190, t, 0.7, 0.14 * v, 0.08);
      tone('sine', 880, 1320, t, 0.7, 0.08 * v, 0.1);
      noise('bandpass', 600, 2400, t, 0.7, 0.18 * v, 0.1, 6);
    },
    hit: function (t, v) {
      noise('lowpass', 1800, 200, t, 0.22, 0.55 * v);
      tone('sine', 130, 40, t, 0.25, 0.5 * v);
    },
    shield: function (t, v) {
      tone('sine', 700, 1400, t, 0.2, 0.22 * v, 0.004);
      tone('triangle', 1400, 2100, t + 0.02, 0.22, 0.1 * v);
      noise('highpass', 3000, 6000, t, 0.12, 0.08 * v);
    },
    miss: function (t, v) {
      noise('bandpass', 3200, 700, t, 0.2, 0.16 * v, 0.03, 2);
    },
    explode: function (t, v) {
      noise('lowpass', 1400, 120, t, 0.7, 0.7 * v, 0.004);
      tone('sine', 90, 30, t, 0.6, 0.55 * v);
    },
    bigExplode: function (t, v) {
      noise('lowpass', 1800, 60, t, 1.6, 0.8 * v, 0.004);
      tone('sine', 70, 22, t, 1.4, 0.7 * v);
      noise('lowpass', 900, 80, t + 0.25, 1.2, 0.5 * v, 0.01);
      noise('lowpass', 700, 60, t + 0.55, 1.0, 0.4 * v, 0.01);
    },
    click: function (t, v) {
      tone('square', 1900, 1500, t, 0.035, 0.08 * v, 0.002);
    },
    deny: function (t, v) {
      tone('square', 240, 240, t, 0.08, 0.12 * v, 0.003);
      tone('square', 170, 170, t + 0.09, 0.12, 0.12 * v, 0.003);
    },
    power: function (t, v) {
      tone('triangle', 420, 880, t, 0.09, 0.2 * v, 0.003);
      tone('sine', 1320, 1320, t + 0.04, 0.06, 0.06 * v);
    },
    jump: function (t, v) {
      tone('sawtooth', 80, 1800, t, 0.9, 0.16 * v, 0.2);
      tone('sine', 160, 2600, t + 0.1, 0.8, 0.12 * v, 0.2);
      noise('bandpass', 300, 5000, t, 1.0, 0.22 * v, 0.3, 3);
    },
    alarm: function (t, v) {
      for (var i = 0; i < 2; i++) {
        tone('square', 880, 880, t + i * 0.22, 0.1, 0.1 * v, 0.004);
        tone('square', 660, 660, t + i * 0.22 + 0.11, 0.1, 0.1 * v, 0.004);
      }
    },
    fire: function (t, v) {
      noise('bandpass', 900, 500, t, 0.45, 0.25 * v, 0.05, 1.5);
      noise('highpass', 4000, 2500, t + 0.05, 0.25, 0.08 * v, 0.01);
    },
    coin: function (t, v) {
      tone('triangle', 988, 988, t, 0.09, 0.2 * v, 0.003);
      tone('triangle', 1319, 1319, t + 0.08, 0.2, 0.2 * v, 0.003);
    },
    victory: function (t, v) {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone('triangle', f, f, t + i * 0.14, 0.5, 0.2 * v, 0.01);
        tone('sine', f / 2, f / 2, t + i * 0.14, 0.5, 0.08 * v, 0.01);
      });
      tone('triangle', 1319, 1319, t + 0.6, 1.0, 0.16 * v, 0.02);
    },
    defeat: function (t, v) {
      [392, 349, 311, 262].forEach(function (f, i) {
        tone('triangle', f, f * 0.98, t + i * 0.26, 0.6, 0.18 * v, 0.02);
      });
      tone('sine', 131, 98, t + 1.0, 1.4, 0.2 * v, 0.05);
    },
    surge: function (t, v) {
      tone('sawtooth', 60, 420, t, 0.8, 0.2 * v, 0.1);
      noise('lowpass', 300, 3000, t, 0.8, 0.2 * v, 0.2);
    },
  };

  function play(name, vol) {
    if (!enabled || !ctx || !SOUNDS[name]) return;
    if (ctx.state !== 'running') {
      // Only from a user gesture (UI sounds): resume and play once running, so the first tap is not silent.
      // The combat fx loop runs outside gestures; resuming there would just reject.
      if (!resuming && gesture()) {
        resuming = true;
        resume(function () { resuming = false; playNow(name, vol); });
        setTimeout(function () { resuming = false; }, 500);
      }
      return;
    }
    playNow(name, vol);
  }

  function gesture() {
    var ua = globalThis.navigator && navigator.userActivation;
    return !ua || !!ua.isActive;
  }

  function playNow(name, vol) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime * 1000;
    if (last[name] != null && now - last[name] < THROTTLE_MS) return;
    last[name] = now;
    try { SOUNDS[name](ctx.currentTime + 0.005, vol == null ? 1 : vol); } catch (e) {
      if (!last['!' + name]) { last['!' + name] = 1; console.warn('[audio] ' + name, e); }
    }
  }

  // ------------------------------------------------------------------ FxEvent mapping
  var LAUNCH = { laser: 'laser', ion: 'ion', missile: 'missile' };

  function fx(ev) {
    if (!ev || !enabled || !ctx) return;
    var mine = ev.side === 'player';
    switch (ev.t) {
      case 'launch':
        if (LAUNCH[ev.kind]) play(LAUNCH[ev.kind], ev.from === 'player' ? 1 : 0.7);
        break;
      case 'beam': play('beam', ev.from === 'player' ? 1 : 0.75); break;
      case 'miss': play('miss'); break;
      case 'shield': play('shield', mine ? 1 : 0.8); break;
      case 'hit': if (ev.dmg > 0) play('hit', mine ? 1 : 0.75); break;
      case 'fire': play('fire', mine ? 0.9 : 0.5); break;
      case 'breach': if (mine) play('alarm', 0.6); break;
      case 'crewDied': if (mine) play('alarm', 0.8); break;
      case 'destroyed': play('bigExplode'); break;
      case 'phase2': play('alarm'); break;
      case 'surgeWarn': play('alarm'); break;
      case 'surge': play('surge'); break;
      case 'flare': play('fire'); break;
      case 'enemyFleeing': play('alarm', 0.6); break;
      case 'combatStart': play(ev.boss || ev.elite ? 'alarm' : 'power', 0.8); break;
      case 'combatEnd':
        if (ev.result === 'lose') play('defeat');
        else if (ev.result === 'win' || ev.result === 'derelict' || ev.result === 'surrender') play('coin');
        break;
    }
  }


  // ------------------------------------------------------------------ background music
  // Procedural chiptune BGM (no files). Four looping pieces chosen from the game state and crossfaded:
  //   title  - slow A-minor pad + triangle arpeggio
  //   calm   - hub / map / events / shops: D-minor pad, sparse arpeggio, soft bass
  //   combat - E-minor, driving bass, square 16th arpeggio, kick + hat
  //   boss   - C-minor, faster, heavier bass, snare backbeat (rebel flagship)
  // A look-ahead scheduler (setInterval, UI layer only) queues notes ~0.25 s ahead on the AudioContext clock.
  var MUSIC_VOL = 0.55;                 // relative to MASTER
  var musicOn = true, musicBus = null, musicTimer = null, curMode = null, modeBus = {};
  var seq = null;                        // { mode, step, next }
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var SONGS = {
    title:  { bpm: 76,  steps: 8,  chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], arp: [0, 1, 2, 1, 2, 1, 0, 1], arpOct: 12, arpWave: 'triangle', arpVol: 0.05, bass: [0, -1, -1, -1, 0, -1, -1, -1], bassVol: 0.07, pad: 0.035, drums: null },
    calm:   { bpm: 84,  steps: 8,  chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], arp: [0, -1, 2, -1, 1, -1, 2, 0], arpOct: 24, arpWave: 'triangle', arpVol: 0.045, bass: [0, -1, -1, 0, -1, -1, 0, -1], bassVol: 0.07, pad: 0.03, drums: null },
    combat: { bpm: 128, steps: 16, chords: [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]], arp: [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 0, 2, 1, 3], arpOct: 24, arpWave: 'square', arpVol: 0.022, bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12], bassVol: 0.08, pad: 0.018, drums: { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [] } },
    boss:   { bpm: 142, steps: 16, chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]], arp: [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 2, 1, 0, 3], arpOct: 24, arpWave: 'square', arpVol: 0.024, bass: [0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 12, 7, 12], bassVol: 0.09, pad: 0.02, drums: { kick: [0, 3, 8, 11], hat: [2, 6, 10, 14], snare: [4, 12] } },
  };

  function musicReady() { return ctx && enabled && musicOn && ctx.state === 'running'; }

  function busFor(mode) {
    if (!musicBus) { musicBus = ctx.createGain(); musicBus.gain.value = MUSIC_VOL; musicBus.connect(master); }
    if (!modeBus[mode]) { var g = ctx.createGain(); g.gain.value = 0.0001; g.connect(musicBus); modeBus[mode] = g; }
    return modeBus[mode];
  }

  function note(out, wave, freq, t, dur, vol, attack, cutoff) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave; o.frequency.setValueAtTime(freq, t);
    var a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff) {
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function drum(out, kind, t) {
    if (kind === 'kick') {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
      return;
    }
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(), ng = ctx.createGain();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    var d = kind === 'hat' ? 0.04 : 0.14;
    ng.gain.setValueAtTime(kind === 'hat' ? 0.035 : 0.09, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f); f.connect(ng); ng.connect(out);
    src.start(t, Math.random() * 1.2, d + 0.02);
  }

  // One sequencer step of the current song at time t; returns the step length.
  function playStep(song, out, step, t) {
    var sp = 60 / song.bpm / (song.steps === 16 ? 4 : 2);         // 16ths or 8ths
    var bar = Math.floor(step / song.steps) % song.chords.length, i = step % song.steps;
    var ch = song.chords[bar];
    if (i === 0) ch.forEach(function (n) {                          // pad: whole-bar chord, slow attack
      note(out, 'sawtooth', midi(n), t, sp * song.steps * 0.98, song.pad, 0.35, 900);
      note(out, 'triangle', midi(n + 12) * 1.003, t, sp * song.steps * 0.98, song.pad * 0.7, 0.35);
    });
    var a = song.arp[i];
    if (a >= 0) note(out, song.arpWave, midi(ch[a % ch.length] + song.arpOct + (a >= ch.length ? 12 : 0)), t, sp * 0.9, song.arpVol, 0.004, song.arpWave === 'square' ? 2600 : 0);
    var b = song.bass[i];
    if (b >= 0) note(out, 'triangle', midi(ch[0] - 24 + b), t, sp * 1.8, song.bassVol, 0.004);
    if (song.drums) ['kick', 'hat', 'snare'].forEach(function (k) { if (song.drums[k].indexOf(i) >= 0) drum(out, k, t); });
    return sp;
  }

  // Which piece fits the current screen.
  function wantMode() {
    var A = G.App, r = A && A.run;
    if (!r || (G.UI && (G.UI.isOpen('title') || G.UI.isOpen('newgame')))) return 'title';
    if (r.mode === 'gameover' || r.mode === 'victory') return null;          // end screens play their stinger
    if (r.mode === 'combat' && r.combat) return r.combat.boss ? 'boss' : 'combat';
    return 'calm';
  }

  function fadeTo(g, v, now, secs) {
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(v, now + secs);
  }

  function musicTick() {
    if (!musicReady()) return;
    var want = wantMode();
    if (want !== curMode) {
      var now = ctx.currentTime;
      if (curMode) fadeTo(busFor(curMode).gain, 0.0001, now, 1.2);
      if (want) fadeTo(busFor(want).gain, 1, now, 1.5);
      curMode = want;
      seq = want ? { mode: want, step: 0, next: now + 0.1 } : null;
    }
    if (!seq) return;
    var song = SONGS[seq.mode], out = busFor(seq.mode);
    if (seq.next < ctx.currentTime - 0.1) seq.next = ctx.currentTime + 0.05;   // tab was throttled: skip, don't burst
    while (seq.next < ctx.currentTime + 0.25) {
      seq.next += playStep(song, out, seq.step, seq.next);
      seq.step++;
    }
  }

  function startMusicTimer() {
    if (musicTimer || typeof setInterval === 'undefined') return;
    musicTimer = setInterval(function () { try { musicTick(); } catch (e) { /* never let music break the game */ } }, 60);
  }

  function setMusic(on) {
    musicOn = !!on;
    if (!ctx || !musicBus) return;
    fadeTo(musicBus.gain, musicOn ? MUSIC_VOL : 0.0001, ctx.currentTime, 0.4);
    if (!musicOn) { curMode = null; seq = null; }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!ctx && enabled && gesture()) unlock();   // turned on from the settings toggle (a gesture)
    else if (ctx) {
      if (enabled) resume();
      else { try { var pr = ctx.suspend(); if (pr && pr.catch) pr.catch(function () { /* ignore */ }); } catch (e) { /* ignore */ } }
    }
  }

  // Self-installed unlock on activation-triggering gestures (main.js may also call unlock; it is idempotent).
  // These listeners stay installed for the page's lifetime: after the first unlock they only resume a context
  // that was suspended or interrupted (iOS call, app switch). They are cheap no-ops while it is running.
  if (typeof document !== 'undefined' && document.addEventListener) {
    var onGesture = function () {
      if (!enabled) return;
      if (!ctx) { unlock(); return; }
      if (ctx.state !== 'running') unlock();
    };
    ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) {
      document.addEventListener(t, onGesture, { capture: true, passive: true });
    });
  }

  startMusicTimer();

  G.Audio = {
    unlock: unlock,
    setMusic: setMusic,
    musicMode: function () { return curMode; },
    play: play,
    fx: fx,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    state: function () { return ctx ? ctx.state : 'none'; },
    SOUNDS: Object.keys(SOUNDS),
  };
})();
