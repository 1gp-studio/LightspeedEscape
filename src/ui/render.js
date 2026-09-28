// Canvas renderer (SPEC §9 Canvas, ART.md "Canvas"). Pixel art: every scene element is drawn into a low-res
// buffer where 1 art px = 2 CSS px, then upscaled onto the <canvas> with smoothing off; text (msg line, reticle
// digits, O2 %, floating numbers) is drawn at full resolution on top. Contents: dithered sector nebula +
// 1-px starfield; both ships (procedural plated hull cached per ship+tile+parity, rooms with tile grid, walls,
// doors, consoles and 9×9 pixel system icons; power / damage / ion states; low-O2 dither, 3-frame fire,
// breaches with debris; animated thrusters), pixel crew per race with walk cycles and tools, dithered shield
// ellipses with pixel ripples, pixel lasers / ion orbs / missiles / beams / asteroids, blocky explosions,
// target reticles, the targeting overlay while a weapon is armed, integer screen shake and the combat msg.
// Reads G.View.layout and the run; never mutates game state. Math.random only for cosmetic particles.
//   G.Render = { init(canvas), resize(), frame(dt), fx(ev), pickRoom(side, px, py),
//                nearestRoom(side, px, py, margin), miniShip(canvas, template, opts) }
(function () {
  'use strict';
  var G = globalThis.G;

  var STEEL = ['#1b2233', '#2c374f', '#46546f', '#6f7f9c', '#a7b4cc'];
  var C = {
    floor: '#8d93a1', floorSh: '#7c8291', grid: '#6d7382', wall: '#1a1e29', rim: '#11151f', ink: '#141824',
    door: '#e5b64c', doorDk: '#8a6a22', con: '#46546f', conDk: '#262c3a', scr: '#1b2233',
    block: '#141824', blockIn: '#262c3a', blockHi: '#39415a', vent: '#5d6372',
    on: '#62e07e', off: '#7c8496', part: '#f0a03a', dmg: '#ff5d5d', ion: '#9d88ff',
    shield: '#52c6ff', amber: '#ffb547', amberHi: '#ffd166', o2: '#ff6f91', text: '#e6ecf8',
    fire0: '#c2410c', fire1: '#ff8a3d', fire2: '#ffd166', white: '#ffffff', smoke: '#3a3f4d',
  };
  var SHOT = {
    player: { core: '#f2fff2', trail: '#62e07e', tail: '#2c8a4a', beam: '#ffd166', edge: '#ff8a3d', flash: '#ffe9a8' },
    enemy: { core: '#fff0ea', trail: '#ff5d5d', tail: '#9a2a2a', beam: '#ff7a6b', edge: '#a3202a', flash: '#ffb09a' },
  };
  var FLAME = {
    player: ['#ffffff', '#9fe6ff', '#3f8fe0'],
    enemy: ['#fff3c4', '#ffb347', '#e0582c'],
  };
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  var R = {
    canvas: null, ctx: null, dpr: 1, w: 0, h: 0, t: 0,
    buf: null, bctx: null, bw: 0, bh: 0,
    bg: null, bgKey: '', stars: null, starKey: '', drift: 0, planet: null, planetKey: '',
    parts: [], pool: [], sched: [], ripples: [], lastPos: { player: {}, enemy: {} }, face: {}, prevX: {},
    shake: 0, sx: 0, sy: 0, hurt: 0, flash: 0, flashCol: '#ff963c',
    enemyRef: null, enemyIn: 1, dead: { player: -1, enemy: -1 },
    reduced: false, pats: {}, lk: { player: null, enemy: null }, manned: {},
  };
  var layerCache = [];
  var spriteCache = {};
  var ringCache = {};
  var ptsCache = {};
  var doorCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function run() { return G.App ? G.App.run : null; }
  function L() { return G.View ? G.View.layout : null; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }
  function A(v) { return Math.round(v / 2); }            // CSS px -> art px

  // ------------------------------------------------------------------ colors / hashing
  function rgb(hex) {
    var h = String(hex || '#8ea6cf').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(c) {
    var s = '#';
    for (var i = 0; i < 3; i++) { var v = Math.max(0, Math.min(255, Math.round(c[i]))); s += (v < 16 ? '0' : '') + v.toString(16); }
    return s;
  }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function hashStr(s) {
    s = String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function h01(a, b) {
    var x = Math.imul((a | 0) ^ Math.imul((b | 0) + 0x9e3779b9, 0x85ebca6b), 0xc2b2ae35);
    x ^= x >>> 15; x = Math.imul(x, 0x27d4eb2d); x ^= x >>> 13;
    return (x >>> 0) / 4294967296;
  }
  function hash(a, b) { var x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); }

  // Steel ramp tinted toward ship.tint (enemy hulls read red/brown/teal, the player's bluish steel).
  function tintPal(tint, k) {
    var t = rgb(tint), m = (t[0] + t[1] + t[2]) / 3 || 1;
    var out = STEEL.map(function (hx) {
      var s = rgb(hx);
      return [s[0] * (1 + (t[0] / m - 1) * k), s[1] * (1 + (t[1] / m - 1) * k), s[2] * (1 + (t[2] / m - 1) * k)];
    });
    out.push(mixc(out[2], out[3], 0.35));   // 5: light plate
    out.push(mixc(out[2], out[1], 0.4));    // 6: dark plate
    out.push(mixc(out[2], out[1], 0.7));    // 7: soft seam
    return out;
  }

  // 2×2 checkerboard pattern of one color (dithered transparency).
  function pat(col) {
    var p = R.pats[col];
    if (p) return p;
    var c = mk(2, 2), x = c.getContext('2d');
    x.fillStyle = col; x.fillRect(0, 0, 1, 1); x.fillRect(1, 1, 1, 1);
    p = R.bctx.createPattern(c, 'repeat');
    R.pats[col] = p;
    return p;
  }

  // ------------------------------------------------------------------ geometry (CSS px; shared with input)
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
  function gp(g, x, y) { return { x: g.L.ox + x * g.L.tile, y: g.flip ? g.L.oy + (g.ship.h - y) * g.L.tile : g.L.oy + y * g.L.tile }; }
  function shipMid(g) { return { x: g.L.ox + g.ship.w * g.L.tile / 2, y: g.L.oy + g.ship.h * g.L.tile / 2 }; }
  function bubble(g) {
    var t = g.L.tile, m = shipMid(g);
    return { x: m.x, y: m.y, rx: g.ship.w * t / 2 + 0.8 * t, ry: g.ship.h * t / 2 + 0.95 * t };
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

  // ------------------------------------------------------------------ pixel primitives (art px)
  // Bresenham line; w = square brush size; dash > 0 skips every other run of `dash` px.
  function pline(c, x0, y0, x1, y1, w, dash) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx + dy, hw = (w - 1) >> 1, n = 0, guard = 0;
    for (;;) {
      if (!dash || ((n / dash) | 0) % 2 === 0) c.fillRect(x0 - hw, y0 - hw, w, w);
      n++;
      if ((x0 === x1 && y0 === y1) || ++guard > 2000) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  // Marching-ants dashed rectangle outline (runs of 2 px).
  function dashRect(c, x, y, w, h, ph) {
    var i;
    for (i = -(ph & 3); i < w; i += 4) {
      var a = Math.max(0, i), b = Math.min(w, i + 2);
      if (b > a) { c.fillRect(x + a, y, b - a, 1); c.fillRect(x + w - b, y + h - 1, b - a, 1); }
    }
    for (i = -(ph & 3); i < h; i += 4) {
      var a2 = Math.max(0, i), b2 = Math.min(h, i + 2);
      if (b2 > a2) { c.fillRect(x + w - 1, y + a2, 1, b2 - a2); c.fillRect(x, y + h - b2, 1, b2 - a2); }
    }
  }
  function rectLine(c, x, y, w, h) {
    c.fillRect(x, y, w, 1); c.fillRect(x, y + h - 1, w, 1);
    c.fillRect(x, y + 1, 1, h - 2); c.fillRect(x + w - 1, y + 1, 1, h - 2);
  }
  // Ellipse outline points (art px offsets), ordered clockwise from the top. Cached per radii.
  function ellPts(rx, ry) {
    var key = rx + 'x' + ry, p = ptsCache[key];
    if (p) return p;
    var n = Math.ceil(Math.PI * 2 * Math.max(rx, ry, 1) * 1.6), xs = [], ys = [], lx = 1e9, ly = 1e9;
    for (var k = 0; k < n; k++) {
      var a = -Math.PI / 2 + k / n * Math.PI * 2;
      var x = Math.round(Math.cos(a) * rx), y = Math.round(Math.sin(a) * ry);
      if (x === lx && y === ly) continue;
      if (xs.length && x === xs[0] && y === ys[0]) continue;
      xs.push(x); ys.push(y); lx = x; ly = y;
    }
    p = { x: xs, y: ys, n: xs.length };
    ptsCache[key] = p;
    return p;
  }
  function ring(c, cx, cy, r, step) {
    var p = ellPts(r, r);
    for (var i = 0; i < p.n; i += step || 1) c.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);
  }

  // ------------------------------------------------------------------ sprites (string art)
  function spriteFrom(rows, pal, outline, mirror) {
    var h = rows.length, w = rows[0].length, o = outline ? 1 : 0;
    var c = mk(w + 2 * o, h + 2 * o), x = c.getContext('2d');
    var filled = new Uint8Array((w + 2 * o) * (h + 2 * o)), W = w + 2 * o;
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var ch = rows[j][mirror ? w - 1 - i : i];
        if (ch === '.' || ch === ' ' || !pal[ch]) continue;
        x.fillStyle = pal[ch];
        x.fillRect(i + o, j + o, 1, 1);
        filled[(j + o) * W + i + o] = 1;
      }
    }
    if (outline) {
      x.fillStyle = outline;
      for (var yy = 0; yy < h + 2; yy++) {
        for (var xx = 0; xx < W; xx++) {
          if (filled[yy * W + xx]) continue;
          var nb = (xx > 0 && filled[yy * W + xx - 1]) || (xx < W - 1 && filled[yy * W + xx + 1]) ||
            (yy > 0 && filled[(yy - 1) * W + xx]) || (yy < h + 1 && filled[(yy + 1) * W + xx]);
          if (nb) x.fillRect(xx, yy, 1, 1);
        }
      }
    }
    return c;
  }

  // 9×9 system icons
  var ICON9 = {
    shields: ['.#######.', '##.....##', '#.......#', '#...#...#', '#..###..#', '##..#..##', '.##...##.', '..##.##..', '....#....'],
    engines: ['....#....', '...###...', '..##.##..', '.##...##.', '##..#..##', '...###...', '..##.##..', '.##...##.', '##.....##'],
    weapons: ['....#....', '..#####..', '.#..#..#.', '.#.....#.', '###.#.###', '.#.....#.', '.#..#..#.', '..#####..', '....#....'],
    oxygen: ['.###.....', '#...#....', '#...#.##.', '#...##..#', '.###.#..#', '......##.', '..##.....', '.#..#....', '..##.....'],
    medbay: ['...###...', '...###...', '...###...', '#########', '#########', '#########', '...###...', '...###...', '...###...'],
    piloting: ['..#####..', '.#.....#.', '#...#...#', '#..###..#', '####.####', '#...#...#', '#..#.#..#', '.##...##.', '..#####..'],
    sensors: ['.........', '.#######.', '#.......#', '#..###..#', '#.#####.#', '#..###..#', '#.......#', '.#######.', '.........'],
    doors: ['#########', '#...#...#', '#...#...#', '#...#...#', '#..##...#', '#...#...#', '#...#...#', '#...#...#', '#########'],
  };
  function icon(sys, col) {
    var key = 'i|' + sys + '|' + col, s = spriteCache[key];
    if (s) return s;
    s = spriteFrom(ICON9[sys] || ICON9.sensors, { '#': col }, null, false);
    spriteCache[key] = s;
    return s;
  }

  // 3-frame fire (7×8)
  var FIRE = [
    ['...o...', '..oo...', '..oyo..', '.ooyo..', '.oyyyo.', 'royyyor', 'royywor', '.rrrrr.'],
    ['....o..', '...oo..', '..oyo..', '..oyyo.', '.oyyyo.', 'royywor', 'roywyor', '.rrrrr.'],
    ['.......', '..o....', '..oo.o.', '.ooyoo.', '.oyyyo.', 'royyyor', 'rowyyor', '.rrrrr.'],
  ];
  function fireSprite(k) {
    var key = 'f' + k, s = spriteCache[key];
    if (s) return s;
    s = spriteFrom(FIRE[k], { r: C.fire0, o: C.fire1, y: C.fire2, w: '#fff4d6' }, null, false);
    spriteCache[key] = s;
    return s;
  }

  // Crew: 5×8 body + auto outline = 7×10. Frames: 0 stand, 1/2 walk. Drawn facing right; mirrored for left.
  var CREW = {
    human: { body: ['.HHH.', 'HSSSH', 'SSESE', '.SSS.', 'UUAUU', 'SUUUS', '.UUU.'],
             legs: ['.L.L.', 'L..L.', '.L..L'], arms: [null, 'SUUU.', '.UUUS'] },
    engi: { body: ['TTTTT', 'TVVVT', 'TVWVW', 'tTTTt', '.UUU.', 'TUUUT', '.UUU.'],
            legs: ['.L.L.', 'L..L.', '.L..L'], arms: [null, 'TUUU.', '.UUUT'] },
    rock: { body: ['.RRR.', 'RrRRk', 'RRERE', 'kRRRk', 'RUUUR', 'RrRRR', 'RRRkR'],
            legs: ['RR.RR', 'RR.R.', '.R.RR'], arms: [null, 'RrRR.', '.rRRR'] },
    swift: { body: ['g...g', '.GGG.', '.GEGE', '.GGG.', '..U..', 'GUUUG', '.UUU.'],
             legs: ['.L.L.', 'L..L.', '.L..L'], arms: [null, 'GUUU.', '.UUUG'] },
  };
  var HAIR = ['#5a3a22', '#2a1d14', '#c9a15a', '#8a4b2a', '#d9d2c4'];
  function crewSprite(race, side, frame, left, hair) {
    var key = 'c|' + race + '|' + side + '|' + frame + '|' + (left ? 1 : 0) + '|' + hair, s = spriteCache[key];
    if (s) return s;
    var def = CREW[race] || CREW.human, rows = def.body.slice();
    if (def.arms[frame]) rows[5] = def.arms[frame];
    rows.push(def.legs[frame] || def.legs[0]);
    var enemy = side === 'enemy';
    var pal = {
      H: HAIR[hair % HAIR.length], S: '#f2c29b', E: race === 'rock' ? '#ffcf5c' : '#1a1e29',
      U: enemy ? '#b83a3a' : '#3f6fc4', A: enemy ? '#1a1e29' : '#e5b64c', L: '#2a2f3d',
      T: '#79d8c4', t: '#3f9c8a', V: '#1a3a40', W: '#e8fff9',
      R: '#c98a5b', r: '#e0a878', k: '#8a5a36', G: '#b9e36e', g: '#7fa840',
    };
    if (race === 'rock') pal.L = '#8a5a36';
    s = spriteFrom(rows, pal, '#141824', left);
    spriteCache[key] = s;
    return s;
  }

  // Lumpy asteroid sprites (deterministic), 4 flips each.
  function rockSprite(v, f) {
    var key = 'a|' + v + '|' + f, s = spriteCache[key];
    if (s) return s;
    var n = 8, c = mk(n, n), x = c.getContext('2d');
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var dx = i - 3.5, dy = j - 3.5, a = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy);
        var rr = 2.6 + 1.2 * h01(v * 31 + Math.floor((a + Math.PI) / (Math.PI * 2) * 7), 5);
        if (d > rr) continue;
        var lit = (-dx - dy) / 7 + (h01(v * 97 + i, j) - 0.5) * 0.4;
        x.fillStyle = d > rr - 1 ? '#2a2d35' : lit > 0.25 ? '#c3c7cf' : lit > -0.15 ? '#8b8f99' : '#5d616b';
        var xi = f & 1 ? n - 1 - i : i, yj = f & 2 ? n - 1 - j : j;
        x.fillRect(xi, yj, 1, 1);
      }
    }
    spriteCache[key] = c;
    return c;
  }

  // Breach hole: jagged black hole with torn rim (deterministic per seed).
  function breachSprite(size, seed) {
    var key = 'b|' + size + '|' + seed, s = spriteCache[key];
    if (s) return s;
    var n = size + 2, c = mk(n, n), x = c.getContext('2d'), m = new Uint8Array(n * n), cx = (n - 1) / 2, i, j;
    for (j = 0; j < n; j++) {
      for (i = 0; i < n; i++) {
        var dx = i - cx, dy = j - cx, a = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy);
        var seg = Math.floor((a + Math.PI) / (Math.PI * 2) * 9) % 9;
        var rr = size / 2 * (0.55 + 0.45 * h01(seed * 13 + seg, 7));
        if (d <= rr) m[j * n + i] = 1;
      }
    }
    for (j = 0; j < n; j++) {
      for (i = 0; i < n; i++) {
        if (!m[j * n + i]) continue;
        var edge = i === 0 || j === 0 || i === n - 1 || j === n - 1 || !m[j * n + i - 1] || !m[j * n + i + 1] || !m[(j - 1) * n + i] || !m[(j + 1) * n + i];
        x.fillStyle = edge ? (h01(seed + i * 7, j) < 0.3 ? '#a7b4cc' : '#3a3f4d') : ((i + j) & 1 && h01(seed, i * n + j) < 0.08 ? '#6f7f9c' : '#05070e');
        x.fillRect(i, j, 1, 1);
      }
    }
    spriteCache[key] = c;
    return c;
  }

  // ------------------------------------------------------------------ background (art res, cached)
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = h01(xi * 73 + s, yi), b = h01((xi + 1) * 73 + s, yi), c = h01(xi * 73 + s, yi + 1), d = h01((xi + 1) * 73 + s, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function buildBg(bw, bh, typeId) {
    var type = G.data.sectors.types[typeId] || { color: '#1d3566', accent: '#58a7d6' };
    var c = mk(bw, bh), x = c.getContext('2d'), img = x.createImageData(c.width, c.height), d = img.data;
    var s0 = rgb('#05070e'), s1 = rgb('#0b1022'), tc = rgb(type.color), ta = rgb(type.accent);
    var lv = [null, mixc(s1, tc, 0.38), mixc(s1, tc, 0.72), mixc(mixc(tc, ta, 0.3), s1, 0.15)];
    var seed = hashStr(typeId || 'x') & 0xffff, M = Math.max(bw, bh);
    var blobs = [];
    for (var k = 0; k < 3; k++) {
      blobs.push([h01(seed, k * 3 + 1) * bw, (0.12 + 0.76 * h01(seed, k * 3 + 2)) * bh, (0.22 + 0.2 * h01(seed, k * 3 + 3)) * M, k === 0 ? 1 : 0.75]);
    }
    for (var y = 0; y < c.height; y++) {
      for (var i = 0; i < c.width; i++) {
        var b = BAYER[(y & 3) * 4 + (i & 3)] / 16;
        var base = (y / bh) + (b - 0.5) * 0.3 > 0.55 ? s1 : s0;
        var den = 0;
        for (k = 0; k < 3; k++) {
          var bb = blobs[k], dx = (i - bb[0]) / bb[2], dy = (y - bb[1]) / (bb[2] * 0.7), q = 1 - (dx * dx + dy * dy);
          if (q > 0) den += q * bb[3];
        }
        den *= 0.55 + 0.9 * vnoise(i / 22, y / 22, seed) * (0.6 + 0.4 * vnoise(i / 7, y / 7, seed + 9));
        var l = Math.min(3, Math.floor(den * 2.6 + b * 0.999));
        var col = l > 0 ? lv[l] : base, o = (y * c.width + i) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function buildStars(bw, bh) {
    var c = mk(bw, bh), x = c.getContext('2d'), n = Math.round(bw * bh / 150);
    var cols = ['#39405c', '#5a6488', '#a7b4cc', '#ffffff', '#ffd9b0', '#b0ccff'];
    for (var k = 0; k < n; k++) {
      var sx = Math.floor(h01(k, 11) * bw), sy = Math.floor(h01(k, 23) * bh), r = h01(k, 37);
      x.fillStyle = r < 0.55 ? cols[0] : r < 0.8 ? cols[1] : r < 0.92 ? cols[2] : r < 0.96 ? cols[5] : r < 0.98 ? cols[4] : cols[3];
      x.fillRect(sx, sy, 1, 1);
      if (r > 0.985) {
        x.fillStyle = cols[1];
        x.fillRect(sx - 1, sy, 1, 1); x.fillRect(sx + 1, sy, 1, 1); x.fillRect(sx, sy - 1, 1, 1); x.fillRect(sx, sy + 1, 1, 1);
      }
    }
    return c;
  }
  function drawBackground(c, r, dt) {
    var typeId = r && r.sector ? r.sector.type : 'civilian';
    var k = R.bw + 'x' + R.bh + ':' + typeId;
    if (R.bgKey !== k) { R.bgKey = k; R.bg = buildBg(R.bw, R.bh, typeId); }
    var sk = R.bw + 'x' + R.bh;
    if (R.starKey !== sk) { R.starKey = sk; R.stars = buildStars(R.bw, R.bh); }
    c.drawImage(R.bg, 0, 0);
    if (!R.reduced) R.drift = (R.drift + dt * 2.5) % R.bh;
    var y = Math.floor(R.drift);
    c.drawImage(R.stars, 0, y);
    c.drawImage(R.stars, 0, y - R.bh);
  }

  // Pixel planet + blinking beacon in the enemy zone while not in combat.
  function buildPlanet(ra, typeId) {
    var type = G.data.sectors.types[typeId] || {};
    var tc = rgb(type.color || '#1d5566'), ta = rgb(type.accent || '#58c7d6'), black = [8, 10, 20];
    var tones = [mixc(tc, black, 0.65), mixc(tc, black, 0.3), tc, mixc(tc, ta, 0.55), mixc(ta, [255, 255, 255], 0.25)];
    var n = ra * 2 + 1, c = mk(n + 8, n + 8), x = c.getContext('2d'), img = x.createImageData(c.width, c.height), d = img.data;
    var seed = hashStr(typeId || 'p') & 0xffff;
    for (var j = 0; j < c.height; j++) {
      for (var i = 0; i < c.width; i++) {
        var dx = (i - 4 - ra) / ra, dy = (j - 4 - ra) / ra, rr = dx * dx + dy * dy, o = (j * c.width + i) * 4;
        if (rr > 1) {
          // thin dithered atmosphere halo on the lit side
          if (rr < 1.13 && (dx + dy) < -0.3 && ((i + j) & 1)) { var hc = mixc(ta, black, 0.35); d[o] = hc[0]; d[o + 1] = hc[1]; d[o + 2] = hc[2]; d[o + 3] = 255; }
          continue;
        }
        var nz = Math.sqrt(1 - rr), lit = (-0.55 * dx - 0.6 * dy + 0.58 * nz);
        var band = vnoise(dx * 1.5 + 9, dy * 7, seed) * 0.45 + vnoise(dx * 3, dy * 12, seed + 3) * 0.15;
        var b = BAYER[(j & 3) * 4 + (i & 3)] / 16;
        var v = lit * 3.4 + band * 1.1 + b * 0.8 - 0.2;
        var ti = Math.max(0, Math.min(4, Math.floor(v)));
        var col = tones[ti];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function drawPlanet(c, r) {
    var lay = L();
    if (!lay || !lay.enemyZone || !r.sector) return;
    var z = lay.enemyZone;
    var ra = Math.max(6, Math.round(Math.min(z.w, z.h) * 0.42 / 2));
    var key = ra + ':' + r.sector.type;
    if (R.planetKey !== key) { R.planetKey = key; R.planet = buildPlanet(ra, r.sector.type); }
    var cx = A(z.x + z.w * 0.78), cy = A(z.y + z.h * 0.62);
    c.drawImage(R.planet, cx - ra - 4, cy - ra - 4);
    // beacon: blinking pixel + expanding pixel ring
    var bx = A(z.x + z.w * 0.2), by = A(z.y + z.h * 0.7), ph = (R.t * 0.8) % 1;
    c.fillStyle = C.amber;
    c.fillRect(bx - 1, by - 1, 2, 2);
    if (Math.floor(R.t * 2) % 2 === 0) { c.fillStyle = C.amberHi; c.fillRect(bx - 1, by - 1, 1, 1); }
    c.globalAlpha = 1 - ph;
    ring(c, bx, by, 2 + Math.floor(ph * 6), 1);
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ ship layer (hull + rooms), cached
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

  function doorsOf(ship) {
    // template ships (miniShip) have no _adj cache: compute adjacency by touching edges
    if (G.Ship && G.Ship.adj && ship.id) return doors(ship);
    var list = [], rs = ship.rooms;
    for (var i = 0; i < rs.length; i++) {
      for (var j = i + 1; j < rs.length; j++) {
        var a = rs[i], b = rs[j];
        if (a.x + a.w === b.x || b.x + b.w === a.x) {
          var y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
          if (y1 > y0) list.push({ v: true, x: a.x + a.w === b.x ? b.x : a.x, y: (y0 + y1) / 2 });
        } else if (a.y + a.h === b.y || b.y + b.h === a.y) {
          var x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
          if (x1 > x0) list.push({ v: false, x: (x0 + x1) / 2, y: a.y + a.h === b.y ? b.y : a.y });
        }
      }
    }
    return list;
  }

  // Build the static bitmap of a ship at tile t (CSS px) with origin parity (px, py). Local art coordinates
  // are relative to (floor(ox/2), floor(oy/2)) + (offX, offY).
  function buildLayer(ship, t, px, py, flip, isEnemy) {
    var W = ship.w, H = ship.h, seed = hashStr(ship.templateId || ship.name || 'ship') & 0xffffff;
    var R1 = function (k) { return h01(seed, k); };
    var i, j, y, k;
    function X(gx) { return Math.round((px + gx * t) / 2); }
    function Y(gy) { return Math.round((py + (flip ? H - gy : gy) * t) / 2); }
    var tA = t / 2;

    // row extents of the rooms
    var rows = [];
    for (y = 0; y < H; y++) rows.push([Infinity, -Infinity]);
    ship.rooms.forEach(function (rm) {
      for (var yy = rm.y; yy < rm.y + rm.h; yy++) {
        if (!rows[yy]) continue;
        rows[yy][0] = Math.min(rows[yy][0], rm.x);
        rows[yy][1] = Math.max(rows[yy][1], rm.x + rm.w);
      }
    });
    for (y = 0; y < H; y++) if (rows[y][0] === Infinity) rows[y] = y > 0 ? rows[y - 1].slice() : [0, W];
    var P = 0.38, minA = Infinity, maxB = -Infinity;
    rows.forEach(function (r) { minA = Math.min(minA, r[0]); maxB = Math.max(maxB, r[1]); });
    var CX = (minA + maxB) / 2;
    var noseK = 0.72 + 0.22 * R1(1);
    var noseLen = Math.min(1.35, ((rows[0][1] - rows[0][0]) / 2 + P) / noseK);
    // wings
    var small = !!ship.crewless;
    var wing = true;
    var ws = H * (0.26 + 0.16 * R1(2)), we = Math.min(H + 0.1, H * (0.74 + 0.2 * R1(3)));
    var span = (small ? 0.4 : 0.7) + 0.3 * R1(4), sweepK = 0.8 + 0.7 * R1(5);
    var podOn = !small && R1(6) < 0.8, podW = 0.3, podFwd = 0.3 + 0.4 * R1(7), podEnd = we - 0.25;
    var edgeR = maxB + P + span, edgeL = minA - P - span;
    // engines under the last row
    var last = rows[H - 1], ew = last[1] - last[0];
    var nEng = ew >= 4 ? (R1(8) < 0.55 ? 3 : 2) : 2, eng = [];
    for (k = 0; k < nEng; k++) eng.push(nEng === 1 ? (last[0] + last[1]) / 2 : last[0] + 0.55 + (ew - 1.1) * k / (nEng - 1));
    var eTop = H - 0.25, eBot = H + P + 0.3, nzBot = eBot + 0.2, hw = 0.36, nzw = 0.27;

    var gxa = edgeL - 0.3, gxb = edgeR + 0.3, gya = -noseLen - Math.max(0.5, podFwd + 0.6), gyb = nzBot + 0.3;
    var lx0 = X(gxa) - 2, lx1 = X(gxb) + 2;
    var yA = Y(gya), yB = Y(gyb), ly0 = Math.min(yA, yB) - 2, ly1 = Math.max(yA, yB) + 2;
    var BW = lx1 - lx0, BH = ly1 - ly0;
    var M = new Uint8Array(BW * BH);
    var barCol = [X(edgeR - podW / 2) - lx0, X(edgeL + podW / 2) - lx0];

    for (j = 0; j < BH; j++) {
      var gyS = (2 * (ly0 + j) + 1 - py) / t, gy = flip ? H - gyS : gyS;
      var bl = Infinity, br = -Infinity;
      if (gy >= -noseLen && gy <= H + P) {
        for (y = 0; y < H; y++) {
          var d = 0, kk = 0;
          if (gy < y) { d = y - gy; kk = y === 0 ? noseK : 2.4; }
          else if (gy > y + 1) { d = gy - y - 1; kk = y === H - 1 ? 1.4 : 2.4; }
          var l = rows[y][0] - P + d * kk, r = rows[y][1] + P - d * kk;
          if (l < bl) bl = l;
          if (r > br) br = r;
        }
      }
      var wo = 0;
      if (wing && gy >= ws && gy <= we) wo = Math.max(0, Math.min(span, (gy - ws) * sweepK, (we - gy) * 1.7 + 0.1));
      var pod = podOn && gy >= ws - podFwd && gy <= podEnd;
      var barrel = podOn && gy >= ws - podFwd - 0.32 && gy < ws - podFwd;
      var inEng = gy >= eTop && gy <= eBot, inNz = gy > eBot && gy <= nzBot;
      for (i = 0; i < BW; i++) {
        var gx = (2 * (lx0 + i) + 1 - px) / t, m = 0;
        if (gx >= bl && gx <= br) m = 1;
        else if (wo > 0 && ((gx > br && gx <= maxB + P + wo) || (gx < bl && gx >= minA - P - wo))) m = 2;
        if (pod && ((gx >= edgeR - podW && gx <= edgeR) || (gx <= edgeL + podW && gx >= edgeL))) m = 3;
        if (barrel && (i === barCol[0] || i === barCol[1])) m = 6;
        if (inEng || inNz) {
          for (k = 0; k < nEng; k++) {
            var dx = Math.abs(gx - eng[k]);
            if (inEng && dx <= hw) m = 4;
            else if (inNz && dx <= nzw) m = 5;
          }
        }
        M[j * BW + i] = m;
      }
    }

    // shading pass
    var pal = tintPal(ship.tint || '#8ea6cf', isEnemy ? 1.35 : 0.7);
    var accent = rgb(isEnemy ? '#d0463c' : '#e5b64c'), glow = rgb(isEnemy ? '#ffb347' : '#7fdcff');
    var win = rgb('#2d6f93'), winHi = rgb('#9fe6ff');
    var cnv = mk(BW, BH), x = cnv.getContext('2d'), img = x.createImageData(BW, BH), D = img.data;
    var ph = Math.max(4, Math.round(tA * 0.75)), pw = Math.max(6, Math.round(tA * 1.1));
    function at(ii, jj) { return ii < 0 || jj < 0 || ii >= BW || jj >= BH ? 0 : M[jj * BW + ii]; }
    var dir = flip ? -1 : 1;   // screen direction of the ship's tail
    for (j = 0; j < BH; j++) {
      var gyS2 = (2 * (ly0 + j) + 1 - py) / t, gy2 = flip ? H - gyS2 : gyS2;
      for (i = 0; i < BW; i++) {
        var mm = M[j * BW + i];
        if (!mm) continue;
        var up = at(i, j - 1), dn = at(i, j + 1), lf = at(i - 1, j), rt = at(i + 1, j), col;
        var gx2 = (2 * (lx0 + i) + 1 - px) / t;
        if (mm === 6) col = pal[3];
        else if (mm === 5 && (dir > 0 ? !dn : !up) && lf && rt) col = glow;
        else if (!up || !dn || !lf || !rt) col = pal[0];
        else {
          var hi = !at(i, j - 2) || !at(i - 2, j), lo = !at(i, j + 2) || !at(i + 2, j);
          var seam = (mm !== 1) && (up === 1 || dn === 1 || lf === 1 || rt === 1);
          if (mm === 1) {
            var rI = Math.floor(j / ph), off = (rI & 1) * (pw >> 1), cI = Math.floor((i + off) / pw);
            var hv = h01(seed + cI * 131, rI);
            col = hv < 0.22 ? pal[5] : hv > 0.84 ? pal[6] : pal[2];
            if (j % ph === 0 || (i + off) % pw === 0) col = pal[7];
            else if (((i + off) % pw === 2 || (i + off) % pw === pw - 2) && j % ph === 2 && hv < 0.45) col = pal[3];
            if (hi) col = pal[3];
            else if (lo) col = pal[1];
            if (gy2 < -P && Math.abs(gx2 - CX) < 0.5 / tA) col = pal[1];                        // spine groove
            if (gy2 >= -P - 0.2 && gy2 < -P - 0.06 && !hi && !lo) col = accent;                // nose stripe
            if (noseLen > 0.95 && gy2 >= -P - 0.62 && gy2 < -P - 0.36 && Math.abs(gx2 - CX) < 0.34 && Math.abs(gx2 - CX) > 0.5 / tA) {
              col = gy2 < -P - 0.52 ? winHi : win;                                              // cockpit windows
            }
          } else if (mm === 2) {
            col = j % ph === 0 ? pal[1] : pal[6];
            if (hi) col = pal[3];
            else if (lo) col = pal[1];
            if (seam) col = pal[0];
          } else if (mm === 3) {
            col = hi ? pal[4] : lo ? pal[1] : pal[3];
            if (gy2 - (ws - podFwd) < 0.2) col = accent;
          } else if (mm === 4) {
            col = j & 1 ? pal[1] : pal[0];
            if (hi) col = pal[2];
            if (seam) col = pal[0];
          } else {
            col = pal[0];
          }
        }
        var o = (j * BW + i) * 4;
        D[o] = Math.round(col[0]); D[o + 1] = Math.round(col[1]); D[o + 2] = Math.round(col[2]); D[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);

    // nozzle exits (for animated flames): first empty row past each nozzle in the tail direction
    var noz = [];
    for (k = 0; k < nEng; k++) {
      var a0 = X(eng[k] - nzw) - lx0, a1 = X(eng[k] + nzw) - lx0, ccol = (a0 + a1) >> 1, ey = -1;
      if (dir > 0) { for (j = BH - 1; j >= 0; j--) if (M[j * BW + ccol] === 5) { ey = j + 1; break; } }
      else { for (j = 0; j < BH; j++) if (M[j * BW + ccol] === 5) { ey = j - 1; break; } }
      if (ey >= 0) noz.push({ x: a0 + 1, w: Math.max(2, a1 - a0 - 1), y: ey });
    }

    // rooms: outer rim, walls, floors, tile grid, shade, doors, consoles, icon blocks, vents
    var rr = ship.rooms.map(function (rm) {
      var x0 = X(rm.x) - lx0, x1 = X(rm.x + rm.w) - lx0, ya = Y(rm.y) - ly0, yb = Y(rm.y + rm.h) - ly0;
      return { x0: x0, x1: x1, y0: Math.min(ya, yb), y1: Math.max(ya, yb), rm: rm };
    });
    x.fillStyle = C.rim;
    rr.forEach(function (q) { x.fillRect(q.x0 - 1, q.y0 - 1, q.x1 - q.x0 + 3, q.y1 - q.y0 + 3); });
    x.fillStyle = C.wall;
    rr.forEach(function (q) { x.fillRect(q.x0, q.y0, q.x1 - q.x0 + 1, q.y1 - q.y0 + 1); });
    rr.forEach(function (q) {
      var rm = q.rm, fw = q.x1 - q.x0 - 1, fh = q.y1 - q.y0 - 1;
      q.fw = fw; q.fh = fh;
      x.fillStyle = C.floor; x.fillRect(q.x0 + 1, q.y0 + 1, fw, fh);
      x.fillStyle = C.floorSh; x.fillRect(q.x0 + 1, q.y0 + 1, fw, 1); x.fillRect(q.x0 + 1, q.y0 + 1, 1, fh);
      x.fillStyle = C.grid;
      if (tiny) return;
      for (var kx = 1; kx < rm.w; kx++) x.fillRect(X(rm.x + kx) - lx0, q.y0 + 1, 1, fh);
      for (var ky = 1; ky < rm.h; ky++) x.fillRect(q.x0 + 1, Y(rm.y + ky) - ly0, fw, 1);
    });
    var tiny = tA < 7;
    var dl = tiny ? [] : doorsOf(ship), Ld = Math.max(3, Math.round(tA * 0.42));
    dl.forEach(function (d) {
      var cxp = X(d.x) - lx0, cyp = Y(d.y) - ly0, h0 = Math.floor(Ld / 2);
      if (d.v) {
        x.fillStyle = C.doorDk; x.fillRect(cxp - 1, cyp - h0 - 1, 3, Ld + 2);
        x.fillStyle = C.door; x.fillRect(cxp, cyp - h0, 1, Ld);
      } else {
        x.fillStyle = C.doorDk; x.fillRect(cxp - h0 - 1, cyp - 1, Ld + 2, 3);
        x.fillStyle = C.door; x.fillRect(cxp - h0, cyp, Ld, 1);
      }
    });
    var defs = (G.data.systems && G.data.systems.defs) || {};
    rr.forEach(function (q, idx) {
      var rm = q.rm, inner = Math.min(q.fw, q.fh);
      q.con = null;
      if (rm.sys) {
        var station = defs[rm.sys] ? defs[rm.sys].station : rm.sys !== 'oxygen' && rm.sys !== 'medbay';
        // tile 0 (the manning slot) rect
        var tx0 = X(rm.x) - lx0, tx1 = X(rm.x + 1) - lx0, t0a = Y(rm.y) - ly0, t0b = Y(rm.y + 1) - ly0;
        var ty0 = Math.min(t0a, t0b), ty1 = Math.max(t0a, t0b);
        if (station && tx1 - tx0 >= 7) {
          var cw = tx1 - tx0 - 1 - 4, cd = tA >= 14 ? 3 : 2, cxp = tx0 + 3;
          var cyp = flip ? ty1 - cd : ty0 + 1;
          // body against the wall, screen row on the floor side
          var sy = flip ? cyp : cyp + cd - 1;
          x.fillStyle = C.conDk; x.fillRect(cxp - 1, cyp, cw + 2, cd);
          x.fillStyle = C.con; x.fillRect(cxp, flip ? cyp + 1 : cyp, cw, cd - 1);
          x.fillStyle = C.scr; x.fillRect(cxp + 1, sy, cw - 2, 1);
          q.con = { x: cxp + 1, y: sy, w: cw - 2 };
        }
        // icon block: centered; 2-tile rooms with a console put it on the other tile
        var bs = inner >= 13 ? 11 : inner >= 9 ? 9 : 0, bcx, bcy;
        if (q.con && rm.w * rm.h === 2) {
          var o1 = rm.w === 2 ? [rm.x + 1.5, rm.y + 0.5] : [rm.x + 0.5, rm.y + 1.5];
          bcx = X(o1[0]) - lx0; bcy = Y(o1[1]) - ly0;
        } else {
          bcx = (q.x0 + q.x1 + 1) >> 1; bcy = (q.y0 + q.y1 + 1) >> 1;
        }
        q.bx = bcx - (bs >> 1); q.by = bcy - (bs >> 1); q.bs = bs;
        if (bs === 0) {
          q.bx = bcx - 1; q.by = bcy - 1;
          x.fillStyle = C.blockIn; x.fillRect(q.bx - 1, q.by - 1, 4, 4);
        } else if (bs === 11) {
          x.fillStyle = C.block; x.fillRect(q.bx, q.by, bs, bs);
          x.fillStyle = C.blockIn; x.fillRect(q.bx + 1, q.by + 1, bs - 2, bs - 2);
          x.fillStyle = C.blockHi; x.fillRect(q.bx + 1, q.by + 1, bs - 2, 1);
        } else {
          x.fillStyle = C.blockIn; x.fillRect(q.bx, q.by, bs, bs);
        }
      } else if (inner >= 9) {
        // floor vent in the last tile
        var vx1 = q.x1 - 2, vy1 = q.y1 - 2, vw = Math.min(5, q.fw - 3);
        x.fillStyle = C.vent;
        for (var s = 0; s < 3; s++) x.fillRect(vx1 - vw, vy1 - 1 - s * 2, vw, 1);
        if (h01(seed + idx, 3) < 0.5 && q.fw >= 12) {
          // a crate in the first tile
          x.fillStyle = '#6a5a3e'; x.fillRect(q.x0 + 3, q.y0 + 3, 4, 4);
          x.fillStyle = '#9c8558'; x.fillRect(q.x0 + 3, q.y0 + 3, 4, 1); x.fillRect(q.x0 + 3, q.y0 + 3, 1, 4);
          x.fillStyle = '#3d3322'; x.fillRect(q.x0 + 4, q.y0 + 5, 2, 1);
        }
      }
    });

    return { c: cnv, offX: lx0, offY: ly0, rooms: rr, noz: noz, dir: dir, P: P };
  }

  function layerFor(slot, ship, t, ox, oy, flip, isEnemy) {
    var px = ox - 2 * Math.floor(ox / 2), py = oy - 2 * Math.floor(oy / 2);
    var k = slot ? R.lk[slot] : null;
    if (k && k.ship === ship && k.t === t && k.px === px && k.py === py && k.flip === flip) return k.ent;
    var key = [ship.templateId || ship.name, ship.w, ship.h, ship.rooms.length, t, px, py, flip ? 1 : 0, ship.tint, isEnemy ? 1 : 0].join('|');
    var ent = null;
    for (var i = 0; i < layerCache.length; i++) if (layerCache[i].key === key) { ent = layerCache[i].ent; break; }
    if (!ent) {
      ent = buildLayer(ship, t, px, py, flip, isEnemy);
      layerCache.unshift({ key: key, ent: ent });
      if (layerCache.length > 8) layerCache.pop();
    }
    if (slot) R.lk[slot] = { ship: ship, t: t, px: px, py: py, flip: flip, ent: ent };
    return ent;
  }

  // ------------------------------------------------------------------ dynamic ship parts
  function sysColor(ship, sys) {
    if (!sys) return C.off;
    if (sys.ion > 0) return C.ion;
    if (sys.damage >= sys.level) return C.dmg;
    if (sys.damage > 0) return C.part;
    var powered = sys.id === 'piloting' ? G.Ship.usable(sys) > 0 :
      sys.id === 'weapons' ? G.Ship.weaponPower(ship) > 0 : sys.power > 0;
    return powered ? C.on : C.off;
  }

  function drawFlames(c, ent, qx, qy, ship, side, fleeing) {
    if (ship.hull <= 0) return;
    var es = ship.systems ? ship.systems.engines : null;
    var pw = es ? (es.power > 0 ? Math.min(1, 0.45 + 0.55 * es.power / Math.max(1, es.level)) : 0.12) : 0.7;
    var cols = FLAME[side === 'enemy' ? 'enemy' : 'player'];
    for (var k = 0; k < ent.noz.length; k++) {
      var n = ent.noz[k], fr = R.reduced ? 0 : Math.floor(R.t * 14 + k * 1.3) % 3;
      var len = Math.max(1, Math.round((1.5 + 4 * pw + (fleeing ? 4 : 0)) * (fr === 1 ? 0.7 : fr === 2 ? 1.2 : 1)));
      for (var s = 0; s < len; s++) {
        var ww = Math.max(1, n.w - Math.floor(s * n.w / (len + 1)));
        c.fillStyle = s === 0 ? cols[0] : s < len * 0.5 ? cols[1] : cols[2];
        if (s === len - 1 && fr === 2) ww = 1;
        c.fillRect(qx + n.x + ((n.w - ww) >> 1), qy + n.y + s * ent.dir, ww, 1);
      }
    }
  }

  function drawRoomStates(c, g, ent, qx, qy, alpha) {
    var ship = g.ship, t = g.L.tile, lod = t < 24, rooms = ent.rooms, i, k;
    var man = R.manned;
    for (k in man) man[k] = 0;
    for (i = 0; i < ship.crew.length; i++) if (ship.crew[i].task === 'man' && !ship.crew[i].path.length) man[ship.crew[i].room] = 1;
    var blink = R.reduced ? 1 : Math.floor(R.t * 5) % 2;
    for (i = 0; i < rooms.length; i++) {
      var q = rooms[i], rm = ship.rooms[i];
      if (!rm) continue;
      var fx0 = qx + q.x0 + 1, fy0 = qy + q.y0 + 1, fw = q.fw, fh = q.fh;
      // low oxygen: pulsing pink dither
      if (!ship.crewless && rm.o2 < 70) {
        var pulse = R.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(R.t * 4 + i);
        c.globalAlpha = alpha * Math.min(1, (70 - rm.o2) / 70 * (0.75 + 0.35 * pulse));
        c.fillStyle = pat(C.o2);
        c.fillRect(fx0, fy0, fw, fh);
        c.globalAlpha = alpha;
      }
      if (rm.breach > 0) drawBreach(c, g, rm, q, qx, qy);
      if (rm.sys) {
        var sys = ship.systems[rm.sys], col = sysColor(ship, sys);
        if (q.con) {
          // console screen: lit when manned, dim when powered
          var lit = man[i] ? (g.flip ? C.dmg : C.on) : col === C.on ? '#2f6b45' : C.scr;
          c.fillStyle = lit;
          c.fillRect(qx + q.con.x, qy + q.con.y, q.con.w, 1);
          if (man[i] && blink) { c.fillStyle = C.white; c.fillRect(qx + q.con.x + ((q.con.w * (Math.floor(R.t * 3) % 3)) / 3 | 0), qy + q.con.y, 1, 1); }
        }
        var bx = qx + q.bx, by = qy + q.by, bs = q.bs, io = bs === 11 ? 1 : 0;
        if (bs) c.drawImage(icon(rm.sys, col), bx + io, by + io);
        else { c.fillStyle = col; c.fillRect(bx, by, 2, 2); bs = 2; }
        if (sys && sys.ion > 0) {
          // violet crackle around the block
          c.fillStyle = C.ion;
          if (blink) rectLine(c, bx - 1, by - 1, bs + 2, bs + 2);
          var f = Math.floor(R.t * 10);
          for (k = 0; k < 4; k++) {
            var e = h01(f * 7 + k, i), side = k & 3, pp = Math.floor(e * bs);
            var sx = side === 0 ? bx + pp : side === 1 ? bx + bs : side === 2 ? bx + pp : bx - 1;
            var sy = side === 0 ? by - 2 : side === 1 ? by + pp : side === 2 ? by + bs + 1 : by + pp;
            c.fillStyle = k & 1 ? '#d9ccff' : C.ion;
            c.fillRect(sx, sy, 1, 1);
          }
        }
        if (sys && sys.damage > 0) {
          if (sys.damage >= sys.level && blink) { c.fillStyle = C.dmg; rectLine(c, bx - 1, by - 1, bs + 2, bs + 2); }
          // blinking sparks
          var f2 = Math.floor(R.t * 8);
          if (!R.reduced && (f2 & 1)) {
            for (k = 0; k < 2; k++) {
              var sxp = bx + Math.floor(h01(f2 + k * 5, i * 3) * (bs + 2)) - 1, syp = by + Math.floor(h01(f2 + k * 9, i * 7) * (bs + 2)) - 1;
              c.fillStyle = k ? C.fire2 : C.white;
              c.fillRect(sxp, syp, 1, 1);
            }
          }
          if (sys.damage < sys.level && sys.repairProg > 0 && !lod) {
            c.fillStyle = C.ink; c.fillRect(bx, by + bs + 1, bs, 2);
            c.fillStyle = C.on; c.fillRect(bx, by + bs + 1, Math.max(1, Math.round(bs * sys.repairProg)), 1);
          }
        }
      }
      if (rm.fire > 0) drawFire(c, g, rm, q, qx, qy, lod);
    }
  }

  function drawFire(c, g, rm, q, qx, qy, lod) {
    var a0 = c.globalAlpha, tiles = rm.w * rm.h;
    c.globalAlpha = a0 * Math.min(0.9, 0.35 + 0.4 * rm.fire / tiles);
    c.fillStyle = pat(C.fire1);
    c.fillRect(qx + q.x0 + 1, qy + q.y0 + 1, q.fw, q.fh);
    c.globalAlpha = a0;
    var sp;
    if (lod) {
      sp = fireSprite(R.reduced ? 0 : Math.floor(R.t * 9 + rm.id) % 3);
      c.drawImage(sp, qx + ((q.x0 + q.x1) >> 1) - 3, qy + ((q.y0 + q.y1) >> 1) - 4);
      return;
    }
    for (var k = 0; k < rm.fire; k++) {
      var tx = k % rm.w, ty = Math.floor(k / rm.w) % rm.h;
      var p = gp(g, rm.x + tx + 0.5, rm.y + ty + 0.5);
      sp = fireSprite(R.reduced ? k % 3 : Math.floor(R.t * 9 + k * 1.7 + rm.id) % 3);
      c.drawImage(sp, A(p.x) + (qx - R.q.x) - 3, A(p.y) - 5);
    }
  }

  function drawBreach(c, g, rm, q, qx, qy) {
    var n = rm.w * rm.h, size = Math.max(5, Math.round(g.L.tile / 2 * 0.55));
    for (var k = 0; k < rm.breach; k++) {
      var idx = n - 1 - (k % n), tx = idx % rm.w, ty = Math.floor(idx / rm.w);
      var p = gp(g, rm.x + tx + 0.5, rm.y + ty + 0.5), cx = A(p.x) + (qx - R.q.x), cy = A(p.y);
      var sp = breachSprite(size, (rm.id * 7 + k) & 255);
      var hs = sp.width >> 1;
      c.drawImage(sp, cx - hs, cy - hs);
      // debris / air pixels sucked into the hole
      for (var d = 0; d < 4; d++) {
        var ph = R.reduced ? 0.5 : (R.t * 1.3 + d * 0.27 + k * 0.4) % 1;
        var an = h01(rm.id * 17 + k, d) * Math.PI * 2, dist = (size * 0.6 + 4) * (1 - ph) + hs * 0.5;
        c.fillStyle = d & 1 ? '#c8d4e8' : '#6f7f9c';
        c.fillRect(Math.round(cx + Math.cos(an) * dist), Math.round(cy + Math.sin(an) * dist), 1, 1);
      }
    }
  }

  // ------------------------------------------------------------------ crew
  function drawCrew(c, g, dxa, selId) {
    var ship = g.ship, i;
    if (!ship.crew || !ship.crew.length) return;
    var lp = R.lastPos[g.side], blink = R.reduced ? 1 : Math.floor(R.t * 4) % 2;
    for (i = 0; i < ship.crew.length; i++) {
      var cm = ship.crew[i];
      var p = G.Crew.pos(ship, cm), s = gp(g, p.x, p.y);
      var o = lp[cm.name] || (lp[cm.name] = { x: 0, y: 0 });
      o.x = s.x; o.y = s.y;
      var ax = A(s.x) + dxa, ay = A(s.y), key = g.side + cm.id;
      var walking = cm.path.length > 0;
      var prev = R.prevX[key];
      if (prev != null && Math.abs(ax - prev) >= 1) R.face[key] = ax < prev ? -1 : 1;
      R.prevX[key] = ax;
      var left = (R.face[key] || (g.flip ? -1 : 1)) < 0;
      var fr = walking ? 1 + (Math.floor(R.t * 7 + i * 0.5) % 2) : 0;
      var hair = hashStr(cm.name || cm.id) % HAIR.length;
      var sp = crewSprite(cm.race, g.side, fr, left, hair);
      var sx = ax - 3, sy = ay - 6 - (fr === 2 ? 1 : 0);
      if (selId && cm.id === selId && blink) {
        c.fillStyle = C.amberHi;
        var x0 = sx - 2, y0 = sy - 2, x1 = sx + 8, y1 = sy + 11;
        c.fillRect(x0, y0, 3, 1); c.fillRect(x0, y0, 1, 3);
        c.fillRect(x1 - 2, y0, 3, 1); c.fillRect(x1, y0, 1, 3);
        c.fillRect(x0, y1, 3, 1); c.fillRect(x0, y1 - 2, 1, 3);
        c.fillRect(x1 - 2, y1, 3, 1); c.fillRect(x1, y1 - 2, 1, 3);
      }
      c.drawImage(sp, sx, sy);
      // tools
      var f = left ? -1 : 1, hx = left ? sx - 1 : sx + 7, hy = sy + 6, swing = Math.floor(R.t * 6) % 2;
      if (cm.task === 'repair' || cm.task === 'breach') {
        c.fillStyle = '#c8ccd6';
        c.fillRect(hx, hy - swing, 1, 2);
        c.fillRect(hx + f, hy - 1 - swing, 1, 1); c.fillRect(hx - f, hy - 1 - swing, 1, 1);
        if (swing && !R.reduced) { c.fillStyle = C.fire2; c.fillRect(hx + 2 * f, hy - 2, 1, 1); }
      } else if (cm.task === 'fire') {
        c.fillStyle = '#e0413a'; c.fillRect(hx, hy - 1, 1, 3);
        c.fillStyle = '#1a1e29'; c.fillRect(hx + f, hy - 1, 1, 1);
        c.fillStyle = '#dff4ff';
        for (var k = 0; k < 3; k++) if ((k + swing) % 2 === 0) c.fillRect(hx + f * (2 + k), hy - 2 + ((k * 2 + swing) % 3), 1, 1);
      }
      if (cm.hp < cm.hpMax) {
        var fr2 = Math.max(0, cm.hp / cm.hpMax);
        c.fillStyle = C.ink; c.fillRect(sx, sy - 2, 7, 1);
        c.fillStyle = fr2 > 0.6 ? C.on : fr2 > 0.3 ? C.amberHi : C.dmg;
        c.fillRect(sx, sy - 2, Math.max(1, Math.round(7 * fr2)), 1);
      }
    }
  }

  // ------------------------------------------------------------------ shields
  function shieldRing(rx, ry, layers, max) {
    var key = rx + '|' + ry + '|' + layers + '|' + max, e = ringCache[key];
    if (e) return e;
    var pad = 4, c = mk(2 * (rx + pad) + 1, 2 * (ry + pad) + 1), x = c.getContext('2d'), cx = rx + pad, cy = ry + pad, p, i, k;
    x.fillStyle = C.shield;
    if (layers <= 0) {
      x.globalAlpha = 0.35;
      p = ellPts(rx, ry);
      for (i = 0; i < p.n; i++) if (i % 6 < 3) x.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);
    } else {
      // inner dithered glow band
      x.globalAlpha = Math.min(0.5, 0.16 + 0.07 * layers);
      for (var yy = -ry; yy <= ry; yy++) {
        for (var xx = -rx; xx <= rx; xx++) {
          var q = (xx * xx) / (rx * rx) + (yy * yy) / (ry * ry);
          if (q > 1 || q < 0.8) continue;
          if (((xx + cx) & 1) === 0 && ((yy + cy) & 1) === 0 && (((xx + cx + yy + cy) >> 1) & 1) === 0) x.fillRect(cx + xx, cy + yy, 1, 1);
        }
      }
      x.globalAlpha = Math.min(1, 0.55 + 0.15 * layers);
      p = ellPts(rx, ry);
      for (i = 0; i < p.n; i++) x.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);
      p = ellPts(rx - 1, ry - 1);
      for (i = 0; i < p.n; i++) if (((p.x[i] + p.y[i]) & 1) === 0) x.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);
      x.fillStyle = '#bff0ff';
      x.globalAlpha = 0.9;
      p = ellPts(rx, ry);
      for (i = 0; i < p.n; i++) {
        var a = Math.atan2(p.y[i] / ry, p.x[i] / rx);
        if (a < -Math.PI * 0.6 && a > -Math.PI * 0.9) x.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);   // top-left glint
      }
      x.fillStyle = C.shield;
      for (k = 1; k < layers; k++) {
        x.globalAlpha = 0.6;
        p = ellPts(rx - 2 * k - 1, ry - 2 * k - 1);
        for (i = 0; i < p.n; i += 2) x.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);
      }
    }
    e = { c: c, pad: pad };
    ringCache[key] = e;
    return e;
  }

  function drawShield(c, g, dxa) {
    var ship = g.ship, max = G.Ship.maxLayers(ship), layers = ship.shieldLayers;
    if (max <= 0 && layers <= 0) return;
    var b = bubble(g), cx = A(b.x) + dxa, cy = A(b.y), rx = A(b.rx), ry = A(b.ry);
    var e = shieldRing(rx, ry, Math.min(layers, 6), max);
    c.drawImage(e.c, cx - rx - e.pad, cy - ry - e.pad);
    if (layers < max && ship.shieldCharge > 0) {
      var p = ellPts(rx + 2, ry + 2), n = Math.floor(p.n * ship.shieldCharge);
      c.fillStyle = C.shield;
      for (var i = 0; i < n; i++) c.fillRect(cx + p.x[i], cy + p.y[i], 1, 1);
      if (n > 0) { c.fillStyle = C.white; c.fillRect(cx + p.x[n - 1], cy + p.y[n - 1], 1, 1); }
    }
  }

  // Entry point of segment o->c into the ellipse (or null when o is inside / no crossing).
  function hitEllipse(o, c, e) {
    var dx = c.x - o.x, dy = c.y - o.y, ox = (o.x - e.x) / e.rx, oy = (o.y - e.y) / e.ry, ddx = dx / e.rx, ddy = dy / e.ry;
    var Aq = ddx * ddx + ddy * ddy, Bq = 2 * (ox * ddx + oy * ddy), Cq = ox * ox + oy * oy - 1;
    if (Cq <= 0 || Aq <= 0) return null;
    var disc = Bq * Bq - 4 * Aq * Cq;
    if (disc < 0) return null;
    var s = (-Bq - Math.sqrt(disc)) / (2 * Aq);
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

  function drawProjectiles(c, cb) {
    var list = cb.projectiles;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.delay > 0) continue;
      var o = origin(p), d = o && dest(p, o);
      if (!o || !d) continue;
      var f = G.U.clamp(p.t / p.dur, 0, 1);
      var S = SHOT[p.from === 'player' ? 'player' : 'enemy'];
      var arc = p.kind === 'missile' ? ((p.slot || 0) % 2 ? -1 : 1) : 0;
      var a = posAt(o, d, f, arc), ax = A(a.x), ay = A(a.y), b, bx, by;
      if (p.kind === 'laser') {
        // bolt: dark tail -> colored trail -> 2-px bright core, like FTL's lasers
        b = posAt(o, d, Math.max(0, f - 0.11), arc); bx = A(b.x); by = A(b.y);
        var lx = ax - bx, ly = ay - by, ll = Math.sqrt(lx * lx + ly * ly) || 1;
        var mx = Math.round(ax - lx * 0.55), my = Math.round(ay - ly * 0.55);
        var kx = Math.round(ax - lx / ll * 4), ky = Math.round(ay - ly / ll * 4);
        c.fillStyle = S.tail; pline(c, bx, by, mx, my, 1);
        c.fillStyle = S.trail; pline(c, mx, my, ax, ay, 2);
        c.fillStyle = S.core; pline(c, kx, ky, ax, ay, 1);
        c.fillRect(ax - 1, ay - 1, 2, 2);
      } else if (p.kind === 'ion') {
        var fr = R.reduced ? 0 : Math.floor(R.t * 12 + i) % 2;
        c.fillStyle = '#2f7fbf';
        if (fr) { c.fillRect(ax - 3, ay, 7, 1); c.fillRect(ax, ay - 3, 1, 7); }
        else { c.fillRect(ax - 2, ay - 2, 5, 5); }
        c.fillStyle = C.shield; c.fillRect(ax - 1, ay - 2, 3, 5); c.fillRect(ax - 2, ay - 1, 5, 3);
        c.fillStyle = '#dff6ff'; c.fillRect(ax - 1, ay - 1, 2, 2);
      } else if (p.kind === 'missile') {
        b = posAt(o, d, Math.max(0, f - 0.03), arc);
        var dx = a.x - b.x, dy = a.y - b.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl; dy /= dl;
        var nx = -dy, ny = dx;
        var blinkM = Math.floor(R.t * 20);
        for (var k = 0; k < 10; k++) {
          var px = Math.round(ax - dx * k), py = Math.round(ay - dy * k);
          if (k < 2) c.fillStyle = C.dmg;
          else if (k < 6) c.fillStyle = k === 3 ? '#eef1f6' : '#c8ccd6';
          else if (k === 6) c.fillStyle = '#46546f';
          else { if (((blinkM + k) & 1) === 0 && k > 7) continue; c.fillStyle = k === 7 ? '#ffffff' : k === 8 ? C.fire2 : C.fire1; }
          c.fillRect(px - 1, py - 1, 2, 2);
          if (k === 6 || k === 5) {
            c.fillStyle = '#6f7f9c';
            c.fillRect(Math.round(px + nx * 2) - 1, Math.round(py + ny * 2) - 1, 2, 2);
            c.fillRect(Math.round(px - nx * 2) - 1, Math.round(py - ny * 2) - 1, 2, 2);
          }
        }
        if (Math.random() < 0.35) {
          var tl = posAt(o, d, Math.max(0, f - 0.05), arc);
          addPart(tl.x, tl.y, rnd(-6, 6), rnd(-6, 6), 0.6, 2, '#5d616b', 'smoke');
        }
      } else if (p.kind === 'asteroid') {
        var sp = rockSprite(i % 3, R.reduced ? 0 : Math.floor(R.t * 5 + i) % 4);
        c.drawImage(sp, ax - 4, ay - 4);
      } else {
        b = posAt(o, d, Math.max(0, f - 0.1), 0); bx = A(b.x); by = A(b.y);
        c.fillStyle = '#9a2a2a'; pline(c, bx, by, ax, ay, 1);
        c.fillStyle = '#ff7a5c'; c.fillRect(ax - 1, ay - 1, 3, 3);
        c.fillStyle = '#ffe0d0'; c.fillRect(ax, ay, 1, 1);
      }
    }
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
  function diamond(c, x, y, r) {
    for (var dy = -r; dy <= r; dy++) { var w = r - Math.abs(dy); c.fillRect(x - w, y + dy, 2 * w + 1, 1); }
  }

  function drawBeams(c, cb) {
    for (var i = 0; i < cb.beams.length; i++) {
      var b = cb.beams[i], o = shooter(b.from, b.slot), g = geo(b.to);
      if (!o || !g) continue;
      var S = SHOT[b.from === 'player' ? 'player' : 'enemy'], ox = A(o.x), oy = A(o.y);
      if (b.t < b.delay) {
        var q = b.t / b.delay, r = 1 + Math.round(5 * q);
        c.globalAlpha = 0.6; c.fillStyle = pat(S.edge); diamond(c, ox, oy, r + 3); c.globalAlpha = 1;
        c.fillStyle = S.beam; diamond(c, ox, oy, r);
        c.fillStyle = C.white; diamond(c, ox, oy, Math.max(0, r - 2));
        continue;
      }
      var f = G.U.clamp((b.t - b.delay) / b.dur, 0, 1);
      var pts = sweepPoints(g, b.rooms), pt = along(pts, f);
      var blocked = b.dmg > 0 ? b.dmg - g.ship.shieldLayers <= 0 : g.ship.shieldLayers > 0;
      // scorch trail over the swept rooms
      c.globalAlpha = blocked ? 0.35 : 0.85;
      c.fillStyle = S.edge;
      var n = pts.length - 1, px0 = A(pts[0].x), py0 = A(pts[0].y);
      for (var k = 1; k <= n && k / n <= f; k++) { pline(c, px0, py0, A(pts[k].x), A(pts[k].y), 2); px0 = A(pts[k].x); py0 = A(pts[k].y); }
      pline(c, px0, py0, A(pt.x), A(pt.y), 2);
      c.globalAlpha = 1;
      var end = pt;
      if (blocked) { var hit = hitEllipse(o, pt, bubble(g)); if (hit) end = hit; }
      var ex = A(end.x), ey = A(end.y), fl = R.reduced ? 0 : Math.floor(R.t * 30) % 2;
      c.fillStyle = fl ? S.edge : S.beam; pline(c, ox, oy, ex, ey, 5);
      c.fillStyle = fl ? S.beam : '#fff3c8'; pline(c, ox, oy, ex, ey, 3);
      c.fillStyle = C.white; pline(c, ox, oy, ex, ey, 1);
      c.fillStyle = S.beam; diamond(c, ex, ey, 3 + fl);
      c.fillStyle = C.white; diamond(c, ex, ey, 1);
      if (Math.random() < 0.7) addPart(end.x, end.y, rnd(-60, 60), rnd(-60, 60), 0.3, 1, S.flash, 'spark');
    }
  }

  // ------------------------------------------------------------------ particles / effects (positions in CSS px)
  function addPart(x, y, vx, vy, life, size, col, type, text) {
    var p = R.pool.length ? R.pool.pop() : {};
    if (R.parts.length > 360) R.pool.push(R.parts.shift());
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.size = size; p.col = col; p.type = type; p.text = text || '';
    R.parts.push(p);
    return p;
  }

  function explode(x, y, scale, col) {
    scale = scale || 1;
    addPart(x, y, 0, 0, 0.18, Math.round(5 * scale), '#ffffff', 'flash');
    addPart(x, y, 0, 0, 0.4, 4 * scale, col || C.fire1, 'ring');
    var n = Math.round(7 * scale), i, a, v;
    for (i = 0; i < n; i++) {
      a = Math.random() * Math.PI * 2; v = rnd(8, 34) * scale;
      addPart(x + rnd(-6, 6) * scale, y + rnd(-6, 6) * scale, Math.cos(a) * v, Math.sin(a) * v, rnd(0.45, 0.85), Math.min(8, Math.round(rnd(2, 4) * scale)), '', 'blk');
    }
    for (i = 0; i < Math.round(9 * scale); i++) {
      a = Math.random() * Math.PI * 2; v = rnd(50, 150) * scale;
      var r0 = Math.random();
      addPart(x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.25, 0.6), 1, r0 < 0.4 ? C.fire2 : r0 < 0.7 ? '#ffffff' : '#a7b4cc', 'spark');
    }
  }
  function floatText(x, y, text, col) { addPart(x, y, 0, -26, 0.9, 13, col, 'text', text); }

  function stepParts(dt) {
    var list = R.parts, j = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { R.pool.push(p); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'spark' || p.type === 'blk') { var dmp = Math.exp(-dt * 4); p.vx *= dmp; p.vy *= dmp; }
      list[j++] = p;
    }
    list.length = j;
  }

  function drawParts(c) {
    var list = R.parts;
    for (var i = 0; i < list.length; i++) {
      var p = list[i], k = p.life / p.max, x = A(p.x), y = A(p.y), s;
      if (p.type === 'text') continue;
      if (p.type === 'blk') {
        s = Math.round(p.size * (1 + (1 - k) * 0.6));
        c.fillStyle = k > 0.85 ? '#ffffff' : k > 0.65 ? C.fire2 : k > 0.45 ? C.fire1 : k > 0.28 ? C.fire0 : pat(C.smoke);
        c.globalAlpha = 1;
        c.fillRect(x - (s >> 1), y - (s >> 1), s, s);
        if (k > 0.45 && s >= 3) { c.fillStyle = k > 0.65 ? '#ffffff' : C.fire2; c.fillRect(x - (s >> 1), y - (s >> 1), s - 1, 1); }
      } else if (p.type === 'spark') {
        if (k < 0.3 && (Math.floor(p.life * 40) & 1)) continue;
        c.globalAlpha = 1;
        c.fillStyle = p.col;
        c.fillRect(x, y, p.size, p.size);
      } else if (p.type === 'smoke') {
        c.globalAlpha = k > 0.5 ? 0.9 : 0.55;
        c.fillStyle = pat(p.col);
        s = Math.round(p.size * (1.8 - k));
        c.fillRect(x - (s >> 1), y - (s >> 1), s, s);
      } else if (p.type === 'flash') {
        c.globalAlpha = 1;
        s = Math.max(1, Math.round(p.size * (0.4 + 0.6 * k)));
        c.fillStyle = p.col === '#ffffff' ? C.fire2 : p.col;
        diamond(c, x, y, s + 1);
        c.fillStyle = '#ffffff';
        diamond(c, x, y, Math.max(0, s - 1));
      } else if (p.type === 'ring') {
        c.globalAlpha = k > 0.5 ? 1 : 0.6;
        c.fillStyle = p.col;
        var r = Math.max(1, Math.round(p.size * (1 + (1 - k) * 2.5) / 2));
        ring(c, x, y, r, r > 10 ? 1 : 1);
      }
    }
    c.globalAlpha = 1;
  }

  function drawRipples(c, dt) {
    var j = 0;
    for (var i = 0; i < R.ripples.length; i++) {
      var r = R.ripples[i];
      r.life -= dt;
      if (r.life <= 0) continue;
      R.ripples[j++] = r;
      var g = geo(r.side);
      if (!g) continue;
      var b = bubble(g), k = r.life / 0.6, grow = Math.round((1 - k) * 4);
      var cx = A(b.x), cy = A(b.y), rx = A(b.rx) + grow, ry = A(b.ry) + grow;
      var ang = Math.atan2((r.y - b.y) / b.ry, (r.x - b.x) / b.rx), span = 0.3 + (1 - k) * 0.6;
      var steps = Math.round(span * Math.max(rx, ry) * 1.5);
      c.fillStyle = k > 0.5 ? '#dff6ff' : C.shield;
      for (var s = -steps; s <= steps; s++) {
        var a = ang + s / steps * span;
        if (k < 0.4 && (s & 1)) continue;
        c.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
        if (k > 0.5) c.fillRect(Math.round(cx + Math.cos(a) * (rx - 1)), Math.round(cy + Math.sin(a) * (ry - 1)), 1, 1);
      }
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
    var g, p, o, k;
    switch (ev.t) {
      case 'combatStart':
        while (R.parts.length) R.pool.push(R.parts.pop());
        R.ripples.length = 0; R.sched.length = 0;
        R.enemyIn = 0; R.dead.enemy = -1; R.dead.player = -1;
        break;
      case 'launch':
        o = origin(ev);
        if (o && ev.from !== 'hazard') addPart(o.x, o.y, 0, 0, 0.16, 3, SHOT[ev.from === 'player' ? 'player' : 'enemy'].flash, 'flash');
        break;
      case 'miss':
        g = geo(ev.to);
        if (g) { p = roomMid(g, ev.target); floatText(p.x, p.y - 8, '闪避', ev.to === 'player' ? '#82e6a0' : '#c8d2e6'); }
        break;
      case 'shield':
        g = geo(ev.side);
        if (g) {
          var from = ev.from === 'hazard' ? { x: R.w / 2, y: ev.side === 'player' ? R.h + 20 : -20 } : shooter(ev.from, null);
          var cm = roomMid(g, ev.target), hit = from ? hitEllipse(from, cm, bubble(g)) : null;
          p = hit || cm;
          R.ripples.push({ side: ev.side, x: p.x, y: p.y, life: 0.6 });
          addPart(p.x, p.y, 0, 0, 0.22, 3, '#bff0ff', 'flash');
          for (k = 0; k < 5; k++) addPart(p.x, p.y, rnd(-60, 60), rnd(-60, 60), 0.3, 1, C.shield, 'spark');
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
          addPart(p.x, p.y, 0, 0, 0.5, 10, C.ion, 'ring');
          for (k = 0; k < 8; k++) addPart(p.x, p.y, rnd(-70, 70), rnd(-70, 70), 0.4, 1, k & 1 ? '#d9ccff' : C.shield, 'spark');
        } else if (ev.dmg > 0) {
          explode(p.x, p.y, Math.min(1.8, 0.8 + ev.dmg * 0.35));
          floatText(p.x, p.y - 12, '-' + ev.dmg, ev.side === 'player' ? '#ff786e' : '#ffd678');
          if (ev.side === 'player') {
            R.hurt = Math.min(1, R.hurt + 0.35 + 0.15 * ev.dmg);
            if (!R.reduced) R.shake = Math.min(10, R.shake + 3 + 2 * ev.dmg);
          }
        } else {
          for (k = 0; k < 6; k++) addPart(p.x, p.y, rnd(-50, 50), rnd(-50, 50), 0.4, 1, C.fire1, 'spark');
        }
        break;
      case 'ion':
        g = geo(ev.side);
        if (g && g.ship.systems[ev.sys]) {
          p = roomMid(g, g.ship.systems[ev.sys].room);
          addPart(p.x, p.y, 0, 0, 0.6, 12, C.ion, 'ring');
        }
        break;
      case 'sysDamage':
        g = geo(ev.side);
        if (g && g.ship.systems[ev.sys]) {
          p = roomMid(g, g.ship.systems[ev.sys].room);
          for (k = 0; k < 10; k++) addPart(p.x, p.y, rnd(-90, 90), rnd(-90, 90), rnd(0.2, 0.5), 1, k & 1 ? '#ffe696' : '#ffffff', 'spark');
        }
        break;
      case 'fire': case 'breach':
        g = geo(ev.side);
        if (g) { p = roomMid(g, ev.room); addPart(p.x, p.y, 0, -10, 0.8, 4, ev.t === 'fire' ? C.fire0 : '#6f7f9c', 'smoke'); }
        break;
      case 'crewDied':
        p = R.lastPos[ev.side] && R.lastPos[ev.side][ev.name];
        if (p) {
          explode(p.x, p.y, 0.5, C.dmg);
          floatText(p.x, p.y - 10, ev.name + ' 阵亡', '#ff7878');
        }
        break;
      case 'destroyed':
        R.dead[ev.side] = R.t;
        for (k = 0; k < 8; k++) {
          later(k * 0.18, function () { var q = randomInShip(ev.side); if (q) explode(q.x, q.y, rnd(1, 1.8)); });
        }
        later(1.45, function () {
          var gg = geo(ev.side);
          if (gg) {
            var m = shipMid(gg);
            explode(m.x, m.y, 3, C.fire2);
            for (var d = 0; d < 14; d++) {
              var a = Math.random() * Math.PI * 2, v = rnd(30, 90);
              addPart(m.x + rnd(-20, 20), m.y + rnd(-20, 20), Math.cos(a) * v, Math.sin(a) * v, rnd(1, 1.8), 2, d & 1 ? '#46546f' : '#6f7f9c', 'spark');
            }
          }
          if (!R.reduced && ev.side === 'player') R.shake = 12;
        });
        break;
      case 'flare':
        R.flash = 0.8; R.flashCol = '#ff963c';
        break;
      case 'surge':
        g = geo('enemy');
        if (g) { p = shipMid(g); addPart(p.x, p.y, 0, 0, 0.6, 30, C.dmg, 'ring'); addPart(p.x, p.y, 0, 0, 0.3, 10, C.dmg, 'flash'); }
        break;
      case 'phase2':
        R.flash = 0.6; R.flashCol = '#ff3c3c';
        g = geo('enemy');
        if (g) { p = shipMid(g); addPart(p.x, p.y, 0, 0, 0.8, 30, '#ff5a5a', 'ring'); }
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ overlays (reticles, aiming)
  function reticleXY(b, k, out) {
    out.x = A(b.x + b.w) - 1 - 8 - k * 9;
    out.y = A(b.y) + 2;
    return out;
  }
  var tmpXY = { x: 0, y: 0 };
  function eachReticle(r, fn) {
    var g = geo('enemy');
    if (!g) return;
    var p = r.player, ws = p.weapons, rooms = g.ship.rooms, i, j;
    for (i = 0; i < ws.length; i++) {
      var tg = ws[i].target;
      if (tg == null || !rooms[tg]) continue;
      var k = 0;
      for (j = 0; j < i; j++) if (ws[j].target === tg) k++;
      fn(i, reticleXY(roomBox(g, rooms[tg]), k, tmpXY), p);
    }
  }
  function drawReticles(c, r) {
    var sel = G.View.sel;
    eachReticle(r, function (slot, q, p) {
      var armed = sel.mode === 'weapon' && sel.slot === slot;
      var st = G.Combat.weaponState(r, p, slot);
      c.fillStyle = armed ? C.amber : '#1d1405';
      c.fillRect(q.x, q.y, 8, 8);
      c.fillStyle = st.ready || st.frac >= 1 ? C.white : C.amber;
      rectLine(c, q.x, q.y, 8, 8);
      c.fillStyle = C.ink;
      c.fillRect(q.x, q.y + 8, 8, 1);
    });
  }
  function drawReticleDigits(ctx, r, dx, dy) {
    var sel = G.View.sel;
    ctx.font = '700 11px "Silkscreen", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    eachReticle(r, function (slot, q) {
      var armed = sel.mode === 'weapon' && sel.slot === slot;
      ctx.fillStyle = armed ? '#1d1405' : C.amberHi;
      ctx.fillText(String(slot + 1), (q.x + 4) * 2 + dx, (q.y + 4) * 2 + dy + 0.5);
    });
  }

  function drawAimOverlay(c, r) {
    var sel = G.View.sel, g, i, b, x0, y0, w, h;
    var ph = R.reduced ? 0 : Math.floor(R.t * 8);
    if (sel.mode === 'weapon') {
      g = geo('enemy');
      if (!g) return;
      var aim = G.View.aim;
      c.fillStyle = C.amber;
      for (i = 0; i < g.ship.rooms.length; i++) {
        b = roomBox(g, g.ship.rooms[i]);
        x0 = A(b.x) + 2; y0 = A(b.y) + 2; w = A(b.x + b.w) - x0 - 1; h = A(b.y + b.h) - y0 - 1;
        dashRect(c, x0, y0, w, h, ph);
      }
      if (aim && aim.room >= 0) {
        (aim.rooms || []).forEach(function (id, k) {
          var bb = roomBox(g, g.ship.rooms[id]);
          c.globalAlpha = k === 0 ? 0.55 : 0.35;
          c.fillStyle = pat(C.amber);
          c.fillRect(A(bb.x) + 1, A(bb.y) + 1, A(bb.x + bb.w) - A(bb.x) - 1, A(bb.y + bb.h) - A(bb.y) - 1);
        });
        c.globalAlpha = 1;
        var tb = roomBox(g, g.ship.rooms[aim.room]);
        x0 = A(tb.x); y0 = A(tb.y); w = A(tb.x + tb.w) - x0 + 1; h = A(tb.y + tb.h) - y0 + 1;
        c.fillStyle = C.amberHi;
        rectLine(c, x0, y0, w, h);
        var cx = x0 + (w >> 1), cy = y0 + (h >> 1), rr = Math.max(3, Math.round(Math.min(w, h) * 0.28));
        ring(c, cx, cy, rr, 1);
        c.fillRect(cx - rr - 3, cy, 4, 1); c.fillRect(cx + rr, cy, 4, 1);
        c.fillRect(cx, cy - rr - 3, 1, 4); c.fillRect(cx, cy + rr, 1, 4);
        if (aim.rooms && aim.rooms.length > 1) {
          var pts = sweepPoints(g, aim.rooms);
          c.fillStyle = C.dmg;
          for (var k = 1; k < pts.length; k++) pline(c, A(pts[k - 1].x), A(pts[k - 1].y), A(pts[k].x), A(pts[k].y), 1, 2);
        }
      }
    } else if (sel.mode === 'crew') {
      g = geo('player');
      if (!g) return;
      c.fillStyle = C.on;
      for (i = 0; i < g.ship.rooms.length; i++) {
        b = roomBox(g, g.ship.rooms[i]);
        x0 = A(b.x) + 2; y0 = A(b.y) + 2; w = A(b.x + b.w) - x0 - 1; h = A(b.y + b.h) - y0 - 1;
        dashRect(c, x0, y0, w, h, ph);
      }
    }
  }

  // ------------------------------------------------------------------ full-res text layer
  function drawMsg(ctx, cb) {
    var m = cb.msg, lay = L();
    if (!m || !lay || !lay.enemyZone) return;
    var age = cb.time - m.t;
    if (age > 3 || age < 0) return;
    var a = age < 2.4 ? 1 : 1 - (age - 2.4) / 0.6;
    var z = lay.enemyZone, y = z.y + z.h - 12;
    ctx.save();
    ctx.font = '600 14px "Silkscreen", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var w = Math.min(z.w - 16, ctx.measureText(m.text).width + 24);
    w = Math.round(w / 2) * 2;
    var x0 = Math.round((z.x + z.w / 2 - w / 2) / 2) * 2, y0 = Math.round((y - 11) / 2) * 2;
    ctx.globalAlpha = a > 0.66 ? 1 : a > 0.33 ? 0.66 : 0.33;
    ctx.fillStyle = '#11151f'; ctx.fillRect(x0 - 2, y0 - 2, w + 4, 26);
    ctx.fillStyle = '#46546f'; ctx.fillRect(x0, y0, w, 22);
    ctx.fillStyle = 'rgba(11,16,34,0.94)'; ctx.fillRect(x0 + 2, y0 + 2, w - 4, 18);
    ctx.fillStyle = m.kind === 'bad' ? '#ff8080' : m.kind === 'warn' ? '#ffcf70' : m.kind === 'good' ? '#8ff08a' : C.text;
    ctx.fillText(m.text, z.x + z.w / 2, y + 0.5, z.w - 24);
    ctx.restore();
  }

  function drawO2Text(ctx, side, dx, dy) {
    var g = geo(side);
    if (!g || g.ship.crewless || g.L.tile < 28) return;
    var rooms = g.ship.rooms, set = false;
    for (var i = 0; i < rooms.length; i++) {
      var rm = rooms[i];
      if (rm.o2 >= 50) continue;
      if (!set) {
        ctx.font = '600 11px "Silkscreen", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        set = true;
      }
      var b = roomBox(g, rm), tx = Math.round(b.x) + 5 + dx, ty = Math.round(b.y) + 4 + dy, s = Math.round(rm.o2) + '%';
      ctx.fillStyle = '#ffffff'; ctx.fillText(s, tx + 1, ty + 1);
      ctx.fillStyle = '#8a0f2a'; ctx.fillText(s, tx, ty);
    }
  }

  function drawTextParts(ctx, dx, dy) {
    var list = R.parts, set = false;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.type !== 'text') continue;
      if (!set) {
        ctx.font = '700 13px "Silkscreen", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        set = true;
      }
      var k = p.life / p.max, x = Math.round(p.x / 2) * 2 + dx, y = Math.round(p.y / 2) * 2 + dy;
      ctx.globalAlpha = k > 0.35 ? 1 : 0.5;
      ctx.fillStyle = '#11151f'; ctx.fillText(p.text, x + 2, y + 2);
      ctx.fillStyle = p.col; ctx.fillText(p.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ ships
  function drawShip(c, side, alpha, dxa, fleeing) {
    var g = geo(side);
    if (!g) return null;
    var sel = G.View.sel, ship = g.ship, t = g.L.tile;
    var ent = layerFor(side, ship, t, g.L.ox, g.L.oy, g.flip, side === 'enemy');
    var qx = Math.floor(g.L.ox / 2) + ent.offX + dxa, qy = Math.floor(g.L.oy / 2) + ent.offY;
    R.q.x = qx - dxa; R.q.y = qy;
    c.globalAlpha = alpha;
    drawFlames(c, ent, qx, qy, ship, side, fleeing);
    c.drawImage(ent.c, qx, qy);
    R.q.x = qx - dxa;
    drawRoomStates(c, g, ent, qx, qy, alpha);
    drawCrew(c, g, dxa, side === 'player' && sel.mode === 'crew' ? sel.crewId : null);
    drawShield(c, g, dxa);
    c.globalAlpha = 1;
    return g;
  }

  // ------------------------------------------------------------------ frame
  function frame(dt) {
    var ctx = R.ctx, c = R.bctx;
    if (!ctx || !c || R.w <= 0 || R.h <= 0) return;
    R.t += dt;
    var r = run();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    drawBackground(c, r, dt);
    runSched(dt);
    stepParts(dt);
    var lay = L(), cb = null;
    R.sx = 0; R.sy = 0;
    if (r && lay && lay.player) {
      cb = r.mode === 'combat' ? r.combat : null;
      if (R.shake > 0.2 && !R.reduced) {
        R.sx = Math.round(rnd(-1, 1) * R.shake / 2); R.sy = Math.round(rnd(-1, 1) * R.shake / 2);
      }
      R.shake *= Math.exp(-dt * 9);
      c.setTransform(1, 0, 0, 1, R.sx, R.sy);

      if (cb) {
        var e = cb.enemy;
        if (R.enemyRef !== e) { R.enemyRef = e; if (R.enemyIn >= 1 && cb.time > 0.1) R.enemyIn = 1; }
        R.enemyIn = Math.min(1, R.enemyIn + dt / 0.7);
        var ease = 1 - Math.pow(1 - R.enemyIn, 3);
        var alpha = ease;
        var fleeing = !!e.fleeing || cb.pending === 'enemyFled' || cb.result === 'enemyFled';
        if (cb.pending === 'enemyFled' || cb.result === 'enemyFled') alpha *= G.U.clamp(cb.pendingT / G.data.rules.endDelay, 0, 1);
        var dxa = Math.round((1 - ease) * 30);
        if (e.hull <= 0 && R.dead.enemy >= 0) {
          alpha *= G.U.clamp(1 - (R.t - R.dead.enemy - 1.1) / 0.5, 0, 1);
          if (!R.reduced) dxa += (Math.floor(R.t * 24) % 2) ? 1 : -1;
        }
        alpha = Math.round(alpha * 8) / 8;          // stepped fades
        if (alpha > 0.01) drawShip(c, 'enemy', alpha, dxa, fleeing);
      } else {
        R.enemyRef = null;
        drawPlanet(c, r);
      }
      var pa = 1;
      if (r.player.hull <= 0 && R.dead.player >= 0) pa = Math.round(G.U.clamp(1 - (R.t - R.dead.player - 1.1) / 0.6, 0.15, 1) * 8) / 8;
      drawShip(c, 'player', pa, 0, false);

      if (cb) {
        drawReticles(c, r);
        drawAimOverlay(c, r);
        drawBeams(c, cb);
        drawProjectiles(c, cb);
      } else if (G.View.sel.mode === 'crew') drawAimOverlay(c, r);
      drawRipples(c, dt);
      drawParts(c);
      c.setTransform(1, 0, 0, 1, 0, 0);

      // hurt: dithered red frame around the player zone
      if (R.hurt > 0.02 && lay.playerZone) {
        var z = lay.playerZone, zx = A(z.x), zy = A(z.y), zw = A(z.x + z.w) - zx, zh = A(z.y + z.h) - zy;
        var th = Math.max(1, Math.round(7 * R.hurt));
        c.globalAlpha = Math.min(1, R.hurt * 1.3);
        c.fillStyle = pat('#ff3b3b');
        c.fillRect(zx, zy, zw, th); c.fillRect(zx, zy + zh - th, zw, th);
        c.fillRect(zx, zy + th, th, zh - 2 * th); c.fillRect(zx + zw - th, zy + th, th, zh - 2 * th);
        if (R.hurt > 0.4) { c.fillStyle = '#ff3b3b'; rectLine(c, zx, zy, zw, zh); }
        c.globalAlpha = 1;
        R.hurt *= Math.exp(-dt * 4);
      }
    } else {
      drawParts(c);
    }
    if (R.flash > 0.02) {
      c.globalAlpha = Math.round(0.35 * R.flash * 10) / 10;
      c.fillStyle = R.flashCol;
      c.fillRect(0, 0, R.bw, R.bh);
      c.globalAlpha = 1;
      R.flash *= Math.exp(-dt * 3);
    }

    // upscale the art buffer (nearest neighbour), then crisp text on top
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(R.buf, 0, 0, R.bw * 2 * R.dpr, R.bh * 2 * R.dpr);
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    if (r && lay && lay.player) {
      var tdx = R.sx * 2, tdy = R.sy * 2;
      if (cb) drawReticleDigits(ctx, r, tdx, tdy);
      drawO2Text(ctx, 'player', tdx, tdy);
      if (cb) drawO2Text(ctx, 'enemy', tdx, tdy);
    }
    drawTextParts(ctx, R.sx * 2, R.sy * 2);
    if (cb) drawMsg(ctx, cb);
  }

  // ------------------------------------------------------------------ setup
  function init(canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.buf = mk(1, 1);
    R.bctx = R.buf.getContext('2d');
    R.q = { x: 0, y: 0 };
    try { canvas.style.imageRendering = 'pixelated'; } catch (e) { /* ignore */ }
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      R.reduced = !!mq.matches;
      var on = function (e) { R.reduced = !!e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    } catch (e) { R.reduced = false; }
    resize();
  }

  // Returns true when the backing store was reallocated (which clears it); an unchanged size is a no-op, so the
  // repeated resize / ResizeObserver / fonts.ready calls neither blank the canvas nor drop the caches.
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
    R.bw = Math.max(1, Math.ceil(w / 2)); R.bh = Math.max(1, Math.ceil(h / 2));
    if (R.buf) { R.buf.width = R.bw; R.buf.height = R.bh; R.bctx.imageSmoothingEnabled = false; }
    layerCache.length = 0;
    R.lk.player = R.lk.enemy = null;
    return true;
  }

  // Draw a ship template (G.data.ships[id] / G.data.hulls[id] or any {w,h,rooms,tint}) nose-up, fit to a canvas,
  // with the same pixel renderer. opts: { width, height (CSS px; default = canvas client size), crew: bool,
  // flip: bool, pad: tiles }
  var miniBuf = null;
  function miniShip(canvas, template, opts) {
    opts = opts || {};
    var tpl = typeof template === 'string' ? (G.data.ships[template] || G.data.hulls[template]) : template;
    if (!canvas || !tpl) return;
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var cw = Math.round(opts.width || canvas.clientWidth || canvas.width || 120);
    var ch = Math.round(opts.height || canvas.clientHeight || canvas.height || 160);
    var ship = {
      w: tpl.w, h: tpl.h, tint: tpl.tint || '#8ea6cf', name: tpl.name || tpl.id, templateId: tpl.id, crewless: !!tpl.crewless,
      rooms: tpl.rooms.map(function (rm, i) { return { id: i, x: rm.x, y: rm.y, w: rm.w, h: rm.h, sys: rm.sys || null, o2: 100, fire: 0, breach: 0 }; }),
      systems: {}, crew: [], weapons: [], hull: 1,
    };
    var pad = opts.pad != null ? opts.pad : 1.4;
    var t = Math.max(4, Math.floor(Math.min(cw / (ship.w + 2 * pad), ch / (ship.h + 2 * pad + 0.9)) / 2) * 2);
    var flip = !!opts.flip;
    var ox = Math.round((cw - ship.w * t) / 2), oy = Math.round((ch - ship.h * t) / 2 + (flip ? -0.45 : 0.45) * t);
    var bw = Math.ceil(cw / 2), bh = Math.ceil(ch / 2);
    if (!miniBuf) miniBuf = mk(bw, bh);
    miniBuf.width = bw; miniBuf.height = bh;
    var b = miniBuf.getContext('2d');
    b.clearRect(0, 0, bw, bh);
    var ent = layerFor(null, ship, t, ox, oy, flip, flip);
    var qx = Math.floor(ox / 2) + ent.offX, qy = Math.floor(oy / 2) + ent.offY;
    var cols = FLAME[flip ? 'enemy' : 'player'];
    ent.noz.forEach(function (n) {
      for (var s = 0; s < 4; s++) {
        var ww = Math.max(1, n.w - Math.floor(s * n.w / 5));
        b.fillStyle = s === 0 ? cols[0] : s < 2 ? cols[1] : cols[2];
        b.fillRect(qx + n.x + ((n.w - ww) >> 1), qy + n.y + s * ent.dir, ww, 1);
      }
    });
    b.drawImage(ent.c, qx, qy);
    ent.rooms.forEach(function (q) {
      if (!q.rm.sys) return;
      if (q.con) { b.fillStyle = '#2f6b45'; b.fillRect(qx + q.con.x, qy + q.con.y, q.con.w, 1); }
      if (q.bs) b.drawImage(icon(q.rm.sys, C.on), qx + q.bx + (q.bs === 11 ? 1 : 0), qy + q.by + (q.bs === 11 ? 1 : 0));
      else { b.fillStyle = C.on; b.fillRect(qx + q.bx, qy + q.by, 2, 2); }
    });
    if (opts.crew !== false && tpl.crew) {
      var perRoom = {};
      tpl.crew.forEach(function (cm, i) {
        if (cm.room == null || !ship.rooms[cm.room]) return;
        var k = perRoom[cm.room] = (perRoom[cm.room] || 0) + 1;
        var p = G.Ship.slotPos(ship, cm.room, k - 1);
        var sx = Math.round((ox + p.x * t) / 2), sy = Math.round((oy + (flip ? ship.h - p.y : p.y) * t) / 2);
        if (t >= 20) b.drawImage(crewSprite(cm.race, flip ? 'enemy' : 'player', 0, false, i % HAIR.length), sx - 3, sy - 6);
        else {
          // tiny thumbnail: a 2×3 pixel figure in the race color
          var race = G.data.crew.races[cm.race] || G.data.crew.races.human;
          b.fillStyle = C.ink; b.fillRect(sx - 2, sy - 2, 4, 5);
          b.fillStyle = race.color; b.fillRect(sx - 1, sy - 1, 2, 3);
        }
      });
    }
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(miniBuf, 0, 0, bw * 2 * dpr, bh * 2 * dpr);
  }

  G.Render = {
    init: init, resize: resize, frame: frame, fx: fx,
    pickRoom: pickRoom, nearestRoom: nearestRoom, miniShip: miniShip,
    _R: R,
  };
})();
