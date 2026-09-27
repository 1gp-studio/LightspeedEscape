// Event overlay ('event'): bottom sheet with the node text and choices (blue choices with their note,
// cost-gated choices shown disabled), then the result text + fx chips + 继续. G.Events.cont routes to the
// next node / combat / hub; a store outcome opens the store.
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  function beaconTitle(run) {
    var b = G.Run.beacon(run);
    var K = G.data.text.kindNames || {};
    if (!b) return '信标';
    if (b.kind === 'boss') return K.boss || '叛军旗舰';
    if (G.Map.isOvertaken(run.sector, b)) return '叛军舰队';
    if (b.exit) return K.exit || '星区出口';
    return K[b.kind] || '信标';
  }

  function stateKey(run) {
    var e = run.event;
    return e ? e.id + '/' + e.node + '/' + (e.result ? 1 : 0) + '/' + run.res.scrap + '/' + run.res.fuel + '/' + run.res.missiles : '';
  }

  function choose(entry, idx) {
    var run = S().run();
    if (!run || !run.event) return;
    var res = G.Events.choose(run, idx);
    if (!res) { S().deny('无法选择'); return; }
    S().sfx(res.fx && res.fx.some(function (f) { return f.good && f.key === 'scrap'; }) ? 'coin' : 'click');
    // an empty outcome already closed the event (mode hub) → the router closes this sheet
    if (!run.event) { S().sync(); return; }
    S().sync();
    render(entry, true);
  }

  function next(entry) {
    var run = S().run();
    if (!run || !run.event || !run.event.result) return;
    var kind = run.event.result.next;
    var r = G.Events.cont(run);
    S().sfx(kind === 'combat' ? 'alarm' : 'click');
    S().sync();
    if (r && r.openStore && G.Run.hasStore(run)) G.UI.open('store');
    if (G.UI.isOpen('event')) render(entry, true);
  }

  function render(entry, force) {
    var run = S().run(), ui = entry.state.ui;
    if (!run || !run.event) return;
    var key = stateKey(run);
    if (!force && key === entry.state.key) return;
    entry.state.key = key;
    var n = G.Events.node(run);
    var res = run.event.result;

    ui.title.textContent = beaconTitle(run);
    G.dom.clear(ui.res);
    ui.res.appendChild(S().resRow(run, ['scrap', 'fuel', 'missiles']));
    G.dom.clear(ui.body);
    G.dom.clear(ui.foot);
    ui.body.scrollTop = 0;

    if (!res) {
      ui.body.appendChild(h('p.ev-text', n ? n.text : ''));
      var list = h('div.ev-choices');
      G.Events.choices(run).forEach(function (c, i) {
        list.appendChild(h('button.ev-choice' + (c.blue ? '.blue' : '') + (c.enabled ? '' : '.off'), {
          disabled: !c.enabled,
          onClick: function () { choose(entry, c.idx); },
        },
          h('span.ev-num', String(i + 1)),
          h('span.ev-ctext',
            c.blue && c.note ? h('span.ev-note', c.note) : null,
            c.text,
            !c.blue && c.note ? h('span.ev-cost', c.note) : null
          )
        ));
      });
      ui.body.appendChild(list);
      ui.foot.hidden = true;
    } else {
      if (res.text) ui.body.appendChild(h('p.ev-text.ev-result', res.text));
      var chips = S().fxChips(res.fx);
      if (chips) ui.body.appendChild(chips);
      var label = res.next === 'combat' ? '准备战斗' : res.next === 'store' ? '进入商店' : '继续';
      ui.foot.hidden = false;
      ui.foot.appendChild(h('button.btn' + (res.next === 'combat' ? '.danger' : '.primary'), {
        onClick: function () { next(entry); },
      }, res.next === 'combat' ? icon('weapons') : res.next === 'store' ? icon('store') : null, label));
    }
  }

  G.UI.register('event', {
    modal: true, cls: 'event-screen',
    mount: function (entry) {
      var ui = G.UI.sheet(entry, { title: '', close: false, cls: 'event-sheet' });
      var resHost = h('div.ev-res');
      ui.head.appendChild(resHost);
      entry.state.ui = { title: ui.head.querySelector('.sheet-title'), res: resHost, body: ui.body, foot: ui.foot };
      render(entry, true);
    },
    refresh: function (entry) { render(entry, false); },
  });
})();
