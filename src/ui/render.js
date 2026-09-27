// Canvas renderer (SPEC §9 Canvas). One <canvas> behind zones 2–4 of the main view: cached starfield +
// sector nebula, both ships (procedural hull silhouette around the rooms, floors, walls, doors, system
// glyphs via Path2D(G.dom.ICONS), O2 tint, fire, breaches, crew with walking interpolation), shield bubbles
// with ripples, projectiles, beam charge-up + sweep, explosions/particles, target reticles, the targeting
// overlay while a weapon is armed, screen shake and the combat message line. Reads G.View.layout and the
// run; never mutates game state. Math.random is allowed here (cosmetic only).
//   G.Render = { init(canvas), resize(), frame(dt), fx(ev), pickRoom(side, px, py),
//                nearestRoom(side, px, py, margin), miniShip(canvas, template, opts) }
(function () {
  'use strict';
  var G = globalThis.G;

  var COL = {
    floor: '#aab3c6', floorE: '#b5a9ae', grid: 'rgba(30,38,60,0.13)', wall: '#1a2032', door: '#e2e8f3',
    on: '#27b04c', off: '#6d768c', dmg: '#e5383b', part: '#f08c2e', ion: '#7a5cff', badge: 'rgba(16,21,38,0.62)',
    shield: '82,198,255', amber: '#ffb547', danger: '#ff5d5d', text: '#e6ecf8',
  };
  var SHOT = {
    player: { laser: '#ffd35a', ion: '#9fe8ff', missile: '#ffe2a6', beam: '#ffcf4a' },
    enemy: { laser: '#ff5a4f', ion: '#b69dff', missile: '#ffb0a0', beam: '#ff4e4e' },
  };

  var R = {
    canvas: null, ctx: null, dpr: 1, w: 0, h: 0, t: 0,
    neb: null, nebKey: '', stars: null, starKey: '', drift: 0,
    parts: [], sched: [], ripples: [], shots: {}, lastPos: { player: {}, enemy: {} },
    shake: 0, hurt: 0, flash: 0, flashCol: '255,140,60',
    enemyRef: null, enemyIn: 1, dead: { player: -1, enemy: -1 },
    reduced: false,
  };
  var glyphCache = {};
  var hullCache = [];
  var doorCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function run() { return G.App ? G.App.run : null; }
  function L() { return G.View ? G.View.layout : null; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ------------------------------------------------------------------ colors
  function hexRgb(hex) {
    var h = String(hex || '#8ea6cf').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // pct < 0 darkens toward black, > 0 lightens toward white
  function shade(hex, pct, alpha) {
    var c = hexRgb(hex), t = pct < 0 ? 0 : 255, p = Math.abs(pct);
    var r = Math.round((t - c[0]) * p + c[0]), g = Math.round((t - c[1]) * p + c[1]), b = Math.round((t - c[2]) * p + c[2]);
    return alpha == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ------------------------------------------------------------------ geometry
  // Ship geometry on screen. side: 'player' | 'enemy'
  function geo(side) {
    var r = run(), lay = L();
    if (!r || !lay) return null;
    var ship = side === 'player' ? r.player : r.combat ? r.combat.enemy : null;
    var g = side === 'player' ? lay.player : lay.enemy;
    if (!ship || !g || !g.tile) return null;
    return { ship: ship, L: g, flip: side === 'enemy', side: side };
  }
  function roomBox(g, rm) {
    var t = g.L.tile;
    return { x: g.L.ox + rm.x * t, y: g.flip ? g.L.oy + (g.ship.h - rm.y - rm.h) * t : g.L.oy + rm.y * t, w: rm.w * t, h: rm.h * t };
  }
  function roomMid(g, id) {
    var rm = g.ship.rooms[id];
    if (!rm) return shipMid(g);
    var b = roomBox(g, rm);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  // grid point -> screen
  function gp(g, x, y) { return { x: g.L.ox + x * g.L.tile, y: g.flip ? g.L.oy + (g.ship.h - y) * g.L.tile : g.L.oy + y * g.L.tile }; }
  function shipMid(g) { return { x: g.L.ox + g.ship.w * g.L.tile / 2, y: g.L.oy + g.ship.h * g.L.tile / 2 }; }
  function bubble(g) {
    var t = g.L.tile, m = shipMid(g);
    return { x: m.x, y: m.y, rx: g.ship.w * t / 2 + 0.75 * t, ry: g.ship.h * t / 2 + 0.95 * t };
  }

  function distRect(px, py, b) {
    var dx = Math.max(b.x - px, 0, px - (b.x + b.w)), dy = Math.max(b.y - py, 0, py - (b.y + b.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pickRoom(side, px, py) {
    var g = geo(side);
    if (!g) return -1;
    var t = g.L.tile, s = g.ship;
    var gx = (px - g.L.ox) / t, gy = (py - g.L.oy) / t;
    if (g.flip) gy = s.h - gy;
    var id = G.Ship.roomAt(s, gx, gy);
    if (id >= 0) return id;
    var pad = Math.max(0, (44 - t) / 2), best = -1, bestD = Infinity;
    for (var i = 0; i < s.rooms.length; i++) {
      var b = roomBox(g, s.rooms[i]);
      if (px < b.x - pad || px > b.x + b.w + pad || py < b.y - pad || py > b.y + b.h + pad) continue;
      var d = distRect(px, py, b);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Nearest room when the point is inside the ship's bounding box expanded by margin px; else -1.
  function nearestRoom(side, px, py, margin) {
    var g = geo(side);
    if (!g) return -1;
    var t = g.L.tile, x0 = g.L.ox, y0 = g.L.oy, x1 = x0 + g.ship.w * t, y1 = y0 + g.ship.h * t;
    margin = margin || 0;
    if (px < x0 - margin || px > x1 + margin || py < y0 - margin || py > y1 + margin) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < g.ship.rooms.length; i++) {
      var d = distRect(px, py, roomBox(g, g.ship.rooms[i]));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ------------------------------------------------------------------ background
  function buildNebula(w, h, typeId) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * R.dpr)); c.height = Math.max(1, Math.round(h * R.dpr));
    var x = c.getContext('2d');
    x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    var type = G.data.sectors.types[typeId] || { color: '#1d3566', accent: '#58a7d6' };
    var bg = x.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#070a17'); bg.addColorStop(1, '#0a0f22');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    var blobs = [[0.18, 0.22, 0.75, type.color, 0.55], [0.85, 0.62, 0.7, type.color, 0.45], [0.55, 0.05, 0.45, type.accent, 0.10],
                 [0.3, 0.9, 0.5, type.accent, 0.08]];
    blobs.forEach(function (b) {
      var gr = x.createRadialGradient(b[0] * w, b[1] * h, 0, b[0] * w, b[1] * h, b[2] * Math.max(w, h));
      gr.addColorStop(0, shade(b[3], 0, b[4]));
      gr.addColorStop(1, shade(b[3], -0.5, 0));
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
    });
    return c;
  }

  function buildStars(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * R.dpr)); c.height = Math.max(1, Math.round(h * R.dpr));
    var x = c.getContext('2d');
    x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    var n = Math.round(w * h / 900);
    for (var i = 0; i < n; i++) {
      var sx = Math.random() * w, sy = Math.random() * h, big = Math.random() < 0.06;
      var a = big ? rnd(0.7, 1) : rnd(0.2, 0.7), s = big ? rnd(1.2, 1.8) : rnd(0.5, 1.1);
      var tint = Math.random();
      x.fillStyle = tint < 0.15 ? 'rgba(255,214,170,' + a + ')' : tint < 0.3 ? 'rgba(170,200,255,' + a + ')' : 'rgba(235,240,255,' + a + ')';
      x.fillRect(sx, sy, s, s);
      if (big) {
        x.fillStyle = 'rgba(200,220,255,' + (a * 0.35) + ')';
        x.fillRect(sx - 2, sy + s / 2 - 0.25, s + 4, 0.5);
        x.fillRect(sx + s / 2 - 0.25, sy - 2, 0.5, s + 4);
      }
    }
    return c;
  }

  function drawBackground(ctx, r, dt) {
    var typeId = r && r.sector ? r.sector.type : 'civilian';
    var nk = R.w + 'x' + R.h + ':' + R.dpr + ':' + typeId;
    if (R.nebKey !== nk) { R.nebKey = nk; R.neb = buildNebula(R.w, R.h, typeId); }
    var sk = R.w + 'x' + R.h + ':' + R.dpr;
    if (R.starKey !== sk) { R.starKey = sk; R.stars = buildStars(R.w, R.h); }
    ctx.drawImage(R.neb, 0, 0, R.w, R.h);
    if (!R.reduced) R.drift = (R.drift + dt * 5) % R.h;
    var y = R.drift;
    ctx.drawImage(R.stars, 0, y, R.w, R.h);
    ctx.drawImage(R.stars, 0, y - R.h, R.w, R.h);
  }

  function drawPlanet(ctx, r) {
    var lay = L();
    if (!lay || !lay.enemyZone || !r.sector) return;
    var z = lay.enemyZone, type = G.data.sectors.types[r.sector.type] || {};
    var rad = Math.min(z.w, z.h) * 0.42, cx = z.x + z.w * 0.78, cy = z.y + z.h * 0.62;
    var gr = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    gr.addColorStop(0, shade(type.accent || '#58c7d6', -0.1, 0.9));
    gr.addColorStop(0.55, shade(type.color || '#1d5566', 0.05, 0.9));
    gr.addColorStop(1, shade(type.color || '#1d5566', -0.6, 0.95));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shade(type.accent || '#58c7d6', 0.2, 0.25);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rad + 3, Math.PI * 0.9, Math.PI * 1.6); ctx.stroke();
    // beacon blink
    var bx = z.x + z.w * 0.2, by = z.y + z.h * 0.7, a = 0.5 + 0.5 * Math.sin(R.t * 3);
    ctx.fillStyle = 'rgba(255,181,71,' + (0.3 + 0.5 * a) + ')';
    ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,' + (0.35 * (1 - a)) + ')';
    ctx.beginPath(); ctx.arc(bx, by, 4 + 10 * a, 0, Math.PI * 2); ctx.stroke();
  }

  // ------------------------------------------------------------------ hull silhouette
  // Outline in grid units (y down, nose toward y < 0): per-row profile of the rooms, inflated, plus a nose.
  function hullShape(ship) {
    var rows = [], i, y, P = 0.34;
    for (y = 0; y < ship.h; y++) rows.push({ a: Infinity, b: -Infinity });
    ship.rooms.forEach(function (rm) {
      for (var yy = rm.y; yy < rm.y + rm.h; yy++) {
        if (!rows[yy]) continue;
        rows[yy].a = Math.min(rows[yy].a, rm.x);
        rows[yy].b = Math.max(rows[yy].b, rm.x + rm.w);
      }
    });
    for (y = 0; y < rows.length; y++) {
      if (rows[y].a === Infinity) rows[y] = y > 0 ? { a: rows[y - 1].a, b: rows[y - 1].b } : { a: 0, b: ship.w };
    }
    var n = rows.length, pts = [];
    for (i = 0; i < n; i++) {
      pts.push([rows[i].b + P, i === 0 ? -P : i]);
      pts.push([rows[i].b + P, i === n - 1 ? n + P : i + 1]);
    }
    for (i = n - 1; i >= 0; i--) {
      pts.push([rows[i].a - P, i === n - 1 ? n + P : i + 1]);
      pts.push([rows[i].a - P, i === 0 ? -P : i]);
    }
    pts.push([(rows[0].a + rows[0].b) / 2, -P - 0.9]);
    // drop consecutive duplicates / collinear points
    var out = [];
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], q = out[out.length - 1];
      if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
      out.push(p);
    }
    var minA = Infinity, maxB = -Infinity;
    rows.forEach(function (r) { minA = Math.min(minA, r.a); maxB = Math.max(maxB, r.b); });
    return { pts: out, rows: rows, minA: minA - P, maxB: maxB + P, P: P };
  }

  function roundPoly(ctx, pts, rad) {
    var n = pts.length;
    ctx.beginPath();
    var m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
    ctx.moveTo(m0[0], m0[1]);
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      ctx.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, rad);
    }
    ctx.closePath();
  }

  // Draw the hull of `ship` into ctx. map(x, y) -> [sx, sy] converts grid units to pixels.
  function drawHull(ctx, ship, t, map, isEnemy) {
    var sh = hullShape(ship), tint = ship.tint || '#8ea6cf', H = ship.h;
    var mp = function (p) { var s = map(p[0], p[1]); return [s.x, s.y]; };
    // wings
    var wy0 = H * 0.36, wy1 = H * 0.74, wy2 = H * 0.96, ww = 0.8;
    var wingR = [[sh.maxB - 0.2, wy0], [sh.maxB + ww, wy1], [sh.maxB + ww, wy2], [sh.maxB - 0.2, H * 0.9]].map(mp);
    var wingL = [[sh.minA + 0.2, wy0], [sh.minA - ww, wy1], [sh.minA - ww, wy2], [sh.minA + 0.2, H * 0.9]].map(mp);
    ctx.fillStyle = shade(tint, -0.55);
    ctx.strokeStyle = shade(tint, -0.75);
    ctx.lineWidth = 1.5;
    [wingR, wingL].forEach(function (wp) { roundPoly(ctx, wp, t * 0.15); ctx.fill(); ctx.stroke(); });
    // engine nacelles
    var last = sh.rows[sh.rows.length - 1];
    [[last.a + 0.1, 0.75], [last.b - 0.85, 0.75]].forEach(function (e) {
      var q = [[e[0], H + sh.P - 0.3], [e[0] + e[1], H + sh.P - 0.3], [e[0] + e[1] - 0.08, H + sh.P + 0.45], [e[0] + 0.08, H + sh.P + 0.45]].map(mp);
      roundPoly(ctx, q, t * 0.08);
      ctx.fillStyle = shade(tint, -0.45);
      ctx.fill(); ctx.stroke();
    });
    // main hull
    var pts = sh.pts.map(mp);
    var a = map(sh.minA, 0), b = map(sh.maxB, 0);
    var gr = ctx.createLinearGradient(a.x, 0, b.x, 0);
    gr.addColorStop(0, shade(tint, -0.5));
    gr.addColorStop(0.45, shade(tint, -0.12));
    gr.addColorStop(0.55, shade(tint, -0.08));
    gr.addColorStop(1, shade(tint, -0.5));
    roundPoly(ctx, pts, t * 0.28);
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = shade(tint, -0.72);
    ctx.stroke();
    // plating lines + spine highlight
    ctx.save();
    roundPoly(ctx, pts, t * 0.28);
    ctx.clip();
    ctx.strokeStyle = shade(tint, 0.35, 0.18);
    ctx.lineWidth = 1;
    for (var y = 1; y < H; y += 2) {
      var l = map(sh.minA, y), rr = map(sh.maxB, y);
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(rr.x, rr.y); ctx.stroke();
    }
    var n0 = map(ship.w / 2, -sh.P - 0.9), n1 = map(ship.w / 2, H + sh.P);
    ctx.strokeStyle = shade(tint, 0.5, 0.22);
    ctx.lineWidth = Math.max(1, t * 0.08);
    ctx.beginPath(); ctx.moveTo(n0.x, n0.y); ctx.lineTo(n1.x, n1.y); ctx.stroke();
    ctx.restore();
    // a few stripe accents on the nose (faction color)
    var stripe = isEnemy ? 'rgba(255,93,93,0.55)' : 'rgba(255,181,71,0.55)';
    var s0 = map(sh.rows[0].a + 0.1, -sh.P + 0.12), s1 = map(sh.rows[0].b - 0.1, -sh.P + 0.12);
    ctx.strokeStyle = stripe;
    ctx.lineWidth = Math.max(1.5, t * 0.1);
    ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
    return sh;
  }

  // Cached hull bitmap for a ship at a tile size / orientation.
  function hullBitmap(ship, t, flip, isEnemy) {
    var key = [ship.templateId || ship.name, ship.w, ship.h, ship.rooms.length, t, flip ? 1 : 0, ship.tint, R.dpr].join('|');
    for (var i = 0; i < hullCache.length; i++) if (hullCache[i].key === key) return hullCache[i];
    var m = 2;   // margin in tiles
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((ship.w + 2 * m) * t * R.dpr));
    c.height = Math.max(1, Math.round((ship.h + 2 * m) * t * R.dpr));
    var x = c.getContext('2d');
    x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    var map = function (gx, gy) { return { x: (gx + m) * t, y: flip ? (ship.h - gy + m) * t : (gy + m) * t }; };
    var sh = drawHull(x, ship, t, map, isEnemy);
    var ent = { key: key, c: c, m: m, sh: sh };
    hullCache.unshift(ent);
    if (hullCache.length > 8) hullCache.pop();
    return ent;
  }

  function drawEngineGlow(ctx, g, sh, alpha) {
    var t = g.L.tile, H = g.ship.h, last = sh.rows[sh.rows.length - 1];
    var col = g.flip ? '255,120,80' : '120,210,255';
    var fl = 0.75 + 0.25 * Math.sin(R.t * 18 + (g.flip ? 1 : 0)) * Math.sin(R.t * 7.3);
    [last.a + 0.1 + 0.375, last.b - 0.85 + 0.375].forEach(function (ex) {
      var p = gp(g, ex, H + sh.P + 0.5);
      var rad = t * 0.55 * fl;
      var gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,' + (0.9 * alpha) + ')');
      gr.addColorStop(0.3, 'rgba(' + col + ',' + (0.7 * alpha) + ')');
      gr.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
    });
  }

  // ------------------------------------------------------------------ rooms
  function glyph(sys) {
    if (glyphCache[sys]) return glyphCache[sys];
    var parts = (G.dom.ICONS[sys] || []).map(function (p) {
      return { path: new Path2D(p.d), sw: p.sw, fill: p.fill, o: p.o };
    });
    glyphCache[sys] = parts;
    return parts;
  }

  function drawGlyph(ctx, sys, cx, cy, size, color) {
    var parts = glyph(sys), a0 = ctx.globalAlpha;   // inherit the ship's fade (drawShip sets globalAlpha)
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 24, size / 24);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.globalAlpha = a0 * (p.o != null ? p.o : 1);
      if (p.sw) {
        ctx.lineWidth = p.sw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = p.fill || color;
        ctx.stroke(p.path);
      } else {
        ctx.fillStyle = p.fill || color;
        ctx.fill(p.path);
      }
    }
    ctx.restore();
  }

  function sysColor(ship, sys) {
    if (!sys) return COL.off;
    if (sys.ion > 0) return COL.ion;
    if (sys.damage >= sys.level) return COL.dmg;
    if (sys.damage > 0) return COL.part;
    var powered = sys.id === 'piloting' ? G.Ship.usable(sys) > 0 :
      sys.id === 'weapons' ? G.Ship.weaponPower(ship) > 0 : sys.power > 0;
    if (ship.crewless && sys.id === 'piloting') powered = G.Ship.usable(sys) > 0;
    return powered ? COL.on : COL.off;
  }

  function doors(ship) {
    var d = doorCache ? doorCache.get(ship) : null;
    if (d && d.n === ship.rooms.length) return d.list;
    var list = [], adj = G.Ship.adj(ship);
    for (var i = 0; i < ship.rooms.length; i++) {
      for (var k = 0; k < adj[i].length; k++) {
        var j = adj[i][k];
        if (j < i) continue;
        var a = ship.rooms[i], b = ship.rooms[j];
        if (a.x + a.w === b.x || b.x + b.w === a.x) {
          var x = a.x + a.w === b.x ? b.x : a.x;
          var y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
          list.push({ v: true, x: x, y: (y0 + y1) / 2 });
        } else {
          var yy = a.y + a.h === b.y ? b.y : a.y;
          var x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
          list.push({ v: false, x: (x0 + x1) / 2, y: yy });
        }
      }
    }
    if (doorCache) doorCache.set(ship, { n: ship.rooms.length, list: list });
    return list;
  }

  function hash(a, b) { var x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); }

  function drawRooms(ctx, g) {
    var ship = g.ship, t = g.L.tile, lod = t < 24, i, k;
    var floor = g.flip ? COL.floorE : COL.floor;
    for (i = 0; i < ship.rooms.length; i++) {
      var rm = ship.rooms[i], b = roomBox(g, rm);
      ctx.fillStyle = floor;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      if (!lod) {
        ctx.strokeStyle = COL.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (k = 1; k < rm.w; k++) { ctx.moveTo(b.x + k * t + 0.5, b.y); ctx.lineTo(b.x + k * t + 0.5, b.y + b.h); }
        for (k = 1; k < rm.h; k++) { ctx.moveTo(b.x, b.y + k * t + 0.5); ctx.lineTo(b.x + b.w, b.y + k * t + 0.5); }
        ctx.stroke();
      }
      if (!ship.crewless && rm.o2 < 70) {
        ctx.fillStyle = 'rgba(255,50,80,' + ((70 - rm.o2) / 70 * 0.55).toFixed(3) + ')';
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
    }
    // walls
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 1.5;
    for (i = 0; i < ship.rooms.length; i++) {
      var bb = roomBox(g, ship.rooms[i]);
      ctx.strokeRect(bb.x + 0.75, bb.y + 0.75, bb.w - 1.5, bb.h - 1.5);
    }
    // doors
    if (!lod) {
      var dl = doors(ship);
      ctx.fillStyle = COL.door;
      for (i = 0; i < dl.length; i++) {
        var d = dl[i], p = gp(g, d.x, d.y), len = t * 0.42;
        if (d.v) ctx.fillRect(p.x - 1.5, p.y - len / 2, 3, len);
        else ctx.fillRect(p.x - len / 2, p.y - 1.5, len, 3);
      }
    }
    // hazards + glyphs
    for (i = 0; i < ship.rooms.length; i++) {
      var r2 = ship.rooms[i], b2 = roomBox(g, r2), tiles = r2.w * r2.h;
      if (r2.breach > 0) drawBreach(ctx, g, r2, b2, t);
      if (r2.sys) {
        var sys = ship.systems[r2.sys], size = Math.max(8, 0.6 * Math.min(b2.w, b2.h));
        var cx = b2.x + b2.w / 2, cy = b2.y + b2.h / 2;
        ctx.fillStyle = COL.badge;
        ctx.beginPath(); ctx.arc(cx, cy, size * 0.66, 0, Math.PI * 2); ctx.fill();
        drawGlyph(ctx, r2.sys, cx, cy, size, sysColor(ship, sys));
        if (sys && sys.damage > 0 && sys.damage < sys.level && !lod) {
          // repair progress ring
          ctx.strokeStyle = 'rgba(111,211,106,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, size * 0.66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (sys.repairProg || 0)); ctx.stroke();
        }
      }
      if (r2.fire > 0) drawFire(ctx, r2, b2, t, lod, tiles);
      if (!ship.crewless && r2.o2 < 50 && t >= 28) {
        ctx.font = '600 11px "Chakra Petch", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(120,0,20,0.9)';
        ctx.fillText(Math.round(r2.o2) + '%', b2.x + 4, b2.y + 3);
      }
    }
  }

  function drawFire(ctx, rm, b, t, lod, tiles) {
    var fl = 0.8 + 0.2 * Math.sin(R.t * 11 + rm.id);
    if (lod) {
      ctx.fillStyle = 'rgba(255,120,40,' + (0.35 * fl).toFixed(3) + ')';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      drawGlyph(ctx, 'fire', b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.7, '#ff8a3d');
      return;
    }
    ctx.fillStyle = 'rgba(255,110,30,' + (0.18 + 0.1 * rm.fire / tiles).toFixed(3) + ')';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    for (var k = 0; k < rm.fire; k++) {
      var tx = k % rm.w, ty = Math.floor(k / rm.w) % rm.h;
      var cx = b.x + (tx + 0.5) * t, cy = b.y + (ty + 0.5) * t;
      var s = t * (0.62 + 0.12 * Math.sin(R.t * 13 + k * 2.1 + rm.id));
      drawGlyph(ctx, 'fire', cx, cy + t * 0.04, s * 1.08, '#c2410c');
      drawGlyph(ctx, 'fire', cx, cy + t * 0.08, s * 0.8, '#ff8a3d');
      drawGlyph(ctx, 'fire', cx, cy + t * 0.14, s * 0.45, '#ffd66b');
    }
  }

  function drawBreach(ctx, g, rm, b, t) {
    var n = rm.w * rm.h;
    for (var k = 0; k < rm.breach; k++) {
      var idx = n - 1 - (k % n), tx = idx % rm.w, ty = Math.floor(idx / rm.w);
      var cx = b.x + (tx + 0.5) * t, cy = b.y + (ty + 0.5) * t, s = t * 0.32;
      ctx.fillStyle = 'rgba(8,10,20,0.85)';
      ctx.beginPath();
      for (var j = 0; j < 7; j++) {
        var a = j / 7 * Math.PI * 2, rr = s * (0.55 + 0.45 * hash(rm.id * 7 + j, k));
        var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(20,24,40,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (j = 0; j < 4; j++) {
        var an = hash(rm.id, j + k * 4) * Math.PI * 2, l = s * (1.1 + 0.9 * hash(j, rm.id + k));
        ctx.moveTo(cx + Math.cos(an) * s * 0.5, cy + Math.sin(an) * s * 0.5);
        ctx.lineTo(cx + Math.cos(an + 0.3) * l, cy + Math.sin(an + 0.3) * l);
      }
      ctx.stroke();
      // air leaking
      var ph = (R.t * 1.6 + k * 0.37) % 1;
      ctx.fillStyle = 'rgba(200,220,255,' + (0.35 * (1 - ph)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, s * (0.4 + ph * 1.2), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ------------------------------------------------------------------ crew
  function drawCrew(ctx, g, selId) {
    var ship = g.ship, t = g.L.tile, count = {}, i;
    if (!ship.crew || !ship.crew.length) return;
    for (i = 0; i < ship.crew.length; i++) {
      var c0 = ship.crew[i], d0 = c0.path.length ? -1 : c0.room;
      count[d0] = (count[d0] || 0) + 1;
    }
    var lp = R.lastPos[g.side];
    for (i = 0; i < ship.crew.length; i++) {
      var c = ship.crew[i], race = G.data.crew.races[c.race] || G.data.crew.races.human;
      var p = G.Crew.pos(ship, c);
      var s = gp(g, p.x, p.y);
      lp[c.name] = s;
      var many = !c.path.length && count[c.room] > 2;
      var rad = t * (many ? 0.45 : 0.55) / 2;
      rad = Math.max(3.5, rad);
      if (c.path.length) s.y += Math.sin(R.t * 14 + i) * Math.min(1.2, t * 0.03);
      if (selId && c.id === selId) {
        var pulse = 0.5 + 0.5 * Math.sin(R.t * 6);
        ctx.strokeStyle = COL.amber;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, rad + 3 + pulse * 1.5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = race.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(s.x - rad * 0.3, s.y - rad * 0.32, rad * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = g.flip ? '#4a0d14' : '#10162a';
      ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.stroke();
      if (c.task === 'man' && t >= 20) {
        ctx.fillStyle = g.flip ? '#ff5d5d' : '#62e07e';
        ctx.beginPath(); ctx.arc(s.x + rad * 0.75, s.y - rad * 0.75, Math.max(1.8, rad * 0.28), 0, Math.PI * 2); ctx.fill();
      }
      if (c.hp < c.hpMax) {
        var f = Math.max(0, c.hp / c.hpMax), bw = Math.max(12, rad * 2.2);
        ctx.fillStyle = 'rgba(10,12,24,0.8)';
        ctx.fillRect(s.x - bw / 2 - 1, s.y - rad - 7, bw + 2, 5);
        ctx.fillStyle = f > 0.6 ? '#6fd36a' : f > 0.3 ? '#f2c94c' : '#ff5d5d';
        ctx.fillRect(s.x - bw / 2, s.y - rad - 6, bw * f, 3);
      }
    }
  }

  // ------------------------------------------------------------------ shields
  function drawShield(ctx, g) {
    var ship = g.ship, max = G.Ship.maxLayers(ship), layers = ship.shieldLayers;
    if (max <= 0 && layers <= 0) return;
    var b = bubble(g);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(1, b.ry / b.rx);
    var gr = ctx.createRadialGradient(0, 0, b.rx * 0.6, 0, 0, b.rx);
    gr.addColorStop(0, 'rgba(' + COL.shield + ',0)');
    gr.addColorStop(1, 'rgba(' + COL.shield + ',' + (0.05 + 0.07 * layers).toFixed(3) + ')');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, 0, b.rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineWidth = layers > 0 ? 1 + layers * 0.9 : 1;
    ctx.strokeStyle = 'rgba(' + COL.shield + ',' + (layers > 0 ? 0.3 + 0.14 * layers : 0.14).toFixed(3) + ')';
    if (layers <= 0) ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // inner rings per extra layer
    for (var k = 1; k < layers; k++) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(' + COL.shield + ',0.22)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx - k * 4, b.ry - k * 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (layers < max && ship.shieldCharge > 0) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(' + COL.shield + ',0.85)';
      var st = -Math.PI / 2;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx + 3, b.ry + 3, 0, st, st + Math.PI * 2 * ship.shieldCharge); ctx.stroke();
    }
    ctx.restore();
  }

  // Entry point of segment o->c into the ellipse (or null when o is inside / no crossing).
  function hitEllipse(o, c, e) {
    var dx = c.x - o.x, dy = c.y - o.y, ox = (o.x - e.x) / e.rx, oy = (o.y - e.y) / e.ry, ddx = dx / e.rx, ddy = dy / e.ry;
    var A = ddx * ddx + ddy * ddy, Bq = 2 * (ox * ddx + oy * ddy), C = ox * ox + oy * oy - 1;
    if (C <= 0 || A <= 0) return null;
    var disc = Bq * Bq - 4 * A * C;
    if (disc < 0) return null;
    var s = (-Bq - Math.sqrt(disc)) / (2 * A);
    if (s < 0 || s > 1) return null;
    return { x: o.x + dx * s, y: o.y + dy * s, s: s };
  }

  // ------------------------------------------------------------------ projectiles
  function shooter(side, slot) {
    var g = geo(side);
    if (!g) return null;
    var ws = g.ship.systems.weapons;
    var base = ws ? roomMid(g, ws.room) : shipMid(g);
    var n = g.ship.weapons.length || 1;
    if (slot != null) base = { x: base.x + (slot - (n - 1) / 2) * g.L.tile * 0.35, y: base.y };
    return base;
  }

  function hazardOrigin(id, to) {
    var hv = hash(String(id).length + parseInt(String(id).replace(/\D/g, '') || '1', 10), 3.7);
    var g = geo(to);
    var m = g ? shipMid(g) : { x: R.w / 2, y: R.h / 2 };
    return { x: hv < 0.5 ? -20 : R.w + 20, y: m.y + (hv - 0.5) * R.h * 0.4 };
  }

  function origin(p) {
    if (p.from === 'hazard') {
      if (p.kind === 'fleet') {
        var hv = hash(parseInt(String(p.id).replace(/\D/g, '') || '1', 10), 1.3);
        return { x: hv < 0.5 ? -10 : R.w + 10, y: R.h + 10 };
      }
      return hazardOrigin(p.id, p.to);
    }
    if (p.weapon == null) { var g = geo(p.from); return g ? shipMid(g) : null; }
    return shooter(p.from, p.slot);
  }

  function dest(p, o) {
    var g = geo(p.to);
    if (!g) return null;
    var c = roomMid(g, p.target);
    if (p.kind !== 'missile' && g.ship.shieldLayers > 0 && o) {
      var hit = hitEllipse(o, c, bubble(g));
      if (hit) return { x: hit.x, y: hit.y, shield: true };
    }
    return c;
  }

  function posAt(o, d, f, arc) {
    var x = o.x + (d.x - o.x) * f, y = o.y + (d.y - o.y) * f;
    if (arc) {
      var dx = d.x - o.x, dy = d.y - o.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var off = Math.sin(Math.PI * f) * Math.min(46, len * 0.14) * arc;
      x += -dy / len * off; y += dx / len * off;
    }
    return { x: x, y: y };
  }

  function drawProjectiles(ctx, c) {
    var list = c.projectiles;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.delay > 0) continue;
      var o = origin(p), d = o && dest(p, o);
      if (!o || !d) continue;
      var f = G.U.clamp(p.t / p.dur, 0, 1);
      var side = p.from === 'player' ? 'player' : 'enemy';
      var col = SHOT[side][p.kind] || '#ff5a4f';
      var arc = p.kind === 'missile' ? ((p.slot || 0) % 2 ? -1 : 1) : 0;
      var a = posAt(o, d, f, arc);
      if (p.kind === 'laser') {
        var b = posAt(o, d, Math.max(0, f - 0.07), arc);
        ctx.strokeStyle = shade(col, 0, 0.35); ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2); ctx.lineTo(a.x, a.y); ctx.stroke();
      } else if (p.kind === 'ion') {
        var pr = 4 + Math.sin(R.t * 30 + i) * 1;
        ctx.fillStyle = shade(col, 0, 0.25);
        ctx.beginPath(); ctx.arc(a.x, a.y, pr * 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(a.x, a.y, pr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(a.x, a.y, pr * 0.45, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'missile') {
        var tl = posAt(o, d, Math.max(0, f - 0.12), arc);
        var gr = ctx.createLinearGradient(tl.x, tl.y, a.x, a.y);
        gr.addColorStop(0, 'rgba(255,120,40,0)'); gr.addColorStop(1, 'rgba(255,170,70,0.85)');
        ctx.strokeStyle = gr; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        var ang = Math.atan2(a.y - tl.y, a.x - tl.x);
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(ang);
        ctx.fillStyle = col; ctx.fillRect(-7, -2, 9, 4);
        ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(5, 0); ctx.lineTo(2, 2); ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        if (Math.random() < 0.5) addPart({ x: tl.x, y: tl.y, vx: rnd(-8, 8), vy: rnd(-8, 8), life: 0.5, size: rnd(2, 4), col: '160,160,180', type: 'smoke' });
      } else if (p.kind === 'asteroid') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(R.t * 3 + i);
        ctx.fillStyle = '#8b7a66'; ctx.strokeStyle = '#3d342b'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var k = 0; k < 7; k++) {
          var an = k / 7 * Math.PI * 2, rr = 5 + 2 * hash(i, k);
          if (k) ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      } else {
        // fleet shell
        var tb = posAt(o, d, Math.max(0, f - 0.1), 0);
        ctx.strokeStyle = 'rgba(255,80,60,0.45)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tb.x, tb.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = '#ffd0c0';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function sweepPoints(g, rooms) {
    var pts = rooms.map(function (id) { return roomMid(g, id); });
    if (pts.length === 1) {
      var t = g.L.tile * 0.45;
      pts = [{ x: pts[0].x - t, y: pts[0].y }, { x: pts[0].x + t, y: pts[0].y }];
    }
    return pts;
  }
  function along(pts, f) {
    var n = pts.length - 1;
    if (n <= 0) return pts[0];
    var x = G.U.clamp(f, 0, 1) * n, k = Math.min(n - 1, Math.floor(x)), u = x - k;
    return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * u, y: pts[k].y + (pts[k + 1].y - pts[k].y) * u };
  }

  function drawBeams(ctx, c) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var i = 0; i < c.beams.length; i++) {
      var b = c.beams[i], o = shooter(b.from, b.slot), g = geo(b.to);
      if (!o || !g) continue;
      var col = SHOT[b.from === 'player' ? 'player' : 'enemy'].beam;
      if (b.t < b.delay) {
        var q = b.t / b.delay, rr = 3 + 9 * q;
        var gr = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, rr * 2);
        gr.addColorStop(0, 'rgba(255,255,255,' + (0.5 + 0.5 * q) + ')');
        gr.addColorStop(0.35, shade(col, 0, 0.6 * q + 0.2));
        gr.addColorStop(1, shade(col, 0, 0));
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(o.x, o.y, rr * 2, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      var f = G.U.clamp((b.t - b.delay) / b.dur, 0, 1);
      var pts = sweepPoints(g, b.rooms), pt = along(pts, f);
      var blocked = b.dmg > 0 ? b.dmg - g.ship.shieldLayers <= 0 : g.ship.shieldLayers > 0;
      // scorch trail over the swept rooms
      ctx.strokeStyle = shade(col, 0, blocked ? 0.15 : 0.45);
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      var n = pts.length - 1;
      for (var k = 1; k <= n && k / n <= f; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.lineTo(pt.x, pt.y); ctx.stroke();
      // the beam itself (ends on the shield when fully blocked)
      var end = pt;
      if (blocked) { var hit = hitEllipse(o, pt, bubble(g)); if (hit) end = hit; }
      var jitter = Math.sin(R.t * 60) * 0.8;
      ctx.strokeStyle = shade(col, 0, 0.35); ctx.lineWidth = 9 + jitter;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      if (Math.random() < 0.8) addPart({ x: end.x, y: end.y, vx: rnd(-60, 60), vy: rnd(-60, 60), life: 0.3, size: 2, col: '255,220,160', type: 'spark' });
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ particles / effects
  function addPart(p) {
    if (R.parts.length > 320) R.parts.shift();
    p.max = p.life;
    R.parts.push(p);
  }

  function explode(x, y, scale, col) {
    scale = scale || 1;
    col = col || '255,170,70';
    addPart({ x: x, y: y, vx: 0, vy: 0, life: 0.35, size: 14 * scale, col: '255,240,200', type: 'flash' });
    addPart({ x: x, y: y, vx: 0, vy: 0, life: 0.45, size: 6 * scale, col: col, type: 'ring' });
    var n = Math.round(10 * scale);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = rnd(30, 130) * scale;
      addPart({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.25, 0.6), size: rnd(1.2, 2.6), col: col, type: 'spark' });
    }
    for (i = 0; i < Math.round(3 * scale); i++) {
      addPart({ x: x + rnd(-4, 4), y: y + rnd(-4, 4), vx: rnd(-12, 12), vy: rnd(-12, 12), life: rnd(0.6, 1.1), size: rnd(4, 8) * scale, col: '90,90,110', type: 'smoke' });
    }
  }

  function floatText(x, y, text, col) {
    addPart({ x: x, y: y, vx: 0, vy: -26, life: 0.9, size: 13, col: col, type: 'text', text: text });
  }

  function stepParts(ctx, dt) {
    var list = R.parts, j = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'spark') { p.vx *= 0.92; p.vy *= 0.92; }
      list[j++] = p;
    }
    list.length = j;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      var k = p.life / p.max;
      if (p.type === 'text') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = '700 ' + p.size + 'px "Chakra Petch", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,' + (0.6 * k) + ')';
        ctx.fillText(p.text, p.x + 1, p.y + 1);
        ctx.fillStyle = 'rgba(' + p.col + ',' + k + ')';
        ctx.fillText(p.text, p.x, p.y);
        continue;
      }
      if (p.type === 'smoke') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(' + p.col + ',' + (0.35 * k).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.globalCompositeOperation = 'lighter';
      if (p.type === 'flash') {
        var gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (1.4 - k * 0.4));
        gr.addColorStop(0, 'rgba(' + p.col + ',' + k.toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(' + p.col + ',0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.4), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'ring') {
        ctx.strokeStyle = 'rgba(' + p.col + ',' + (0.8 * k).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (1 - k) * 2.5), 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(' + p.col + ',' + k.toFixed(3) + ')';
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRipples(ctx, dt) {
    var j = 0;
    for (var i = 0; i < R.ripples.length; i++) {
      var r = R.ripples[i];
      r.life -= dt;
      if (r.life <= 0) continue;
      R.ripples[j++] = r;
      var g = geo(r.side);
      if (!g) continue;
      var b = bubble(g), k = r.life / 0.6;
      var ang = Math.atan2((r.y - b.y) / b.ry, (r.x - b.x) / b.rx);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + COL.shield + ',' + (0.9 * k).toFixed(3) + ')';
      ctx.lineWidth = 3 + 3 * k;
      var span = 0.35 + (1 - k) * 0.6;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx + (1 - k) * 4, b.ry + (1 - k) * 4, 0, ang - span, ang + span); ctx.stroke();
      var gr = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 22);
      gr.addColorStop(0, 'rgba(200,240,255,' + (0.7 * k).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(' + COL.shield + ',0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(r.x, r.y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    R.ripples.length = j;
  }

  function runSched(dt) {
    var j = 0;
    for (var i = 0; i < R.sched.length; i++) {
      var s = R.sched[i];
      s.t -= dt;
      if (s.t <= 0) { try { s.fn(); } catch (e) { /* ignore */ } continue; }
      R.sched[j++] = s;
    }
    R.sched.length = j;
  }
  function later(t, fn) { R.sched.push({ t: t, fn: fn }); }

  function randomInShip(side) {
    var g = geo(side);
    if (!g) return null;
    var rm = g.ship.rooms[Math.floor(Math.random() * g.ship.rooms.length)], b = roomBox(g, rm);
    return { x: b.x + Math.random() * b.w, y: b.y + Math.random() * b.h };
  }

  // ------------------------------------------------------------------ fx events
  function fx(ev) {
    if (!ev || !R.ctx) return;
    var g, p, o;
    switch (ev.t) {
      case 'combatStart':
        R.parts.length = 0; R.ripples.length = 0; R.sched.length = 0;
        R.enemyIn = 0; R.dead.enemy = -1; R.dead.player = -1;
        break;
      case 'launch':
        o = origin(ev);
        if (o && ev.from !== 'hazard') addPart({ x: o.x, y: o.y, vx: 0, vy: 0, life: 0.18, size: 9, col: ev.from === 'player' ? '255,220,120' : '255,120,90', type: 'flash' });
        break;
      case 'miss':
        g = geo(ev.to);
        if (g) { p = roomMid(g, ev.target); floatText(p.x, p.y - 8, '闪避', ev.to === 'player' ? '130,230,160' : '200,210,230'); }
        break;
      case 'shield':
        g = geo(ev.side);
        if (g) {
          var from = ev.from === 'hazard' ? { x: R.w / 2, y: ev.side === 'player' ? R.h + 20 : -20 } : shooter(ev.from, null);
          var c = roomMid(g, ev.target), hit = from ? hitEllipse(from, c, bubble(g)) : null;
          p = hit || c;
          R.ripples.push({ side: ev.side, x: p.x, y: p.y, life: 0.6 });
          addPart({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, size: 10, col: '170,230,255', type: 'flash' });
        }
        break;
      case 'hit':
        g = geo(ev.side);
        if (!g) break;
        var rm = g.ship.rooms[ev.target];
        if (rm) {
          var bx = roomBox(g, rm);
          p = { x: bx.x + bx.w * rnd(0.3, 0.7), y: bx.y + bx.h * rnd(0.3, 0.7) };
        } else p = shipMid(g);
        if (ev.kind === 'ion') {
          addPart({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.5, size: 10, col: '157,136,255', type: 'ring' });
          for (var k = 0; k < 8; k++) addPart({ x: p.x, y: p.y, vx: rnd(-70, 70), vy: rnd(-70, 70), life: 0.4, size: 2, col: '180,160,255', type: 'spark' });
        } else if (ev.dmg > 0) {
          explode(p.x, p.y, Math.min(1.8, 0.8 + ev.dmg * 0.35));
          floatText(p.x, p.y - 12, '-' + ev.dmg, ev.side === 'player' ? '255,120,110' : '255,214,120');
          if (ev.side === 'player') {
            R.hurt = Math.min(1, R.hurt + 0.35 + 0.15 * ev.dmg);
            if (!R.reduced) R.shake = Math.min(10, R.shake + 3 + 2 * ev.dmg);
          }
        } else {
          for (k = 0; k < 6; k++) addPart({ x: p.x, y: p.y, vx: rnd(-50, 50), vy: rnd(-50, 50), life: 0.4, size: 2, col: '255,160,60', type: 'spark' });
        }
        break;
      case 'ion':
        g = geo(ev.side);
        if (g && g.ship.systems[ev.sys]) {
          p = roomMid(g, g.ship.systems[ev.sys].room);
          addPart({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.6, size: 12, col: '157,136,255', type: 'ring' });
        }
        break;
      case 'sysDamage':
        g = geo(ev.side);
        if (g && g.ship.systems[ev.sys]) {
          p = roomMid(g, g.ship.systems[ev.sys].room);
          for (k = 0; k < 10; k++) addPart({ x: p.x, y: p.y, vx: rnd(-90, 90), vy: rnd(-90, 90), life: rnd(0.2, 0.5), size: 1.8, col: '255,230,150', type: 'spark' });
        }
        break;
      case 'fire': case 'breach':
        g = geo(ev.side);
        if (g) { p = roomMid(g, ev.room); addPart({ x: p.x, y: p.y, vx: 0, vy: -10, life: 0.8, size: 8, col: ev.t === 'fire' ? '255,120,40' : '120,120,140', type: 'smoke' }); }
        break;
      case 'crewDied':
        p = R.lastPos[ev.side] && R.lastPos[ev.side][ev.name];
        if (p) {
          explode(p.x, p.y, 0.5, '255,90,90');
          floatText(p.x, p.y - 10, ev.name + ' 阵亡', '255,120,120');
        }
        break;
      case 'destroyed':
        R.dead[ev.side] = R.t;
        for (k = 0; k < 7; k++) {
          later(k * 0.2, function () { var q = randomInShip(ev.side); if (q) explode(q.x, q.y, rnd(1, 1.8)); });
        }
        later(1.45, function () {
          var gg = geo(ev.side);
          if (gg) { var m = shipMid(gg); explode(m.x, m.y, 3.2, '255,200,120'); }
          if (!R.reduced && ev.side === 'player') R.shake = 12;
        });
        break;
      case 'flare':
        R.flash = 0.8; R.flashCol = '255,150,60';
        break;
      case 'surge':
        g = geo('enemy');
        if (g) { p = shipMid(g); addPart({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.6, size: 40, col: '255,80,80', type: 'flash' }); }
        break;
      case 'phase2':
        R.flash = 0.6; R.flashCol = '255,60,60';
        g = geo('enemy');
        if (g) { p = shipMid(g); addPart({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.8, size: 30, col: '255,90,90', type: 'ring' }); }
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ overlays (reticles, aiming, msg)
  function drawReticles(ctx, r) {
    var g = geo('enemy');
    if (!g) return;
    var p = r.player, byRoom = {}, sel = G.View.sel;
    p.weapons.forEach(function (w, i) {
      if (w.target == null || !g.ship.rooms[w.target]) return;
      (byRoom[w.target] = byRoom[w.target] || []).push(i);
    });
    Object.keys(byRoom).forEach(function (rid) {
      var b = roomBox(g, g.ship.rooms[rid]);
      byRoom[rid].forEach(function (slot, k) {
        var cx = b.x + b.w - 9 - k * 16, cy = b.y + 9;
        var armed = sel.mode === 'weapon' && sel.slot === slot;
        var st = G.Combat.weaponState(r, p, slot);
        ctx.fillStyle = armed ? COL.amber : 'rgba(20,14,4,0.8)';
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = st.ready || st.frac >= 1 ? '#ffffff' : COL.amber;
        ctx.stroke();
        ctx.font = '700 11px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = armed ? '#1d1405' : COL.amber;
        ctx.fillText(String(slot + 1), cx, cy + 0.5);
      });
    });
  }

  function drawAimOverlay(ctx, r) {
    var sel = G.View.sel, g;
    if (sel.mode === 'weapon') {
      g = geo('enemy');
      if (!g) return;
      var aim = G.View.aim, pulse = 0.5 + 0.5 * Math.sin(R.t * 5);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,181,71,' + (0.45 + 0.3 * pulse).toFixed(3) + ')';
      for (var i = 0; i < g.ship.rooms.length; i++) {
        var b = roomBox(g, g.ship.rooms[i]);
        ctx.strokeRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5);
      }
      ctx.setLineDash([]);
      if (aim && aim.room >= 0) {
        (aim.rooms || []).forEach(function (id, k) {
          var bb = roomBox(g, g.ship.rooms[id]);
          ctx.fillStyle = 'rgba(255,181,71,' + (k === 0 ? 0.42 : 0.24) + ')';
          ctx.fillRect(bb.x, bb.y, bb.w, bb.h);
        });
        var tb = roomBox(g, g.ship.rooms[aim.room]), cx = tb.x + tb.w / 2, cy = tb.y + tb.h / 2;
        ctx.strokeStyle = COL.amber; ctx.lineWidth = 2;
        ctx.strokeRect(tb.x + 1, tb.y + 1, tb.w - 2, tb.h - 2);
        var rr = Math.min(tb.w, tb.h) * 0.3;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.moveTo(cx - rr - 5, cy); ctx.lineTo(cx - rr + 4, cy); ctx.moveTo(cx + rr - 4, cy); ctx.lineTo(cx + rr + 5, cy);
        ctx.moveTo(cx, cy - rr - 5); ctx.lineTo(cx, cy - rr + 4); ctx.moveTo(cx, cy + rr - 4); ctx.lineTo(cx, cy + rr + 5);
        ctx.stroke();
        if (aim.rooms && aim.rooms.length > 1) {
          var pts = sweepPoints(g, aim.rooms);
          ctx.strokeStyle = 'rgba(255,90,70,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
          for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
      ctx.restore();
    } else if (sel.mode === 'crew') {
      g = geo('player');
      if (!g) return;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(98,224,126,0.55)';
      for (var j = 0; j < g.ship.rooms.length; j++) {
        var rb = roomBox(g, g.ship.rooms[j]);
        ctx.strokeRect(rb.x + 2.5, rb.y + 2.5, rb.w - 5, rb.h - 5);
      }
      ctx.restore();
    }
  }

  function drawMsg(ctx, c) {
    var m = c.msg, lay = L();
    if (!m || !lay || !lay.enemyZone) return;
    var age = c.time - m.t;
    if (age > 3 || age < 0) return;
    var a = age < 2.4 ? 1 : 1 - (age - 2.4) / 0.6;
    var z = lay.enemyZone, y = z.y + z.h - 12;
    ctx.save();
    ctx.font = '600 14px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var w = Math.min(z.w - 16, ctx.measureText(m.text).width + 24);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(6,9,20,0.78)';
    ctx.fillRect(z.x + z.w / 2 - w / 2, y - 11, w, 22);
    ctx.fillStyle = m.kind === 'bad' ? '#ff8080' : m.kind === 'warn' ? '#ffcf70' : m.kind === 'good' ? '#8ff08a' : COL.text;
    ctx.fillText(m.text, z.x + z.w / 2, y + 0.5, z.w - 24);
    ctx.restore();
  }

  // ------------------------------------------------------------------ ships
  function drawShip(ctx, side, alpha, dx) {
    var g = geo(side);
    if (!g) return;
    var r = run(), sel = G.View.sel;
    if (dx) g = { ship: g.ship, L: shiftL(g.L, dx), flip: g.flip, side: side };
    ctx.save();
    ctx.globalAlpha = alpha;
    var hb = hullBitmap(g.ship, g.L.tile, g.flip, side === 'enemy');
    var m = hb.m * g.L.tile;
    ctx.drawImage(hb.c, g.L.ox - m, g.L.oy - m, hb.c.width / R.dpr, hb.c.height / R.dpr);
    ctx.globalCompositeOperation = 'lighter';
    drawEngineGlow(ctx, g, hb.sh, alpha);
    ctx.globalCompositeOperation = 'source-over';
    drawRooms(ctx, g);
    drawCrew(ctx, g, side === 'player' && sel.mode === 'crew' ? sel.crewId : null);
    drawShield(ctx, g);          // inside the alpha block: the bubble fades with the ship instead of popping
    ctx.restore();
    return g;
  }
  function shiftL(l, dx) {
    var o = {};
    for (var k in l) o[k] = l[k];
    o.ox = l.ox + dx;
    return o;
  }

  // ------------------------------------------------------------------ frame
  function frame(dt) {
    var ctx = R.ctx;
    if (!ctx || R.w <= 0 || R.h <= 0) return;
    R.t += dt;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    var r = run();
    drawBackground(ctx, r, dt);
    runSched(dt);
    if (!r || !L() || !L().player) { stepParts(ctx, dt); return; }
    var c = r.mode === 'combat' ? r.combat : null;

    ctx.save();
    if (R.shake > 0.2 && !R.reduced) ctx.translate(rnd(-1, 1) * R.shake, rnd(-1, 1) * R.shake);
    R.shake *= Math.exp(-dt * 9);

    if (c) {
      var e = c.enemy;
      if (R.enemyRef !== e) { R.enemyRef = e; if (R.enemyIn >= 1 && c.time > 0.1) R.enemyIn = 1; }
      R.enemyIn = Math.min(1, R.enemyIn + dt / 0.7);
      var ease = 1 - Math.pow(1 - R.enemyIn, 3);
      var alpha = ease;
      if (c.pending === 'enemyFled' || (c.result === 'enemyFled')) alpha *= G.U.clamp(c.pendingT / G.data.rules.endDelay, 0, 1);
      if (e.hull <= 0 && R.dead.enemy >= 0) alpha *= G.U.clamp(1 - (R.t - R.dead.enemy - 1.1) / 0.5, 0, 1);
      if (alpha > 0.01) drawShip(ctx, 'enemy', alpha, (1 - ease) * 60);
    } else {
      R.enemyRef = null;
      drawPlanet(ctx, r);
    }
    var pa = 1;
    if (r.player.hull <= 0 && R.dead.player >= 0) pa = G.U.clamp(1 - (R.t - R.dead.player - 1.1) / 0.6, 0.15, 1);
    drawShip(ctx, 'player', pa, 0);

    if (c) {
      drawReticles(ctx, r);
      drawAimOverlay(ctx, r);
      drawBeams(ctx, c);
      drawProjectiles(ctx, c);
    } else if (G.View.sel.mode === 'crew') drawAimOverlay(ctx, r);
    drawRipples(ctx, dt);
    stepParts(ctx, dt);
    ctx.restore();

    // hurt flash over the player zone / full-screen flashes
    var lay = L();
    if (R.hurt > 0.01 && lay.playerZone) {
      var z = lay.playerZone;
      var gr = ctx.createRadialGradient(z.x + z.w / 2, z.y + z.h / 2, Math.min(z.w, z.h) * 0.3, z.x + z.w / 2, z.y + z.h / 2, Math.max(z.w, z.h) * 0.75);
      gr.addColorStop(0, 'rgba(255,40,40,0)');
      gr.addColorStop(1, 'rgba(255,40,40,' + (0.45 * R.hurt).toFixed(3) + ')');
      ctx.fillStyle = gr;
      ctx.fillRect(z.x, z.y, z.w, z.h);
      R.hurt *= Math.exp(-dt * 4);
    }
    if (R.flash > 0.01) {
      ctx.fillStyle = 'rgba(' + R.flashCol + ',' + (0.35 * R.flash).toFixed(3) + ')';
      ctx.fillRect(0, 0, R.w, R.h);
      R.flash *= Math.exp(-dt * 3);
    }
    if (c) drawMsg(ctx, c);
  }

  // ------------------------------------------------------------------ setup
  function init(canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      R.reduced = !!mq.matches;
      var on = function (e) { R.reduced = !!e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    } catch (e) { R.reduced = false; }
    resize();
  }

  // Returns true when the backing store was reallocated (which clears it); an unchanged size is a no-op, so the
  // repeated resize / ResizeObserver / fonts.ready calls neither blank the canvas nor drop the hull cache.
  function resize() {
    if (!R.canvas) return false;
    var rect = R.canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(0, Math.round(rect.width)), h = Math.max(0, Math.round(rect.height));
    var cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    if (w === R.w && h === R.h && dpr === R.dpr && R.canvas.width === cw && R.canvas.height === ch) return false;
    R.dpr = dpr; R.w = w; R.h = h;
    R.canvas.width = cw;
    R.canvas.height = ch;
    hullCache.length = 0;
    return true;
  }

  // Draw a ship template (G.data.ships[id] / G.data.hulls[id] or any {w,h,rooms,tint}) nose-up, fit to a canvas.
  // opts: { width, height (CSS px; default = canvas client size), crew: bool, flip: bool, pad: tiles }
  function miniShip(canvas, template, opts) {
    opts = opts || {};
    var tpl = typeof template === 'string' ? (G.data.ships[template] || G.data.hulls[template]) : template;
    if (!canvas || !tpl) return;
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var cw = opts.width || canvas.clientWidth || canvas.width || 120;
    var ch = opts.height || canvas.clientHeight || canvas.height || 160;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var ship = {
      w: tpl.w, h: tpl.h, tint: tpl.tint || '#8ea6cf', name: tpl.name || tpl.id, templateId: tpl.id, crewless: !!tpl.crewless,
      rooms: tpl.rooms.map(function (rm, i) { return { id: i, x: rm.x, y: rm.y, w: rm.w, h: rm.h, sys: rm.sys || null, o2: 100, fire: 0, breach: 0 }; }),
      systems: {}, crew: [], weapons: [],
    };
    var pad = opts.pad != null ? opts.pad : 1.4;
    var t = Math.max(4, Math.floor(Math.min(cw / (ship.w + 2 * pad), ch / (ship.h + 2 * pad + 0.9))));
    var flip = !!opts.flip;
    var ox = (cw - ship.w * t) / 2, oy = (ch - ship.h * t) / 2 + (flip ? -0.45 : 0.45) * t;
    var map = function (gx, gy) { return { x: ox + gx * t, y: flip ? oy + (ship.h - gy) * t : oy + gy * t }; };
    drawHull(ctx, ship, t, map, flip);
    var g = { ship: ship, L: { tile: t, ox: ox, oy: oy }, flip: flip, side: 'mini' };
    ship.rooms.forEach(function (rm) {
      var b = roomBox(g, rm);
      ctx.fillStyle = flip ? COL.floorE : COL.floor;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = COL.wall; ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5);
      if (rm.sys) {
        var size = Math.max(6, 0.6 * Math.min(b.w, b.h));
        ctx.fillStyle = COL.badge;
        ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, size * 0.66, 0, Math.PI * 2); ctx.fill();
        drawGlyph(ctx, rm.sys, b.x + b.w / 2, b.y + b.h / 2, size, COL.on);
      }
    });
    if (opts.crew !== false && tpl.crew) {
      var perRoom = {};
      tpl.crew.forEach(function (cm) {
        if (cm.room == null || !ship.rooms[cm.room]) return;
        var k = perRoom[cm.room] = (perRoom[cm.room] || 0) + 1;
        var rm = ship.rooms[cm.room], b = roomBox(g, rm);
        var race = G.data.crew.races[cm.race] || G.data.crew.races.human;
        var cx = b.x + b.w * (k === 1 ? 0.3 : 0.7), cy = b.y + b.h * 0.72, rad = Math.max(2.5, t * 0.2);
        ctx.fillStyle = race.color;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#10162a'; ctx.lineWidth = 1.2; ctx.stroke();
      });
    }
  }

  G.Render = {
    init: init, resize: resize, frame: frame, fx: fx,
    pickRoom: pickRoom, nearestRoom: nearestRoom, miniShip: miniShip,
    _R: R,
  };
})();
