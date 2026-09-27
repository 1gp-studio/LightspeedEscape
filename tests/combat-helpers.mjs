// Shared helpers for sim-combat tests and tests/duel.mjs: minimal run objects without G.Run.
import { loadGame } from './load.mjs';

export function loadSim({ guard = true } = {}) {
  const G = loadGame();
  if (guard) {
    // Sim code must never use Math.random / Date: install throwing guards inside the vm realm.
    G.U.clamp.constructor("Math.random = function () { throw new Error('Math.random in sim'); };" +
      "Date = function () { throw new Error('Date in sim'); }; Date.now = Date;")();
  }
  return G;
}

export function makeRun(G, { shipId = 'falcon', sectorIndex = 0, seed = 1, difficulty = 'normal', faction = 'rebel',
  hazard = 'none', type = 'civilian' } = {}) {
  const run = {
    v: 1, seed, rng: G.RNG.create(seed), nextId: 1, difficulty, shipId, mode: 'combat',
    res: JSON.parse(JSON.stringify(G.data.ships[shipId].res)), cargo: [], augments: [], volley: false,
    sectorIndex,
    sector: { index: sectorIndex, type, beacons: [{ id: 0, row: 1, faction, hazard, kind: 'combat' }] },
    at: 0, event: null, combat: null, reward: null, after: null, sectorChoices: null, end: null,
    flags: {},
    stats: { jumps: 0, beacons: 0, kills: 0, derelicts: 0, surrenders: 0, fled: 0, scrapEarned: 0, crewLost: 0,
      crewHired: 0, time: 0, combatTime: 0 },
  };
  run.player = G.Ship.createPlayer(run, shipId);
  return run;
}

export const DT = 1 / 30;

export function stepN(G, run, seconds, dt = DT) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) G.Combat.step(run, dt);
}
