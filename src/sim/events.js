// Text event engine over G.data.events (SPEC §6 G.Events, §8).
//   pick(run, tag|[tags]) -> eventId|null ; start(run, id, node?) ; node(run) ; choices(run)
//   choose(run, idx) -> EventResult (fx applied immediately) ; cont(run) -> { openStore }
//   apply(run, fx) -> FxSummary        one effect object, also used by rewards and tests
// Shared grant helpers used by G.Store / G.Run: addCrew, giveWeapon, randomWeapon, randomRace.
// Event fx never kill: hull >= 1, crew HP >= 1, loseCrew never removes the last crew member.
(function () {
  'use strict';
  var G = globalThis.G;

  var TYPE_NAMES = { laser: '激光', ion: '离子', missile: '导弹', beam: '光束' };
  var COST_NAMES = { scrap: '废料', fuel: '燃料', missiles: '导弹' };
  var BLUE_KEYS = ['race', 'weaponType', 'weapon', 'system', 'crewCount', 'augment'];
  var COST_KEYS = ['scrap', 'fuel', 'missiles'];

  function rules() { return G.data.rules; }
  function list() { return G.data.events || []; }
  function def(id) { return G.U.byId(list(), id) || null; }
  function alive(run) { return run.player && run.player.crew ? run.player.crew : []; }
  function sum(key, amount, label, good) { return { key: key, amount: amount, label: label, good: !!good }; }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  // ------------------------------------------------------------------ pick / start
  function hasTag(ev, tags) {
    var t = ev.tags || [];
    for (var i = 0; i < tags.length; i++) if (t.indexOf(tags[i]) >= 0) return true;
    return false;
  }

  function pick(run, tag) {
    var tags = Array.isArray(tag) ? tag : [tag];
    var si = run.sectorIndex || 0, flags = run.flags || {};
    var tagged = list().filter(function (ev) { return hasTag(ev, tags) && !(ev.once && flags[ev.id]); });
    var cands = tagged.filter(function (ev) {
      var lo = ev.minSector == null ? 0 : ev.minSector, hi = ev.maxSector == null ? 99 : ev.maxSector;
      return lo <= si && si <= hi;
    });
    if (!cands.length) cands = tagged;   // content gap: ignore the sector range rather than showing nothing
    var ev = G.RNG.weighted(run.rng, cands, function (e) { return e.weight == null ? 1 : e.weight; });
    return ev ? ev.id : null;
  }

  function start(run, eventId, node) {
    var ev = def(eventId);
    if (!ev) return false;
    run.event = { id: ev.id, node: node || 'start', result: null, ctx: {} };
    run.mode = 'event';
    if (ev.once) run.flags[ev.id] = true;
    return true;
  }

  function node(run) {
    if (!run.event) return null;
    var ev = def(run.event.id);
    return ev && ev.nodes ? ev.nodes[run.event.node] || null : null;
  }

  // ------------------------------------------------------------------ requirements
  function blueOk(run, req) {
    var p = run.player, k;
    if (req.race != null && !alive(run).some(function (c) { return c.race === req.race; })) return false;
    if (req.weaponType != null && !p.weapons.some(function (w) {
      var d = G.data.weapons[w.id]; return d && d.type === req.weaponType;
    })) return false;
    if (req.weapon != null && !p.weapons.some(function (w) { return w.id === req.weapon; })) return false;
    if (req.system != null) {
      var sid = typeof req.system === 'string' ? req.system : req.system.id;
      var lvl = typeof req.system === 'string' ? 1 : (req.system.level || 1);
      k = p.systems[sid];
      if (!k || k.level < lvl) return false;
    }
    if (req.crewCount != null && alive(run).length < req.crewCount) return false;
    if (req.augment != null && !G.U.hasAug(run, req.augment)) return false;
    return true;
  }

  function costOk(run, req) {
    for (var i = 0; i < COST_KEYS.length; i++) {
      var k = COST_KEYS[i];
      if (req[k] != null && (run.res[k] || 0) < req[k]) return false;
    }
    return true;
  }

  function isBlue(req) {
    return !!req && BLUE_KEYS.some(function (k) { return req[k] != null; });
  }

  function blueNote(req) {
    var parts = [];
    if (req.race != null) {
      var race = G.data.crew.races[req.race];
      parts.push(race ? race.name : req.race);
    }
    if (req.weaponType != null) parts.push((TYPE_NAMES[req.weaponType] || req.weaponType) + '武器');
    if (req.weapon != null) {
      var w = G.data.weapons[req.weapon];
      parts.push(w ? w.name : req.weapon);
    }
    if (req.system != null) {
      var sid = typeof req.system === 'string' ? req.system : req.system.id;
      var sd = G.data.systems.defs[sid];
      var lvl = typeof req.system === 'string' ? 1 : (req.system.level || 1);
      parts.push((sd ? sd.name : sid) + (lvl > 1 ? ' ' + lvl + ' 级' : ''));
    }
    if (req.crewCount != null) parts.push('船员≥' + req.crewCount);
    if (req.augment != null) {
      var a = rules().augments[req.augment];
      parts.push(a ? a.name : req.augment);
    }
    return parts.length ? '〔' + parts.join('·') + '〕' : '';
  }

  function costNote(req) {
    var parts = [];
    COST_KEYS.forEach(function (k) { if (req[k] != null) parts.push(req[k] + ' ' + COST_NAMES[k]); });
    return parts.length ? '需要 ' + parts.join('、') : '';
  }

  // ------------------------------------------------------------------ choices
  // Visible choices of the current node. idx is the index into node.choices (what choose() takes).
  // A node without any enabled choice gets a synthetic '离开' (idx = choices.length) so it can never soft-lock.
  function choices(run) {
    var n = node(run);
    if (!n) return [];
    var src = n.choices || [], out = [];
    src.forEach(function (c, i) {
      var req = c.req || {};
      var blue = isBlue(req);
      if (blue && !blueOk(run, req)) return;
      var enabled = costOk(run, req);
      var note = blue ? blueNote(req) : '';
      var cn = costNote(req);
      if (cn) note = note ? note + ' ' + cn : cn;
      out.push({ idx: i, text: c.text, blue: blue, enabled: enabled, note: note });
    });
    if (!out.some(function (c) { return c.enabled; })) {
      out.push({ idx: src.length, text: src.length ? '离开' : '继续', blue: false, enabled: true, note: '' });
    }
    return out;
  }

  function minCrewFor(o) {
    var m = o.minCrew || 0;
    (o.fx || []).forEach(function (f) {
      if (f && f.loseCrew != null) m = Math.max(m, (typeof f.loseCrew === 'number' ? f.loseCrew : 1) + 1);
    });
    return m;
  }

  function choose(run, idx) {
    if (!run.event || run.event.result) return null;
    var n = node(run);
    if (!n) return null;
    var vis = G.U.find(choices(run), function (c) { return c.idx === idx; });
    if (!vis || !vis.enabled) return null;
    var c = (n.choices || [])[idx];
    var outs = c && c.outcomes && c.outcomes.length ? c.outcomes : [{ w: 1, text: '' }];
    // outcomes that kill crew (or set minCrew) need enough crew for their text to hold
    var nCrew = run.player ? run.player.crew.length : 0;
    var fit = outs.filter(function (x) { return nCrew >= minCrewFor(x); });
    if (fit.length) outs = fit;
    var o = G.RNG.weighted(run.rng, outs, function (x) { return x.w == null ? 1 : x.w; }) || outs[0];
    var fx = applyList(run, o.fx || []);
    var next = o.goto ? 'goto' : o.combat ? 'combat' : o.store ? 'store' : 'end';
    var res = {
      text: o.text || '', fx: fx, next: next,
      goto: o.goto || null, combat: o.combat ? G.U.clone(o.combat) : null,
    };
    run.event.result = res;
    // An outcome with no text, no fx and no follow-up closes the dialog immediately.
    if (next === 'end' && !res.text && !fx.length) cont(run);
    return res;
  }

  function cont(run) {
    var ev = run.event;
    if (!ev || !ev.result) return { openStore: false };
    var r = ev.result;
    if (r.next === 'goto') {
      run.event = { id: ev.id, node: r.goto, result: null, ctx: ev.ctx || {} };
      run.mode = 'event';
      return { openStore: false };
    }
    run.event = null;
    if (r.next === 'combat') {
      var spec = r.combat || {};
      run.after = spec.win ? { eventId: ev.id, node: spec.win } : null;
      G.Run.startCombat(run, spec);
      return { openStore: false };
    }
    if (r.next === 'store') {
      var b = run.sector.beacons[run.at];
      if (!b.store) b.store = G.Store.create(run);
      run.mode = 'hub';
      return { openStore: true };
    }
    run.mode = 'hub';
    return { openStore: false };
  }

  // ------------------------------------------------------------------ grant helpers (shared)
  function randomRace(run) {
    return G.RNG.weightedKey(run.rng, G.data.crew.raceOdds) || 'human';
  }

  // tier: 'random' (<= sector max tier) | 1..3 exact tier (falls back to <= tier)
  function randomWeapon(run, tier) {
    var W = G.data.weapons, E = G.data.enemies;
    var maxT = E.maxTierByD[G.U.clamp(run.sectorIndex || 0, 0, E.maxTierByD.length - 1)];
    var ids = Object.keys(W);
    var pool = ids.filter(function (id) { return tier ? W[id].tier === tier : W[id].tier <= maxT; });
    if (!pool.length) pool = ids.filter(function (id) { return W[id].tier <= (tier || maxT); });
    return G.RNG.pick(run.rng, pool) || null;
  }

  // Free weapon slot (unpowered) -> cargo -> dismantled for scrap. Returns { where, scrap }.
  function giveWeapon(run, id) {
    var p = run.player, d = G.data.weapons[id];
    if (!d) return { where: 'none', scrap: 0 };
    if (p.weapons.length < p.weaponSlots) {
      p.weapons.push({ uid: G.U.uid(run, 'w'), id: id, on: false, want: false, charge: 0, target: null });
      return { where: 'slot', scrap: 0 };
    }
    if (run.cargo.length < rules().cargoMax) {
      run.cargo.push(id);
      return { where: 'cargo', scrap: 0 };
    }
    var s = Math.floor(d.cost * rules().sellMult);
    run.res.scrap += s;
    return { where: 'scrap', scrap: s };
  }

  // New crew member of `race` ('random' ok) in the least crowded room. Returns Crew or null when full.
  function addCrew(run, race) {
    var p = run.player;
    if (alive(run).length >= rules().maxCrew) return null;
    if (!race || race === 'random' || !G.data.crew.races[race]) race = randomRace(run);
    var c = G.Crew.create(run, race);
    var counts = p.rooms.map(function () { return 0; });
    p.crew.forEach(function (m) { if (counts[m.room] != null) counts[m.room]++; });
    var best = 0;
    for (var i = 1; i < counts.length; i++) if (counts[i] < counts[best]) best = i;
    p.crew.push(c);
    G.Crew.place(p, c, best);
    if (run.stats) run.stats.crewHired++;
    return c;
  }

  // ------------------------------------------------------------------ apply
  function eventScrap(run, n) {
    if (n <= 0) return n;
    var m = 1 + rules().eventScrapPerSector * (run.sectorIndex || 0);
    if (G.U.hasAug(run, 'scrap_arm')) m *= rules().augmentFx.scrapMult;
    return Math.round(n * m);
  }

  function addRes(run, key, n, name) {
    var before = run.res[key] || 0;
    run.res[key] = Math.max(0, before + n);
    var d = run.res[key] - before;
    if (key === 'scrap' && d > 0 && run.stats) run.stats.scrapEarned += d;
    return sum(key, d, signed(d) + ' ' + name, d >= 0);
  }

  function applyOne(run, key, v) {
    var R = rules(), p = run.player, rng = run.rng, n, i;
    switch (key) {
      case 'scrap': return addRes(run, 'scrap', eventScrap(run, G.RNG.roll(rng, v)), '废料');
      case 'fuel': return addRes(run, 'fuel', G.RNG.roll(rng, v), '燃料');
      case 'missiles': return addRes(run, 'missiles', G.RNG.roll(rng, v), '导弹');
      case 'hull': {
        n = G.RNG.roll(rng, v);
        var h0 = p.hull;
        p.hull = G.U.clamp(p.hull + n, Math.min(1, h0), p.hullMax);
        n = p.hull - h0;
        return sum('hull', n, signed(n) + ' 船体', n >= 0);
      }
      case 'crew': {
        var c = addCrew(run, v);
        if (!c) return sum('crew', 0, '船员已满', false);
        var rc = G.data.crew.races[c.race];
        return sum('crew', 1, '新船员 ' + c.name + '（' + (rc ? rc.name : c.race) + '）', true);
      }
      case 'loseCrew': {
        n = typeof v === 'number' ? v : 1;
        var names = [];
        for (i = 0; i < n && p.crew.length > 1; i++) {
          var k = G.RNG.int(rng, 0, p.crew.length - 1);
          var dead = p.crew.splice(k, 1)[0];
          names.push(dead.name);
          if (run.stats) run.stats.crewLost++;
          G.U.fx(run, { t: 'crewDied', side: 'player', name: dead.name });
        }
        return sum('loseCrew', names.length ? -names.length : 0, names.length ? '失去船员 ' + names.join('、') : '无人伤亡', !names.length);
      }
      case 'crewDamage': {
        n = G.RNG.roll(rng, v);
        p.crew.forEach(function (m) { m.hp = Math.max(Math.min(1, m.hp), m.hp - n); });
        return sum('crewDamage', -n, '全体船员 -' + n + ' 生命', false);
      }
      case 'weapon': {
        var wid = v;
        if (v === 'random') wid = randomWeapon(run, 0);
        else if (typeof v === 'string' && /^tier[1-3]$/.test(v)) wid = randomWeapon(run, +v.charAt(4));
        if (!wid || !G.data.weapons[wid]) return sum('weapon', 0, '', false);
        var g = giveWeapon(run, wid), wn = G.data.weapons[wid].name;
        if (g.where === 'scrap') {
          if (run.stats) run.stats.scrapEarned += g.scrap;
          return sum('weapon', 0, wn + ' · 货舱已满，已拆解 +' + g.scrap + ' 废料', true);
        }
        return sum('weapon', 1, '获得武器 ' + wn, true);
      }
      case 'augment': {
        var aid = v;
        if (v === 'random') {
          var pool = Object.keys(R.augments).filter(function (a) { return !G.U.hasAug(run, a); });
          aid = G.RNG.pick(rng, pool);
        }
        var ad = aid && R.augments[aid];
        if (!ad) return sum('augment', 0, '', false);
        if (G.U.hasAug(run, aid) || run.augments.length >= R.augmentMax) {
          var s = Math.floor(ad.cost * R.sellMult);
          run.res.scrap += s;
          if (run.stats) run.stats.scrapEarned += s;
          return sum('augment', 0, ad.name + ' · 已拆解 +' + s + ' 废料', true);
        }
        run.augments.push(aid);
        return sum('augment', 1, '增强模块 ' + ad.name, true);
      }
      case 'upgrade': {
        var defs = G.data.systems.defs, sid = v;
        if (v === 'random') {
          var ups = G.data.systems.order.filter(function (id) {
            return p.systems[id] && p.systems[id].level < defs[id].maxLevel;
          });
          sid = G.RNG.pick(rng, ups);
        }
        var sys = sid && p.systems[sid];
        if (!sys || sys.level >= defs[sid].maxLevel) return sum('upgrade', 0, '', false);
        sys.level++;
        return sum('upgrade', 1, defs[sid].name + ' 升至 ' + sys.level + ' 级', true);
      }
      case 'sysDamage': {
        var did = v;
        if (v === 'random') {
          did = G.RNG.pick(rng, G.data.systems.order.filter(function (id) {
            return p.systems[id] && p.systems[id].damage < p.systems[id].level;
          }));
        }
        var ds = did && p.systems[did];
        if (!ds) return sum('sysDamage', 0, '', false);
        ds.damage = Math.min(ds.level, ds.damage + 1);
        if (G.Ship && typeof G.Ship.enforcePower === 'function') G.Ship.enforcePower(p);
        G.U.fx(run, { t: 'sysDamage', side: 'player', sys: did });
        return sum('sysDamage', -1, G.data.systems.defs[did].name + ' 受损', false);
      }
      case 'reactor': {
        n = G.RNG.roll(rng, v);
        var r0 = p.reactor;
        p.reactor = G.U.clamp(p.reactor + n, r0, R.reactorMax);
        n = p.reactor - r0;
        return sum('reactor', n, signed(n) + ' 反应堆', true);
      }
      case 'fleet': {
        n = G.RNG.roll(rng, v);
        if (!run.sector) return sum('fleet', 0, '', false);
        run.sector.fleet = Math.round(Math.max(R.fleetStart - 2, run.sector.fleet + n) * 1e6) / 1e6;
        return sum('fleet', n, n > 0 ? '叛军舰队逼近' : '叛军舰队被拖延', n <= 0);
      }
    }
    return sum(key, 0, '', false);
  }

  // Apply one fx object. Normally one key; with several keys all are applied and the last summary returned.
  function apply(run, fx) {
    var out = null;
    Object.keys(fx || {}).forEach(function (k) { out = applyOne(run, k, fx[k]); });
    return out || sum('', 0, '', false);
  }

  // [fxObject] -> [FxSummary] (summaries without a label are dropped)
  function applyList(run, arr) {
    var out = [];
    (arr || []).forEach(function (fx) {
      Object.keys(fx || {}).forEach(function (k) {
        var s = applyOne(run, k, fx[k]);
        if (s && s.label) out.push(s);
      });
    });
    return out;
  }

  G.Events = {
    pick: pick,
    start: start,
    node: node,
    def: def,
    choices: choices,
    choose: choose,
    cont: cont,
    apply: apply,
    applyList: applyList,
    reqOk: function (run, req) { return blueOk(run, req || {}) && costOk(run, req || {}); },
    addCrew: addCrew,
    giveWeapon: giveWeapon,
    randomWeapon: randomWeapon,
    randomRace: randomRace,
  };
})();
