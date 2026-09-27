// Enemy ship generation from G.data.enemies tables (SPEC §6 G.Enemies). Pure; randomness via run.rng.
//   G.Enemies.generate(run, { faction, elite?, hullType? }) -> Ship   (power 0; G.AI.init powers it)
//   G.Enemies.flagship(run) -> Ship
(function () {
  'use strict';
  var G = globalThis.G;

  function diffOf(run) {
    var D = G.data.rules.difficulty;
    return D[run.difficulty || 'normal'] || D.normal;
  }

  // Rooms in crew placement order: piloting, weapons, shields, engines, then the others.
  function crewRooms(hull) {
    var order = [];
    G.Ship.STATION_ORDER.forEach(function (sid) {
      for (var i = 0; i < hull.rooms.length; i++) if (hull.rooms[i].sys === sid) { order.push(i); return; }
    });
    for (var i = 0; i < hull.rooms.length; i++) if (order.indexOf(i) < 0) order.push(i);
    return order;
  }

  function hasRoom(hull, sid) {
    return hull.rooms.some(function (r) { return r.sys === sid; });
  }

  // Weapon picks: up to maxWeapons, uniform over the faction list filtered by tier, remaining budget,
  // minimum d and the missile-weapon cap.
  function pickWeapons(run, fac, d, budget) {
    var E = G.data.enemies, W = G.data.weapons;
    var picks = [], left = budget, missiles = 0;
    for (var n = 0; n < E.maxWeapons; n++) {
      var cands = fac.weapons.filter(function (id) {
        var w = W[id];
        if (!w || w.tier > E.maxTierByD[d] || w.power > left) return false;
        if (d < (E.minDByWeapon[id] || 0)) return false;
        if (w.type === 'missile' && missiles >= E.maxMissileWeapons) return false;
        return true;
      });
      if (!cands.length) break;
      var id = G.RNG.pick(run.rng, cands);
      picks.push(id);
      left -= W[id].power;
      if (W[id].type === 'missile') missiles++;
    }
    return picks;
  }

  function generate(run, spec) {
    spec = spec || {};
    var E = G.data.enemies, rng = run.rng;
    var fac = E.factions[spec.faction] || E.factions.rebel;
    var elite = !!spec.elite;
    var d = G.U.clamp((run.sectorIndex || 0) + (elite ? E.elite.dBonus : 0), 0, 5);
    var diff = diffOf(run);
    var hullType = spec.hullType || G.RNG.weightedKey(rng, fac.hulls);
    var hull = G.data.hulls[hullType];
    var crewless = !!(fac.crewless || hull.crewless);

    var hullMax = Math.max(5, E.hullBase[hullType] + E.hullPerD * d + G.RNG.roll(rng, E.hullRand) + diff.enemyHull);

    var sr = E.shieldsByD[d];
    var shieldPow = 2 * G.RNG.int(rng, Math.floor(sr[0] / 2), Math.floor(sr[1] / 2)) + (elite ? E.elite.shieldsBonus : 0);
    shieldPow = Math.min(shieldPow, E.maxShieldPower);

    var systems = {};
    if (hasRoom(hull, 'shields') && shieldPow > 0) systems.shields = shieldPow;
    if (hasRoom(hull, 'engines')) systems.engines = Math.max(1, G.RNG.roll(rng, E.enginesByD[d]));
    if (hasRoom(hull, 'piloting')) systems.piloting = E.pilotingByD[d];
    if (hasRoom(hull, 'oxygen')) systems.oxygen = E.oxygenLevel;
    if (hasRoom(hull, 'medbay')) systems.medbay = E.medbayByD[d];

    var budget = Math.max(1, E.weaponBudgetByD[d] + diff.enemyPower);
    var weapons = pickWeapons(run, fac, d, budget);
    var wpow = G.U.sum(weapons, function (id) { return G.data.weapons[id].power; });
    systems.weapons = Math.max(1, wpow);

    var crew = [];
    if (!crewless) {
      var n = G.RNG.roll(rng, E.crewByHull[hullType] || [2, 2]);
      var order = crewRooms(hull);
      for (var i = 0; i < n; i++) {
        crew.push({ race: G.RNG.weightedKey(rng, fac.crew) || 'human', room: order[i % order.length] });
      }
    }

    var name = elite ? E.elite.name : G.RNG.pick(rng, fac.names);
    var ship = G.Ship.build(run, {
      id: 'enemy', name: name, templateId: hullType, faction: fac.id, crewless: crewless, tint: hull.tint,
      w: hull.w, h: hull.h, rooms: hull.rooms, hullMax: hullMax, reactor: 0,
      weaponSlots: Math.max(1, weapons.length), systems: systems, weapons: weapons, crew: crew,
      boss: false, elite: elite, missiles: E.missilesByD[d], volley: elite,
    });
    if (!crewless && !elite) {
      ship.canFlee = G.RNG.chance(rng, fac.flee);
      ship.canSurrender = G.RNG.chance(rng, fac.surrender);
    }
    return ship;
  }

  function flagship(run) {
    var F = G.data.enemies.flagship;
    var hull = G.data.hulls[F.hull];
    var order = crewRooms(hull);
    var ship = G.Ship.build(run, {
      id: 'enemy', name: F.name, templateId: F.hull, faction: F.faction || 'rebel', crewless: false, tint: hull.tint,
      w: hull.w, h: hull.h, rooms: hull.rooms,
      hullMax: Math.max(5, F.hullMax + diffOf(run).enemyHull), reactor: 0,
      weaponSlots: F.weapons.length, systems: F.systems, weapons: F.weapons,
      crew: F.crew.map(function (rc, i) { return { race: rc, room: order[i % order.length] }; }),
      boss: true, elite: false, missiles: F.missiles, volley: F.volley !== false,
    });
    ship.volley = true;
    return ship;
  }

  G.Enemies = { generate: generate, flagship: flagship, pickWeapons: pickWeapons };
})();
