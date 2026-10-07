// App glue (SPEC §10): boot, run lifecycle (new / continue / quit), the mode → overlay router (sync),
// pause, the fixed-step frame loop, fx fan-out (render, audio, vibration, toasts, crisis pause, tips),
// meta progress, autosave and visibility handling.
//   G.App = { run, settings, meta, paused, _lastMode, suspended, canVibrate, boot(), newRun({shipId, difficulty}),
//             continueRun(), quitToTitle(), abandon(), sync(), setPaused(bool), save() }
(function () {
  'use strict';
  var G = globalThis.G;

  var ROUTED = ['event', 'reward', 'sector', 'end', 'offer'];
  var KEEP = ['menu', 'settings', 'help'];
  var WANT = { event: 'event', reward: 'reward', sectorSelect: 'sector', gameover: 'end', victory: 'end' };

  var acc = 0;           // sim time accumulator (s)
  var saveAcc = 0;       // combat seconds since the last autosave
  var last = 0;          // last rAF timestamp
  var loopErr = 0;

  var App = {
    run: null, settings: null, meta: null, paused: false, _lastMode: null,
    suspended: null,     // a quit run kept in memory because storage refused the save (continueRun resumes it)
    canVibrate: false,   // navigator.vibrate exists and is allowed (not in a cross-origin iframe / blocked)
  };

  function audio() { return G.Audio || null; }

  // ------------------------------------------------------------------ run lifecycle
  function begin(run) {
    App.run = run;
    App.suspended = null;
    App.paused = false;
    App._lastMode = null;
    acc = 0; saveAcc = 0;
    if (G.Tips) G.Tips.reset();   // before closeAll: a tip closed by the router would re-queue itself
    G.UI.closeAll();
    G.View.resetSel();
    G.View.measure();
    App.sync();
  }

  App.newRun = function (opts) {
    opts = opts || {};
    var run = G.Run.create({ seed: opts.seed || G.RNG.randomSeed(), shipId: opts.shipId, difficulty: opts.difficulty });
    begin(run);
    return run;
  };

  App.continueRun = function () {
    var run = App.suspended || G.Save.load();
    if (!run || run.mode === 'gameover' || run.mode === 'victory') { G.Save.clear(); return false; }
    begin(run);
    return true;
  };

  // Back to the title screen. The run stays resumable: saved, or kept in memory (App.suspended) when storage is
  // unavailable / refuses the write. discard (abandon) drops it.
  App.quitToTitle = function (discard) {
    var run = App.run;
    App.suspended = null;
    if (run && !discard && run.mode !== 'gameover' && run.mode !== 'victory' && !G.Save.save(run)) App.suspended = run;
    if (G.Tips) G.Tips.reset();
    App.run = null;
    App.paused = false;
    App._lastMode = null;
    G.UI.closeAll();
    G.View.resetSel();
    G.View.refresh();
    if (G.UI.screens.title) G.UI.open('title');
  };

  // Give up the current run: counts as a lost run in meta, clears the save, back to title.
  App.abandon = function () {
    var run = App.run;
    if (run && !run.flags.metaDone) {
      run.flags.metaDone = true;
      App.meta.runs++;
      App.meta.bestSector = Math.max(App.meta.bestSector || 0, run.sectorIndex + 1);
      G.Save.saveMeta(App.meta);
    }
    G.Save.clear();
    App.quitToTitle(true);
  };

  App.save = function () { return App.run ? G.Save.save(App.run) : false; };

  App.setPaused = function (on) {
    on = !!on;
    if (App.paused === on) return;
    App.paused = on;
    if (!on && G.Tips) G.Tips.done('t_pause');
    G.View.refresh();
  };

  // ------------------------------------------------------------------ router
  App.sync = function () {
    var run = App.run;
    if (!run) { G.View.refresh(); return; }
    var want = WANT[run.mode] || null;
    if (run.mode === 'combat' && run.combat && run.combat.offer) want = 'offer';
    ROUTED.forEach(function (n) { if (n !== want && G.UI.isOpen(n)) G.UI.close(n); });
    if (run.mode !== App._lastMode) {
      G.UI.closeAll(function (e) { return KEEP.indexOf(e.name) >= 0; });
      G.View.resetSel();
      if (run.mode === 'combat') {
        var first = !(run.stats.combatTime > 0);
        App.paused = first || !!App.settings.autoPause;
        saveAcc = 0;
      } else App.paused = false;
      if ((run.mode === 'gameover' || run.mode === 'victory') && !run.flags.metaDone) {
        var m = App.meta;
        m.runs++;
        if (run.mode === 'victory') m.wins++;
        m.bestSector = Math.max(m.bestSector || 0, run.sectorIndex + 1);
        G.Save.saveMeta(m);
        run.flags.metaDone = true;
      }
    }
    if (want && !G.UI.isOpen(want)) G.UI.open(want);
    App._lastMode = run.mode;
    G.View.refresh();
    G.UI.refresh();
    G.Save.save(run);
  };

  // ------------------------------------------------------------------ fx fan-out
  // Chrome blocks (and logs) navigator.vibrate inside a cross-origin iframe such as the claude.ai artifact host,
  // and iOS has no vibrate at all: decide once, and stop for good after the first refused call.
  function detectVibrate() {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    try { return window.top === window.self; } catch (e) { return false; }
  }
  function vibrate(ms) {
    if (!App.canVibrate || !App.settings.vibrate) return;
    try { if (navigator.vibrate(ms) === false) App.canVibrate = false; } catch (e) { App.canVibrate = false; }
  }

  // Crisis auto-pause: once per kind per fight (remembered in combat.flags.crisis, so it survives a reload).
  function crisis(kind, text) {
    var run = App.run, c = run && run.combat;
    if (!c || c.pending || c.result || !App.settings.crisisPause) return;
    if (!c.flags) c.flags = {};
    var f = c.flags.crisis || (c.flags.crisis = {});
    if (f[kind]) return;
    f[kind] = true;
    if (App.paused) return;
    App.setPaused(true);
    G.UI.toast(text + ' · 已自动暂停', 'warn', 2200);
    if (audio()) audio().play('alarm');
  }

  function crisisPoll(run) {
    var c = run.combat;
    if (run.mode !== 'combat' || !c || c.pending || c.result) return;
    var p = run.player;
    if (p.hull > 0 && p.hull <= 0.3 * p.hullMax) crisis('hull', '船体告急');
    for (var i = 0; i < p.crew.length; i++) {
      if (p.crew[i].hp > 0 && p.crew[i].hp < 0.25 * p.crew[i].hpMax) { crisis('crew', p.crew[i].name + ' 身受重伤'); break; }
    }
  }

  function handleFx(run, ev) {
    try { G.Render.fx(ev); } catch (e) { console.error('[render.fx]', e); }
    if (audio() && audio().fx) { try { audio().fx(ev); } catch (e) { console.error('[audio.fx]', e); } }
    switch (ev.t) {
      case 'hit': if (ev.side === 'player' && ev.dmg > 0) vibrate(ev.dmg >= 2 ? 70 : 35); break;
      case 'destroyed': if (ev.side === 'player') vibrate([80, 60, 160]); break;
      case 'msg': if (!run.combat) G.UI.toast(ev.text, ev.kind); break;
      case 'phase2': crisis('phase2', '旗舰进入全功率模式'); break;
      case 'surgeWarn': crisis('surge', '旗舰能量涌动'); break;
      case 'enemyFleeing': crisis('flee', '敌舰准备跃迁逃跑'); break;
      default: break;
    }
    if (G.Tips) G.Tips.check(run, ev);
  }

  // ------------------------------------------------------------------ frame loop
  function tick(ts) {
    requestAnimationFrame(tick);
    var frameDt = last ? Math.min((ts - last) / 1000, G.CFG.MAX_FRAME_DT) : 1 / 60;
    last = ts;
    if (frameDt < 0) frameDt = 0;
    try {
      step(frameDt);
    } catch (e) {
      if (loopErr++ < 5) console.error('[loop]', e);
    }
  }

  function step(frameDt) {
    var run = App.run, changed = false, SIM_DT = G.CFG.SIM_DT;
    var blocked = !run || (run.mode !== 'combat' && run.mode !== 'hub') || App.paused || G.UI.modalOpen() ||
      !!(run.combat && run.combat.offer);
    if (!blocked) {
      acc += Math.min(frameDt, G.CFG.MAX_FRAME_DT) * (App.settings.speed || 1);
      var n = 0;
      while (acc >= SIM_DT && n < 8) {
        acc -= SIM_DT;
        n++;
        if (G.Run.step(run, SIM_DT)) { changed = true; acc = 0; break; }
      }
      if (n === 8) acc = 0;
      if (run.mode === 'combat') {
        saveAcc += n * SIM_DT;
        if (saveAcc >= G.CFG.AUTOSAVE_INTERVAL) { saveAcc = 0; G.Save.save(run); }
        crisisPoll(run);
      }
    } else acc = 0;
    var evs = run ? G.Run.drainFx(run) : [];
    for (var i = 0; i < evs.length; i++) handleFx(run, evs[i]);
    if (changed) App.sync();
    G.View.frame(frameDt);
    G.UI.update(frameDt);
  }

  // ------------------------------------------------------------------ AI Made Games platform
  // Inside the site's in-site player, report a one-line progress summary that shows as "your save"
  // on the game page. Does nothing when the game runs anywhere else.
  var platformEmbed = window.parent !== window, platformTimer = 0, platformLast = '';
  function reportProgress() {
    if (!platformEmbed || platformTimer) return;
    platformTimer = setTimeout(function () {
      platformTimer = 0;
      var m = G.Save.loadMeta();
      if (!m.runs && !m.bestSector) return;
      var text = '最远到第 ' + (m.bestSector || 1) + ' 星区 · 通关 ' + (m.wins || 0) + ' 次';
      if (text === platformLast) return;
      platformLast = text;
      // The platform's English edition ships a translation runtime; translate the line there too.
      var shown = window.GameI18n ? window.GameI18n.translate(text) : text;
      try { window.parent.postMessage({ source: 'aimadegames', v: 1, type: 'progress', text: shown.slice(0, 120) }, '*'); } catch (e) { /* ignore */ }
    }, 1500);
  }

  // ------------------------------------------------------------------ boot
  App.boot = function () {
    App.settings = G.Save.loadSettings();
    App.canVibrate = detectVibrate();
    App.meta = G.Save.loadMeta();
    if (!App.meta.tipsSeen) App.meta.tipsSeen = {};
    reportProgress();
    var saveMeta = G.Save.saveMeta;
    G.Save.saveMeta = function (m) { var ok = saveMeta(m); reportProgress(); return ok; };
    if (audio() && audio().setEnabled) { try { audio().setEnabled(!!App.settings.sound); } catch (e) { /* ignore */ } }
    if (audio() && audio().setMusic) { try { audio().setMusic(App.settings.music !== false); } catch (e) { /* ignore */ } }

    var view = document.getElementById('view');
    G.View.init(view);
    G.Input.init(view);

    var onResize = function () { G.View.measure(); };
    var observed = false;
    if (typeof ResizeObserver !== 'undefined') { try { new ResizeObserver(onResize).observe(view); observed = true; } catch (e) { /* ignore */ } }
    if (!observed) window.addEventListener('resize', onResize);   // the observer already covers window resizes
    window.addEventListener('orientationchange', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize, function () {});

    document.addEventListener('pointerup', function unlock() {
      document.removeEventListener('pointerup', unlock, true);
      if (audio() && audio().unlock) { try { audio().unlock(); } catch (e) { /* ignore */ } }
    }, true);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden' || !App.run) return;
      if (App.run.mode === 'combat') App.setPaused(true);
      G.Save.save(App.run);
    });

    if (G.UI.screens.title) G.UI.open('title');
    else console.warn('[App] title screen not registered; start with G.App.newRun({ shipId: "falcon" })');
    G.View.refresh();
    requestAnimationFrame(tick);
  };

  App._frame = step;   // one frame of the loop (debug / scripted playthroughs)

  G.App = App;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.boot);
    else App.boot();
  }
})();
