// Enemy AI (SPEC §5 Enemy AI): initial power + stations, weapon targeting (every tick), crew orders,
// flee and surrender decisions (every rules.aiThinkInterval s). Pure; randomness via run.rng.
//   G.AI.init(run, combat) ; G.AI.step(run, combat, dt) ; G.AI.pickTarget(run, targetShip, weaponDef|null)
(function () {
  'use strict';
  var G = globalThis.G;

  function R() { return G.data.rules; }

  // Seconds without any hull / crew-HP change on either ship before a normal enemy disengages
  // (overridable by rules.stalemateTime).
  var STALEMATE_TIME = 90;

  function crewHp(ship) {
    var s = 0;
    for (var i = 0; i < ship.crew.length; i++) s += ship.crew[i].hp;
    return s;
  }

  // ------------------------------------------------------------------ init
  function init(run, combat) {
    var e = combat.enemy, S = e.systems, total = 0, i;
    G.data.systems.reactorOrder.forEach(function (sid) {
      if (!S[sid]) return;
      S[sid].want = S[sid].level;
      total += S[sid].level;
    });
    var cap = S.weapons ? S.weapons.level : 0, used = 0;
    for (i = 0; i < e.weapons.length; i++) {
      var w = e.weapons[i], def = G.data.weapons[w.id];
      w.on = false;
      w.want = false;
      if (used + def.power > cap) continue;
      if (def.missile > 0 && e.missiles < def.missile) continue;
      w.want = true;
      used += def.power;
    }
    e.reactor = total + used;
    G.Ship.enforcePower(e);
    G.Ship.restorePower(e);
    assignStations(e);
    combat.aiT = 0;
  }

  // Crew without a station take the free stations in order piloting, weapons, shields, engines.
  function assignStations(e) {
    if (e.crewless) return;
    G.Ship.STATION_ORDER.forEach(function (sid) {
      var s = e.systems[sid];
      if (!s || G.Ship.stationedAt(e, s.room, null)) return;
      var c = G.U.find(e.crew, function (x) { return x.station == null; });
      if (!c) return;
      c.station = s.room;
      if (c.room !== s.room) G.Crew.place(e, c, s.room);
    });
  }

  // ------------------------------------------------------------------ targeting
  // Weighted room pick on `ship` by rules targetWeights; missiles weight shields x2, beams +1 per crew in the room.
  function roomWeight(ship, room, def) {
    var tw = G.data.enemies.targetWeights;
    var w = tw[room.sys || 'none'];
    if (w == null) w = tw.none;
    if (def && def.type === 'missile' && room.sys === 'shields') w *= 2;
    if (def && def.type === 'beam') {
      for (var i = 0; i < ship.crew.length; i++) if (ship.crew[i].room === room.id) w += 1;
    }
    return w;
  }

  function pickTarget(run, ship, def) {
    var rooms = ship.rooms, total = 0, i;
    for (i = 0; i < rooms.length; i++) total += roomWeight(ship, rooms[i], def);
    if (total <= 0) return G.RNG.int(run.rng, 0, rooms.length - 1);
    var x = G.RNG.next(run.rng) * total;
    for (i = 0; i < rooms.length; i++) {
      x -= roomWeight(ship, rooms[i], def);
      if (x < 0) return i;
    }
    return rooms.length - 1;
  }

  function stepTargets(run, combat) {
    var e = combat.enemy;
    for (var i = 0; i < e.weapons.length; i++) {
      var w = e.weapons[i], def = G.data.weapons[w.id];
      if (w.on && w.target === null && w.charge >= def.charge) w.target = pickTarget(run, run.player, def);
    }
  }

  // ------------------------------------------------------------------ think
  function think(run, combat) {
    var e = combat.enemy, r = R();
    // Missile weapons are unpowered when the stock runs out.
    for (var i = 0; i < e.weapons.length; i++) {
      var w = e.weapons[i], def = G.data.weapons[w.id];
      if (def.missile > 0 && e.missiles < def.missile && (w.on || w.want)) {
        w.on = false; w.want = false;
        G.Ship.enforcePower(e);
      }
    }
    thinkCrew(e);

    if (e.hull > 0 && e.canFlee && !e.fleeing && e.hull <= r.enemyFleeHullFrac * e.hullMax) {
      e.fleeing = true;
      G.U.fx(run, { t: 'enemyFleeing' });
      G.Combat.say(run, '敌舰正在为跃迁引擎充能！', 'warn');
    }
    // Stalemate: nobody has lost hull or crew HP for a long time (e.g. shields neither side can get through).
    // A normal enemy gives up and jumps away, so a stranded player (fuel 0) is never locked in a fight.
    // (Elite fights escalate the fleet barrage instead; the flagship never leaves.)
    var f = combat.flags || (combat.flags = {});
    var sig = run.player.hull + ':' + e.hull + ':' + Math.round(crewHp(run.player)) + ':' + Math.round(crewHp(e));
    if (f.calmSig !== sig) { f.calmSig = sig; f.calmT = 0; } else f.calmT = (f.calmT || 0) + r.aiThinkInterval;
    var calmMax = r.stalemateTime || STALEMATE_TIME;
    if (e.hull > 0 && !combat.boss && !combat.elite && !e.fleeing && f.calmT >= calmMax) {
      e.fleeing = true;
      G.U.fx(run, { t: 'enemyFleeing' });
      G.Combat.say(run, '双方僵持不下，敌舰放弃交战，正在为跃迁引擎充能。', 'warn');
    }
    if (e.hull > 0 && e.canSurrender && !e.surrenderOffered && !combat.offer &&
        e.hull <= r.enemySurrenderHullFrac * e.hullMax) {
      combat.offer = surrenderOffer(run, combat);
      e.surrenderOffered = true;
    }
  }

  // Expected reward (no RNG) x surrenderMult. The real reward is rolled by G.Run.finishCombat.
  function surrenderOffer(run, combat) {
    var rw = R().reward, D = R().difficulty;
    var diff = D[run.difficulty || 'normal'] || D.normal;
    var type = run.sector && G.data.sectors.types[run.sector.type];
    var avg = (rw.scrapBase[0] + rw.scrapBase[1]) / 2;
    var scrap = Math.round(avg * (1 + rw.scrapPerSector * (run.sectorIndex || 0)) * (type ? type.rewardMult : 1) *
      (combat.rewardMult || 1) * diff.scrapMult * rw.surrenderMult * (G.U.hasAug(run, 'scrap_arm') ? R().augmentFx.scrapMult : 1));
    var fuel = Math.round(rw.fuelChance * (rw.fuel[0] + rw.fuel[1]) / 2);
    var missiles = Math.round(rw.missileChance * (rw.missiles[0] + rw.missiles[1]) / 2);
    return {
      type: 'surrender', scrap: scrap, fuel: fuel, missiles: missiles,
      text: '“别开火！我们投降！”敌舰愿意交出物资换取活路。',
    };
  }

  function roomProblem(ship, room) {
    if (room.fire > 0) return 3;
    if (room.breach > 0) return 2;
    var s = room.sys ? ship.systems[room.sys] : null;
    if (s && s.damage > 0) return 1;
    return 0;
  }

  function thinkCrew(e) {
    if (e.crewless || !e.crew.length) return;
    var crew = e.crew, i, c;
    var med = e.systems.medbay;
    var medOk = !!(med && med.power > 0 && e.rooms[med.room].fire === 0 && e.rooms[med.room].o2 >= R().suffocateBelow);
    var healing = [];
    // 1. badly hurt crew go to a working medbay until >= 90%
    for (i = 0; i < crew.length; i++) {
      c = crew[i];
      var h = false;
      if (medOk) {
        if (G.Crew.dest(c) === med.room && c.hp < 0.9 * c.hpMax) h = true;
        else if (c.hp < 0.35 * c.hpMax && G.Crew.moveTo(e, c, med.room)) h = true;
      }
      healing.push(h);
    }
    // 2. one crew per problem room: fire > breach > damaged system; nearest available crew
    for (var prio = 3; prio >= 1; prio--) {
      for (var k = 0; k < e.rooms.length; k++) {
        var room = e.rooms[k];
        if (roomProblem(e, room) !== prio) continue;
        var covered = false;
        for (i = 0; i < crew.length; i++) if (G.Crew.dest(crew[i]) === k) { covered = true; break; }
        if (covered) continue;
        var best = -1, bestLen = 1e9;
        for (i = 0; i < crew.length; i++) {
          c = crew[i];
          if (healing[i] || c.path.length || roomProblem(e, e.rooms[c.room]) > 0) continue;
          var p = G.Crew.path(e, c.room, k);
          if (p && p.length < bestLen) { bestLen = p.length; best = i; }
        }
        if (best >= 0) G.Crew.moveTo(e, crew[best], k);
      }
    }
    // 3. idle crew return to their stations
    for (i = 0; i < crew.length; i++) {
      c = crew[i];
      if (healing[i] || c.path.length || c.station == null || c.room === c.station) continue;
      if (roomProblem(e, e.rooms[c.room]) > 0) continue;
      G.Crew.moveTo(e, c, c.station);
    }
  }

  // ------------------------------------------------------------------ step
  function step(run, combat, dt) {
    if (combat.enemy.hull <= 0) return;
    stepTargets(run, combat);
    combat.aiT += dt;
    var iv = R().aiThinkInterval;
    if (combat.aiT >= iv) {
      combat.aiT -= iv;
      think(run, combat);
    }
  }

  G.AI = { init: init, step: step, pickTarget: pickTarget, surrenderOffer: surrenderOffer };
})();
