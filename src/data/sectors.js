// Sector types. kinds = beacon content weights; factions = hostile ship faction weights.
(function () {
  'use strict';
  var G = globalThis.G;

  G.data.sectors = {
    types: {
      civilian: {
        id: 'civilian', name: '平民星区', color: '#1d5566', accent: '#58c7d6',
        fleetSpeed: 0.75, rewardMult: 1.0,
        kinds: { event: 44, combat: 26, store: 10, empty: 12, distress: 8 },
        factions: { rebel: 3, pirate: 5, auto: 2 },
        hazards: { none: 85, asteroid: 10, sun: 5 },
        desc: '贸易航线密集，商店和求救信号更多，战斗较少。',
      },
      hostile: {
        id: 'hostile', name: '叛军控制区', color: '#5a1d2a', accent: '#ff6b6b',
        fleetSpeed: 0.9, rewardMult: 1.15,
        kinds: { event: 28, combat: 50, store: 8, empty: 8, distress: 6 },
        factions: { rebel: 7, auto: 3 },
        hazards: { none: 80, asteroid: 10, sun: 10 },
        desc: '叛军重兵把守。战斗频繁，战利品也更丰厚。',
      },
      pirate: {
        id: 'pirate', name: '海盗星区', color: '#5a4318', accent: '#f5b942',
        fleetSpeed: 0.8, rewardMult: 1.05,
        kinds: { event: 32, combat: 42, store: 12, empty: 8, distress: 6 },
        factions: { pirate: 8, rebel: 2 },
        hazards: { none: 80, asteroid: 15, sun: 5 },
        desc: '无法无天的边境。海盗装备五花八门，黑市也不少。',
      },
      nebula: {
        id: 'nebula', name: '星云', color: '#3d1f5c', accent: '#b98cff',
        fleetSpeed: 0.6, rewardMult: 0.9, hidesIcons: true,
        kinds: { event: 40, combat: 30, store: 8, empty: 16, distress: 6 },
        factions: { pirate: 4, rebel: 4, auto: 2 },
        hazards: { none: 100 },
        desc: '浓密的星云拖慢了叛军舰队的追击，但扫描失灵，看不到商店和求救信号。',
      },
      final: {
        id: 'final', name: '联邦基地外围', color: '#4a1420', accent: '#ff4d5e',
        fleetSpeed: 0.8, rewardMult: 1.2,
        kinds: { event: 30, combat: 70 },   // plus a fixed store at row 3 (see SPEC §6 Map)
        factions: { rebel: 10 },
        hazards: { none: 90, asteroid: 10 },
        desc: '叛军旗舰就在前方。击毁它，把情报交给联邦。',
      },
    },
    // Types offered when choosing the next sector (index 1..3). Sector 0 is always civilian,
    // sector 4 is always final.
    choosable: ['civilian', 'hostile', 'pirate', 'nebula'],
    names: {
      civilian: ['天鹅座自由港', '织女商路', '白石殖民带', '晨星农业区', '暖流贸易站'],
      hostile: ['赤潮防线', '铁幕要塞群', '叛军第七补给线', '灰烬哨站', '猎户座封锁区'],
      pirate: ['黑帆星域', '碎骨小行星带', '无主边境', '锈钉集市', '暗礁星团'],
      nebula: ['紫雾星云', '寂静之海', '翡翠尘埃', '幽蓝漩涡', '回声云团'],
      final: ['联邦基地外围'],
    },
  };
})();
