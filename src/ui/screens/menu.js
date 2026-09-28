// Pause menu ('menu': 继续 · 查看飞船 (combat only, read-only) · 设置 · 玩法 · 放弃本局 · 返回标题), settings ('settings': every Settings field,
// saved with G.Save.saveSettings and applied at once) and help ('help': G.data.text.help).
(function () {
  'use strict';
  var G = globalThis.G;
  var h = function () { return G.dom.h.apply(null, arguments); };
  var icon = function (n, c) { return G.dom.icon(n, c); };
  function S() { return G.Screens; }

  // ------------------------------------------------------------------ menu
  function abandon() {
    G.UI.confirm({
      title: '放弃本局？', danger: true, ok: '放弃', cancel: '取消',
      text: '当前航程会被删除，无法继续。这一局会计入出航次数。',
    }).then(function (yes) {
      if (!yes) return;
      if (G.App && typeof G.App.abandon === 'function') { G.App.abandon(); return; }
      var run = S().run();
      if (run && !run.flags.metaDone) {
        var meta = S().meta();
        meta.runs = (meta.runs || 0) + 1;
        meta.bestSector = Math.max(meta.bestSector || 0, (run.sectorIndex || 0) + 1);   // 1-based, as main.js
        run.flags.metaDone = true;
        G.Save.saveMeta(meta);
      }
      G.Save.clear();
      if (G.App) G.App.run = null;
      globalThis.__run = null;
      S().toTitle();
    });
  }

  G.UI.register('menu', {
    modal: true, cls: 'center menu-screen',
    mount: function (entry) {
      var run = S().run();
      var close = function () { S().sfx('click'); G.UI.close('menu'); };
      var info = null;
      if (run && run.sector) {
        var D = G.data.rules.difficulty[run.difficulty] || G.data.rules.difficulty.normal;
        info = h('div.menu-info',
          h('span', run.player.name),
          h('span', '星区 ' + (run.sectorIndex + 1) + '/' + G.CFG.SECTORS),
          h('span', D.label),
          h('span', G.U.fmtTime(run.stats.time || 0))
        );
      }
      // Close on the scrim only when the press also started there (a drag out of the panel must not close it).
      var downOnScrim = false;
      entry.el.addEventListener('pointerdown', function (ev) { downOnScrim = ev.target === entry.el; });
      entry.el.addEventListener('click', function (ev) {
        var ok = downOnScrim && ev.target === entry.el;
        downOnScrim = false;
        if (ok) close();
      });
      entry.el.appendChild(h('div.dialog.menu-dialog', h('div.panel.menu-panel',
        h('div.rw-kicker', 'PAUSED'),
        h('h3.menu-title', '暂停'),
        info,
        h('div.menu-btns',
          h('button.btn.primary.big', { onClick: close }, icon('play'), '继续'),
          // In combat the hub's 飞船 button is hidden; the ship screen opens read-only from here (both modal,
          // so the fight stays frozen while it is open).
          run && run.mode === 'combat' ? h('button.btn', {
            onClick: function () { S().sfx('click'); G.UI.open('ship'); },
          }, icon('ship'), '查看飞船') : null,
          h('div.menu-pair',
            h('button.btn', { onClick: function () { S().sfx('click'); G.UI.open('settings'); } }, icon('gear'), '设置'),
            h('button.btn', { onClick: function () { S().sfx('click'); G.UI.open('help'); } }, icon('help'), '玩法')
          ),
          h('button.btn.ghost', { onClick: function () { S().sfx('click'); S().toTitle(); } }, '返回标题（自动存档）'),
          run ? h('button.btn.danger', { onClick: abandon }, '放弃本局') : null
        )
      )));
    },
  });

  // ------------------------------------------------------------------ settings
  var SPEEDS = [0.75, 1, 1.5, 2];

  function persist(s) {
    G.Save.saveSettings(s);
    if (G.Audio) G.Audio.setEnabled(!!s.sound);
  }

  function toggleRow(s, key, label, desc, entry) {
    var on = !!s[key];
    return h('button.set-row', {
      role: 'switch', 'aria-checked': on ? 'true' : 'false',
      onClick: function () {
        s[key] = !s[key];
        persist(s);
        if (key === 'vibrate' && s.vibrate && globalThis.navigator && navigator.vibrate) {
          try { navigator.vibrate(30); } catch (e) { /* ignore */ }
        }
        S().sfx('click');
        render(entry);
      },
    },
      h('span.set-text', h('span.set-label', label), desc ? h('span.set-desc', desc) : null),
      h('span.switch' + (on ? '.on' : ''), h('i'))
    );
  }

  function render(entry) {
    var s = S().settings(), body = entry.state.body;
    G.dom.clear(body);
    body.appendChild(S().section('声音与反馈'));
    body.appendChild(toggleRow(s, 'sound', '音效', null, entry));
    body.appendChild(toggleRow(s, 'vibrate', '震动', '船体被击中时震动（需设备支持）', entry));
    body.appendChild(S().section('战斗'));
    body.appendChild(h('div.set-row.static',
      h('span.set-text', h('span.set-label', '战斗速度'), h('span.set-desc', '模拟速度倍率，暂停不受影响')),
      h('div.seg.small', SPEEDS.map(function (v) {
        return h('button.seg-btn' + (s.speed === v ? '.on' : ''), {
          role: 'radio', 'aria-checked': s.speed === v ? 'true' : 'false',
          onClick: function () { s.speed = v; persist(s); S().sfx('click'); render(entry); },
        }, '×' + v);
      }))
    ));
    body.appendChild(toggleRow(s, 'autoPause', '战斗开始时暂停', '每局第一场战斗总会暂停', entry));
    body.appendChild(toggleRow(s, 'crisisPause', '危机时自动暂停', '旗舰进入二阶段、敌舰逃跑、船体告急时', entry));
    body.appendChild(S().section('提示'));
    body.appendChild(toggleRow(s, 'tips', '新手提示', '在第一次遇到时讲解操作', entry));
    var meta = S().meta();
    var seen = meta.tipsSeen ? Object.keys(meta.tipsSeen).length : 0;
    body.appendChild(h('div.set-row.static',
      h('span.set-text', h('span.set-label', '重新显示提示'), h('span.set-desc', '已看过 ' + seen + ' 条')),
      h('button.btn.ghost.sh-mini', {
        'aria-disabled': seen ? 'false' : 'true',
        onClick: function () {
          if (!seen) return;
          meta.tipsSeen = {};
          G.Save.saveMeta(meta);
          S().sfx('click');
          G.UI.toast('提示已重置', 'good');
          render(entry);
        },
      }, '重置')
    ));
    body.appendChild(h('div.set-ver', G.TITLE + ' v' + G.VERSION));
  }

  G.UI.register('settings', {
    modal: true, cls: 'settings-screen',
    mount: function (entry) {
      var ui = G.UI.sheet(entry, { title: '设置', cls: 'settings-sheet' });
      ui.foot.hidden = true;
      entry.state.body = ui.body;
      render(entry);
    },
  });

  // ------------------------------------------------------------------ help
  G.UI.register('help', {
    modal: true, cls: 'help-screen',
    mount: function (entry) {
      var ui = G.UI.sheet(entry, { title: '玩法', cls: 'tall help-sheet' });
      ui.foot.hidden = true;
      var help = G.data.text.help || [];
      var nav = h('div.help-nav', help.map(function (sec, i) {
        return h('button.help-jump', {
          onClick: function () {
            var t = ui.body.querySelector('[data-sec="' + i + '"]');
            if (!t) return;
            ui.body.scrollTop += t.getBoundingClientRect().top - ui.body.getBoundingClientRect().top - nav.offsetHeight + 4;
          },
        }, sec.title);
      }));
      ui.body.appendChild(nav);
      help.forEach(function (sec, i) {
        ui.body.appendChild(h('section.help-sec', { 'data-sec': String(i) },
          h('h4', h('span.help-n', (i + 1 < 10 ? '0' : '') + (i + 1)), sec.title),
          h('p', sec.body)
        ));
      });
    },
  });
})();
