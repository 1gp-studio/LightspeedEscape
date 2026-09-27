// DOM helpers, icon set, and the overlay (screen) manager.
//
//   G.dom.h('div.sheet.big', { onClick: fn, style: { color: 'red' } }, 'text', childEl, [more])
//   G.dom.icon('scrap')                      -> <span class="ico">svg</span>
//   G.dom.ICONS.shields                      -> [{ d, sw?, fill?, o? }] also usable with Path2D in canvas
//
//   G.UI.register('map', { modal: true, cls: '', mount(entry) {...}, refresh(entry) {...},
//                          update(entry, dt) {...}, unmount(entry) {...} })
//   G.UI.open('map', params) / G.UI.close('map') / G.UI.isOpen('map') / G.UI.refresh()
//   G.UI.toast('文本', 'warn'|'bad'|'good'|'', ms)
//   G.UI.confirm({ title, text, ok, cancel, danger }) -> Promise<boolean>   (window.confirm is not allowed)
//   G.UI.sheet(entry, { title, close: true|false, onClose }) -> { sheet, head, body, foot }
(function () {
  'use strict';
  var G = globalThis.G;

  // ------------------------------------------------------------------ h()
  function h(tag) {
    var parts = String(tag).split('.');
    var el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    var props = arguments[1];
    var start = 2;
    if (props == null || typeof props !== 'object' || props.nodeType || Array.isArray(props)) {
      start = 1; props = null;
    }
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') el.className = (el.className ? el.className + ' ' : '') + v;
        else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText = v;
          else Object.keys(v).forEach(function (s) {
            if (s.indexOf('--') === 0) el.style.setProperty(s, v[s]); else el.style[s] = v[s];
          });
        }
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k.length > 2 && k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        }
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (var i = start; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  function $(sel, root) { return (root || document).querySelector(sel); }

  // ------------------------------------------------------------------ icons (24x24 viewBox)
  // Each icon: list of { d: path, sw: stroke width (stroke instead of fill), o: opacity, fill: fixed color }
  var ICONS = {
    scrap: [{ d: 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z', sw: 2.4 }, { d: 'M12 8.6a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8z' }],
    fuel: [{ d: 'M12 2.5c3.6 4.7 6.2 8.1 6.2 11.4a6.2 6.2 0 0 1-12.4 0c0-3.3 2.6-6.7 6.2-11.4z' }],
    missiles: [{ d: 'M12 2c2.3 2 3.4 4.7 3.4 7.8V16H8.6V9.8C8.6 6.7 9.7 4 12 2z' },
               { d: 'M8.6 12.3L5.4 15.8v2.7h3.2zM15.4 12.3l3.2 3.5v2.7h-3.2z', o: 0.7 },
               { d: 'M10 17.2h4l-1 4.3h-2z', fill: '#ff9f43' }],
    hull: [{ d: 'M12 2l4.2 5.2v8.6l3.3 3.2V22h-15v-3l3.3-3.2V7.2z' }],
    shields: [{ d: 'M12 2.5l7.8 3.1v5.9c0 4.9-3.3 8.6-7.8 10.4-4.5-1.8-7.8-5.5-7.8-10.4V5.6z', sw: 2.3 }],
    engines: [{ d: 'M5.5 12.5L12 6l6.5 6.5M5.5 19L12 12.5l6.5 6.5', sw: 2.6 }],
    weapons: [{ d: 'M12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14z', sw: 2.2 }, { d: 'M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6', sw: 2.2 }],
    oxygen: [{ d: 'M8 9.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8z', sw: 2 }, { d: 'M16.5 4a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM17 13.5a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4z' }],
    medbay: [{ d: 'M9.3 3.5h5.4v5.8h5.8v5.4h-5.8v5.8H9.3v-5.8H3.5V9.3h5.8z' }],
    piloting: [{ d: 'M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0-17z', sw: 2.2 }, { d: 'M12 12L12 20M12 12L4.5 9.5M12 12l7.5-2.5', sw: 2.2 }, { d: 'M12 9.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8z' }],
    power: [{ d: 'M13.5 2L5 13.5h6L9.8 22 19 10h-6.2z' }],
    crew: [{ d: 'M12 3a4 4 0 1 1 0 8a4 4 0 1 1 0-8z' }, { d: 'M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z' }],
    pause: [{ d: 'M6.5 4h4v16h-4zM13.5 4h4v16h-4z' }],
    play: [{ d: 'M7 4l13 8-13 8z' }],
    map: [{ d: 'M5 18L10 7l5 7 4-9', sw: 2 }, { d: 'M5 15.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM10 4.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM15 11.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5zM19 2.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z' }],
    ship: [{ d: 'M12 2l3 4v6l4 3v4l-4-1-1 3h-4l-1-3-4 1v-4l4-3V6z' }],
    upgrade: [{ d: 'M12 3l7 7h-4.2v10H9.2V10H5z' }],
    store: [{ d: 'M4 8h16l-1.5 12.5h-13z' }, { d: 'M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8', sw: 2 }],
    gear: [{ d: 'M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z', sw: 2.2 }, { d: 'M12 2v3.2M12 18.8V22M2 12h3.2M18.8 12H22M4.9 4.9l2.3 2.3M16.8 16.8l2.3 2.3M4.9 19.1l2.3-2.3M16.8 7.2l2.3-2.3', sw: 2.2 }],
    close: [{ d: 'M5.5 5.5l13 13M18.5 5.5l-13 13', sw: 2.6 }],
    jump: [{ d: 'M12 3l6 6h-4v5h-4V9H6z' }, { d: 'M6 17h12M8 20.5h8', sw: 2 }],
    check: [{ d: 'M4.5 12.5l5 5 10-11', sw: 2.8 }],
    warning: [{ d: 'M12 2.5l10 18H2z' }, { d: 'M11 9h2v6h-2zM11 16.5h2v2h-2z', fill: '#1d1405' }],
    fire: [{ d: 'M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.3 1-3.9 2.3-5.2.1 1.8.8 3 2.2 3.7C11 8.5 10.8 5.3 12 2z' }],
    breach: [{ d: 'M12 3l2 5 5-1-3 5 4 4-5 0-1 5-2-4-4 3 1-5-5-2 5-2-2-5 4 2z', sw: 1.6 }],
    target: [{ d: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z', sw: 2 }, { d: 'M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6z' }],
    skull: [{ d: 'M12 2.5c4.7 0 8 3.2 8 7.6 0 2.6-1.2 4.3-3 5.4V19h-2.2v-2h-1.6v2h-2.4v-2H9.2v2H7v-3.5c-1.8-1.1-3-2.8-3-5.4 0-4.4 3.3-7.6 8-7.6z' }, { d: 'M8.8 9a1.9 1.9 0 1 1 0 3.8a1.9 1.9 0 1 1 0-3.8zM15.2 9a1.9 1.9 0 1 1 0 3.8a1.9 1.9 0 1 1 0-3.8z', fill: '#090d1b' }],
    help: [{ d: 'M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19z', sw: 2 }, { d: 'M9.2 9.3a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1.1-1.5 2.2v.8M12 16.8v1.8', sw: 2.2 }],
    sound: [{ d: 'M4 9h4l5-4v14l-5-4H4z' }, { d: 'M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12', sw: 2 }],
    ion: [{ d: 'M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', sw: 2 }, { d: 'M13 6l-5 7h4l-1 5 5-7h-4z' }],
    laser: [{ d: 'M3 16L17 6', sw: 3 }, { d: 'M17 6l4-2-2 4z' }],
    beam: [{ d: 'M3 12h18', sw: 4 }, { d: 'M3 12h18', sw: 1.2, fill: '#ffffff' }],
    star: [{ d: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.2 5.8 20.9l1.6-7L2 9.2l7.1-.6z' }],
  };
  function iconSvg(name) {
    var parts = ICONS[name];
    if (!parts) return '';
    var body = parts.map(function (p) {
      var o = p.o != null ? ' opacity="' + p.o + '"' : '';
      if (p.sw) {
        return '<path d="' + p.d + '" fill="none" stroke="' + (p.fill || 'currentColor') + '" stroke-width="' + p.sw +
          '" stroke-linecap="round" stroke-linejoin="round"' + o + '/>';
      }
      return '<path d="' + p.d + '" fill="' + (p.fill || 'currentColor') + '"' + o + '/>';
    }).join('');
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }
  function icon(name, cls) {
    var s = document.createElement('span');
    s.className = 'ico' + (cls ? ' ' + cls : '');
    s.innerHTML = iconSvg(name);
    return s;
  }

  G.dom = { h: h, append: append, clear: clear, $: $, ICONS: ICONS, iconSvg: iconSvg, icon: icon };

  // ------------------------------------------------------------------ overlay manager
  var stack = []; // entries: { name, el, def, params, state }

  function root() { return document.getElementById('overlays'); }

  var UI = {
    screens: {},
    stack: stack,
    register: function (name, def) { UI.screens[name] = def; },
    open: function (name, params) {
      var def = UI.screens[name];
      if (!def) { console.warn('[UI] unknown screen', name); return null; }
      if (UI.isOpen(name)) UI.close(name);
      var el = h('div.overlay' + (def.cls ? '.' + def.cls.split(' ').join('.') : ''), { 'data-screen': name });
      var entry = { name: name, el: el, def: def, params: params || {}, state: {} };
      stack.push(entry);
      root().appendChild(el);
      try { def.mount(entry); } catch (e) { console.error('[UI] mount failed', name, e); }
      return entry;
    },
    close: function (name) {
      for (var i = stack.length - 1; i >= 0; i--) {
        var e = stack[i];
        if (name == null || e.name === name) {
          stack.splice(i, 1);
          try { if (e.def.unmount) e.def.unmount(e); } catch (err) { console.error(err); }
          if (e.el.parentNode) e.el.parentNode.removeChild(e.el);
          if (name == null) return;
        }
      }
    },
    closeAll: function (keep) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (keep && keep(stack[i])) continue;
        UI.close(stack[i].name);
      }
    },
    isOpen: function (name) {
      for (var i = 0; i < stack.length; i++) if (stack[i].name === name) return true;
      return false;
    },
    get: function (name) {
      for (var i = 0; i < stack.length; i++) if (stack[i].name === name) return stack[i];
      return null;
    },
    top: function () { return stack[stack.length - 1] || null; },
    // True when any open overlay pauses the simulation.
    modalOpen: function () {
      for (var i = 0; i < stack.length; i++) if (stack[i].def.modal !== false) return true;
      return false;
    },
    refresh: function () {
      stack.slice().forEach(function (e) {
        if (e.def.refresh) { try { e.def.refresh(e); } catch (err) { console.error('[UI] refresh', e.name, err); } }
      });
    },
    update: function (dt) {
      stack.slice().forEach(function (e) {
        if (e.def.update) { try { e.def.update(e, dt); } catch (err) { console.error('[UI] update', e.name, err); } }
      });
    },

    // Standard bottom-sheet skeleton inside an overlay entry.
    sheet: function (entry, opts) {
      opts = opts || {};
      var closeBtn = opts.close === false ? null : h('button.btn.ghost.icon', {
        'aria-label': '关闭',
        onClick: function () {
          if (G.Audio) G.Audio.play('click');
          if (opts.onClose) opts.onClose(); else UI.close(entry.name);
        },
      }, icon('close'));
      var head = h('div.sheet-head', h('div.sheet-title', opts.title || ''), opts.headExtra || null, closeBtn);
      var body = h('div.sheet-body');
      var foot = h('div.sheet-foot');
      var sheet = h('div.sheet' + (opts.cls ? '.' + opts.cls : ''), head, body, foot);
      entry.el.appendChild(sheet);
      if (opts.close !== false && opts.backdropClose !== false) {
        // Close only when the press both started and ended on the scrim: a mouse drag
        // that begins inside the sheet and is released over the backdrop must not close it.
        var downOnBackdrop = false;
        entry.el.addEventListener('pointerdown', function (ev) {
          downOnBackdrop = ev.target === entry.el;
        });
        entry.el.addEventListener('click', function (ev) {
          var ok = downOnBackdrop && ev.target === entry.el;
          downOnBackdrop = false;
          if (ok) { if (opts.onClose) opts.onClose(); else UI.close(entry.name); }
        });
      }
      return { sheet: sheet, head: head, body: body, foot: foot };
    },

    toast: function (text, kind, ms) {
      var host = document.getElementById('toasts');
      if (!host) return;
      var t = h('div.toast' + (kind ? '.' + kind : ''), text);
      host.appendChild(t);
      while (host.children.length > 3) host.removeChild(host.firstChild);
      setTimeout(function () { t.classList.add('out'); }, ms || 1800);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, (ms || 1800) + 300);
    },

    confirm: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve) {
        var name = '__confirm';
        UI.screens[name] = {
          modal: true, cls: 'center',
          mount: function (entry) {
            var done = function (v) { UI.close(name); resolve(v); };
            entry.el.appendChild(h('div.dialog', h('div.panel',
              h('h3', opts.title || '确认'),
              opts.text ? h('p', opts.text) : null,
              h('div.row',
                h('button.btn.ghost', { onClick: function () { done(false); } }, opts.cancel || '取消'),
                h('button.btn' + (opts.danger ? '.danger' : '.primary'), { onClick: function () { done(true); } }, opts.ok || '确定')
              )
            )));
          },
        };
        UI.open(name);
      });
    },
  };

  G.UI = UI;
})();
