// Run lifecycle (G.Run), event engine (G.Events) and stores (G.Store) against a fixture event set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './load.mjs';
import { installEvents, installRandomGuard, newRun, ready } from './meta-fixture.mjs';

const G = loadGame();
installRandomGuard(G);
const R = G.data.rules;
const READY = ready(G);
const SKIP = READY ? false : 'sim-combat modules (Ship/Crew/Combat/Enemies/AI) are still stubs';
const LOCK = '战斗中无法操作';
const J = (o) => JSON.stringify(o);

function hub(run, at) {
  run.mode = 'hub';
  run.event = null;
  run.combat = null;
  if (at != null) run.at = at;
  return run;
}
function freshHubRun(opts) { return hub(newRun(G, opts)); }
function choiceTexts(run) { return G.Events.choices(run).map((c) => c.text); }
function neighborOf(run, pred = () => true) {
  return G.Map.neighbors(run.sector, run.at).find((id) => pred(run.sector.beacons[id]));
}
// Make a fake finished fight on the current run.
function fakeCombat(run, result, extra = {}) {
  run.mode = 'combat';
  run.combat = Object.assign({ enemy: { hull: 0, hullMax: 10, crew: [] }, faction: 'rebel', elite: false, boss: false,
    rewardMult: 1, hazard: 'none', result, pending: result, offer: null }, extra);
}

// ------------------------------------------------------------------ create / events
test('create: sector 0 civilian, start_intro event, resources cloned', { skip: SKIP }, () => {
  const run = newRun(G, { seed: 77 });
  assert.equal(run.v, 1);
  assert.equal(run.mode, 'event');
  assert.equal(run.event.id, 'intro');
  assert.equal(run.event.node, 'start');
  assert.equal(run.sectorIndex, 0);
  assert.equal(run.sector.type, 'civilian');
  assert.equal(run.at, run.sector.start);
  assert.equal(run.sector.beacons[run.at].visited, true);
  assert.equal(run.stats.beacons, 1);
  assert.equal(J(run.res), J(G.data.ships.falcon.res));
  run.res.scrap += 5;
  assert.equal(G.data.ships.falcon.res.scrap, 20, 'res is a clone');
  assert.equal(run.combat, null);
  assert.equal(run.player.id, 'player');
  // intro -> choose -> cont -> hub
  const res = G.Events.choose(run, 0);
  assert.equal(res.next, 'end');
  assert.equal(J(G.Events.cont(run)), J({ openStore: false }));
  assert.equal(run.mode, 'hub');
  assert.equal(run.event, null);
  // determinism
  assert.equal(G.U.stringify(newRun(G, { seed: 77 })), G.U.stringify(newRun(G, { seed: 77 })));
});

test('events: blue choices hidden when req fails, cost gates shown disabled with notes', { skip: SKIP }, () => {
  const run = freshHubRun();
  run.res.scrap = 10;
  assert.ok(G.Events.start(run, 'civ_test'));
  assert.equal(run.mode, 'event');
  assert.equal(run.flags.civ_test, true, 'once flag set on start');
  let cs = G.Events.choices(run);
  // falcon: humans only, laser + missile, shields 2 -> every blue option hidden
  assert.equal(J(cs.map((c) => c.text)), J(['付钱', '开打', '商店', '离开']));
  const pay = cs[0];
  assert.equal(pay.idx, 1);
  assert.equal(pay.enabled, false);
  assert.equal(pay.blue, false);
  assert.equal(pay.note, '需要 20 废料');
  assert.equal(G.Events.choose(run, 1), null, 'disabled choice cannot be chosen');
  assert.equal(G.Events.choose(run, 0), null, 'hidden choice cannot be chosen');
  assert.equal(run.event.result, null);
  // unlock blue: engi crew + ion weapon
  G.Events.apply(run, { crew: 'engi' });
  run.player.weapons[0].id = 'ion_1';
  run.res.scrap = 30;
  cs = G.Events.choices(run);
  assert.equal(J(cs.map((c) => c.text)), J(['机工族', '付钱', '开打', '商店', '离子', '离开']));
  assert.equal(cs[0].blue, true);
  assert.equal(cs[0].note, '〔机工族〕');
  assert.equal(cs[4].note, '〔离子武器〕');
  assert.equal(cs[1].enabled, true);
  // pay: fx applied immediately, result stored, goto
  const r = G.Events.choose(run, 1);
  assert.equal(run.res.scrap, 10);
  assert.equal(run.res.fuel, 19);
  assert.equal(r.next, 'goto');
  assert.equal(r.goto, 'b');
  assert.equal(J(run.event.result), J(r));
  assert.equal(J(r.fx.map((f) => f.label)), J(['-20 废料', '+3 燃料']));
  assert.equal(r.fx[0].good, false);
  assert.equal(G.Events.choose(run, 1), null, 'no second choice while a result is shown');
  G.Events.cont(run);
  assert.equal(run.mode, 'event');
  assert.equal(run.event.node, 'b');
  assert.equal(run.event.result, null);
  G.Events.choose(run, 0);
  assert.equal(run.res.missiles, G.data.ships.falcon.res.missiles + 1);
  G.Events.cont(run);
  assert.equal(run.mode, 'hub');
  // once: civ_test is never picked again
  assert.equal(G.Events.pick(run, 'civilian'), null);
  assert.equal(G.Events.pick(run, ['civilian', 'any']), 'any_a');
});

test('events: silent outcome closes immediately; all-gated node gets a way out', { skip: SKIP }, () => {
  const run = freshHubRun();
  G.Events.start(run, 'civ_test');
  const leave = G.Events.choices(run).find((c) => c.text === '离开');
  const r = G.Events.choose(run, leave.idx);
  assert.equal(r.next, 'end');
  assert.equal(run.mode, 'hub');
  assert.equal(run.event, null);
  assert.equal(J(G.Events.cont(run)), J({ openStore: false }), 'cont is safe afterwards');

  G.Events.start(run, 'locked');
  const cs = G.Events.choices(run);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].enabled, false);
  assert.equal(cs[1].enabled, true);
  G.Events.choose(run, cs[1].idx);
  assert.equal(run.mode, 'hub');
});

test('events: store outcome opens a store; combat outcome sets after and resumes after reward', { skip: SKIP }, () => {
  const run = freshHubRun();
  G.Events.start(run, 'civ_test');
  G.Events.choose(run, 3);
  assert.equal(run.sector.beacons[run.at].store, null);
  assert.equal(J(G.Events.cont(run)), J({ openStore: true }));
  assert.equal(run.mode, 'hub');
  assert.ok(G.Run.hasStore(run));
  const st = run.sector.beacons[run.at].store;
  // store is kept (||=)
  G.Events.start(run, 'civ_test');
  G.Events.choose(run, 3);
  G.Events.cont(run);
  assert.equal(run.sector.beacons[run.at].store, st);

  G.Events.start(run, 'civ_test');
  const r = G.Events.choose(run, 2);
  assert.equal(r.next, 'combat');
  assert.equal(r.combat.faction, 'pirate');
  G.Events.cont(run);
  assert.equal(run.mode, 'combat');
  assert.ok(run.combat);
  assert.equal(run.combat.faction, 'pirate');
  assert.equal(run.event, null);
  assert.equal(J(run.after), J({ eventId: 'civ_test', node: 'after' }));
  run.combat.result = 'win';
  const scrap0 = run.res.scrap;
  assert.equal(G.Run.step(run, 1 / 30), true, 'mode change reported');
  assert.equal(run.mode, 'reward');
  assert.equal(run.combat, null);
  assert.ok(run.res.scrap > scrap0, 'reward applied immediately');
  const scrap1 = run.res.scrap;
  G.Run.claimReward(run);
  assert.equal(run.res.scrap, scrap1, 'claimReward never touches res');
  assert.equal(run.reward, null);
  assert.equal(run.mode, 'event');
  assert.equal(run.event.id, 'civ_test');
  assert.equal(run.event.node, 'after');
  assert.equal(run.after, null);
});

test('events: pick honours tags, sector ranges and weights', { skip: SKIP }, () => {
  const run = freshHubRun();
  installEvents(G, [
    { id: 'a', tags: ['t'], weight: 1, minSector: 0, maxSector: 1, nodes: { start: { text: '', choices: [] } } },
    { id: 'b', tags: ['t'], weight: 3, minSector: 2, maxSector: 4, nodes: { start: { text: '', choices: [] } } },
    { id: 'z', tags: ['t'], weight: 0, nodes: { start: { text: '', choices: [] } } },
  ]);
  for (let i = 0; i < 30; i++) assert.equal(G.Events.pick(run, 't'), 'a');
  run.sectorIndex = 3;
  for (let i = 0; i < 30; i++) assert.equal(G.Events.pick(run, 't'), 'b');
  assert.equal(G.Events.pick(run, 'nope'), null);
  // a node without choices gets a synthetic continue
  G.Events.start(run, 'a');
  assert.equal(J(choiceTexts(run)), J(['继续']));
  G.Events.choose(run, 0);
  assert.equal(run.mode, 'hub');
  installEvents(G);
});

// ------------------------------------------------------------------ apply()
test('apply: every fx key, clamps and never-kill rules', { skip: SKIP }, () => {
  const run = freshHubRun();
  const p = run.player;
  const A = (fx) => G.Events.apply(run, fx);

  // scrap scaling (positive only) + scrap_arm
  run.sectorIndex = 2;
  run.res.scrap = 0;
  let s = A({ scrap: 10 });
  assert.equal(run.res.scrap, 14);
  assert.equal(s.label, '+14 废料');
  assert.equal(s.good, true);
  run.augments.push('scrap_arm');
  A({ scrap: 10 });
  assert.equal(run.res.scrap, 14 + 15);
  run.augments = [];
  s = A({ scrap: -100 });
  assert.equal(run.res.scrap, 0);
  assert.equal(s.amount, -29);
  const r0 = run.res.scrap;
  A({ scrap: [5, 7] });
  assert.ok(run.res.scrap - r0 >= 7 && run.res.scrap - r0 <= 10);
  run.sectorIndex = 0;

  // fuel / missiles clamp at 0
  run.res.fuel = 2; A({ fuel: -5 }); assert.equal(run.res.fuel, 0);
  run.res.missiles = 1; s = A({ missiles: -3 }); assert.equal(run.res.missiles, 0); assert.equal(s.amount, -1);
  A({ fuel: 3 }); assert.equal(run.res.fuel, 3);

  // hull: never below 1, never above max
  p.hull = 10; s = A({ hull: -100 }); assert.equal(p.hull, 1); assert.equal(s.amount, -9);
  s = A({ hull: 100 }); assert.equal(p.hull, p.hullMax); assert.equal(s.label, '+' + (p.hullMax - 1) + ' 船体');

  // crew
  const n0 = p.crew.length;
  s = A({ crew: 'rock' });
  assert.equal(p.crew.length, n0 + 1);
  assert.equal(p.crew[p.crew.length - 1].race, 'rock');
  assert.equal(run.stats.crewHired, 1);
  assert.ok(s.label.startsWith('新船员'));
  while (p.crew.length < R.maxCrew) A({ crew: 'random' });
  s = A({ crew: 'random' });
  assert.equal(p.crew.length, R.maxCrew);
  assert.equal(s.amount, 0);
  assert.equal(new Set(p.crew.map((c) => c.name)).size, p.crew.length, 'unique names');

  // crewDamage: HP never below 1
  A({ crewDamage: 10000 });
  p.crew.forEach((c) => assert.equal(c.hp, 1));
  assert.equal(p.crew.length, R.maxCrew);

  // loseCrew never removes the last one
  s = A({ loseCrew: 1 });
  assert.equal(p.crew.length, R.maxCrew - 1);
  assert.equal(run.stats.crewLost, 1);
  assert.equal(s.good, false);
  p.crew.splice(1);
  s = A({ loseCrew: 1 });
  assert.equal(p.crew.length, 1);
  assert.equal(s.amount, 0);

  // weapon: free slot -> cargo -> dismantled
  const w0 = p.weapons.length;
  A({ weapon: 'ion_1' });
  assert.equal(p.weapons.length, w0 + 1);
  assert.equal(p.weapons[w0].on, false);
  while (p.weapons.length < p.weaponSlots) A({ weapon: 'laser_basic' });
  A({ weapon: 'tier2' });
  assert.equal(run.cargo.length, 1);
  assert.equal(G.data.weapons[run.cargo[0]].tier, 2);
  while (run.cargo.length < R.cargoMax) A({ weapon: 'random' });
  run.res.scrap = 0;
  s = A({ weapon: 'laser_heavy2' });
  assert.equal(run.cargo.length, R.cargoMax);
  assert.equal(run.res.scrap, Math.floor(G.data.weapons.laser_heavy2.cost * R.sellMult));
  assert.ok(s.label.includes('货舱已满，已拆解'));

  // augment: random not owned; full -> dismantled
  run.augments = ['scrap_arm'];
  A({ augment: 'random' });
  assert.equal(run.augments.length, 2);
  assert.notEqual(run.augments[1], 'scrap_arm');
  A({ augment: 'ftl_booster' });
  const augs = run.augments.slice();
  run.res.scrap = 0;
  const aid = Object.keys(R.augments).find((a) => !augs.includes(a));
  A({ augment: aid });
  assert.equal(J(run.augments), J(augs));
  assert.equal(run.res.scrap, Math.floor(R.augments[aid].cost * R.sellMult));

  // upgrade
  const sh = p.systems.shields.level;
  s = A({ upgrade: 'shields' });
  assert.equal(p.systems.shields.level, sh + 1);
  p.systems.oxygen.level = 3;
  s = A({ upgrade: 'oxygen' });
  assert.equal(p.systems.oxygen.level, 3);
  assert.equal(s.amount, 0);
  const lv = J(Object.values(p.systems).map((x) => x.level));
  A({ upgrade: 'random' });
  assert.notEqual(J(Object.values(p.systems).map((x) => x.level)), lv);

  // sysDamage keeps the power invariant
  p.systems.shields.damage = 0;
  A({ sysDamage: 'shields' });
  assert.equal(p.systems.shields.damage, 1);
  Object.values(p.systems).forEach((x) => assert.ok(x.power <= Math.max(0, x.level - x.damage - x.ion)));
  assert.ok(G.Ship.reactorUsed(p) <= p.reactor);
  A({ sysDamage: 'random' });
  assert.ok(Object.values(p.systems).reduce((a, x) => a + x.damage, 0) >= 2);

  // reactor capped
  const re = p.reactor;
  A({ reactor: 1 });
  assert.equal(p.reactor, re + 1);
  p.reactor = R.reactorMax;
  A({ reactor: 1 });
  assert.equal(p.reactor, R.reactorMax);

  // fleet
  const f = run.sector.fleet;
  s = A({ fleet: 1 });
  assert.equal(run.sector.fleet, f + 1);
  assert.equal(s.good, false);
  s = A({ fleet: -1 });
  assert.equal(run.sector.fleet, f);
  assert.equal(s.good, true);
});

// ------------------------------------------------------------------ rewards
test('finishCombat reward formula is applied immediately', { skip: SKIP }, () => {
  const cases = [
    { result: 'win', si: 0, type: 'civilian', diff: 'normal', mult: 1, aug: false },
    { result: 'derelict', si: 2, type: 'hostile', diff: 'hard', mult: 1, aug: true },
    { result: 'surrender', si: 3, type: 'pirate', diff: 'easy', mult: 1.5, aug: false },
    { result: 'win', si: 1, type: 'nebula', diff: 'normal', mult: R.reward.eliteMult, aug: false, elite: true },
  ];
  for (const k of cases) {
    const run = freshHubRun({ difficulty: k.diff, seed: 99 });
    run.sectorIndex = k.si;
    run.sector.type = k.type;
    if (k.aug) run.augments.push('scrap_arm');
    fakeCombat(run, k.result, { rewardMult: k.mult, elite: !!k.elite });
    const probe = { s: run.rng.s };
    const base = G.RNG.roll(probe, R.reward.scrapBase);
    const want = Math.round(base * (1 + R.reward.scrapPerSector * k.si) * G.data.sectors.types[k.type].rewardMult * k.mult *
      R.difficulty[k.diff].scrapMult * (k.result === 'derelict' ? R.reward.derelictMult : 1) *
      (k.result === 'surrender' ? R.reward.surrenderMult : 1) * (k.aug ? R.augmentFx.scrapMult : 1));
    const res0 = J(run.res);
    const before = JSON.parse(res0);
    G.Run.finishCombat(run);
    assert.equal(run.mode, 'reward');
    assert.equal(run.combat, null);
    assert.equal(run.reward.result, k.result);
    assert.equal(run.reward.scrap, want, J(k));
    assert.equal(run.res.scrap, before.scrap + want);
    assert.equal(run.res.fuel, before.fuel + run.reward.fuel);
    assert.equal(run.res.missiles, before.missiles + run.reward.missiles);
    assert.equal(run.stats.kills, 1);
    assert.equal(run.stats.derelicts, k.result === 'derelict' ? 1 : 0);
    assert.equal(run.stats.surrenders, k.result === 'surrender' ? 1 : 0);
    assert.equal(run.stats.scrapEarned, want);
    assert.equal(run.reward.fx[0].label, '+' + want + ' 废料');
    run.player.weapons.forEach((w) => { assert.equal(w.charge, 0); assert.equal(w.target, null); });
    assert.equal(run.player.ftl, 0);
    G.Run.claimReward(run);
    assert.equal(run.mode, 'hub');
    assert.equal(run.res.scrap, before.scrap + want);
  }
});

test('finishCombat: weapon reward into full cargo is dismantled; lose / boss / enemyFled', { skip: SKIP }, () => {
  const saved = { w: R.reward.weaponChance, c: R.reward.crewChance };
  try {
    R.reward.weaponChance = 1;
    R.reward.crewChance = 1;
    const run = freshHubRun();
    while (run.player.weapons.length < run.player.weaponSlots) run.player.weapons.push({ uid: 'x' + run.player.weapons.length, id: 'laser_basic', on: false, want: false, charge: 0, target: null });
    run.cargo = new Array(R.cargoMax).fill('laser_basic');
    const crew0 = run.player.crew.length;
    fakeCombat(run, 'win');
    G.Run.finishCombat(run);
    assert.ok(run.reward.weapon);
    assert.ok(run.reward.text.includes('货舱已满，已拆解'));
    assert.equal(run.cargo.length, R.cargoMax);
    assert.ok(run.reward.crew && run.reward.crew.name);
    assert.equal(run.player.crew.length, crew0 + 1);
  } finally {
    R.reward.weaponChance = saved.w;
    R.reward.crewChance = saved.c;
  }

  let run = freshHubRun();
  run.player.hull = 0;
  fakeCombat(run, 'lose');
  G.Run.finishCombat(run);
  assert.equal(run.mode, 'gameover');
  assert.equal(J(run.end && [run.end.win, run.end.reason]), J([false, 'hull']));

  run = freshHubRun();
  fakeCombat(run, 'lose');
  G.Run.finishCombat(run);
  assert.equal(run.end.reason, 'crew');

  run = freshHubRun();
  fakeCombat(run, 'derelict', { boss: true });
  G.Run.finishCombat(run);
  assert.equal(run.mode, 'victory');
  assert.equal(run.flags.flagshipDown, true);
  assert.equal(J([run.end.win, run.end.reason]), J([true, 'flagship']));

  run = freshHubRun();
  run.after = { eventId: 'civ_test', node: 'after' };
  fakeCombat(run, 'enemyFled');
  G.Run.drainFx(run);
  G.Run.finishCombat(run);
  assert.equal(run.mode, 'hub');
  assert.equal(run.after, null);
  assert.ok(G.Run.drainFx(run).some((e) => e.t === 'msg' && e.text === '敌舰跃迁逃走了'));
});

// ------------------------------------------------------------------ jumping / arrival
test('jump: costs, fleet, resets; arrive by kind', { skip: SKIP }, () => {
  const run = freshHubRun({ seed: 5 });
  const s = run.sector;
  const n = neighborOf(run);
  const b = s.beacons[n];
  b.kind = 'combat'; b.faction = 'pirate';
  run.player.crew[0].hp = 10;
  run.player.systems.shields.damage = 1;
  run.player.ftl = 0.5;
  const fuel = run.res.fuel, fleet = s.fleet;
  assert.equal(G.Run.canJump(run, n).ok, true);
  assert.equal(G.Map.reachable(run).includes(n), true);
  const r = G.Run.jump(run, n);
  assert.equal(r.ok, true);
  assert.equal(run.res.fuel, fuel - 1);
  assert.ok(Math.abs(s.fleet - (fleet + 0.75)) < 1e-9);
  assert.equal(run.stats.jumps, 1);
  assert.equal(run.at, n);
  assert.equal(b.visited, true);
  assert.equal(run.player.crew[0].hp, run.player.crew[0].hpMax, 'medbay heals on jump');
  assert.equal(run.player.systems.shields.damage, 0, 'jumpReset');
  assert.equal(run.player.ftl, 0);
  assert.equal(run.mode, 'event');
  assert.equal(run.event.id, 'cp');

  // canJump reasons
  assert.equal(G.Run.canJump(run, n === 0 ? 1 : 0).ok, false, 'event mode');
  hub(run);
  const far = s.beacons.find((x) => !G.Map.neighbors(s, run.at).includes(x.id) && x.id !== run.at).id;
  assert.equal(G.Run.canJump(run, far).reason, '无法直达该信标');
  run.res.fuel = 0;
  assert.equal(G.Run.canJump(run, run.sector.start).reason, '燃料不足');
  assert.equal(G.Run.jump(run, run.sector.start).ok, false);
  assert.equal(G.Map.reachable(run).length, 0);
  run.res.fuel = 20;

  // visited -> hub
  run.sector.fleet = -5;
  G.Run.jump(run, run.sector.start);
  assert.equal(run.mode, 'hub');
  assert.equal(run.stats.beacons, 2);

  // kinds -> pools
  const kinds = { distress: 'distress_a', empty: 'empty_a', event: null };
  for (const [kind, id] of Object.entries(kinds)) {
    const m = neighborOf(run);
    const bb = run.sector.beacons[m];
    bb.kind = kind; bb.visited = false;
    run.sector.fleet = -5;
    G.Run.jump(run, m);
    if (id) assert.equal(run.event.id, id, kind);
    else assert.ok(['any_a'].includes(run.event.id) || run.event.id === 'civ_test', 'event pool = sector type + any');
    hub(run, run.sector.start);
  }
  const m = neighborOf(run);
  const sb = run.sector.beacons[m];
  sb.kind = 'store'; sb.visited = false; sb.store = null;
  G.Run.jump(run, m);
  assert.equal(run.event.id, 'store_a');
  assert.ok(sb.store, 'store beacons always carry a store');
  G.Events.choose(run, 0);
  assert.equal(J(G.Events.cont(run)), J({ openStore: true }));
  assert.ok(G.Run.hasStore(run));
  hub(run, run.sector.start);
  run.sector.fleet = -5;
  assert.equal(G.Run.jump(run, m).ok, true);
  assert.equal(run.mode, 'hub', 'revisit is safe');
  assert.ok(G.Run.hasStore(run), 'store stays open on revisit');
});

test('arrive ordering: boss beats overtaken/visited; overtaken beats visited -> combat_elite', { skip: SKIP }, () => {
  const run = freshHubRun({ seed: 8 });
  // overtaken (even when visited) -> elite fight
  const n = neighborOf(run);
  run.sector.beacons[n].visited = true;
  run.sector.fleet = run.sector.beacons[n].row + 5;
  G.Run.jump(run, n);
  assert.equal(run.mode, 'event');
  assert.equal(run.event.id, 'elite');
  G.Events.choose(run, 0);
  G.Events.cont(run);
  assert.equal(run.mode, 'combat');
  assert.equal(run.combat.elite, true);
  assert.equal(run.combat.hazard, 'fleet');

  // boss beacon ignores overtaken and visited
  const fin = freshHubRun({ seed: 9 });
  fin.sectorIndex = 4;
  fin.sector = G.Map.generate(fin, 4, 'final');
  const boss = fin.sector.beacons[fin.sector.exit];
  const pre = G.Map.neighbors(fin.sector, boss.id)[0];
  hub(fin, pre);
  boss.visited = true;
  fin.sector.fleet = 99;
  G.Run.jump(fin, boss.id);
  assert.equal(fin.event.id, 'boss');
  G.Events.choose(fin, 0);
  G.Events.cont(fin);
  assert.equal(fin.combat.boss, true);
  assert.equal(G.Combat.canFlee(fin), false);
  fin.player.ftl = 1;
  assert.equal(G.Run.canJump(fin, pre).ok, false, 'no fleeing the flagship');
  // after the flagship is down the boss beacon behaves normally
  fin.flags.flagshipDown = true;
  hub(fin, pre);
  fin.sector.fleet = -5;
  G.Run.jump(fin, boss.id);
  assert.equal(fin.mode, 'hub');
});

test('fleeing combat: canJump needs FTL charge; jump counts fled and drops the fight', { skip: SKIP }, () => {
  const run = freshHubRun({ seed: 3 });
  run.after = { eventId: 'civ_test', node: 'after' };
  G.Run.startCombat(run, { faction: 'rebel' });
  assert.equal(run.mode, 'combat');
  const n = neighborOf(run);
  assert.equal(G.Run.canJump(run, n).ok, false);
  run.player.ftl = 1;
  run.combat.pending = 'lose';
  assert.equal(G.Run.canJump(run, n).ok, false, 'no escape from a decided fight');
  run.combat.pending = null;
  assert.equal(G.Run.canJump(run, n).ok, true);
  run.sector.beacons[n].visited = true;
  run.sector.fleet = -5;
  G.Run.jump(run, n);
  assert.equal(run.combat, null);
  assert.equal(run.stats.fled, 1);
  assert.equal(run.after, null);
  assert.equal(run.mode, 'hub');
  assert.equal(run.player.ftl, 0);
});

// ------------------------------------------------------------------ sectors
test('leaveSector / chooseSector through to the final sector and the flagship', { skip: SKIP }, () => {
  const run = freshHubRun({ seed: 21 });
  assert.equal(G.Run.leaveSector(run).reason, '需要先抵达星区出口');
  for (let si = 0; si < 4; si++) {
    hub(run, run.sector.exit);
    assert.ok(G.Run.atExit(run));
    const fuel = run.res.fuel;
    const r = G.Run.leaveSector(run);
    assert.equal(r.ok, true, r.reason);
    assert.equal(run.res.fuel, fuel - 1);
    if (si < 3) {
      assert.equal(run.mode, 'sectorSelect');
      assert.equal(run.sectorChoices.length, 2);
      assert.notEqual(run.sectorChoices[0], run.sectorChoices[1]);
      run.sectorChoices.forEach((t) => assert.ok(G.data.sectors.choosable.includes(t)));
      const t = run.sectorChoices[1];
      assert.equal(G.Run.chooseSector(run, 5).ok, false);
      G.Run.chooseSector(run, 1);
      assert.equal(run.sector.type, t);
      assert.equal(run.sectorChoices, null);
    }
    assert.equal(run.sectorIndex, si + 1);
    assert.equal(run.sector.index, si + 1);
    assert.equal(run.at, run.sector.start);
    assert.equal(run.mode, 'event');
    assert.equal(run.event.id, 'st_a');
    G.Events.choose(run, 0);
    G.Events.cont(run);
  }
  assert.equal(run.sector.type, 'final');
  hub(run, run.sector.exit);
  run.flags.flagshipDown = true;
  assert.equal(G.Run.leaveSector(run).reason, '必须击毁叛军旗舰');
  delete run.flags.flagshipDown;

  // walk to the flagship along a shortest path
  hub(run, run.sector.start);
  run.res.fuel = 20;
  let guard = 0;
  while (run.at !== run.sector.exit && guard++ < 20) {
    const here = run.at;
    const next = G.Map.neighbors(run.sector, here).find((id) => G.Map.jumpsLeft(run.sector, id) < G.Map.jumpsLeft(run.sector, here));
    run.sector.fleet = -5;
    assert.equal(G.Run.jump(run, next).ok, true);
    if (run.at === run.sector.exit) break;
    hub(run);
  }
  assert.equal(run.event.id, 'boss');
  G.Events.choose(run, 0);
  G.Events.cont(run);
  assert.equal(run.combat.boss, true);
  run.combat.result = 'win';
  assert.equal(G.Run.step(run, 1 / 30), true);
  assert.equal(run.mode, 'victory');
  assert.equal(run.end.win, true);
  assert.equal(run.end.reason, 'flagship');
});

test('stranded: wait -> stranded event, or combat_elite when the fleet arrives', { skip: SKIP }, () => {
  const run = freshHubRun({ seed: 4 });
  const n = neighborOf(run);
  hub(run, n);
  assert.equal(G.Run.isStranded(run), false);
  assert.equal(G.Run.wait(run).ok, false);
  run.res.fuel = 0;
  assert.equal(G.Run.isStranded(run), true);
  run.sector.fleet = -5;
  const f = run.sector.fleet;
  G.Run.wait(run);
  assert.ok(Math.abs(run.sector.fleet - (f + 0.75 * R.waitFleetAdvance)) < 1e-9);
  assert.equal(run.event.id, 'stranded_a');
  G.Events.choose(run, 0);
  G.Events.cont(run);
  assert.equal(run.res.fuel, 3);
  run.res.fuel = 0;
  run.sector.fleet = run.sector.beacons[n].row - 0.1;
  G.Run.wait(run);
  assert.equal(run.event.id, 'elite');
});

// ------------------------------------------------------------------ ship management & stores
test('combat lockout of every shop / upgrade / equip / dismiss call', { skip: SKIP }, () => {
  const run = freshHubRun();
  run.cargo.push('ion_1');
  run.augments.push('scrap_arm');
  run.res.scrap = 999;
  run.sector.beacons[run.at].store = G.Store.create(run);
  G.Run.startCombat(run, { faction: 'rebel' });
  const snap = G.U.stringify(run.player) + J(run.res) + J(run.cargo) + J(run.augments);
  const calls = [
    () => G.Run.upgradeSystem(run, 'shields'), () => G.Run.upgradeReactor(run), () => G.Run.equip(run, 0),
    () => G.Run.unequip(run, 0), () => G.Run.dismissCrew(run, run.player.crew[0].id), () => G.Run.leaveSector(run),
    () => G.Store.buy(run, 'fuel', 1), () => G.Store.sell(run, 0), () => G.Store.sellAugment(run, 'scrap_arm'),
  ];
  for (const c of calls) {
    const r = c();
    assert.equal(r.ok, false);
    assert.equal(r.reason, LOCK);
  }
  assert.equal(G.Store.canBuy(run, 'fuel').reason, LOCK);
  assert.equal(G.U.stringify(run.player) + J(run.res) + J(run.cargo) + J(run.augments), snap);
  assert.equal(G.Run.hasStore(run), false);
});

test('upgrades, reactor, equip / unequip, dismiss', { skip: SKIP }, () => {
  const run = freshHubRun();
  const p = run.player;
  run.res.scrap = 1000;
  const lvl = p.systems.shields.level;
  assert.equal(G.Run.upgradeCost(run, 'shields'), G.data.systems.defs.shields.costs[lvl + 1]);
  assert.equal(G.Run.upgradeSystem(run, 'shields').ok, true);
  assert.equal(p.systems.shields.level, lvl + 1);
  assert.equal(run.res.scrap, 1000 - G.data.systems.defs.shields.costs[lvl + 1]);
  p.systems.oxygen.level = 3;
  assert.equal(G.Run.upgradeCost(run, 'oxygen'), null);
  assert.equal(G.Run.upgradeSystem(run, 'oxygen').ok, false);
  run.res.scrap = 0;
  assert.equal(G.Run.upgradeSystem(run, 'engines').reason, '废料不足');

  assert.equal(G.Run.reactorCost(run), R.reactorCostBase + (p.reactor - 8) * R.reactorCostStep);
  run.res.scrap = 100;
  const re = p.reactor;
  assert.equal(G.Run.upgradeReactor(run).ok, true);
  assert.equal(p.reactor, re + 1);
  p.reactor = R.reactorMax;
  assert.equal(G.Run.reactorCost(run), null);
  assert.equal(G.Run.upgradeReactor(run).ok, false);

  // equip / unequip
  const w0 = p.weapons.length;
  p.weapons[0].charge = 5;
  assert.equal(G.Run.unequip(run, 0).ok, true);
  assert.equal(p.weapons.length, w0 - 1);
  assert.equal(run.cargo.length, 1);
  assert.ok(G.Ship.reactorUsed(p) <= p.reactor);
  assert.equal(G.Run.equip(run, 0).ok, true);
  assert.equal(run.cargo.length, 0);
  const nw = p.weapons[p.weapons.length - 1];
  assert.equal(nw.charge, 0);
  assert.equal(nw.target, null);
  assert.equal(nw.on, false);
  assert.equal(G.Run.equip(run, 0).ok, false);
  while (p.weapons.length < p.weaponSlots) p.weapons.push({ uid: 'z' + p.weapons.length, id: 'laser_basic', on: false, want: false, charge: 0, target: null });
  run.cargo.push('ion_1');
  assert.equal(G.Run.equip(run, 0).reason, '武器槽已满');
  run.cargo = new Array(R.cargoMax).fill('ion_1');
  assert.equal(G.Run.unequip(run, 0).reason, '货舱已满');

  // dismiss never the last
  while (p.crew.length > 1) assert.equal(G.Run.dismissCrew(run, p.crew[0].id).ok, true);
  assert.equal(G.Run.dismissCrew(run, p.crew[0].id).ok, false);
  assert.equal(p.crew.length, 1);
});

test('store: canBuy reasons, buy / sell / sellAugment', { skip: SKIP }, () => {
  const run = freshHubRun({ seed: 12 });
  const p = run.player;
  assert.equal(G.Store.canBuy(run, 'fuel').reason, '这里没有商店');
  const st = run.sector.beacons[run.at].store = G.Store.create(run);
  assert.ok(G.Run.hasStore(run));
  run.res.scrap = 0;
  assert.equal(J(G.Store.canBuy(run, 'fuel', 2)), J({ ok: false, reason: '废料不足', price: R.fuelPrice * 2 }));
  run.res.scrap = 500;
  const fuel = run.res.fuel;
  assert.equal(G.Store.buy(run, 'fuel', 2).ok, true);
  assert.equal(run.res.fuel, fuel + 2);
  assert.equal(run.res.scrap, 500 - 2 * R.fuelPrice);
  const fi = st.items.find((x) => x.key === 'fuel');
  assert.equal(G.Store.canBuy(run, 'fuel', fi.stock + 1).reason, '已售罄');
  // repair
  assert.equal(G.Store.canBuy(run, 'repair').reason, '船体完好');
  p.hull = p.hullMax - 3;
  assert.equal(G.Store.canBuy(run, 'repair', 4).reason, '超出船体上限');
  const sc = run.res.scrap;
  assert.equal(G.Store.buy(run, 'repair', 3).ok, true);
  assert.equal(p.hull, p.hullMax);
  assert.equal(run.res.scrap, sc - 3 * G.Store.repairPrice(run));
  // weapon -> slot (free) or cargo; stock 1
  const w = st.items.find((x) => x.type === 'weapon');
  const nw = p.weapons.length + run.cargo.length;
  assert.equal(G.Store.buy(run, w.key).ok, true);
  assert.equal(p.weapons.length + run.cargo.length, nw + 1);
  assert.equal(G.Store.canBuy(run, w.key).reason, '已售罄');
  // crew
  const c = st.items.find((x) => x.type === 'crew');
  const nc = p.crew.length;
  assert.equal(G.Store.buy(run, c.key).ok, true);
  assert.equal(p.crew.length, nc + 1);
  assert.equal(p.crew[p.crew.length - 1].race, c.id);
  // augment item (force one)
  st.items.push({ key: 'aug', type: 'augment', id: 'replicator', name: 'x', price: 45, stock: 1 });
  assert.equal(G.Store.buy(run, 'aug').ok, true);
  assert.ok(run.augments.includes('replicator'));
  // sell
  run.cargo.push('laser_heavy2');
  const s0 = run.res.scrap;
  assert.equal(G.Store.sell(run, run.cargo.length - 1).ok, true);
  assert.equal(run.res.scrap, s0 + Math.floor(G.data.weapons.laser_heavy2.cost * R.sellMult));
  assert.equal(G.Store.sell(run, 99).ok, false);
  const s1 = run.res.scrap;
  assert.equal(G.Store.sellAugment(run, 'replicator').ok, true);
  assert.equal(run.res.scrap, s1 + Math.floor(R.augments.replicator.cost * R.sellMult));
  assert.ok(!run.augments.includes('replicator'));
  assert.equal(G.Store.sellAugment(run, 'replicator').ok, false);
});

// ------------------------------------------------------------------ step
test('step: hub idles, crew-dead gameover, offer detection, time accounting', { skip: SKIP }, () => {
  const run = freshHubRun();
  assert.equal(G.Run.step(run, 0.5), false);
  assert.equal(run.stats.time, 0.5);
  run.player.crew.length = 0;
  assert.equal(G.Run.step(run, 0.1), true);
  assert.equal(run.mode, 'gameover');
  assert.equal(run.end.reason, 'crew');
  assert.equal(run.end.win, false);

  const r2 = freshHubRun();
  G.Run.startCombat(r2, { faction: 'rebel' });
  assert.equal(G.Run.step(r2, 1 / 30), false);
  assert.ok(r2.stats.combatTime > 0);
  r2.combat.offer = { type: 'surrender', scrap: 1, fuel: 0, missiles: 0, text: '' };
  // the fight is frozen while an offer is open; the transition null -> set is reported
  r2.combat.offer = null;
  const origStep = G.Combat.step;
  G.Combat.step = (run) => { run.combat.offer = { type: 'surrender', scrap: 1, fuel: 0, missiles: 0, text: '' }; };
  try { assert.equal(G.Run.step(r2, 1 / 30), true); } finally { G.Combat.step = origStep; }
  assert.equal(G.Run.step(r2, 1 / 30), false, 'offer already open');
  G.Combat.answerOffer(r2, true);
  assert.equal(G.Run.step(r2, 1 / 30), true);
  assert.equal(r2.mode, 'reward');
  assert.equal(r2.reward.result, 'surrender');
  assert.equal(r2.stats.surrenders, 1);
});

test('aliases and a short random playthrough never touch Math.random', { skip: SKIP }, () => {
  assert.equal(typeof G.Run.fx, 'function');
  const run = freshHubRun();
  G.Run.fx(run, { t: 'msg', text: 'x', kind: '' });
  assert.equal(G.Run.drainFx(run).length, 1);
  assert.equal(G.Run.drainFx(run).length, 0);
  assert.equal(G.Run.hasAug(run, 'scrap_arm'), false);
  // play: jump forward, resolve events by picking the first enabled choice, fights end in wins
  for (let seed = 1; seed <= 5; seed++) {
    const r = newRun(G, { seed });
    let guard = 0;
    while (guard++ < 400 && r.mode !== 'victory' && r.mode !== 'gameover') {
      if (r.mode === 'event') {
        const c = G.Events.choices(r).find((x) => x.enabled);
        if (!r.event.result) G.Events.choose(r, c.idx);
        if (r.event) G.Events.cont(r);
      } else if (r.mode === 'combat') {
        r.combat.result = 'win';
        G.Run.step(r, 1 / 30);
      } else if (r.mode === 'reward') G.Run.claimReward(r);
      else if (r.mode === 'sectorSelect') G.Run.chooseSector(r, 0);
      else if (r.mode === 'hub') {
        r.res.fuel = Math.max(r.res.fuel, 3);
        if (G.Run.atExit(r)) { G.Run.leaveSector(r); continue; }
        const s = r.sector;
        const next = G.Map.neighbors(s, r.at).find((id) => G.Map.jumpsLeft(s, id) < G.Map.jumpsLeft(s, r.at));
        G.Run.jump(r, next);
      }
    }
    assert.equal(r.mode, 'victory', `seed ${seed} ended in ${r.mode}`);
    assert.equal(r.sectorIndex, 4);
  }
});

test('a finished fight emits combatEnd exactly once', { skip: SKIP }, () => {
  const run = freshHubRun();
  G.Events.start(run, 'civ_test');
  G.Events.choose(run, 2);
  G.Events.cont(run);
  assert.equal(run.mode, 'combat');
  run.combat.enemy.hull = 0;
  G.U.drainFx(run);
  for (let i = 0; i < 300 && run.mode === 'combat'; i++) G.Run.step(run, 1 / 30);
  assert.equal(run.mode, 'reward');
  assert.equal(G.U.drainFx(run).filter((f) => f.t === 'combatEnd').length, 1);
});

test('loseCrew outcomes are skipped when only one crew member is left', { skip: SKIP }, () => {
  const solo = { id: 'solo_test', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, nodes: { start: { text: 't',
    choices: [{ text: 'go', outcomes: [{ w: 100, text: 'lost one', fx: [{ loseCrew: 1 }] }, { w: 1, text: 'safe' }] }] } } };
  for (let seed = 1; seed <= 5; seed++) {
    const run = hub(newRun(G, { seed, events: [solo] }));
    run.player.crew.length = 1;
    G.Events.start(run, 'solo_test');
    assert.equal(G.Events.choose(run, 0).text, 'safe');
  }
  const run = hub(newRun(G, { seed: 9, events: [solo] }));
  G.Events.start(run, 'solo_test');
  assert.equal(G.Events.choose(run, 0).text, 'lost one', 'with 2+ crew the outcome stays possible');
});
