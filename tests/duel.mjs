// Balance probe (script, not a test): each starting ship vs 100 seeded sector-0 and sector-1 enemies
// (mixed factions) with a simple player policy:
//   all weapons target the enemy shields room, volley on, crew stay at stations, re-target when a missile
//   weapon clears its target, surrender offers are declined. Step until combat.result or 300 s.
//   node tests/duel.mjs [--n 100] [--dt 0.0333] [--novolley]
import { loadSim, makeRun } from './combat-helpers.mjs';

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const N = argv('--n', 100);
const DT = argv('--dt', 1 / 30);
const MAX_T = 300;
const VOLLEY = args.indexOf('--novolley') < 0;
const FACTIONS = ['rebel', 'pirate', 'auto'];

const G = loadSim();

function duel(shipId, sectorIndex, seed) {
  const faction = FACTIONS[seed % FACTIONS.length];
  const run = makeRun(G, { shipId, sectorIndex, seed: 1000 * (sectorIndex + 1) + seed, faction, hazard: 'none' });
  run.volley = VOLLEY;
  const c = G.Combat.create(run, { faction });
  const p = run.player, e = c.enemy;
  const tgt = e.systems.shields ? e.systems.shields.room : 0;
  const hull0 = p.hull, m0 = run.res.missiles;
  let steps = 0, stepMs = 0;
  while (!c.result && c.time < MAX_T) {
    if (c.offer) G.Combat.answerOffer(run, false);
    for (let i = 0; i < p.weapons.length; i++) if (p.weapons[i].target === null) G.Combat.setTarget(run, i, tgt);
    const t0 = process.hrtime.bigint();
    G.Combat.step(run, DT);
    stepMs += Number(process.hrtime.bigint() - t0) / 1e6;
    steps++;
    G.Combat.drainFx(run);
  }
  return {
    result: c.result || 'timeout', faction, hullLost: hull0 - p.hull, time: c.time,
    missiles: m0 - run.res.missiles, stepMs: stepMs / Math.max(1, steps),
    enemy: `${e.templateId}:${e.weapons.map((w) => w.id).join('+')}`,
  };
}

const rows = [];
for (const shipId of G.data.shipOrder) {
  for (const sectorIndex of [0, 1]) {
    const res = [];
    for (let s = 0; s < N; s++) res.push(duel(shipId, sectorIndex, s));
    const count = (k) => res.filter((r) => r.result === k).length;
    const avg = (f) => res.reduce((a, r) => a + f(r), 0) / res.length;
    const wins = count('win') + count('derelict') + count('surrender');
    const byFaction = FACTIONS.map((f) => {
      const fr = res.filter((r) => r.faction === f);
      const w = fr.filter((r) => r.result === 'win' || r.result === 'derelict').length;
      return `${f} ${Math.round((100 * w) / Math.max(1, fr.length))}%`;
    }).join(', ');
    const worst = res.slice().sort((a, b) => b.hullLost - a.hullLost)[0];
    rows.push({
      ship: shipId, sector: sectorIndex,
      'win%': Math.round((100 * wins) / res.length),
      lose: count('lose'), fled: count('enemyFled'), timeout: count('timeout'),
      'hullLost avg': +avg((r) => r.hullLost).toFixed(1),
      'secs avg': +avg((r) => r.time).toFixed(1),
      'missiles avg': +avg((r) => r.missiles).toFixed(2),
      'step ms': +avg((r) => r.stepMs).toFixed(4),
      byFaction,
      worst: `${worst.hullLost} (${worst.faction} ${worst.enemy})`,
    });
  }
}
console.log(`volley ${VOLLEY ? 'on' : 'off'}, ${N} enemies per ship/sector, dt ${DT.toFixed(4)}`);
console.table(rows);
