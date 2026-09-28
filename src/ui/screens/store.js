// Store overlay ('store'): tabs 补给 (fuel, missiles, hull repair) · 武器 (buy; sell cargo) · 船员 · 增强
// (buy; sell owned). Every button shows G.Store.canBuy's price and reason; purchases go through G.Store.
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  var TABS = [
    { id: 'supply', label: '补给' },
    { id: 'weapons', label: '武器' },
    { id: 'crew', label: '船员' },
    { id: 'aug', label: '增强' },
  ];

  function items(run, type) {
    var st = G.Store.current(run);
    return st ? st.items.filter(function (it) { return it.type === type; }) : [];
  }

  // Buy button: price + reason from canBuy (pure).
  function buyBtn(run, entry, key, qty, label) {
    var chk = G.Store.canBuy(run, key, qty);
    var it = G.Store.item(run, key);
    var soldOut = it && it.stock <= 0;
    return h('button.btn.buy' + (chk.ok ? '.primary' : ''), {
      'aria-disabled': chk.ok ? 'false' : 'true',
      title: chk.reason || '',
      onClick: function () { buy(entry, key, qty); },
    },
      h('span.buy-label', soldOut ? '已售罄' : (label || '购买')),
      soldOut ? null : h('span.buy-price', icon('scrap'), String(chk.price || (it ? it.price * (qty || 1) : 0)))
    );
  }

  // Plain-language next step for a newly acquired weapon (players new to the genre miss that weapons need
  // power, weapon-system capacity and a slot). where: 'slot' | 'cargo'. Also used by the reward screen.
  function weaponHint(run, where, id) {
    if (where === 'cargo') return '已放入货舱：货舱里的武器不能开火，到「飞船 → 武器」把它装进武器槽。';
    var p = run.player, slot = -1;
    for (var i = p.weapons.length - 1; i >= 0; i--) if (p.weapons[i].id === id && !p.weapons[i].on) { slot = i; break; }
    var why = slot >= 0 ? G.Ship.toggleBlock(p, slot) : '';
    var def = G.data.weapons[id];
    var ammo = def && def.missile && !run.res.missiles ? '另外它要消耗导弹，记得补充。' : '';
    if (why === 'capacity') return '已装入武器槽，但武器系统容量不够给它供能：到「飞船 → 系统」升级武器系统，或战斗中先关掉一把旧武器。' + ammo;
    if (why === 'reactor') return '已装入武器槽，但反应堆没有空余能量：战斗中先给其他系统减能量，再点这张武器卡通电。' + ammo;
    return '已装入武器槽：战斗中点武器卡通电，再选敌舰舱室就会开火。' + ammo;
  }
  if (G.Screens) G.Screens.weaponHint = weaponHint;

  function hasMissileWeapon(run) {
    var all = run.player.weapons.map(function (w) { return w.id; }).concat(run.cargo);
    return all.some(function (id) { return G.data.weapons[id] && G.data.weapons[id].missile > 0; });
  }

  function buy(entry, key, qty) {
    var run = S().run();
    var it = G.Store.item(run, key);
    var crewBefore = run.player.crew.length, cargoBefore = run.cargo.length;
    var res = G.Store.buy(run, key, qty);
    if (!res.ok) { S().deny(res.reason); return; }
    S().sfx('coin');
    if (it && it.type === 'crew' && run.player.crew.length > crewBefore) {
      var c = run.player.crew[run.player.crew.length - 1];
      G.UI.toast('新船员 ' + c.name + ' 登船', 'good');
    } else if (it && it.type === 'weapon') {
      G.UI.toast(it.name + ' ' + weaponHint(run, run.cargo.length > cargoBefore ? 'cargo' : 'slot', it.id), 'good', 5000);
    } else if (it && it.type === 'missiles' && !hasMissileWeapon(run)) {
      G.UI.toast('导弹是弹药：需要装备导弹类武器（如穿甲导弹）才能用上。', 'warn', 4500);
    } else if (it && it.type === 'augment') {
      G.UI.toast('已安装 ' + it.name, 'good');
    }
    S().sync();
    render(entry);
  }

  function sellBtn(label, price, onSell) {
    return h('button.btn.ghost.sell', { onClick: onSell }, h('span.buy-label', label), h('span.buy-price.good', '+', icon('scrap'), String(price)));
  }

  // ------------------------------------------------------------------ tabs
  function supplyTab(run, entry) {
    var out = [], p = run.player;
    items(run, 'fuel').concat(items(run, 'missiles')).forEach(function (it) {
      var have = run.res[it.type] || 0;
      var many = Math.max(1, Math.min(it.stock, 3));
      out.push(h('div.st-row',
        h('div.st-ico.res-' + it.type, icon(it.type === 'fuel' ? 'fuel' : 'missiles')),
        h('div.st-main',
          h('div.st-name', it.name, h('span.st-have', '持有 ' + have)),
          h('div.st-sub', '库存 ' + it.stock + ' · 单价 ' + it.price)
        ),
        h('div.st-btns',
          buyBtn(run, entry, it.key, 1, '+1'),
          it.stock > 1 ? buyBtn(run, entry, it.key, many, '+' + many) : null
        )
      ));
    });
    items(run, 'repair').forEach(function (it) {
      var missing = p.hullMax - p.hull;
      var afford = Math.floor((run.res.scrap || 0) / it.price);
      var full = Math.max(1, Math.min(missing, afford, it.stock));
      var frac = p.hull / p.hullMax;
      out.push(h('div.st-row.st-repair',
        h('div.st-ico.res-hull', icon('hull')),
        h('div.st-main',
          h('div.st-name', it.name, h('span.st-have', p.hull + '/' + p.hullMax)),
          h('div.hull-bar', h('i', { style: { width: Math.round(frac * 100) + '%',
            background: frac > 0.6 ? 'var(--hull-ok)' : frac > 0.3 ? 'var(--hull-mid)' : 'var(--hull-low)' } })),
          h('div.st-sub', '每点 ' + it.price + ' 废料')
        ),
        h('div.st-btns',
          buyBtn(run, entry, it.key, 1, '+1'),
          missing > 1 ? buyBtn(run, entry, it.key, full, full >= missing ? '修满' : '+' + full) : null
        )
      ));
    });
    return out;
  }

  function weaponsTab(run, entry) {
    var out = [], p = run.player;
    var list = items(run, 'weapon');
    out.push(h('div.st-note', '武器槽 ' + p.weapons.length + '/' + p.weaponSlots + ' · 货舱 ' + run.cargo.length + '/' + G.data.rules.cargoMax +
      '　买下的武器优先装上空武器槽（不供能），否则放入货舱。'));
    if (!list.length) out.push(h('div.st-empty', '没有武器出售。'));
    list.forEach(function (it) {
      var sold = it.stock <= 0;
      out.push(h('div.st-card.st-flex' + (sold ? '.sold' : ''),
        h('div.grow', S().weaponInfo(it.id, { compare: { run: run } })),
        buyBtn(run, entry, it.key, 1)
      ));
    });
    out.push(S().section('出售货舱武器'));
    if (!run.cargo.length) out.push(h('div.st-empty', '货舱是空的。可以在「飞船 › 武器」里把武器卸到货舱。'));
    run.cargo.forEach(function (id, i) {
      var d = G.data.weapons[id];
      out.push(h('div.st-row',
        h('div.st-ico', icon(S().TYPE_ICON[d.type] || 'weapons')),
        h('div.st-main', h('div.st-name', d.name), h('div.st-sub', S().TYPE_NAME[d.type] + ' · ' + d.power + ' 能量')),
        h('div.st-btns', sellBtn('出售', G.Store.sellPrice(id), function () {
          G.UI.confirm({ title: '出售 ' + d.name + '？', text: '可获得 ' + G.Store.sellPrice(id) + ' 废料。', ok: '出售' })
            .then(function (yes) {
              if (!yes) return;
              var r = G.Store.sell(S().run(), i);
              if (S().act(r, 'coin')) render(entry);
            });
        }))
      ));
    });
    return out;
  }

  function crewTab(run, entry) {
    var out = [], p = run.player;
    out.push(h('div.st-note', '船员 ' + p.crew.length + '/' + G.data.rules.maxCrew));
    var list = items(run, 'crew');
    if (!list.length) out.push(h('div.st-empty', '这里没有人想上船。'));
    list.forEach(function (it) {
      var r = G.data.crew.races[it.id];
      var sold = it.stock <= 0;
      out.push(h('div.st-card.st-flex' + (sold ? '.sold' : ''),
        h('div.st-crew.grow',
          S().crewDot(it.id),
          h('div.st-main',
            h('div.st-name', r ? r.name : it.name),
            h('div.st-sub', S().raceTraits(it.id)),
            r ? h('div.st-desc', r.desc) : null
          )
        ),
        buyBtn(run, entry, it.key, 1, '雇佣')
      ));
    });
    return out;
  }

  function augTab(run, entry) {
    var out = [], A = G.data.rules.augments;
    var list = items(run, 'augment');
    out.push(h('div.st-note', '增强模块 ' + run.augments.length + '/' + G.data.rules.augmentMax + ' · 被动生效，无需能量。'));
    if (!list.length) out.push(h('div.st-empty', '这家店没有增强模块。'));
    list.forEach(function (it) {
      var a = A[it.id];
      out.push(h('div.st-card.st-flex' + (it.stock <= 0 ? '.sold' : ''),
        h('div.st-crew.grow',
          h('div.st-ico.aug', icon('star')),
          h('div.st-main', h('div.st-name', a ? a.name : it.name), a ? h('div.st-desc', a.desc) : null)
        ),
        buyBtn(run, entry, it.key, 1)
      ));
    });
    out.push(S().section('已安装'));
    if (!run.augments.length) out.push(h('div.st-empty', '还没有安装增强模块。'));
    run.augments.forEach(function (id) {
      var a = A[id];
      out.push(h('div.st-row',
        h('div.st-ico.aug', icon('star')),
        h('div.st-main', h('div.st-name', a ? a.name : id), a ? h('div.st-sub', a.desc) : null),
        h('div.st-btns', sellBtn('出售', G.Store.sellPrice(id), function () {
          G.UI.confirm({ title: '出售 ' + (a ? a.name : id) + '？', text: '可获得 ' + G.Store.sellPrice(id) + ' 废料。', ok: '出售' })
            .then(function (yes) {
              if (!yes) return;
              var r = G.Store.sellAugment(S().run(), id);
              if (S().act(r, 'coin')) render(entry);
            });
        }))
      ));
    });
    return out;
  }

  var RENDER = { supply: supplyTab, weapons: weaponsTab, crew: crewTab, aug: augTab };

  function render(entry) {
    var run = S().run(), ui = entry.state.ui;
    if (!run || !G.Store.current(run)) { G.UI.close('store'); return; }
    var tab = entry.state.tab || 'supply';
    var top = ui.body.scrollTop;
    G.dom.clear(ui.res);
    ui.res.appendChild(S().resRow(run, ['scrap']));
    G.dom.clear(ui.tabs);
    var counts = {
      weapons: items(run, 'weapon').filter(function (i) { return i.stock > 0; }).length,
      crew: items(run, 'crew').filter(function (i) { return i.stock > 0; }).length,
      aug: items(run, 'augment').filter(function (i) { return i.stock > 0; }).length,
    };
    ui.tabs.appendChild(S().tabs(TABS.map(function (t) {
      return { id: t.id, label: t.label, badge: counts[t.id] || 0 };
    }), tab, function (id) { entry.state.tab = id; ui.body.scrollTop = 0; render(entry); }));
    G.dom.clear(ui.body);
    ui.body.appendChild(h('div.st-summary', S().resRow(run, ['hull', 'fuel', 'missiles'])));
    RENDER[tab](run, entry).forEach(function (el) { ui.body.appendChild(el); });
    if (entry.state.tab === entry.state.lastTab) ui.body.scrollTop = top;
    entry.state.lastTab = tab;
  }

  G.UI.register('store', {
    modal: true, cls: 'store-screen',
    mount: function (entry) {
      var ui = G.UI.sheet(entry, { title: '商店', cls: 'tall store-sheet' });
      var resHost = h('div.st-res');
      ui.head.insertBefore(resHost, ui.head.lastChild);
      var tabs = h('div.sheet-tabs');
      ui.sheet.insertBefore(tabs, ui.body);
      ui.foot.hidden = true;
      entry.state.ui = { res: resHost, tabs: tabs, body: ui.body };
      entry.state.tab = entry.params.tab || 'supply';
      render(entry);
    },
    refresh: function (entry) { render(entry); },
  });
})();
