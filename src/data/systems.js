// Ship systems. `costs[L]` = scrap to upgrade TO level L.
(function () {
  'use strict';
  var G = globalThis.G;

  G.data.systems = {
    // Display / iteration order in the HUD.
    order: ['shields', 'engines', 'weapons', 'oxygen', 'medbay', 'piloting'],
    // Systems drawing reactor power individually. Weapons draw reactor power through powered weapons.
    reactorOrder: ['shields', 'engines', 'oxygen', 'medbay'],
    defs: {
      shields: {
        id: 'shields', name: '护盾', short: '盾', maxLevel: 8, reactor: true, station: true,
        costs: { 2: 20, 3: 35, 4: 50, 5: 70, 6: 90, 7: 115, 8: 140 },
        desc: '每 2 格能量撑起 1 层护盾。护盾能挡下激光和离子，但挡不住导弹。有人操作时充能更快。',
      },
      engines: {
        id: 'engines', name: '引擎', short: '引', maxLevel: 8, reactor: true, station: true,
        costs: { 2: 15, 3: 25, 4: 35, 5: 50, 6: 65, 7: 80, 8: 100 },
        desc: '提高闪避率和跃迁充能速度。有人操作时闪避 +5%。',
      },
      weapons: {
        // Weapons draw reactor power through individually powered weapons (see SPEC §5 Power).
        id: 'weapons', name: '武器', short: '武', maxLevel: 8, reactor: false, viaWeapons: true, station: true,
        costs: { 2: 20, 3: 30, 4: 40, 5: 55, 6: 70, 7: 90, 8: 110 },
        desc: '武器系统的等级决定最多能同时给多少格武器供能。有人操作时充能快 10%。',
      },
      oxygen: {
        id: 'oxygen', name: '氧气', short: '氧', maxLevel: 3, reactor: true, station: false,
        costs: { 2: 25, 3: 45 },
        desc: '为所有舱室补充氧气。等级越高，补氧越快。',
      },
      medbay: {
        id: 'medbay', name: '医疗舱', short: '医', maxLevel: 3, reactor: true, station: false,
        costs: { 2: 30, 3: 50 },
        desc: '持续治疗医疗舱内的船员。等级越高，治疗越快。',
      },
      piloting: {
        id: 'piloting', name: '驾驶舱', short: '驾', maxLevel: 3, reactor: false, station: true,
        costs: { 2: 20, 3: 45 },
        desc: '1 级必须有人驾驶才能闪避和跃迁。2 级起有自动驾驶（无人时闪避 ×50%/×80%）。不占反应堆能量。',
      },
    },
  };
})();
