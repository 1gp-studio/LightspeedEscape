// Small shared helpers. Pure; safe for the sim layer.
(function () {
  'use strict';
  var G = globalThis.G;

  var U = {
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    sum: function (arr, fn) {
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += fn ? fn(arr[i], i) : arr[i];
      return s;
    },
    find: function (arr, fn) {
      for (var i = 0; i < arr.length; i++) if (fn(arr[i], i)) return arr[i];
      return undefined;
    },
    byId: function (arr, id) {
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return undefined;
    },
    // Deterministic unique id stored on the run: 'c12', 'p40' ...
    uid: function (run, prefix) {
      run.nextId = (run.nextId || 1) + 1;
      return (prefix || 'x') + run.nextId;
    },
    clone: function (o) { return JSON.parse(JSON.stringify(o)); },
    // Serialize while dropping keys that start with '_' (runtime caches such as ship._adj).
    stringify: function (o) {
      return JSON.stringify(o, function (k, v) { return k.charAt(0) === '_' ? undefined : v; });
    },
    // Transient FX queue on the run (run._fx is dropped on save). G.Run.fx / G.Run.drainFx alias these.
    fx: function (run, ev) { (run._fx || (run._fx = [])).push(ev); },
    drainFx: function (run) { var a = run._fx || []; run._fx = []; return a; },
    hasAug: function (run, id) { return !!(run.augments && run.augments.indexOf(id) >= 0); },
    // [a,b] -> 'a–b'; n -> 'n'
    rangeText: function (v) { return Array.isArray(v) ? v[0] + '–' + v[1] : String(v); },
    pct: function (x) { return Math.round(x) + '%'; },
    // 125 -> '2:05'
    fmtTime: function (s) {
      s = Math.max(0, Math.round(s));
      var m = Math.floor(s / 60), r = s % 60;
      return m + ':' + (r < 10 ? '0' : '') + r;
    },
    // Do two axis-aligned rects (grid units) share an edge segment of positive length?
    rectsTouch: function (a, b) {
      var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      var vertical = (a.x + a.w === b.x || b.x + b.w === a.x) && oy > 0;
      var horizontal = (a.y + a.h === b.y || b.y + b.h === a.y) && ox > 0;
      return vertical || horizontal;
    },
  };

  G.U = U;
})();
