// Ship model: construction, geometry helpers, reactor power accounting, manning, evasion, shields
// helpers and system damage/ion. Pure (no DOM, no Math.random); randomness only via G.RNG + run.rng.
//   G.Ship.build(run, spec) / G.Ship.createPlayer(run, shipId)
//   power: usable / reactorUsed / reactorFree / addPower / removePower / toggleWeapon / enforcePower / restorePower
//   queries: powerBlock / toggleBlock / evasionInfo / canChargeFtl / isManned / mannedBy / beamRooms (pure)
(function () {
  'use strict';
  var G = globalThis.G;

  function R() { return G.data.rules; }
  function defs() { return G.data.systems.defs; }

  // ------------------------------------------------------------------ construction
  function makeRoom(r, i) {
    return {
      id: i, x: r.x, y: r.y, w: r.w, h: r.h, sys: r.sys || null,
      o2: 100, fire: 0, breach: 0, fireT: 0, fireProg: 0, breachProg: 0, sysFireProg: 0,
    };
  }

  function makeWeapon(run, id) {
    return { uid: G.U.uid(run, 'w'), id: id, on: false, want: false, charge: 0, target: null };
  }

  // Station systems in the order crew are assigned to them.
  var STATION_ORDER = ['piloting', 'weapons', 'shields', 'engines'];

  function build(run, spec) {
    var ship = {
      id: spec.id, name: spec.name || '', templateId: spec.templateId || null, faction: spec.faction || 'player',
      crewless: !!spec.crewless, boss: !!spec.boss, elite: !!spec.elite,
      w: spec.w, h: spec.h, tint: spec.tint || '#8ea6cf',
      rooms: spec.rooms.map(makeRoom),
      systems: {},
      weapons: [], weaponSlots: spec.weaponSlots || 0,
      crew: [],
      hull: 0, hullMax: spec.hullMax, reactor: spec.reactor || 0,
      shieldLayers: 0, shieldCharge: 0,
      ftl: 0,
      missiles: spec.missiles || 0,
      fleeing: false, canFlee: false, canSurrender: false, surrenderOffered: false,
      volley: !!spec.volley,
      phase: 1, chargeMult: 1, surgeT: 0,
    };
    ship.hull = spec.hull != null ? spec.hull : spec.hullMax;

    // systems: only those with a level and a room
    var sysLevels = spec.systems || {};
    G.data.systems.order.forEach(function (sid) {
      var lvl = sysLevels[sid] || 0;
      if (lvl <= 0) return;
      var room = -1;
      for (var i = 0; i < ship.rooms.length; i++) if (ship.rooms[i].sys === sid) { room = i; break; }
      if (room < 0) return;
      ship.systems[sid] = { id: sid, room: room, level: lvl, power: 0, want: 0, damage: 0, ion: 0, ionT: 0, repairProg: 0 };
    });
    // clear room.sys for systems that are not installed
    ship.rooms.forEach(function (r) { if (r.sys && !ship.systems[r.sys]) r.sys = null; });

    (spec.weapons || []).forEach(function (wid) {
      if (G.data.weapons[wid]) ship.weapons.push(makeWeapon(run, wid));
    });
    if (ship.weaponSlots < ship.weapons.length) ship.weaponSlots = ship.weapons.length;

    // crew
    if (!ship.crewless) {
      var taken = [];
      (spec.crew || []).forEach(function (cs, idx) {
        var c = G.Crew.create(run, cs.race, cs.name || G.Crew.pickName(run, taken));
        taken.push(c.name);
        var room = cs.room != null ? cs.room : defaultRoom(ship, idx);
        G.Crew.place(ship, c, room);
        var rs = ship.rooms[room].sys;
        if (rs && defs()[rs].station && !stationedAt(ship, room, c)) c.station = room;
      });
    }

    if (ship.id === 'player') startingPower(ship);
    if (ship.systems.piloting) ship.systems.piloting.power = usable(ship.systems.piloting);
    return ship;
  }

  // Crew placement order: piloting, weapons, shields, engines, then the other rooms in id order.
  function defaultRoom(ship, idx) {
    var order = [];
    STATION_ORDER.forEach(function (sid) { if (ship.systems[sid]) order.push(ship.systems[sid].room); });
    for (var i = 0; i < ship.rooms.length; i++) if (order.indexOf(i) < 0) order.push(i);
    return order[idx % order.length];
  }

  function stationedAt(ship, roomId, except) {
    for (var i = 0; i < ship.crew.length; i++) {
      var c = ship.crew[i];
      if (c !== except && c.station === roomId) return c;
    }
    return null;
  }

  // shields full, weapons on, oxygen 1, engines full, medbay 1 — while reactor bars remain.
  function startingPower(ship) {
    var S = ship.systems;
    if (S.shields) while (addPower(ship, 'shields'));
    for (var i = 0; i < ship.weapons.length; i++) if (!ship.weapons[i].on && toggleBlock(ship, i) === '') toggleWeapon(ship, i);
    if (S.oxygen && S.oxygen.power < 1) addPower(ship, 'oxygen');
    if (S.engines) while (addPower(ship, 'engines'));
    if (S.medbay && S.medbay.power < 1) addPower(ship, 'medbay');
  }

  function createPlayer(run, shipId) {
    var t = G.data.ships[shipId];
    var taken = [];
    var crew = t.crew.map(function (c) {
      var name = c.name || G.Crew.pickName(run, taken);
      taken.push(name);
      return { race: c.race, room: c.room, name: name };
    });
    var ship = build(run, {
      id: 'player', name: t.name, templateId: t.id, faction: 'player', crewless: false, tint: t.tint,
      w: t.w, h: t.h, rooms: t.rooms, hullMax: t.hullMax, reactor: t.reactor, weaponSlots: t.weaponSlots,
      systems: t.systems, weapons: t.weapons, crew: crew,
    });
    ship.shieldLayers = maxLayers(ship);
    return ship;
  }

  // ------------------------------------------------------------------ geometry
  function adj(ship) {
    if (ship._adj && ship._adj.length === ship.rooms.length) return ship._adj;
    var n = ship.rooms.length, a = [], pairs = [];
    for (var i = 0; i < n; i++) a.push([]);
    for (i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        if (G.U.rectsTouch(ship.rooms[i], ship.rooms[j])) { a[i].push(j); a[j].push(i); pairs.push(i, j); }
      }
    }
    ship._adj = a;
    ship._pairs = pairs;   // flat [a0, b0, a1, b1, ...] for oxygen diffusion
    return a;
  }

  function pairs(ship) { adj(ship); return ship._pairs; }

  function roomAt(ship, gx, gy) {
    for (var i = 0; i < ship.rooms.length; i++) {
      var r = ship.rooms[i];
      if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h) return i;
    }
    return -1;
  }

  function roomCenter(ship, id) {
    var r = ship.rooms[id];
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  // Slot k sits on tile k (row-major); overflow slots wrap with a small offset.
  function slotPos(ship, id, slot) {
    var r = ship.rooms[id];
    if (slot == null || slot < 0) return roomCenter(ship, id);
    var n = r.w * r.h;
    var k = slot % n, lap = Math.floor(slot / n);
    var off = lap ? 0.18 * (lap % 2 ? 1 : -1) : 0;
    return { x: r.x + (k % r.w) + 0.5 + off, y: r.y + Math.floor(k / r.w) + 0.5 + off };
  }

  function sysRoom(ship, sysId) {
    var s = ship.systems[sysId];
    return s ? ship.rooms[s.room] : null;
  }

  function tiles(room) { return room.w * room.h; }

  // ------------------------------------------------------------------ power accounting
  function usable(sys) {
    if (!sys) return 0;
    return Math.max(0, sys.level - sys.damage - sys.ion);
  }

  function weaponPower(ship) {
    var p = 0;
    for (var i = 0; i < ship.weapons.length; i++) {
      var w = ship.weapons[i];
      if (w.on) p += G.data.weapons[w.id].power;
    }
    return p;
  }

  function syncWeaponPower(ship) {
    var ws = ship.systems.weapons;
    if (ws) ws.power = weaponPower(ship);
  }

  function reactorUsed(ship) {
    var order = G.data.systems.reactorOrder, used = 0;
    for (var i = 0; i < order.length; i++) {
      var s = ship.systems[order[i]];
      if (s) used += s.power;
    }
    return used + (ship.systems.weapons ? weaponPower(ship) : 0);
  }

  function reactorFree(ship) { return ship.reactor - reactorUsed(ship); }

  function isReactorSys(sysId) { return G.data.systems.reactorOrder.indexOf(sysId) >= 0; }

  // Can weapon `slot` (currently off) be turned on?  '' | 'reactor' | 'capacity' | 'broken'
  function toggleBlock(ship, slot) {
    var w = ship.weapons[slot];
    if (!w) return 'capacity';
    if (w.on) return '';
    var ws = ship.systems.weapons;
    if (!ws) return 'capacity';
    var p = G.data.weapons[w.id].power, cur = weaponPower(ship);
    if (cur + p > usable(ws)) return cur + p > ws.level ? 'capacity' : 'broken';
    if (reactorFree(ship) < p) return 'reactor';
    return '';
  }

  function toggleWeapon(ship, slot) {
    var w = ship.weapons[slot];
    if (!w) return false;
    if (w.on) {
      w.on = false; w.want = false;
      syncWeaponPower(ship);
      return true;
    }
    if (toggleBlock(ship, slot) !== '') return false;
    w.on = true; w.want = true;
    syncWeaponPower(ship);
    return true;
  }

  // Why addPower would fail: '' | 'noSystem' | 'max' | 'broken' | 'ion' | 'reactor' | 'fixed'
  function powerBlock(ship, sysId) {
    var s = ship.systems[sysId];
    if (!s) return 'noSystem';
    if (sysId === 'piloting') return 'fixed';
    if (sysId === 'weapons') {
      var first = -1;
      for (var i = 0; i < ship.weapons.length; i++) {
        if (ship.weapons[i].on) continue;
        if (first < 0) first = i;
        if (toggleBlock(ship, i) === '') return '';
      }
      if (first < 0) return 'max';
      var why = toggleBlock(ship, first);
      if (why === 'capacity') return 'max';
      if (why === 'broken') return s.damage > 0 || s.ion === 0 ? 'broken' : 'ion';
      return why;
    }
    if (s.power >= s.level) return 'max';
    if (s.power >= usable(s)) return s.power < s.level - s.damage ? 'ion' : 'broken';
    if (reactorFree(ship) < 1) return 'reactor';
    return '';
  }

  function addPower(ship, sysId) {
    var s = ship.systems[sysId];
    if (!s || sysId === 'piloting') return false;
    if (sysId === 'weapons') {
      for (var i = 0; i < ship.weapons.length; i++) {
        if (!ship.weapons[i].on && toggleBlock(ship, i) === '') return toggleWeapon(ship, i);
      }
      return false;
    }
    if (s.power < usable(s) && reactorFree(ship) >= 1) {
      s.power++;
      s.want = s.power;
      return true;
    }
    return false;
  }

  function removePower(ship, sysId) {
    var s = ship.systems[sysId];
    if (!s || sysId === 'piloting') return false;
    if (sysId === 'weapons') {
      for (var i = ship.weapons.length - 1; i >= 0; i--) {
        var w = ship.weapons[i];
        if (w.on) { w.on = false; w.want = false; syncWeaponPower(ship); return true; }
      }
      return false;
    }
    if (s.power <= 0) return false;
    s.power--;
    s.want = s.power;
    return true;
  }

  // After damage/ion and every tick: power <= usable; weapons off from the last slot (want kept).
  function enforcePower(ship) {
    var order = G.data.systems.reactorOrder, i, s;
    for (i = 0; i < order.length; i++) {
      s = ship.systems[order[i]];
      if (s && s.power > usable(s)) s.power = usable(s);
    }
    var ws = ship.systems.weapons;
    if (ws) {
      var cap = usable(ws), p = weaponPower(ship);
      for (i = ship.weapons.length - 1; i >= 0 && p > cap; i--) {
        var w = ship.weapons[i];
        if (w.on) { w.on = false; p -= G.data.weapons[w.id].power; }
      }
      ws.power = p;
    } else {
      for (i = 0; i < ship.weapons.length; i++) ship.weapons[i].on = false;
    }
    if (ship.systems.piloting) ship.systems.piloting.power = usable(ship.systems.piloting);
    // Reactor overflow guard (reactor never shrinks in normal play).
    var over = reactorUsed(ship) - ship.reactor;
    for (i = ship.weapons.length - 1; i >= 0 && over > 0; i--) {
      if (ship.weapons[i].on) { ship.weapons[i].on = false; over -= G.data.weapons[ship.weapons[i].id].power; }
    }
    if (ws) ws.power = weaponPower(ship);
    for (i = order.length - 1; i >= 0 && over > 0; i--) {
      s = ship.systems[order[i]];
      while (s && s.power > 0 && over > 0) { s.power--; over--; }
    }
  }

  // Raise power back toward `want` using only free reactor power: shields, engines, oxygen, medbay, then weapons.
  function restorePower(ship) {
    var order = G.data.systems.reactorOrder, i;
    var free = reactorFree(ship);
    for (i = 0; i < order.length && free > 0; i++) {
      var s = ship.systems[order[i]];
      if (!s) continue;
      var u = usable(s);
      while (s.power < s.want && s.power < u && free >= 1) { s.power++; free--; }
    }
    var ws = ship.systems.weapons;
    if (!ws) return;
    var cap = usable(ws), p = ws.power = weaponPower(ship);
    for (i = 0; i < ship.weapons.length; i++) {
      var w = ship.weapons[i];
      if (!w.want || w.on) continue;
      var need = G.data.weapons[w.id].power;
      if (need <= free && p + need <= cap) { w.on = true; free -= need; p += need; }
    }
    ws.power = p;
  }

  // ------------------------------------------------------------------ manning / evasion / ftl
  // The crew member manning sysId: standing (not walking) in the system room, room free of fire/breach,
  // system undamaged and usable > 0; the lowest slot wins. Crewless ships never have manning.
  function mannedBy(ship, sysId) {
    if (ship.crewless) return null;
    var s = ship.systems[sysId];
    if (!s || !defs()[sysId].station || usable(s) <= 0 || s.damage > 0) return null;
    var room = ship.rooms[s.room];
    if (room.fire > 0 || room.breach > 0) return null;
    var best = null;
    for (var i = 0; i < ship.crew.length; i++) {
      var c = ship.crew[i];
      if (c.room !== s.room || c.path.length || c.hp <= 0) continue;
      if (!best || c.slot < best.slot) best = c;
    }
    return best;
  }

  function isManned(ship, sysId) { return !!mannedBy(ship, sysId); }

  function maxLayers(ship) {
    var s = ship.systems.shields;
    return s ? Math.floor(s.power / 2) : 0;
  }

  function evasionInfo(ship) {
    var r = R();
    var eng = ship.systems.engines, pil = ship.systems.piloting;
    var info = { total: 0, base: 0, engMan: false, pilotMan: false, mult: 0, why: '' };
    if (!eng || eng.power <= 0) { info.why = 'engines'; return info; }
    var pu = usable(pil);
    if (!pil || pu <= 0) { info.why = 'piloting'; return info; }
    var pilotMan = !ship.crewless && isManned(ship, 'piloting');
    if (!ship.crewless && !pilotMan && pu <= 1) { info.why = 'piloting'; return info; }
    var engMan = !ship.crewless && isManned(ship, 'engines');
    var mult = ship.crewless ? r.crewlessPilotMult : (pilotMan ? 1 : r.autopilot[Math.min(pu, r.autopilot.length - 1)]);
    var base = r.evasionByEngine[Math.min(eng.power, r.evasionByEngine.length - 1)];
    info.base = base;
    info.engMan = engMan;
    info.pilotMan = pilotMan;
    info.mult = mult;
    info.total = G.U.clamp(Math.round((base + (engMan ? r.evasionMannedEngines : 0)) * mult +
      (pilotMan ? r.evasionMannedPilot : 0)), 0, r.evasionMax);
    if (info.total === 0 && mult === 0) info.why = 'piloting';
    return info;
  }

  function evasion(ship) { return evasionInfo(ship).total; }

  function ftlTime(ship) {
    var r = R(), e = ship.systems.engines;
    return Math.max(r.ftlTimeMin, r.ftlTimeBase - r.ftlTimePerEngine * (e ? e.power : 0));
  }

  function canChargeFtl(ship) {
    var e = ship.systems.engines, p = ship.systems.piloting;
    if (!e || e.power <= 0 || !p) return false;
    var pu = usable(p);
    if (pu <= 0) return false;
    if (ship.crewless) return true;
    return isManned(ship, 'piloting') || R().autopilot[Math.min(pu, R().autopilot.length - 1)] > 0;
  }

  // ------------------------------------------------------------------ damage / ion
  function damageSystem(ship, sysId, n) {
    var s = ship.systems[sysId];
    if (!s || n <= 0) return 0;
    var before = s.damage;
    s.damage = Math.min(s.level, s.damage + n);
    enforcePower(ship);
    return s.damage - before;
  }

  function ionSystem(ship, sysId, n) {
    var s = ship.systems[sysId];
    if (!s || n <= 0) return 0;
    var before = s.ion;
    s.ion = Math.max(s.ion, Math.min(s.level, R().ionMaxStacks, s.ion + n));
    s.ionT = R().ionDuration;
    enforcePower(ship);
    return s.ion - before;
  }

  // After a jump: damage 0, ion 0, fires/breaches 0, o2 100, progress reset, shields full. Hull untouched.
  function jumpReset(ship) {
    Object.keys(ship.systems).forEach(function (k) {
      var s = ship.systems[k];
      s.damage = 0; s.ion = 0; s.ionT = 0; s.repairProg = 0;
    });
    ship.rooms.forEach(function (r) {
      r.fire = 0; r.breach = 0; r.o2 = 100; r.fireT = 0; r.fireProg = 0; r.breachProg = 0; r.sysFireProg = 0;
    });
    enforcePower(ship);
    restorePower(ship);
    ship.shieldLayers = maxLayers(ship);
    ship.shieldCharge = 0;
  }

  // ------------------------------------------------------------------ queries
  // Rooms a beam starting at roomId sweeps: the target, then same-row rooms to the right (ascending x),
  // then to the left (descending x); truncated to len.
  function beamRooms(ship, roomId, len) {
    var t = ship.rooms[roomId];
    if (!t) return [];
    var row = t.y, right = [], left = [];
    for (var i = 0; i < ship.rooms.length; i++) {
      if (i === roomId) continue;
      var r = ship.rooms[i];
      if (!(r.y <= row && row < r.y + r.h)) continue;
      if (r.x > t.x) right.push(r); else if (r.x < t.x) left.push(r);
    }
    right.sort(function (a, b) { return a.x - b.x || a.id - b.id; });
    left.sort(function (a, b) { return b.x - a.x || a.id - b.id; });
    var out = [roomId];
    for (i = 0; i < right.length; i++) out.push(right[i].id);
    for (i = 0; i < left.length; i++) out.push(left[i].id);
    return out.slice(0, Math.max(1, len || 1));
  }

  function aliveCrew(ship) {
    return ship.crew.filter(function (c) { return c.hp > 0; });
  }

  function aliveCount(ship) {
    var n = 0;
    for (var i = 0; i < ship.crew.length; i++) if (ship.crew[i].hp > 0) n++;
    return n;
  }

  G.Ship = {
    STATION_ORDER: STATION_ORDER,
    build: build, createPlayer: createPlayer,
    adj: adj, pairs: pairs, roomAt: roomAt, roomCenter: roomCenter, slotPos: slotPos, sysRoom: sysRoom, tiles: tiles,
    usable: usable, weaponPower: weaponPower, reactorUsed: reactorUsed, reactorFree: reactorFree,
    isReactorSys: isReactorSys,
    addPower: addPower, removePower: removePower, toggleWeapon: toggleWeapon,
    powerBlock: powerBlock, toggleBlock: toggleBlock,
    enforcePower: enforcePower, restorePower: restorePower,
    maxLayers: maxLayers, evasion: evasion, evasionInfo: evasionInfo,
    ftlTime: ftlTime, canChargeFtl: canChargeFtl,
    isManned: isManned, mannedBy: mannedBy,
    damageSystem: damageSystem, ionSystem: ionSystem,
    jumpReset: jumpReset,
    beamRooms: beamRooms, aliveCrew: aliveCrew, aliveCount: aliveCount,
    stationedAt: stationedAt,
  };
})();
