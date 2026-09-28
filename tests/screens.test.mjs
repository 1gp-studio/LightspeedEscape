// ui-screens: every overlay mounts and its main flows drive the sim correctly, headless (tests/dom-shim.mjs).
// Runs without main.js: G.Screens falls back to its built-in router and globalThis.__run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUI } from './dom-shim.mjs';

const tick = () => new Promise((r) => setImmediate(r));

function setup(shipId = 'falcon') {
  const env = loadUI();
  const { G, win } = env;
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  env.restore = () => { console.error = origError; };
  env.errors = errors;
  env.newRun = (seed = 3) => {
    win.__run = G.Run.create({ seed, shipId, difficulty: 'normal' });
    G.Screens.sync();
    return win.__run;
  };
  env.open = () => JSON.stringify(G.UI.stack.map((e) => e.name));
  return env;
}

test('screens: all overlays are registered per the SPEC §2 map', () => {
  const { G, restore } = setup();
  restore();
  ['title', 'newgame', 'menu', 'settings', 'help', 'reward', 'offer', 'map', 'event', 'store', 'ship', 'sector', 'end']
    .forEach((n) => assert.ok(G.UI.screens[n], 'missing overlay ' + n));
  assert.equal(typeof G.Audio.fx, 'function');
  assert.deepEqual(['play', 'fx', 'unlock', 'setEnabled'].map((k) => typeof G.Audio[k]), ['function', 'function', 'function', 'function']);
});

test('screens: title → newgame → 出发 starts a run in the intro event', () => {
  const env = setup();
  const { G, win, click } = env;
  G.UI.open('title');
  click('.btn', '新游戏');
  assert.ok(G.UI.isOpen('newgame'));
  click('.ng-card', '雷鸣号');
  click('.seg-btn', '困难');
  click('.btn', '出发');
  const run = win.__run;
  assert.equal(run.shipId, 'thunder');
  assert.equal(run.difficulty, 'hard');
  assert.equal(run.mode, 'event');
  assert.equal(env.open(), '["event"]');
  env.restore();
  assert.deepEqual(env.errors, []);
});

test('screens: event choose → result → 继续 → hub; map jump; store buy; ship upgrade', async () => {
  const env = setup();
  const { G, win, click, find, all } = env;
  const run = env.newRun(5);
  assert.equal(run.event.id, 'start_intro');
  click('.ev-choice', '任务简报');
  assert.ok(run.event.result, 'result is showing');
  assert.ok(find('.ev-result'), 'result text rendered');
  click('.sheet-foot .btn', '继续');
  assert.equal(run.event.node, 'brief');
  click('.ev-choice', '明白');          // empty outcome closes immediately
  assert.equal(run.mode, 'hub');
  assert.equal(env.open(), '[]');

  // map: select a reachable beacon through the entry state, jump
  G.UI.open('map');
  const reach = G.Map.reachable(run);
  assert.ok(reach.length > 0);
  const entry = G.UI.get('map');
  entry.state.sel = reach[0];
  G.UI.refresh();
  const fuel0 = run.res.fuel;
  click('.map-jump');
  assert.equal(run.at, reach[0]);
  assert.equal(run.res.fuel, fuel0 - 1);
  assert.ok(!G.UI.isOpen('map'));

  // store: give this beacon a store, buy fuel and a repair
  G.UI.closeAll();
  run.event = null; run.mode = 'hub';
  run.sector.beacons[run.at].store = G.Store.create(run);
  run.res.scrap = 500; run.player.hull = 10;
  G.UI.open('store');
  const f1 = run.res.fuel;
  click('.st-row .btn.buy', '+1');
  assert.equal(run.res.fuel, f1 + 1);
  click('.st-row .btn.buy', '修满');
  assert.equal(run.player.hull, run.player.hullMax);
  click('.tab', '武器');
  const nW = run.player.weapons.length + run.cargo.length;
  click('.st-card .btn.buy');
  assert.equal(run.player.weapons.length + run.cargo.length, nW + 1);
  click('.tab', '船员');
  const nC = run.player.crew.length;
  click('.st-card .btn.buy');
  assert.equal(run.player.crew.length, nC + 1);
  // a refused purchase shows a toast and changes nothing
  run.res.scrap = 0;
  click('.tab', '补给');
  click('.st-row .btn.buy', '+1');
  assert.ok(find('.toast', '废料不足'));

  // ship: upgrade shields, unequip + equip, dismiss via confirm
  G.UI.close('store');
  run.res.scrap = 500;
  G.UI.open('ship');
  const lv = run.player.systems.shields.level;
  click('.sh-sys .btn.buy', '升级');   // first system row is shields
  assert.equal(run.player.systems.shields.level, lv + 1);
  const r0 = run.player.reactor;
  click('.sh-sys.reactor .btn.buy');
  assert.equal(run.player.reactor, r0 + 1);
  click('.tab', '武器');
  const w0 = run.player.weapons[0].id;
  click('.sh-slot .sh-mini', '卸下');
  assert.ok(run.cargo.includes(w0));
  click('.sh-slot.cargo .sh-mini', '装备');
  click('.tab', '船员');
  const crewN = run.player.crew.length;
  click('.dismiss');
  assert.ok(G.UI.isOpen('__confirm'));
  click('.overlay[data-screen=__confirm] .btn.danger');
  await tick();
  assert.equal(run.player.crew.length, crewN - 1);
  env.restore();
  assert.deepEqual(env.errors, []);
});

test('screens: event cost gates are disabled; store outcome opens the store', () => {
  const env = setup();
  const { G, click, all } = env;
  const run = env.newRun(9);
  run.event = null; run.mode = 'hub';
  const ev = G.data.events.find((e) => e.nodes.start.choices.some((c) => c.req && c.req.scrap));
  run.res.scrap = 0;
  G.Events.start(run, ev.id);
  G.Screens.sync();
  const off = all('.ev-choice').filter((b) => b.disabled);
  assert.ok(off.length >= 1, 'cost-gated choice is disabled');
  G.UI.closeAll();
  run.event = null; run.mode = 'hub';
  G.Events.start(run, 'store_station');
  G.Screens.sync();
  click('.ev-choice');
  click('.sheet-foot .btn');
  assert.equal(run.mode, 'hub');
  assert.ok(G.UI.isOpen('store'), 'store opened by the outcome');
  env.restore();
  assert.deepEqual(env.errors, []);
});

test('screens: offer → accept → reward → 继续; sector choice; end → 再来一局', () => {
  const env = setup();
  const { G, win, click } = env;
  let run = env.newRun(11);
  run.event = null; run.mode = 'hub';
  G.Run.startCombat(run, { faction: 'pirate' });
  run.combat.offer = G.AI.surrenderOffer(run, run.combat);
  G.Screens.sync();
  assert.equal(env.open(), '["offer"]');
  // read-only ship during combat
  G.UI.open('ship');
  assert.equal(env.all('.btn.buy').length, 0);
  assert.ok(env.find('.sh-lock'));
  G.UI.close('ship');
  const scrap0 = run.res.scrap;
  click('.offer-btns .btn', '接受');
  for (let i = 0; i < 300 && run.mode === 'combat'; i++) G.Run.step(run, 1 / 30);
  G.Screens.sync();
  assert.equal(run.mode, 'reward');
  assert.equal(env.open(), '["reward"]');
  assert.ok(run.res.scrap > scrap0);
  click('.rw-panel .btn', '继续');
  assert.equal(run.mode, 'hub');

  // flee map title in combat
  G.Run.startCombat(run, { faction: 'rebel' });
  run.player.ftl = 1;
  G.UI.open('map');
  assert.equal(env.text(env.find('.map-sheet .sheet-title')), '紧急跃迁');
  G.UI.close('map');
  run.combat = null; run.mode = 'hub';

  // leave sector at the exit → sector cards → choose
  run.at = run.sector.exit;
  run.res.fuel = 5;
  G.UI.open('map');
  click('.map-next');
  assert.equal(run.mode, 'sectorSelect');
  assert.equal(env.open(), '["sector"]');
  click('.sec-card');
  assert.equal(run.sectorIndex, 1);

  // defeat → end → 再来一局
  G.UI.closeAll();
  G.Run.gameover(run, 'hull');
  G.Screens.sync();
  assert.equal(env.open(), '["end"]');
  assert.ok(env.find('.end-text', '船体'));
  click('.end-btns .btn', '再来一局');
  assert.notEqual(win.__run, run);
  assert.equal(win.__run.mode, 'event');
  env.restore();
  assert.deepEqual(env.errors, []);
});

test('screens: settings persist and apply; menu abandon clears the save', async () => {
  const env = setup();
  const { G, win, click, store } = env;
  const run = env.newRun(2);
  G.UI.open('menu');
  click('.menu-pair .btn', '设置');
  click('.set-row', '音效');
  assert.equal(G.Screens.settings().sound, false);
  assert.equal(G.Audio.isEnabled(), false);
  assert.equal(JSON.parse(store[G.CFG.SETTINGS_KEY]).sound, false);
  click('.seg-btn', '×2');
  assert.equal(JSON.parse(store[G.CFG.SETTINGS_KEY]).speed, 2);
  G.UI.close('settings');
  click('.menu-pair .btn', '玩法');
  assert.equal(env.all('.help-sec').length, G.data.text.help.length);
  G.UI.close('help');
  assert.ok(G.Save.has());
  click('.btn.danger', '放弃本局');
  click('.overlay[data-screen=__confirm] .btn.danger');
  await tick();
  assert.equal(G.Save.has(), false);
  assert.equal(win.__run, null);
  assert.ok(G.UI.isOpen('title'));
  assert.equal(G.Screens.meta().runs, 1);
  assert.equal(run.flags.metaDone, true);
  env.restore();
  assert.deepEqual(env.errors, []);
});

test('screens: stranded map offers 等待救援', async () => {
  const env = setup();
  const { G, click } = env;
  const run = env.newRun(4);
  run.event = null; run.mode = 'hub'; run.res.fuel = 0;
  G.UI.open('map');
  click('.map-actions .btn', '等待救援');
  click('.overlay[data-screen=__confirm] .btn.primary');
  await tick();
  assert.ok(run.mode === 'event' || run.mode === 'combat' || run.res.fuel > 0);
  env.restore();
  assert.deepEqual(env.errors, []);
});

test('audio: fx mapping is safe without an AudioContext', () => {
  const env = setup();
  const { G } = env;
  ['launch', 'beam', 'miss', 'shield', 'hit', 'fire', 'destroyed', 'combatEnd', 'surge', 'msg'].forEach((t) => {
    G.Audio.fx({ t, kind: 'laser', side: 'player', dmg: 1, result: 'win' });
  });
  G.Audio.play('laser');
  assert.equal(G.Audio.unlock(), false);
  env.restore();
});
