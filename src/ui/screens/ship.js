// Ship overlay ('ship'): tabs 系统 (system upgrades with level bars, reactor, augments) · 武器 (slots and cargo,
// equip / unequip) · 船员 (list with race traits, dismiss via G.UI.confirm). Read-only during combat.
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  var TABS = [{ id: 'systems', label: '系统' }, { id: 'weapons', label: '武器' }, { id: 'crew', label: '船员' }];

  function locked(run) { return run.mode === 'combat'; }

  function doAct(entry, res, sound) {
    if (S().act(res, sound)) render(entry);
  }

  function costBtn(label, cost, can, onClick, ro) {
    if (ro) return null;
    if (cost == null) return h('span.sh-max', '已满级');
    return h('button.btn.buy' + (can ? '.primary' : ''), { 'aria-disabled': can ? 'false' : 'true', onClick: onClick },
      h('span.buy-label', label), h('span.buy-price', icon('scrap'), String(cost)));
  }

  // ------------------------------------------------------------------ 系统
  function systemsTab(run, entry) {
    var out = [], p = run.player, ro = locked(run), scrap = run.res.scrap || 0;
    var defs = G.data.systems.defs;

    // reactor
    var rc = G.Run.reactorCost(run);
    var used = G.Ship.reactorUsed(p);
    out.push(h('div.sh-sys.reactor',
      h('div.sh-sys-ico', icon('power')),
      h('div.sh-sys-main',
        h('div.sh-sys-name', '反应堆', h('span.sh-lv', p.reactor + ' 格'), h('span.sh-sub', '已用 ' + used)),
        S().levelBar(p.reactor, Math.min(G.data.rules.reactorMax, Math.max(12, p.reactor + 2)), true),
        h('div.sh-sys-desc', '为护盾、引擎、氧气、医疗舱和武器提供能量。')
      ),
      costBtn('+1 格', rc, rc != null && scrap >= rc, function () {
        doAct(entry, G.Run.upgradeReactor(S().run()), 'power');
      }, ro)
    ));

    G.data.systems.order.forEach(function (id) {
      var s = p.systems[id], d = defs[id];
      if (!s || !d) return;
      var cost = G.Run.upgradeCost(run, id);
      var extra = [];
      if (id === 'shields') extra.push(Math.floor(s.level / 2) + ' 层护盾');
      if (s.damage) extra.push(h('span.danger', '受损 ' + s.damage));
      out.push(h('div.sh-sys',
        h('div.sh-sys-ico', icon(id)),
        h('div.sh-sys-main',
          h('div.sh-sys-name', d.name, h('span.sh-lv', 'Lv ' + s.level + '/' + d.maxLevel), extra.length ? h('span.sh-sub', extra) : null),
          S().levelBar(s.level, d.maxLevel, cost != null),
          h('div.sh-sys-desc', d.desc)
        ),
        costBtn('升级', cost, cost != null && scrap >= cost, function () {
          doAct(entry, G.Run.upgradeSystem(S().run(), id), 'power');
        }, ro)
      ));
    });

    // augments
    var A = G.data.rules.augments, max = G.data.rules.augmentMax;
    out.push(S().section('增强模块', h('span.sec-count', run.augments.length + '/' + max)));
    for (var i = 0; i < max; i++) {
      var aid = run.augments[i], a = aid && A[aid];
      out.push(a ? h('div.sh-aug', h('span.sh-aug-ico', icon('star')), h('div', h('b', a.name), h('div.sh-sys-desc', a.desc)))
        : h('div.sh-aug.empty', '空增强槽 · 可在商店购买'));
    }
    return out;
  }

  // ------------------------------------------------------------------ 武器
  function weaponsTab(run, entry) {
    var out = [], p = run.player, ro = locked(run);
    var cargoFull = run.cargo.length >= G.data.rules.cargoMax;
    var slotsFull = p.weapons.length >= p.weaponSlots;
    var wsys = p.systems.weapons;
    out.push(h('div.st-note', '武器系统容量 ' + (wsys ? wsys.level : 0) + ' 格 · 已供能 ' + (wsys ? wsys.power : 0) +
      (ro ? '　战斗中无法调整武器。' : '　装上的武器默认不供能，回到战斗后点武器卡片即可供能。')));
    out.push(S().section('武器槽', h('span.sec-count', p.weapons.length + '/' + p.weaponSlots)));
    for (var i = 0; i < p.weaponSlots; i++) {
      (function (slot) {
        var w = p.weapons[slot];
        if (!w) { out.push(h('div.sh-slot.empty', h('span.sh-slot-n', String(slot + 1)), '空武器槽')); return; }
        out.push(h('div.sh-slot',
          h('span.sh-slot-n' + (w.on ? '.on' : ''), String(slot + 1)),
          h('div.grow', S().weaponInfo(w.id, { desc: false })),
          ro ? null : h('button.btn.ghost.sh-mini', {
            'aria-disabled': cargoFull ? 'true' : 'false',
            onClick: function () { doAct(entry, G.Run.unequip(S().run(), slot), 'click'); },
          }, '卸下')
        ));
      })(i);
    }
    out.push(S().section('货舱', h('span.sec-count', run.cargo.length + '/' + G.data.rules.cargoMax)));
    if (!run.cargo.length) out.push(h('div.st-empty', '货舱是空的。'));
    run.cargo.forEach(function (id, idx) {
      out.push(h('div.sh-slot.cargo',
        h('div.grow', S().weaponInfo(id, { desc: false })),
        ro ? null : h('button.btn.sh-mini' + (slotsFull ? '' : '.primary'), {
          'aria-disabled': slotsFull ? 'true' : 'false',
          onClick: function () { doAct(entry, G.Run.equip(S().run(), idx), 'power'); },
        }, '装备')
      ));
    });
    return out;
  }

  // ------------------------------------------------------------------ 船员
  function crewTab(run, entry) {
    var out = [], p = run.player, ro = locked(run);
    out.push(h('div.st-note', '船员 ' + p.crew.length + '/' + G.data.rules.maxCrew +
      '　站在护盾、引擎、武器、驾驶舱里的船员会操作该系统并提供加成。'));
    p.crew.forEach(function (c) {
      var r = G.data.crew.races[c.race];
      var room = c.station != null ? p.rooms[c.station] : null;
      var post = room && room.sys ? G.data.systems.defs[room.sys].name : '待命';
      var frac = c.hpMax ? c.hp / c.hpMax : 1;
      out.push(h('div.sh-crew',
        S().crewDot(c.race, c.name.slice(0, 1)),
        h('div.grow',
          h('div.sh-crew-name', c.name, h('span.sh-sub', (r ? r.name : c.race) + ' · 岗位 ' + post)),
          h('div.hull-bar.thin', h('i', { style: { width: Math.round(frac * 100) + '%',
            background: frac > 0.5 ? 'var(--hull-ok)' : frac > 0.25 ? 'var(--hull-mid)' : 'var(--hull-low)' } })),
          h('div.sh-sys-desc', Math.ceil(c.hp) + '/' + c.hpMax + ' · ' + S().raceTraits(c.race))
        ),
        ro ? null : h('button.btn.ghost.sh-mini.dismiss', {
          'aria-disabled': p.crew.length <= 1 ? 'true' : 'false',
          onClick: function () {
            if (p.crew.length <= 1) { S().deny('不能解雇最后一名船员'); return; }
            G.UI.confirm({
              title: '解雇 ' + c.name + '？', danger: true, ok: '解雇', cancel: '留下',
              text: c.name + '（' + (r ? r.name : c.race) + '）会在这个信标离船，不会再回来。',
            }).then(function (yes) {
              if (!yes) return;
              doAct(entry, G.Run.dismissCrew(S().run(), c.id), 'click');
            });
          },
        }, '解雇')
      ));
    });
    return out;
  }

  var RENDER = { systems: systemsTab, weapons: weaponsTab, crew: crewTab };

  function render(entry) {
    var run = S().run(), ui = entry.state.ui;
    if (!run) { G.UI.close('ship'); return; }
    var tab = entry.state.tab || 'systems';
    var top = ui.body.scrollTop;
    ui.title.textContent = '飞船 · ' + run.player.name;
    G.dom.clear(ui.res);
    ui.res.appendChild(S().resRow(run, ['scrap']));
    G.dom.clear(ui.tabs);
    ui.tabs.appendChild(S().tabs(TABS, tab, function (id) { entry.state.tab = id; ui.body.scrollTop = 0; render(entry); }));
    G.dom.clear(ui.body);
    if (locked(run)) ui.body.appendChild(h('div.sh-lock', icon('warning'), '战斗中只能查看，无法升级或调整。'));
    RENDER[tab](run, entry).forEach(function (el) { ui.body.appendChild(el); });
    if (tab === entry.state.lastTab) ui.body.scrollTop = top;
    entry.state.lastTab = tab;
  }

  G.UI.register('ship', {
    modal: true, cls: 'ship-screen',
    mount: function (entry) {
      var ui = G.UI.sheet(entry, { title: '飞船', cls: 'tall ship-sheet' });
      var resHost = h('div.st-res');
      ui.head.insertBefore(resHost, ui.head.lastChild);
      var tabs = h('div.sheet-tabs');
      ui.sheet.insertBefore(tabs, ui.body);
      ui.foot.hidden = true;
      entry.state.ui = { title: ui.head.querySelector('.sheet-title'), res: resHost, tabs: tabs, body: ui.body };
      entry.state.tab = entry.params.tab || 'systems';
      render(entry);
    },
    refresh: function (entry) { render(entry); },
  });
})();
