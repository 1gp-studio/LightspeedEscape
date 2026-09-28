// Persistence (SPEC §6 G.Save): run save slot, settings and meta progress in localStorage.
// localStorage may be missing or throw (artifact host, private mode): every access is guarded and
// the game works without it. This is the only sim file allowed to touch localStorage.
(function () {
  'use strict';
  var G = globalThis.G;

  var MODES = ['event', 'hub', 'combat', 'reward', 'sectorSelect', 'gameover', 'victory'];
  var SETTINGS = { sound: true, music: true, vibrate: true, speed: 1, autoPause: true, crisisPause: true, tips: true };
  var META = { runs: 0, wins: 0, bestSector: 0, tipsSeen: {} };

  // ------------------------------------------------------------------ storage (guarded)
  function store() {
    try {
      var ls = globalThis.localStorage;
      return ls && typeof ls.getItem === 'function' ? ls : null;
    } catch (e) { return null; }
  }
  function get(key) {
    try { var ls = store(); return ls ? ls.getItem(key) : null; } catch (e) { return null; }
  }
  function set(key, val) {
    try { var ls = store(); if (!ls) return false; ls.setItem(key, val); return true; } catch (e) { return false; }
  }
  function del(key) {
    try { var ls = store(); if (ls) ls.removeItem(key); } catch (e) { /* ignore */ }
  }
  function parse(str) {
    if (typeof str !== 'string' || !str) return null;
    try { return JSON.parse(str); } catch (e) { return null; }
  }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

  // ------------------------------------------------------------------ run
  function serialize(run) { return G.U.stringify(run); }

  function valid(r) {
    if (!isObj(r) || r.v !== 1 || !G.data.ships[r.shipId]) return false;
    if (MODES.indexOf(r.mode) < 0 || !r.rng || typeof r.rng.s !== 'number') return false;
    if (!isObj(r.player) || !Array.isArray(r.player.rooms) || !Array.isArray(r.player.crew)) return false;
    if (!isObj(r.player.systems) || !Array.isArray(r.player.weapons)) return false;
    if (!isObj(r.res) || !isObj(r.stats) || !isObj(r.flags)) return false;
    if (!Array.isArray(r.cargo) || !Array.isArray(r.augments)) return false;
    if (!isObj(r.sector) || !Array.isArray(r.sector.beacons) || !r.sector.beacons[r.at]) return false;
    if (r.mode === 'event' && !isObj(r.event)) return false;
    if (r.mode === 'combat' && (!isObj(r.combat) || !isObj(r.combat.enemy))) return false;
    if (r.mode === 'reward' && !isObj(r.reward)) return false;
    if (r.mode === 'sectorSelect' && !Array.isArray(r.sectorChoices)) return false;
    return true;
  }

  // Rebuild runtime caches only (never re-runs AI.init or anything that rolls the RNG).
  function rebuild(run) {
    run._fx = [];
    if (G.Ship && typeof G.Ship.adj === 'function') {
      G.Ship.adj(run.player);
      if (run.combat && run.combat.enemy) G.Ship.adj(run.combat.enemy);
    }
    return run;
  }

  function deserialize(str) {
    var r = parse(str);
    if (!valid(r)) return null;
    try { return rebuild(r); } catch (e) { return null; }
  }

  function save(run) {
    if (!run || run.mode === 'gameover' || run.mode === 'victory') { clear(); return false; }
    return set(G.CFG.SAVE_KEY, serialize(run));
  }
  function load() { return deserialize(get(G.CFG.SAVE_KEY)); }
  function clear() { del(G.CFG.SAVE_KEY); }
  function has() { return !!get(G.CFG.SAVE_KEY); }

  // ------------------------------------------------------------------ settings / meta
  // Defaults, overridden by stored values of the same type; unknown stored keys are kept.
  function merge(defaults, stored) {
    var out = G.U.clone(defaults);
    if (!isObj(stored)) return out;
    Object.keys(stored).forEach(function (k) {
      if (!(k in defaults)) out[k] = stored[k];
      else if (isObj(defaults[k]) ? isObj(stored[k]) : typeof stored[k] === typeof defaults[k]) out[k] = stored[k];
    });
    return out;
  }

  function loadSettings() { return merge(SETTINGS, parse(get(G.CFG.SETTINGS_KEY))); }
  function saveSettings(s) { return set(G.CFG.SETTINGS_KEY, JSON.stringify(merge(SETTINGS, s))); }
  function loadMeta() { return merge(META, parse(get(G.CFG.META_KEY))); }
  function saveMeta(m) { return set(G.CFG.META_KEY, JSON.stringify(merge(META, m))); }

  G.Save = {
    serialize: serialize,
    deserialize: deserialize,
    save: save,
    load: load,
    clear: clear,
    has: has,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadMeta: loadMeta,
    saveMeta: saveMeta,
    defaults: { settings: SETTINGS, meta: META },
  };
})();
