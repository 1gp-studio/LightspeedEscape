// End-of-run overlay ('end'): victory or defeat, the reason text (G.data.text.endTexts via run.end.text),
// run stats, 再来一局 / 返回标题.
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  var REASON = { hull: '船体被摧毁', crew: '船员全部阵亡', flagship: '叛军旗舰已被击毁' };

  G.UI.register('end', {
    modal: true, cls: 'full end-screen',
    mount: function (entry) {
      var run = S().run();
      if (!run || !run.end) { G.UI.close('end'); return; }
      var win = !!run.end.win, st = run.stats || {};
      var endText = run.end.text || S().text('endTexts', run.end.reason, '');
      var D = G.data.rules.difficulty[run.difficulty] || G.data.rules.difficulty.normal;
      var ship = G.data.ships[run.shipId];
      entry.el.classList.add(win ? 'win' : 'lose');

      function stat(label, value) { return h('div.end-stat', h('b', String(value)), h('span', label)); }

      var emblem = h('div.title-emblem.end-emblem', { 'aria-hidden': 'true' }, h('i.te-bracket'));
      entry.el.appendChild(h('div.end-wrap',
        h('div.end-kicker', win ? 'MISSION COMPLETE' : 'SIGNAL LOST'),
        h('h1.end-title', win ? '胜利' : '航程终结'),
        h('div.end-reason', icon(win ? 'star' : 'skull'), REASON[run.end.reason] || ''),
        endText ? h('p.end-text', endText) : null,
        h('div.end-meta', (ship ? ship.name : '') + ' · ' + D.label + ' · 抵达第 ' + (run.sectorIndex + 1) + '/' + G.CFG.SECTORS + ' 星区'),
        h('div.end-stats',
          stat('探索信标', st.beacons || 0),
          stat('跃迁', st.jumps || 0),
          stat('击毁敌舰', st.kills || 0),
          stat('获得废料', st.scrapEarned || 0),
          stat('雇佣船员', st.crewHired || 0),
          stat('船员阵亡', st.crewLost || 0),
          stat('逃离战斗', st.fled || 0),
          stat('用时', G.U.fmtTime(st.time || 0))
        ),
        emblem,
        h('div.end-btns',
          h('button.btn.primary.big', {
            onClick: function () {
              S().sfx('jump');
              S().newRun({ shipId: run.shipId, difficulty: run.difficulty });
            },
          }, icon('jump'), '再来一局'),
          h('button.btn.ghost.big', { onClick: function () { S().sfx('click'); S().toTitle(); } }, '返回标题')
        )
      ));
      entry.state.stop = S().starfield(entry.el, { count: win ? 170 : 90, warp: win ? 0.6 : 0.05, tint: win ? 'gold' : 'red' });
      entry.state.stopShip = S().pixelShip(emblem, { wreck: !win });
      S().sfx(win ? 'victory' : 'defeat');
    },
    unmount: function (entry) {
      if (entry.state.stop) entry.state.stop();
      if (entry.state.stopShip) entry.state.stopShip();
    },
  });
})();
