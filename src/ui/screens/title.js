// Title + new-game screens (overlays 'title', 'newgame').
// This file loads first among the screens, so it also defines G.Screens: small shared helpers the other
// overlay files use at mount time (run access, sync, resource / fx chips, tabs, weapon cards, starfield).
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };

  // ================================================================== G.Screens (shared helpers)
  var RES = {
    scrap: { name: '废料', icon: 'scrap', cls: 'res-scrap' },
    fuel: { name: '燃料', icon: 'fuel', cls: 'res-fuel' },
    missiles: { name: '导弹', icon: 'missiles', cls: 'res-missiles' },
    hull: { name: '船体', icon: 'hull', cls: 'res-hull' },
  };
  var FX_ICON = { scrap: 'scrap', fuel: 'fuel', missiles: 'missiles', hull: 'hull', crew: 'crew', loseCrew: 'skull',
                  crewDamage: 'medbay', weapon: 'weapons', augment: 'star', upgrade: 'upgrade', sysDamage: 'warning',
                  reactor: 'power', fleet: 'warning' };
  var TYPE_ICON = { laser: 'laser', ion: 'ion', missile: 'missiles', beam: 'beam' };
  var TYPE_NAME = { laser: '激光', ion: '离子', missile: '导弹', beam: '光束' };

  var localSettings = null, localMeta = null;

  var S = {
    RES: RES, TYPE_ICON: TYPE_ICON, TYPE_NAME: TYPE_NAME,

    run: function () { return (G.App && G.App.run) || globalThis.__run || null; },
    settings: function () {
      if (G.App && G.App.settings) return G.App.settings;
      return localSettings || (localSettings = G.Save.loadSettings());
    },
    meta: function () {
      if (G.App && G.App.meta) return G.App.meta;
      return localMeta || (localMeta = G.Save.loadMeta());
    },
    sfx: function (name) { if (G.Audio) G.Audio.play(name); },
    text: function (group, key, fallback) {
      var t = G.data.text && G.data.text[group];
      return t && t[key] ? t[key] : (fallback == null ? key : fallback);
    },

    // After any sim action: route run.mode to overlays (G.App.sync). Fallback router when main.js is absent.
    sync: function () {
      if (G.App && typeof G.App.sync === 'function') { G.App.sync(); return; }
      var run = S.run();
      if (!run) { G.UI.refresh(); return; }
      var want = { event: 'event', reward: 'reward', sectorSelect: 'sector', gameover: 'end', victory: 'end' }[run.mode] || null;
      if (run.mode === 'combat' && run.combat && run.combat.offer) want = 'offer';
      ['event', 'reward', 'sector', 'end', 'offer'].forEach(function (n) {
        if (n !== want && G.UI.isOpen(n)) G.UI.close(n);
      });
      if (want && !G.UI.isOpen(want)) G.UI.open(want);
      G.UI.refresh();
      G.Save.save(run);
    },
    newRun: function (opts) {
      if (G.App && typeof G.App.newRun === 'function') { G.App.newRun(opts); return; }
      globalThis.__run = G.Run.create({ seed: G.RNG.randomSeed(), shipId: opts.shipId, difficulty: opts.difficulty });
      G.UI.closeAll();
      S.sync();
    },
    toTitle: function () {
      if (G.App && typeof G.App.quitToTitle === 'function') { G.App.quitToTitle(); return; }
      G.UI.closeAll();
      G.UI.open('title');
    },

    // Failure feedback: deny sound + toast with the sim's reason.
    deny: function (reason) {
      S.sfx('deny');
      if (reason) G.UI.toast(reason, 'warn');
    },
    // Run a {ok, reason} sim action; on success play `sound`, sync and return true.
    act: function (res, sound) {
      if (res && res.ok === false) { S.deny(res.reason); return false; }
      if (sound) S.sfx(sound);
      S.sync();
      return true;
    },

    resChip: function (key, value, extra) {
      var r = RES[key];
      return h('span.chip.res-chip.' + r.cls, { title: r.name }, icon(r.icon), h('b', String(value)), extra || null);
    },
    resRow: function (run, keys) {
      keys = keys || ['scrap', 'fuel', 'missiles'];
      return h('div.res-row', keys.map(function (k) {
        if (k === 'hull') return S.resChip('hull', run.player.hull + '/' + run.player.hullMax);
        return S.resChip(k, run.res[k] || 0);
      }));
    },
    // [FxSummary] -> chips
    fxChips: function (list) {
      list = (list || []).filter(function (f) { return f && f.label; });
      if (!list.length) return null;
      return h('div.fx-chips', list.map(function (f) {
        return h('span.chip.fx-chip' + (f.good ? '.good' : '.bad'), FX_ICON[f.key] ? icon(FX_ICON[f.key]) : null, f.label);
      }));
    },
    // Segmented tabs. items: [{ id, label, badge? }]
    tabs: function (items, active, onPick) {
      return h('div.tabs', { role: 'tablist' }, items.map(function (it) {
        return h('button.tab' + (it.id === active ? '.on' : ''), {
          role: 'tab', 'aria-selected': it.id === active ? 'true' : 'false',
          onClick: function () { if (it.id !== active) { S.sfx('click'); onPick(it.id); } },
        }, it.label, it.badge ? h('span.tab-badge', String(it.badge)) : null);
      }));
    },
    pips: function (n, total, cls) {
      var out = [];
      for (var i = 0; i < total; i++) out.push(h('i' + (i < n ? '.on' : '')));
      return h('span.pips' + (cls ? '.' + cls : ''), out);
    },
    // Level bar: level filled, then (optional) next level highlighted, up to max segments.
    levelBar: function (level, max, next) {
      var segs = [];
      for (var i = 1; i <= max; i++) segs.push(h('i' + (i <= level ? '.on' : (next && i === level + 1 ? '.next' : ''))));
      return h('span.lvl-bar', { style: { '--n': max } }, segs);
    },
    // Weapon summary block (name, type, power, stats, desc).
    weaponInfo: function (id, opts) {
      opts = opts || {};
      var d = G.data.weapons[id];
      if (!d) return h('div.wpn', '未知武器');
      var stats = [];
      stats.push('充能 ' + d.charge + 's');
      if (d.type === 'beam') stats.push('扫 ' + d.beamLen + ' 舱 · 每舱 ' + d.dmg + ' 伤');
      else if (d.type === 'ion') stats.push(d.shots + ' 发 · 离子 ' + d.ion);
      else stats.push(d.shots + ' 发 × ' + d.dmg + ' 伤');
      if (d.missile) stats.push('耗弹 ' + d.missile);
      if (d.fire) stats.push('火 ' + Math.round(d.fire * 100) + '%');
      if (d.breach) stats.push('破 ' + Math.round(d.breach * 100) + '%');
      return h('div.wpn.t-' + d.type,
        h('div.wpn-head',
          h('span.wpn-type', icon(TYPE_ICON[d.type] || 'weapons')),
          h('span.wpn-name', d.name),
          d.missile ? h('span.tag', '单发') : null,
          h('span.grow'),
          h('span.wpn-pow', { title: '所需能量' }, S.pips(d.power, d.power, 'power'), h('small', d.power))
        ),
        h('div.wpn-stats', stats.join(' · ')),
        opts.desc === false ? null : h('div.wpn-desc', d.desc)
      );
    },
    raceTraits: function (raceId) {
      var r = G.data.crew.races[raceId];
      if (!r) return '';
      var t = ['生命 ' + r.hp];
      if (r.speed !== 1) t.push('移动 ×' + r.speed);
      if (r.repair !== 1) t.push('维修 ×' + r.repair);
      if (r.fire !== 1) t.push('灭火 ×' + r.fire);
      if (r.fireImmune) t.push('免疫火焰');
      return t.join(' · ');
    },
    crewDot: function (raceId, label) {
      var r = G.data.crew.races[raceId];
      return h('span.crew-dot', { style: { background: r ? r.color : '#ccc' } }, label || '');
    },
    section: function (title, extra) {
      return h('div.sec-label', h('span', title), extra || null);
    },

    // Animated starfield on a canvas that fills `host` (cosmetic; Math.random allowed in ui).
    // Returns stop(). opts.warp: 0..1 streak intensity.
    starfield: function (host, opts) {
      opts = opts || {};
      var cv = h('canvas.starfield', { 'aria-hidden': 'true' });
      host.insertBefore(cv, host.firstChild);
      var cx = cv.getContext && cv.getContext('2d');
      if (!cx) return function () {};
      var stars = [], W = 0, H = 0, dpr = 1, raf = 0, prev = 0, alive = true;
      var reduce = globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function resize() {
        var r = cv.getBoundingClientRect();
        dpr = Math.min(2, globalThis.devicePixelRatio || 1);
        W = Math.max(1, r.width); H = Math.max(1, r.height);
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      }
      function spawn(s, fresh) {
        s.a = Math.random() * Math.PI * 2;
        s.d = fresh ? Math.random() * 1.2 : Math.random() * 0.05;
        s.v = 0.02 + Math.random() * 0.07;
        s.z = Math.random();
        s.tw = Math.random() * 6;
        s.hue = Math.random() < 0.15 ? 'rgba(255,196,120,' : (Math.random() < 0.3 ? 'rgba(140,200,255,' : 'rgba(230,236,248,');
        return s;
      }
      for (var i = 0; i < (opts.count || 150); i++) stars.push(spawn({}, true));
      function frame(ts) {
        if (!alive) return;
        var dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0.016;
        prev = ts;
        if (!W || cv.width !== Math.round(W * dpr)) resize();
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cx.clearRect(0, 0, W, H);
        var ox = W / 2, oy = H * (opts.cy || 0.36), R = Math.max(W, H) * 0.75;
        if (opts.centerEl) {
          var cr = opts.centerEl.getBoundingClientRect(), hr = cv.getBoundingClientRect();
          if (cr.height) { ox = cr.left - hr.left + cr.width / 2; oy = cr.top - hr.top + cr.height / 2; }
        }
        var warp = opts.warp || 0.35;
        for (var k = 0; k < stars.length; k++) {
          var s = stars[k];
          if (!reduce) { s.d += s.v * dt * (0.3 + s.d * 1.6); s.tw += dt * 2; }
          if (s.d > 1.25) spawn(s, false);
          var dx = Math.cos(s.a), dy = Math.sin(s.a);
          var x = ox + dx * s.d * R, y = oy + dy * s.d * R;
          var alpha = Math.min(1, s.d * 3) * (0.55 + 0.45 * Math.sin(s.tw)) * (0.4 + 0.6 * s.z);
          var len = warp * s.d * s.d * 26 * (0.5 + s.z);
          cx.strokeStyle = s.hue + alpha.toFixed(3) + ')';
          cx.lineWidth = 0.6 + s.z * 1.1;
          cx.beginPath();
          cx.moveTo(x, y);
          cx.lineTo(x - dx * (len + 0.6), y - dy * (len + 0.6));
          cx.stroke();
        }
        raf = globalThis.requestAnimationFrame(frame);
      }
      raf = globalThis.requestAnimationFrame(frame);
      var onResize = function () { W = 0; };
      globalThis.addEventListener('resize', onResize);
      return function stop() {
        alive = false;
        globalThis.cancelAnimationFrame(raf);
        globalThis.removeEventListener('resize', onResize);
      };
    },

    // Nose-up ship thumbnail. Uses G.Render.miniShip when available, else a simple room plan.
    miniShip: function (cv, tpl) {
      var draw = function () {
        var r = cv.getBoundingClientRect();
        var dpr = Math.min(2, globalThis.devicePixelRatio || 1);
        var w = Math.round((r.width || 80) * dpr), hh = Math.round((r.height || 100) * dpr);
        if (cv.width !== w) cv.width = w;
        if (cv.height !== hh) cv.height = hh;
        if (G.Render && typeof G.Render.miniShip === 'function') {
          try { G.Render.miniShip(cv, tpl, {}); return; } catch (e) { console.error('[newgame] miniShip', e); }
        }
        var cx = cv.getContext('2d');
        if (!cx) return;
        cx.clearRect(0, 0, cv.width, cv.height);
        var t = Math.floor(Math.min(cv.width / (tpl.w + 1), cv.height / (tpl.h + 1)));
        var ox = (cv.width - tpl.w * t) / 2, oy = (cv.height - tpl.h * t) / 2;
        tpl.rooms.forEach(function (rm) {
          cx.fillStyle = rm.sys ? '#2a3a66' : '#1c2748';
          cx.fillRect(ox + rm.x * t, oy + rm.y * t, rm.w * t, rm.h * t);
          cx.strokeStyle = tpl.tint || '#8ea6cf';
          cx.lineWidth = Math.max(1, dpr);
          cx.strokeRect(ox + rm.x * t + 0.5, oy + rm.y * t + 0.5, rm.w * t - 1, rm.h * t - 1);
        });
      };
      globalThis.requestAnimationFrame(draw);
    },
  };
  G.Screens = S;

  // ================================================================== title
  G.UI.register('title', {
    modal: true, cls: 'full title-screen',
    mount: function (entry) {
      var el = entry.el;
      var meta = S.meta();
      var hasSave = false;
      try { hasSave = !!(G.App && G.App.suspended) || (G.Save.has() && !!G.Save.load()); } catch (e) { hasSave = false; }
      
      var btns = h('div.title-btns');
      if (hasSave) {
        btns.appendChild(h('button.btn.primary.big', {
          onClick: function () {
            S.sfx('click');
            if (G.App && typeof G.App.continueRun === 'function') G.App.continueRun();
            else { globalThis.__run = G.Save.load(); G.UI.closeAll(); S.sync(); }
          },
        }, icon('play'), '继续航程'));
      }
      btns.appendChild(h('button.btn.big' + (hasSave ? '' : '.primary'), {
        onClick: function () { S.sfx('click'); G.UI.open('newgame'); },
      }, icon('jump'), '新游戏'));
      btns.appendChild(h('div.title-btn-row',
        h('button.btn.ghost', { onClick: function () { S.sfx('click'); G.UI.open('help'); } }, icon('help'), '玩法'),
        h('button.btn.ghost', { onClick: function () { S.sfx('click'); G.UI.open('settings'); } }, icon('gear'), '设置')
      ));

      var stats = h('div.title-stats',
        h('div', h('b', String(meta.runs || 0)), h('span', '出航')),
        h('div', h('b', String(meta.wins || 0)), h('span', '胜利')),
        h('div', h('b', meta.bestSector ? meta.bestSector + '/' + G.CFG.SECTORS : '—'), h('span', '最远星区'))
      );

      var emblem = h('div.title-emblem', { 'aria-hidden': 'true' },
        h('i.te-ring.r1'), h('i.te-ring.r2'), h('i.te-ring.r3'), h('span.te-ship', icon('ship')));
      el.appendChild(h('div.title-wrap',
        h('div.title-top',
          h('div.title-kicker', 'LIGHTSPEED · ESCAPE'),
          h('h1.title-name', { 'data-text': G.TITLE }, G.TITLE),
          h('div.title-warp'),
          h('p.title-tag', G.TAGLINE),
          G.DEDICATION ? h('p.title-ded', icon('star'), G.DEDICATION) : null
        ),
        emblem,
        h('div.title-bottom', btns, stats, h('div.title-ver', 'v' + G.VERSION))
      ));
      entry.state.stop = S.starfield(el, { count: 170, warp: 0.45, centerEl: emblem });
    },
    unmount: function (entry) { if (entry.state.stop) entry.state.stop(); },
  });

  // ================================================================== newgame
  var DIFF_DESC = {
    easy: '敌舰更弱，废料更多，舰队追得更慢。',
    normal: '为第一次出航准备的标准难度。',
    hard: '敌舰更强，废料更少，舰队步步紧逼。',
  };
  var choice = { shipId: null, difficulty: 'normal' };

  function shipCard(id, entry) {
    var t = G.data.ships[id];
    var on = choice.shipId === id;
    var cv = h('canvas.ng-mini');
    var sysLine = G.data.systems.order.filter(function (s) { return t.systems[s]; }).map(function (s) {
      return h('span.ng-sys', { title: G.data.systems.defs[s].name }, icon(s), h('small', String(t.systems[s])));
    });
    var card = h('button.ng-card' + (on ? '.on' : ''), {
      'aria-pressed': on ? 'true' : 'false',
      onClick: function () {
        if (choice.shipId === id) return;
        S.sfx('click');
        choice.shipId = id;
        render(entry);
      },
    },
      h('div.ng-art', cv),
      h('div.ng-info',
        h('div.ng-name', t.name, on ? h('span.ng-check', icon('check')) : null),
        h('div.ng-desc', t.desc),
        h('div.ng-stats',
          h('span.chip', icon('hull'), '船体 ' + t.hullMax),
          h('span.chip', icon('power'), '反应堆 ' + t.reactor),
          h('span.chip', icon('weapons'), '武器槽 ' + t.weaponSlots)
        ),
        h('div.ng-sysline', sysLine),
        h('div.ng-list', t.weapons.map(function (w) {
          var d = G.data.weapons[w];
          return h('span.ng-wpn', icon(TYPE_ICON[d.type] || 'weapons'), d.name);
        })),
        h('div.ng-list', t.crew.map(function (c) {
          var r = G.data.crew.races[c.race];
          return h('span.ng-crew', S.crewDot(c.race), r ? r.name : c.race);
        }))
      )
    );
    S.miniShip(cv, t);
    return card;
  }

  function render(entry) {
    var ui = entry.state.ui;
    G.dom.clear(ui.body);
    ui.body.appendChild(S.section('飞船'));
    G.data.shipOrder.forEach(function (id) { ui.body.appendChild(shipCard(id, entry)); });
    ui.body.appendChild(S.section('难度'));
    var D = G.data.rules.difficulty;
    ui.body.appendChild(h('div.seg', { role: 'radiogroup' }, ['easy', 'normal', 'hard'].map(function (k) {
      return h('button.seg-btn' + (choice.difficulty === k ? '.on' : ''), {
        role: 'radio', 'aria-checked': choice.difficulty === k ? 'true' : 'false',
        onClick: function () { if (choice.difficulty !== k) { S.sfx('click'); choice.difficulty = k; render(entry); } },
      }, D[k].label);
    })));
    ui.body.appendChild(h('p.ng-diff-desc', DIFF_DESC[choice.difficulty]));
  }

  G.UI.register('newgame', {
    modal: true, cls: 'full newgame-screen',
    mount: function (entry) {
      if (!choice.shipId || !G.data.ships[choice.shipId]) choice.shipId = G.data.shipOrder[0];
      var head = h('div.ng-head',
        h('button.btn.ghost.icon', { 'aria-label': '返回', onClick: function () { S.sfx('click'); G.UI.close('newgame'); } },
          icon('close')),
        h('div.ng-title', '准备出航'),
        h('span.ng-sub', 'NEW RUN')
      );
      var body = h('div.ng-body');
      var go = h('button.btn.primary.big', {
        onClick: function () {
          S.sfx('jump');
          S.newRun({ shipId: choice.shipId, difficulty: choice.difficulty });
        },
      }, icon('jump'), '出发');
      entry.el.appendChild(head);
      entry.el.appendChild(body);
      entry.el.appendChild(h('div.ng-foot', go));
      entry.state.ui = { body: body };
      render(entry);
    },
  });
})();
