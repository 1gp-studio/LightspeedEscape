// Sector map overlay ('map'): vertical beacon graph (start at the bottom, exit at the top), rebel fleet zone,
// beacon detail + 跃迁, 前往下一星区 at the exit, 等待救援 when stranded. Opened from the hub (星图) or from
// combat once FTL is charged (flee mode: title 紧急跃迁; closing returns to the fight).
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  var PAD_X = 30, PAD_Y = 34, ROW_H = 64, R_B = 10, PICK_R = 34;
  var W = 300;   // viewBox width; render() fits it to the container's aspect ratio (260..420)
  var FS = 12;   // label font size in viewBox units, so labels render >= 12.5px whatever the map scale

  // ------------------------------------------------------------------ geometry
  function geo(sector) {
    var H = PAD_Y * 2 + (sector.rows - 1) * ROW_H;
    return {
      H: H,
      x: function (b) { return PAD_X + b.x * (W - PAD_X * 2); },
      y: function (row) { return H - PAD_Y - row * ROW_H; },
    };
  }

  // Inline SVG paths of a G.dom.ICONS glyph, centered at (cx, cy) with size s.
  function glyph(name, cx, cy, s, color) {
    var parts = G.dom.ICONS[name];
    if (!parts) return '';
    var k = s / 24;
    var body = parts.map(function (p) {
      var o = p.o != null ? ' opacity="' + p.o + '"' : '';
      if (p.sw) return '<path d="' + p.d + '" fill="none" stroke="' + (p.fill || color) + '" stroke-width="' + p.sw +
        '" stroke-linecap="round" stroke-linejoin="round"' + o + '/>';
      return '<path d="' + p.d + '" fill="' + (p.fill || color) + '"' + o + '/>';
    }).join('');
    return '<g transform="translate(' + (cx - s / 2) + ' ' + (cy - s / 2) + ') scale(' + k + ')">' + body + '</g>';
  }

  // Pixel shapes (whole viewBox units so crispEdges lands them on the grid).
  function sq(cls, cx, cy, hs) {
    return '<rect class="' + cls + '" x="' + Math.round(cx - hs) + '" y="' + Math.round(cy - hs) + '" width="' + hs * 2 + '" height="' + hs * 2 + '"/>';
  }
  function diamond(cls, cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    return '<polygon class="' + cls + '" points="' + cx + ',' + (cy - r) + ' ' + (cx + r) + ',' + cy + ' ' + cx + ',' + (cy + r) + ' ' + (cx - r) + ',' + cy + '"/>';
  }

  // What the player knows about a beacon.
  function known(run, b) {
    var hidden = G.Map.iconsHidden(run);
    var seen = b.visited || !hidden;
    return {
      boss: b.kind === 'boss',
      exit: !!b.exit,
      store: (b.kind === 'store' && seen) || (b.visited && !!b.store),
      distress: b.kind === 'distress' && seen && !b.visited,
    };
  }

  function beaconName(run, b) {
    var K = G.data.text.kindNames || {};
    var k = known(run, b);
    if (k.boss) return K.boss || '叛军旗舰';
    if (k.exit) return K.exit || '星区出口';
    if (k.store) return K.store || '商店';
    if (k.distress) return K.distress || '求救信号';
    if (b.kind === 'start') return K.start || '起点';
    if (b.visited) return (K[b.kind] || '信标') + ' · 已探索';
    return '未知信标';
  }

  // ------------------------------------------------------------------ svg
  function buildSvg(run, entry, wrap) {
    var s = run.sector, g = geo(s), st = entry.state;
    var flee = run.mode === 'combat';
    var reach = G.Map.reachable(run);
    var nb = G.Map.neighbors(s, run.at);
    var type = G.Map.typeOf(s);
    var diff = G.data.rules.difficulty[run.difficulty] || G.data.rules.difficulty.normal;
    var speed = type.fleetSpeed * diff.fleetMult;
    var out = [];
    out.push('<svg class="map-svg" viewBox="0 0 ' + W + ' ' + g.H + '" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" role="img" aria-label="星图">');
    // Pixel fills: a stair-stepped diagonal stripe for the overtaken zone and a 2x2 checker dither for its rim.
    out.push('<defs>' +
      '<pattern id="mapFleetStripe" width="8" height="8" patternUnits="userSpaceOnUse">' +
      '<rect width="2" height="2" x="0" y="6"/><rect width="2" height="2" x="2" y="4"/><rect width="2" height="2" x="4" y="2"/><rect width="2" height="2" x="6" y="0"/></pattern>' +
      '<pattern id="mapFleetDither" width="4" height="4" patternUnits="userSpaceOnUse">' +
      '<rect width="2" height="2" x="0" y="0"/><rect width="2" height="2" x="2" y="2"/></pattern>' +
      '</defs>');

    // row guides
    for (var r = 0; r < s.rows; r++) {
      out.push('<line class="map-row" x1="-300" x2="' + (W + 300) + '" y1="' + g.y(r) + '" y2="' + g.y(r) + '"/>');
    }

    // rebel fleet zone (rows <= fleet are overtaken) + where it will be after the next jump
    var top = g.y(s.fleet) - R_B - 4;
    if (top < g.H) {
      var yTop = Math.max(0, top);
      out.push('<rect class="map-fleet" x="-300" y="' + yTop + '" width="' + (W + 600) + '" height="' + (g.H - yTop + 300) + '"/>');
      out.push('<rect class="map-fleet-stripe" x="-296" y="' + (yTop + 12) + '" width="' + (W + 600) + '" height="' + Math.max(0, g.H - yTop + 288) + '" fill="url(#mapFleetStripe)"/>');
      out.push('<rect class="map-fleet-dither" x="-300" y="' + yTop + '" width="' + (W + 600) + '" height="12" fill="url(#mapFleetDither)"/>');
      out.push('<line class="map-fleet-edge" x1="-300" x2="' + (W + 300) + '" y1="' + yTop + '" y2="' + yTop + '"/>');
      if (yTop > FS + 4) out.push('<text class="map-fleet-lbl" font-size="' + FS + '" x="' + (W - 6) + '" y="' + (yTop - 4) + '" text-anchor="end">叛军舰队</text>');
    }
    var nextTop = g.y(s.fleet + speed) - R_B - 4;
    if (nextTop > 0 && nextTop < g.H) {
      out.push('<line class="map-fleet-next" x1="-300" x2="' + (W + 300) + '" y1="' + nextTop + '" y2="' + nextTop + '"/>');
      out.push('<text class="map-fleet-next-lbl" font-size="' + FS + '" x="6" y="' + (nextTop - 4) + '">下一跳后</text>');
    }

    // edges (undirected)
    s.edges.forEach(function (e) {
      var a = s.beacons[e[0]], b = s.beacons[e[1]];
      var fromHere = (e[0] === run.at && reach.indexOf(e[1]) >= 0) || (e[1] === run.at && reach.indexOf(e[0]) >= 0);
      var sel = st.sel != null && ((e[0] === run.at && e[1] === st.sel) || (e[1] === run.at && e[0] === st.sel));
      var cls = sel ? 'map-edge sel' : fromHere ? 'map-edge live' : (a.visited && b.visited ? 'map-edge seen' : 'map-edge');
      out.push('<line class="' + cls + '" x1="' + g.x(a) + '" y1="' + g.y(a.row) + '" x2="' + g.x(b) + '" y2="' + g.y(b.row) + '"/>');
    });

    // beacons
    s.beacons.forEach(function (b) {
      var x = g.x(b), y = g.y(b.row), k = known(run, b);
      var here = b.id === run.at, canGo = reach.indexOf(b.id) >= 0, adj = nb.indexOf(b.id) >= 0;
      var over = G.Map.isOvertaken(s, b);
      var cls = ['map-b'];
      if (b.visited) cls.push('visited');
      if (here) cls.push('here');
      if (canGo) cls.push('reach');
      else if (adj) cls.push('adj');
      if (over) cls.push('over');
      else if (!here && !k.boss && G.Map.fleetEta(run, b.id) <= 1) cls.push('soon');   // overtaken after the next jump
      if (k.boss) cls.push('boss');
      if (k.exit) cls.push('exit');
      if (st.sel === b.id) cls.push('sel');
      out.push('<g class="' + cls.join(' ') + '" data-id="' + b.id + '">');
      if (here) {
        out.push(sq('map-here-glow', x, y, R_B + 8));
        out.push(sq('map-here-glow g2', x, y, R_B + 13));
      }
      if (canGo) out.push(sq('map-reach-ring', x, y, R_B + 5));
      if (st.sel === b.id) out.push(sq('map-sel-ring', x, y, R_B + 7));
      // square pixel beacons; the exit and the flagship are diamonds
      if (k.exit || k.boss) out.push(diamond('map-dot', x, y, R_B + 3));
      else out.push(sq('map-dot', x, y, R_B - 1));
      var gl = null, col = '#e6ecf8';
      if (here) { gl = 'ship'; col = '#1d1405'; }
      else if (k.boss) { gl = 'skull'; col = '#ff5d5d'; }
      else if (k.store) { gl = 'store'; col = '#f3c64d'; }
      else if (k.distress) { gl = 'warning'; col = '#6ec1ff'; }
      else if (k.exit) { gl = 'jump'; col = '#ffb547'; }
      if (gl) out.push(glyph(gl, x, y, 12, col));
      else if (b.visited) out.push(glyph('check', x, y, 10, '#9aa3b8'));
      var label = k.boss ? '旗舰' : k.exit ? '出口' : (k.store && !here ? '商店' : '');
      if (label) out.push('<text class="map-lbl' + (k.boss ? ' boss' : '') + '" font-size="' + FS + '" x="' + x + '" y="' + (y - R_B - 8) + '" text-anchor="middle">' + label + '</text>');
      out.push('</g>');
    });
    out.push('</svg>');
    wrap.className = 'map-canvas' + (flee ? ' flee' : '');
    wrap.innerHTML = out.join('');
  }

  // Tap anywhere on the map: the nearest beacon within PICK_R viewBox units (a generous touch target).
  function onMapClick(entry, ev) {
    var run = S().run(), st = entry.state;
    var svg = entry.state.ui.map.querySelector('svg');
    if (!run || !svg || !svg.getScreenCTM) return;
    var m = svg.getScreenCTM();
    if (!m) return;
    var pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    var p = pt.matrixTransform(m.inverse());
    var g = geo(run.sector), best = -1, bd = PICK_R * PICK_R;
    run.sector.beacons.forEach(function (b) {
      var dx = g.x(b) - p.x, dy = g.y(b.row) - p.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = b.id; }
    });
    if (best < 0) return;
    S().sfx('click');
    st.sel = best === run.at || st.sel === best ? null : best;
    render(entry);
  }

  // ------------------------------------------------------------------ detail + actions
  function doJump(entry, id) {
    var run = S().run();
    var res = G.Run.jump(run, id);
    if (!res.ok) { S().deny(res.reason); return; }
    S().sfx('jump');
    G.UI.close('map');
    S().sync();
  }

  // The fleet will be there on arrival (eta <= 1): elite + fleet barrage. Ask once before jumping in.
  function jumpIntoFleet(entry, id) {
    G.UI.confirm({
      title: '跃入叛军舰队？', danger: true, ok: '仍然跃迁', cancel: '再想想',
      text: '抵达时叛军舰队已经到了：会遭遇精英战舰，还要承受舰队的持续炮击。',
    }).then(function (yes) {
      var run = S().run();
      if (!yes || !run || !G.UI.isOpen('map')) return;
      doJump(entry, id);
    });
  }

  function detail(run, entry) {
    var s = run.sector, st = entry.state;
    if (st.sel == null || !s.beacons[st.sel]) {
      var hint = run.mode === 'combat' ? '点亮起的信标，选择紧急跃迁的目的地。' : '点击相连的信标查看详情并跃迁。';
      return h('div.map-detail.empty', hint);
    }
    var b = s.beacons[st.sel];
    var chk = G.Run.canJump(run, b.id);
    var eta = G.Map.fleetEta(run, b.id);
    var left = G.Map.jumpsLeft(s, b.id);
    var fleet = b.kind !== 'boss' && eta <= 1;
    var info = [];
    if (b.kind !== 'boss') {
      if (fleet) info.push(h('span.chip.bad', icon('warning'), eta === 0 ? '已被舰队占领' : '抵达即遇舰队'));
      else info.push(h('span.chip', icon('warning'), '舰队 ' + eta + ' 跳后到达'));
    }
    if (left > 0) info.push(h('span.chip', icon('jump'), '距出口 ' + left + ' 跳'));
    if (b.visited && beaconName(run, b).indexOf('已探索') < 0) info.push(h('span.chip.good', icon('check'), '已探索'));
    var danger = fleet && chk.ok;
    // Fixed-height box: the reason for an unreachable beacon replaces the chips, so the map never reflows.
    return h('div.map-detail',
      h('div.map-detail-main',
        h('div.map-detail-name', beaconName(run, b)),
        !chk.ok ? h('div.map-detail-why', icon('warning'), chk.reason) : h('div.map-detail-info', info)
      ),
      h('button.btn.map-jump' + (danger ? '.danger.fleet' : '.primary'), {
        disabled: !chk.ok,
        onClick: function () { if (danger) jumpIntoFleet(entry, b.id); else doJump(entry, b.id); },
      }, icon(danger ? 'warning' : 'jump'), danger ? h('span.map-jump-txt', '跃迁', h('small', '遭遇舰队')) : '跃迁')
    );
  }

  function footButtons(run) {
    var out = [];
    if (run.mode !== 'hub') return out;
    if (G.Run.atExit(run) && !G.Run.isFinalSector(run)) {
      out.push(h('button.btn.primary.map-next', {
        onClick: function () {
          var res = G.Run.leaveSector(run);
          if (!res.ok) { S().deny(res.reason); return; }
          S().sfx('jump');
          G.UI.close('map');
          S().sync();
        },
      }, icon('jump'), '前往下一星区'));
    }
    if (G.Run.isStranded(run)) {
      out.push(h('button.btn.danger', {
        onClick: function () {
          G.UI.confirm({
            title: '原地等待救援？', ok: '等待', cancel: '再想想',
            text: '燃料已经耗尽。叛军舰队会继续逼近，也许会有路过的船只伸出援手……',
          }).then(function (yes) {
            if (!yes) return;
            var r = S().run();
            if (!r || !G.Run.isStranded(r)) return;
            var res = G.Run.wait(r);
            if (!res.ok) { S().deny(res.reason); return; }
            G.UI.close('map');
            S().sync();
          });
        },
      }, icon('fuel'), '等待救援'));
    }
    return out;
  }

  function render(entry) {
    var run = S().run(), ui = entry.state.ui;
    if (!run || !run.sector) return;
    var s = run.sector, flee = run.mode === 'combat';
    var st = entry.state;
    if (st.sel != null && (!s.beacons[st.sel] || st.sel === run.at)) st.sel = null;
    var type = G.Map.typeOf(s);

    ui.title.textContent = flee ? '紧急跃迁' : s.name;
    G.dom.clear(ui.body);
    G.dom.clear(ui.foot);

    var etaExit = G.Map.fleetEta(run, s.exit);
    // Final sector: the exit is the flagship, which the fleet does not block — warn about the fleet catching you instead.
    var final = G.Run.isFinalSector(run);
    var etaHere = final ? G.Map.fleetEta(run, run.at) : 0;
    var strip = h('div.map-strip',
      flee ? h('span.map-flee-note', icon('warning'), '选择目的地 · 关闭星图返回战斗')
        : h('span.map-sector', { style: { '--sec': type.accent || '#58c7d6' } },
          '星区 ' + (s.index + 1) + '/' + G.CFG.SECTORS, h('b', final ? '最终星区' : type.name)),
      h('span.grow'),
      S().resChip('fuel', run.res.fuel)
    );
    var fleetLine = h('div.map-fleetline' + ((final ? etaHere <= 1 : etaExit <= 2) ? '.urgent' : ''),
      icon('warning'),
      final ? '旗舰就在前方' + (etaHere > 0 ? ' · 舰队 ' + etaHere + ' 跳后追上你' : ' · 舰队已追上你')
        : etaExit === 0 ? '叛军舰队已封锁出口' : '舰队 ' + etaExit + ' 跳后抵达出口',
      h('span.grow'),
      G.Run.isStranded(run) ? h('span.danger', '燃料耗尽') : null
    );
    ui.body.appendChild(strip);
    ui.body.appendChild(fleetLine);
    ui.body.appendChild(ui.map);
    ui.body.appendChild(h('div.map-legend',
      h('span', h('i.lg-here'), '当前'),
      h('span', h('i.lg-reach'), '可跃迁'),
      h('span', h('i.lg-new'), '未探索'),
      h('span', h('i.lg-seen', icon('check')), '已探索'),
      h('span', h('i.lg-fleet'), '舰队区域'),
      h('span', icon('warning', 'lg-distress'), '求救'),
      h('span', icon('store', 'lg-store'), '商店')
    ));

    // fit the viewBox width to the container so the map fills it (then circles stay round via 'meet')
    var box = ui.map.getBoundingClientRect();
    var H = geo(s).H;
    W = box.width > 0 && box.height > 0 ? Math.round(G.U.clamp(H * box.width / box.height, 260, 420)) : 300;
    var scale = box.height > 0 ? box.height / H : 1;
    FS = Math.max(11, Math.ceil(13 / Math.max(0.3, Math.min(scale, W > 0 && box.width > 0 ? box.width / W : scale))));
    buildSvg(run, entry, ui.map);
    ui.foot.appendChild(detail(run, entry));
    var fb = footButtons(run);
    if (fb.length) ui.foot.appendChild(h('div.map-actions', fb));
  }

  G.UI.register('map', {
    modal: true, cls: 'map-screen',
    mount: function (entry) {
      var run = S().run();
      if (!run) { G.UI.close('map'); return; }
      var ui = G.UI.sheet(entry, { title: '', cls: 'map-sheet' });
      var map = h('div.map-canvas', { onClick: function (ev) { onMapClick(entry, ev); } });
      entry.state.ui = { title: ui.head.querySelector('.sheet-title'), body: ui.body, foot: ui.foot, map: map };
      ui.foot.classList.add('map-foot');
      render(entry);
    },
    refresh: function (entry) {
      var run = S().run();
      if (!run || (run.mode !== 'hub' && run.mode !== 'combat') ||
          (run.mode === 'combat' && !G.Combat.canFlee(run))) { G.UI.close('map'); return; }
      render(entry);
    },
  });
})();
