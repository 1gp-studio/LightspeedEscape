// Synthesized sound effects (SPEC §11). WebAudio only, no files. The context is created on the first
// user gesture (G.Audio.unlock, also self-installed on pointerup/touchend/click/keydown — a touch pointerdown is not
// an activation-triggering event, so it cannot start an AudioContext on mobile). A suspended or iOS-'interrupted'
// context is resumed from the next gesture; resume() is never attempted from the rAF fx loop.
//   G.Audio.play(name, vol?)   name ∈ SOUNDS; the same sound plays at most once per THROTTLE_MS
//   G.Audio.fx(ev)             maps an FxEvent (run._fx) to a sound
//   G.Audio.setEnabled(bool)   settings.sound
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

  G.Audio = {
    unlock: unlock,
    play: play,
    fx: fx,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    state: function () { return ctx ? ctx.state : 'none'; },
    SOUNDS: Object.keys(SOUNDS),
  };
})();
