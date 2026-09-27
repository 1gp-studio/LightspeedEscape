// Run lifecycle (SPEC §6 G.Run, §7): creation, the per-tick entry point, jumps and arrival,
// combat start/finish with rewards, ship management (upgrades, reactor, equip, crew), sector changes.
// Every mutating shop/upgrade/equip/dismiss call is locked while mode === 'combat'.
(function () {
  'use strict';
  var G = globalThis.G;

  var LOCK = '战斗中无法操作';

  function rules() { return G.data.rules; }
  function diffOf(run) { var d = rules().difficulty; return d[run.difficulty || 'normal'] || d.normal; }
  function ok() { return { ok: true, reason: '' }; }
  function no(reason) { return { ok: false, reason: reason }; }
  function locked(run) { return run.mode === 'combat'; }
  function text(group, key, fallback) {
    var t = G.data.text && G.data.text[group];
    return t && typeof t[key] === 'string' && t[key] ? t[key] : fallback;
  }

  var END_TEXT = {
    hull: '船体崩解，飞船在星海中化为碎片。情报没能送达。',
    crew: '最后一名船员倒下了。飞船在寂静中漂流。',
    flagship: '叛军旗舰在火光中解体！情报安全送达联邦。',
  };
  var REWARD_TEXT = {
    win: '敌舰被击毁。你们在残骸中搜刮物资。',
    derelict: '敌舰船员全灭，整艘船任你们搜刮。',
    surrender: '敌舰投降，交出了物资。',
  };

  // ------------------------------------------------------------------ create / accessors
  function create(opts) {
    opts = opts || {};
    var shipId = G.data.ships[opts.shipId] ? opts.shipId : G.data.shipOrder[0];
    var seed = (opts.seed >>> 0) || 1;
    var run = {
      v: 1, seed: seed, rng: G.RNG.create(seed), nextId: 1,
      difficulty: rules().difficulty[opts.difficulty] ? opts.difficulty : 'normal', shipId: shipId,
      mode: 'event', player: null,
      res: G.U.clone(G.data.ships[shipId].res),
      cargo: [], augments: [], volley: false,
      sectorIndex: 0, sector: null, at: 0,
      event: null, combat: null, reward: null, after: null, sectorChoices: null, end: null,
      stats: { jumps: 0, beacons: 0, kills: 0, derelicts: 0, surrenders: 0, fled: 0, scrapEarned: 0,
               crewLost: 0, crewHired: 0, time: 0, combatTime: 0 },
      flags: {},
      _fx: [],
    };
    run.player = G.Ship.createPlayer(run, shipId);
    run.sector = G.Map.generate(run, 0, 'civilian');
    run.at = run.sector.start;
    arrive(run);
    return run;
  }

  function beacon(run) { return run.sector ? run.sector.beacons[run.at] || null : null; }
  function hasStore(run) { var b = beacon(run); return run.mode === 'hub' && !!(b && b.store); }
  function aliveCrew(run) {
    var n = 0, crew = run.player && run.player.crew ? run.player.crew : [];
    for (var i = 0; i < crew.length; i++) if (crew[i].hp > 0) n++;
    return n;
  }

  function gameover(run, reason) {
    run.combat = null;
    run.event = null;
    run.reward = null;
    run.after = null;
    run.sectorChoices = null;
    run.mode = 'gameover';
    run.end = { win: false, reason: reason, text: text('endTexts', reason, END_TEXT[reason] || '') };
  }

  // ------------------------------------------------------------------ step
  function step(run, dt) {
    var mode0 = run.mode;
    var offer0 = !!(run.combat && run.combat.offer);
    run.stats.time += dt;
    if (run.mode === 'combat' && run.combat) {
      run.stats.combatTime += dt;
      G.Combat.step(run, dt);
      if (run.combat && run.combat.result) finishCombat(run);
    } else if (run.mode === 'hub') {
      G.Combat.idle(run, dt);
    }
    // No alive crew → game over. In combat the fight itself resolves this as 'lose' (with its end delay).
    if (run.mode !== 'gameover' && run.mode !== 'victory' && aliveCrew(run) === 0) {
      var c = run.combat;
      if (!(run.mode === 'combat' && c && (c.pending || c.result))) gameover(run, 'crew');
    }
    var offer1 = !!(run.combat && run.combat.offer);
    return run.mode !== mode0 || (!offer0 && offer1);
  }

  // ------------------------------------------------------------------ jumping
  function canJump(run, id) {
    if (run.mode === 'combat') {
      var c = run.combat;
      if (!c || c.pending || c.result) return no('现在无法跃迁');   // never escape a decided fight
      if (!G.Combat.canFlee(run)) return no('跃迁引擎尚未充能');
    } else if (run.mode !== 'hub') return no('现在无法跃迁');
    if (!run.sector || G.Map.neighbors(run.sector, run.at).indexOf(id) < 0) return no('无法直达该信标');
    if ((run.res.fuel || 0) < 1) return no('燃料不足');
    return ok();
  }

  // Shared "the ship made an FTL jump" effects (beacon jump or sector change).
  function jumpEffects(run) {
    var p = run.player;
    run.res.fuel = Math.max(0, run.res.fuel - 1);
    run.stats.jumps++;
    if (G.Ship && typeof G.Ship.jumpReset === 'function') G.Ship.jumpReset(p);
    if (p.systems.medbay && p.systems.medbay.level >= 1) p.crew.forEach(function (c) { c.hp = c.hpMax; });
    p.weapons.forEach(function (w) { w.charge = 0; w.target = null; });
    p.ftl = 0;
  }

  function jump(run, id) {
    var chk = canJump(run, id);
    if (!chk.ok) return chk;
    if (run.mode === 'combat') {
      run.stats.fled++;
      run.after = null;
    }
    run.combat = null;
    run.event = null;
    G.Map.advanceFleet(run, 1);
    jumpEffects(run);
    run.at = id;
    arrive(run);
    return ok();
  }

  function startTag(run, tag) {
    var id = G.Events.pick(run, tag);
    return id ? G.Events.start(run, id) : false;
  }

  function arrive(run) {
    var s = run.sector, b = beacon(run);
    var was = !!b.visited;
    b.visited = true;
    if (!was) run.stats.beacons++;
    run.event = null;
    run.combat = null;
    // store beacons always carry a store, whatever the arrival event does
    if (b.kind === 'store' && !b.store) b.store = G.Store.create(run);

    // 1. the flagship beacon ignores overtaken / visited
    if (b.kind === 'boss' && !run.flags.flagshipDown) {
      if (!startTag(run, 'boss')) startCombat(run, { boss: true, faction: 'rebel' });
      return;
    }
    // 2. overtaken by the rebel fleet
    if (G.Map.isOvertaken(s, b)) {
      if (!startTag(run, 'combat_elite')) startCombat(run, { faction: 'rebel', elite: true });
      return;
    }
    // 3. revisit: nothing new happens
    if (was) { run.mode = 'hub'; return; }
    // 4. by kind
    var started;
    switch (b.kind) {
      case 'start':
        // only a first visit gets here, so sector 0 means the run's opening beacon
        started = startTag(run, run.sectorIndex === 0 ? 'start_intro' : 'start') || startTag(run, 'start');
        break;
      case 'event': started = startTag(run, [s.type, 'any']); break;
      case 'combat':
        started = startTag(run, 'combat_' + (b.faction || 'rebel'));
        if (!started) { startCombat(run, { faction: b.faction || 'sector' }); return; }
        break;
      case 'distress': started = startTag(run, 'distress'); break;
      case 'store': started = startTag(run, 'store'); break;
      case 'empty': started = startTag(run, 'empty'); break;
      default: started = false;
    }
    if (!started) run.mode = 'hub';
  }

  // ------------------------------------------------------------------ combat
  function startCombat(run, spec) {
    run.event = null;
    run.reward = null;
    G.Combat.create(run, spec || {});
    run.mode = 'combat';
    return run.combat;
  }

  function rollReward(run, c) {
    var R = rules(), RW = R.reward, rng = run.rng, p = run.player;
    var type = G.data.sectors.types[run.sector.type] || { rewardMult: 1 };
    var res = c.result;
    var rw = { result: res, scrap: 0, fuel: 0, missiles: 0, weapon: null, crew: null,
               text: REWARD_TEXT[res] || '', fx: [] };
    // (G.Combat.create already folds rules.reward.eliteMult into c.rewardMult for elite fights)
    // An accepted surrender pays exactly what the offer dialog showed (G.Combat.answerOffer stores it).
    var taken = res === 'surrender' && c.flags ? c.flags.offerTaken : null;
    if (taken) {
      rw.scrap = Math.max(0, Math.round(taken.scrap || 0));
      rw.fuel = Math.max(0, Math.round(taken.fuel || 0));
      rw.missiles = Math.max(0, Math.round(taken.missiles || 0));
    } else {
      var scrap = G.RNG.roll(rng, RW.scrapBase) * (1 + RW.scrapPerSector * run.sectorIndex) *
        (type.rewardMult || 1) * (c.rewardMult == null ? 1 : c.rewardMult) * diffOf(run).scrapMult *
        (res === 'derelict' ? RW.derelictMult : 1) * (res === 'surrender' ? RW.surrenderMult : 1) *
        (G.U.hasAug(run, 'scrap_arm') ? R.augmentFx.scrapMult : 1);
      rw.scrap = Math.round(scrap);
      if (G.RNG.chance(rng, RW.fuelChance)) rw.fuel = G.RNG.roll(rng, RW.fuel);
      if (G.RNG.chance(rng, RW.missileChance)) rw.missiles = G.RNG.roll(rng, RW.missiles);
      if (G.RNG.chance(rng, RW.weaponChance)) rw.weapon = G.Events.randomWeapon(run, 0);
      if (G.RNG.chance(rng, RW.crewChance) && p.crew.length < R.maxCrew) rw.crew = G.Events.randomRace(run);
    }
    // apply now
    run.res.scrap += rw.scrap;
    run.res.fuel += rw.fuel;
    run.res.missiles += rw.missiles;
    run.stats.scrapEarned += rw.scrap;
    if (rw.scrap) rw.fx.push({ key: 'scrap', amount: rw.scrap, label: '+' + rw.scrap + ' 废料', good: true });
    if (rw.fuel) rw.fx.push({ key: 'fuel', amount: rw.fuel, label: '+' + rw.fuel + ' 燃料', good: true });
    if (rw.missiles) rw.fx.push({ key: 'missiles', amount: rw.missiles, label: '+' + rw.missiles + ' 导弹', good: true });
    if (rw.weapon) {
      var g = G.Events.giveWeapon(run, rw.weapon), wn = G.data.weapons[rw.weapon].name;
      rw.weaponWhere = g.where;
      if (g.where === 'scrap') {
        run.stats.scrapEarned += g.scrap;
        rw.text += ' 货舱已满，已拆解。';
        rw.fx.push({ key: 'weapon', amount: 0, label: wn + ' → +' + g.scrap + ' 废料', good: true });
      } else {
        rw.fx.push({ key: 'weapon', amount: 1, label: '获得武器 ' + wn, good: true });
      }
    }
    if (rw.crew) {
      var cm = G.Events.addCrew(run, rw.crew);
      if (cm) {
        rw.crew = { name: cm.name, race: cm.race };
        rw.fx.push({ key: 'crew', amount: 1, label: '新船员 ' + cm.name, good: true });
      } else rw.crew = null;
    }
    return rw;
  }

  function finishCombat(run) {
    var c = run.combat, p = run.player;
    if (!c) return;
    p.weapons.forEach(function (w) { w.charge = 0; w.target = null; });
    p.ftl = 0;
    run.combat = null;
    var res = c.result;
    // combatEnd was already emitted by G.Combat when c.result was set (step / answerOffer).

    if (res === 'lose') {
      gameover(run, p.hull <= 0 ? 'hull' : 'crew');
      return;
    }
    if ((res === 'win' || res === 'derelict') && c.boss) {
      run.stats.kills++;
      run.flags.flagshipDown = true;
      run.after = null;
      run.mode = 'victory';
      run.end = { win: true, reason: 'flagship', text: text('endTexts', 'flagship', END_TEXT.flagship) };
      return;
    }
    if (res === 'win' || res === 'derelict' || res === 'surrender') {
      run.stats.kills++;
      if (res === 'derelict') run.stats.derelicts++;
      if (res === 'surrender') run.stats.surrenders++;
      run.reward = rollReward(run, c);
      run.mode = 'reward';
      return;
    }
    run.after = null;
    run.mode = 'hub';
    if (res === 'enemyFled') G.U.fx(run, { t: 'msg', text: '敌舰跃迁逃走了', kind: 'warn' });
  }

  function claimReward(run) {
    if (run.mode !== 'reward') return false;
    run.reward = null;
    var a = run.after;
    run.after = null;
    if (!(a && G.Events.start(run, a.eventId, a.node))) run.mode = 'hub';
    return true;
  }

  // ------------------------------------------------------------------ ship management
  function upgradeCost(run, sysId) {
    var s = run.player.systems[sysId], d = G.data.systems.defs[sysId];
    if (!s || !d || s.level >= d.maxLevel) return null;
    return d.costs[s.level + 1] == null ? null : d.costs[s.level + 1];
  }

  function upgradeSystem(run, sysId) {
    if (locked(run)) return no(LOCK);
    if (!run.player.systems[sysId]) return no('未安装该系统');
    var cost = upgradeCost(run, sysId);
    if (cost == null) return no('已达最高等级');
    if (run.res.scrap < cost) return no('废料不足');
    run.res.scrap -= cost;
    run.player.systems[sysId].level++;
    return ok();
  }

  function reactorCost(run) {
    var R = rules(), r = run.player.reactor;
    if (r >= R.reactorMax) return null;
    return R.reactorCostBase + Math.max(0, r - 8) * R.reactorCostStep;
  }

  function upgradeReactor(run) {
    if (locked(run)) return no(LOCK);
    var cost = reactorCost(run);
    if (cost == null) return no('反应堆已满级');
    if (run.res.scrap < cost) return no('废料不足');
    run.res.scrap -= cost;
    run.player.reactor++;
    return ok();
  }

  function equip(run, cargoIdx) {
    if (locked(run)) return no(LOCK);
    var p = run.player, id = run.cargo[cargoIdx];
    if (!id || !G.data.weapons[id]) return no('货舱里没有这件武器');
    if (p.weapons.length >= p.weaponSlots) return no('武器槽已满');
    run.cargo.splice(cargoIdx, 1);
    p.weapons.push({ uid: G.U.uid(run, 'w'), id: id, on: false, want: false, charge: 0, target: null });
    return ok();
  }

  function unequip(run, slot) {
    if (locked(run)) return no(LOCK);
    var p = run.player, w = p.weapons[slot];
    if (!w) return no('该武器槽是空的');
    if (run.cargo.length >= rules().cargoMax) return no('货舱已满');
    p.weapons.splice(slot, 1);
    run.cargo.push(w.id);
    if (G.Ship && typeof G.Ship.enforcePower === 'function') G.Ship.enforcePower(p);
    return ok();
  }

  function dismissCrew(run, crewId) {
    if (locked(run)) return no(LOCK);
    var crew = run.player.crew, c = G.U.byId(crew, crewId);
    if (!c) return no('没有这名船员');
    if (crew.length <= 1) return no('不能解雇最后一名船员');
    crew.splice(crew.indexOf(c), 1);
    return ok();
  }

  // ------------------------------------------------------------------ sectors
  function isFinalSector(run) { return run.sectorIndex >= G.CFG.SECTORS - 1; }
  function atExit(run) { return !!run.sector && run.at === run.sector.exit; }

  function leaveSector(run) {
    if (locked(run)) return no(LOCK);
    if (run.mode !== 'hub') return no('现在无法离开');
    if (!atExit(run)) return no('需要先抵达星区出口');
    if (isFinalSector(run)) return no('必须击毁叛军旗舰');
    if ((run.res.fuel || 0) < 1) return no('燃料不足');
    jumpEffects(run);
    if (run.sectorIndex < G.CFG.SECTORS - 2) {
      var types = G.RNG.shuffle(run.rng, G.data.sectors.choosable.slice());
      run.sectorChoices = types.slice(0, 2);
      run.mode = 'sectorSelect';
    } else {
      enterSector(run, 'final');
    }
    return ok();
  }

  function enterSector(run, typeId) {
    run.sectorChoices = null;
    run.sectorIndex++;
    run.sector = G.Map.generate(run, run.sectorIndex, typeId);
    run.at = run.sector.start;
    arrive(run);
  }

  function chooseSector(run, idx) {
    if (run.mode !== 'sectorSelect' || !run.sectorChoices) return no('现在无法选择星区');
    var typeId = run.sectorChoices[idx];
    if (!typeId) return no('无效的星区');
    enterSector(run, typeId);
    return ok();
  }

  function isStranded(run) { return run.mode === 'hub' && (run.res.fuel || 0) <= 0; }

  function wait(run) {
    if (!isStranded(run)) return no('现在不需要等待');
    G.Map.advanceFleet(run, rules().waitFleetAdvance);
    if (G.Map.isOvertaken(run.sector, beacon(run))) {
      if (!startTag(run, 'combat_elite')) startCombat(run, { faction: 'rebel', elite: true });
    } else if (!startTag(run, 'stranded')) {
      run.res.fuel += 1;   // no content: a passing trader always leaves a little fuel
      G.U.fx(run, { t: 'msg', text: '一艘路过的商船留给你们 1 单位燃料。', kind: 'good' });
    }
    return ok();
  }

  G.Run = {
    create: create,
    step: step,
    fx: function (run, ev) { return G.U.fx(run, ev); },
    drainFx: function (run) { return G.U.drainFx(run); },
    hasAug: function (run, id) { return G.U.hasAug(run, id); },
    beacon: beacon,
    hasStore: hasStore,
    canJump: canJump,
    jump: jump,
    arrive: arrive,
    gameover: gameover,
    startCombat: startCombat,
    finishCombat: finishCombat,
    claimReward: claimReward,
    upgradeCost: upgradeCost,
    upgradeSystem: upgradeSystem,
    reactorCost: reactorCost,
    upgradeReactor: upgradeReactor,
    equip: equip,
    unequip: unequip,
    dismissCrew: dismissCrew,
    atExit: atExit,
    isFinalSector: isFinalSector,
    leaveSector: leaveSector,
    chooseSector: chooseSector,
    isStranded: isStranded,
    wait: wait,
  };
})();
