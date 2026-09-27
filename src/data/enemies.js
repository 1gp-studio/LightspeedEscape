// Enemy generation tables, read by G.Enemies.generate (src/sim/enemies.js).
// `d` = difficulty level = sector index (0..4) (+1 for elite fleet ships), clamped to 0..5.
// Ranges [a, b] are inclusive integers rolled with the run RNG.
(function () {
  'use strict';
  var G = globalThis.G;

  G.data.enemies = {
    factions: {
      rebel: {
        id: 'rebel', name: '叛军',
        hulls: { scout: 3, cruiser: 3, bomber: 2 },
        weapons: ['laser_basic', 'laser_burst1', 'laser_burst2', 'laser_heavy1', 'laser_heavy2',
                  'missile_leto', 'missile_artemis', 'missile_hermes', 'ion_1', 'ion_heavy'],
        crew: { human: 6, engi: 1, rock: 1 },
        names: ['叛军巡逻艇', '叛军拦截舰', '叛军突击艇', '叛军护卫舰', '叛军炮艇'],
        flee: 0.25, surrender: 0.2,
      },
      pirate: {
        id: 'pirate', name: '海盗',
        hulls: { scout: 3, bomber: 3, cruiser: 2 },
        weapons: ['laser_basic', 'laser_burst1', 'laser_heavy1', 'laser_burst2',
                  'ion_1', 'ion_heavy', 'beam_mini', 'beam_halberd', 'beam_fire', 'missile_leto'],
        crew: { human: 3, rock: 2, swift: 2, engi: 1 },
        names: ['海盗掠夺者', '赏金猎手', '走私快船', '海盗炮舰', '劫掠者'],
        flee: 0.35, surrender: 0.3,
      },
      auto: {
        id: 'auto', name: '自动无人舰', crewless: true,
        hulls: { drone: 1 },
        weapons: ['laser_basic', 'laser_burst1', 'laser_heavy1', 'ion_1', 'beam_mini', 'missile_leto'],
        crew: {},
        names: ['自动侦察机', '无人哨舰', '自动猎杀者'],
        flee: 0, surrender: 0,
      },
    },

    // Hull points: hullBase[hull] + hullPerD * d + roll(hullRand) + difficulty.enemyHull
    hullBase: { scout: 9, cruiser: 12, bomber: 11, drone: 8 },
    hullPerD: 3,
    hullRand: [0, 2],

    // Index by d (0..5). Power values; shield layers = floor(power / 2).
    shieldsByD:  [[2, 2], [2, 2], [2, 4], [4, 4], [4, 4], [4, 6]],
    enginesByD:  [[1, 2], [1, 2], [2, 3], [2, 3], [3, 4], [3, 5]],
    weaponBudgetByD: [2, 3, 6, 7, 8, 8],   // total weapon power (difficulty.enemyPower is added, min 1)
    maxTierByD: [1, 1, 2, 3, 3, 3],
    maxWeapons: 3,
    maxMissileWeapons: 1,
    minDByWeapon: { missile_artemis: 0, missile_hermes: 3, beam_halberd: 2, ion_heavy: 1 },
    missilesByD: [3, 4, 5, 6, 8, 10],      // enemy missile stock; at 0 the AI unpowers missile weapons
    maxShieldPower: 6,                      // clamp (3 layers), elites included
    pilotingByD: [1, 1, 1, 2, 2, 2],
    oxygenLevel: 1,
    medbayByD: [1, 1, 1, 1, 2, 2],         // only if the hull has a medbay room
    crewByHull: { scout: [2, 2], cruiser: [3, 4], bomber: [2, 3], drone: [0, 0] },

    elite: { dBonus: 1, shieldsBonus: 2, name: '叛军精英舰' },   // elite fights always use hazard 'fleet'

    flagship: {
      hull: 'flagship', name: '叛军旗舰', faction: 'rebel',
      hullMax: 28,
      systems: { shields: 4, engines: 3, weapons: 5, oxygen: 2, medbay: 2, piloting: 2 },
      weapons: ['laser_burst2', 'laser_basic', 'ion_1', 'missile_artemis'],   // 2+1+1+1 = 5 power
      missiles: 12,
      crew: ['human', 'human', 'human', 'human', 'engi', 'rock'],
      volley: true,
      phase2: {
        at: 0.5,                // hull fraction that triggers phase 2 (once)
        repairAll: true,        // all flagship systems, fires and breaches restored
        chargeMult: 1.2,        // weapons charge 20% faster
        surgeInterval: 30,      // seconds between power surges
        surgeWarn: 5,           // warning seconds before each surge
        surgeShots: 2,          // laser shots per surge (dmg 1, burstGap 0.15)
        text: '旗舰进入全功率模式！所有系统修复，火力大幅提升！',
        warnText: '旗舰能量涌动！',
      },
    },

    // Target weights used by the enemy AI when picking a room on the player ship.
    targetWeights: { weapons: 3, shields: 3, piloting: 2, engines: 2, oxygen: 1, medbay: 1, none: 0.5 },
  };
})();
