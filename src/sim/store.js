// Stores (SPEC §6 G.Store): stock generation, buying and selling.
//   create(run, opts?) -> Store      opts = { sectorIndex?, final? } (defaults from the run)
//   canBuy(run, key, qty?) -> { ok, reason, price }   pure
//   buy(run, key, qty?) / sell(run, cargoIdx) / sellAugment(run, augId) -> { ok, reason }
//   repairPrice(run) -> scrap per hull point
// The store in use is always the current beacon's (G.Run.hasStore: mode hub && beacon.store).
(function () {
  'use strict';
  var G = globalThis.G;

  var LOCK = '战斗中无法操作';

  function rules() { return G.data.rules; }
  function fail(reason, price) { return { ok: false, reason: reason, price: price || 0 }; }

  function repairPriceAt(si) {
    var t = rules().hullRepairPrice;
    return t[G.U.clamp(si || 0, 0, t.length - 1)];
  }
  function repairPrice(run) { return repairPriceAt(run.sectorIndex); }

  // ------------------------------------------------------------------ create
  function create(run, opts) {
    opts = opts || {};
    var R = rules(), rng = run.rng, W = G.data.weapons, E = G.data.enemies;
    var si = opts.sectorIndex != null ? opts.sectorIndex : (run.sectorIndex || 0);
    var isFinal = !!opts.final || si >= G.CFG.SECTORS - 1;
    var items = [];

    var fuel = G.RNG.int(rng, 4, 8), missiles = G.RNG.int(rng, 4, 8);
    if (isFinal) { fuel = Math.max(4, fuel); missiles = Math.max(4, missiles); }
    items.push({ key: 'fuel', type: 'fuel', id: 'fuel', name: '燃料', price: R.fuelPrice, stock: fuel });
    items.push({ key: 'missiles', type: 'missiles', id: 'missiles', name: '导弹', price: R.missilePrice, stock: missiles });
    items.push({ key: 'repair', type: 'repair', id: 'repair', name: '船体维修', price: repairPriceAt(si), stock: 99 });

    // 3 distinct weapons, tier <= maxTierByD[sector]
    var maxT = E.maxTierByD[G.U.clamp(si, 0, E.maxTierByD.length - 1)];
    var pool = Object.keys(W).filter(function (id) { return W[id].tier <= maxT; });
    G.RNG.shuffle(rng, pool).slice(0, 3).forEach(function (id, i) {
      items.push({ key: 'w' + i, type: 'weapon', id: id, name: W[id].name, price: W[id].cost, stock: 1 });
    });

    // 1–2 crew
    var nCrew = G.RNG.int(rng, 1, 2);
    for (var i = 0; i < nCrew; i++) {
      var race = G.RNG.weightedKey(rng, G.data.crew.raceOdds) || 'human';
      items.push({ key: 'c' + i, type: 'crew', id: race, name: G.data.crew.races[race].name,
                   price: R.crewPrice[race], stock: 1 });
    }

    // augment (60%, one not owned)
    if (G.RNG.chance(rng, 0.6)) {
      // the final-sector store sits right before the flagship: a +scrap augment could never pay back
      var augs = Object.keys(R.augments).filter(function (a) { return !G.U.hasAug(run, a) && !(isFinal && a === 'scrap_arm'); });
      var aid = G.RNG.pick(rng, augs);
      if (aid) items.push({ key: 'aug', type: 'augment', id: aid, name: R.augments[aid].name,
                            price: R.augments[aid].cost, stock: 1 });
    }
    return { items: items };
  }

  // ------------------------------------------------------------------ helpers
  function current(run) {
    return G.Run.hasStore(run) ? run.sector.beacons[run.at].store : null;
  }
  function item(run, key) {
    var s = current(run);
    return s ? G.U.find(s.items, function (it) { return it.key === key; }) || null : null;
  }

  // ------------------------------------------------------------------ buy
  function canBuy(run, key, qty) {
    var R = rules(), p = run.player;
    qty = Math.max(1, Math.floor(qty || 1));
    if (run.mode === 'combat') return fail(LOCK);
    if (!current(run)) return fail('这里没有商店');
    var it = item(run, key);
    if (!it) return fail('没有这件商品');
    if (it.type !== 'fuel' && it.type !== 'missiles' && it.type !== 'repair') qty = 1;
    var price = it.price * qty;
    if (it.stock < qty) return fail('已售罄', price);
    if (it.type === 'repair') {
      if (p.hull >= p.hullMax) return fail('船体完好', price);
      if (p.hull + qty > p.hullMax) return fail('超出船体上限', price);
    }
    if (it.type === 'weapon' && p.weapons.length >= p.weaponSlots && run.cargo.length >= R.cargoMax) {
      return fail('武器槽和货舱都满了', price);
    }
    if (it.type === 'crew' && p.crew.length >= R.maxCrew) return fail('船员已满', price);
    if (it.type === 'augment') {
      if (G.U.hasAug(run, it.id)) return fail('已拥有', price);
      if (run.augments.length >= R.augmentMax) return fail('增强模块已满', price);
    }
    if ((run.res.scrap || 0) < price) return fail('废料不足', price);
    return { ok: true, reason: '', price: price };
  }

  function buy(run, key, qty) {
    var chk = canBuy(run, key, qty);
    if (!chk.ok) return { ok: false, reason: chk.reason };
    var it = item(run, key), p = run.player;
    qty = (it.type === 'fuel' || it.type === 'missiles' || it.type === 'repair') ? Math.max(1, Math.floor(qty || 1)) : 1;
    run.res.scrap -= chk.price;
    it.stock -= qty;
    if (it.type === 'fuel') run.res.fuel += qty;
    else if (it.type === 'missiles') run.res.missiles += qty;
    else if (it.type === 'repair') p.hull = Math.min(p.hullMax, p.hull + qty);
    else if (it.type === 'weapon') G.Events.giveWeapon(run, it.id);
    else if (it.type === 'crew') G.Events.addCrew(run, it.id);
    else if (it.type === 'augment') run.augments.push(it.id);
    return { ok: true, reason: '' };
  }

  // ------------------------------------------------------------------ sell
  function sell(run, cargoIdx) {
    if (run.mode === 'combat') return { ok: false, reason: LOCK };
    if (!current(run)) return { ok: false, reason: '这里没有商店' };
    var id = run.cargo[cargoIdx], d = id && G.data.weapons[id];
    if (!d) return { ok: false, reason: '没有这件物品' };
    run.cargo.splice(cargoIdx, 1);
    run.res.scrap += Math.floor(d.cost * rules().sellMult);
    return { ok: true, reason: '' };
  }

  function sellAugment(run, augId) {
    if (run.mode === 'combat') return { ok: false, reason: LOCK };
    if (!current(run)) return { ok: false, reason: '这里没有商店' };
    var i = run.augments.indexOf(augId), a = rules().augments[augId];
    if (i < 0 || !a) return { ok: false, reason: '没有这个增强模块' };
    run.augments.splice(i, 1);
    run.res.scrap += Math.floor(a.cost * rules().sellMult);
    return { ok: true, reason: '' };
  }

  function sellPrice(id) {
    var d = G.data.weapons[id] || rules().augments[id];
    return d ? Math.floor(d.cost * rules().sellMult) : 0;
  }

  G.Store = {
    create: create,
    current: current,
    item: item,
    canBuy: canBuy,
    buy: buy,
    sell: sell,
    sellAugment: sellAugment,
    sellPrice: sellPrice,
    repairPrice: repairPrice,
  };
})();
