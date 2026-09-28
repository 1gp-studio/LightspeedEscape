// Combat outcome overlays: 'reward' (胜利 / 敌舰投降 / 敌舰船员全灭 + reward chips + acquired weapon/crew;
// 继续 → G.Run.claimReward) and 'offer' (敌舰请求投降 dialog → G.Combat.answerOffer).
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  var TITLE = { win: '胜利', surrender: '敌舰投降', derelict: '敌舰船员全灭' };
  var KICKER = { win: 'HOSTILE DESTROYED', surrender: 'SURRENDER ACCEPTED', derelict: 'CREW ELIMINATED' };

  // ------------------------------------------------------------------ reward
  G.UI.register('reward', {
    modal: true, cls: 'center reward-screen',
    mount: function (entry) {
      var run = S().run();
      var rw = run && run.reward;
      if (!rw) { G.UI.close('reward'); return; }
      var names = G.data.text.resultNames || {};
      var extras = [];
      // weaponWhere (G.Run.rollReward): 'slot' | 'cargo' | 'scrap'. A scrapped weapon only shows as its fx chip.
      // Older saves lack it: a weapon fx chip with amount 0 means it was scrapped.
      var where = rw.weaponWhere;
      if (!where) {
        var wfx = (rw.fx || []).filter(function (f) { return f.key === 'weapon'; })[0];
        where = wfx && wfx.amount === 0 ? 'scrap' : '';
      }
      if (rw.weapon && G.data.weapons[rw.weapon] && where !== 'scrap') {
        var wl = where === 'cargo' ? '新武器 · 已放入货舱' : where === 'slot' ? '新武器 · 已装入武器槽（未供能）' : '新武器';
        var hint = (where === 'slot' || where === 'cargo') && G.Screens.weaponHint ? G.Screens.weaponHint(run, where, rw.weapon) : '';
        extras.push(h('div.rw-item', h('div.rw-item-lbl', wl), S().weaponInfo(rw.weapon), hint ? h('div.rw-hint', hint) : null));
      }
      if (rw.crew) {
        var r = G.data.crew.races[rw.crew.race];
        extras.push(h('div.rw-item', h('div.rw-item-lbl', '新船员加入'),
          h('div.st-crew', S().crewDot(rw.crew.race, rw.crew.name.slice(0, 1)),
            h('div.st-main', h('div.st-name', rw.crew.name, h('span.st-have', r ? r.name : rw.crew.race)),
              h('div.st-sub', S().raceTraits(rw.crew.race))))));
      }
      var chips = S().fxChips(rw.fx);
      entry.el.appendChild(h('div.dialog.rw-dialog', h('div.panel.rw-panel',
        h('div.rw-kicker', KICKER[rw.result] || 'COMBAT OVER'),
        h('h3.rw-title', TITLE[rw.result] || names[rw.result] || '战斗结束'),
        rw.text ? h('p.rw-text', rw.text) : null,
        chips || h('p.dim', '什么也没找到。'),
        extras,
        h('button.btn.primary.big', {
          onClick: function () {
            var run2 = S().run();
            if (!run2 || !G.Run.claimReward(run2)) return;
            S().sfx('click');
            S().sync();
          },
        }, '继续')
      )));
      S().sfx('coin');
    },
  });

  // ------------------------------------------------------------------ offer
  function answer(accept) {
    var run = S().run();
    if (!run || !run.combat || !run.combat.offer) return;
    G.Combat.answerOffer(run, accept);
    // Resolve an accepted surrender at once: finishCombat only runs inside G.Run.step, which is blocked
    // while the game is paused (resume / crisis pause / app switch), so the reward would otherwise wait.
    if (accept && run.combat && run.combat.result) G.Run.finishCombat(run);
    S().sfx(accept ? 'coin' : 'click');
    S().sync();
  }

  G.UI.register('offer', {
    modal: true, cls: 'center offer-screen',
    mount: function (entry) {
      var run = S().run();
      var o = run && run.combat && run.combat.offer;
      if (!o) { G.UI.close('offer'); return; }
      var fx = [];
      if (o.scrap) fx.push({ key: 'scrap', label: '+' + o.scrap + ' 废料', good: true });
      if (o.fuel) fx.push({ key: 'fuel', label: '+' + o.fuel + ' 燃料', good: true });
      if (o.missiles) fx.push({ key: 'missiles', label: '+' + o.missiles + ' 导弹', good: true });
      var e = run.combat.enemy;
      entry.el.appendChild(h('div.dialog.rw-dialog', h('div.panel.rw-panel.offer',
        h('div.rw-kicker', 'INCOMING TRANSMISSION'),
        h('h3.rw-title', '敌舰请求投降'),
        h('div.offer-from', icon('ship'), e ? e.name : '敌舰',
          e ? h('span.dim', '船体 ' + Math.max(0, Math.ceil(e.hull)) + '/' + e.hullMax) : null),
        h('p.rw-text', o.text || '敌舰愿意交出物资换取活路。'),
        S().fxChips(fx) || h('p.dim', '对方没什么可给的。'),
        h('div.row.offer-btns',
          h('button.btn.ghost', { onClick: function () { answer(false); } }, '拒绝，继续战斗'),
          h('button.btn.primary', { onClick: function () { answer(true); } }, icon('check'), '接受')
        )
      )));
      S().sfx('alarm');
    },
    refresh: function (entry) {
      var run = S().run();
      if (!run || !run.combat || !run.combat.offer) G.UI.close('offer');
    },
  });
})();
