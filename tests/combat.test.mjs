// sim-combat: combat create/step, weapons, projectiles, beams, environment, crew, AI, enemies, boss, determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSim, makeRun, stepN, DT } from './combat-helpers.mjs';

const G = loadSim();
const R = G.data.rules;
const E = G.data.enemies;
const Wd = G.data.weapons;

// A combat with a calm enemy: no evasion, no flee/surrender, weapons unpowered.
function calmCombat(opts = {}) {
  const run = makeRun(G, opts);
  const c = G.Combat.create(run, { faction: opts.faction || 'rebel', hazard: 'none' });
  const e = c.enemy;
  if (opts.hullType) {
    c.enemy = G.Enemies.generate(run, { faction: opts.faction || 'rebel', hullType: opts.hullType });
    G.AI.init(run, c);
  }
  const en = c.enemy;
  en.canFlee = false; en.canSurrender = false;
  if (en.systems.engines) { en.systems.engines.power = 0; en.systems.engines.want = 0; }
  en.weapons.forEach((w) => { w.on = false; w.want = false; w.charge = 0; });
  G.Ship.enforcePower(en);
  en.hull = en.hullMax = 30;
  void e;
  return { run, c, e: en, p: run.player };
}

function roomOf(ship, sys) { return ship.systems[sys].room; }

test('combat start resets: no instant flee, weapons uncharged and untargeted, shields full', () => {
  const run = makeRun(G, { seed: 11 });
  const p = run.player;
  p.ftl = 1;
  p.weapons.forEach((w) => { w.charge = Wd[w.id].charge; w.target = 2; });
  p.shieldLayers = 0;
  const c = G.Combat.create(run, {});
  assert.equal(run.combat, c);
  assert.equal(p.ftl, 0);
  assert.equal(G.Combat.canFlee(run), false);
  assert.ok(p.weapons.every((w) => w.charge === 0 && w.target === null));
  assert.equal(p.shieldLayers, G.Ship.maxLayers(p));
  const e = c.enemy;
  assert.equal(e.shieldLayers, G.Ship.maxLayers(e));
  assert.equal(e.shieldCharge, 0);
  assert.equal(e.ftl, 0);
  for (const w of e.weapons) assert.ok(w.charge >= 0 && w.charge <= 0.25 * Wd[w.id].charge);
  assert.equal(c.faction, 'rebel');     // from the beacon
  assert.equal(c.hazard, 'none');
  const fx = G.Combat.drainFx(run);
  assert.ok(fx.some((f) => f.t === 'combatStart' && f.boss === false && f.elite === false));
  // one tick: nothing fires, no pending
  G.Combat.step(run, DT);
  assert.equal(c.projectiles.length, 0);
  assert.equal(c.pending, null);
  // pre_igniter: powered weapons start charged
  const run2 = makeRun(G, { seed: 11 });
  run2.augments = ['pre_igniter'];
  G.Ship.toggleWeapon(run2.player, 1);
  G.Combat.create(run2, {});
  assert.equal(run2.player.weapons[0].charge, Wd[run2.player.weapons[0].id].charge);
  assert.equal(run2.player.weapons[1].charge, 0);
  // elite -> fleet hazard, eliteMult reward; explicit faction / hazard
  const run3 = makeRun(G, { seed: 12, hazard: 'asteroid' });
  const c3 = G.Combat.create(run3, { elite: true });
  assert.equal(c3.hazard, 'fleet');
  assert.equal(c3.elite, true);
  assert.equal(c3.enemy.elite, true);
  assert.equal(c3.enemy.volley, true);
  assert.equal(c3.enemy.canFlee, false);
  assert.equal(c3.rewardMult, R.reward.eliteMult);
  const run4 = makeRun(G, { seed: 12, hazard: 'asteroid' });
  const c4 = G.Combat.create(run4, { faction: 'pirate' });
  assert.equal(c4.faction, 'pirate');
  assert.equal(c4.hazard, 'asteroid');
  assert.ok(c4.hazardT.player > 0 && c4.hazardT.enemy > 0);
});

test('player FTL charges in combat only; canFlee false for boss', () => {
  const { run, p } = calmCombat({ seed: 3 });
  const need = G.Ship.ftlTime(p);
  stepN(G, run, need - 0.5);
  assert.ok(p.ftl < 1 && p.ftl > 0.9);
  stepN(G, run, 1);
  assert.equal(p.ftl, 1);
  assert.equal(G.Combat.canFlee(run), true);
  run.combat = null;
  p.ftl = 0;
  G.Combat.idle(run, 1);
  assert.equal(p.ftl, 0);
  const run2 = makeRun(G, { seed: 3, sectorIndex: 4 });
  const c2 = G.Combat.create(run2, { boss: true });
  run2.player.ftl = 1;
  assert.equal(c2.boss, true);
  assert.equal(G.Combat.canFlee(run2), false);
});

test('burst2 (3 shots) vs 1 manned shield layer -> exactly 2 hull damage', () => {
  const { run, c, e, p } = calmCombat({ seed: 21, hullType: 'cruiser' });
  // enemy shields: power 2 (1 layer), manned
  e.systems.shields.level = 2; e.systems.shields.power = 2; e.systems.shields.want = 2;
  const sr = roomOf(e, 'shields');
  const guy = e.crew[0];
  G.Crew.place(e, guy, sr); guy.station = sr;
  e.crew.forEach((c2) => { if (c2 !== guy) c2.station = null; });
  G.Combat.step(run, DT);
  assert.equal(G.Ship.isManned(e, 'shields'), true);
  assert.equal(G.Ship.evasion(e), 0);
  e.shieldLayers = 1;
  G.Ship.toggleWeapon(p, 1);                                     // missile off
  const w = p.weapons[0];
  assert.equal(w.id, 'laser_burst2');
  w.charge = Wd.laser_burst2.charge;
  assert.equal(G.Combat.setTarget(run, 0, roomOf(e, 'piloting')), true);
  const hull0 = e.hull;
  stepN(G, run, 3);
  assert.equal(hull0 - e.hull, 2);
  assert.equal(w.target, roomOf(e, 'piloting'), 'laser keeps its target');
  void c;
});

test('shield absorb, ion on shields, unshielded ion -> system ion, missiles ignore shields', () => {
  const { run, c, e } = calmCombat({ seed: 22, hullType: 'cruiser' });
  e.systems.shields.level = 2; e.systems.shields.power = 2; e.systems.shields.want = 2;
  e.shieldLayers = 1;
  const hull0 = e.hull;
  G.Combat.launch(run, { from: 'player', to: 'enemy', kind: 'ion', weapon: 'ion_1', slot: 0, target: roomOf(e, 'weapons'),
    dmg: 0, ion: 1, sysDmg: 0, crewDmg: 0 });
  stepN(G, run, 1.0);
  assert.equal(e.shieldLayers, 0);
  assert.equal(e.systems.shields.ion, 1);
  assert.equal(e.systems.weapons.ion, 0);
  assert.equal(e.hull, hull0);
  const fx1 = G.Combat.drainFx(run);
  assert.ok(fx1.some((f) => f.t === 'shield' && f.side === 'enemy' && f.from === 'player' && f.to === 'enemy'));
  // unshielded ion: system ion, no hull damage
  G.Combat.launch(run, { from: 'player', to: 'enemy', kind: 'ion', weapon: 'ion_1', slot: 0, target: roomOf(e, 'weapons'),
    dmg: 0, ion: 1, sysDmg: 0, crewDmg: 0 });
  stepN(G, run, 1.0);
  assert.equal(e.systems.weapons.ion, 1);
  assert.equal(e.hull, hull0);
  assert.ok(G.Combat.drainFx(run).some((f) => f.t === 'ion' && f.side === 'enemy' && f.sys === 'weapons'));
  // missile ignores shields
  e.systems.shields.ion = 0; e.systems.shields.ionT = 0;
  G.Combat.step(run, DT);
  e.shieldLayers = 1;
  G.Combat.launch(run, { from: 'player', to: 'enemy', kind: 'missile', weapon: 'missile_artemis', slot: 1,
    target: roomOf(e, 'engines'), dmg: 2, sysDmg: 2, crewDmg: 0 });
  stepN(G, run, 1.2);
  assert.equal(e.hull, hull0 - 2);
  assert.equal(e.shieldLayers, 1);
  assert.equal(e.systems.engines.damage, Math.min(2, e.systems.engines.level));
  const fx = G.Combat.drainFx(run);
  const hit = fx.find((f) => f.t === 'hit');
  assert.equal(JSON.stringify(Object.keys(hit).sort()), JSON.stringify(['dmg', 'from', 'id', 'kind', 'side', 't', 'target', 'to']));
  assert.equal(hit.side, 'enemy');
  assert.ok(fx.some((f) => f.t === 'sysDamage' && f.side === 'enemy' && f.sys === 'engines'));
  void c;
});

test('ion weapon stacks capped on the target system', () => {
  const { run, e } = calmCombat({ seed: 23, hullType: 'cruiser' });
  e.systems.shields.power = 0; e.systems.shields.want = 0; e.shieldLayers = 0;
  e.systems.weapons.level = 4;
  for (let i = 0; i < 4; i++) {
    G.Combat.launch(run, { from: 'player', to: 'enemy', kind: 'ion', weapon: 'ion_heavy', slot: 0, target: roomOf(e, 'weapons'),
      dmg: 0, ion: 2, sysDmg: 0, crewDmg: 0, delay: i * 0.1 });
  }
  stepN(G, run, 2);
  assert.equal(e.systems.weapons.ion, R.ionMaxStacks);
});

test('beam timeline vs shields: nothing before delay, rooms applied in order, eff = dmg - layers', () => {
  const run = makeRun(G, { shipId: 'thunder', seed: 30 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  c.enemy = G.Enemies.generate(run, { faction: 'rebel', hullType: 'cruiser' });
  G.AI.init(run, c);
  const e = c.enemy;
  e.canFlee = false; e.canSurrender = false; e.hull = e.hullMax = 30;
  e.weapons.forEach((w) => { w.on = false; w.want = false; });
  e.systems.shields.level = 2; e.systems.shields.power = 2; e.systems.shields.want = 2; e.shieldLayers = 1;
  const p = run.player;
  G.Ship.toggleWeapon(p, 0);                       // ion off
  const w = p.weapons[1];
  assert.equal(w.id, 'beam_halberd');
  w.charge = Wd.beam_halberd.charge;
  G.Combat.setTarget(run, 1, 1);                   // cruiser row 1: rooms 1, 2, 3
  assert.equal(JSON.stringify(G.Combat.previewBeam(run, 1, 1)), '[1,2,3]');
  G.Combat.step(run, DT);
  assert.equal(c.beams.length, 1);
  const b = c.beams[0];
  assert.equal(JSON.stringify(b.rooms), '[1,2,3]');
  assert.equal(b.delay, R.flight.beam);
  assert.equal(b.dur, R.beamSweep);
  const bfx = G.Combat.drainFx(run).find((f) => f.t === 'beam');
  assert.equal(JSON.stringify(bfx.rooms), '[1,2,3]');
  const hull0 = e.hull;
  const hullAt = [];
  let t = DT;
  while (c.beams.length && t < 5) {
    G.Combat.step(run, DT); t += DT;
    hullAt.push([t, e.hull]);
    e.shieldLayers = 1;                            // hold one layer
  }
  for (const [tt, h] of hullAt) {
    const applied = [1, 2, 3].filter((k) => tt >= R.flight.beam + R.beamSweep * k / 3 + 1e-9).length;
    if (tt < R.flight.beam) assert.equal(h, hull0, `no damage before delay (t=${tt})`);
    if (Math.abs(tt - (R.flight.beam + R.beamSweep * 1 / 3)) > 0.05 && Math.abs(tt - (R.flight.beam + R.beamSweep * 2 / 3)) > 0.05 &&
        Math.abs(tt - (R.flight.beam + R.beamSweep)) > 0.05) {
      assert.equal(hull0 - h, applied, `t=${tt.toFixed(3)}`);
    }
  }
  assert.equal(hull0 - e.hull, 3);                 // 3 rooms x (2 - 1)
  assert.ok(e.systems.weapons.damage >= 1 && e.systems.shields.damage >= 1);
  // two layers: halberd (dmg 2) does nothing
  w.charge = Wd.beam_halberd.charge;
  e.systems.shields.damage = 0; e.systems.shields.level = 4; e.systems.shields.power = 4; e.systems.shields.want = 4;
  e.shieldLayers = 2;
  const hull1 = e.hull;
  stepN(G, run, 3);
  assert.equal(e.hull, hull1);
  // fire beam (dmg 0): only with zero layers
  assert.equal(JSON.stringify(G.Combat.previewBeam(run, 0, 1)), '[1]');
});

test('fire beam ignites only when shields are down', () => {
  const run = makeRun(G, { shipId: 'thunder', seed: 31 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  const e = c.enemy;
  e.canFlee = false; e.canSurrender = false;
  const target = roomOf(e, 'weapons');
  const mk = () => ({ id: G.U.uid(run, 'b'), from: 'player', to: 'enemy', weapon: 'beam_fire', slot: 1,
    rooms: G.Ship.beamRooms(e, target, 3), applied: [false, false, false].slice(0, G.Ship.beamRooms(e, target, 3).length),
    delay: R.flight.beam, t: 0, dur: R.beamSweep, dmg: 0, fire: 1, crewDmg: 15, sysDmg: 0 });
  e.shieldLayers = 1;
  e.rooms.forEach((r) => { r.fire = 0; });
  c.beams.push(mk());
  for (let i = 0; i < 90; i++) { e.shieldLayers = 1; G.Combat.step(run, DT); }
  assert.ok(e.rooms.every((r) => r.fire === 0));
  e.systems.shields.power = 0; e.systems.shields.want = 0; e.shieldLayers = 0;
  const hull0 = e.hull;
  c.beams.push(mk());
  stepN(G, run, 3);
  assert.ok(e.rooms[target].fire >= 1 || e.rooms.some((r) => r.fire > 0));
  assert.equal(e.hull, hull0);
});

test('volley with 0 missiles never deadlocks; missile weapon shows noMissiles', () => {
  const { run, c, e, p } = calmCombat({ seed: 40 });
  run.res.missiles = 0;
  G.Combat.setVolley(run, true);
  assert.equal(run.volley, true);
  G.Combat.setTarget(run, 0, roomOf(e, 'shields'));
  G.Combat.setTarget(run, 1, roomOf(e, 'shields'));
  let fired = 0;
  for (let i = 0; i < 30 * 30; i++) {
    G.Combat.step(run, DT);
    for (const f of G.Combat.drainFx(run)) if (f.t === 'launch' && f.from === 'player') fired++;
  }
  assert.ok(fired >= 6, `burst fired ${fired}`);
  assert.equal(run.res.missiles, 0);
  assert.equal(G.Combat.weaponState(run, p, 1).why, 'noMissiles');
  // an untargeted weapon never holds the volley either
  run.res.missiles = 8;
  G.Combat.setTarget(run, 1, null);
  p.weapons[0].charge = Wd[p.weapons[0].id].charge;
  p.weapons[1].charge = 0;
  assert.equal(G.Combat.weaponState(run, p, 0).why, '');
  // targeted but uncharged missile weapon holds the volley
  G.Combat.setTarget(run, 1, 0);
  assert.equal(G.Combat.weaponState(run, p, 0).why, 'volley');
  assert.equal(G.Combat.weaponState(run, p, 1).why, 'charging');
  void c;
});

test('volley: all eligible weapons fire on the same tick (ion + beam)', () => {
  const run = makeRun(G, { shipId: 'thunder', seed: 44 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  const e = c.enemy, p = run.player;
  e.canFlee = false; e.canSurrender = false;
  e.weapons.forEach((w) => { w.on = false; w.want = false; });
  G.Combat.setVolley(run, true);
  G.Combat.setTarget(run, 0, 1);
  G.Combat.setTarget(run, 1, 1);
  p.weapons[0].charge = Wd.ion_1.charge;
  p.weapons[1].charge = Wd.beam_halberd.charge - 0.01;
  assert.equal(G.Combat.weaponState(run, p, 0).why, 'volley');
  G.Combat.step(run, DT);
  const fx = G.Combat.drainFx(run).filter((f) => f.from === 'player' && (f.t === 'launch' || f.t === 'beam'));
  assert.equal(JSON.stringify(fx.map((f) => f.t)), '["launch","beam"]');
  assert.equal(p.weapons[0].charge, 0);
  assert.equal(p.weapons[1].charge, 0);
  // two missile weapons, one missile: only the first fires, no deadlock afterwards
  const run2 = makeRun(G, { shipId: 'falcon', seed: 45 });
  const c2 = G.Combat.create(run2, { faction: 'rebel', hazard: 'none' });
  c2.enemy.canFlee = false; c2.enemy.canSurrender = false;
  const p2 = run2.player;
  p2.weapons[0] = { uid: 'wx', id: 'missile_leto', on: false, want: false, charge: 0, target: null };
  G.Ship.enforcePower(p2);
  G.Ship.toggleWeapon(p2, 0);
  run2.res.missiles = 1;
  run2.volley = true;
  p2.weapons.forEach((w, i) => { w.charge = Wd[w.id].charge; G.Combat.setTarget(run2, i, 0); });
  G.Combat.step(run2, DT);
  assert.equal(run2.res.missiles, 0);
  assert.equal(G.Combat.drainFx(run2).filter((f) => f.t === 'launch' && f.from === 'player').length, 1);
  assert.equal(p2.weapons[1].charge, Wd[p2.weapons[1].id].charge);
  assert.equal(G.Combat.weaponState(run2, p2, 1).why, 'noMissiles');
});

test('player missile weapon clears its target after firing and consumes a missile', () => {
  const { run, e, p } = calmCombat({ seed: 41 });
  const w = p.weapons[1];
  assert.equal(w.id, 'missile_artemis');
  w.charge = Wd[w.id].charge;
  G.Combat.setTarget(run, 1, roomOf(e, 'weapons'));
  const m0 = run.res.missiles;
  G.Combat.step(run, DT);
  assert.equal(w.target, null);
  assert.equal(w.charge, 0);
  assert.equal(run.res.missiles, m0 - 1);
  assert.equal(G.Combat.weaponState(run, p, 1).why, 'charging');
  w.charge = Wd[w.id].charge;
  assert.equal(G.Combat.weaponState(run, p, 1).why, 'noTarget');
});

test('weaponState reasons and setTarget validation', () => {
  const run = makeRun(G, { seed: 42 });
  const p = run.player;
  assert.equal(G.Combat.weaponState(run, p, 0).why, 'noCombat');
  assert.equal(G.Combat.weaponState(run, p, 3).why, 'off');
  assert.equal(G.Combat.setTarget(run, 0, 1), false);
  const c = G.Combat.create(run, {});
  assert.equal(G.Combat.setTarget(run, 0, -1), false);
  assert.equal(G.Combat.setTarget(run, 0, c.enemy.rooms.length), false);
  assert.equal(G.Combat.setTarget(run, 0, 1.5), false);
  assert.equal(G.Combat.setTarget(run, 0, c.enemy.rooms.length - 1), true);
  assert.equal(G.Combat.setTarget(run, 0, null), true);
  assert.equal(G.Combat.setTarget(run, 7, 0), false);
  G.Ship.toggleWeapon(p, 0);
  assert.equal(G.Combat.weaponState(run, p, 0).why, 'off');
  // unpowered weapons decay
  p.weapons[0].charge = 5;
  G.Combat.step(run, 1);
  assert.ok(Math.abs(p.weapons[0].charge - (5 - R.weaponDecay)) < 1e-9);
  const ws = G.Combat.weaponState(run, p, 1);
  assert.ok(ws.frac > 0 && ws.frac < 1 && ws.ready === false);
});

test('manned weapons charge faster; out of combat weapons do not charge', () => {
  const { run, p } = calmCombat({ seed: 43 });
  assert.equal(G.Ship.isManned(p, 'weapons'), true);
  stepN(G, run, 1);
  assert.ok(Math.abs(p.weapons[0].charge - R.mannedWeaponMult) < 0.01, `${p.weapons[0].charge}`);
  run.combat = null;
  p.weapons[0].charge = 1;
  G.Combat.idle(run, 2);
  assert.equal(p.weapons[0].charge, 1);
});

test('enemy flee: stops charging when level-1 piloting is unmanned', () => {
  const run = makeRun(G, { seed: 50 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  const e = c.enemy;
  assert.equal(e.systems.piloting.level, 1);
  e.canSurrender = false;
  e.weapons.forEach((w) => { w.on = false; w.want = false; });
  G.Ship.enforcePower(e);
  e.fleeing = true;
  const pilot = G.Ship.mannedBy(e, 'piloting');
  assert.ok(pilot);
  const other = e.rooms.findIndex((r) => r.sys === null);
  pilot.station = null;
  G.Crew.place(e, pilot, other);
  stepN(G, run, 5);
  assert.equal(e.ftl, 0);
  assert.equal(c.pending, null);
  G.Crew.place(e, pilot, e.systems.piloting.room);
  stepN(G, run, 2);
  assert.ok(e.ftl > 0);
  stepN(G, run, 40);
  assert.ok(c.result === 'enemyFled' || c.pending === 'enemyFled', `${c.pending}/${c.result}`);
});

test('AI flees at low hull with fx and msg; surrender offer freezes the fight', () => {
  const run = makeRun(G, { seed: 51 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  const e = c.enemy;
  e.canFlee = true; e.canSurrender = false;
  e.hull = Math.floor(R.enemyFleeHullFrac * e.hullMax);
  stepN(G, run, 1.1);
  assert.equal(e.fleeing, true);
  const fx = G.Combat.drainFx(run);
  assert.ok(fx.some((f) => f.t === 'enemyFleeing'));
  assert.ok(fx.some((f) => f.t === 'msg' && f.text === '敌舰正在为跃迁引擎充能！'));
  assert.equal(c.msg.text, '敌舰正在为跃迁引擎充能！');

  const run2 = makeRun(G, { seed: 52 });
  const c2 = G.Combat.create(run2, { faction: 'rebel', hazard: 'none' });
  const e2 = c2.enemy;
  e2.canFlee = false; e2.canSurrender = true;
  e2.hull = Math.floor(R.enemySurrenderHullFrac * e2.hullMax);
  stepN(G, run2, 1.1);
  assert.ok(c2.offer && c2.offer.type === 'surrender' && c2.offer.scrap > 0);
  assert.equal(e2.surrenderOffered, true);
  const t = c2.time;
  G.Combat.step(run2, DT);
  assert.equal(c2.time, t, 'frozen while offer is open');
  G.Combat.answerOffer(run2, false);
  assert.equal(c2.offer, null);
  stepN(G, run2, 2);
  assert.equal(c2.offer, null, 'offered only once');
  assert.ok(c2.time > t);
  // accept
  const run3 = makeRun(G, { seed: 52 });
  const c3 = G.Combat.create(run3, { faction: 'rebel', hazard: 'none' });
  c3.enemy.canSurrender = true; c3.enemy.canFlee = false;
  c3.enemy.hull = 1;
  stepN(G, run3, 1.1);
  assert.ok(c3.offer);
  G.Combat.answerOffer(run3, true);
  assert.equal(c3.result, 'surrender');
});

test('end of combat: pending -> result after endDelay; lose takes precedence', () => {
  const { run, c, e, p } = calmCombat({ seed: 60 });
  e.hull = 0;
  G.Combat.step(run, DT);
  assert.equal(c.pending, 'win');
  assert.equal(c.result, null);
  // weapons stop charging while pending
  const ch = p.weapons[0].charge;
  stepN(G, run, 0.5);
  assert.equal(p.weapons[0].charge, ch);
  assert.equal(G.Combat.weaponState(run, p, 0).why, 'noCombat');
  // player dies during the delay -> lose
  p.hull = 0;
  G.Combat.step(run, DT);
  assert.equal(c.pending, 'lose');
  stepN(G, run, R.endDelay + 0.1);
  assert.equal(c.result, 'lose');
  assert.ok(G.Combat.drainFx(run).some((f) => f.t === 'combatEnd' && f.result === 'lose'));
  // no-op after result
  const t = c.time;
  G.Combat.step(run, DT);
  assert.equal(c.time, t);

  // derelict: all enemy crew dead
  const k = calmCombat({ seed: 61 });
  k.e.crew.forEach((cr) => { cr.hp = 0; });
  G.Combat.step(k.run, DT);
  assert.equal(k.c.pending, 'derelict');
  assert.equal(k.c.enemy.crew.length, 0);
  assert.ok(G.Combat.drainFx(k.run).some((f) => f.t === 'crewDied' && f.side === 'enemy'));
  stepN(G, k.run, R.endDelay + 0.1);
  assert.equal(k.c.result, 'derelict');

  // lose when all player crew die
  const m = calmCombat({ seed: 62 });
  m.p.crew.forEach((cr) => { cr.hp = 0; });
  G.Combat.step(m.run, DT);
  assert.equal(m.c.pending, 'lose');
  assert.equal(m.run.stats.crewLost, 3);
});

test('fire: growth, spread, extinguish by crew, system damage', () => {
  let grew = false, spread = false;
  for (let seed = 1; seed <= 8; seed++) {
    const run = makeRun(G, { shipId: 'falcon', seed });
    const p = run.player;
    p.rooms[6].fire = 1;                    // empty 2x2 room, no crew
    let maxFire = 1;
    for (let i = 0; i < 30 * 21; i++) {
      G.Combat.idle(run, DT);
      maxFire = Math.max(maxFire, p.rooms[6].fire);
      if (p.rooms.some((r, j) => j !== 6 && r.fire > 0)) spread = true;
    }
    if (maxFire > 1) grew = true;
  }
  assert.ok(grew, 'fire grows');
  assert.ok(spread, 'fire spreads');
  // extinguish: crew in a burning room puts it out and gets hurt
  const run = makeRun(G, { shipId: 'falcon', seed: 5 });
  const p = run.player;
  p.rooms[2].fire = 2;                      // weapons room, crew inside
  const c = p.crew.find((x) => x.room === 2);
  const hp0 = c.hp;
  G.Combat.idle(run, DT);
  assert.equal(c.task, 'fire');
  assert.equal(G.Ship.isManned(p, 'weapons'), false);
  let t = 0;
  while (p.rooms[2].fire > 0 && t < 30) { G.Combat.idle(run, DT); t += DT; }
  assert.equal(p.rooms[2].fire, 0);
  assert.ok(c.hp < hp0);
  // fire damages the room system over time (unattended)
  const run2 = makeRun(G, { shipId: 'falcon', seed: 6 });
  const p2 = run2.player;
  p2.rooms[3].fire = 4;                     // shields room, nobody there
  const before = p2.systems.shields.damage;
  for (let i = 0; i < 30 * 5; i++) G.Combat.idle(run2, DT);
  assert.ok(p2.systems.shields.damage > before);
});

test('fire dies without oxygen', () => {
  const run = makeRun(G, { shipId: 'falcon', seed: 7 });
  const p = run.player;
  p.rooms[6].fire = 2;
  for (let i = 0; i < 2; i++) G.Ship.removePower(p, 'oxygen');
  p.rooms.forEach((r) => { r.o2 = 0; });
  for (let i = 0; i < 30 * 11; i++) G.Combat.idle(run, DT);
  assert.equal(p.rooms[6].fire, 0);
});

test('breach drains oxygen; sealing by crew', () => {
  const run = makeRun(G, { shipId: 'falcon', seed: 8 });
  const p = run.player;
  p.rooms[7].breach = 2;
  for (let i = 0; i < 30 * 5; i++) G.Combat.idle(run, DT);
  assert.ok(p.rooms[7].o2 < p.rooms[0].o2 - 5, `breached ${p.rooms[7].o2} vs ${p.rooms[0].o2}`);
  assert.ok(p.rooms[7].o2 < 95);
  // no oxygen power: the whole ship drains
  G.Ship.removePower(p, 'oxygen');
  for (let i = 0; i < 30 * 60; i++) G.Combat.idle(run, DT);
  assert.ok(p.rooms[7].o2 < R.suffocateBelow, `o2 ${p.rooms[7].o2}`);
  // crew seal it
  const c = p.crew[0];
  c.hp = 1000; c.hpMax = 1000;
  G.Crew.order(p, c.id, 7);
  let t = 0;
  while (p.rooms[7].breach > 0 && t < 60) { G.Combat.idle(run, DT); t += DT; if (!c.path.length && p.rooms[7].breach) assert.equal(c.task, 'breach'); }
  assert.equal(p.rooms[7].breach, 0);
});

test('suffocation damages crew at suffocateDps', () => {
  const run = makeRun(G, { shipId: 'falcon', seed: 9 });
  const p = run.player;
  G.Ship.removePower(p, 'oxygen');
  p.rooms.forEach((r) => { r.o2 = 0; });
  const c = p.crew[0];
  for (let i = 0; i < 60; i++) G.Combat.idle(run, DT);
  assert.ok(Math.abs(c.hp - (100 - 2 * R.suffocateDps)) < 0.2, `hp ${c.hp}`);
  // until death -> removed, crewDied fx, stats
  for (let i = 0; i < 30 * 25; i++) G.Combat.idle(run, DT);
  assert.equal(p.crew.length, 0);
  const deaths = G.Combat.drainFx(run).filter((f) => f.t === 'crewDied');
  assert.equal(deaths.length, 3);
  assert.ok(deaths.every((f) => f.side === 'player' && typeof f.name === 'string'));
  assert.equal(run.stats.crewLost, 3);
});

test('medbay heals crew in its room (not while burning)', () => {
  const run = makeRun(G, { shipId: 'falcon', seed: 10 });
  const p = run.player;
  G.Ship.removePower(p, 'engines');
  assert.equal(G.Ship.addPower(p, 'medbay'), true);
  const c = p.crew[1];
  G.Crew.place(p, c, 4);
  c.hp = 50;
  for (let i = 0; i < 150; i++) G.Combat.idle(run, DT);
  assert.ok(Math.abs(c.hp - (50 + 5 * R.medbayHps[1])) < 0.3, `hp ${c.hp}`);
  for (let i = 0; i < 30 * 20; i++) G.Combat.idle(run, DT);
  assert.equal(c.hp, c.hpMax);
  c.hp = 50;
  p.rooms[4].fire = 1;
  G.Combat.idle(run, DT);
  assert.ok(c.hp < 50);
});

test('crew repair damaged systems (engi twice as fast)', () => {
  const run = makeRun(G, { shipId: 'thunder', seed: 11 });
  const p = run.player;
  const engi = p.crew.find((c) => c.race === 'engi');
  const sys = p.rooms[engi.room].sys;
  G.Ship.damageSystem(p, sys, 1);
  let t = 0;
  while (p.systems[sys].damage > 0 && t < 20) { G.Combat.idle(run, DT); t += DT; if (p.systems[sys].damage) assert.equal(engi.task, 'repair'); }
  const expect = 1 / (R.repairRate * 2);
  assert.ok(Math.abs(t - expect) < 0.1, `repair ${t} vs ${expect}`);
  G.Combat.idle(run, DT);
  assert.equal(engi.task, 'man');
});

test('crewless ship: fires burn out and never spread; self repair', () => {
  const run = makeRun(G, { seed: 12 });
  const c = G.Combat.create(run, { faction: 'auto', hazard: 'none' });
  const e = c.enemy;
  const ctx = { fx: () => {}, inCombat: false };
  e.rooms[0].fire = 3;
  for (let i = 0; i < 30 * (R.fireGrowInterval * 3 + 0.2); i++) {
    G.Combat.stepShip(run, e, DT, ctx);
    assert.ok(e.rooms.every((r, j) => j === 0 || r.fire === 0), 'no spread');
  }
  assert.equal(e.rooms[0].fire, 0);
  Object.values(e.systems).forEach((s) => { s.damage = 0; s.repairProg = 0; });
  G.Ship.damageSystem(e, 'weapons', 1);
  let t = 0;
  while (e.systems.weapons.damage > 0 && t < 20) { G.Combat.stepShip(run, e, DT, ctx); t += DT; }
  assert.ok(Math.abs(t - 1 / R.crewlessSelfRepair) < 0.1, `self repair ${t}`);
});

test('AI crew fight fires / repair and return to stations', () => {
  const run = makeRun(G, { seed: 70 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  c.enemy = G.Enemies.generate(run, { faction: 'rebel', hullType: 'cruiser' });
  G.AI.init(run, c);
  const e = c.enemy;
  e.canFlee = false; e.canSurrender = false;
  e.weapons.forEach((w) => { w.on = false; w.want = false; });
  const med = e.systems.medbay.room;
  e.rooms[med].fire = 1;
  G.Ship.damageSystem(e, 'engines', 1);
  let sawFire = false;
  for (let i = 0; i < 30 * 30; i++) {
    G.Combat.step(run, DT);
    if (e.crew.some((cr) => cr.room === med && cr.task === 'fire')) sawFire = true;
  }
  assert.ok(sawFire, 'someone fought the fire');
  assert.equal(e.rooms[med].fire, 0);
  assert.equal(e.systems.engines.damage, 0);
  for (const cr of e.crew) if (cr.station != null) assert.equal(cr.room, cr.station);
});

test('AI init powers enemy systems and targets when charged', () => {
  const run = makeRun(G, { seed: 71, sectorIndex: 2 });
  const c = G.Combat.create(run, {});
  const e = c.enemy;
  let want = 0;
  for (const id of G.data.systems.reactorOrder) if (e.systems[id]) {
    assert.equal(e.systems[id].power, e.systems[id].level);
    want += e.systems[id].level;
  }
  want += e.systems.weapons.power;
  assert.equal(e.reactor, want);
  assert.ok(e.weapons.every((w) => w.on));
  assert.ok(e.crew.every((cr) => cr.station === null || e.rooms[cr.station].sys));
  // pilot at piloting
  assert.ok(G.Ship.isManned(e, 'piloting'));
  // charged weapon gets a target and fires the same tick
  e.canFlee = false; e.canSurrender = false;
  const w = e.weapons[0];
  w.charge = Wd[w.id].charge;
  e.volley = false;
  G.Combat.step(run, DT);
  const fx = G.Combat.drainFx(run);
  assert.ok(fx.some((f) => (f.t === 'launch' || f.t === 'beam') && f.from === 'enemy') || c.projectiles.some((p) => p.from === 'enemy') ||
    c.beams.some((b) => b.from === 'enemy'));
  assert.equal(w.target, null, 'enemy re-picks after each shot');
});

test('enemy missile stock runs out -> AI unpowers missile weapons; volley ships never deadlock', () => {
  const run = makeRun(G, { seed: 72, sectorIndex: 1 });
  const c = G.Combat.create(run, { faction: 'rebel', hazard: 'none' });
  c.enemy = G.Enemies.generate(run, { faction: 'rebel', hullType: 'cruiser' });
  const e = c.enemy;
  e.weapons = [];
  ['missile_leto', 'laser_basic'].forEach((id) => e.weapons.push({ uid: G.U.uid(run, 'w'), id, on: false, want: false, charge: 0, target: null }));
  e.systems.weapons.level = 2;
  e.missiles = 1;
  e.volley = true;
  G.AI.init(run, c);
  e.canFlee = false; e.canSurrender = false;
  run.player.hull = run.player.hullMax = 999;
  let enemyShots = 0;
  for (let i = 0; i < 30 * 60; i++) {
    G.Combat.step(run, DT);
    for (const f of G.Combat.drainFx(run)) if (f.t === 'launch' && f.from === 'enemy') enemyShots++;
  }
  assert.equal(e.missiles, 0);
  assert.equal(e.weapons[0].on, false);
  assert.ok(enemyShots >= 4, `enemy shots ${enemyShots}`);
});

test('enemy generation respects budget / tier / minD / missile caps / shield clamp (200 seeds)', () => {
  for (const faction of Object.keys(E.factions)) {
    for (let d = 0; d <= 5; d++) {
      for (let seed = 1; seed <= 200; seed++) {
        const elite = d === 5 || (d > 0 && seed % 4 === 0);
        const sectorIndex = elite ? d - 1 : d;
        if (sectorIndex > 4) continue;
        const run = makeRun(G, { seed: seed * 7 + d, sectorIndex, difficulty: ['easy', 'normal', 'hard'][seed % 3] });
        const s = G.Enemies.generate(run, { faction, elite });
        const diff = R.difficulty[run.difficulty];
        const dd = Math.min(5, sectorIndex + (elite ? E.elite.dBonus : 0));
        const budget = Math.max(1, E.weaponBudgetByD[dd] + diff.enemyPower);
        const defs = s.weapons.map((w) => Wd[w.id]);
        const pw = defs.reduce((a, w) => a + w.power, 0);
        const tag = `${faction} d${dd} seed ${seed}`;
        assert.ok(pw <= budget, `${tag} power ${pw} > ${budget}`);
        assert.ok(defs.length >= 1 && defs.length <= E.maxWeapons, `${tag} weapons ${defs.length}`);
        assert.ok(defs.every((w) => w.tier <= E.maxTierByD[dd]), `${tag} tier`);
        assert.ok(defs.every((w) => dd >= (E.minDByWeapon[w.id] || 0)), `${tag} minD`);
        assert.ok(defs.every((w) => E.factions[faction].weapons.includes(w.id)), `${tag} faction weapons`);
        assert.ok(defs.filter((w) => w.type === 'missile').length <= E.maxMissileWeapons, `${tag} missiles`);
        assert.equal(s.systems.weapons.level, Math.max(1, pw));
        const sh = s.systems.shields ? s.systems.shields.level : 0;
        assert.ok(sh <= E.maxShieldPower && sh % 2 === 0, `${tag} shields ${sh}`);
        const sr = E.shieldsByD[dd];
        assert.ok(sh >= sr[0] && sh <= Math.min(E.maxShieldPower, sr[1] + (elite ? E.elite.shieldsBonus : 0)), `${tag} shields ${sh}`);
        const eng = s.systems.engines.level;
        assert.ok(eng >= E.enginesByD[dd][0] && eng <= E.enginesByD[dd][1]);
        assert.equal(s.systems.piloting.level, E.pilotingByD[dd]);
        assert.ok(s.hullMax >= 5);
        const hb = E.hullBase[s.templateId] + E.hullPerD * dd + diff.enemyHull;
        assert.ok(s.hullMax === Math.max(5, s.hullMax) && s.hullMax >= Math.max(5, hb + E.hullRand[0]) && s.hullMax <= Math.max(5, hb + E.hullRand[1]));
        assert.equal(s.missiles, E.missilesByD[dd]);
        assert.equal(s.volley, elite);
        assert.ok(Object.keys(E.factions[faction].hulls).includes(s.templateId));
        if (E.factions[faction].crewless) {
          assert.equal(s.crewless, true);
          assert.equal(s.crew.length, 0);
          assert.equal(s.canFlee || s.canSurrender, false);
        } else {
          const cr = E.crewByHull[s.templateId];
          assert.ok(s.crew.length >= cr[0] && s.crew.length <= cr[1], `${tag} crew`);
          assert.ok(s.crew.every((c) => E.factions[faction].crew[c.race] > 0));
          assert.ok(G.Ship.isManned(s, 'piloting') || s.crew.some((c) => c.room === s.systems.piloting.room));
        }
        if (elite) { assert.equal(s.name, E.elite.name); assert.equal(s.canFlee || s.canSurrender, false); }
        for (const r of s.rooms) if (r.sys) assert.ok(s.systems[r.sys], `${tag} room sys ${r.sys} installed`);
      }
    }
  }
});

test('flagship: phase 2 triggers once, repairs, faster charge, surges fire', () => {
  const run = makeRun(G, { seed: 80, sectorIndex: 4, type: 'final' });
  const c = G.Combat.create(run, { boss: true });
  const e = c.enemy;
  const F = E.flagship;
  assert.equal(e.boss, true);
  assert.equal(e.volley, true);
  assert.equal(e.canFlee, false);
  assert.equal(e.hullMax, F.hullMax);
  assert.equal(e.crew.length, F.crew.length);
  assert.equal(JSON.stringify(e.weapons.map((w) => w.id)), JSON.stringify(F.weapons));
  assert.ok(e.weapons.every((w) => w.on));
  const p = run.player;
  p.hull = p.hullMax = 9999;
  G.Ship.damageSystem(e, 'shields', 2);
  e.rooms[1].fire = 1;
  e.hull = Math.floor(F.phase2.at * e.hullMax);
  G.Combat.step(run, DT);
  assert.equal(e.phase, 2);
  assert.equal(e.chargeMult, F.phase2.chargeMult);
  assert.equal(e.systems.shields.damage, 0);
  assert.equal(e.rooms[1].fire, 0);
  const fx = G.Combat.drainFx(run);
  // weapons charge x chargeMult (x mannedWeaponMult when manned)
  const w0 = e.weapons[0];
  w0.charge = 0;
  G.Combat.step(run, DT);
  const mult = F.phase2.chargeMult * (G.Ship.isManned(e, 'weapons') ? R.mannedWeaponMult : 1);
  assert.ok(Math.abs(w0.charge - DT * mult) < 1e-9, `charge ${w0.charge}`);
  G.Combat.drainFx(run);
  assert.equal(fx.filter((f) => f.t === 'phase2').length, 1);
  assert.ok(fx.some((f) => f.t === 'msg' && f.text === F.phase2.text && f.kind === 'bad'));
  let phase2 = 0, warn = 0, surge = 0, surgeShots = 0, warnBeforeSurge = false;
  for (let i = 0; i < 30 * (F.phase2.surgeInterval * 2 + 1); i++) {
    G.Combat.step(run, DT);
    for (const f of G.Combat.drainFx(run)) {
      if (f.t === 'phase2') phase2++;
      if (f.t === 'surgeWarn') { warn++; assert.equal(f.in, F.phase2.surgeWarn); }
      if (f.t === 'surge') { surge++; if (warn === surge) warnBeforeSurge = true; }
      if (f.t === 'launch' && f.from === 'enemy' && f.weapon === null) surgeShots++;
    }
    if (c.result || c.pending) break;
  }
  assert.equal(phase2, 0, 'phase 2 only once');
  assert.equal(surge, 2);
  assert.equal(warn, 2);
  assert.ok(warnBeforeSurge);
  assert.equal(surgeShots, 2 * F.phase2.surgeShots);
});

test('hazards: asteroids hit both ships, flares ignite rooms, fleet barrage targets the player', () => {
  const run = makeRun(G, { seed: 90, hazard: 'asteroid' });
  const c = G.Combat.create(run, {});
  c.enemy.canFlee = false; c.enemy.canSurrender = false;
  const seen = { player: 0, enemy: 0 };
  for (let i = 0; i < 30 * 30; i++) {
    G.Combat.step(run, DT);
    for (const f of G.Combat.drainFx(run)) if (f.t === 'launch' && f.from === 'hazard') seen[f.to]++;
    if (c.pending) break;
  }
  assert.ok(seen.player >= 2 && seen.enemy >= 2, JSON.stringify(seen));

  const run2 = makeRun(G, { seed: 91, hazard: 'sun' });
  const c2 = G.Combat.create(run2, {});
  c2.enemy.canFlee = false; c2.enemy.canSurrender = false;
  let flares = 0, fires = 0;
  for (let i = 0; i < 30 * 31; i++) {
    G.Combat.step(run2, DT);
    for (const f of G.Combat.drainFx(run2)) { if (f.t === 'flare') flares++; if (f.t === 'fire') fires++; }
    if (c2.pending) break;
  }
  assert.ok(flares >= 1);
  assert.ok(fires >= 2);

  const run3 = makeRun(G, { seed: 92 });
  const c3 = G.Combat.create(run3, { elite: true });
  let fleet = 0;
  for (let i = 0; i < 30 * 14; i++) {
    G.Combat.step(run3, DT);
    for (const f of G.Combat.drainFx(run3)) if (f.t === 'launch' && f.kind === 'fleet') { fleet++; assert.equal(f.to, 'player'); }
    if (c3.pending) break;
  }
  assert.ok(fleet >= 1);
});

// ------------------------------------------------------------------ determinism
function policy(run) {
  const c = run.combat;
  if (!c) return;
  const e = c.enemy;
  const tgt = e.systems.shields ? e.systems.shields.room : 0;
  run.player.weapons.forEach((w, i) => { if (w.target === null) G.Combat.setTarget(run, i, tgt); });
  if (c.offer) G.Combat.answerOffer(run, false);
}

function playFor(run, seconds) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n && run.combat && !run.combat.result; i++) {
    policy(run);
    G.Combat.step(run, DT);
  }
}

test('determinism: identical runs serialize identically; save mid-combat and continue', () => {
  for (const shipId of G.data.shipOrder) {
    for (const seed of [1, 2, 3]) {
      const mk = () => {
        const r = makeRun(G, { shipId, seed, sectorIndex: 1, hazard: seed === 2 ? 'asteroid' : 'none' });
        r.volley = true;
        G.Combat.create(r, {});
        return r;
      };
      const a = mk(), b = mk();
      playFor(a, 20); playFor(b, 20);
      assert.equal(G.U.stringify(a), G.U.stringify(b), `${shipId}/${seed} identical`);
      const snap = G.U.stringify(a);
      const c = JSON.parse(snap);
      playFor(a, 40);
      playFor(c, 40);
      assert.equal(G.U.stringify(c), G.U.stringify(a), `${shipId}/${seed} save/continue`);
      assert.ok(a.combat.time > 20);
    }
  }
});

test('performance: one Combat.step well under 0.2 ms', () => {
  const run = makeRun(G, { seed: 5, sectorIndex: 2 });
  G.Combat.create(run, {});
  run.player.hull = run.player.hullMax = 9999;
  run.combat.enemy.hull = run.combat.enemy.hullMax = 9999;
  run.combat.enemy.canFlee = false; run.combat.enemy.canSurrender = false;
  for (let i = 0; i < 300; i++) { policy(run); G.Combat.step(run, DT); G.Combat.drainFx(run); }
  const n = 3000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) { policy(run); G.Combat.step(run, DT); G.Combat.drainFx(run); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  assert.ok(ms < 0.2, `step ${ms.toFixed(4)} ms`);
});
