// Sector choice overlay ('sector'): two cards for run.sectorChoices (type name, color, desc, flavor,
// fleet speed / loot / store hints) → G.Run.chooseSector.
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  function level(v, lo, hi, words) { return v <= lo ? words[0] : v >= hi ? words[2] : words[1]; }

  function share(type, kind) {
    var k = type.kinds || {}, tot = 0;
    Object.keys(k).forEach(function (x) { tot += k[x]; });
    return tot ? (k[kind] || 0) / tot : 0;
  }

  function card(run, typeId, idx) {
    var t = G.data.sectors.types[typeId];
    if (!t) return null;
    var flavor = G.data.text.sectorFlavor && G.data.text.sectorFlavor[typeId];
    var hints = [
      h('span.chip', icon('warning'), '舰队追击 ' + level(t.fleetSpeed, 0.65, 0.85, ['慢', '中', '快'])),
      h('span.chip', icon('weapons'), '战斗 ' + level(share(t, 'combat'), 0.28, 0.4, ['少', '中', '多'])),
      h('span.chip', icon('scrap'), '战利品 ' + level(t.rewardMult, 0.95, 1.1, ['少', '中', '多'])),
      h('span.chip', icon('store'), '商店 ' + level(share(t, 'store'), 0.085, 0.11, ['少', '中', '多'])),
    ];
    if (t.hidesIcons) hints.push(h('span.chip', icon('help'), '扫描失灵'));
    return h('button.sec-card', {
      style: { '--sec': t.accent || '#58c7d6', '--sec-bg': t.color || '#1d5566' },
      onClick: function () {
        var r = S().run();
        if (!r || r.mode !== 'sectorSelect') return;
        var res = G.Run.chooseSector(r, idx);
        if (!res.ok) { S().deny(res.reason); return; }
        S().sfx('jump');
        S().sync();
      },
    },
      h('div.sec-card-top',
        h('span.sec-card-idx', '第 ' + (run.sectorIndex + 2) + ' 星区'),
        h('span.grow'),
        h('span.sec-card-go', icon('jump'))
      ),
      h('div.sec-card-name', t.name),
      flavor ? h('div.sec-card-flavor', flavor) : null,
      h('div.sec-card-desc', t.desc),
      h('div.sec-card-hints', hints)
    );
  }

  G.UI.register('sector', {
    modal: true, cls: 'sector-screen',
    mount: function (entry) {
      var run = S().run();
      if (!run || !run.sectorChoices) { G.UI.close('sector'); return; }
      var ui = G.UI.sheet(entry, { title: '选择下一个星区', close: false, cls: 'sector-sheet' });
      ui.foot.hidden = true;
      ui.body.appendChild(h('p.sec-intro', '跃迁引擎已校准。叛军舰队被甩在了身后——暂时。下一站去哪里？'));
      run.sectorChoices.forEach(function (id, i) { ui.body.appendChild(card(run, id, i)); });
      ui.body.appendChild(h('div.sec-progress', progress(run)));
    },
  });

  function progress(run) {
    var out = [];
    for (var i = 0; i < G.CFG.SECTORS; i++) {
      out.push(h('i' + (i <= run.sectorIndex ? '.done' : i === run.sectorIndex + 1 ? '.next' : '') + (i === G.CFG.SECTORS - 1 ? '.final' : '')));
    }
    return out;
  }
})();
