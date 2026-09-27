// sim-combat: ship model — power accounting, blocks, evasion, shields, ion, beamRooms, crew movement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSim, makeRun, DT } from './combat-helpers.mjs';

const G = loadSim();
const R = G.data.rules;

function checkInvariants(ship, label) {
  const S = ship.systems;
  assert.ok(G.Ship.reactorUsed(ship) <= ship.reactor, `${label}: reactorUsed ${G.Ship.reactorUsed(ship)} > ${ship.reactor}`);
  for (const id of G.data.systems.reactorOrder) {
    if (!S[id]) continue;
    assert.ok(S[id].power >= 0 && S[id].power <= G.Ship.usable(S[id]), `${label}: ${id} power ${S[id].power} > usable`);
  }
  const wp = ship.weapons.reduce((a, w) => a + (w.on ? G.data.weapons[w.id].power : 0), 0);
  assert.equal(S.weapons.power, wp, `${label}: weapons.power is derived`);
  assert.ok(wp <= G.Ship.usable(S.weapons), `${label}: weapons power ${wp} > usable`);
  if (S.piloting) assert.equal(S.piloting.power, G.Ship.usable(S.piloting), `${label}: piloting power = usable`);
}

test('createPlayer: starting power, unique crew names, stations', () => {
  for (const id of G.data.shipOrder) {
    const run = makeRun(G, { shipId: id, seed: 3 });
    const p = run.player;
    checkInvariants(p, id);
    assert.equal(p.hull, p.hullMax);
    assert.equal(p.shieldLayers, G.Ship.maxLayers(p));
    assert.equal(p.systems.shields.power, p.systems.shields.level, `${id} shields full`);
    assert.ok(p.weapons.every((w) => w.on && w.want), `${id} weapons on`);
    assert.equal(p.systems.oxygen.power, 1);
    const names = p.crew.map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
    for (const c of p.crew) {
      assert.ok(G.data.crew.names.includes(c.name));
      const sys = p.rooms[c.room].sys;
      if (sys && G.data.systems.defs[sys].station) assert.equal(c.station, c.room);
    }
  }
  const f = makeRun(G, { shipId: 'falcon' }).player;
  // falcon: shields 2 + weapons 3 + oxygen 1 + engines 2 = 8 = reactor; medbay stays at 0
  assert.equal(f.systems.engines.power, 2);
  assert.equal(f.systems.medbay.power, 0);
  assert.equal(G.Ship.reactorFree(f), 0);
});

test('power invariants hold under randomized damage / ion / power commands; restore after repair', () => {
  const rr = G.RNG.create(99);
  for (const shipId of G.data.shipOrder) {
    for (let trial = 0; trial < 20; trial++) {
      const run = makeRun(G, { shipId, seed: 100 + trial });
      const p = run.player;
      p.reactor += G.RNG.int(rr, 0, 4);
      const ids = Object.keys(p.systems);
      for (let i = 0; i < 300; i++) {
        const op = G.RNG.int(rr, 0, 7);
        const sid = G.RNG.pick(rr, ids);
        if (op === 0) G.Ship.damageSystem(p, sid, G.RNG.int(rr, 1, 3));
        else if (op === 1) G.Ship.ionSystem(p, sid, G.RNG.int(rr, 1, 2));
        else if (op === 2) G.Ship.addPower(p, sid);
        else if (op === 3) G.Ship.removePower(p, sid);
        else if (op === 4) G.Ship.toggleWeapon(p, G.RNG.int(rr, 0, p.weapons.length));
        else if (op === 5) { const s = p.systems[sid]; if (s.damage > 0) s.damage--; }
        else G.Combat.idle(run, G.RNG.range(rr, 0.01, 0.5));
        if (op <= 1 || op === 5) G.Ship.enforcePower(p);
        checkInvariants(p, `${shipId} trial ${trial} op ${i}`);
      }
      // full repair -> restorePower brings power back toward want using free reactor only
      for (const s of Object.values(p.systems)) { s.damage = 0; s.ion = 0; s.ionT = 0; }
      G.Ship.enforcePower(p);
      G.Ship.restorePower(p);
      checkInvariants(p, `${shipId} trial ${trial} repaired`);
      for (const id of G.data.systems.reactorOrder) {
        const s = p.systems[id];
        if (!s) continue;
        assert.ok(s.power <= s.want, `${id} power ${s.power} above want ${s.want}`);
        if (s.power < s.want) assert.ok(G.Ship.reactorFree(p) < 1, `${id} below want with free reactor`);
      }
    }
  }
});

test('damage drops power, repair restores it to want', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  G.Ship.damageSystem(p, 'shields', 1);
  assert.equal(p.systems.shields.power, 1);
  assert.equal(p.systems.shields.want, 2);
  G.Ship.damageSystem(p, 'weapons', 1);          // weapons usable 2: last slot (missile) turns off, want kept
  assert.equal(p.weapons[1].on, false);
  assert.equal(p.weapons[1].want, true);
  assert.equal(p.systems.weapons.power, 2);
  p.systems.shields.damage = 0;
  p.systems.weapons.damage = 0;
  G.Combat.idle(run, DT);
  assert.equal(p.systems.shields.power, 2);
  assert.equal(p.weapons[1].on, true);
  assert.equal(p.systems.weapons.power, 3);
});

test('addPower / removePower / toggleWeapon and powerBlock / toggleBlock reasons', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  assert.equal(G.Ship.powerBlock(p, 'piloting'), 'fixed');
  assert.equal(G.Ship.addPower(p, 'piloting'), false);
  assert.equal(G.Ship.powerBlock(p, 'shields'), 'max');
  assert.equal(G.Ship.powerBlock(p, 'medbay'), 'reactor');
  assert.equal(G.Ship.addPower(p, 'medbay'), false);
  assert.equal(G.Ship.powerBlock(p, 'weapons'), 'max');     // all weapons on
  // free a bar
  assert.equal(G.Ship.removePower(p, 'engines'), true);
  assert.equal(p.systems.engines.want, 1);
  assert.equal(G.Ship.powerBlock(p, 'medbay'), '');
  assert.equal(G.Ship.addPower(p, 'medbay'), true);
  assert.equal(p.systems.medbay.power, 1);
  assert.equal(p.systems.medbay.want, 1);
  assert.equal(G.Ship.powerBlock(p, 'medbay'), 'max');       // medbay level 1
  // weapons: removePower turns off the highest on slot
  assert.equal(G.Ship.removePower(p, 'weapons'), true);
  assert.equal(p.weapons[1].on, false);
  assert.equal(p.weapons[1].want, false);
  assert.equal(p.systems.weapons.power, 2);
  assert.equal(G.Ship.reactorFree(p), 1);
  assert.equal(G.Ship.toggleBlock(p, 1), '');
  assert.equal(G.Ship.addPower(p, 'weapons'), true);           // lowest off slot that fits
  assert.equal(p.weapons[1].on, true);
  // toggle off/on
  assert.equal(G.Ship.toggleWeapon(p, 0), true);
  assert.equal(p.weapons[0].on, false);
  assert.equal(G.Ship.reactorFree(p), 2);
  G.Ship.addPower(p, 'engines');                               // uses one bar -> only 1 free
  assert.equal(G.Ship.toggleBlock(p, 0), 'reactor');           // burst2 needs 2
  assert.equal(G.Ship.toggleWeapon(p, 0), false);
  assert.equal(G.Ship.powerBlock(p, 'weapons'), 'reactor');
  G.Ship.removePower(p, 'shields'); G.Ship.removePower(p, 'shields');
  assert.equal(G.Ship.toggleBlock(p, 0), '');
  // weapon capacity: damage weapons -> 'broken'; beyond level -> 'capacity'
  G.Ship.damageSystem(p, 'weapons', 2);                        // usable 1: missile (1) fits, burst (2) not
  assert.equal(p.weapons[1].on, true);
  assert.equal(G.Ship.toggleBlock(p, 0), 'broken');
  assert.equal(G.Ship.powerBlock(p, 'weapons'), 'broken');
  p.systems.weapons.damage = 0;
  p.systems.weapons.level = 2;                                 // 1 + 2 > level 2
  assert.equal(G.Ship.toggleBlock(p, 0), 'capacity');
  assert.equal(G.Ship.powerBlock(p, 'weapons'), 'max');
  p.systems.weapons.level = 3;
  // reactor systems: broken vs ion
  G.Ship.addPower(p, 'shields'); G.Ship.addPower(p, 'shields');
  assert.equal(p.systems.shields.power, 2);
  G.Ship.ionSystem(p, 'shields', 1);
  assert.equal(p.systems.shields.power, 1);
  assert.equal(G.Ship.powerBlock(p, 'shields'), 'ion');
  p.systems.shields.ion = 0;
  G.Ship.damageSystem(p, 'shields', 1);
  assert.equal(G.Ship.powerBlock(p, 'shields'), 'broken');
  assert.equal(G.Ship.powerBlock(p, 'nope'), 'noSystem');
  assert.equal(G.Ship.addPower(p, 'nope'), false);
  checkInvariants(p, 'blocks');
});

test('upgrade leaves power; a new reactor bar is free power', () => {
  const p = makeRun(G, { shipId: 'falcon' }).player;
  p.systems.shields.level++;
  assert.equal(p.systems.shields.power, 2);
  p.reactor++;
  assert.equal(G.Ship.reactorFree(p), 1);
  assert.equal(G.Ship.addPower(p, 'shields'), true);
});

test('evasionInfo cases', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  let e = G.Ship.evasionInfo(p);
  // engines 2 -> 10, engines manned +5, pilot manned (x1) +5
  assert.equal(JSON.stringify(e), JSON.stringify({ total: 20, base: 10, engMan: true, pilotMan: true, mult: 1, why: '' }));
  // unmanned level-1 piloting -> 0
  const pilot = p.crew.find((c) => c.room === 0);
  G.Crew.place(p, pilot, 1);
  e = G.Ship.evasionInfo(p);
  assert.equal(e.total, 0);
  assert.equal(e.why, 'piloting');
  assert.equal(G.Ship.canChargeFtl(p), false);
  G.Crew.place(p, pilot, 0);
  // engines unpowered -> 0
  while (G.Ship.removePower(p, 'engines'));
  e = G.Ship.evasionInfo(p);
  assert.equal(e.total, 0);
  assert.equal(e.why, 'engines');

  // thunder: piloting level 2 autopilot x0.5
  const run2 = makeRun(G, { shipId: 'thunder' });
  const t = run2.player;
  const tp = t.crew.find((c) => c.room === 0);
  G.Crew.place(t, tp, 5);
  e = G.Ship.evasionInfo(t);
  // (10 + 5 engines manned) * 0.5 = 7.5 -> 8
  assert.equal(e.total, 8);
  assert.equal(e.mult, 0.5);
  assert.equal(e.pilotMan, false);
  assert.equal(G.Ship.canChargeFtl(t), true);
  // piloting damaged to 0 usable -> 0
  G.Ship.damageSystem(t, 'piloting', 2);
  assert.equal(G.Ship.evasionInfo(t).total, 0);
  assert.equal(G.Ship.evasionInfo(t).why, 'piloting');
  // manned engines room with fire: no manning bonus
  const r3 = makeRun(G, { shipId: 'falcon' });
  r3.player.rooms[8].fire = 1;
  assert.equal(G.Ship.evasionInfo(r3.player).engMan, false);
  assert.equal(G.Ship.evasionInfo(r3.player).total, 15);
  // cap at evasionMax
  r3.player.rooms[8].fire = 0;
  r3.player.systems.engines.level = 8; r3.player.reactor = 30;
  while (G.Ship.addPower(r3.player, 'engines'));
  r3.player.crew.forEach(() => {});
  assert.ok(G.Ship.evasion(r3.player) <= R.evasionMax);
});

test('crewless evasion uses crewlessPilotMult and no manning bonus', () => {
  const run = makeRun(G, { seed: 4 });
  const c = G.Combat.create(run, { faction: 'auto' });
  const e = c.enemy;
  assert.equal(e.crewless, true);
  assert.equal(e.crew.length, 0);
  const info = G.Ship.evasionInfo(e);
  assert.equal(info.mult, R.crewlessPilotMult);
  assert.equal(info.total, Math.round(R.evasionByEngine[e.systems.engines.power] * R.crewlessPilotMult));
  assert.equal(info.engMan, false);
});

test('shields recharge semantics', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  assert.equal(G.Ship.maxLayers(p), 1);
  p.shieldLayers = 0; p.shieldCharge = 0;
  // unmanned: 2 s per layer
  for (let i = 0; i < 30; i++) G.Combat.idle(run, DT);
  assert.equal(p.shieldLayers, 0);
  assert.ok(Math.abs(p.shieldCharge - 0.5) < 0.02, `charge ${p.shieldCharge}`);
  for (let i = 0; i < 31; i++) G.Combat.idle(run, DT);
  assert.equal(p.shieldLayers, 1);
  assert.equal(p.shieldCharge, 0);
  // at max: charge stays 0
  for (let i = 0; i < 10; i++) G.Combat.idle(run, DT);
  assert.equal(p.shieldCharge, 0);
  // knocking a layer down does not change the charge; manned recharge is faster
  const crew = p.crew.find((c) => c.room === 2);
  G.Crew.place(p, crew, 3);
  crew.station = 3;
  G.Combat.idle(run, DT);
  assert.equal(G.Ship.isManned(p, 'shields'), true);
  p.shieldLayers = 0;
  let t = 0;
  while (p.shieldLayers === 0 && t < 5) { G.Combat.idle(run, DT); t += DT; }
  assert.ok(t < R.shieldRecharge / R.mannedShieldMult + 0.05 && t > R.shieldRecharge / R.mannedShieldMult - 0.05, `manned t=${t}`);
  // layers above max are clamped (power removed)
  G.Ship.removePower(p, 'shields');
  G.Combat.idle(run, DT);
  assert.equal(p.shieldLayers, 0);
  assert.equal(p.shieldCharge, 0);
});

test('shield_booster augment speeds recharge', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  run.augments = ['shield_booster'];
  const p = run.player;
  p.shieldLayers = 0;
  let t = 0;
  while (p.shieldLayers === 0 && t < 5) { G.Combat.idle(run, DT); t += DT; }
  assert.ok(Math.abs(t - R.shieldRecharge * R.augmentFx.shieldBoosterMult) < 0.05, `t=${t}`);
});

test('ion stacks are capped and decay one stack per ionDuration', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  G.Ship.ionSystem(p, 'shields', 1);
  G.Ship.ionSystem(p, 'shields', 1);
  G.Ship.ionSystem(p, 'shields', 2);
  assert.equal(p.systems.shields.ion, Math.min(2, R.ionMaxStacks));
  assert.equal(p.systems.shields.power, 0);
  G.Ship.ionSystem(p, 'piloting', 2);                 // level 1 -> capped at 1
  assert.equal(p.systems.piloting.ion, 1);
  assert.equal(p.systems.piloting.power, 0);
  let t = 0;
  while (p.systems.shields.ion === 2) { G.Combat.idle(run, DT); t += DT; }
  assert.ok(Math.abs(t - R.ionDuration) < 0.05, `first stack after ${t}`);
  assert.equal(p.systems.shields.ion, 1);
  assert.equal(p.systems.shields.power, 1);          // restored toward want
  while (p.systems.shields.ion === 1) { G.Combat.idle(run, DT); t += DT; }
  assert.ok(Math.abs(t - 2 * R.ionDuration) < 0.1, `second stack after ${t}`);
  assert.equal(p.systems.shields.ionT, 0);
  assert.equal(p.systems.shields.power, 2);
  assert.equal(p.systems.piloting.ion, 0);
  assert.equal(p.systems.piloting.power, 1);
});

test('beamRooms ordering', () => {
  const f = makeRun(G, { shipId: 'falcon' }).player;
  // falcon row y=2: rooms 2 (x0), 3 (x2), 4 (x4)
  assert.equal(JSON.stringify(G.Ship.beamRooms(f, 3, 3)), '[3,4,2]');
  assert.equal(JSON.stringify(G.Ship.beamRooms(f, 4, 3)), '[4,3,2]');
  assert.equal(JSON.stringify(G.Ship.beamRooms(f, 2, 2)), '[2,3]');
  assert.equal(JSON.stringify(G.Ship.beamRooms(f, 0, 3)), '[0]');
  assert.equal(JSON.stringify(G.Ship.beamRooms(f, 3, 1)), '[3]');
  // 2-tall rooms: row = target.y only
  const t = makeRun(G, { shipId: 'thunder' }).player;
  assert.equal(JSON.stringify(G.Ship.beamRooms(t, 8, 3)), '[8,7]');
  assert.equal(JSON.stringify(G.Ship.beamRooms(t, 5, 3)), '[5,6,4]');
});

test('jumpReset clears damage/ion/fires/breaches/o2, restores shields, never touches hull', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  p.hull = 12;
  G.Ship.damageSystem(p, 'shields', 2);
  G.Ship.ionSystem(p, 'engines', 1);
  p.rooms[3].fire = 2; p.rooms[5].breach = 1; p.rooms[6].o2 = 10;
  p.shieldLayers = 0;
  G.Ship.jumpReset(p);
  assert.equal(p.hull, 12);
  assert.equal(p.systems.shields.damage, 0);
  assert.equal(p.systems.engines.ion, 0);
  assert.equal(p.systems.shields.power, 2);
  assert.equal(p.systems.engines.power, 2);
  assert.equal(p.shieldLayers, 1);
  assert.ok(p.rooms.every((r) => r.fire === 0 && r.breach === 0 && r.o2 === 100));
});

test('crew pathing between far rooms; slots; order sets station only when free', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  const pilot = p.crew.find((c) => c.room === 0);
  const path = G.Crew.path(p, 0, 8);
  assert.equal(JSON.stringify(path), '[1,3,6,8]');
  assert.equal(G.Crew.order(p, pilot.id, 8), true);
  assert.equal(pilot.station, 0, 'engines already has a stationed crew');
  // expected time = sum of center distances / walk speed
  const pts = [0, 1, 3, 6, 8].map((i) => G.Ship.roomCenter(p, i));
  let dist = 0;
  for (let i = 1; i < pts.length; i++) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const expect = dist / R.crewWalkTilesPerSec;
  let t = 0, sawMid = false;
  while (pilot.path.length && t < 20) {
    G.Combat.idle(run, DT); t += DT;
    const pos = G.Crew.pos(p, pilot);
    if (pos.y > 2 && pos.y < 6) sawMid = true;
    if (pilot.path.length) assert.equal(pilot.task, 'walk');
  }
  assert.ok(sawMid);
  assert.ok(Math.abs(t - expect) < 0.1, `walk ${t} vs ${expect}`);
  assert.equal(pilot.room, 8);
  assert.equal(pilot.slot, 1, 'slot 0 is held by the engines crew');
  G.Combat.idle(run, DT);
  assert.equal(G.Ship.mannedBy(p, 'engines').station, 8);
  // a crew member with a station keeps it when sent to another free station room
  assert.equal(G.Crew.order(p, pilot.id, 3), true);
  assert.equal(pilot.station, 0, 'the pilot keeps the cockpit');
  // a crew member without a station takes the free one; invalid orders fail
  pilot.station = null;
  assert.equal(G.Crew.order(p, pilot.id, 3), true);
  assert.equal(pilot.station, 3);
  pilot.station = 0;
  assert.equal(G.Crew.order(p, pilot.id, 99), false);
  assert.equal(G.Crew.order(p, 'nobody', 1), false);
  // returnToStations
  const eng = p.crew.find((c) => c.station === 8);
  G.Crew.order(p, eng.id, 5);
  for (let i = 0; i < 200; i++) G.Combat.idle(run, DT);
  assert.equal(eng.room, 5);
  G.Crew.returnToStations(p);
  for (let i = 0; i < 200; i++) G.Combat.idle(run, DT);
  assert.equal(eng.room, 8);
  assert.equal(eng.task, 'man');
  assert.equal(eng.slot, 0);
});

test('re-order mid-walk finishes the current hop then reroutes', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  const c = p.crew.find((x) => x.room === 0);
  G.Crew.order(p, c.id, 8);
  for (let i = 0; i < 5; i++) G.Combat.idle(run, DT);
  assert.equal(c.room, 0);
  G.Crew.order(p, c.id, 0);                 // back
  assert.equal(JSON.stringify(c.path), '[1,0]');
  for (let i = 0; i < 120; i++) G.Combat.idle(run, DT);
  assert.equal(c.room, 0);
  assert.equal(c.path.length, 0);
});

test('sending the pilot to help keeps the cockpit station; 全员回岗 refills an empty cockpit', () => {
  const run = makeRun(G, { shipId: 'falcon' });
  const p = run.player;
  const cockpit = p.rooms.findIndex((r) => r.sys === 'piloting');
  const pilot = p.crew.find((c) => c.station === cockpit);
  const free = p.rooms.findIndex((r, i) => r.sys && G.data.systems.defs[r.sys].station && p.systems[r.sys] &&
    !G.Ship.stationedAt(p, i));
  if (free >= 0) {
    G.Crew.order(p, pilot.id, free);
    assert.equal(pilot.station, cockpit);
  }
  G.Crew.order(p, pilot.id, 5);
  for (let i = 0; i < 200; i++) G.Combat.idle(run, DT);
  G.Crew.returnToStations(p);
  for (let i = 0; i < 200; i++) G.Combat.idle(run, DT);
  assert.equal(pilot.room, cockpit);
  // pilot gone: the holder of the least important station takes the cockpit
  pilot.hp = 0;
  G.Combat.idle(run, DT);
  assert.equal(G.Ship.stationedAt(p, cockpit), null);
  G.Crew.returnToStations(p);
  const np = G.Ship.stationedAt(p, cockpit);
  assert.ok(np, 'someone is stationed in the cockpit');
  for (let i = 0; i < 300; i++) G.Combat.idle(run, DT);
  assert.equal(np.room, cockpit);
});
