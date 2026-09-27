// Real-time combat (SPEC §5): per-ship systems tick (power, crew, environment, shields, weapon charge,
// FTL), weapon firing + volley, projectiles and beams, hazards, flagship phase 2 / surges, end-of-combat
// pending/result. Pure; all randomness via run.rng. Fx go to run._fx (G.U.fx).
//   G.Combat.create(run, spec) ; step(run, dt) ; stepShip(run, ship, dt, ctx) ; idle(run, dt)
//   setTarget / setVolley / weaponState (pure) / canFlee / answerOffer / previewBeam / say / drainFx
(function () {
  'use strict';
  var G = globalThis.G;

  function R() { return G.data.rules; }
  function W(id) { return G.data.weapons[id]; }

  // Fleet-barrage escalation defaults (overridable by rules.fleetEscalateEvery / rules.fleetEscalateMax).
  var FLEET_ESCALATE_EVERY = 60;   // seconds in a 'fleet' fight per extra shell in each barrage
  var FLEET_ESCALATE_MAX = 6;      // shells per barrage at most
  function fx(run, ev) { G.U.fx(run, ev); }

  // Cached tick contexts (runtime only; `_` keys are dropped on save).
  function ctxOf(run, inCombat) {
    var key = inCombat ? '_ctxC' : '_ctxI';
    if (!run[key]) run[key] = { fx: function (ev) { G.U.fx(run, ev); }, inCombat: inCombat };
    return run[key];
  }

  function other(run, ship) { return ship.id === 'player' ? run.combat.enemy : run.player; }
  function shipBySide(run, side) { return side === 'player' ? run.player : (run.combat ? run.combat.enemy : null); }

  // ------------------------------------------------------------------ create
  function create(run, spec) {
    spec = spec || {};
    var r = R(), rng = run.rng;
    var beacon = run.sector && run.sector.beacons ? run.sector.beacons[run.at] : null;
    var type = run.sector && G.data.sectors.types[run.sector.type];
    var faction = spec.faction;
    if (!faction || faction === 'sector') {
      faction = (beacon && beacon.faction) || (type ? G.RNG.weightedKey(rng, type.factions) : 'rebel');
    }
    if (spec.boss) faction = G.data.enemies.flagship.faction || 'rebel';
    var hazard = spec.hazard || (spec.elite ? 'fleet' : (beacon && beacon.hazard)) || 'none';
    var enemy = spec.boss ? G.Enemies.flagship(run) : G.Enemies.generate(run, { faction: faction, elite: !!spec.elite });

    var hz = { player: 0, enemy: 0, flare: 0, fleet: 0 };
    if (hazard === 'asteroid') {
      hz.player = G.RNG.range(rng, r.asteroidInterval[0], r.asteroidInterval[1]);
      hz.enemy = G.RNG.range(rng, r.asteroidInterval[0], r.asteroidInterval[1]);
    } else if (hazard === 'sun') {
      hz.flare = G.RNG.range(rng, r.flareInterval[0], r.flareInterval[1]);
    } else if (hazard === 'fleet') {
      hz.fleet = G.RNG.range(rng, r.fleetShotInterval[0], r.fleetShotInterval[1]);
    }

    var combat = {
      enemy: enemy, faction: faction, elite: !!spec.elite, boss: !!spec.boss,
      rewardMult: spec.rewardMult != null ? spec.rewardMult : (spec.elite ? r.reward.eliteMult : 1),
      hazard: hazard, hazardT: hz,
      time: 0, aiT: 0,
      projectiles: [], beams: [],
      pending: null, pendingT: 0, result: null,
      offer: null, msg: null, flags: {},
    };
    run.combat = combat;
    G.AI.init(run, combat);

    // combat-start resets
    var p = run.player;
    G.Ship.enforcePower(p);
    G.Ship.restorePower(p);
    p.ftl = 0;
    var pre = G.U.hasAug(run, 'pre_igniter');
    p.weapons.forEach(function (w) {
      w.target = null;
      w.charge = pre && w.on ? W(w.id).charge : 0;
    });
    enemy.weapons.forEach(function (w) {
      w.charge = G.RNG.range(rng, 0, 0.25) * W(w.id).charge;
      w.target = null;
    });
    enemy.ftl = 0;
    enemy.fleeing = false;
    [p, enemy].forEach(function (s) {
      s.shieldLayers = G.Ship.maxLayers(s);
      s.shieldCharge = 0;
    });
    fx(run, { t: 'combatStart', boss: combat.boss, elite: combat.elite });
    return combat;
  }

  // ------------------------------------------------------------------ per-ship tick
  function canChargeWeapons(run) {
    var c = run.combat;
    return !!(c && !c.pending && !c.result);
  }

  function stepShip(run, ship, dt, ctx) {
    var r = R(), S = ship.systems, i, k;
    ctx = ctx || ctxOf(run, !!run.combat);
    var isPlayer = ship.id === 'player';

    // 1. ion decay
    for (k in S) {
      var s = S[k];
      if (s.ion > 0) {
        s.ionT -= dt;
        if (s.ionT <= 0) {
          s.ion--;
          s.ionT = s.ion > 0 ? r.ionDuration : 0;
        }
      }
    }
    // 2. power
    G.Ship.enforcePower(ship);
    G.Ship.restorePower(ship);

    // 3. crew
    G.Crew.step(run, ship, dt, ctx);

    // 4. crewless self-repair on the most damaged system
    if (ship.crewless) {
      var worst = null;
      var order = G.data.systems.order;
      for (i = 0; i < order.length; i++) {
        var sy = S[order[i]];
        if (sy && sy.damage > 0 && (!worst || sy.damage > worst.damage)) worst = sy;
      }
      if (worst) {
        worst.repairProg += r.crewlessSelfRepair * dt;
        if (worst.repairProg >= 1) { worst.damage--; worst.repairProg = 0; }
      }
    }

    // 5. environment
    stepEnvironment(run, ship, dt, ctx);
    G.Ship.enforcePower(ship);

    // 6. shields
    var ml = G.Ship.maxLayers(ship);
    if (ship.shieldLayers > ml) ship.shieldLayers = ml;
    if (ship.shieldLayers >= ml) ship.shieldCharge = 0;
    else {
      var mult = G.Ship.isManned(ship, 'shields') ? r.mannedShieldMult : 1;
      var boost = isPlayer && G.U.hasAug(run, 'shield_booster') ? r.augmentFx.shieldBoosterMult : 1;
      ship.shieldCharge += dt / r.shieldRecharge * mult / boost;
      if (ship.shieldCharge >= 1) { ship.shieldLayers++; ship.shieldCharge = 0; }
    }

    // 7. weapons
    var charging = ctx.inCombat && canChargeWeapons(run);
    var cm = 1;
    if (charging) {
      cm = (G.Ship.isManned(ship, 'weapons') ? r.mannedWeaponMult : 1) * (ship.chargeMult || 1) *
        (isPlayer && G.U.hasAug(run, 'auto_loader') ? r.augmentFx.autoLoaderMult : 1);
    }
    for (i = 0; i < ship.weapons.length; i++) {
      var w = ship.weapons[i], full = W(w.id).charge;
      if (w.on) {
        if (charging && w.charge < full) w.charge = Math.min(full, w.charge + dt * cm);
      } else if (w.charge > 0) {
        w.charge = Math.max(0, w.charge - r.weaponDecay * dt);
      }
    }

    // 8. player FTL (in combat only)
    if (isPlayer && ctx.inCombat && run.combat && !run.combat.result && ship.ftl < 1 && G.Ship.canChargeFtl(ship)) {
      var fm = G.U.hasAug(run, 'ftl_booster') ? r.augmentFx.ftlBoosterMult : 1;
      ship.ftl = Math.min(1, ship.ftl + dt / G.Ship.ftlTime(ship) * fm);
    }
  }

  function stepEnvironment(run, ship, dt, ctx) {
    var r = R(), rooms = ship.rooms, rng = run.rng, i;
    var crewless = ship.crewless;
    if (!crewless) {
      var ox = ship.systems.oxygen;
      var rate = ox && ox.power > 0 ? r.oxygenRate[Math.min(ox.power, r.oxygenRate.length - 1)] : -r.oxygenLeak;
      for (i = 0; i < rooms.length; i++) {
        var rm = rooms[i];
        rm.o2 += (rate - r.breachDrain * rm.breach - r.fireO2Use * rm.fire) * dt;
      }
      var pr = G.Ship.pairs(ship), f = Math.min(0.5, r.oxygenDiffuse * dt);
      for (i = 0; i < pr.length; i += 2) {
        var a = rooms[pr[i]], b = rooms[pr[i + 1]];
        var d = (b.o2 - a.o2) * f;
        a.o2 += d; b.o2 -= d;
      }
      for (i = 0; i < rooms.length; i++) rooms[i].o2 = G.U.clamp(rooms[i].o2, 0, 100);
    } else {
      for (i = 0; i < rooms.length; i++) rooms[i].o2 = 100;
    }

    for (i = 0; i < rooms.length; i++) {
      var room = rooms[i];
      if (room.fire <= 0) continue;
      // fire damages the room's system
      var sys = room.sys ? ship.systems[room.sys] : null;
      if (sys) {
        room.sysFireProg += r.fireSysDmgRate * room.fire * dt;
        if (room.sysFireProg >= 1) {
          room.sysFireProg -= 1;
          if (sys.damage < sys.level) {
            G.Ship.damageSystem(ship, room.sys, 1);
            ctx.fx({ t: 'sysDamage', side: ship.id, sys: room.sys });
          }
        }
      }
      room.fireT += dt;
      if (room.fireT < r.fireGrowInterval) continue;
      room.fireT -= r.fireGrowInterval;
      if (crewless || room.o2 < r.fireDieBelowO2) {
        room.fire--;
      } else {
        var t = G.Ship.tiles(room);
        if (room.o2 >= r.fireNeedO2 && room.fire < t && G.RNG.chance(rng, r.fireGrowChance)) room.fire++;
        if (G.RNG.chance(rng, r.fireSpreadChance * room.fire / t)) {
          var nb = G.Ship.adj(ship)[i].filter(function (j) { return rooms[j].fire === 0; });
          if (nb.length) {
            var tgt = rooms[G.RNG.pick(rng, nb)];
            tgt.fire = 1; tgt.fireT = 0; tgt.fireProg = 0;
            ctx.fx({ t: 'fire', side: ship.id, room: tgt.id });
          }
        }
      }
      if (room.fire <= 0) { room.fire = 0; room.fireT = 0; room.fireProg = 0; room.sysFireProg = 0; }
    }
  }

  // ------------------------------------------------------------------ weapons
  function hasAmmo(run, ship, def) {
    if (!def.missile) return true;
    return ship.id === 'player' ? run.res.missiles >= def.missile : ship.missiles >= def.missile;
  }

  // Volley eligibility: player = on && targeted && has ammo; enemy = on && has ammo (AI targets when charged).
  function eligible(run, ship, w) {
    if (!w.on) return false;
    if (ship.id === 'player' && w.target === null) return false;
    return hasAmmo(run, ship, W(w.id));
  }

  function volleyOn(run, ship) { return ship.id === 'player' ? !!run.volley : !!ship.volley; }

  function whyOf(run, ship, slot) {
    var w = ship.weapons[slot];
    if (!w) return 'off';
    var def = W(w.id);
    if (!w.on) return 'off';
    if (!run.combat || run.combat.pending || run.combat.result) return 'noCombat';
    if (!hasAmmo(run, ship, def)) return 'noMissiles';
    if (w.charge < def.charge) return 'charging';
    if (w.target === null) return 'noTarget';
    if (volleyOn(run, ship)) {
      for (var i = 0; i < ship.weapons.length; i++) {
        var o = ship.weapons[i];
        if (o !== w && eligible(run, ship, o) && o.charge < W(o.id).charge) return 'volley';
      }
    }
    return '';
  }

  function weaponState(run, ship, slot) {
    var w = ship.weapons[slot];
    if (!w) return { frac: 0, ready: false, why: 'off' };
    var why = whyOf(run, ship, slot);
    return { frac: G.U.clamp(w.charge / W(w.id).charge, 0, 1), ready: why === '', why: why };
  }

  function fireWeapons(run, ship) {
    var c = run.combat, tgtShip = other(run, ship), i;
    // Decide the whole volley first: a weapon that fires resets its charge, which must not make the
    // weapons after it in slot order wait for "the volley" again.
    var ready = 0;
    for (i = 0; i < ship.weapons.length; i++) if (whyOf(run, ship, i) === '') ready |= 1 << i;
    if (!ready) return;
    for (i = 0; i < ship.weapons.length; i++) {
      if (!(ready & (1 << i))) continue;
      var w = ship.weapons[i], def = W(w.id);
      if (!hasAmmo(run, ship, def)) continue;   // an earlier missile in this volley used the last one
      if (w.target < 0 || w.target >= tgtShip.rooms.length) { w.target = null; continue; }
      w.charge = 0;
      if (def.type === 'beam') {
        var rooms = G.Ship.beamRooms(tgtShip, w.target, def.beamLen);
        var b = {
          id: G.U.uid(run, 'b'), from: ship.id, to: tgtShip.id, weapon: def.id, slot: i, rooms: rooms,
          applied: rooms.map(function () { return false; }), delay: R().flight.beam, t: 0, dur: R().beamSweep,
          dmg: def.dmg, fire: def.fire, crewDmg: def.crewDmg, sysDmg: def.sysDmg,
        };
        c.beams.push(b);
        fx(run, { t: 'beam', from: b.from, to: b.to, weapon: def.id, slot: i, rooms: rooms, id: b.id });
      } else {
        for (var s = 0; s < def.shots; s++) {
          launch(run, {
            from: ship.id, to: tgtShip.id, kind: def.type, weapon: def.id, slot: i, target: w.target,
            delay: s * R().burstGap, dmg: def.dmg, ion: def.ion, sysDmg: def.sysDmg, crewDmg: def.crewDmg,
            fire: def.fire, breach: def.breach,
          });
        }
      }
      if (def.missile > 0) {
        if (ship.id === 'player') {
          var keep = G.U.hasAug(run, 'replicator') && G.RNG.chance(run.rng, R().augmentFx.replicatorChance);
          if (!keep) run.res.missiles = Math.max(0, run.res.missiles - def.missile);
        } else {
          ship.missiles = Math.max(0, ship.missiles - def.missile);
        }
      }
      // Player missile weapons are single-shot per target; enemy weapons re-pick after every shot.
      if (ship.id !== 'player' || def.missile > 0) w.target = null;
    }
  }

  // Create a projectile. spec: from, to, kind, weapon, slot, target, delay, dmg, ion, sysDmg, crewDmg, fire, breach
  function launch(run, spec) {
    var fl = R().flight;
    var p = {
      id: G.U.uid(run, 'p'), from: spec.from, to: spec.to, kind: spec.kind,
      weapon: spec.weapon || null, slot: spec.slot != null ? spec.slot : null, target: spec.target,
      delay: spec.delay || 0, t: 0, dur: fl[spec.kind] || fl.laser,
      dmg: spec.dmg || 0, ion: spec.ion || 0, sysDmg: spec.sysDmg != null ? spec.sysDmg : (spec.dmg || 0),
      crewDmg: spec.crewDmg != null ? spec.crewDmg : (spec.dmg || 0) * R().crewDmgPerDmg,
      fire: spec.fire || 0, breach: spec.breach || 0,
    };
    run.combat.projectiles.push(p);
    if (p.delay <= 0) launchFx(run, p);
    return p;
  }

  function launchFx(run, p) {
    fx(run, { t: 'launch', from: p.from, to: p.to, kind: p.kind, weapon: p.weapon, slot: p.slot, target: p.target, id: p.id });
  }

  // ------------------------------------------------------------------ projectiles
  function stepProjectiles(run, dt) {
    var list = run.combat.projectiles, j = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i], done = false;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay <= 0) { p.delay = 0; launchFx(run, p); }
      } else {
        p.t += dt;
        if (p.t >= p.dur) { resolve(run, p); done = true; }
      }
      if (!done) list[j++] = p;
    }
    list.length = j;
  }

  function resolve(run, p) {
    var c = run.combat, tgt = shipBySide(run, p.to);
    if (!tgt || tgt.hull <= 0) return;
    if (p.to === 'enemy' && c.pending === 'enemyFled') return;   // the enemy already jumped away
    var room = tgt.rooms[p.target];
    if (!room) return;
    // 1. evasion
    if (G.RNG.chance(run.rng, G.Ship.evasion(tgt) / 100)) {
      fx(run, { t: 'miss', from: p.from, to: p.to, id: p.id, target: p.target });
      return;
    }
    // 2. shields (missiles ignore them)
    if (p.kind !== 'missile' && tgt.shieldLayers > 0) {
      tgt.shieldLayers--;
      fx(run, { t: 'shield', from: p.from, to: p.to, id: p.id, target: p.target, side: tgt.id });
      if (p.ion > 0 && tgt.systems.shields) {
        G.Ship.ionSystem(tgt, 'shields', p.ion);
        fx(run, { t: 'ion', side: tgt.id, sys: 'shields' });
      }
      return;
    }
    // 3/4. hit
    fx(run, { t: 'hit', from: p.from, to: p.to, id: p.id, target: p.target, side: tgt.id, dmg: p.dmg, kind: p.kind });
    if (p.ion > 0) {
      if (room.sys && tgt.systems[room.sys]) {
        G.Ship.ionSystem(tgt, room.sys, p.ion);
        fx(run, { t: 'ion', side: tgt.id, sys: room.sys });
      }
    }
    if (p.dmg > 0) {
      tgt.hull = Math.max(0, tgt.hull - p.dmg);
      if (room.sys && p.sysDmg > 0 && G.Ship.damageSystem(tgt, room.sys, p.sysDmg) > 0) {
        fx(run, { t: 'sysDamage', side: tgt.id, sys: room.sys });
      }
      G.Crew.damageRoom(tgt, room.id, p.crewDmg);
      ignite(run, tgt, room, p.fire);
      if (p.breach > 0 && G.RNG.chance(run.rng, p.breach) && room.breach < G.Ship.tiles(room)) {
        room.breach++;
        fx(run, { t: 'breach', side: tgt.id, room: room.id });
      }
    }
    if (tgt.hull <= 0) fx(run, { t: 'destroyed', side: tgt.id });
  }

  function ignite(run, ship, room, chance) {
    if (chance > 0 && G.RNG.chance(run.rng, chance) && room.fire < G.Ship.tiles(room)) {
      if (room.fire === 0) room.fireT = 0;
      room.fire++;
      fx(run, { t: 'fire', side: ship.id, room: room.id });
    }
  }

  // ------------------------------------------------------------------ beams
  function stepBeams(run, dt) {
    var list = run.combat.beams, j = 0;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      b.t += dt;
      var tgt = shipBySide(run, b.to), n = b.rooms.length, left = 0;
      if (b.t >= b.delay) {
        for (var k = 0; k < n; k++) {
          if (b.applied[k]) continue;
          if (b.t >= b.delay + b.dur * (k + 1) / n) {
            b.applied[k] = true;
            applyBeam(run, b, tgt, b.rooms[k]);
          } else left++;
        }
      } else left = n;
      if (left > 0) list[j++] = b;
    }
    list.length = j;
  }

  function applyBeam(run, b, tgt, roomId) {
    if (!tgt || tgt.hull <= 0) return;
    if (b.to === 'enemy' && run.combat.pending === 'enemyFled') return;
    var room = tgt.rooms[roomId];
    if (!room) return;
    var layers = tgt.shieldLayers;
    if (b.dmg > 0) {
      var eff = b.dmg - layers;
      if (eff <= 0) {
        fx(run, { t: 'shield', from: b.from, to: b.to, id: b.id, target: roomId, side: tgt.id });
        return;
      }
      fx(run, { t: 'hit', from: b.from, to: b.to, id: b.id, target: roomId, side: tgt.id, dmg: eff, kind: 'beam' });
      tgt.hull = Math.max(0, tgt.hull - eff);
      var sd = b.sysDmg > 0 ? eff : 0;
      if (room.sys && sd > 0 && G.Ship.damageSystem(tgt, room.sys, sd) > 0) {
        fx(run, { t: 'sysDamage', side: tgt.id, sys: room.sys });
      }
      G.Crew.damageRoom(tgt, roomId, b.crewDmg);
      ignite(run, tgt, room, b.fire);
      if (tgt.hull <= 0) fx(run, { t: 'destroyed', side: tgt.id });
    } else {
      if (layers > 0) {
        fx(run, { t: 'shield', from: b.from, to: b.to, id: b.id, target: roomId, side: tgt.id });
        return;
      }
      fx(run, { t: 'hit', from: b.from, to: b.to, id: b.id, target: roomId, side: tgt.id, dmg: 0, kind: 'beam' });
      G.Crew.damageRoom(tgt, roomId, b.crewDmg);
      ignite(run, tgt, room, b.fire);
    }
  }

  // ------------------------------------------------------------------ hazards / boss
  function randomRoom(run, ship) { return G.RNG.int(run.rng, 0, ship.rooms.length - 1); }

  function stepHazards(run, c, dt) {
    var r = R(), hz = c.hazardT, rng = run.rng;
    if (c.hazard === 'asteroid') {
      ['player', 'enemy'].forEach(function (side) {
        hz[side] -= dt;
        if (hz[side] > 0) return;
        hz[side] += G.RNG.range(rng, r.asteroidInterval[0], r.asteroidInterval[1]);
        var ship = shipBySide(run, side);
        launch(run, { from: 'hazard', to: side, kind: 'asteroid', weapon: null, slot: null, target: randomRoom(run, ship),
          dmg: 1, sysDmg: 1, fire: 0, breach: 0 });
      });
    } else if (c.hazard === 'sun') {
      hz.flare -= dt;
      if (hz.flare <= 0) {
        hz.flare += G.RNG.range(rng, r.flareInterval[0], r.flareInterval[1]);
        fx(run, { t: 'flare' });
        [run.player, c.enemy].forEach(function (ship) {
          var ids = ship.rooms.map(function (rm) { return rm.id; });
          G.RNG.shuffle(rng, ids);
          for (var i = 0; i < Math.min(r.flareFires, ids.length); i++) {
            var room = ship.rooms[ids[i]];
            if (room.fire < G.Ship.tiles(room)) {
              if (room.fire === 0) room.fireT = 0;
              room.fire++;
              fx(run, { t: 'fire', side: ship.id, room: room.id });
            }
          }
        });
      }
    } else if (c.hazard === 'fleet') {
      hz.fleet -= dt;
      if (hz.fleet <= 0) {
        hz.fleet += G.RNG.range(rng, r.fleetShotInterval[0], r.fleetShotInterval[1]);
        var fs = r.fleetShot;
        // The barrage grows the longer the player stays: one more shell every fleetEscalateEvery seconds.
        // Without this a stranded player (fuel 0) vs a 3-layer elite could be locked in an endless fight.
        var every = r.fleetEscalateEvery || FLEET_ESCALATE_EVERY;
        var maxShots = r.fleetEscalateMax || FLEET_ESCALATE_MAX;
        var shots = Math.min(maxShots, 1 + Math.floor(c.time / every));
        if (shots > (c.flags.fleetShots || 1)) say(run, '叛军舰队的炮火越来越密集了！', 'bad');
        c.flags.fleetShots = shots;
        for (var fi = 0; fi < shots; fi++) {
          launch(run, { from: 'hazard', to: 'player', kind: 'fleet', weapon: null, slot: null, delay: fi * r.burstGap,
            target: randomRoom(run, run.player), dmg: fs.dmg, sysDmg: fs.sysDmg, fire: fs.fire, breach: fs.breach });
        }
      }
    }
  }

  function stepBoss(run, c, dt) {
    var e = c.enemy, P = G.data.enemies.flagship.phase2;
    if (e.hull <= 0) return;
    if (e.phase !== 2) {
      if (e.hull <= P.at * e.hullMax) {
        e.phase = 2;
        if (P.repairAll) {
          Object.keys(e.systems).forEach(function (k) {
            var s = e.systems[k];
            s.damage = 0; s.ion = 0; s.ionT = 0; s.repairProg = 0;
          });
          e.rooms.forEach(function (rm) {
            rm.fire = 0; rm.breach = 0; rm.fireT = 0; rm.fireProg = 0; rm.breachProg = 0; rm.sysFireProg = 0;
          });
          G.Ship.restorePower(e);
        }
        e.chargeMult = P.chargeMult;
        e.surgeT = P.surgeInterval;
        fx(run, { t: 'phase2' });
        say(run, P.text, 'bad');
      }
      return;
    }
    var prev = e.surgeT;
    e.surgeT -= dt;
    if (prev > P.surgeWarn && e.surgeT <= P.surgeWarn) {
      fx(run, { t: 'surgeWarn', in: P.surgeWarn });
      say(run, P.warnText, 'bad');
    }
    if (e.surgeT <= 0) {
      e.surgeT += P.surgeInterval;
      for (var i = 0; i < P.surgeShots; i++) {
        launch(run, { from: 'enemy', to: 'player', kind: 'laser', weapon: null, slot: null,
          target: G.AI.pickTarget(run, run.player, null), delay: i * 0.15, dmg: 1, sysDmg: 1, fire: 0, breach: 0 });
      }
      fx(run, { t: 'surge' });
    }
  }

  // ------------------------------------------------------------------ step
  function setPending(run, c, what) {
    c.pending = what;
    c.pendingT = R().endDelay;
  }

  function checkEnd(run, c) {
    var p = run.player, e = c.enemy;
    if (p.hull <= 0 || G.Ship.aliveCount(p) === 0) {
      if (c.pending !== 'lose') setPending(run, c, 'lose');
      return;
    }
    if (c.pending) return;
    if (e.hull <= 0) setPending(run, c, 'win');
    else if (!e.crewless && G.Ship.aliveCount(e) === 0) setPending(run, c, 'derelict');
    else if (e.fleeing && e.ftl >= 1) setPending(run, c, 'enemyFled');
  }

  function step(run, dt) {
    var c = run.combat;
    if (!c || c.offer || c.result) return;
    var p = run.player, e = c.enemy, r = R();
    c.time += dt;
    var ctx = ctxOf(run, true);

    stepShip(run, p, dt, ctx);
    if (e.hull > 0 && c.pending !== 'enemyFled') stepShip(run, e, dt, ctx);

    if (!c.pending) {
      // enemy FTL while fleeing
      var eng = e.systems.engines, pil = e.systems.piloting;
      if (e.fleeing && e.hull > 0 && eng && eng.power > 0 && pil && G.Ship.usable(pil) > 0 &&
          (e.crewless || G.Ship.isManned(e, 'piloting') || G.Ship.usable(pil) >= 2)) {
        e.ftl = Math.min(1, e.ftl + dt / Math.max(r.enemyFtlTimeMin, r.enemyFtlTime - r.ftlTimePerEngine * eng.power));
      }
      G.AI.step(run, c, dt);
      stepHazards(run, c, dt);
      fireWeapons(run, p);
      if (e.hull > 0) fireWeapons(run, e);
    }

    stepProjectiles(run, dt);
    stepBeams(run, dt);
    if (c.boss && !c.pending) stepBoss(run, c, dt);   // after hits so phase 2 triggers on the tick it is reached
    checkEnd(run, c);

    if (c.pending && !c.result) {
      c.pendingT -= dt;
      if (c.pendingT <= 0) {
        c.result = c.pending;
        fx(run, { t: 'combatEnd', result: c.result });
      }
    }
  }

  // Out-of-combat tick for the player ship.
  function idle(run, dt) {
    if (run.player) stepShip(run, run.player, dt, ctxOf(run, false));
  }

  // ------------------------------------------------------------------ commands / queries
  function setTarget(run, slot, roomId) {
    var w = run.player && run.player.weapons[slot];
    if (!w) return false;
    if (roomId === null) { w.target = null; return true; }
    var c = run.combat;
    if (!c || typeof roomId !== 'number' || roomId < 0 || roomId >= c.enemy.rooms.length || roomId !== Math.floor(roomId)) return false;
    w.target = roomId;
    return true;
  }

  function setVolley(run, on) { run.volley = !!on; }

  function canFlee(run) {
    var c = run.combat;
    // A decided fight (pending/result) can no longer be fled: it ends by itself (G.Run.canJump agrees).
    return !!(c && !c.boss && !c.pending && !c.result && run.player.ftl >= 1);
  }

  function answerOffer(run, accept) {
    var c = run.combat;
    if (!c || !c.offer) return;
    var offer = c.offer;
    c.offer = null;
    if (accept) {
      // The accepted offer is binding: G.Run.finishCombat pays exactly these amounts.
      if (!c.flags) c.flags = {};
      c.flags.offerTaken = { scrap: offer.scrap || 0, fuel: offer.fuel || 0, missiles: offer.missiles || 0 };
      c.pending = 'surrender';
      c.pendingT = 0;
      c.result = 'surrender';
      fx(run, { t: 'combatEnd', result: 'surrender' });
    } else {
      say(run, '拒绝投降，战斗继续！', 'warn');
    }
  }

  function previewBeam(run, slot, roomId) {
    var c = run.combat, w = run.player && run.player.weapons[slot];
    if (!c || !w || roomId == null || roomId < 0 || roomId >= c.enemy.rooms.length) return [];
    var def = W(w.id);
    if (def.type !== 'beam') return [roomId];
    return G.Ship.beamRooms(c.enemy, roomId, def.beamLen);
  }

  function say(run, text, kind) {
    var c = run.combat;
    if (c) c.msg = { text: text, kind: kind || '', t: c.time };
    fx(run, { t: 'msg', text: text, kind: kind || '' });
  }

  function drainFx(run) { return G.U.drainFx(run); }

  G.Combat = {
    create: create, step: step, stepShip: stepShip, idle: idle,
    setTarget: setTarget, setVolley: setVolley, weaponState: weaponState,
    canFlee: canFlee, answerOffer: answerOffer, previewBeam: previewBeam, say: say, drainFx: drainFx,
    launch: launch,
  };
})();
