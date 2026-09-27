// Weapon definitions.
//   type: 'laser' | 'ion' | 'missile' | 'beam'
//   power: weapon-system bars needed      charge: seconds to charge
//   shots: projectiles per volley (beam: always 1 sweep)
//   dmg: hull damage per projectile / per beam room      ion: ion damage (ion weapons)
//   sysDmg: system damage per hit (default = dmg)          crewDmg: crew damage per hit (default = dmg * rules.crewDmgPerDmg)
//   fire / breach: chance 0..1 per hit room              missile: missiles consumed per volley
//   beamLen: rooms swept by a beam                         tier: 1..3 (store / reward availability)
//   cost: store price (sell = cost * rules.sellMult)
(function () {
  'use strict';
  var G = globalThis.G;

  var W = {
    laser_basic: {
      name: '基础激光', short: '激光', type: 'laser', power: 1, charge: 10, shots: 1, dmg: 1,
      fire: 0, breach: 0, cost: 25, tier: 1,
      desc: '便宜可靠的单发激光。会被护盾挡下。',
    },
    laser_burst1: {
      name: '连发激光 I', short: '连发I', type: 'laser', power: 2, charge: 11, shots: 2, dmg: 1,
      fire: 0, breach: 0, cost: 45, tier: 1,
      desc: '一次射出 2 发激光，用来消耗敌方护盾。',
    },
    laser_burst2: {
      name: '连发激光 II', short: '连发II', type: 'laser', power: 2, charge: 12, shots: 3, dmg: 1,
      fire: 0, breach: 0, cost: 70, tier: 2,
      desc: '一次射出 3 发激光。性价比极高的主力武器。',
    },
    laser_heavy1: {
      name: '重型激光 I', short: '重激I', type: 'laser', power: 1, charge: 9, shots: 1, dmg: 2,
      fire: 0.1, breach: 0.2, cost: 45, tier: 1,
      desc: '单发 2 点伤害，有几率造成火灾和破口。',
    },
    laser_heavy2: {
      name: '重型激光 II', short: '重激II', type: 'laser', power: 3, charge: 13, shots: 2, dmg: 2,
      fire: 0.15, breach: 0.25, cost: 80, tier: 3,
      desc: '两发重型激光，每发 2 点伤害。',
    },
    ion_1: {
      name: '离子炮', short: '离子', type: 'ion', power: 1, charge: 7, shots: 1, dmg: 0, ion: 1,
      fire: 0, breach: 0, cost: 30, tier: 1,
      desc: '打掉 1 层护盾并让目标系统短暂瘫痪。不造成船体伤害。',
    },
    ion_heavy: {
      name: '重型离子炮', short: '重离子', type: 'ion', power: 2, charge: 12, shots: 1, dmg: 0, ion: 2,
      fire: 0, breach: 0, cost: 40, tier: 2,
      desc: '2 点离子伤害：打掉 1 层护盾，并锁住护盾系统 2 格能量。',
    },
    ion_rapid: {
      name: '离子速射炮', short: '速离', type: 'ion', power: 3, charge: 5.5, shots: 1, dmg: 0, ion: 1,
      fire: 0, breach: 0, cost: 65, tier: 3,
      desc: '充能极快的离子炮，能让敌方护盾一直处于瘫痪状态。',
    },
    missile_leto: {
      name: '轻型导弹', short: '轻导', type: 'missile', power: 1, charge: 9, shots: 1, dmg: 1,
      fire: 0, breach: 0, missile: 1, cost: 30, tier: 1,
      desc: '无视护盾。每次发射消耗 1 枚导弹。',
    },
    missile_artemis: {
      name: '穿甲导弹', short: '穿甲', type: 'missile', power: 1, charge: 11, shots: 1, dmg: 2,
      fire: 0.1, breach: 0.2, missile: 1, cost: 50, tier: 1,
      desc: '无视护盾，2 点伤害。常用来打掉敌方护盾系统。',
    },
    missile_hermes: {
      name: '重型导弹', short: '重导', type: 'missile', power: 3, charge: 14, shots: 1, dmg: 3,
      fire: 0.3, breach: 0.5, missile: 1, cost: 65, tier: 2,
      desc: '无视护盾，3 点伤害，极易造成火灾和破口。',
    },
    beam_mini: {
      name: '小型光束', short: '光束', type: 'beam', power: 1, charge: 12, shots: 1, dmg: 1, beamLen: 2,
      fire: 0, breach: 0, cost: 25, tier: 1,
      desc: '横扫 2 个舱室。每层护盾让伤害 -1，从不落空。',
    },
    beam_halberd: {
      name: '重刃光束', short: '重刃', type: 'beam', power: 3, charge: 17, shots: 1, dmg: 2, beamLen: 3,
      fire: 0, breach: 0, cost: 60, tier: 2,
      desc: '横扫 3 个舱室，每个舱室 2 点伤害（每层护盾 -1）。',
    },
    beam_fire: {
      name: '燃烧光束', short: '燃烧', type: 'beam', power: 2, charge: 20, shots: 1, dmg: 0, beamLen: 3,
      fire: 1, breach: 0, crewDmg: 15, sysDmg: 0, cost: 40, tier: 2,
      desc: '不伤船体，但会点燃扫过的舱室。被护盾完全挡住时无效。',
    },
  };

  // Normalize: id + defaults.
  Object.keys(W).forEach(function (id) {
    var w = W[id];
    w.id = id;
    if (w.shots == null) w.shots = 1;
    if (w.ion == null) w.ion = 0;
    if (w.missile == null) w.missile = 0;
    if (w.sysDmg == null) w.sysDmg = w.dmg;
    if (w.crewDmg == null) w.crewDmg = w.dmg * G.data.rules.crewDmgPerDmg;
    if (w.beamLen == null) w.beamLen = 0;
  });

  G.data.weapons = W;
})();
