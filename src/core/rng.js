// Seeded RNG (mulberry32). State is a plain object { s } so it serializes with the run.
// All gameplay randomness MUST go through G.RNG with run.rng. Math.random is allowed only for
// cosmetic effects in the ui layer (particles, star twinkle).
(function () {
  'use strict';
  var G = globalThis.G;

  var RNG = {
    create: function (seed) {
      return { s: (seed >>> 0) || 0x9e3779b9 };
    },
    // A fresh random seed (UI only; uses Math.random).
    randomSeed: function () {
      return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
    },
    // float in [0, 1)
    next: function (r) {
      var t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // float in [a, b)
    range: function (r, a, b) {
      return a + (b - a) * RNG.next(r);
    },
    // integer in [a, b] inclusive
    int: function (r, a, b) {
      return a + Math.floor(RNG.next(r) * (b - a + 1));
    },
    chance: function (r, p) {
      return RNG.next(r) < p;
    },
    pick: function (r, arr) {
      return arr.length ? arr[Math.floor(RNG.next(r) * arr.length)] : undefined;
    },
    // weighted pick. items: array; wfn(item) -> weight >= 0. Returns undefined if all weights are 0.
    weighted: function (r, items, wfn) {
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += Math.max(0, wfn(items[i]));
      if (total <= 0) return undefined;
      var x = RNG.next(r) * total;
      for (i = 0; i < items.length; i++) {
        x -= Math.max(0, wfn(items[i]));
        if (x < 0) return items[i];
      }
      return items[items.length - 1];
    },
    // weighted pick from an object map { key: weight } -> key
    weightedKey: function (r, map) {
      var keys = Object.keys(map);
      return RNG.weighted(r, keys, function (k) { return map[k]; });
    },
    // in-place Fisher-Yates; returns arr
    shuffle: function (r, arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(RNG.next(r) * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    // v: number -> v;  [a, b] -> integer in [a, b]
    roll: function (r, v) {
      if (Array.isArray(v)) return RNG.int(r, v[0], v[1]);
      return v;
    },
  };

  G.RNG = RNG;
})();
