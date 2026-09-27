// Whole-run flow tests driven by the headless bot (tests/bot.mjs): complete runs for both ships finish in
// victory or gameover without exceptions or invariant failures, and runs are deterministic, including a
// mid-combat save -> load -> continue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSim, makeRun } from './combat-helpers.mjs';
import { newGame, advance, isOver, playRun, checkInvariants } from './bot.mjs';

const G = loadSim();   // throwing Math.random / Date guards inside the sim realm
const SEEDS = 12;
const MAX_UNITS = 200000;          // bot units (decisions + sim ticks); a typical run needs ~25–40k
const MAX_SIM_SECONDS = 90 * 60;

for (const shipId of ['falcon', 'thunder']) {
  test(`bot plays ${SEEDS} complete ${shipId} runs without exceptions or invariant failures`, () => {
    const summary = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = playRun(G, { seed: 7000 + seed, shipId, difficulty: 'normal', maxUnits: MAX_UNITS,
        maxMinutes: MAX_SIM_SECONDS / 60 });
      const tag = `${shipId} seed ${7000 + seed}`;
      assert.equal(r.error, undefined, `${tag}: ${r.error && r.error.stack}`);
      assert.equal(r.invariant, undefined, `${tag}: ${r.invariant && r.invariant.join('; ')}`);
      assert.ok(!r.timeout, `${tag}: no end within the budget (mode ${r.mode}, units ${r.units})`);
      assert.ok(r.mode === 'victory' || r.mode === 'gameover', `${tag}: ended in ${r.mode}`);
      assert.ok(r.win ? r.state.end.reason === 'flagship' : ['hull', 'crew'].includes(r.state.end.reason), tag);
      assert.ok(r.beacons >= 2 && r.jumps >= 1, `${tag}: visited ${r.beacons} beacons`);
      assert.ok(r.bot.fights >= 1, `${tag}: at least one fight`);
      if (r.win) assert.equal(r.sector, G.CFG.SECTORS - 1, `${tag}: a win happens in the final sector`);
      assert.equal(G.Save.deserialize(G.Save.serialize(r.state)) !== null, true, `${tag}: final state is loadable`);
      summary.push(r.win ? 'W' : r.sector);
    }
    // not a balance assertion: just make sure runs are not all dying immediately
    assert.ok(summary.some((s) => s === 'W' || s >= 2), `${shipId}: runs reach sector 2+: ${summary.join(' ')}`);
  });
}

test('same seed + same bot decisions -> identical serialized run', () => {
  const a = playRun(G, { seed: 4242, shipId: 'thunder' });
  const b = playRun(G, { seed: 4242, shipId: 'thunder' });
  assert.equal(a.error, undefined);
  assert.equal(G.Save.serialize(a.state), G.Save.serialize(b.state));
  assert.equal(JSON.stringify(a.bot), JSON.stringify(b.bot));
  const c = playRun(G, { seed: 4243, shipId: 'thunder' });
  assert.notEqual(G.Save.serialize(a.state), G.Save.serialize(c.state), 'different seeds differ');
});

test('mid-combat serialize -> deserialize -> continue matches continuing the original', () => {
  for (const [shipId, seed, fightNo, ticksIn] of [['falcon', 31, 1, 150], ['thunder', 32, 3, 400]]) {
    const { run, bs } = newGame(G, { seed, shipId });
    let fights = 0, prev = run.mode;
    // play until `ticksIn` ticks into fight number `fightNo`
    for (let u = 0; u < MAX_UNITS && !isOver(run); u++) {
      advance(G, run, bs);
      if (run.mode === 'combat' && prev !== 'combat') fights++;
      prev = run.mode;
      if (fights === fightNo && run.mode === 'combat' && bs.fightTick >= ticksIn) break;
    }
    assert.equal(run.mode, 'combat', `${shipId}: reached fight ${fightNo}`);
    assert.ok(run.combat.projectiles.length + run.combat.beams.length >= 0);
    const snap = G.Save.serialize(run);
    const bsSnap = JSON.stringify(bs);
    const copy = G.Save.deserialize(snap);
    assert.ok(copy, 'snapshot loads');
    assert.equal(G.Save.serialize(copy), snap, 'round trip is exact');
    const bs2 = JSON.parse(bsSnap);
    // continue both to the end of the run (through the rest of this fight and beyond)
    let n = 0;
    while (!isOver(run) && n < MAX_UNITS) { advance(G, run, bs); n++; }
    let m = 0;
    while (!isOver(copy) && m < MAX_UNITS) { advance(G, copy, bs2); m++; }
    assert.equal(m, n, `${shipId}: same number of bot units`);
    assert.equal(G.Save.serialize(copy), G.Save.serialize(run), `${shipId}: resumed run matches the original`);
    assert.deepEqual(checkInvariants(G, copy, true), []);
  }
});

test('fleet barrage escalates so a stranded stalemate cannot last forever', () => {
  const run = makeRun(G, { shipId: 'falcon', sectorIndex: 3, seed: 77 });
  const c = G.Combat.create(run, { faction: 'rebel', elite: true });
  assert.equal(c.hazard, 'fleet');
  // neither ship can hurt the other: enemy weapons unpowered, player weapons off
  c.enemy.weapons.forEach((w) => { w.on = false; w.want = false; });
  run.player.weapons.forEach((w, i) => { if (w.on) G.Ship.toggleWeapon(run.player, i); });
  run.player.hullMax = run.player.hull = 999;
  const perBarrage = [];
  let t = 0;
  while (c.time < 200 && !c.result) {
    G.Combat.step(run, 1 / 30);
    const shells = G.Combat.drainFx(run).filter((f) => f.t === 'launch' && f.kind === 'fleet');
    if (shells.length) perBarrage.push([Math.floor(c.time), shells.length]);
    t++;
  }
  // barrage i fires 1 + floor(time / 60) shells (launch fx arrive one burstGap apart, so group by barrage)
  assert.equal(c.flags.fleetShots, 4, JSON.stringify(perBarrage));
  assert.ok(run.player.hull < 999, 'the barrage eventually gets through the shields');
});

test('a normal enemy disengages after a long stalemate (no hull / crew damage either way)', () => {
  const run = makeRun(G, { shipId: 'thunder', sectorIndex: 1, seed: 78, faction: 'pirate' });
  const c = G.Combat.create(run, { faction: 'pirate', hazard: 'none' });
  c.enemy.weapons.forEach((w) => { w.on = false; w.want = false; });
  run.player.weapons.forEach((w, i) => { if (w.on) G.Ship.toggleWeapon(run.player, i); });
  while (c.time < 85 && !c.result) G.Combat.step(run, 1 / 30);
  assert.equal(c.enemy.fleeing, false, 'not before the stalemate time');
  while (c.time < 200 && !c.result) G.Combat.step(run, 1 / 30);
  assert.equal(c.enemy.fleeing, true);
  assert.equal(c.result, 'enemyFled');
  // the flagship never gives up
  const run2 = makeRun(G, { shipId: 'thunder', sectorIndex: 4, seed: 79 });
  const c2 = G.Combat.create(run2, { boss: true });
  c2.enemy.weapons.forEach((w) => { w.on = false; w.want = false; });
  run2.player.weapons.forEach((w, i) => { if (w.on) G.Ship.toggleWeapon(run2.player, i); });
  while (c2.time < 150 && !c2.result) G.Combat.step(run2, 1 / 30);
  assert.equal(c2.enemy.fleeing, false);
  assert.equal(c2.result, null);
});

test('an accepted surrender pays exactly the offer; a decided fight cannot be fled', () => {
  const { run } = newGame(G, { seed: 9, shipId: 'falcon' });
  // leave the intro event, then start a fight directly
  while (run.mode === 'event') { const ch = G.Events.choices(run).find((c) => c.enabled); G.Events.choose(run, ch.idx); G.Events.cont(run); }
  G.Run.startCombat(run, { faction: 'pirate' });
  const c = run.combat;
  c.offer = { type: 'surrender', scrap: 17, fuel: 2, missiles: 1, text: 'x' };
  const res0 = JSON.parse(JSON.stringify(run.res));
  G.Combat.answerOffer(run, true);
  assert.equal(c.result, 'surrender');
  run.player.ftl = 1;
  assert.equal(G.Combat.canFlee(run), false, 'no fleeing once the result is decided');
  assert.equal(G.Run.step(run, 1 / 30), true);
  assert.equal(run.mode, 'reward');
  assert.equal(run.reward.scrap, 17);
  assert.equal(run.reward.fuel, 2);
  assert.equal(run.reward.missiles, 1);
  assert.equal(run.res.scrap, res0.scrap + 17);
  assert.equal(run.res.fuel, res0.fuel + 2);
  assert.equal(run.res.missiles, res0.missiles + 1);
  assert.equal(run.stats.scrapEarned, 17);
});

test('invariant checker catches broken states', () => {
  const { run } = newGame(G, { seed: 5, shipId: 'falcon' });
  assert.deepEqual(checkInvariants(G, run, true), []);
  const bad = G.Save.deserialize(G.Save.serialize(run));
  bad.player.hull = NaN;
  bad.res.fuel = -1;
  bad.player.systems.shields.power = 99;
  bad.combat = { enemy: bad.player };
  const errs = checkInvariants(G, bad, true);
  assert.ok(errs.some((e) => e.includes('hull')), errs.join('; '));
  assert.ok(errs.some((e) => e.includes('res.fuel')));
  assert.ok(errs.some((e) => e.includes('reactorUsed') || e.includes('usable')));
  assert.ok(errs.some((e) => e.includes('combat')));
});
