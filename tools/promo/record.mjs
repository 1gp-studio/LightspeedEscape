// Promo video recorder (dev tool, not part of the build).
//   1. serve the project:   PORT=5181 node serve.mjs
//   2. record:              node tools/promo/record.mjs            -> promo/lightspeed-promo.mp4 (1080x1920)
// Pass 1 drives dist/lightspeed.html frame by frame on a virtual clock (rAF, performance.now and CSS
// animations all advance exactly 1/FPS per frame), runs a scripted storyboard and screenshots every frame,
// logging the game's sound calls and music mode. Pass 2 (recorder.html) replays the frames onto a canvas in
// real time while re-triggering the same sounds through the game's own audio.js, and records both with
// MediaRecorder (MP4/H.264 + AAC) — no ffmpeg needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.BASE || 'http://127.0.0.1:5181';
const FPS = 30, W = 405, H = 720, SCALE = 1080 / 405;     // 1080x1920 output
const FRAMES_DIR = path.join(ROOT, 'promo', 'frames');
const OUT = path.join(ROOT, 'promo', 'lightspeed-promo.mp4');

// ---------------------------------------------------------------------------- page-side clock
const CLOCK = `(function () {
  var q = [], id = 0;
  window.__vt = 0;
  performance.now = function () { return window.__vt; };
  window.requestAnimationFrame = function (cb) { q.push({ id: ++id, cb: cb }); return id; };
  window.cancelAnimationFrame = function (i) { q = q.filter(function (x) { return x.id !== i; }); };
  window.__tick = function (ms) {
    window.__vt += ms;
    var cur = q; q = [];
    cur.forEach(function (x) { try { x.cb(window.__vt); } catch (e) { console.error(e); } });
    document.getAnimations().forEach(function (a) {
      try { if (a.playState !== 'finished') { a.pause(); a.currentTime = (a.currentTime || 0) + ms; } } catch (e) {}
    });
  };
})();`;

// ---------------------------------------------------------------------------- storyboard (page side)
const DIRECTOR = `(function () {
  var G = window.G, A = G.App, FPS = ${FPS};
  window.__log = []; window.__modes = [];
  var frame = 0;
  // sound + music hooks: record instead of playing (pass 2 replays them in sync)
  G.Audio.fx = function (ev) { window.__log.push({ f: frame, k: 'fx', a: ev }); };
  var play0 = G.Audio.play;
  G.Audio.play = function (n, v) { window.__log.push({ f: frame, k: 'play', a: n, v: v }); };
  A.settings.tips = false; A.settings.autoPause = false; A.settings.crisisPause = false; A.settings.speed = 1;
  if (G.Tips) G.Tips.reset();

  // ---- caption banner
  var cap = document.createElement('div');
  cap.id = 'promo-cap';
  cap.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);z-index:99;pointer-events:none;' +
    'padding:10px 18px;background:#0b1022;color:#ffd08a;white-space:nowrap;text-align:center;' +
    "font:400 26px/1.2 'ZCOOL QingKe HuangYou','Microsoft YaHei',sans-serif;letter-spacing:.08em;" +
    'box-shadow:0 0 0 2px #05070e,inset 0 0 0 2px #ffb547,inset 0 0 0 4px #05070e,0 4px 0 #05070e;display:none';
  var sub = document.createElement('div');
  sub.style.cssText = "font:700 12px/1.5 'Silkscreen',monospace;color:#9fb4de;letter-spacing:.06em;margin-top:6px;white-space:pre-line";
  document.getElementById('app').appendChild(cap);
  function say(text, top, small) {
    cap.style.display = text ? 'block' : 'none';
    cap.style.top = (top == null ? 46 : top) + '%';
    cap.textContent = text || '';
    if (small) { sub.textContent = small; cap.appendChild(sub); }
  }

  function run() { return A.run; }
  function S(t) { return Math.round(t * FPS); }
  function boostPlayer(r) {
    var p = r.player;
    p.reactor = Math.max(p.reactor, 14);
    p.systems.shields.level = Math.max(p.systems.shields.level, 4);
    p.systems.weapons.level = Math.max(p.systems.weapons.level, 5);
    p.systems.engines.level = Math.max(p.systems.engines.level, 3);
    while (G.Ship.addPower(p, 'shields')) {}
    while (G.Ship.addPower(p, 'engines')) {}
    r.res.missiles = 20;
    if (p.weapons.length < 3) G.Events.giveWeapon(r, 'laser_heavy1');
  }
  function aim(r) {
    var c = r.combat; if (!c) return;
    var sh = G.Ship.sysRoom(c.enemy, 'shields'), wp = G.Ship.sysRoom(c.enemy, 'weapons');
    r.player.weapons.forEach(function (w, i) {
      if (!w.on) G.Ship.toggleWeapon(r.player, i);
      if (w.target == null) G.Combat.setTarget(r, i, (i % 2 ? (wp || sh) : (sh || wp)).id);
    });
  }
  function startFight(spec) {
    var r = run();
    G.UI.closeAll();
    r.mode = 'hub'; r.event = null; r.reward = null;
    G.Run.startCombat(r, spec);
    G.Combat.setVolley(r, true);
    A.settings.speed = 2;                                   // trailer pacing: more shots per second
    r.player.weapons.forEach(function (w) { w.charge = G.data.weapons[w.id].charge * 0.8; });
    r.combat.enemy.weapons.forEach(function (w) { w.charge = G.data.weapons[w.id].charge * 0.6; });
    A.sync(); A.setPaused(false);
    if (G.Tips) G.Tips.reset();
  }

  var plan = [
    // ---- title
    [S(0.0), function () { say('', 0); }],
    [S(0.6), function () { say('一艘船 · 一份情报 · 整支叛军舰队', 70); }],
    // ---- ship select
    [S(3.0), function () { say(''); G.UI.open('newgame'); }],
    [S(3.4), function () { say('两艘战舰 · 两种打法', 84); }],
    // ---- map
    [S(5.8), function () {
      say('');
      G.UI.closeAll();
      A.newRun({ seed: 20261022, shipId: 'falcon', difficulty: 'normal' });
      var r = run(); A.settings.tips = false; if (G.Tips) G.Tips.reset();
      G.Events.choose(r, 0); G.Events.cont(r); A.sync(); G.UI.closeAll();
      boostPlayer(r);
      G.UI.open('map');
    }],
    [S(6.2), function () { say('穿越五个星区', 30, 'OUTRUN THE REBEL FLEET'); }],
    // ---- combat
    [S(8.8), function () {
      say('');
      startFight({ faction: 'rebel' });
      var e = run().combat.enemy; e.hullMax = Math.max(e.hullMax, 14); e.hull = 12;
    }],
    [S(9.2), function () { say('实时战斗 · 随时暂停下令', 76); }],
    [S(12.2), function () { say('瞄准敌舰的任意舱室', 76); }],
    [S(14.6), function () {
      var r = run(); if (!r.combat) return;
      var p = r.player, rooms = p.rooms;
      var empty = rooms.filter(function (x) { return !x.sys; });
      if (empty[0]) { empty[0].fire = 2; }
      if (empty[1]) { empty[1].breach = 1; }
      var ws = G.Ship.sysRoom(p, 'weapons'); if (ws) G.Ship.damageSystem(p, 'weapons', 1);
      if (empty[0] && p.crew[1]) G.Crew.order(p, p.crew[1].id, empty[0].id);
      if (empty[1] && p.crew[2]) G.Crew.order(p, p.crew[2].id, empty[1].id);
      say('灭火 · 堵漏 · 抢修系统', 76);
    }],
    [S(16.8), function () { var r = run(); if (r.combat && !r.combat.pending) r.combat.enemy.hull = Math.min(r.combat.enemy.hull, 1); }],
    [S(18.4), function () { say(''); }],
    // ---- reward / store (reward overlay opens on its own when the fight resolves)
    [S(19.6), function () { A.settings.speed = 1; say('战利品 · 升级 · 增强模块', 12); }],
    [S(21.4), function () {
      var r = run();
      if (r.mode === 'reward') G.Run.claimReward(r);
      if (r.mode === 'combat') { r.combat = null; r.mode = 'hub'; }
      r.mode = 'hub'; r.res.scrap = 260;
      var b = G.Run.beacon(r); b.store = G.Store.create(r);
      A.sync(); G.UI.closeAll(); G.UI.open('store', { tab: 'weapons' });
    }],
    // ---- flagship
    [S(23.8), function () {
      say('');
      var r = run();
      r.player.hull = r.player.hullMax;
      startFight({ boss: true });
      var e = run().combat.enemy; e.hull = 16;
    }],
    [S(24.2), function () { say('终极一战：叛军旗舰', 76); }],
    [S(27.6), function () { var r = run(); if (r.combat && !r.combat.pending) r.combat.enemy.hull = Math.min(r.combat.enemy.hull, 1); }],
    [S(28.5), function () { var r = run();
      // the trailer skips the journey: show a typical full run's numbers on the victory screen
      r.sectorIndex = 4;
      var st = r.stats; st.beacons = 33; st.jumps = 32; st.kills = 13; st.scrapEarned = 642; st.crewHired = 2; st.crewLost = 1; st.fled = 1; st.time = 1534;
      if (r.combat && !r.combat.pending) { r.combat.enemy.hull = 0; G.U.fx(r, { t: 'destroyed', side: 'enemy' }); } }],
    [S(29.6), function () { say(''); }],
    [S(31.0), function () { A.settings.speed = 1; say('把情报送到联邦', 70); }],
    // ---- end card
    [S(33.6), function () {
      say('');
      A.settings.speed = 1;
      G.UI.closeAll(); A.quitToTitle(true); G.Save.clear();
      G.UI.closeAll(); G.UI.open('title');
    }],
    [S(33.9), function () { say('手机浏览器 · 即点即玩', 64, '1GP-STUDIO.GITHUB.IO' + String.fromCharCode(10) + '/LIGHTSPEEDESCAPE'); }],
  ];

  function musicMode() {
    var r = A.run;
    if (!r || G.UI.isOpen('title') || G.UI.isOpen('newgame')) return 'title';
    if (r.mode === 'gameover' || r.mode === 'victory') return null;
    if (r.mode === 'combat' && r.combat) return r.combat.boss ? 'boss' : 'combat';
    return 'calm';
  }

  window.__dir = function (f) {
    frame = f;
    plan.forEach(function (p) { if (p[0] === f) p[1](); });
    var r = A.run;
    if (r && r.mode === 'combat' && r.combat && !r.combat.pending) {
      aim(r);
      r.player.hull = Math.max(r.player.hull, 8);              // the hero survives the trailer
      if (A.paused) A.setPaused(false);
    }
    if (G.UI.isOpen('tip')) G.UI.close('tip');
    window.__modes.push(musicMode());
    window.__tick(1000 / FPS);
  };
  window.__dirLen = S(37.5);
  return window.__dirLen;
})()`;

// ---------------------------------------------------------------------------- pass 1: frames
async function pass1(b) {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const p = await b.page();
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  p.on('Runtime.exceptionThrown', (e) => console.error('page exception:', e.exceptionDetails.exception && e.exceptionDetails.exception.description));
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: true });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK + 'try{localStorage.clear()}catch(e){}' });
  const loaded = p.once('Page.loadEventFired');
  await p.send('Page.navigate', { url: BASE + '/dist/lightspeed.html' });
  await loaded;
  await p.eval('document.fonts.ready.then(function(){return 1})');
  for (let i = 0; i < 20; i++) await p.eval('window.__tick(33.3); 1');   // boot: title screen settles
  const total = await p.eval(DIRECTOR);
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await p.eval(`window.__dir(${f}); 1`);
    const shot = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, captureBeyondViewport: false });
    fs.writeFileSync(path.join(FRAMES_DIR, String(f).padStart(5, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
    if (f % 150 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const meta = await p.eval('JSON.stringify({ log: window.__log, modes: window.__modes })');
  fs.writeFileSync(path.join(FRAMES_DIR, 'meta.json'), meta);
  p.close();
  return { total, ...JSON.parse(meta) };
}

// ---------------------------------------------------------------------------- pass 2: encode
async function pass2(b, m) {
  const p = await b.page();
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  p.on('Runtime.consoleAPICalled', (e) => console.log('[recorder]', e.args.map((a) => a.value).join(' ')));
  const loaded = p.once('Page.loadEventFired');
  await p.send('Page.navigate', { url: BASE + '/tools/promo/recorder.html' });
  await loaded;
  const info = await p.eval(`window.__record(${JSON.stringify({ total: m.total, fps: FPS, log: m.log, modes: m.modes })})`);
  console.log('recorded', info);
  const n = await p.eval('window.__chunks.length');
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(await p.eval(`window.__chunks[${i}]`), 'base64'));
  fs.writeFileSync(OUT, Buffer.concat(parts));
  p.close();
}

const b = await launch({ port: 9342 });
try {
  const m = await pass1(b);
  console.log(`pass 1 done: ${m.total} frames, ${m.log.length} sound events`);
  await pass2(b, m);
  console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB');
} finally {
  b.close();
  await sleep(200);
}
