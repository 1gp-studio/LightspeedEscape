// Headless auto-player for balance and flow testing (SPEC §12). Plays complete runs through the public
// sim API the UI uses (G.Run / G.Events / G.Map / G.Store / G.Combat / G.Ship power calls / G.Crew orders)
// and reads run state the way the HUD does. It never writes run state directly.
//
//   node tests/bot.mjs [--runs 200] [--ship falcon|thunder|both] [--difficulty normal] [--seed 1] [--verbose]
//                      [--max-minutes 120] [--json]
//   --runs N is the total; with --ship both the runs alternate between the ships (N/2 each).
//
// Library use (tests/flow.test.mjs):
//   import { newGame, advance, playRun, checkInvariants } from './bot.mjs';
//   const { run, bs } = newGame(G, { seed, shipId, difficulty });
//   while (!isOver(run)) advance(G, run, bs);     // one bot unit: a decision in a menu mode, or one sim tick
// The bot's memory (bs) is plain JSON, so a run can be serialized mid-fight and resumed with a clone of bs.
//
// Policy (a sensible human with the pause button):
//   map     unvisited beacons toward the exit; 1–2 same-row detours per sector while the fleet ETA allows;
//           stores when scrap is high or fuel / hull / missiles are low; never into the fleet if avoidable.
//   events  expected value of each visible choice from its outcomes (blue options get a bonus); risk-averse
//           about fights when the hull is low.
//   combat  power shields (even) > weapons > engines/oxygen > medbay; ion + missiles at shields, lasers at shields
//           until the shield system is down, then weapons (vs the flagship: its weapons first); beams where
//           the sweep hits most; volley on; missiles held in reserve (3 vs shielded ships, 6 otherwise and in
//           the final sector, for the flagship; only emergencies spend the last ones);
//           crew to fires > breaches > damaged systems, hurt crew to the medbay, then back to stations;
//           flee elite/fleet fights, stalemates and critical-hull fights once the FTL is charged;
//           accept surrenders when the hull is below 50%.
//   hub     store: fuel up to 11, useful augments (before non-urgent repairs), repair when hull < 70%,
//           missiles up to 10 (12 from sector 3; 10 before the final repair, then 14), better weapons, crew up
//           to 4; fuel is guarded in events. Between stores it keeps ~55 scrap for the next store instead of
//           buying minor upgrades. Upgrades: shields to 2 layers first (plus the reactor to power them), then
//           weapons capacity, reactor, engines, piloting, 3rd shield layer, the rest.
import { loadGame } from './load.mjs';
import { pathToFileURL } from 'node:url';

// ------------------------------------------------------------------ constants
const DECIDE_EVERY = 6;            // combat: think every 6 ticks (0.2 s), like a player who pauses a lot
const STATION_PRIO = ['piloting', 'weapons', 'shields', 'engines'];
const SYS_VALUE = { weapons: 3, shields: 3, piloting: 2, engines: 1.5, medbay: 1, oxygen: 1 };
const WEAPON_SCORE = {
  laser_basic: 2, laser_burst1: 5, laser_burst2: 9, laser_heavy1: 5, laser_heavy2: 8,
  ion_1: 4, ion_heavy: 6, ion_rapid: 7,
  missile_leto: 3, missile_artemis: 5, missile_hermes: 6,
  beam_mini: 3, beam_halberd: 8, beam_fire: 2,
};
const AUG_PREF = ['shield_booster', 'auto_loader', 'pre_igniter', 'scrap_arm', 'ftl_booster', 'replicator'];
const SECTOR_PREF = ['civilian', 'nebula', 'pirate', 'hostile'];

// ------------------------------------------------------------------ small helpers
const avg = (v) => (Array.isArray(v) ? (v[0] + v[1]) / 2 : typeof v === 'number' ? v : 0);
const dest = (c) => (c.path.length ? c.path[c.path.length - 1] : c.room);
const isOver = (run) => run.mode === 'gameover' || run.mode === 'victory';
export { isOver };

function log(bs, msg) {
  if (bs.verbose) console.log(`  [${bs.seed}] ${msg}`);
}

function newStats() {
  return {
    fights: 0, eliteFights: 0, fled: 0, surrendersAccepted: 0, surrendersRefused: 0,
    scrapSpent: 0, scrapSold: 0, waits: 0, missileOutFights: 0,
    upgrades: {}, weaponsBought: {}, augsBought: {}, crewBought: 0, fuelBought: 0, missilesBought: 0, hullBought: 0,
    detours: 0, events: 0, sectorsChosen: {}, lastFight: null,
    // balance probes (not printed by report(); read by --json consumers)
    hullLostBySector: [0, 0, 0, 0, 0], fightsBySector: [0, 0, 0, 0, 0], waitsBySector: [0, 0, 0, 0, 0],
    missilesFired: 0, missileLowStarts: 0, boss: null, missileOutBySector: [0, 0, 0, 0, 0], storeVisits: 0, storeScrap: 0, augSeen: 0, augUseful: 0,
  };
}

export function newBotState(opts = {}) {
  return {
    seed: opts.seed || 0, verbose: !!opts.verbose,
    tick: 0, units: 0, mode: null, fightTick: 0, fightHull0: 0, fightMissiles: 0, missileOut: false,
    detoursSector: -1, detours: 0,
    stats: newStats(),
  };
}

export function newGame(G, { seed = 1, shipId = 'falcon', difficulty = 'normal', verbose = false } = {}) {
  const run = G.Run.create({ seed, shipId, difficulty });
  const bs = newBotState({ seed, verbose });
  bs.mode = run.mode;
  return { run, bs };
}

function spend(run, bs, fn, tag) {
  const s0 = run.res.scrap;
  const r = fn();
  if (r && (r.ok || r === true)) {
    const d = s0 - run.res.scrap;
    if (d > 0) bs.stats.scrapSpent += d;
    if (d < 0) bs.stats.scrapSold += -d;
    if (tag) log(bs, `${tag} (${d > 0 ? '-' + d : '+' + -d} scrap)`);
  }
  return r;
}

function hasMissileWeapon(G, run) {
  return run.player.weapons.some((w) => G.data.weapons[w.id].missile > 0);
}

// ------------------------------------------------------------------ power
function planPower(G, run, ship, needHeal) {
  const S = ship.systems, W = G.data.weapons;
  let budget = ship.reactor;
  const T = { shields: 0, engines: 0, oxygen: 0, medbay: 0 };
  const on = [];
  const take = (sid, n) => {
    if (!S[sid]) return;
    const k = Math.max(0, Math.min(n, S[sid].level - T[sid], budget));
    T[sid] += k; budget -= k;
  };
  if (S.shields) {
    const even = S.shields.level - (S.shields.level % 2);
    T.shields = Math.min(even, budget - (budget % 2));
    budget -= T.shields;
  }
  let wp = 0;
  const cap = S.weapons ? S.weapons.level : 0;
  ship.weapons.forEach((w, i) => {
    const d = W[w.id];
    if (d.missile && run.res.missiles < d.missile) return;
    if (wp + d.power <= cap && d.power <= budget) { on.push(i); wp += d.power; budget -= d.power; }
  });
  take('engines', 1);
  take('oxygen', 1);
  if (needHeal) take('medbay', 1);
  take('engines', 99);
  take('medbay', 1);
  take('oxygen', 99);
  take('medbay', 99);
  return { T, on };
}

function managePower(G, run, needHeal) {
  const ship = run.player, S = ship.systems;
  const plan = planPower(G, run, ship, needHeal);
  const order = ['shields', 'engines', 'oxygen', 'medbay'];
  // removals first (they free reactor bars)
  for (const sid of order) {
    const s = S[sid];
    if (!s) continue;
    for (let g = 0; g < 10 && s.power > plan.T[sid]; g++) if (!G.Ship.removePower(ship, sid)) break;
  }
  ship.weapons.forEach((w, i) => { if (w.on && plan.on.indexOf(i) < 0) G.Ship.toggleWeapon(ship, i); });
  // additions by priority: shields, weapons, then the rest
  const add = (sid) => {
    const s = S[sid];
    if (!s) return;
    for (let g = 0; g < 10 && s.power < plan.T[sid]; g++) if (!G.Ship.addPower(ship, sid)) break;
  };
  add('shields');
  plan.on.forEach((i) => { if (!ship.weapons[i].on) G.Ship.toggleWeapon(ship, i); });
  add('engines'); add('oxygen'); add('medbay');
}

// ------------------------------------------------------------------ crew
function crewDistance(G, ship, c, room) {
  const p = G.Crew.path(ship, dest(c), room);
  return p ? p.length : 99;
}

function manageStations(G, run) {
  const ship = run.player, crew = ship.crew, S = ship.systems;
  for (let pi = 0; pi < STATION_PRIO.length; pi++) {
    const sid = STATION_PRIO[pi], s = S[sid];
    if (!s) continue;
    if (crew.some((c) => c.station === s.room)) continue;
    let cands = crew.filter((c) => c.station == null);
    if (!cands.length && sid === 'piloting') {
      // the pilot matters most: take the crew member from the lowest-priority station
      for (let q = STATION_PRIO.length - 1; q > pi && !cands.length; q--) {
        const low = S[STATION_PRIO[q]];
        if (low) cands = crew.filter((c) => c.station === low.room);
      }
    }
    if (!cands.length) continue;
    cands.sort((a, b) => crewDistance(G, ship, a, s.room) - crewDistance(G, ship, b, s.room));
    G.Crew.order(ship, cands[0].id, s.room);
  }
}

function problemLevel(ship, room) {
  if (room.fire > 0) return 3;
  if (room.breach > 0) return 2;
  const s = room.sys ? ship.systems[room.sys] : null;
  return s && s.damage > 0 ? 1 : 0;
}

function manageCrew(G, run, inCombat) {
  const ship = run.player, crew = ship.crew, S = ship.systems, R = G.data.rules;
  if (!crew.length) return;
  manageStations(G, run);
  if (!inCombat) {
    G.Crew.returnToStations(ship);
    return;
  }
  // healing
  const med = S.medbay;
  const medRoom = med ? ship.rooms[med.room] : null;
  const medOk = !!(med && med.power > 0 && medRoom.fire === 0 && medRoom.breach === 0 && medRoom.o2 > 20);
  const healing = new Set();
  for (const c of crew) {
    if (!medOk) break;
    if (dest(c) === med.room && c.hp < 0.9 * c.hpMax) { healing.add(c.id); continue; }
    if (c.hp < 0.4 * c.hpMax && G.Crew.order(ship, c.id, med.room)) healing.add(c.id);
  }
  // problems: fire > breach > damaged system (important systems first)
  const probs = [];
  ship.rooms.forEach((room) => {
    const lvl = problemLevel(ship, room);
    if (!lvl) return;
    if (lvl === 3 && room.o2 < R.fireDieBelowO2 && room.breach === 0 && !room.sys) return;   // will burn out
    const s = room.sys ? S[room.sys] : null;
    const need = lvl === 3 ? (room.fire >= 2 ? 2 : 1) : lvl === 1 && s && s.damage >= 2 ? 2 : 1;
    probs.push({ room, lvl, need, value: lvl * 10 + (room.sys ? SYS_VALUE[room.sys] || 1 : 0) });
  });
  probs.sort((a, b) => b.value - a.value || a.room.id - b.room.id);
  const probRooms = new Set(probs.map((p) => p.room.id));
  const busy = (c) => healing.has(c.id) || probRooms.has(dest(c));
  const pilotLvl = S.piloting ? S.piloting.level : 0;
  const stationRank = (c) => {
    if (c.station == null) return 0;
    const sid = ship.rooms[c.station].sys;
    const r = STATION_PRIO.indexOf(sid);
    return r < 0 ? 0 : 10 - r;   // engines crew is pulled before weapons/shields crew, the pilot last
  };
  for (const pr of probs) {
    let have = crew.filter((c) => dest(c) === pr.room.id).length;
    while (have < pr.need) {
      const cands = crew.filter((c) => !busy(c) && c.hp > 0.3 * c.hpMax &&
        !(c.station != null && ship.rooms[c.station].sys === 'piloting' && pilotLvl < 2));
      if (!cands.length) break;
      cands.sort((a, b) => {
        const fa = pr.lvl === 3 && G.data.crew.races[a.race].fireImmune ? -5 : 0;
        const fb = pr.lvl === 3 && G.data.crew.races[b.race].fireImmune ? -5 : 0;
        return (stationRank(a) + fa + crewDistance(G, ship, a, pr.room.id)) -
          (stationRank(b) + fb + crewDistance(G, ship, b, pr.room.id));
      });
      const c = cands[0];
      if (!G.Crew.order(ship, c.id, pr.room.id)) break;
      have++;
    }
  }
  // everyone else back to their station
  for (const c of crew) {
    if (busy(c) || c.station == null || dest(c) === c.station) continue;
    G.Crew.order(ship, c.id, c.station);
  }
}

// ------------------------------------------------------------------ combat
function enemyRoomOf(e, sid) { return e.systems[sid] ? e.systems[sid].room : null; }

function beamTarget(G, run, slot, e, fireBeam) {
  let best = 0, bestV = -1;
  for (let r = 0; r < e.rooms.length; r++) {
    const rooms = G.Combat.previewBeam(run, slot, r);
    let v = 0;
    for (const id of rooms) {
      const room = e.rooms[id];
      const crewIn = e.crew.filter((c) => c.room === id).length;
      if (fireBeam) v += crewIn * 2 + (room.sys ? 0.5 : 0);
      else v += (room.sys ? SYS_VALUE[room.sys] || 1 : 0.8) + crewIn * 0.5;
    }
    if (v > bestV) { bestV = v; best = r; }
  }
  return best;
}

function manageTargets(G, run, bs) {
  const c = run.combat, e = c.enemy, p = run.player, W = G.data.weapons;
  const sh = e.systems.shields;
  const shieldsUp = !!sh && G.Ship.usable(sh) >= 2;
  const shieldsRoom = enemyRoomOf(e, 'shields');
  const weaponsRoom = enemyRoomOf(e, 'weapons');
  const weaponsUp = !!e.systems.weapons && G.Ship.usable(e.systems.weapons) > 0;
  const fallback = weaponsRoom != null ? weaponsRoom : 0;
  const hullFrac = p.hull / p.hullMax;
  p.weapons.forEach((w, i) => {
    if (!w.on) return;
    const d = W[w.id];
    let t;
    if (d.type === 'beam') {
      t = beamTarget(G, run, i, e, d.dmg === 0);
    } else if (d.type === 'ion') {
      t = shieldsRoom != null && sh.level >= 2 ? shieldsRoom : fallback;
    } else if (d.type === 'missile') {
      // Missiles are a finite resource: spend them freely only when lasers can't do the job (2+ shield
      // layers), in tough fights (flagship, elite, own hull low) or when the fight is stuck. Otherwise one
      // opening missile at the enemy weapons, keeping a reserve (6 in the final sector, for the flagship).
      const stuck = c.time > 60 && e.hull > 0.7 * e.hullMax;
      const layers = sh ? Math.floor(sh.level / 2) : 0;
      const need = c.boss || c.elite || layers >= 2 || hullFrac < 0.45 || stuck;
      const saveForBoss = G.Run.isFinalSector(run) && !c.boss && hullFrac >= 0.35 && !c.elite ? 6 : 0;
      // shielded-but-harmless fights keep a small stock; emergencies may spend down to the last one
      const urgent = c.elite || hullFrac < 0.45 || stuck;
      const reserve = c.boss ? 0 : Math.max(saveForBoss, urgent ? 1 : need ? 3 : 6);
      const allowed = need || (bs.fightMissiles || 0) < 1;
      if (run.res.missiles <= reserve || !allowed) t = null;
      else if (!need) t = weaponsUp && weaponsRoom != null ? weaponsRoom : fallback;
      else t = shieldsUp && shieldsRoom != null ? shieldsRoom : (weaponsUp ? weaponsRoom : shieldsRoom);
      if (t == null && run.res.missiles > reserve && allowed) t = fallback;
    } else if (c.boss && weaponsUp && weaponsRoom != null) {
      t = weaponsRoom;
    } else {
      t = shieldsUp && shieldsRoom != null ? shieldsRoom : weaponsUp && weaponsRoom != null ? weaponsRoom
        : shieldsRoom != null ? shieldsRoom : fallback;
    }
    if (w.target !== t) G.Combat.setTarget(run, i, t);
  });
  if (!run.volley) G.Combat.setVolley(run, true);
}

function wantFlee(G, run, bs) {
  const c = run.combat, p = run.player, e = c.enemy;
  if (c.boss || !G.Combat.canFlee(run) || run.res.fuel < 1) return '';
  if (!G.Map.reachable(run).length) return '';
  const eFrac = e.hull / e.hullMax;
  if ((c.elite || c.hazard === 'fleet') && e.hull > 3) return 'elite';
  if (p.hull <= 0.3 * p.hullMax && eFrac > 0.3) return 'hull';
  if (G.Ship.aliveCount(p) <= 1 && G.Ship.aliveCount(e) > 1 && eFrac > 0.3) return 'crew';
  if (c.time > 150 && eFrac > 0.5) return 'stalemate';
  return '';
}

function combatDecide(G, run, bs) {
  const c = run.combat, p = run.player;
  if (c.offer) {
    const accept = p.hull < 0.5 * p.hullMax || c.elite || G.Ship.aliveCount(p) <= 1;
    if (accept) bs.stats.surrendersAccepted++; else bs.stats.surrendersRefused++;
    log(bs, `surrender offer ${accept ? 'accepted' : 'refused'}`);
    G.Combat.answerOffer(run, accept);
    return;
  }
  if (c.boss && bs.stats.boss) {
    const b = bs.stats.boss;
    b.t = c.time; b.eHull = c.enemy.hull; b.phase = c.enemy.phase || 1; b.pHull = p.hull; b.missiles = run.res.missiles;
  }
  if (c.pending || c.result) return;
  const why = wantFlee(G, run, bs);
  if (why) {
    const to = chooseJump(G, run, bs);
    if (to != null) {
      const r = G.Run.jump(run, to);
      if (r.ok) {
        bs.stats.fled++;
        log(bs, `fled (${why}) to beacon ${to}`);
        return;
      }
    }
  }
  const needHeal = p.crew.some((m) => m.hp < 0.5 * m.hpMax);
  managePower(G, run, needHeal);
  manageTargets(G, run, bs);
  manageCrew(G, run, true);
}

// ------------------------------------------------------------------ navigation
function wantStore(G, run) {
  const p = run.player;
  // fuel: enough to reach this sector's exit plus a few jumps into the next one
  const fuelNeed = Math.max(5, G.Map.jumpsLeft(run.sector, run.at) + 4);
  return run.res.fuel < fuelNeed || p.hull < 0.6 * p.hullMax || run.res.scrap >= 90 ||
    (hasMissileWeapon(G, run) && run.res.missiles < 3);
}

function beaconValue(G, run, b) {
  const hidden = G.Map.iconsHidden(run) && !b.visited && (b.kind === 'store' || b.kind === 'distress');
  const kind = hidden ? 'unknown' : b.kind;
  const p = run.player;
  if (kind === 'store') return wantStore(G, run) ? (b.visited ? 22 : 30) : b.visited ? 0 : 6;
  if (b.visited) return 0;
  const hurt = p.hull < 0.4 * p.hullMax;
  switch (kind) {
    case 'combat': return hurt ? 4 : 14;
    case 'event': return 13;
    case 'distress': return 12;
    case 'unknown': return 12;
    case 'empty': return 4;
    case 'boss': return 0;
    default: return 5;
  }
}

// Best reachable beacon (null if none). Scores progress, beacon value, fleet safety and fuel.
function chooseJump(G, run, bs) {
  const s = run.sector, cands = G.Map.reachable(run);
  if (!cands.length) return null;
  const curD = G.Map.jumpsLeft(s, run.at);
  const exitEta = G.Map.fleetEta(run, s.exit);
  const cur = s.beacons[run.at];
  if (bs.detoursSector !== run.sectorIndex) { bs.detoursSector = run.sectorIndex; bs.detours = 0; }
  let best = null, bestScore = -Infinity;
  for (const id of cands) {
    const b = s.beacons[id];
    const d = G.Map.jumpsLeft(s, id);
    const extra = 1 + d - curD;                     // 0 = forward, 1 = sideways, 2 = backwards
    const slack = exitEta - 1 - d;                  // jumps to spare before the exit is overtaken
    let score = beaconValue(G, run, b) - 12 * d;
    if (b.kind !== 'boss' && G.Map.fleetEta(run, id) <= 1) score -= 500;   // overtaken on arrival
    if (slack < 1) score -= 150 + 10 * d;
    if (extra > 0) {
      const detourOk = slack >= 2 + extra && run.res.fuel >= d + 3 && bs.detours < 2 && !b.visited &&
        (b.row === cur.row || beaconValue(G, run, b) >= 22);
      score += detourOk ? 12 * extra + 2 : -8 * extra;
    }
    if (b.kind === 'store' && run.res.fuel <= curD + 3) score += 20;
    if (score > bestScore || (score === bestScore && id < best)) { bestScore = score; best = id; }
  }
  if (best != null) {
    const d = G.Map.jumpsLeft(s, best);
    if (1 + d - curD > 0) { bs.detours++; bs.stats.detours++; }
  }
  return best;
}

// ------------------------------------------------------------------ events
function fxValue(G, run, key, v) {
  const p = run.player, a = avg(v), R = G.data.rules;
  switch (key) {
    case 'scrap': return a > 0 ? a * (1 + R.eventScrapPerSector * run.sectorIndex) : a * 1.1;
    case 'fuel': {
      // fuel is worth a lot when the tank would drop below what this sector (plus the next start) needs
      const need = G.Map.jumpsLeft(run.sector, run.at) + 5;
      return a * (run.res.fuel + Math.min(0, a) < need ? 15 : 4);
    }
    case 'missiles': return a * (hasMissileWeapon(G, run) ? 3 : 0.5);
    case 'hull': return a * (p.hull < 0.5 * p.hullMax ? 5 : 2.5);
    case 'crew': return p.crew.length < R.maxCrew ? 40 : 0;
    case 'loseCrew': return -(p.crew.length <= 2 ? 200 : 60) * (typeof v === 'number' ? v : 1);
    case 'crewDamage': return -a * 0.05;
    case 'weapon': return 20;
    case 'augment': return run.augments.length < R.augmentMax ? 25 : 12;
    case 'upgrade': return 30;
    case 'sysDamage': return -3;
    case 'reactor': return 20;
    case 'fleet': return -a * 15;
    default: return 0;
  }
}

function combatValue(G, run, spec, ev, depth) {
  const p = run.player, f = p.hull / p.hullMax;
  let v = spec.boss ? 0 : spec.elite ? -40 : f > 0.6 ? 12 : f > 0.4 ? 0 : -30;
  if (spec.win && ev && depth < 3) v += 0.8 * nodeValue(G, run, ev, spec.win, depth + 1);
  return v;
}

function outcomeValue(G, run, o, ev, depth) {
  let v = 0;
  for (const fx of o.fx || []) for (const k of Object.keys(fx)) v += fxValue(G, run, k, fx[k]);
  if (o.combat) v += combatValue(G, run, o.combat, ev, depth);
  if (o.store) v += 5;
  if (o.goto && ev && depth < 3) v += nodeValue(G, run, ev, o.goto, depth + 1);
  return v;
}

function choiceValue(G, run, ch, ev, depth) {
  const outs = ch.outcomes || [];
  let tw = 0, tv = 0;
  for (const o of outs) { const w = o.w == null ? 1 : o.w; tw += w; tv += w * outcomeValue(G, run, o, ev, depth); }
  return tw > 0 ? tv / tw : 0;
}

function nodeValue(G, run, ev, nodeId, depth) {
  const n = ev.nodes && ev.nodes[nodeId];
  if (!n || !n.choices) return 0;
  let best = 0;
  for (const ch of n.choices) {
    if (ch.req && !G.Events.reqOk(run, ch.req)) continue;
    best = Math.max(best, choiceValue(G, run, ch, ev, depth));
  }
  return best;
}

function eventDecide(G, run, bs) {
  const e = run.event;
  if (e.result) { G.Events.cont(run); return; }
  const node = G.Events.node(run);
  const ev = G.Events.def ? G.Events.def(e.id) : G.data.events.find((x) => x.id === e.id);
  const list = G.Events.choices(run).filter((c) => c.enabled);
  let best = null, bestV = -Infinity;
  for (const c of list) {
    const ch = node && node.choices ? node.choices[c.idx] : null;
    let v = ch ? choiceValue(G, run, ch, ev, 0) : 0;
    if (c.blue) v += 5;
    if (v > bestV) { bestV = v; best = c; }
  }
  if (!best) throw new Error(`event ${e.id}/${e.node}: no enabled choice`);
  bs.stats.events++;
  const res = G.Events.choose(run, best.idx);
  if (!res && run.event && !run.event.result) throw new Error(`event ${e.id}/${e.node}: choose(${best.idx}) failed`);
  log(bs, `event ${e.id}/${e.node} → "${best.text}"${best.blue ? ' [blue]' : ''}`);
}

// ------------------------------------------------------------------ hub (store / upgrades / navigation)
function reactorDemand(G, run) {
  const p = run.player, S = p.systems, W = G.data.weapons;
  const sh = S.shields ? S.shields.level - (S.shields.level % 2) : 0;
  const wp = p.weapons.reduce((a, w) => a + W[w.id].power, 0);
  return { core: sh + Math.min(wp, S.weapons ? S.weapons.level : 0) + 2,
           full: sh + Math.min(wp, S.weapons ? S.weapons.level : 0) + (S.engines ? S.engines.level : 0) + 1 +
             (S.medbay ? 1 : 0) };
}

function upgradeGoals(G, run) {
  const p = run.player, S = p.systems, W = G.data.weapons, si = run.sectorIndex;
  const goals = [];
  const lvl = (sid) => (S[sid] ? S[sid].level : 0);
  const dem = reactorDemand(G, run);
  const wp = p.weapons.reduce((a, w) => a + W[w.id].power, 0);
  if (lvl('shields') < 4) goals.push({ sys: 'shields', core: true });
  if (p.reactor < dem.core) goals.push({ reactor: true, core: true });
  if (lvl('weapons') < wp) goals.push({ sys: 'weapons', core: true });
  if (p.reactor < dem.core) goals.push({ reactor: true, core: true });
  if (lvl('engines') < 3) goals.push({ sys: 'engines' });
  if (p.reactor < dem.full) goals.push({ reactor: true });
  if (lvl('piloting') < 2) goals.push({ sys: 'piloting' });
  if (si >= 1 && lvl('shields') < 6) goals.push({ sys: 'shields' });
  if (p.reactor < dem.full) goals.push({ reactor: true });
  if (lvl('engines') < 4) goals.push({ sys: 'engines' });
  if (lvl('medbay') < 2) goals.push({ sys: 'medbay' });
  if (lvl('weapons') < Math.min(8, wp + 1)) goals.push({ sys: 'weapons' });
  if (p.reactor < dem.full + 2) goals.push({ reactor: true });
  if (lvl('oxygen') < 2) goals.push({ sys: 'oxygen' });
  if (lvl('engines') < 5) goals.push({ sys: 'engines' });
  if (si >= 3 && lvl('shields') < 8) goals.push({ sys: 'shields' });
  return goals;
}

function doUpgrades(G, run, bs, reserve0, saving) {
  for (let g = 0; g < 20; g++) {
    const goals = upgradeGoals(G, run);
    if (!goals.length) return;
    const goal = goals[0];
    // past the core goals, keep money for the next store (weapons, repairs, fuel)
    const reserve = goal.core ? reserve0 : Math.max(reserve0, saving);
    const cost = goal.reactor ? G.Run.reactorCost(run) : G.Run.upgradeCost(run, goal.sys);
    if (cost == null) {
      // maxed: drop this goal by skipping to the next affordable one
      const next = goals.find((x) => (x.reactor ? G.Run.reactorCost(run) : G.Run.upgradeCost(run, x.sys)) != null);
      if (!next) return;
      const c2 = next.reactor ? G.Run.reactorCost(run) : G.Run.upgradeCost(run, next.sys);
      if (run.res.scrap - c2 < reserve) return;
      applyGoal(G, run, bs, next);
      continue;
    }
    if (run.res.scrap - cost < reserve) return;   // save up for the top goal
    applyGoal(G, run, bs, goal);
  }
}

function applyGoal(G, run, bs, goal) {
  const key = goal.reactor ? 'reactor' : goal.sys;
  const r = spend(run, bs, () => (goal.reactor ? G.Run.upgradeReactor(run) : G.Run.upgradeSystem(run, goal.sys)),
    `upgrade ${key}`);
  if (!r.ok) throw new Error(`upgrade ${key} failed: ${r.reason}`);
  bs.stats.upgrades[key] = (bs.stats.upgrades[key] || 0) + 1;
}

function weakestSlot(G, run) {
  let wi = -1, ws = Infinity;
  run.player.weapons.forEach((w, i) => { const s = WEAPON_SCORE[w.id] || 1; if (s < ws) { ws = s; wi = i; } });
  return { slot: wi, score: ws };
}

function manageCargo(G, run, bs) {
  const p = run.player;
  // equip cargo into free slots (best first); sell leftovers at a store
  for (let g = 0; g < 8 && run.cargo.length && p.weapons.length < p.weaponSlots; g++) {
    let bi = 0;
    run.cargo.forEach((id, i) => { if ((WEAPON_SCORE[id] || 0) > (WEAPON_SCORE[run.cargo[bi]] || 0)) bi = i; });
    const r = G.Run.equip(run, bi);
    if (!r.ok) break;
    log(bs, `equip ${p.weapons[p.weapons.length - 1].id}`);
  }
  // swap a cargo weapon in when clearly better than the weakest equipped one
  for (let g = 0; g < 4 && run.cargo.length; g++) {
    const weak = weakestSlot(G, run);
    let bi = -1;
    run.cargo.forEach((id, i) => { if ((WEAPON_SCORE[id] || 0) >= weak.score + 3 && (bi < 0 || WEAPON_SCORE[id] > WEAPON_SCORE[run.cargo[bi]])) bi = i; });
    if (bi < 0 || weak.slot < 0 || run.cargo.length >= G.data.rules.cargoMax) break;
    const id = run.cargo[bi];
    if (!G.Run.unequip(run, weak.slot).ok) break;
    const idx = run.cargo.indexOf(id);
    if (!G.Run.equip(run, idx).ok) break;
    log(bs, `swap in ${id}`);
  }
  if (G.Run.hasStore(run)) {
    for (let i = run.cargo.length - 1; i >= 0; i--) spend(run, bs, () => G.Store.sell(run, i), `sell ${run.cargo[i]}`);
  }
}

function buyN(G, run, bs, key, n, statKey) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    const r = spend(run, bs, () => G.Store.buy(run, key, 1));
    if (!r.ok) break;
    got++;
  }
  if (got) { bs.stats[statKey] += got; log(bs, `buy ${got} ${key}`); }
  return got;
}

function shop(G, run, bs) {
  const p = run.player, store = G.Run.beacon(run).store;
  bs.stats.storeVisits++; bs.stats.storeScrap += run.res.scrap;
  const item = (type) => store.items.filter((it) => it.type === type && it.stock > 0);
  const price = (key) => { const it = store.items.find((x) => x.key === key); return it ? it.price : 999; };
  const final = G.Run.isFinalSector(run);
  const repair = (keep) => {
    const pts = Math.min(p.hullMax - p.hull, Math.floor(Math.max(0, run.res.scrap - keep) / price('repair')));
    if (pts <= 0) return;
    const r = spend(run, bs, () => G.Store.buy(run, 'repair', pts), `repair ${pts}`);
    if (r.ok) bs.stats.hullBought += pts;
  };
  // 1. needs: fuel, a useful augment, repair, missiles (before the flagship: missiles to 10, then full repair)
  // (a missile ship keeps a flagship stock of 10 before patching the hull)
  if (final && hasMissileWeapon(G, run) && run.res.missiles < 10) buyN(G, run, bs, 'missiles', 10 - run.res.missiles, 'missilesBought');
  if (final) repair(0);
  const fuelNeed = final ? G.Map.jumpsLeft(run.sector, run.at) + 1 : 11;
  if (run.res.fuel < fuelNeed) buyN(G, run, bs, 'fuel', fuelNeed - run.res.fuel, 'fuelBought');
  // a useful augment once the ship has 2 shield layers (economy augments only early in the run); it is a
  // permanent upgrade, so it comes before patching the hull unless the hull is low
  const aug = store.items.find((it) => it.type === 'augment' && it.stock > 0);
  const augUseful = aug && AUG_PREF.indexOf(aug.id) >= 0 && (
    aug.id === 'scrap_arm' ? run.sectorIndex <= 1 :
    aug.id === 'replicator' ? hasMissileWeapon(G, run) && run.sectorIndex <= 2 :
    aug.id === 'ftl_booster' ? false : true);
  if (aug) bs.stats.augSeen++;
  if (augUseful) bs.stats.augUseful++;
  if (augUseful && p.systems.shields.level >= 4 && p.hull >= 0.5 * p.hullMax && run.res.scrap - aug.price >= 10 && G.Store.canBuy(run, aug.key).ok) {
    const r = spend(run, bs, () => G.Store.buy(run, aug.key), `buy augment ${aug.id}`);
    if (r.ok) bs.stats.augsBought[aug.id] = (bs.stats.augsBought[aug.id] || 0) + 1;
  }
  if (p.hull < 0.7 * p.hullMax) repair(6);
  const missileNeed = final ? 14 : run.sectorIndex >= 3 ? 12 : 10;   // stock up for the flagship
  if (hasMissileWeapon(G, run) && run.res.missiles < missileNeed) buyN(G, run, bs, 'missiles', missileNeed - run.res.missiles, 'missilesBought');
  // 2. a clearly better weapon
  const weak = weakestSlot(G, run);
  const freeSlot = p.weapons.length < p.weaponSlots;
  let bestW = null;
  for (const it of item('weapon')) {
    const sc = WEAPON_SCORE[it.id] || 0;
    const better = freeSlot ? sc >= 5 : sc >= weak.score + 3;
    if (!better || !G.Store.canBuy(run, it.key).ok || run.res.scrap - it.price < 10) continue;
    if (!bestW || sc > WEAPON_SCORE[bestW.id]) bestW = it;
  }
  if (bestW) {
    const r = spend(run, bs, () => G.Store.buy(run, bestW.key), `buy weapon ${bestW.id}`);
    if (r.ok) bs.stats.weaponsBought[bestW.id] = (bs.stats.weaponsBought[bestW.id] || 0) + 1;
    manageCargo(G, run, bs);
  }
  // 3. repair more when rich
  if (p.hull < 0.85 * p.hullMax && run.res.scrap > 80) repair(60);
  // 4. crew up to 4 (5 when rich)
  for (const it of item('crew')) {
    const want = p.crew.length < 4 || (p.crew.length < 6 && run.res.scrap > 120);
    if (!want || run.res.scrap - it.price < 20 || !G.Store.canBuy(run, it.key).ok) continue;
    const r = spend(run, bs, () => G.Store.buy(run, it.key), `hire ${it.id}`);
    if (r.ok) bs.stats.crewBought++;
  }
  // 5. top up fuel when cheap and rich
  if (!final && run.res.fuel < 14 && run.res.scrap > 50) buyN(G, run, bs, 'fuel', Math.min(3, 14 - run.res.fuel), 'fuelBought');
}

function hubDecide(G, run, bs) {
  manageCargo(G, run, bs);
  const atStore = G.Run.hasStore(run);
  if (atStore) shop(G, run, bs);
  // keep a reserve for fuel and repairs; spend the rest on upgrades. In the final sector hold everything
  // until the fixed store before the flagship has repaired the hull.
  const final = G.Run.isFinalSector(run);
  const storeRow = final ? run.sector.beacons.find((b) => b.kind === 'store') : null;
  const beforeFinalStore = final && storeRow && run.sector.beacons[run.at].row < storeRow.row;
  if (!beforeFinalStore) {
    const reserve = final ? 0 : (run.res.fuel < 4 ? 15 : 5) + 10;
    doUpgrades(G, run, bs, reserve, final || atStore ? reserve : 55);
  }
  managePower(G, run, false);
  manageCrew(G, run, false);

  if (G.Run.isStranded(run)) {
    bs.stats.waits++;
    bs.stats.waitsBySector[Math.min(4, run.sectorIndex)]++;
    const r = G.Run.wait(run);
    if (!r.ok) throw new Error('wait failed: ' + r.reason);
    log(bs, 'stranded: wait');
    return;
  }
  if (G.Run.atExit(run) && !G.Run.isFinalSector(run)) {
    const r = G.Run.leaveSector(run);
    if (!r.ok) throw new Error('leaveSector failed: ' + r.reason);
    log(bs, `leave sector ${run.sectorIndex}`);
    return;
  }
  const to = chooseJump(G, run, bs);
  if (to == null) throw new Error(`hub: no reachable beacon (fuel ${run.res.fuel}, at ${run.at})`);
  const r = G.Run.jump(run, to);
  if (!r.ok) throw new Error('jump failed: ' + r.reason);
  const b = run.sector.beacons[to];
  log(bs, `jump → ${to} (row ${b.row} ${b.kind}${b.faction ? ' ' + b.faction : ''}) fuel ${run.res.fuel} scrap ${run.res.scrap} hull ${run.player.hull}/${run.player.hullMax} fleet ${run.sector.fleet}`);
}

function sectorDecide(G, run, bs) {
  const ch = run.sectorChoices;
  let idx = 0;
  // low on fuel: a nebula hides its stores, so prefer anything else
  const rank = (t) => SECTOR_PREF.indexOf(t) + (t === 'nebula' && run.res.fuel < 10 ? 10 : 0);
  for (let i = 1; i < ch.length; i++) if (rank(ch[i]) < rank(ch[idx])) idx = i;
  bs.stats.sectorsChosen[ch[idx]] = (bs.stats.sectorsChosen[ch[idx]] || 0) + 1;
  const r = G.Run.chooseSector(run, idx);
  if (!r.ok) throw new Error('chooseSector failed: ' + r.reason);
  log(bs, `sector ${run.sectorIndex}: ${ch[idx]}`);
}

// ------------------------------------------------------------------ one bot unit
// Menu modes: one decision. Combat: maybe a decision, then one G.Run.step. Returns the new mode.
export function advance(G, run, bs) {
  bs.units++;
  const mode = run.mode;
  if (mode !== bs.mode) onModeChange(G, run, bs, bs.mode, mode);
  switch (mode) {
    case 'event': eventDecide(G, run, bs); break;
    case 'reward':
      log(bs, `reward: ${run.reward.result} ${run.reward.fx.map((f) => f.label).join(', ')}`);
      if (!G.Run.claimReward(run)) throw new Error('claimReward failed');
      break;
    case 'sectorSelect': sectorDecide(G, run, bs); break;
    case 'hub': hubDecide(G, run, bs); break;
    case 'combat': {
      if (bs.fightTick % DECIDE_EVERY === 0 || run.combat.offer) combatDecide(G, run, bs);
      if (run.mode === 'combat') {
        bs.fightTick++;
        bs.tick++;
        if (hasMissileWeapon(G, run) && run.res.missiles === 0) bs.missileOut = true;
        const m0 = run.res.missiles;
        G.Run.step(run, G.CFG.SIM_DT);
        if (run.res.missiles < m0 && run.mode === 'combat') { bs.stats.missilesFired += m0 - run.res.missiles; bs.fightMissiles += m0 - run.res.missiles; }
      }
      break;
    }
    default: break;
  }
  G.Run.drainFx(run);
  if (run.mode !== mode) onModeChange(G, run, bs, mode, run.mode);
  return run.mode;
}

function onModeChange(G, run, bs, from, to) {
  if (from === to) return;
  if (from === 'combat') {
    if (bs.missileOut) { bs.stats.missileOutFights++; bs.stats.missileOutBySector[Math.min(4, run.sectorIndex)]++; }
    bs.missileOut = false;
    const si = Math.min(4, run.sectorIndex);
    bs.stats.hullLostBySector[si] += Math.max(0, bs.fightHull0 - run.player.hull);
    if (bs.stats.boss && bs.stats.boss.result == null) bs.stats.boss.result = to;
  }
  if (to === 'combat' && run.combat) {
    bs.stats.fights++;
    bs.stats.fightsBySector[Math.min(4, run.sectorIndex)]++;
    bs.fightHull0 = run.player.hull;
    bs.fightMissiles = 0;
    if (!run.combat.boss && hasMissileWeapon(G, run) && run.res.missiles <= 1) bs.stats.missileLowStarts++;
    if (run.combat.boss) {
      const p = run.player;
      bs.stats.boss = { hull0: p.hull, shields: p.systems.shields.level, weapons: p.weapons.map((w) => w.id).join('+'),
        missiles0: run.res.missiles, t: 0, eHull: run.combat.enemy.hull, phase: 1, pHull: p.hull, result: null };
    }
    if (run.combat.elite) bs.stats.eliteFights++;
    bs.fightTick = 0;
    const e = run.combat.enemy;
    bs.stats.lastFight = { sector: run.sectorIndex, elite: run.combat.elite, boss: run.combat.boss,
      faction: run.combat.faction, hazard: run.combat.hazard, enemy: e.templateId + ':' + e.weapons.map((w) => w.id).join('+') };
    log(bs, `combat vs ${e.name} (${bs.stats.lastFight.enemy}) hull ${e.hull} shields ${e.systems.shields ? e.systems.shields.level : 0}${run.combat.hazard !== 'none' ? ' hazard ' + run.combat.hazard : ''}`);
  }
  if (from === 'combat' && bs.verbose) log(bs, `combat over → ${to}; hull ${run.player.hull}/${run.player.hullMax} crew ${run.player.crew.length}`);
  bs.mode = to;
}

// ------------------------------------------------------------------ invariants
function num(x) { return typeof x === 'number' && isFinite(x); }

function checkShip(G, run, ship, errs) {
  const R = G.data.rules, W = G.data.weapons, tag = ship.id;
  if (!num(ship.hull) || ship.hull < 0 || ship.hull > ship.hullMax) errs.push(`${tag}.hull ${ship.hull}/${ship.hullMax}`);
  const used = G.Ship.reactorUsed(ship);
  if (!(used <= ship.reactor)) errs.push(`${tag} reactorUsed ${used} > reactor ${ship.reactor}`);
  for (const k of Object.keys(ship.systems)) {
    const s = ship.systems[k];
    for (const f of ['level', 'power', 'damage', 'ion', 'ionT', 'repairProg']) if (!num(s[f])) errs.push(`${tag}.${k}.${f} = ${s[f]}`);
    if (s.power > G.Ship.usable(s)) errs.push(`${tag}.${k} power ${s.power} > usable ${G.Ship.usable(s)}`);
    if (s.power < 0 || s.damage < 0 || s.damage > s.level) errs.push(`${tag}.${k} power/damage out of range`);
    if (s.ion < 0 || s.ion > Math.min(s.level, R.ionMaxStacks)) errs.push(`${tag}.${k} ion ${s.ion}`);
  }
  if (ship.systems.weapons) {
    const wp = ship.weapons.reduce((a, w) => a + (w.on ? W[w.id].power : 0), 0);
    if (wp !== ship.systems.weapons.power) errs.push(`${tag} weapons.power ${ship.systems.weapons.power} != Σon ${wp}`);
  }
  ship.weapons.forEach((w, i) => {
    if (!num(w.charge) || w.charge < 0 || w.charge > W[w.id].charge + 1e-9) errs.push(`${tag}.w${i} charge ${w.charge}`);
    if (w.target !== null && !(Number.isInteger(w.target) && w.target >= 0)) errs.push(`${tag}.w${i} target ${w.target}`);
  });
  if (ship.weapons.length > ship.weaponSlots) errs.push(`${tag} weapons > slots`);
  ship.rooms.forEach((r) => {
    if (!num(r.o2) || r.o2 < 0 || r.o2 > 100) errs.push(`${tag}.room${r.id}.o2 ${r.o2}`);
    const t = r.w * r.h;
    if (!(r.fire >= 0 && r.fire <= t) || !(r.breach >= 0 && r.breach <= t)) errs.push(`${tag}.room${r.id} fire/breach ${r.fire}/${r.breach}`);
  });
  ship.crew.forEach((c) => {
    if (!num(c.hp) || c.hp > c.hpMax + 1e-9) errs.push(`${tag} crew ${c.name} hp ${c.hp}`);
    if (!(c.room >= 0 && c.room < ship.rooms.length)) errs.push(`${tag} crew ${c.name} room ${c.room}`);
  });
  if (!num(ship.shieldLayers) || ship.shieldLayers < 0 || !num(ship.shieldCharge)) errs.push(`${tag} shields ${ship.shieldLayers}/${ship.shieldCharge}`);
  if (!num(ship.ftl) || ship.ftl < 0 || ship.ftl > 1) errs.push(`${tag}.ftl ${ship.ftl}`);
}

function walkNaN(o, path, errs, depth) {
  if (depth > 12 || errs.length > 20) return;
  if (typeof o === 'number') { if (!isFinite(o)) errs.push(`${path} = ${o}`); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) if (k.charAt(0) !== '_') walkNaN(o[k], path + '.' + k, errs, depth + 1);
}

// Returns [] when every invariant holds; `full` also scans the whole run for NaN/Infinity.
export function checkInvariants(G, run, full) {
  const errs = [], m = run.mode, R = G.data.rules;
  if ((run.event != null) !== (m === 'event')) errs.push(`event ${!!run.event} in mode ${m}`);
  if ((run.combat != null) !== (m === 'combat')) errs.push(`combat ${!!run.combat} in mode ${m}`);
  if ((run.reward != null) !== (m === 'reward')) errs.push(`reward ${!!run.reward} in mode ${m}`);
  if ((run.sectorChoices != null) !== (m === 'sectorSelect')) errs.push(`sectorChoices in mode ${m}`);
  if ((run.end != null) !== (m === 'gameover' || m === 'victory')) errs.push(`end ${!!run.end} in mode ${m}`);
  for (const k of ['scrap', 'fuel', 'missiles']) {
    if (!Number.isInteger(run.res[k]) || run.res[k] < 0) errs.push(`res.${k} = ${run.res[k]}`);
  }
  if (run.cargo.length > R.cargoMax) errs.push('cargo overflow');
  if (run.augments.length > R.augmentMax) errs.push('augments overflow');
  if (run.player.crew.length > R.maxCrew) errs.push('crew overflow');
  if (!run.player.crew.length && m !== 'gameover' && !(m === 'combat' && run.combat.pending)) errs.push(`no crew in mode ${m}`);
  if (!run.sector || !run.sector.beacons[run.at]) errs.push('bad beacon');
  checkShip(G, run, run.player, errs);
  if (run.combat) {
    checkShip(G, run, run.combat.enemy, errs);
    const c = run.combat;
    if (c.result && !c.pending) errs.push('result without pending');
    if (m === 'combat' && c.boss && run.sectorIndex !== G.CFG.SECTORS - 1) errs.push('boss outside the final sector');
  }
  if (full) walkNaN(run, 'run', errs, 0);
  return errs;
}

// ------------------------------------------------------------------ whole runs
export function playRun(G, opts = {}) {
  const maxSimSeconds = (opts.maxMinutes || 120) * 60;
  const maxUnits = opts.maxUnits || 400000;
  const { run, bs } = newGame(G, opts);
  const out = { seed: opts.seed, ship: run.shipId, difficulty: run.difficulty };
  let err = null, errs = [];
  try {
    let lastMode = run.mode;
    errs = checkInvariants(G, run, true);
    while (!isOver(run) && !errs.length) {
      advance(G, run, bs);
      const full = run.mode !== lastMode || bs.units % 300 === 0;
      lastMode = run.mode;
      errs = checkInvariants(G, run, full);
      if (run.stats.time > maxSimSeconds || bs.units > maxUnits) { out.timeout = true; break; }
    }
  } catch (e) {
    err = e;
  }
  const st = run.stats;
  Object.assign(out, {
    win: run.mode === 'victory',
    mode: run.mode,
    reason: err ? 'exception' : errs.length ? 'invariant' : out.timeout ? 'timeout' : run.end ? run.end.reason : '?',
    sector: run.sectorIndex,
    beacons: st.beacons, jumps: st.jumps, time: st.time, combatTime: st.combatTime,
    kills: st.kills, scrapEarned: st.scrapEarned, crewLost: st.crewLost, crewHired: st.crewHired,
    hull: run.player.hull, hullMax: run.player.hullMax, reactor: run.player.reactor,
    systems: Object.fromEntries(Object.keys(run.player.systems).map((k) => [k, run.player.systems[k].level])),
    weapons: run.player.weapons.map((w) => w.id), augments: run.augments.slice(), crewN: run.player.crew.length,
    bot: bs.stats, units: bs.units,
    lastFight: bs.stats.lastFight,
  });
  if (err) out.error = { message: String(err && err.message), stack: String(err && err.stack) };
  if (errs.length) out.invariant = errs.slice(0, 10);
  out.state = run;
  return out;
}

// ------------------------------------------------------------------ report
function pct(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : '-'; }
function mean(a, f) { return a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0; }

export function report(results, label) {
  const lines = [];
  const n = results.length;
  const wins = results.filter((r) => r.win).length;
  lines.push(`== ${label}: ${n} runs, wins ${wins} (${pct(wins, n)})`);
  const hist = {};
  results.filter((r) => !r.win).forEach((r) => { hist[r.sector] = (hist[r.sector] || 0) + 1; });
  lines.push(`   death sector: ${[0, 1, 2, 3, 4].map((s) => `s${s}:${hist[s] || 0}`).join('  ')}`);
  const causes = {};
  results.filter((r) => !r.win).forEach((r) => {
    const f = r.lastFight;
    const k = r.reason + (f && (r.reason === 'hull' || r.reason === 'crew') ? '/' + (f.boss ? 'boss' : f.elite ? 'elite' : f.faction) : '');
    causes[k] = (causes[k] || 0) + 1;
  });
  lines.push(`   causes: ${Object.keys(causes).sort().map((k) => `${k}:${causes[k]}`).join('  ')}`);
  lines.push(`   avg sectors cleared ${mean(results, (r) => (r.win ? 5 : r.sector)).toFixed(2)}  beacons ${mean(results, (r) => r.beacons).toFixed(1)}` +
    `  jumps ${mean(results, (r) => r.jumps).toFixed(1)}  fights ${mean(results, (r) => r.bot.fights).toFixed(1)}` +
    ` (elite ${mean(results, (r) => r.bot.eliteFights).toFixed(2)})  fled ${mean(results, (r) => r.bot.fled).toFixed(2)}`);
  lines.push(`   avg sim time ${(mean(results, (r) => r.time) / 60).toFixed(1)} min, combat ${(mean(results, (r) => r.combatTime) / 60).toFixed(1)} min` +
    ` (${(mean(results, (r) => r.combatTime / Math.max(1, r.bot.fights))).toFixed(0)} s/fight)`);
  lines.push(`   avg scrap earned ${mean(results, (r) => r.scrapEarned).toFixed(0)}  spent ${mean(results, (r) => r.bot.scrapSpent).toFixed(0)}` +
    `  sold ${mean(results, (r) => r.bot.scrapSold).toFixed(0)}  surrenders acc/ref ${mean(results, (r) => r.bot.surrendersAccepted).toFixed(2)}/${mean(results, (r) => r.bot.surrendersRefused).toFixed(2)}`);
  lines.push(`   fuel stockouts: ${results.filter((r) => r.bot.waits > 0).length} runs (${mean(results, (r) => r.bot.waits).toFixed(2)} waits/run);` +
    ` missile stockouts: ${results.filter((r) => r.bot.missileOutFights > 0).length} runs (${mean(results, (r) => r.bot.missileOutFights).toFixed(2)} fights/run)`);
  lines.push(`   crew lost ${mean(results, (r) => r.crewLost).toFixed(2)}  hired ${mean(results, (r) => r.crewHired).toFixed(2)}  detours ${mean(results, (r) => r.bot.detours).toFixed(2)}`);
  const agg = (f) => {
    const m = {};
    results.forEach((r) => { const o = f(r); Object.keys(o).forEach((k) => { m[k] = (m[k] || 0) + o[k]; }); });
    return Object.keys(m).sort((a, b) => m[b] - m[a]).map((k) => `${k}:${(m[k] / n).toFixed(2)}`).join(' ');
  };
  lines.push(`   upgrades/run: ${agg((r) => r.bot.upgrades)}`);
  lines.push(`   weapons bought/run: ${agg((r) => r.bot.weaponsBought)}`);
  lines.push(`   augments bought/run: ${agg((r) => r.bot.augsBought)}  crew bought ${mean(results, (r) => r.bot.crewBought).toFixed(2)}` +
    `  fuel ${mean(results, (r) => r.bot.fuelBought).toFixed(1)}  missiles ${mean(results, (r) => r.bot.missilesBought).toFixed(1)}  hull ${mean(results, (r) => r.bot.hullBought).toFixed(1)}`);
  lines.push(`   sectors chosen/run: ${agg((r) => r.bot.sectorsChosen)}`);
  const bad = results.filter((r) => r.error || r.invariant || r.timeout);
  lines.push(`   exceptions ${results.filter((r) => r.error).length}, invariant failures ${results.filter((r) => r.invariant).length}, timeouts ${results.filter((r) => r.timeout).length}`);
  bad.slice(0, 5).forEach((r) => {
    lines.push(`   !! seed ${r.seed} ${r.ship}: ${r.error ? r.error.stack : r.invariant ? r.invariant.join('; ') : 'timeout (' + r.mode + ')'}`);
  });
  return lines.join('\n');
}

// ------------------------------------------------------------------ CLI
function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
  const N = Number(opt('--runs', 20));
  const ship = opt('--ship', 'both');
  const difficulty = opt('--difficulty', 'normal');
  const seed0 = Number(opt('--seed', 1));
  const verbose = args.indexOf('--verbose') >= 0;
  const maxMinutes = Number(opt('--max-minutes', 120));
  const ships = ship === 'both' ? ['falcon', 'thunder'] : [ship];
  const G = loadGame();
  // Sim code must never use Math.random / Date: throwing guards inside the vm realm.
  G.U.clamp.constructor("Math.random = function () { throw new Error('Math.random in sim'); };" +
    "Date = function () { throw new Error('Date in sim'); }; Date.now = Date;")();
  const t0 = process.hrtime.bigint();
  const results = [];
  for (let i = 0; i < N; i++) {
    const shipId = ships[i % ships.length];
    const seed = seed0 + i;
    const r = playRun(G, { seed, shipId, difficulty, verbose, maxMinutes });
    delete r.state;
    results.push(r);
    if (verbose || r.error || r.invariant) {
      console.log(`run ${i} seed ${seed} ${shipId}: ${r.win ? 'WIN' : r.reason} sector ${r.sector} beacons ${r.beacons}` +
        ` fights ${r.bot.fights} time ${(r.time / 60).toFixed(1)}m hull ${r.hull}/${r.hullMax} R${r.reactor}` +
        ` ${JSON.stringify(r.systems)} ${r.weapons.join(',')} [${r.augments.join(',')}]`);
      if (r.error) console.log(r.error.stack);
      if (r.invariant) console.log('invariant: ' + r.invariant.join('; '));
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  for (const s of ships) console.log(report(results.filter((r) => r.ship === s), `${s} / ${difficulty}`));
  if (ships.length > 1) console.log(report(results, `all / ${difficulty}`));
  console.log(`(${N} runs in ${(ms / 1000).toFixed(1)} s)`);
  if (args.indexOf('--json') >= 0) console.log(JSON.stringify(results));
  const failed = results.some((r) => r.error || r.invariant);
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
