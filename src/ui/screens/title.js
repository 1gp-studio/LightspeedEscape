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

  // 12x12 crew busts (ART.md crew palettes). o outline, s race colour, d race shade, l highlight,
  // h hair, e eyes / visor, u uniform, b badge.
  var PORTRAIT = {
    human: ['....oooo....', '...ohhhho...', '..ohhhhhho..', '..olssssso..', '..oseesseo..', '..osssssdo..',
            '...osssdo...', '....osdo....', '..ouuuuuuo..', '.ouuubuuuuo.', '.ouuuuuuuuo.', '.ouuuuuuuuo.'],
    engi: ['..oooooooo..', '..ollsssso..', '..osssssso..', '..oeeeeeeo..', '..osssssdo..', '..oddddddo..',
           '....oddo....', '..oooooooo..', '..ouuuuuuo..', '.ouuuuuuuuo.', '.ouuubuuuuo.', '.ouuuuuuuuo.'],
    rock: ['.oooooooooo.', 'ossllsssddso', 'ossssssssddo', 'oseesssseedo', 'osssssssssdo', 'odsssssssddo',
           '.oddddddddo.', '..oooooooo..', '.oddssssddo.', 'odssslsssddo', 'osssssssssdo', 'odssssssssdo'],
    swift: ['.....oo.....', '....olso....', '...olssso...', '...oesseo...', '...osssdo...', '....osdo....',
            '.....oo.....', '...ouuuuo...', '..ouuuuuuo..', '..ouubuuuo..', '..ouuuuuuo..', '..ouuuuuuo..'],
  };
  var PORTRAIT_PAL = {
    human: { h: '#5a3a22', e: '#10162a', u: '#3b5b9a', b: '#e5b64c', l: '#ffe3cc', d: '#c98f6b' },
    engi: { e: '#d8f3ff', u: '#2c374f', b: '#62e07e', l: '#c8fff2', d: '#3e9c8a' },
    rock: { e: '#ffd166', u: '#8a5a3a', b: '#e5b64c', l: '#f0c39a', d: '#8a5a3a' },
    swift: { e: '#10162a', u: '#2f5a3a', b: '#e5b64c', l: '#e8ffc0', d: '#7fa446' },
  };
  function portraitSvg(raceId, color) {
    var rows = PORTRAIT[raceId] || PORTRAIT.human, pal = PORTRAIT_PAL[raceId] || PORTRAIT_PAL.human;
    var out = ['<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">'];
    for (var y = 0; y < 12; y++) {
      for (var x = 0; x < 12; x++) {
        var c = rows[y].charAt(x);
        if (c === '.' || !c) continue;
        var fill = c === 'o' ? '#05070e' : c === 's' ? color : pal[c] || color;
        out.push('<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill + '"/>');
      }
    }
    out.push('</svg>');
    return out.join('');
  }

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
    // Crew portrait: a 12x12 pixel bust per race (crisp SVG rects) + optional name-initial badge.
    crewDot: function (raceId, label) {
      var r = G.data.crew.races[raceId];
      var el = h('span.crew-dot.race-' + (PORTRAIT[raceId] ? raceId : 'human'), { style: { '--race': r ? r.color : '#ccc' } });
      var art = h('span.crew-art');
      art.innerHTML = portraitSvg(raceId, r ? r.color : '#cccccc');
      el.appendChild(art);
      if (label) el.appendChild(h('span.crew-dot-lbl', label));
      return el;
    },
    section: function (title, extra) {
      return h('div.sec-label', h('span', title), extra || null);
    },

    // Pixel starfield (ART.md: 1 art px = 2 CSS px): stars fall past a nose-up ship on a low-res buffer that
    // CSS upscales with image-rendering: pixelated, over a dithered nebula blob. Cosmetic; Math.random allowed.
    // Returns stop(). opts: { count, warp: 0..1 speed / streak length, tint: 'blue' | 'red' | 'gold' }.
    starfield: function (host, opts) {
      opts = opts || {};
      var ART = 2;
      var cv = h('canvas.starfield', { 'aria-hidden': 'true' });
      host.insertBefore(cv, host.firstChild);
      var cx = cv.getContext && cv.getContext('2d');
      if (!cx) return function () {};
      var NEB = {
        blue: ['#0d1330', '#141d45', '#1d2a5e'],
        red: ['#1a0d1a', '#2a1224', '#3b1830'],
        gold: ['#16142a', '#231d38', '#352a3e'],
      }[opts.tint || 'blue'];
      var TONES = ['#34406a', '#7d8bb3', '#e6ecf8'];
      var HUES = ['#ffd08a', '#8cc8ff'];
      var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      var stars = [], W = 0, H = 0, raf = 0, prev = 0, alive = true, clock = 0, neb = null;
      var reduce = globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var warp = opts.warp == null ? 0.35 : opts.warp;
      function nebula() {
        neb = document.createElement('canvas');
        neb.width = W; neb.height = H;
        var nx = neb.getContext('2d');
        if (!nx) { neb = null; return; }
        var blobs = [[0.22, 0.26, 0.4], [0.8, 0.18, 0.28], [0.66, 0.8, 0.34]];
        var R = Math.max(W, H);
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var d = 0;
            for (var b = 0; b < blobs.length; b++) {
              var dx = (x - blobs[b][0] * W) / (blobs[b][2] * R), dy = (y - blobs[b][1] * H) / (blobs[b][2] * R * 0.8);
              d += Math.exp(-(dx * dx + dy * dy) * 2.4);
            }
            var lv = Math.min(2.99, d * 2.1);
            var tone = Math.floor(lv) + ((lv % 1) * 16 > BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0);   // 4x4 ordered dither
            if (tone <= 0) continue;
            nx.fillStyle = NEB[Math.min(2, tone - 1)];
            nx.fillRect(x, y, 1, 1);
          }
        }
      }
      function resize() {
        var r = cv.getBoundingClientRect();
        W = Math.max(1, Math.ceil(r.width / ART)); H = Math.max(1, Math.ceil(r.height / ART));
        cv.width = W; cv.height = H;
        cx.imageSmoothingEnabled = false;
        nebula();
      }
      function spawn(s, fresh) {
        s.x = Math.random();
        s.y = fresh ? Math.random() : -0.02;
        s.z = Math.random() < 0.55 ? 0 : Math.random() < 0.65 ? 1 : 2;   // depth layer: far / mid / near
        s.tw = Math.random() * 4;
        s.hue = s.z === 2 && Math.random() < 0.35 ? HUES[Math.random() < 0.5 ? 0 : 1] : null;
        return s;
      }
      for (var i = 0; i < (opts.count || 150); i++) stars.push(spawn({}, true));
      function frame(ts) {
        if (!alive) return;
        var dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0.016;
        prev = ts;
        var r = cv.getBoundingClientRect();
        if (!W || W !== Math.max(1, Math.ceil(r.width / ART)) || H !== Math.max(1, Math.ceil(r.height / ART))) resize();
        if (!reduce) clock += dt;
        cx.clearRect(0, 0, W, H);
        if (neb) cx.drawImage(neb, 0, 0);
        var spd = 0.02 + warp * 0.12;
        for (var k = 0; k < stars.length; k++) {
          var s = stars[k];
          if (!reduce) s.y += spd * (0.35 + s.z * 0.9) * dt * (1 + s.z);
          if (s.y > 1.02) spawn(s, false);
          var x = Math.floor(s.x * W), y = Math.floor(s.y * H);
          // stepped twinkle: stars drop one tone now and then, never a smooth fade
          var lv = s.z;
          if (s.z < 2 && Math.floor(clock * 3 + s.tw) % 4 === 0) lv = Math.max(0, lv - 1);
          var len = Math.floor(warp * s.z * s.z * 3);
          if (len > 0) {
            cx.fillStyle = TONES[Math.max(0, lv - 1)];
            cx.fillRect(x, y - len, 1, len);
          }
          cx.fillStyle = s.hue || TONES[lv];
          cx.fillRect(x, y, 1, 1);
          if (s.z === 2 && !s.hue && Math.floor(clock * 2 + s.tw) % 5 === 0) {   // occasional pixel sparkle cross
            cx.fillStyle = TONES[1];
            cx.fillRect(x - 1, y, 1, 1); cx.fillRect(x + 1, y, 1, 1); cx.fillRect(x, y - 1, 1, 1); cx.fillRect(x, y + 1, 1, 1);
          }
        }
        raf = globalThis.requestAnimationFrame(frame);
      }
      raf = globalThis.requestAnimationFrame(frame);
      return function stop() {
        alive = false;
        globalThis.cancelAnimationFrame(raf);
      };
    },

    // Procedural pixel-art hero ship (title / end emblem): a mirrored steel hull built from a half-width
    // profile, lit from the top-left (5 flat steel tones), panel seams, rivets, cyan cockpit, wing pods,
    // amber hazard stripes and a 3-frame thruster flame. Drawn 1:1 into a small canvas that CSS upscales
    // by an even integer (pixelated). opts: { wreck: bool }. Returns stop().
    pixelShip: function (host, opts) {
      opts = opts || {};
      var cv = h('canvas.px-ship', { 'aria-hidden': 'true' });
      host.appendChild(cv);
      var cx = cv.getContext && cv.getContext('2d');
      if (!cx) return function () {};
      var GW = 37, GH = 50, C = 18;
      var wreck = !!opts.wreck;
      var STEEL = wreck ? ['#1a1016', '#311a22', '#4b2830', '#6c3c42', '#8d5a5c'] : ['#1b2233', '#2c374f', '#46546f', '#6f7f9c', '#a7b4cc'];
      var OUT = '#05070e';
      // ---- mask: 0 empty, 1 hull, 2 cockpit, 3 hazard stripe, 4 nozzle, 5 gun barrel
      var m = [], y, x;
      for (y = 0; y < GH; y++) { m.push([]); for (x = 0; x < GW; x++) m[y].push(0); }
      function set(dx, yy, v) { var xx = C + dx; if (yy >= 0 && yy < GH && xx >= 0 && xx < GW) m[yy][xx] = v; }
      function bodyHW(yy) {
        if (yy < 1) return -1; if (yy < 3) return 0; if (yy < 5) return 1; if (yy < 7) return 2; if (yy < 10) return 3;
        if (yy < 13) return 4; if (yy < 33) return 5; if (yy < 37) return 4; return -1;
      }
      for (y = 0; y < GH; y++) {
        var bw = bodyHW(y);
        for (x = -bw; x <= bw && bw >= 0; x++) set(x, y, 1);
        if (y >= 18 && y <= 30) {                         // swept wings
          var ww = Math.min(13, 5 + (y - 18));
          for (x = 6; x <= ww; x++) { set(x, y, 1); set(-x, y, 1); }
        }
        if (y >= 20 && y <= 34) {                         // wing-tip pods
          var x0 = y < 22 ? 15 : 14, x1 = y < 22 ? 15 : 16;
          for (x = x0; x <= x1; x++) { set(x, y, 1); set(-x, y, 1); }
          if (y >= 22) { set(13, y, 1); set(-13, y, 1); }
        }
      }
      [[0, 6], [0, 7], [-1, 8], [0, 8], [1, 8], [-1, 9], [0, 9], [1, 9], [-1, 10], [0, 10], [1, 10]].forEach(function (p) { set(p[0], p[1], 2); });
      for (x = 13; x <= 16; x++) { set(x, 25 + (x & 1), 3); set(-x, 25 + (x & 1), 3); }
      for (x = 2; x <= 4; x++) { set(x, 37, 4); set(-x, 37, 4); }
      for (x = 14; x <= 16; x++) { set(x, 35, 4); set(-x, 35, 4); }
      for (y = 14; y <= 19; y++) { set(9, y, 5); set(-9, y, 5); }
      if (wreck) {                                        // deterministic holes torn in the hull
        [[3, 15], [4, 15], [3, 16], [-8, 24], [-9, 24], [-9, 25], [11, 27], [12, 27], [-2, 29], [-1, 29], [-2, 30]]
          .forEach(function (p) { set(p[0], p[1], 0); });
        for (y = 31; y < GH; y++) for (x = -17; x <= -12; x++) set(x, y, 0);
      }
      function at(xx, yy) { return yy < 0 || yy >= GH || xx < 0 || xx >= GW ? 0 : m[yy][xx]; }
      // ---- static sprite
      var spr = document.createElement('canvas');
      spr.width = GW; spr.height = GH;
      var sx = spr.getContext('2d');
      if (!sx) return function () {};
      function px(c, xx, yy) { sx.fillStyle = c; sx.fillRect(xx, yy, 1, 1); }
      for (y = 0; y < GH; y++) {
        for (x = 0; x < GW; x++) {
          var v = m[y][x], dx = x - C;
          if (!v) {
            if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) px(OUT, x, y);   // 1-px dark outline
            continue;
          }
          if (v === 2) { px(y <= 7 || (dx < 0 && y <= 8) ? '#d8f3ff' : dx > 0 ? '#1f6f9a' : '#52c6ff', x, y); continue; }
          if (v === 3) { px(wreck ? '#7a4a1c' : '#e5b64c', x, y); continue; }
          if (v === 4) { px(dx < 0 ? '#46546f' : '#1b2233', x, y); continue; }
          if (v === 5) { px(y === 14 ? '#a7b4cc' : dx < 0 ? '#6f7f9c' : '#2c374f', x, y); continue; }
          var inBody = Math.abs(dx) <= 5;
          var t = inBody ? dx / Math.max(1, bodyHW(y)) : (Math.abs(dx) >= 13 ? (dx < 0 ? (Math.abs(dx) >= 15 ? -0.2 : -0.8) : (Math.abs(dx) >= 15 ? 0.8 : 0.3)) : (dx < 0 ? -0.3 : 0.4));
          var tone = t < -0.55 ? 4 : t < -0.05 ? 3 : t < 0.55 ? 2 : 1;
          if (!at(x, y - 1)) tone = Math.min(4, tone + 1);          // lit top edge
          if (!at(x, y + 1)) tone = Math.max(0, tone - 1);          // shaded bottom edge
          if ((y === 16 || y === 23 || y === 30) && inBody) tone = Math.max(0, tone - 1);   // panel seams
          if (dx === 0 && y > 12 && y < 33) tone = Math.max(0, tone - 1);                  // spine
          if (Math.abs(dx) === 6 && y > 19 && y < 30) tone = Math.max(0, tone - 1);        // wing root seam
          px(STEEL[tone], x, y);
          if (Math.abs(dx) === 3 && y % 4 === 2 && y > 13 && y < 31) px(STEEL[Math.min(4, tone + 1)], x, y);   // rivets
        }
      }
      if (!wreck) { px('#e5b64c', C - 4, 13); px('#c9832a', C - 4, 14); px('#c9832a', C + 4, 13); px('#8a5a1c', C + 4, 14); }

      var FLAME = ['#ffffff', '#ffd166', '#ff8a3d', '#c2410c'];
      var raf = 0, alive = true, prev = 0, clock = 0, scale = 0;
      var reduce = globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cv.width = GW; cv.height = GH;
      function fit() {
        var r = host.getBoundingClientRect();
        var s = 2;
        [6, 4].some(function (k) { if (GW * k <= r.width - 16 && GH * k <= r.height - 8) { s = k; return true; } return false; });
        if (s !== scale) { scale = s; cv.style.width = GW * s + 'px'; cv.style.height = GH * s + 'px'; }
      }
      function flame(xa, xb, y0, len, f) {
        for (var xx = xa; xx <= xb; xx++) {
          var edge = xx === xa || xx === xb;
          var L = len - (edge ? 2 : 0) + ((xx + f) % 2);
          for (var k = 0; k < L; k++) {
            cx.fillStyle = FLAME[Math.min(3, Math.floor(k / Math.max(1, L) * 4) + (edge ? 1 : 0))];
            cx.fillRect(xx, y0 + k, 1, 1);
          }
        }
      }
      function draw(ts) {
        if (!alive) return;
        var dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0.016;
        prev = ts;
        if (!reduce) clock += dt;
        fit();
        cx.clearRect(0, 0, GW, GH);
        cx.drawImage(spr, 0, 0);
        var f = Math.floor(clock * 10) % 3;   // 3-frame thruster flicker
        if (!wreck) {
          var len = [7, 9, 8][f];
          flame(C - 4, C - 2, 38, len, f);
          flame(C + 2, C + 4, 38, len, f + 1);
          flame(C + 14, C + 16, 36, len - 3, f);
          flame(C - 16, C - 14, 36, len - 3, f + 1);
        } else {
          var on = Math.floor(clock * 6) % 4;                 // blinking sparks at the tears
          if (on < 2) {
            cx.fillStyle = on === 0 ? '#ffd166' : '#ff8a3d';
            cx.fillRect(C + 3, 14, 1, 1); cx.fillRect(C - 9, 23, 1, 1); cx.fillRect(C + 12, 26, 1, 1);
          }
          cx.fillStyle = '#4a4f60';                            // smoke pixels rising from the breach
          for (var i = 0; i < 5; i++) {
            var sy = 14 - Math.floor((clock * 4 + i * 3) % 14);
            cx.fillRect(C + 3 + (i % 3) - 1, sy, 1, 1);
          }
        }
        raf = globalThis.requestAnimationFrame(draw);
      }
      raf = globalThis.requestAnimationFrame(draw);
      return function stop() { alive = false; globalThis.cancelAnimationFrame(raf); };
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

      var emblem = h('div.title-emblem', { 'aria-hidden': 'true' }, h('i.te-bracket'), h('i.te-scan'));
      el.appendChild(h('div.title-wrap',
        h('div.title-top',
          h('div.title-plate',
            h('div.title-kicker', 'LIGHTSPEED · ESCAPE'),
            h('h1.title-name', { 'data-text': G.TITLE }, G.TITLE),
            h('div.title-warp', { 'aria-hidden': 'true' })
          ),
          h('p.title-tag', G.TAGLINE),
          G.DEDICATION ? h('p.title-ded', icon('star'), G.DEDICATION) : null
        ),
        emblem,
        h('div.title-bottom', btns, stats, h('div.title-ver', 'v' + G.VERSION))
      ));
      entry.state.stop = S.starfield(el, { count: 170, warp: 0.45, tint: 'blue' });
      entry.state.stopShip = S.pixelShip(emblem, {});
    },
    unmount: function (entry) {
      if (entry.state.stop) entry.state.stop();
      if (entry.state.stopShip) entry.state.stopShip();
    },
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
