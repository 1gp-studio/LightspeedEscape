// Persistence (G.Save): run round trips (incl. mid-combat determinism), validation, guarded localStorage,
// settings / meta defaults and merging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './load.mjs';
import { installRandomGuard, newRun, ready } from './meta-fixture.mjs';

const G = loadGame();
installRandomGuard(G);
const SKIP = ready(G) ? false : 'sim-combat modules are still stubs';
const realmGlobal = new (G.U.clamp.constructor)('return this')();

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}
function throwingStorage() {
  const boom = () => { throw new Error('SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}
function withStorage(ls, fn) {
  const had = Object.prototype.hasOwnProperty.call(realmGlobal, 'localStorage');
  const old = realmGlobal.localStorage;
  realmGlobal.localStorage = ls;
  try { return fn(); } finally { if (had) realmGlobal.localStorage = old; else delete realmGlobal.localStorage; }
}

test('works with no localStorage at all', () => {
  assert.equal(realmGlobal.localStorage, undefined);
  assert.equal(G.Save.load(), null);
  assert.equal(G.Save.has(), false);
  G.Save.clear();
  assert.equal(JSON.stringify(G.Save.loadSettings()),
    JSON.stringify({ sound: true, vibrate: true, speed: 1, autoPause: true, crisisPause: true, tips: true }));
  assert.equal(JSON.stringify(G.Save.loadMeta()), JSON.stringify({ runs: 0, wins: 0, bestSector: 0, tipsSeen: {} }));
  assert.equal(G.Save.saveSettings({ sound: false }), false);
});

test('a throwing localStorage never throws out of G.Save', { skip: SKIP }, () => {
  withStorage(throwingStorage(), () => {
    const run = newRun(G);
    assert.equal(G.Save.save(run), false);
    assert.equal(G.Save.load(), null);
    assert.equal(G.Save.has(), false);
    G.Save.clear();
    assert.equal(G.Save.loadSettings().sound, true);
    G.Save.saveMeta({ runs: 1 });
  });
});

test('serialize / deserialize round trip (event, hub) drops runtime keys and rebuilds caches', { skip: SKIP }, () => {
  const run = newRun(G, { seed: 31 });
  G.Run.fx(run, { t: 'msg', text: 'x', kind: '' });
  G.Ship.adj(run.player);
  const str = G.Save.serialize(run);
  assert.ok(!str.includes('"_fx"') && !str.includes('"_adj"'));
  const back = G.Save.deserialize(str);
  assert.ok(back);
  assert.equal(G.Save.serialize(back), str);
  assert.equal(JSON.stringify(back._fx), '[]');
  assert.ok(Array.isArray(back.player._adj) && back.player._adj.length === back.player.rooms.length);
  // hub
  G.Events.choose(run, 0);
  G.Events.cont(run);
  assert.equal(run.mode, 'hub');
  const back2 = G.Save.deserialize(G.Save.serialize(run));
  assert.equal(back2.mode, 'hub');
  assert.equal(G.Save.serialize(back2), G.Save.serialize(run));
});

test('mid-combat save/load is deterministic (same inputs -> same state)', { skip: SKIP }, () => {
  const run = newRun(G, { seed: 17 });
  G.Events.choose(run, 0);
  G.Events.cont(run);
  G.Run.startCombat(run, { faction: 'pirate' });
  for (let i = 0; i < 90; i++) G.Run.step(run, 1 / 30);
  G.Combat.setTarget(run, 0, 1);
  const copy = G.Save.deserialize(G.Save.serialize(run));
  assert.ok(copy.combat && copy.combat.enemy._adj, 'enemy caches rebuilt');
  for (let i = 0; i < 600; i++) {
    G.Run.step(run, 1 / 30);
    G.Run.step(copy, 1 / 30);
    if (i === 200) { G.Combat.setTarget(run, 1, 0); G.Combat.setTarget(copy, 1, 0); }
  }
  G.Run.drainFx(run);
  G.Run.drainFx(copy);
  assert.equal(G.Save.serialize(copy), G.Save.serialize(run));
});

test('deserialize validates', { skip: SKIP }, () => {
  const run = newRun(G, { seed: 2 });
  const ok = JSON.parse(G.Save.serialize(run));
  const bad = (mut) => { const o = JSON.parse(JSON.stringify(ok)); mut(o); return G.Save.deserialize(JSON.stringify(o)); };
  assert.equal(G.Save.deserialize(''), null);
  assert.equal(G.Save.deserialize('{nope'), null);
  assert.equal(G.Save.deserialize('null'), null);
  assert.equal(G.Save.deserialize('[]'), null);
  assert.equal(G.Save.deserialize(null), null);
  assert.equal(bad((o) => { o.v = 2; }), null);
  assert.equal(bad((o) => { o.shipId = 'kestrel'; }), null);
  assert.equal(bad((o) => { o.mode = 'combat'; o.combat = null; }), null);
  assert.equal(bad((o) => { o.mode = 'weird'; }), null);
  assert.equal(bad((o) => { delete o.player; }), null);
  assert.equal(bad((o) => { o.at = 999; }), null);
  assert.ok(bad(() => {}));
});

test('save / load / has / clear; gameover and victory clear the slot', { skip: SKIP }, () => {
  const ls = memoryStorage();
  withStorage(ls, () => {
    const run = newRun(G, { seed: 11 });
    assert.equal(G.Save.has(), false);
    assert.equal(G.Save.save(run), true);
    assert.equal(G.Save.has(), true);
    assert.ok(ls._m.has(G.CFG.SAVE_KEY));
    const back = G.Save.load();
    assert.equal(G.Save.serialize(back), G.Save.serialize(run));
    run.mode = 'gameover';
    run.end = { win: false, reason: 'crew', text: '' };
    assert.equal(G.Save.save(run), false);
    assert.equal(G.Save.has(), false);
    assert.equal(G.Save.load(), null);
    run.mode = 'hub';
    G.Save.save(run);
    assert.equal(G.Save.has(), true);
    run.mode = 'victory';
    G.Save.save(run);
    assert.equal(G.Save.has(), false);
    G.Save.save(null);
    ls.setItem(G.CFG.SAVE_KEY, '{"v":1}');
    assert.equal(G.Save.load(), null, 'corrupt save is rejected');
    G.Save.clear();
    assert.equal(G.Save.has(), false);
  });
});

test('settings / meta: defaults, merge, type checks, unknown keys kept', () => {
  const ls = memoryStorage();
  withStorage(ls, () => {
    const s = G.Save.loadSettings();
    s.sound = false;
    s.speed = 1.25;
    assert.equal(G.Save.saveSettings(s), true);
    assert.equal(JSON.stringify(G.Save.loadSettings()),
      JSON.stringify({ sound: false, vibrate: true, speed: 1.25, autoPause: true, crisisPause: true, tips: true }));
    ls.setItem(G.CFG.SETTINGS_KEY, JSON.stringify({ sound: 'yes', tips: false, extra: 7 }));
    const s2 = G.Save.loadSettings();
    assert.equal(s2.sound, true, 'wrong type -> default');
    assert.equal(s2.tips, false);
    assert.equal(s2.extra, 7, 'unknown key kept');
    ls.setItem(G.CFG.SETTINGS_KEY, 'garbage{');
    assert.equal(G.Save.loadSettings().sound, true);

    const m = G.Save.loadMeta();
    m.runs = 3; m.wins = 1; m.bestSector = 4; m.tipsSeen.t_pause = true;
    G.Save.saveMeta(m);
    const m2 = G.Save.loadMeta();
    assert.equal(JSON.stringify(m2), JSON.stringify({ runs: 3, wins: 1, bestSector: 4, tipsSeen: { t_pause: true } }));
    // defaults are never shared / mutated
    m2.tipsSeen.x = true;
    ls.removeItem(G.CFG.META_KEY);
    assert.equal(JSON.stringify(G.Save.loadMeta().tipsSeen), '{}');
  });
});
