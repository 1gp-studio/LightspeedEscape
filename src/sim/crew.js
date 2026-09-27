// Crew: creation, placement, BFS movement between rooms, room work (fire > breach > repair > man),
// crew damage (fire, suffocation), medbay healing and deaths. Pure; randomness only via run.rng.
//   G.Crew.create(run, race, name?) / place(ship, crew, roomId) / order(ship, crewId, roomId)
//   G.Crew.step(run, ship, dt, ctx)  ctx = { fx: function (ev) {...}, inCombat }
//   G.Crew.pos(ship, crew) -> {x, y} interpolated grid coordinates (for the renderer)
(function () {
  'use strict';
  var G = globalThis.G;

  function R() { return G.data.rules; }
  function race(c) { return G.data.crew.races[c.race] || G.data.crew.races.human; }

  function emit(run, ctx, ev) {
    if (ctx && ctx.fx) ctx.fx(ev); else G.U.fx(run, ev);
  }

  // ------------------------------------------------------------------ creation / placement
  // A crew name not in `taken` and not used by the player's crew.
  function pickName(run, taken) {
    var used = (taken || []).slice();
    if (run.player && run.player.crew) run.player.crew.forEach(function (c) { used.push(c.name); });
    var pool = G.data.crew.names.filter(function (n) { return used.indexOf(n) < 0; });
    if (pool.length) return G.RNG.pick(run.rng, pool);
    var base = G.RNG.pick(run.rng, G.data.crew.names);
    for (var k = 2; ; k++) if (used.indexOf(base + k) < 0) return base + k;
  }

  function create(run, raceId, name) {
    var rc = G.data.crew.races[raceId] || G.data.crew.races.human;
    return {
      id: G.U.uid(run, 'c'), name: name || pickName(run, []), race: rc.id,
      hp: rc.hp, hpMax: rc.hp, room: 0, slot: 0, path: [], hopT: 0, station: null, task: 'idle',
    };
  }

  // Lowest slot not used by another crew member standing in roomId.
  function freeSlot(ship, roomId, self) {
    for (var s = 0; ; s++) {
      var used = false;
      for (var i = 0; i < ship.crew.length; i++) {
        var c = ship.crew[i];
        if (c !== self && c.room === roomId && !c.path.length && c.slot === s) { used = true; break; }
      }
      if (!used) return s;
    }
  }

  function place(ship, crew, roomId) {
    if (ship.crew.indexOf(crew) < 0) ship.crew.push(crew);
    crew.room = roomId;
    crew.path = [];
    crew.hopT = 0;
    crew.slot = freeSlot(ship, roomId, crew);
    crew.task = 'idle';
  }

  // ------------------------------------------------------------------ movement
  // BFS shortest room path from a to b (excluding a, including b). [] if a === b; null if unreachable.
  function path(ship, a, b) {
    if (a === b) return [];
    var adj = G.Ship.adj(ship), n = ship.rooms.length;
    var prev = new Array(n);
    for (var i = 0; i < n; i++) prev[i] = -2;
    prev[a] = -1;
    var q = [a], h = 0;
    while (h < q.length) {
      var cur = q[h++];
      if (cur === b) break;
      var nb = adj[cur];
      for (var k = 0; k < nb.length; k++) {
        if (prev[nb[k]] === -2) { prev[nb[k]] = cur; q.push(nb[k]); }
      }
    }
    if (prev[b] === -2) return null;
    var out = [];
    for (var x = b; x !== a; x = prev[x]) out.unshift(x);
    return out;
  }

  function hopDur(ship, from, to, c) {
    var A = ship.rooms[from], B = ship.rooms[to];
    var dx = (A.x + A.w / 2) - (B.x + B.w / 2), dy = (A.y + A.h / 2) - (B.y + B.h / 2);
    return Math.max(0.05, Math.sqrt(dx * dx + dy * dy) / (R().crewWalkTilesPerSec * race(c).speed));
  }

  // The room a crew member stands in or is heading to.
  function dest(c) { return c.path.length ? c.path[c.path.length - 1] : c.room; }

  // Walk to roomId without touching crew.station (used by orders and the enemy AI).
  function moveTo(ship, c, roomId) {
    if (roomId < 0 || roomId >= ship.rooms.length) return false;
    if (c.path.length) {
      // Mid-hop: finish the current hop, then route from there.
      var next = c.path[0];
      var rest = path(ship, next, roomId);
      if (!rest) return false;
      c.path = [next].concat(rest);
    } else {
      if (c.room === roomId) return true;
      var p = path(ship, c.room, roomId);
      if (!p) return false;
      c.path = p;
      c.hopT = 0;
    }
    c.task = 'walk';
    return true;
  }

  function order(ship, crewId, roomId) {
    var c = G.U.byId(ship.crew, crewId);
    if (!c || c.hp <= 0 || roomId == null || roomId < 0 || roomId >= ship.rooms.length) return false;
    if (!moveTo(ship, c, roomId)) return false;
    // Saved stations stick: sending someone to help elsewhere never empties their own post.
    // A crew member takes over a free station only when they have none, or when it outranks
    // their current one (e.g. the gunner moving into an empty cockpit after the pilot died).
    var sid = ship.rooms[roomId].sys;
    if (sid && ship.systems[sid] && G.data.systems.defs[sid].station && !G.Ship.stationedAt(ship, roomId, c) &&
        stationRank(ship, roomId) < stationRank(ship, c.station)) {
      c.station = roomId;
    }
    return true;
  }

  var STATION_ORDER = ['piloting', 'weapons', 'shields', 'engines'];
  // Lower = more important; no station / unknown = Infinity.
  function stationRank(ship, roomId) {
    if (roomId == null || !ship.rooms[roomId]) return Infinity;
    var k = STATION_ORDER.indexOf(ship.rooms[roomId].sys);
    return k < 0 ? STATION_ORDER.length : k;
  }

  function stationRoom(ship, sid) {
    if (!ship.systems[sid]) return -1;
    for (var r = 0; r < ship.rooms.length; r++) if (ship.rooms[r].sys === sid) return r;
    return -1;
  }

  // Fill empty stations in priority order (piloting > weapons > shields > engines) from crew
  // without a station; the cockpit may also take the holder of the least important station.
  // Then everyone walks back to their station.
  function returnToStations(ship) {
    var alive = ship.crew.filter(function (c) { return c.hp > 0; });
    for (var k = 0; k < STATION_ORDER.length; k++) {
      var room = stationRoom(ship, STATION_ORDER[k]);
      if (room < 0 || G.Ship.stationedAt(ship, room)) continue;
      var pick = null;
      alive.forEach(function (c) { if (!pick && c.station == null) pick = c; });
      if (!pick && k === 0) {
        alive.forEach(function (c) {
          if (stationRank(ship, c.station) > 0 && (!pick || stationRank(ship, c.station) > stationRank(ship, pick.station))) pick = c;
        });
      }
      if (pick) pick.station = room;
    }
    for (var i = 0; i < ship.crew.length; i++) {
      var c = ship.crew[i];
      if (c.station != null && dest(c) !== c.station) moveTo(ship, c, c.station);
    }
  }

  // Interpolated position in grid units.
  function pos(ship, c) {
    if (!c.path.length) return G.Ship.slotPos(ship, c.room, c.slot);
    var from = c.slot >= 0 ? G.Ship.slotPos(ship, c.room, c.slot) : G.Ship.roomCenter(ship, c.room);
    var last = c.path.length === 1;
    var to = last ? G.Ship.slotPos(ship, c.path[0], freeSlot(ship, c.path[0], c)) : G.Ship.roomCenter(ship, c.path[0]);
    var f = G.U.clamp(c.hopT / hopDur(ship, c.room, c.path[0], c), 0, 1);
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
  }

  function stepMove(ship, c, dt) {
    if (!c.path.length) return;
    c.task = 'walk';
    c.hopT += dt;
    var dur = hopDur(ship, c.room, c.path[0], c);
    while (c.path.length && c.hopT >= dur) {
      c.hopT -= dur;
      c.room = c.path.shift();
      c.slot = -1;
      if (c.path.length) dur = hopDur(ship, c.room, c.path[0], c);
    }
    if (!c.path.length) {
      c.hopT = 0;
      c.slot = freeSlot(ship, c.room, c);
      c.task = 'idle';
    }
  }

  // ------------------------------------------------------------------ per-tick
  function step(run, ship, dt, ctx) {
    var r = R(), crew = ship.crew, rooms = ship.rooms, i, k, c;
    if (!crew.length) return;

    // 1. movement
    for (i = 0; i < crew.length; i++) stepMove(ship, crew[i], dt);

    // 2. work, per room: fire > breach > repair > man
    for (k = 0; k < rooms.length; k++) {
      var room = rooms[k];
      var fireRate = 0, repRate = 0, present = 0;
      for (i = 0; i < crew.length; i++) {
        c = crew[i];
        if (c.room !== k || c.path.length) continue;
        var rc = race(c);
        present++;
        fireRate += r.fireExtRate * rc.fire;
        repRate += rc.repair;
      }
      if (!present) continue;
      var sys = room.sys ? ship.systems[room.sys] : null;
      var task;
      if (room.fire > 0) {
        task = 'fire';
        room.fireProg += fireRate * dt;
        while (room.fireProg >= 1 && room.fire > 0) { room.fire--; room.fireProg -= 1; }
        if (room.fire === 0) { room.fireProg = 0; room.fireT = 0; room.sysFireProg = 0; }
      } else if (room.breach > 0) {
        task = 'breach';
        room.breachProg += r.breachRate * repRate * dt;
        while (room.breachProg >= 1 && room.breach > 0) { room.breach--; room.breachProg -= 1; }
        if (room.breach === 0) room.breachProg = 0;
      } else if (sys && sys.damage > 0) {
        task = 'repair';
        sys.repairProg += r.repairRate * repRate * dt;
        while (sys.repairProg >= 1 && sys.damage > 0) { sys.damage--; sys.repairProg -= 1; }
        if (sys.damage === 0) sys.repairProg = 0;
      } else {
        task = 'idle';
      }
      var manner = task === 'idle' && sys ? G.Ship.mannedBy(ship, room.sys) : null;
      if (manner && manner.slot !== 0) {
        // the manning crew takes slot 0
        for (i = 0; i < crew.length; i++) {
          c = crew[i];
          if (c !== manner && c.room === k && !c.path.length && c.slot === 0) { c.slot = manner.slot; break; }
        }
        manner.slot = 0;
      }
      for (i = 0; i < crew.length; i++) {
        c = crew[i];
        if (c.room !== k || c.path.length) continue;
        c.task = c === manner ? 'man' : task;
      }
    }

    // 3. damage and healing
    var med = ship.systems.medbay;
    var heal = med && med.power > 0 ? r.medbayHps[Math.min(med.power, r.medbayHps.length - 1)] : 0;
    for (i = 0; i < crew.length; i++) {
      c = crew[i];
      var rm = rooms[c.room];
      if (rm.fire > 0 && !race(c).fireImmune) c.hp -= (r.fireCrewDps + r.fireCrewDpsPerTile * rm.fire) * dt;
      if (!ship.crewless && rm.o2 < r.suffocateBelow) c.hp -= r.suffocateDps * dt;
      if (heal > 0 && c.room === med.room && !c.path.length && rm.fire === 0 && c.hp > 0 && c.hp < c.hpMax) {
        c.hp = Math.min(c.hpMax, c.hp + heal * dt);
      }
    }

    // 4. deaths
    removeDead(run, ship, ctx);
  }

  function removeDead(run, ship, ctx) {
    for (var i = ship.crew.length - 1; i >= 0; i--) {
      var c = ship.crew[i];
      if (c.hp > 0) continue;
      ship.crew.splice(i, 1);
      emit(run, ctx, { t: 'crewDied', side: ship.id, name: c.name });
      if (ship.id === 'player' && run.stats) run.stats.crewLost = (run.stats.crewLost || 0) + 1;
    }
  }

  // Damage every crew member in a room (weapon hits). Deaths are processed on the next Crew.step.
  function damageRoom(ship, roomId, amount) {
    if (amount <= 0) return;
    for (var i = 0; i < ship.crew.length; i++) {
      if (ship.crew[i].room === roomId) ship.crew[i].hp -= amount;
    }
  }

  G.Crew = {
    create: create, place: place, order: order, returnToStations: returnToStations,
    step: step, pos: pos,
    // helpers shared with ship.js / ai.js
    pickName: pickName, freeSlot: freeSlot, path: path, moveTo: moveTo, dest: dest,
    damageRoom: damageRoom, removeDead: removeDead,
  };
})();
