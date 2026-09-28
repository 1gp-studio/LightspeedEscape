// Main view (SPEC §9): the persistent in-run screen. Builds the CSS-grid DOM once (top bar, enemy zone,
// context strip, player zone + crew grid, weapons row, systems row) and keeps it in sync with the run every
// frame — text/classes are only written when a value changes. Owns the exclusive selection G.View.sel, the
// layout shared by DOM, canvas and input (G.View.layout) and the coach tips (G.Tips).
//   G.View.init(root) / measure() / refresh() / frame(dt) / resetSel()
//   G.View.tap(act, data, x, y) / chipStep(sysId, dir) / canAim() / aimMove / aimEnd / aimCancel   (input.js)
//   G.Tips.check(run, ev?) / done(id) / trigger(id)
(function () {
  'use strict';
  var G = globalThis.G;

  var SYS_CHIPS = ['shields', 'engines', 'weapons', 'oxygen', 'medbay'];
  var QP_ORDER = ['shields', 'weapons', 'piloting', 'engines', 'oxygen', 'medbay'];
  var FOCUS_TIME = 4;          // s a system chip stays focused after a tap
  var NOTE_TIME = 2.2;         // s a refusal reason stays in the context strip
  var TASK_BADGE = { repair: '修', fire: '火', breach: '破', man: '岗', walk: '走' };

  var V = {
    sel: { mode: 'none', slot: -1, crewId: null, sysId: null, until: 0 },
    layout: { w: 0, h: 0, enemy: null, player: null, crewPanel: null, enemyZone: null, playerZone: null },
    compact: false,
    aim: null,                 // { room, rooms } while press-drag targeting (drawn by render.js)
    clock: 0,                  // UI clock (s), runs while paused
    note: null,                // { text, until } refusal reason shown in the context strip
  };
  var E = {};                  // DOM refs
  var B = { weapKey: '', crewKey: '', enemy: null, ewKey: '', qpKey: '', qpEnemy: null, layoutKey: '', cardKey: '',
            shKey: '', sysLv: {}, rxKey: '', cxsKey: '', mode: '', run: null };

  // A different run object (new game, continue, quit): every DOM cache keyed on run data is stale — crew/weapon
  // ids and card keys repeat across runs, so drop them all.
  function resetCache(r) {
    B.run = r;
    B.weapKey = B.crewKey = B.ewKey = B.qpKey = B.layoutKey = B.cardKey = B.shKey = B.rxKey = B.cxsKey = '';
    B.enemy = null; B.qpEnemy = null; B.sysLv = {};
    V.note = null;
  }

  function run() { return G.App ? G.App.run : null; }
  function defs() { return G.data.systems.defs; }
  function rsn(code) { var t = G.data.text && G.data.text.reasons; return (t && t[code]) || code || ''; }
  function audio(name) { if (G.Audio && G.Audio.play) { try { G.Audio.play(name); } catch (e) { /* ignore */ } } }
  function sync() { if (G.App && G.App.sync) G.App.sync(); }

  // ------------------------------------------------------------------ cheap DOM setters (write on change only)
  function txt(el, v) { v = String(v); if (el._t !== v) { el._t = v; el.textContent = v; } }
  function cls(el, c, on) {
    on = !!on;
    var k = '_c_' + c;
    if (el[k] !== on) { el[k] = on; el.classList.toggle(c, on); }
  }
  function show(el, on) { on = !!on; if (el._s !== on) { el._s = on; el.hidden = !on; } }
  function bar(el, f) {
    f = Math.round(G.U.clamp(f || 0, 0, 1) * 400) / 400;
    if (el._f !== f) { el._f = f; el.style.transform = 'scaleX(' + f + ')'; }
  }
  function prop(el, k, v) { var c = '_p_' + k; if (el[c] !== v) { el[c] = v; el.style.setProperty(k, v); } }
  function dis(el, on) { on = !!on; if (el._d !== on) { el._d = on; el.classList.toggle('disabled', on); } }

  // ------------------------------------------------------------------ pixel icons (ART.md: crisp HUD icons)
  // Hand-drawn bitmaps for every icon the HUD uses: 12×12 (shown at 24px = 2px per art pixel) and 8×8 minis
  // (shown at 16px). '#' = currentColor, '+' = currentColor at half strength, 'k' = outline dark, 'o' = flame.
  // Rendered once into an SVG of 1×1 rects (shape-rendering: crispEdges); unknown names fall back to G.dom.icon.
  var PX = {
    shields: ['............', '.##########.', '.#........#.', '.#.++++++.#.', '.#.++++++.#.', '.#.++++++.#.',
              '.#..++++..#.', '..#..++..#..', '..#......#..', '...#....#...', '....#..#....', '.....##.....'],
    engines: ['............', '.....##.....', '....####....', '...######...', '..###..###..', '.###....###.',
              '.....##.....', '....####....', '...######...', '..###..###..', '.###....###.', '............'],
    weapons: ['.....##.....', '.....##.....', '...######...', '..##....##..', '.##......##.', '####.++.####',
              '####.++.####', '.##......##.', '..##....##..', '...######...', '.....##.....', '.....##.....'],
    oxygen: ['........##..', '.......#..#.', '.......#..#.', '........##..', '..###.......', '.#...#...##.',
             '#.+...#.#..#', '#.....#.#..#', '#.....#..##.', '.#...#......', '..###.......', '............'],
    medbay: ['............', '....####....', '....####....', '....####....', '.##########.', '.####++####.',
             '.####++####.', '.##########.', '....####....', '....####....', '....####....', '............'],
    piloting: ['...######...', '..#......#..', '.#........#.', '#..........#', '#...####...#', '#####++#####',
               '#####++#####', '#...####...#', '#....##....#', '.#...##...#.', '..#..##..#..', '...######...'],
    gear: ['....####....', '.##.####.##.', '.##########.', '..########..', '####....####', '###......###',
           '###......###', '####....####', '..########..', '.##########.', '.##.####.##.', '....####....'],
    jump: ['.....##.....', '....####....', '...######...', '..########..', '.##########.', '....####....',
           '....####....', '....####....', '............', '..########..', '............', '...######...'],
    pause: ['............', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..',
            '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '............'],
    play: ['...#........', '...##.......', '...###......', '...####.....', '...#####....', '...######...',
           '...######...', '...#####....', '...####.....', '...###......', '...##.......', '...#........'],
    map: ['........###.', '........###.', '........###.', '.......+....', '..###.+.....', '..###+......',
          '..###.......', '...+........', '..+.........', '###.........', '###.........', '###.........'],
    ship: ['.....##.....', '....####....', '....#++#....', '....####....', '...######...', '..########..',
           '.####++####.', '############', '##.######.##', '#...####...#', '....#..#....', '....o..o....'],
    store: ['............', '....####....', '...#....#...', '...#....#...', '.##########.', '.##########.',
            '.##+####+##.', '.##########.', '..########..', '..########..', '..########..', '............'],
  };
  var PX8 = {
    hull: ['...##...', '..####..', '..#++#..', '..####..', '.######.', '########', '##.##.##', '.o....o.'],
    scrap: ['..####..', '.######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
    fuel: ['...##...', '...##...', '..####..', '.######.', '.#+#####', '.#+#####', '.######.', '..####..'],
    missiles: ['...##...', '..####..', '..#++#..', '..####..', '..####..', '.######.', '##.##.##', '...oo...'],
    shields: ['########', '#++++++#', '#++++++#', '#++++++#', '.#++++#.', '.#++++#.', '..#++#..', '...##...'],
    engines: ['...##...', '..####..', '.##..##.', '#..##..#', '..####..', '.##..##.', '#......#', '........'],
    weapons: ['...##...', '.######.', '.#....#.', '###++###', '###++###', '.#....#.', '.######.', '...##...'],
    oxygen: ['.....##.', '....#..#', '....#..#', '.###.##.', '#+..#...', '#...#...', '#...#...', '.###....'],
    medbay: ['..####..', '..####..', '########', '###++###', '###++###', '########', '..####..', '..####..'],
    piloting: ['..####..', '.#....#.', '#..##..#', '####.###', '#..##..#', '#...#..#', '.#..#.#.', '..####..'],
    // crew busts per race (tile portraits): 人类 round head, 机工族 boxy + antenna, 岩石族 wide, 迅影族 slim
    c_human: ['..####..', '.######.', '.#k##k#.', '.######.', '..####..', '..++++..', '.++++++.', '.++++++.'],
    c_engi: ['...#....', '.######.', '.#k##k#.', '.######.', '.######.', '..++++..', '.++++++.', '.+.++.+.'],
    c_rock: ['.######.', '########', '#k####k#', '########', '.######.', '++++++++', '++++++++', '+++..+++'],
    c_swift: ['.#....#.', '.##..##.', '..####..', '..k##k..', '..####..', '...++...', '..++++..', '..+..+..'],
  };
  var PX_INK = { '#': 'currentColor', '+': 'currentColor', k: '#05070e', o: '#ff9f43' };
  var pxCache = {};
  function pxSvg(rows) {
    var n = rows.length, paths = {};
    for (var y = 0; y < n; y++) {
      var row = rows[y];
      for (var x = 0; x < row.length;) {
        var ch = row.charAt(x);
        if (!PX_INK[ch]) { x++; continue; }
        var x0 = x;
        while (x < row.length && row.charAt(x) === ch) x++;
        paths[ch] = (paths[ch] || '') + 'M' + x0 + ' ' + y + 'h' + (x - x0) + 'v1h' + (x0 - x) + 'z';
      }
    }
    var body = '';
    for (var k in paths) {
      body += '<path d="' + paths[k] + '" fill="' + PX_INK[k] + '"' + (k === '+' ? ' fill-opacity="0.5"' : '') + '/>';
    }
    return '<svg viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" aria-hidden="true">' + body + '</svg>';
  }
  // pxIcon(name, small): small = the 8×8 mini (16px) when one exists
  function pxIcon(name, small) {
    var set = small && PX8[name] ? PX8 : PX[name] ? PX : PX8[name] ? PX8 : null;
    if (!set) return G.dom.icon(name);
    var key = (set === PX8 ? '8:' : '12:') + name;
    if (!pxCache[key]) pxCache[key] = pxSvg(set[name]);
    var s = document.createElement('span');
    s.className = 'ico pxi ' + (set === PX8 ? 'px8' : 'px12');
    s.innerHTML = pxCache[key];
    return s;
  }

  // Discrete block bar (hull): n blocks, block i lit while value covers it (ceil, so any hull left shows a block).
  function blockRow(host, list, n) {
    if (list.length === n) return list;
    G.dom.clear(host);
    list = [];
    for (var i = 0; i < n; i++) { var el = G.dom.h('i'); host.appendChild(el); list.push(el); }
    return list;
  }
  function paintBlocks(list, v, max) {
    var n = list.length, lit = max > 0 ? Math.ceil(G.U.clamp(v / max, 0, 1) * n - 1e-6) : 0;
    for (var i = 0; i < n; i++) cls(list[i], 'on', i < lit);
  }

  // ------------------------------------------------------------------ build
  function build(root) {
    var h = G.dom.h, icon = pxIcon;
    E.root = root;
    E.mv = h('div.mv.norun');
    E.canvas = h('canvas.mv-canvas');

    // 1. top bar
    E.hullBlocks = h('div.hb-track');
    E.hullNum = h('b');
    E.hullMaxT = h('small');
    E.hull = h('div.tb-hull', icon('hull', true), E.hullBlocks, h('span.hb-txt', E.hullNum, E.hullMaxT));
    E.scrap = h('b'); E.fuel = h('b'); E.missiles = h('b');
    E.resScrap = h('div.tb-res.res-scrap', icon('scrap', true), E.scrap);
    E.resFuel = h('div.tb-res.res-fuel', icon('fuel', true), E.fuel);
    E.resMis = h('div.tb-res.res-missiles', icon('missiles', true), E.missiles);
    E.menu = h('button.mv-menu', { 'data-act': 'menu', 'aria-label': '菜单' }, icon('gear'));
    E.top = h('div.mv-top', E.hull, h('div.tb-resrow', E.resScrap, E.resFuel, E.resMis), E.menu);

    // 2. enemy zone
    E.ezName = h('b.ez-name');
    E.ezFac = h('span.ez-fac');
    E.ezShields = h('span.ez-sh');
    E.ezEva = h('span.ez-eva');
    E.ezHullBar = h('span.ez-hbar');
    E.ezHullNum = h('span.ez-hn');
    E.ezHead = h('div.ez-head',
      h('div.ez-id', E.ezName, E.ezFac),
      h('div.ez-st', E.ezShields, E.ezEva, h('span.ez-hull', E.ezHullBar, E.ezHullNum)));
    E.ezChips = h('div.ez-chips');
    E.ezVolley = h('span.ez-volley', '齐射');
    E.ezFtlFill = h('i');
    E.ezFtlTxt = h('span');
    E.ezFtl = h('span.ez-ftl', h('span.ez-ftlbar', E.ezFtlFill), E.ezFtlTxt);
    E.ezWeap = h('div.ez-weap', E.ezChips, E.ezVolley, E.ezFtl);
    E.ezCombat = h('div.ez-combat', E.ezHead, E.ezWeap);
    E.bcSector = h('b.bc-sector');
    E.bcType = h('span.bc-type');
    E.bcKind = h('div.bc-kind');
    E.bcFleet = h('div.bc-line');
    E.bcExit = h('div.bc-line');
    E.bcHaz = h('div.bc-line.warn');
    E.ezCard = h('div.ez-card', h('div.bc-head', E.bcSector, E.bcType), E.bcKind, E.bcFleet, E.bcExit, E.bcHaz);
    E.enemy = h('div.mv-enemy', { 'data-act': 'enemy' }, E.ezCombat, E.ezCard);

    // 3. context strip
    // none (combat)
    E.cxEva = h('span');
    E.cxO2 = h('span');
    E.cxHaz = h('div.cx-haz');
    E.cxFtlFill = h('i');
    E.cxFtlTxt = h('span.cx-ftltxt');
    E.cxFtlBar = h('div.cx-ftlbar', h('div.cx-ftltrack', E.cxFtlFill), E.cxFtlTxt);
    E.cxFlee = h('button.btn.primary.cx-flee', { 'data-act': 'flee' }, icon('jump'), '跃迁');
    E.cxVolley = h('button.btn.cx-volley', { 'data-act': 'volley' }, '齐射');
    E.cxNone = h('div.cx.cx-none',
      h('div.cx-stats', h('div.cx-l1', E.cxEva, h('span.faint', ' · '), E.cxO2), E.cxHaz),
      h('div.cx-ftl', E.cxFtlBar, E.cxFlee), E.cxVolley);
    // weapon armed
    E.cxwName = h('b');
    E.cxwHint = h('span');
    E.cxwQp = h('div.cx-qp', { 'data-scroll': 'x' });
    E.cxwNote = h('div.cx-wnote');     // refusal reason (replaces the quick-pick row for a moment)
    E.cxwClear = h('button.btn.cx-sq', { 'data-act': 'clearTarget' }, h('span', '清除'), h('span', '目标'));
    E.cxwPower = h('button.btn.cx-sq', { 'data-act': 'wpower' });
    E.cxWeapon = h('div.cx.cx-weapon', h('div.cx-wlabel', E.cxwName, E.cxwHint), E.cxwQp, E.cxwNote, E.cxwClear, E.cxwPower);
    // crew selected
    E.cxcDisc = h('i.cx-disc');
    E.cxcName = h('b');
    E.cxcInfo = h('span');
    E.cxcHp = h('span.cx-hp');
    E.cxcStation = h('button.btn.cx-sq', { 'data-act': 'crewStation' }, '回岗');
    E.cxCrew = h('div.cx.cx-crew', E.cxcDisc,
      h('div.cx-ctext', h('div.cx-l1', E.cxcName, h('span.faint', ' · '), E.cxcInfo, ' ', E.cxcHp), h('div.cx-sub', '→ 点舱室移动')),
      E.cxcStation, h('button.btn.ghost.cx-sq', { 'data-act': 'crewCancel' }, '取消'));
    // system focused
    E.cxsIcon = h('span.cx-sicon');
    E.cxsName = h('b');
    E.cxsPips = h('span.pips');
    E.cxsVal = h('span.cx-sval');
    E.cxsDetail = h('div.cx-sub');
    E.cxSys = h('div.cx.cx-sys',
      h('button.btn.cx-pm', { 'data-act': 'sysMinus', 'aria-label': '减少能量' }, '−'),
      h('div.cx-smid', h('div.cx-l1', E.cxsIcon, E.cxsName, E.cxsPips, E.cxsVal), E.cxsDetail),
      h('button.btn.cx-pm', { 'data-act': 'sysPlus', 'aria-label': '增加能量' }, '+'));
    // hub
    E.cxhSector = h('b');
    E.cxhFleet = h('span');
    E.cxhFuel = h('span.res-fuel');
    E.cxHub = h('div.cx.cx-hub', E.cxhSector, h('span.faint', '·'), E.cxhFleet, h('span.faint', '·'), E.cxhFuel);
    E.ctx = h('div.mv-ctx', { 'data-act': 'ctx' }, E.cxNone, E.cxWeapon, E.cxCrew, E.cxSys, E.cxHub);

    // 4. player zone
    E.crewGrid = h('div.crew-grid');
    E.crewAll = h('button.btn.crew-all', { 'data-act': 'allStations' }, h('span', '全员'), h('span', '回岗'));
    E.crewPanel = h('div.crew-panel', E.crewGrid, E.crewAll);
    E.pill = h('div.mv-pill', h('b', '已暂停'), ' · 暂停中也能下达指令');
    E.player = h('div.mv-player', { 'data-act': 'player' }, E.crewPanel, E.pill);

    // 5. weapons row
    E.wCards = h('div.wr-cards');
    E.hubMap = h('button.btn.wr-hub', { 'data-act': 'map' }, icon('map'), '星图');
    E.hubShip = h('button.btn.wr-hub', { 'data-act': 'ship' }, icon('ship'), '飞船');
    E.hubStore = h('button.btn.wr-hub', { 'data-act': 'store' }, icon('store'), '商店');
    E.wHub = h('div.wr-hubrow', E.hubMap, E.hubShip, E.hubStore);
    E.pause = h('button.pause-btn', { 'data-act': 'pause', 'aria-label': '暂停' });
    E.weap = h('div.mv-weap', E.wCards, E.wHub, E.pause);

    // 6. systems row
    E.rxFree = h('b.rx-free');
    E.rxUsed = h('span.rx-used');
    E.rxPips = h('span.rx-pips');
    E.reactor = h('div.reactor', { 'data-act': 'reactor' }, h('span.rx-lbl', '反应堆'), E.rxFree, E.rxUsed, E.rxPips);
    E.chips = {};
    var chipEls = SYS_CHIPS.map(function (sid) {
      var c = { pips: h('span.pips'), lvl: h('span.sc-lvl'), pipEls: [] };
      c.el = h('div.schip', { 'data-act': 'chip', 'data-sys': sid, 'aria-label': defs()[sid].name },
        h('span.sc-ico', icon(sid)), c.pips, c.lvl);
      E.chips[sid] = c;
      return c.el;
    });
    E.sys = h('div.mv-sys', E.reactor, chipEls);

    E.frameEl = h('div.mv-frame');
    E.callout = h('div.mv-callout');
    E.callout.hidden = true;

    G.dom.append(E.mv, [E.canvas, E.top, E.enemy, E.ctx, E.player, E.weap, E.sys, E.frameEl, E.callout]);
    root.appendChild(E.mv);
  }

  // ------------------------------------------------------------------ layout (shared with render + input)
  function rel(r, base) { return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; }

  function measure() {
    if (!E.mv) return;
    V.compact = E.root.clientHeight > 0 && E.root.clientHeight < 600;
    cls(E.mv, 'compact', V.compact);
    var cr = E.canvas.getBoundingClientRect();
    var L = V.layout;
    L.w = cr.width; L.h = cr.height;
    L.canvasRect = { left: cr.left, top: cr.top };
    L.enemyZone = rel(E.enemy.getBoundingClientRect(), cr);
    L.playerZone = rel(E.player.getBoundingClientRect(), cr);
    L.ctxZone = rel(E.ctx.getBoundingClientRect(), cr);
    // hull blocks: at most one per 4px of track (3px block + 1px gap) so narrow screens keep readable blocks
    var hw = E.hullBlocks.clientWidth;
    if (hw > 0) B.hullCap = Math.max(8, Math.floor((hw - 4 + 1) / 4));
    B.layoutKey = '';
    var realloc = !!(G.Render && G.Render.resize && G.Render.resize());
    computeLayout();
    // a reallocated canvas is blank: redraw now (ResizeObserver runs after this frame's rAF draw, before paint)
    if (realloc && G.Render.frame && !fullCover()) G.Render.frame(0);
  }

  // Fit a ship (w×h tiles) into a box: tile = floor(min(boxW/(w+.5), boxH/(h+padTop+padBot))), centered with the
  // vertical padding (tiles; default .25 + .25 = SPEC's h+.5) reserved above / below the room grid.
  function fit(box, sw, sh, flip, padTop, padBot) {
    var pt = padTop == null ? 0.25 : padTop, pb = padBot == null ? 0.25 : padBot;
    var t = Math.max(4, Math.floor(Math.min(box.w / (sw + 0.5), box.h / (sh + pt + pb))));
    return { x: box.x, y: box.y, w: box.w, h: box.h, tile: t, flip: !!flip,
             ox: Math.round(box.x + (box.w - sw * t) / 2), oy: Math.round(box.y + (box.h - (sh + pt + pb) * t) / 2 + pt * t),
             sw: sw, sh: sh };
  }

  function computeLayout() {
    var r = run(), L = V.layout;
    var ez = L.enemyZone, pz = L.playerZone;
    if (!ez || !pz) return;
    var p = r && r.player, e = r && r.combat ? r.combat.enemy : null;
    var n = p ? p.crew.length : 0;
    var key = [L.w, L.h, V.compact ? 1 : 0, p ? p.w + 'x' + p.h : '-', n, e ? e.w + 'x' + e.h : '-'].join('|');
    if (key === B.layoutKey) return;
    B.layoutKey = key;

    var headH = 40;   // 24px header + 16px weapon chip row
    var ebox = { x: ez.x + 8, y: ez.y + headH + 2, w: ez.w - 16, h: Math.max(20, ez.h - headH - 8) };
    // the flipped enemy's engines + glow stick out ~1.2 tiles at the top and its nose ~1.2 at the bottom: reserve part
    // of that so the hull stays clear of the header / weapon-chip strips (which are opaque over the rest)
    L.enemy = fit(ebox, e ? e.w : 6, e ? e.h : 6, true, 0.9, 0.5);

    var ct = V.compact ? 40 : 44;
    var rows = Math.max(1, Math.floor((pz.h - 48) / (ct + 4)));
    var cols = Math.max(1, Math.ceil(n / rows));
    var cpw = cols * (ct + 4) - 4;
    L.crewPanel = { x: pz.x + 8, y: pz.y + 8, w: cpw, h: pz.h - 16, rows: rows, cols: cols, tile: ct };
    // SPEC: player box = (zone width − crew panel − 8) × (zone height − 16); compact uses −8 so that the
    // tallest ship keeps tiles >= 22px at 360×560.
    var vpad = V.compact ? 8 : 16;
    var px0 = pz.x + 8 + cpw + 8;
    var pbox = { x: px0, y: pz.y + vpad / 2, w: Math.max(20, pz.x + pz.w - 8 - px0), h: Math.max(20, pz.h - vpad) };
    L.player = fit(pbox, p ? p.w : 6, p ? p.h : 8, false);

    prop(E.crewGrid, '--rows', String(rows));
  }

  function toCanvas(cx, cy) {
    var cr = E.canvas.getBoundingClientRect();
    return { x: cx - cr.left, y: cy - cr.top };
  }

  // ------------------------------------------------------------------ selection
  function resetSel() {
    var s = V.sel;
    s.mode = 'none'; s.slot = -1; s.crewId = null; s.sysId = null; s.until = 0;
    V.aim = null;
    V.note = null;               // a refusal reason belongs to the selection it was shown for
    if (E.callout) E.callout.hidden = true;
  }
  function selWeapon(slot) { resetSel(); V.sel.mode = 'weapon'; V.sel.slot = slot; }
  function selCrew(id) { resetSel(); V.sel.mode = 'crew'; V.sel.crewId = id; }
  function focusSys(sid) { resetSel(); V.sel.mode = 'system'; V.sel.sysId = sid; V.sel.until = V.clock + FOCUS_TIME; }
  function note(text) { V.note = { text: text, until: V.clock + NOTE_TIME }; }
  function noteText() { return V.note && V.note.until > V.clock ? V.note.text : ''; }

  function validateSel(r) {
    var s = V.sel;
    if (s.mode === 'none') return;
    if (!r) { resetSel(); return; }
    if (s.mode === 'weapon' && (r.mode !== 'combat' || !r.combat || !r.player.weapons[s.slot])) resetSel();
    else if (s.mode === 'crew' && !G.U.byId(r.player.crew, s.crewId)) resetSel();
    else if (s.mode === 'system' && (s.until <= V.clock || !r.player.systems[s.sysId])) resetSel();
  }

  // ------------------------------------------------------------------ actions (from input.js)
  function inPlay(r) { return !!r && (r.mode === 'combat' || r.mode === 'hub'); }
  // FTL charged AND a jump is possible (G.Run.canJump also needs fuel: with 0 fuel every beacon is out of reach)
  function fleeOk(r) { return G.Combat.canFlee(r) && (r.res.fuel || 0) >= 1; }

  function armWeapon(r, slot) {
    var p = r.player, w = p.weapons[slot];
    if (!w || r.mode !== 'combat') return;
    if (V.sel.mode === 'weapon' && V.sel.slot === slot) { resetSel(); audio('click'); return; }
    selWeapon(slot);
    Tips.done('t_arm');
    Tips.trigger('t_target');
    if (!w.on) {
      var why = G.Ship.toggleBlock(p, slot);
      if (why === '' && G.Ship.toggleWeapon(p, slot)) { V.note = null; audio('power'); }
      else { note(rsn(why || 'reactor')); audio('deny'); if (why === 'reactor') Tips.trigger('t_power'); }
    } else audio('click');
    sync();
  }

  function setTarget(r, room) {
    var s = V.sel;
    if (s.mode !== 'weapon' || !r.combat) return false;
    if (!G.Combat.setTarget(r, s.slot, room)) return false;
    audio('click');
    Tips.done('t_target');
    resetSel();
    sync();
    return true;
  }

  function power(r, sid, dir) {
    var p = r.player;
    if (!p.systems[sid]) { note(rsn('noSystem')); audio('deny'); return false; }
    var ok = dir > 0 ? G.Ship.addPower(p, sid) : G.Ship.removePower(p, sid);
    if (ok) {
      V.note = null;             // a stale '能量已满' must not outlive the − that fixed it
      audio('power');
      Tips.done('t_power');
      if (sid === 'oxygen' && dir > 0) Tips.done('t_o2');
    } else {
      audio('deny');
      note(dir > 0 ? rsn(G.Ship.powerBlock(p, sid)) : '该系统没有能量可减');
      if (dir > 0) Tips.trigger('t_power');
    }
    return ok;
  }

  // One power step from a chip tap / swipe; returns whether it succeeded (input.js counts only successes).
  function chipStep(sid, dir) {
    var r = run();
    if (!inPlay(r)) return false;
    focusSys(sid);               // before power(): focusSys resets the selection (and its note)
    var ok = power(r, sid, dir);
    sync();
    return ok;
  }

  function tapPlayer(r, x, y) {
    var room = G.Render ? G.Render.pickRoom('player', x, y) : -1;
    var p = r.player, s = V.sel;
    if (room < 0) { resetSel(); return; }
    var here = p.crew.filter(function (c) { return G.Crew.dest(c) === room; });
    if (s.mode === 'crew') {
      var cur = G.U.byId(p.crew, s.crewId);
      if (cur && G.Crew.dest(cur) === room) {
        // repeat taps on the selected crew's room cycle through the crew there
        if (here.length > 1) { selCrew(here[(here.indexOf(cur) + 1) % here.length].id); audio('click'); }
        else resetSel();
        return;
      }
      if (cur && G.Crew.order(p, cur.id, room)) {
        audio('click');
        Tips.done('t_crew');
        resetSel();
        sync();
      } else { audio('deny'); note('无法到达该舱室'); }
      return;
    }
    if (here.length) { selCrew(here[0].id); audio('click'); } else resetSel();
  }

  function tap(act, data, x, y) {
    var r = run();
    data = data || {};
    if (!r) return;
    switch (act) {
      case 'menu': resetSel(); audio('click'); G.UI.open('menu'); return;
      case 'pause': if (inPlay(r) && G.App) { audio('click'); G.App.setPaused(!G.App.paused); } return;
      case 'map': case 'ship': case 'store':
        if (r.mode !== 'hub' || (act === 'store' && !G.Run.hasStore(r))) { audio('deny'); return; }
        resetSel(); audio('click');
        if (act === 'map') Tips.done('t_map');
        G.UI.open(act);
        return;
      case 'ctx': case 'noop': return;
      default: break;
    }
    if (!inPlay(r)) return;
    var p = r.player, s = V.sel, w;
    switch (act) {
      case 'weapon': armWeapon(r, +data.slot); break;
      case 'wempty': resetSel(); note('空武器槽'); break;
      case 'chip': chipStep(data.sys, +1); break;
      case 'reactor':
        focusSys(s.mode === 'system' && s.sysId ? s.sysId : 'shields');
        note('反应堆 ' + G.Ship.reactorFree(p) + ' 格空闲 / 共 ' + p.reactor + ' 格');
        break;
      case 'sysMinus': case 'sysPlus':
        if (s.mode === 'system') { power(r, s.sysId, act === 'sysPlus' ? 1 : -1); s.until = V.clock + FOCUS_TIME; sync(); }
        break;
      case 'crew':
        if (s.mode === 'crew' && s.crewId === data.id) resetSel(); else selCrew(data.id);
        audio('click');
        break;
      case 'crewStation':
        w = G.U.byId(p.crew, s.crewId);
        if (w && w.station != null && G.Crew.order(p, w.id, w.station)) { audio('click'); resetSel(); sync(); }
        else { audio('deny'); note('没有指定岗位'); }
        break;
      case 'crewCancel': resetSel(); audio('click'); break;
      case 'allStations': G.Crew.returnToStations(p); resetSel(); audio('click'); Tips.done('t_crew'); sync(); break;
      case 'player': tapPlayer(r, x, y); break;
      case 'enemy': resetSel(); break;
      case 'qp': setTarget(r, +data.room); break;
      case 'clearTarget':
        if (s.mode === 'weapon') { G.Combat.setTarget(r, s.slot, null); audio('click'); sync(); }
        break;
      case 'wpower':
        if (s.mode === 'weapon') {
          w = p.weapons[s.slot];
          if (w && G.Ship.toggleWeapon(p, s.slot)) { V.note = null; audio('power'); Tips.done('t_power'); sync(); }
          else { audio('deny'); note(rsn(G.Ship.toggleBlock(p, s.slot))); Tips.trigger('t_power'); }
        }
        break;
      case 'volley': G.Combat.setVolley(r, !r.volley); audio('click'); Tips.done('t_shield'); sync(); break;
      case 'flee':
        if (G.Combat.canFlee(r) && !fleeOk(r)) { audio('deny'); note('燃料耗尽'); }
        else if (G.Combat.canFlee(r)) { resetSel(); audio('click'); Tips.done('t_ftl'); G.UI.open('map', { flee: true }); }
        else audio('deny');
        break;
      default: resetSel();
    }
  }

  // ---- press-drag-release targeting
  function canAim() {
    var r = run();
    return !!(r && r.mode === 'combat' && r.combat && !r.combat.result && V.sel.mode === 'weapon');
  }

  function aimRoom(x, y) {
    if (!G.Render) return -1;
    var room = G.Render.pickRoom('enemy', x, y);
    if (room < 0) room = G.Render.nearestRoom('enemy', x, y, 16);
    return room;
  }

  function roomLabel(ship, id) {
    var rm = ship.rooms[id];
    return rm && rm.sys ? defs()[rm.sys].name : '空舱室';
  }

  function aimMove(x, y, cx, cy) {
    var r = run();
    if (!canAim()) { aimCancel(); return; }
    var room = aimRoom(x, y), e = r.combat.enemy;
    if (room < 0) { V.aim = { room: -1, rooms: [] }; E.callout.hidden = true; return; }
    var rooms = G.Combat.previewBeam(r, V.sel.slot, room);
    V.aim = { room: room, rooms: rooms };
    var def = G.data.weapons[r.player.weapons[V.sel.slot].id];
    var label = def.type === 'beam' ? rooms.map(function (id) { return roomLabel(e, id); }).join(' → ') : roomLabel(e, room);
    txt(E.callout, label);
    E.callout.hidden = false;
    var mr = E.mv.getBoundingClientRect();
    var lx = cx - mr.left, half = Math.min(mr.width / 2 - 4, (E.callout.offsetWidth || 80) / 2 + 2);
    lx = G.U.clamp(lx, half + 4, mr.width - half - 4);
    E.callout.style.left = lx + 'px';
    E.callout.style.top = Math.max(2, cy - mr.top - 40 - 28) + 'px';
  }

  function aimEnd(x, y, cx, cy) {
    var r = run(), z = V.layout.enemyZone;
    var outside = !z || x < z.x - 24 || x > z.x + z.w + 24 || y < z.y - 24 || y > z.y + z.h + 24;
    if (!canAim() || outside) { aimCancel(); return; }
    // the release point decides; fall back to the last highlighted room (finger lifted just off the ship)
    var room = aimRoom(x, y);
    if (room < 0 && V.aim) room = V.aim.room;
    V.aim = null;
    E.callout.hidden = true;
    if (room >= 0) setTarget(r, room);
  }

  function aimCancel() { V.aim = null; if (E.callout) E.callout.hidden = true; }

  // ------------------------------------------------------------------ per-frame DOM update
  function hullClass(el, f) {
    cls(el, 'mid', f > 0.3 && f <= 0.6);
    cls(el, 'low', f <= 0.3);
  }

  function updateTop(r) {
    var p = r.player, f = p.hull / p.hullMax;
    txt(E.hullNum, p.hull);
    txt(E.hullMaxT, '/' + p.hullMax);
    E.hullBl = blockRow(E.hullBlocks, E.hullBl || [], Math.max(1, Math.min(B.hullCap || 30, p.hullMax)));
    paintBlocks(E.hullBl, p.hull, p.hullMax);
    hullClass(E.hull, f);
    txt(E.scrap, r.res.scrap);
    txt(E.fuel, r.res.fuel);
    txt(E.missiles, r.res.missiles);
    cls(E.resFuel, 'zero', r.res.fuel <= 0);
    cls(E.resMis, 'zero', r.res.missiles <= 0);
  }

  function buildEnemy(e) {
    var h = G.dom.h;
    B.enemy = e;
    var fac = G.data.text.factionNames[e.faction] || '';
    txt(E.ezName, e.name);
    txt(E.ezFac, fac + (e.boss ? '' : e.elite ? ' · 精英' : ''));
    G.dom.clear(E.ezChips);
    E.ewc = e.weapons.map(function (w) {
      var def = G.data.weapons[w.id], fill = h('i');
      var el = h('span.ewc', h('span.ewn', def.short), h('span.ewb', fill));
      E.ezChips.appendChild(el);
      return { el: el, fill: fill };
    });
    B.shKey = '';
  }

  function updateEnemy(r) {
    var c = r.combat, e = c.enemy;
    if (B.enemy !== e || E.ewc.length !== e.weapons.length) buildEnemy(e);
    cls(E.ezHead, 'phase2', e.phase === 2);
    // shield pips: capacity = floor(level/2); filled = layers; next one shows the charge
    var cap = e.systems.shields ? Math.floor(e.systems.shields.level / 2) : 0;
    var maxL = G.Ship.maxLayers(e);
    if (B.shKey !== String(cap)) {
      B.shKey = String(cap);
      G.dom.clear(E.ezShields);
      E.shPips = [];
      for (var i = 0; i < cap; i++) {
        var fill = G.dom.h('i');
        var pip = G.dom.h('span.shp', fill);
        E.ezShields.appendChild(pip);
        E.shPips.push({ el: pip, fill: fill });
      }
    }
    for (i = 0; i < E.shPips.length; i++) {
      var sp = E.shPips[i];
      cls(sp.el, 'up', i < e.shieldLayers);
      cls(sp.el, 'dead', i >= maxL);
      bar(sp.fill, i < e.shieldLayers ? 1 : (i === e.shieldLayers && i < maxL ? e.shieldCharge : 0));
    }
    show(E.ezShields, cap > 0);
    txt(E.ezEva, '闪避 ' + G.Ship.evasion(e) + '%');
    E.ezHullBl = blockRow(E.ezHullBar, E.ezHullBl || [], Math.max(1, Math.min(15, e.hullMax)));
    paintBlocks(E.ezHullBl, e.hull, e.hullMax);
    hullClass(E.ezHullBar, e.hull / e.hullMax);
    txt(E.ezHullNum, e.hull + '/' + e.hullMax);
    for (i = 0; i < E.ewc.length; i++) {
      var w = e.weapons[i], ch = E.ewc[i], f = w.charge / G.data.weapons[w.id].charge;
      bar(ch.fill, f);
      cls(ch.el, 'off', !w.on);
      cls(ch.el, 'hot', w.on && f >= 0.85);
    }
    show(E.ezVolley, !!e.volley);
    show(E.ezFtl, !!e.fleeing);
    if (e.fleeing) {
      bar(E.ezFtlFill, e.ftl);
      txt(E.ezFtlTxt, '跃迁充能 ' + Math.floor(e.ftl * 100) + '%');
    }
  }

  function updateCard(r) {
    var s = r.sector, b = G.Run.beacon(r);
    if (!s || !b) return;
    var type = G.data.sectors.types[s.type] || {};
    var key = [r.sectorIndex, r.at, r.mode, s.fleet, r.res.fuel, b.store ? 1 : 0].join('|');
    if (B.cardKey === key) return;
    B.cardKey = key;
    txt(E.bcSector, '星区 ' + (r.sectorIndex + 1) + ' · ' + s.name);
    txt(E.bcType, type.name || '');
    prop(E.ezCard, '--sector', type.accent || '#58c7d6');
    var kn = G.data.text.kindNames;
    var kind = b.id === s.exit && b.kind !== 'boss' ? kn.exit : (kn[b.kind] || '');
    if (b.kind === 'store' || b.store) kind = kind === kn.store ? kind : kind + ' · ' + kn.store;
    txt(E.bcKind, kind);
    var eta = G.Map.fleetEta(r);
    txt(E.bcFleet, eta <= 0 ? '叛军舰队已追上这里！' : '叛军舰队约 ' + eta + ' 跳后抵达');
    cls(E.bcFleet, 'danger', eta <= 1);
    var left = G.Map.jumpsLeft(s, r.at);
    var exitTxt;
    if ((r.res.fuel || 0) <= 0 && r.mode === 'hub') exitTxt = '燃料耗尽 · 打开星图等待救援';
    else if (left === 0) exitTxt = G.Run.isFinalSector(r) ? '叛军旗舰就在这里' : '已抵达出口 · 打开星图前往下一星区';
    else exitTxt = '距出口 ' + left + ' 跳 · 燃料 ' + r.res.fuel;
    txt(E.bcExit, exitTxt);
    var hz = b.hazard && b.hazard !== 'none' ? G.data.text.hazardNames[b.hazard] : '';
    txt(E.bcHaz, hz ? '环境：' + hz : '');
    show(E.bcHaz, !!hz);
  }

  function avgO2(p) {
    var s = 0;
    for (var i = 0; i < p.rooms.length; i++) s += p.rooms[i].o2;
    return p.rooms.length ? s / p.rooms.length : 100;
  }

  function pipRow(host, list, n) {
    if (list.length === n) return list;
    G.dom.clear(host);
    list = [];
    for (var i = 0; i < n; i++) { var el = G.dom.h('i.pip'); host.appendChild(el); list.push(el); }
    return list;
  }
  // Pip states for a system: on (powered), off (usable, unpowered), ion, dmg.
  function paintPips(list, sys, p) {
    var P = sys.id === 'weapons' ? G.Ship.weaponPower(p) : sys.power;
    if (sys.id === 'piloting') P = G.Ship.usable(sys);
    var U = G.Ship.usable(sys);
    for (var i = 0; i < list.length; i++) {
      var st = i < P ? 'on' : i < U ? 'off' : i < U + sys.ion ? 'ion' : 'dmg';
      if (list[i]._st !== st) { list[i]._st = st; list[i].className = 'pip ' + st; }
    }
  }

  function sysDetail(r, sid) {
    var p = r.player, s = p.systems[sid], R = G.data.rules;
    switch (sid) {
      case 'shields': return G.Ship.maxLayers(p) + ' 层护盾' + (G.Ship.isManned(p, 'shields') ? ' · 有人操作' : '');
      case 'engines': return '闪避 ' + G.Ship.evasion(p) + '% · 跃迁 ' + Math.round(G.Ship.ftlTime(p)) + 's';
      case 'weapons': return '武器能量 ' + G.Ship.weaponPower(p) + '/' + G.Ship.usable(s);
      case 'oxygen': return s.power > 0 ? '补氧 +' + R.oxygenRate[Math.min(s.power, R.oxygenRate.length - 1)] + '%/秒' : '氧气在缓慢流失';
      case 'medbay': return s.power > 0 ? '治疗 ' + R.medbayHps[Math.min(s.power, R.medbayHps.length - 1)] + ' 点/秒' : '未供能，无法治疗';
      default: return '';
    }
  }

  function buildQp(r, slot) {
    var e = r.combat.enemy, h = G.dom.h;
    var key = e.name + '|' + slot + '|' + e.rooms.length + '|' + Object.keys(e.systems).join(',');
    if (B.qpKey === key && B.qpEnemy === e) return;
    B.qpKey = key;
    B.qpEnemy = e;
    G.dom.clear(E.cxwQp);
    E.qp = [];
    QP_ORDER.forEach(function (sid) {
      var sys = e.systems[sid];
      if (!sys) return;
      var el = h('button.qp', { 'data-act': 'qp', 'data-room': String(sys.room), 'aria-label': defs()[sid].name }, pxIcon(sid));
      E.cxwQp.appendChild(el);
      E.qp.push({ el: el, sys: sys });
    });
    E.cxwQp.scrollLeft = 0;
  }

  function updateCtx(r) {
    var s = V.sel, p = r.player, combat = r.mode === 'combat' && r.combat;
    var mode = s.mode !== 'none' ? s.mode : combat ? 'none' : 'hub';
    show(E.cxNone, mode === 'none');
    show(E.cxWeapon, mode === 'weapon');
    show(E.cxCrew, mode === 'crew');
    show(E.cxSys, mode === 'system');
    show(E.cxHub, mode === 'hub');
    var nt = noteText();

    if (mode === 'none') {
      var c = r.combat;
      txt(E.cxEva, '闪避 ' + G.Ship.evasion(p) + '%');
      var o2 = Math.round(avgO2(p));
      txt(E.cxO2, '氧 ' + o2 + '%');
      cls(E.cxO2, 'danger', o2 < 40);
      var hz = '';
      if (c.hazard === 'fleet') {
        hz = '舰队炮击 ' + Math.ceil(Math.max(0, c.hazardT.fleet)) + 's';
        if (c.flags && c.flags.fleetShots > 1) hz += ' ×' + c.flags.fleetShots;
      } else if (c.hazard === 'sun') hz = '恒星耀斑 ' + Math.ceil(Math.max(0, c.hazardT.flare)) + 's';
      else if (c.hazard === 'asteroid') hz = '小行星带';
      if (c.boss && c.enemy.phase === 2) hz = '能量涌动 ' + Math.ceil(Math.max(0, c.enemy.surgeT)) + 's';
      if (nt) hz = nt;
      txt(E.cxHaz, hz);
      cls(E.cxHaz, 'note', !!nt);
      var canFlee = fleeOk(r), noFuel = G.Combat.canFlee(r) && !canFlee;
      show(E.cxFlee, canFlee);
      show(E.cxFtlBar, !canFlee);
      if (!canFlee) {
        bar(E.cxFtlFill, p.ftl);
        var ft, bad = false;
        if (c.boss) { ft = '无法逃离'; bad = true; }
        else if (noFuel) { ft = '燃料耗尽'; bad = true; }
        else if (c.pending || c.result) ft = '跃迁 ' + Math.floor(p.ftl * 100) + '%';
        else if (!G.Ship.canChargeFtl(p)) {
          bad = true;
          ft = !p.systems.engines || p.systems.engines.power <= 0 ? '引擎无能量' : '需要驾驶员';
        } else ft = '跃迁充能 ' + Math.floor(p.ftl * 100) + '%';
        txt(E.cxFtlTxt, ft);
        cls(E.cxFtlBar, 'bad', bad);
      }
      cls(E.cxVolley, 'on', !!r.volley);
    } else if (mode === 'weapon') {
      var w = p.weapons[s.slot], def = G.data.weapons[w.id];
      buildQp(r, s.slot);
      txt(E.cxwName, '〔' + def.short + '〕');
      txt(E.cxwHint, !w.on ? '未供能' : def.missile ? '选目标·单发' : w.target != null ? '改选目标' : '选目标');
      cls(E.cxwHint, 'danger', !w.on);
      show(E.cxwQp, !nt);
      show(E.cxwNote, !!nt);
      if (nt) txt(E.cxwNote, nt);
      for (var i = 0; i < E.qp.length; i++) {
        var q = E.qp[i];
        cls(q.el, 'dmg', q.sys.damage > 0);
        cls(q.el, 'ion', q.sys.ion > 0);
        cls(q.el, 'cur', w.target === q.sys.room);
      }
      dis(E.cxwClear, w.target == null);
      txt(E.cxwPower, w.on ? '断电' : '通电');
      cls(E.cxwPower, 'on', !w.on);
    } else if (mode === 'crew') {
      var cm = G.U.byId(p.crew, s.crewId), race = G.data.crew.races[cm.race];
      prop(E.cxcDisc, '--race', race.color);
      if (E.cxcDisc._race !== cm.race) {
        E.cxcDisc._race = cm.race;
        G.dom.clear(E.cxcDisc).appendChild(pxIcon('c_' + (PX8['c_' + cm.race] ? cm.race : 'human')));
      }
      txt(E.cxcName, cm.name);
      txt(E.cxcInfo, race.name);
      txt(E.cxcHp, 'HP ' + Math.ceil(cm.hp) + '/' + cm.hpMax);
      cls(E.cxcHp, 'danger', cm.hp < cm.hpMax * 0.35);
      dis(E.cxcStation, cm.station == null || G.Crew.dest(cm) === cm.station);
    } else if (mode === 'system') {
      var sys = p.systems[s.sysId];
      if (B.cxsKey !== s.sysId) {
        B.cxsKey = s.sysId;
        G.dom.clear(E.cxsIcon).appendChild(pxIcon(s.sysId, true));
        txt(E.cxsName, defs()[s.sysId].name);
      }
      E.cxsPipList = pipRow(E.cxsPips, E.cxsPipList || [], sys.level);
      paintPips(E.cxsPipList, sys, p);
      var P = s.sysId === 'weapons' ? G.Ship.weaponPower(p) : sys.power;
      txt(E.cxsVal, P + '/' + sys.level);
      txt(E.cxsDetail, nt || sysDetail(r, s.sysId));
      cls(E.cxsDetail, 'danger', !!nt);
    } else {
      var sec = r.sector;
      if (sec) {
        txt(E.cxhSector, sec.name);
        var eta = G.Map.fleetEta(r);
        txt(E.cxhFleet, eta <= 0 ? '叛军舰队已追上' : '叛军舰队约 ' + eta + ' 跳');
        cls(E.cxhFleet, 'danger', eta <= 1);
        txt(E.cxhFuel, '燃料 ' + r.res.fuel);
        cls(E.cxhFuel, 'danger', r.res.fuel <= 2);
      }
    }
  }

  function buildCrew(p) {
    var key = p.crew.map(function (c) { return c.id + ':' + c.name + ':' + c.race; }).join(',');
    if (key === B.crewKey) return;
    B.crewKey = key;
    var h = G.dom.h;
    G.dom.clear(E.crewGrid);
    E.ct = p.crew.map(function (c) {
      var race = G.data.crew.races[c.race] || G.data.crew.races.human;
      var t = { id: c.id, hp: h('i'), badge: h('b.cbadge') };
      t.el = h('div.ctile', { 'data-act': 'crew', 'data-id': c.id, 'aria-label': c.name, style: { '--race': race.color } },
        h('i.cdisc', pxIcon('c_' + (PX8['c_' + c.race] ? c.race : 'human'))), t.badge, h('span.cn', c.name.slice(0, 2)), h('span.chp', t.hp));
      E.crewGrid.appendChild(t.el);
      return t;
    });
  }

  function updateCrew(r) {
    var p = r.player;
    buildCrew(p);
    for (var i = 0; i < E.ct.length; i++) {
      var t = E.ct[i], c = p.crew[i];
      if (!c || c.id !== t.id) continue;
      var f = c.hp / c.hpMax;
      bar(t.hp, f);
      cls(t.el, 'hurt', f < 0.35);
      cls(t.el, 'sel', V.sel.mode === 'crew' && V.sel.crewId === c.id);
      txt(t.badge, TASK_BADGE[c.task] || '');
      if (t.badge._task !== c.task) { t.badge._task = c.task; t.badge.className = 'cbadge t-' + c.task; }
    }
    show(E.crewAll, p.crew.length > 0);
  }

  function buildCards(p) {
    var n = Math.max(p.weaponSlots, p.weapons.length);
    var key = n + ':' + p.weapons.map(function (w) { return w.uid + w.id; }).join(',');
    if (key === B.weapKey) return;
    B.weapKey = key;
    var h = G.dom.h;
    G.dom.clear(E.wCards);
    E.cards = [];
    for (var i = 0; i < n; i++) {
      var w = p.weapons[i];
      if (!w) {
        E.wCards.appendChild(h('div.wcard.empty', { 'data-act': 'wempty' }, h('span.wc-n', String(i + 1)),
          h('span.wc-empty', G.App && G.App.run && G.App.run.cargo.length ? '货舱有武器' : '空槽')));
        continue;
      }
      var def = G.data.weapons[w.id];
      var c = { fill: h('i'), tgt: h('span.wc-tgt'), pips: [], missile: !!def.missile };
      var pipsEl = h('span.wc-pips');
      for (var k = 0; k < def.power; k++) { var pe = h('i.pip'); pipsEl.appendChild(pe); c.pips.push(pe); }
      c.el = h('div.wcard', { 'data-act': 'weapon', 'data-slot': String(i), 'aria-label': def.name, 'data-type': def.type },
        h('div.wc-top', h('span.wc-n', String(i + 1)), h('span.wc-name', def.short)),
        h('span.wc-bar', c.fill),
        h('div.wc-bot', pipsEl, c.tgt));
      E.wCards.appendChild(c.el);
      E.cards[i] = c;
    }
  }

  function updateWeapons(r) {
    var p = r.player, combat = r.mode === 'combat' && !!r.combat;
    show(E.wCards, combat);
    show(E.wHub, !combat);
    if (combat) {
      buildCards(p);
      var e = r.combat.enemy;
      for (var i = 0; i < p.weapons.length; i++) {
        var c = E.cards[i], w = p.weapons[i];
        if (!c) continue;
        var st = G.Combat.weaponState(r, p, i);
        // charged but untargeted (missiles clear their target after every shot): it will never fire by itself
        var idle = st.why === 'noTarget' && st.frac >= 1;
        cls(c.el, 'on', w.on);
        cls(c.el, 'full', w.on && st.frac >= 1 && !idle);
        cls(c.el, 'idle', idle);
        cls(c.el, 'ready', st.why === '');
        cls(c.el, 'wait', st.why === 'volley');
        cls(c.el, 'nomis', st.why === 'noMissiles');
        cls(c.el, 'armed', V.sel.mode === 'weapon' && V.sel.slot === i);
        bar(c.fill, st.frac);
        for (var k = 0; k < c.pips.length; k++) cls(c.pips[k], 'on', w.on);
        // bottom-right badge: 无弹 > 选目标 (charged, no target) > target system > '单发' tag (missile weapons: one tap = one missile)
        var tg = '', tag = false;
        if (st.why === 'noMissiles') tg = '无弹';
        else if (!w.on) {
          // unpowered: say why it can't be switched on (new players don't know weapons need power + capacity)
          var tb = G.Ship.toggleBlock(p, i);
          tg = tb === 'capacity' ? '容量不足' : tb === 'reactor' ? '缺能量' : tb === 'broken' ? '已损坏' : '点击通电';
        }
        else if (idle) tg = '选目标';
        else if (w.target != null && e.rooms[w.target]) {
          var rs = e.rooms[w.target].sys;
          tg = '◎' + (rs ? defs()[rs].short : '空');
        } else if (c.missile) { tg = '单发'; tag = true; }
        txt(c.tgt, tg);
        cls(c.tgt, 'tag', tag);
        cls(c.tgt, 'pick', idle);
      }
    } else {
      var hub = r.mode === 'hub';
      dis(E.hubMap, !hub);
      dis(E.hubShip, !hub);
      show(E.hubStore, hub && G.Run.hasStore(r));
    }
    var paused = !!(G.App && G.App.paused);
    if (E.pause._pz !== paused) {
      E.pause._pz = paused;
      G.dom.clear(E.pause).appendChild(pxIcon(paused ? 'play' : 'pause'));
      E.pause.setAttribute('aria-label', paused ? '继续' : '暂停');
    }
    cls(E.pause, 'paused', paused);
  }

  function updateSystems(r) {
    var p = r.player;
    var free = G.Ship.reactorFree(p), used = G.Ship.reactorUsed(p);
    txt(E.rxFree, free);
    txt(E.rxUsed, used + '/' + p.reactor);
    cls(E.reactor, 'empty', free <= 0);
    var showPips = p.reactor <= 12;
    show(E.rxPips, showPips);
    if (showPips) {
      E.rxPipList = pipRow(E.rxPips, E.rxPipList || [], p.reactor);
      for (var i = 0; i < E.rxPipList.length; i++) cls(E.rxPipList[i], 'on', i < free);
    }
    var s = V.sel;
    SYS_CHIPS.forEach(function (sid) {
      var c = E.chips[sid], sys = p.systems[sid];
      cls(c.el, 'missing', !sys);
      cls(c.el, 'focus', s.mode === 'system' && s.sysId === sid);
      if (!sys) return;
      c.pipEls = pipRow(c.pips, c.pipEls, sys.level);
      paintPips(c.pipEls, sys, p);
      txt(c.lvl, sys.level);
      var P = sid === 'weapons' ? G.Ship.weaponPower(p) : sys.power;
      cls(c.el, 'zero', P <= 0);
      cls(c.el, 'dmg', sys.damage > 0);
      cls(c.el, 'ion', sys.ion > 0);
    });
  }

  function update() {
    var r = run();
    if (!E.mv) return;
    if (B.run !== r) resetCache(r);
    var mode = !r ? 'norun' : r.mode === 'combat' && r.combat ? 'combat' : 'hub';
    if (B.mode !== mode) {
      B.mode = mode;
      E.mv.className = 'mv ' + mode + (V.compact ? ' compact' : '');
      ['_c_compact', '_c_paused', '_c_armed'].forEach(function (k) { delete E.mv[k]; });
    }
    validateSel(r);
    cls(E.mv, 'paused', !!(r && G.App && G.App.paused && (r.mode === 'combat' || r.mode === 'hub')));
    cls(E.mv, 'armed', V.sel.mode === 'weapon');
    if (!r) return;
    computeLayout();
    updateTop(r);
    show(E.ezCombat, mode === 'combat');
    show(E.ezCard, mode !== 'combat');
    if (mode === 'combat') updateEnemy(r); else updateCard(r);
    updateCtx(r);
    updateCrew(r);
    updateWeapons(r);
    updateSystems(r);
  }

  // ------------------------------------------------------------------ coach tips (G.Tips)
  var TIP_ANCHOR = {
    t_pause: function () { return E.pause; },
    t_arm: function () { return E.wCards.querySelector('.wcard:not(.empty)'); },
    t_target: function () { return E.ctx; },
    t_power: function () { return E.sys; },
    t_crew: function () { return E.crewPanel; },
    t_shield: function () { return E.cxVolley; },   // the tip suggests 齐射; keeps the bubble off the enemy ship
    t_ftl: function () { return E.cxFlee; },
    t_o2: function () { return E.chips.oxygen.el; },
    t_map: function () { return E.hubMap; },
  };
  // t_power is deliberately mode-free: a power refusal in the hub triggers it too.
  var TIP_MODE = { t_pause: 'combat', t_arm: 'combat', t_target: 'combat', t_shield: 'combat', t_ftl: 'combat',
                   t_crew: 'combat', t_map: 'hub' };

  var Tips = {
    queue: [], cur: null, pollT: 0,
    enabled: function () {
      var A = G.App;
      return !!(A && A.settings && A.settings.tips !== false && A.meta);
    },
    seen: function (id) { var m = G.App && G.App.meta; return !!(m && m.tipsSeen && m.tipsSeen[id]); },
    mark: function (id) {
      var m = G.App && G.App.meta;
      if (!m) return;
      if (!m.tipsSeen) m.tipsSeen = {};
      if (m.tipsSeen[id]) return;
      m.tipsSeen[id] = true;
      if (G.Save) G.Save.saveMeta(m);
    },
    trigger: function (id) {
      if (!Tips.enabled() || Tips.seen(id) || Tips.cur === id) return;
      for (var i = 0; i < Tips.queue.length; i++) if (Tips.queue[i].id === id) return;
      Tips.queue.push({ id: id, at: V.clock });
    },
    // The player did the thing: close the tip (or drop it before it shows) and never show it again.
    done: function (id) {
      Tips.queue = Tips.queue.filter(function (q) { return q.id !== id; });
      if (Tips.enabled()) Tips.mark(id);
      if (Tips.cur === id) { var en = G.UI.get('tip'); if (en) en.state.done = true; Tips.close(); }
    },
    close: function () {
      Tips.cur = null;
      if (G.UI.isOpen('tip')) G.UI.close('tip');
    },
    // New run / back to title: forget queued tips and close the open one without re-queueing it.
    reset: function () {
      Tips.queue = [];
      Tips.pollT = 0;
      var en = G.UI.get('tip');
      if (en) en.state.done = true;
      Tips.close();
    },
    // Event-driven triggers (called by main.js for every drained fx event) and state polling (no ev).
    check: function (r, ev) {
      if (!r || !Tips.enabled()) return;
      if (ev) {
        if (ev.t === 'combatStart') {
          if ((r.stats.combatTime || 0) <= 0) Tips.trigger('t_pause'); else Tips.trigger('t_power');
        } else if ((ev.t === 'fire' || ev.t === 'breach' || ev.t === 'sysDamage') && ev.side === 'player') Tips.trigger('t_crew');
        else if (ev.t === 'shield' && ev.from === 'player') Tips.trigger('t_shield');
        return;
      }
      if (r.mode === 'combat' && r.combat) {
        if (Tips.seen('t_pause') && !Tips.cur) Tips.trigger('t_arm');
        if (fleeOk(r)) Tips.trigger('t_ftl');
        var p = r.player;
        for (var i = 0; i < p.rooms.length; i++) if (p.rooms[i].o2 < 30) { Tips.trigger('t_o2'); break; }
      } else if (r.mode === 'hub') Tips.trigger('t_map');
    },
    update: function (dt) {
      var r = run();
      Tips.pollT -= dt;
      if (Tips.pollT <= 0) { Tips.pollT = 0.25; Tips.check(r); }
      if (Tips.cur) {
        if (!G.UI.isOpen('tip')) Tips.cur = null;
        else if (TIP_MODE[Tips.cur] && r && TIP_MODE[Tips.cur] !== (r.mode === 'combat' ? 'combat' : r.mode)) Tips.close();
        return;
      }
      if (!Tips.queue.length || !r || G.UI.modalOpen() || !Tips.enabled()) return;
      if (G.App && G.App._lastMode !== r.mode) return;   // a mode change is waiting for sync()
      Tips.queue = Tips.queue.filter(function (q) { return V.clock - q.at < 12 && !Tips.seen(q.id); });
      for (var i = 0; i < Tips.queue.length; i++) {
        var q = Tips.queue[i];
        var want = TIP_MODE[q.id];
        if (want && want !== (r.mode === 'combat' ? 'combat' : r.mode)) continue;
        var a = TIP_ANCHOR[q.id] && TIP_ANCHOR[q.id]();
        if (!a || !a.offsetParent || a.getBoundingClientRect().width <= 0) continue;
        var text = G.data.text.tips && G.data.text.tips[q.id];
        Tips.queue.splice(i, 1);
        if (!text) return;
        Tips.mark(q.id);
        Tips.cur = q.id;
        Tips.shownAt = V.clock;
        G.UI.open('tip', { id: q.id, text: text, anchor: a });
        return;
      }
    },
  };

  // Tips that point into the context strip open below it (over the player zone), keeping the enemy ship visible.
  var TIP_BELOW = { t_target: 1, t_shield: 1, t_ftl: 1 };

  // Control rows a bubble must not cover (its 知道了 button would swallow the player's next tap there).
  function tipKeepOut(host) {
    var out = [];
    [E.top, E.ctx, E.weap, E.sys].forEach(function (el) {
      var r = el && el.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) out.push({ t: r.top - host.top, b: r.bottom - host.top, l: r.left - host.left, r: r.right - host.left });
    });
    return out;
  }
  // Slide a bubble (above: upward / below: downward) past every keep-out row it overlaps; null if it runs off-screen.
  function tipSlide(dir, top, left, bw, bh, keep, H) {
    for (var n = 0; n <= keep.length; n++) {
      if (top < 8 || top + bh > H - 8) return null;
      var hit = null;
      for (var i = 0; i < keep.length; i++) {
        var k = keep[i];
        if (left < k.r && left + bw > k.l && top < k.b && top + bh > k.t) { hit = k; break; }
      }
      if (!hit) return top;
      top = dir === 'above' ? hit.t - bh - 8 : hit.b + 8;
    }
    return null;
  }

  function placeTip(entry) {
    var st = entry.state, a = entry.params.anchor, id = entry.params.id;
    if (!a || !st.bubble) return;
    var host = entry.el.getBoundingClientRect();
    var ar = a.getBoundingClientRect();
    // anchor hidden (e.g. 跃迁 while the strip shows a system), or a modal overlay (offer, map, menu...) opened
    // on top: hide the bubble instead of pointing at (0,0) / covering the dialog; it comes back afterwards.
    if (G.UI.modalOpen() || !a.offsetParent || ar.width <= 0 || ar.height <= 0) {
      if (st.key !== 'hidden') { st.key = 'hidden'; st.bubble.style.visibility = 'hidden'; st.ring.style.visibility = 'hidden'; }
      return;
    }
    var key = [ar.left, ar.top, ar.width, ar.height, host.width, host.height].join(',');
    if (st.key === key) return;
    st.key = key;
    st.bubble.style.visibility = '';
    var W = host.width, H = host.height;
    var ax = ar.left - host.left, ay = ar.top - host.top;
    st.ring.style.cssText = 'left:' + (ax - 3) + 'px;top:' + (ay - 3) + 'px;width:' + (ar.width + 6) + 'px;height:' + (ar.height + 6) + 'px';
    var keep = tipKeepOut(host);
    var bw, bh, left, top = null, dir = 'above', arrowX = 0, arrowY = 0;
    // t_crew: beside the crew panel, inside the player zone (never over the context strip / weapon row)
    if (id === 't_crew') {
      var pr = E.player.getBoundingClientRect(), pt = pr.top - host.top, pb = pr.bottom - host.top;
      left = ax + ar.width + 8;
      bw = Math.min(280, W - left - 12);
      if (bw >= 170) {
        st.bubble.style.width = bw + 'px';
        bh = st.bubble.offsetHeight || 110;
        var sTop = G.U.clamp(ay, pt + 4, pb - bh - 4);
        if (sTop >= pt) { top = sTop; dir = 'side'; arrowY = G.U.clamp(ay + 16 - sTop, 10, bh - 24); }
      }
    }
    if (top === null) {
      bw = Math.min(280, W - 24);
      st.bubble.style.width = bw + 'px';
      bh = st.bubble.offsetHeight || 110;
      var cx = ax + ar.width / 2;
      left = G.U.clamp(cx - bw / 2, 12, W - bw - 12);
      arrowX = G.U.clamp(cx - left - 7, 12, bw - 26);
      var order = TIP_BELOW[id] ? ['below', 'above'] : ['above', 'below'];
      for (var i = 0; i < order.length && top === null; i++) {
        dir = order[i];
        top = tipSlide(dir, dir === 'above' ? ay - bh - 12 : ay + ar.height + 12, left, bw, bh, keep, H);
      }
      if (top === null) {   // nothing avoids every control row: fall back to plain above / below the anchor
        dir = ay - bh - 14 >= 8 ? 'above' : 'below';
        top = dir === 'above' ? ay - bh - 12 : Math.min(H - bh - 8, ay + ar.height + 12);
      }
    }
    st.bubble.style.left = left + 'px';
    st.bubble.style.top = top + 'px';
    st.bubble.classList.toggle('below', dir === 'below');
    st.bubble.classList.toggle('side', dir === 'side');
    st.arrow.style.left = dir === 'side' ? '' : arrowX + 'px';
    st.arrow.style.top = dir === 'side' ? arrowY + 'px' : '';
  }

  G.UI.register('tip', {
    modal: false, cls: 'clear tip-layer',
    mount: function (entry) {
      var h = G.dom.h, st = entry.state;
      st.ring = h('div.tip-ring');
      st.arrow = h('i.tip-arrow');
      st.bubble = h('div.tip-bubble', st.arrow, h('p', entry.params.text),
        h('button.btn.primary.tip-ok', {
          onClick: function () { audio('click'); entry.state.done = true; Tips.done(entry.params.id); },
        }, '知道了'));
      entry.el.appendChild(st.ring);
      entry.el.appendChild(st.bubble);
      placeTip(entry);
    },
    update: function (entry) { placeTip(entry); },
    unmount: function (entry) {
      var id = entry.params.id;
      if (Tips.cur === id) Tips.cur = null;
      // closed by the router within a moment of showing (not by the player): show it again later
      var m = G.App && G.App.meta;
      if (!entry.state.done && V.clock - (Tips.shownAt || 0) < 1.5 && m && m.tipsSeen) {
        delete m.tipsSeen[id];
        Tips.trigger(id);
      }
    },
  });

  // ------------------------------------------------------------------ public
  V.init = function (root) {
    build(root);
    if (G.Render) G.Render.init(E.canvas);
    measure();
  };
  V.measure = measure;
  V.refresh = function () { update(); };
  // A full-screen opaque overlay (title / new game / end: cls 'full') hides the whole view: skip the DOM sync and the
  // canvas draw (the title runs its own starfield) instead of burning GPU/battery on an invisible frame.
  function fullCover() {
    var st = G.UI && G.UI.stack;
    if (!st) return false;
    for (var i = 0; i < st.length; i++) if (/(^| )full( |$)/.test(st[i].def.cls || '')) return true;
    return false;
  }
  V.frame = function (dt) {
    V.clock += dt;
    if (fullCover()) return;
    update();
    Tips.update(dt);
    if (G.Render) G.Render.frame(dt);
  };
  V.resetSel = resetSel;
  V.tap = tap;
  V.chipStep = chipStep;
  V.canAim = canAim;
  V.aimMove = aimMove;
  V.aimEnd = aimEnd;
  V.aimCancel = aimCancel;
  V.toCanvas = toCanvas;
  V.el = E;

  G.View = V;
  G.Tips = Tips;
})();
