// Ship layouts. Grid units; the nose is at y = 0 (top). The renderer draws the player ship nose-up
// and enemy ships flipped vertically (nose-down, facing the player).
// Rooms: { x, y, w, h, sys } where sys is a system id or null (empty room). Room index = room id.
// Two rooms are connected (walkable, oxygen flows) when they share an edge (G.U.rectsTouch).
// Every room must be >= 2 tiles so it is tappable on a phone.
(function () {
  'use strict';
  var G = globalThis.G;

  // ---------------- player ships ----------------
  G.data.ships = {
    falcon: {
      id: 'falcon', name: '游隼号', player: true,
      desc: '联邦标准巡洋舰。连发激光配合穿甲导弹，攻守均衡，适合第一次出航。',
      w: 6, h: 8,
      rooms: [
        { x: 2, y: 0, w: 2, h: 1, sys: 'piloting' }, // 0
        { x: 2, y: 1, w: 2, h: 1, sys: null },       // 1 corridor
        { x: 0, y: 2, w: 2, h: 2, sys: 'weapons' },  // 2
        { x: 2, y: 2, w: 2, h: 2, sys: 'shields' },  // 3
        { x: 4, y: 2, w: 2, h: 2, sys: 'medbay' },   // 4
        { x: 0, y: 4, w: 2, h: 2, sys: 'oxygen' },   // 5
        { x: 2, y: 4, w: 2, h: 2, sys: null },       // 6
        { x: 4, y: 4, w: 2, h: 2, sys: null },       // 7
        { x: 2, y: 6, w: 2, h: 2, sys: 'engines' },  // 8
      ],
      hullMax: 28, reactor: 8, weaponSlots: 4,
      systems: { shields: 2, engines: 2, weapons: 3, oxygen: 1, medbay: 1, piloting: 1 },
      weapons: ['laser_burst2', 'missile_artemis'],
      crew: [
        { race: 'human', room: 0 },
        { race: 'human', room: 8 },
        { race: 'human', room: 2 },
      ],
      res: { scrap: 20, fuel: 16, missiles: 10 },
      tint: '#8ea6cf',
    },
    thunder: {
      id: 'thunder', name: '雷鸣号', player: true,
      desc: '改装过的科研船。离子炮先打掉护盾，重刃光束随后横扫三个舱室。船员混编，驾驶舱带自动驾驶。',
      w: 6, h: 7,
      rooms: [
        { x: 2, y: 0, w: 2, h: 1, sys: 'piloting' }, // 0
        { x: 0, y: 1, w: 2, h: 2, sys: 'shields' },  // 1
        { x: 2, y: 1, w: 2, h: 2, sys: 'weapons' },  // 2
        { x: 4, y: 1, w: 2, h: 2, sys: 'engines' },  // 3
        { x: 0, y: 3, w: 2, h: 2, sys: 'oxygen' },   // 4
        { x: 2, y: 3, w: 2, h: 2, sys: null },       // 5
        { x: 4, y: 3, w: 2, h: 2, sys: 'medbay' },   // 6
        { x: 1, y: 5, w: 2, h: 2, sys: null },       // 7
        { x: 3, y: 5, w: 2, h: 2, sys: null },       // 8
      ],
      hullMax: 28, reactor: 10, weaponSlots: 3,
      systems: { shields: 2, engines: 2, weapons: 4, oxygen: 1, medbay: 1, piloting: 2 },
      weapons: ['ion_1', 'beam_halberd'],
      crew: [
        { race: 'human', room: 0 },
        { race: 'engi', room: 2 },
        { race: 'rock', room: 3 },
      ],
      res: { scrap: 20, fuel: 16, missiles: 4 },
      tint: '#a39bcf',
    },
  };
  G.data.shipOrder = ['falcon', 'thunder'];

  // ---------------- enemy hull layouts ----------------
  // System levels, weapons and crew for enemies are rolled by G.Enemies.generate from G.data.enemies.
  G.data.hulls = {
    scout: {
      id: 'scout', w: 4, h: 5,
      rooms: [
        { x: 1, y: 0, w: 2, h: 1, sys: 'piloting' },
        { x: 0, y: 1, w: 2, h: 2, sys: 'weapons' },
        { x: 2, y: 1, w: 2, h: 2, sys: 'shields' },
        { x: 0, y: 3, w: 2, h: 2, sys: 'engines' },
        { x: 2, y: 3, w: 2, h: 1, sys: 'oxygen' },
        { x: 2, y: 4, w: 2, h: 1, sys: null },
      ],
      tint: '#b07a7a',
    },
    cruiser: {
      id: 'cruiser', w: 6, h: 6,
      rooms: [
        { x: 2, y: 0, w: 2, h: 1, sys: 'piloting' },
        { x: 0, y: 1, w: 2, h: 2, sys: 'weapons' },
        { x: 2, y: 1, w: 2, h: 2, sys: null },
        { x: 4, y: 1, w: 2, h: 2, sys: 'shields' },
        { x: 0, y: 3, w: 2, h: 2, sys: 'oxygen' },
        { x: 2, y: 3, w: 2, h: 2, sys: 'medbay' },
        { x: 4, y: 3, w: 2, h: 2, sys: 'engines' },
        { x: 2, y: 5, w: 2, h: 1, sys: null },
      ],
      tint: '#a77f86',
    },
    bomber: {
      id: 'bomber', w: 6, h: 5,
      rooms: [
        { x: 2, y: 0, w: 2, h: 1, sys: 'piloting' },
        { x: 0, y: 1, w: 2, h: 2, sys: 'shields' },
        { x: 2, y: 1, w: 2, h: 2, sys: 'weapons' },
        { x: 4, y: 1, w: 2, h: 2, sys: 'engines' },
        { x: 1, y: 3, w: 2, h: 2, sys: 'oxygen' },
        { x: 3, y: 3, w: 2, h: 2, sys: null },
      ],
      tint: '#9c8a6e',
    },
    drone: {
      id: 'drone', w: 4, h: 5, crewless: true,
      rooms: [
        { x: 0, y: 0, w: 2, h: 2, sys: 'shields' },
        { x: 2, y: 0, w: 2, h: 2, sys: 'weapons' },
        { x: 0, y: 2, w: 2, h: 2, sys: 'engines' },
        { x: 2, y: 2, w: 2, h: 2, sys: 'piloting' },
        { x: 1, y: 4, w: 2, h: 1, sys: null },
      ],
      tint: '#7f9aa3',
    },
    flagship: {
      id: 'flagship', w: 8, h: 7,
      rooms: [
        { x: 3, y: 0, w: 2, h: 1, sys: 'piloting' },
        { x: 1, y: 1, w: 2, h: 2, sys: null },
        { x: 3, y: 1, w: 2, h: 2, sys: 'shields' },
        { x: 5, y: 1, w: 2, h: 2, sys: 'weapons' },
        { x: 0, y: 3, w: 2, h: 2, sys: null },
        { x: 2, y: 3, w: 2, h: 2, sys: 'oxygen' },
        { x: 4, y: 3, w: 2, h: 2, sys: 'medbay' },
        { x: 6, y: 3, w: 2, h: 2, sys: null },
        { x: 2, y: 5, w: 2, h: 2, sys: 'engines' },
        { x: 4, y: 5, w: 2, h: 2, sys: null },
      ],
      tint: '#b0606a',
    },
  };
})();
