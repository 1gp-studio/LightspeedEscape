// Sector map generation, fleet advance / eta, map queries (G.Map) and store generation (G.Store.create).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './load.mjs';
import { installRandomGuard } from './meta-fixture.mjs';

const G = loadGame();
installRandomGuard(G);
const R = G.data.rules;

function fakeRun(seed, sectorIndex = 0, difficulty = 'normal') {
  return { rng: G.RNG.create(seed), difficulty, sectorIndex, augments: [], flags: {}, nextId: 1 };
}

function checkSector(s, typeId, sectorIndex) {
  const T = G.data.sectors.types[typeId];
  const final = typeId === 'final';
  const rows = final ? R.finalRows : R.sectorRows;
  assert.equal(s.rows, rows);
  assert.equal(s.type, typeId);
  assert.equal(s.index, sectorIndex);
  assert.equal(s.fleet, R.fleetStart);
  assert.ok(G.data.sectors.names[typeId].includes(s.name));
  s.beacons.forEach((b, i) => assert.equal(b.id, i));
  const byRow = [];
  for (let r = 0; r < rows; r++) byRow.push(s.beacons.filter((b) => b.row === r));

  // start / exit
  assert.equal(byRow[0].length, 1);
  assert.equal(byRow[0][0].id, s.start);
  assert.equal(byRow[0][0].kind, 'start');
  assert.equal(byRow[0][0].x, 0.5);
  assert.equal(byRow[0][0].faction, null);
  assert.equal(byRow[rows - 1].length, 1);
  const exit = byRow[rows - 1][0];
  assert.equal(exit.id, s.exit);
  assert.equal(exit.x, 0.5);
  assert.ok(exit.exit);
  assert.equal(s.beacons.filter((b) => b.exit).length, 1);
  if (final) { assert.equal(exit.kind, 'boss'); assert.equal(exit.faction, 'rebel'); }
  else assert.notEqual(exit.kind, 'boss');

  // middle rows
  for (let r = 1; r < rows - 1; r++) {
    const row = byRow[r];
    if (final && r === rows - 2) {
      assert.equal(row.length, 1, 'final store row has one beacon');
      assert.equal(row[0].kind, 'store');
      assert.equal(row[0].x, 0.5);
      const st = row[0].store;
      assert.ok(st && Array.isArray(st.items), 'final store is pre-stocked');
      const it = (k) => st.items.find((x) => x.key === k);
      assert.ok(it('repair'));
      assert.ok(it('fuel').stock >= 4);
      assert.ok(it('missiles').stock >= 4);
      continue;
    }
    assert.ok(row.length >= 2 && row.length <= 3, `row ${r} has ${row.length}`);
    const xs = row.map((b) => b.x).sort((a, b) => a - b);
    xs.forEach((x) => assert.ok(x >= 0.12 - 1e-9 && x <= 0.88 + 1e-9, `x ${x}`));
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 0.22 - 1e-3, `spacing ${xs}`);
    row.forEach((b) => assert.ok(Object.keys(T.kinds).concat(['store']).includes(b.kind), b.kind));
  }

  // kinds / factions / hazards
  s.beacons.forEach((b) => {
    assert.equal(b.visited, false);
    if (b.kind !== 'start') assert.ok(Object.keys(T.factions).includes(b.faction), `faction ${b.faction}`);
    if (b.kind !== 'combat') assert.equal(b.hazard, 'none');
    else assert.ok(Object.keys(T.hazards).includes(b.hazard));
    if (!(final && b.kind === 'store')) assert.equal(b.store, null);
  });
  if (!final) {
    assert.ok(s.beacons.some((b) => b.kind === 'store' && b.row > 0 && !b.exit), 'store guarantee');
    assert.ok(!s.beacons.some((b) => b.kind === 'boss'));
  }

  // edges: undirected, unique, adjacent or same rows only
  const keys = new Set();
  s.edges.forEach(([a, b]) => {
    assert.ok(a < b, 'edges stored low-high');
    const k = a + '-' + b;
    assert.ok(!keys.has(k), 'duplicate edge');
    keys.add(k);
    assert.ok(Math.abs(s.beacons[a].row - s.beacons[b].row) <= 1);
  });
  for (let r = 0; r < rows - 1; r++) {
    byRow[r].forEach((b) => assert.ok(G.Map.neighbors(s, b.id).some((n) => s.beacons[n].row === r + 1), 'forward link'));
    byRow[r + 1].forEach((b) => assert.ok(G.Map.neighbors(s, b.id).some((n) => s.beacons[n].row === r), 'backward link'));
  }
  if (final) {
    const store = byRow[rows - 2][0];
    byRow[rows - 3].forEach((b) => assert.ok(G.Map.neighbors(s, b.id).includes(store.id), 'row 2 -> store'));
    assert.deepEqual([...G.Map.neighbors(s, exit.id)], [store.id]);
  }
  // connected + undirected neighbours symmetric
  const seen = new Set([s.start]);
  const q = [s.start];
  while (q.length) {
    const a = q.shift();
    for (const n of G.Map.neighbors(s, a)) {
      assert.ok(G.Map.neighbors(s, n).includes(a), 'symmetric');
      if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  assert.equal(seen.size, s.beacons.length, 'connected');
  assert.equal(G.Map.jumpsLeft(s, s.start), rows - 1);
  assert.equal(G.Map.jumpsLeft(s, s.exit), 0);
}

test('map generation over 300 seeds: rows, edges, connectivity, store guarantee, final layout', () => {
  const plan = [[0, 'civilian'], [1, 'hostile'], [2, 'pirate'], [3, 'nebula'], [4, 'final']];
  let crossings = 0, edgesTotal = 0;
  for (let seed = 1; seed <= 300; seed++) {
    for (const [si, type] of plan) {
      const run = fakeRun(seed * 7919 + si, si);
      const s = G.Map.generate(run, si, type);
      checkSector(s, type, si);
      // JSON-safe
      assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s));
      // count crossing edges between adjacent rows (cosmetic; should be rare)
      const vert = s.edges.filter(([a, b]) => s.beacons[a].row !== s.beacons[b].row);
      edgesTotal += vert.length;
      for (let i = 0; i < vert.length; i++)
        for (let j = i + 1; j < vert.length; j++) {
          const [a1, b1] = vert[i], [a2, b2] = vert[j];
          if (s.beacons[a1].row !== s.beacons[a2].row) continue;
          if (a1 === a2 || b1 === b2) continue;
          if ((s.beacons[a1].x - s.beacons[a2].x) * (s.beacons[b1].x - s.beacons[b2].x) < 0) crossings++;
        }
    }
  }
  assert.ok(crossings / edgesTotal < 0.02, `crossing edges ${crossings}/${edgesTotal}`);
});

test('map generation is deterministic per seed', () => {
  const a = G.Map.generate(fakeRun(42), 0, 'civilian');
  const b = G.Map.generate(fakeRun(42), 0, 'civilian');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('fleet advance, eta and overtaken agree', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    for (const type of ['civilian', 'hostile', 'pirate', 'nebula', 'final']) {
      const run = fakeRun(5, 1, diff);
      run.sector = G.Map.generate(run, 1, type);
      run.at = run.sector.start;
      const speed = G.data.sectors.types[type].fleetSpeed * R.difficulty[diff].fleetMult;
      const s = run.sector;
      for (const b of s.beacons) {
        const eta = G.Map.fleetEta(run, b.id);
        assert.equal(eta, Math.max(0, Math.ceil((b.row - s.fleet) / speed - 1e-6)));
      }
      // simulate: a beacon with eta N is overtaken after exactly N advances
      const exit = s.beacons[s.exit];
      const eta0 = G.Map.fleetEta(run, exit.id);
      assert.ok(eta0 > 0);
      for (let k = 1; k <= eta0; k++) {
        assert.equal(G.Map.isOvertaken(s, exit), false, `${type}/${diff} early`);
        const before = G.Map.fleetEta(run, exit.id);
        G.Map.advanceFleet(run, 1);
        assert.equal(G.Map.fleetEta(run, exit.id), before - 1);
      }
      assert.equal(G.Map.isOvertaken(s, exit), true);
      assert.equal(G.Map.fleetEta(run, exit.id), 0);
      // default beacon is the current one (start row 0)
      assert.equal(G.Map.fleetEta(run), 0);
      assert.equal(G.Map.isOvertaken(s, s.start), true);
    }
  }
  // wait multiplier
  const run = fakeRun(9);
  run.sector = G.Map.generate(run, 0, 'civilian');
  const f0 = run.sector.fleet;
  G.Map.advanceFleet(run, 0.5);
  assert.ok(Math.abs(run.sector.fleet - (f0 + 0.5 * 0.75)) < 1e-9);
});

test('iconsHidden only in nebula; beacon()/neighbors()', () => {
  const run = fakeRun(3);
  run.sector = G.Map.generate(run, 1, 'nebula');
  assert.equal(G.Map.iconsHidden(run), true);
  run.sector = G.Map.generate(run, 1, 'pirate');
  assert.equal(G.Map.iconsHidden(run), false);
  assert.equal(G.Map.beacon(run.sector, 0).kind, 'start');
  assert.equal(G.Map.beacon(run.sector, 999), null);
});

test('store stock: prices, stock ranges, tiers, distinct weapons, augment not owned', () => {
  let augSeen = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const si = seed % 5;
    const run = fakeRun(seed, si);
    run.augments = ['scrap_arm', 'pre_igniter'];
    const st = G.Store.create(run);
    const by = (t) => st.items.filter((x) => x.type === t);
    assert.equal(by('fuel').length, 1);
    assert.equal(by('missiles').length, 1);
    assert.equal(by('repair').length, 1);
    assert.equal(by('fuel')[0].price, R.fuelPrice);
    assert.equal(by('missiles')[0].price, R.missilePrice);
    assert.equal(by('repair')[0].price, R.hullRepairPrice[si]);
    for (const t of ['fuel', 'missiles']) assert.ok(by(t)[0].stock >= 4 && by(t)[0].stock <= 8);
    const ws = by('weapon');
    assert.equal(ws.length, 3);
    assert.equal(new Set(ws.map((w) => w.id)).size, 3);
    ws.forEach((w) => {
      assert.ok(G.data.weapons[w.id].tier <= G.data.enemies.maxTierByD[si]);
      assert.equal(w.price, G.data.weapons[w.id].cost);
    });
    const cs = by('crew');
    assert.ok(cs.length >= 1 && cs.length <= 2);
    cs.forEach((c) => assert.equal(c.price, R.crewPrice[c.id]));
    const as = by('augment');
    assert.ok(as.length <= 1);
    if (as.length) { augSeen++; assert.ok(!run.augments.includes(as[0].id)); }
    assert.equal(new Set(st.items.map((x) => x.key)).size, st.items.length, 'unique keys');
  }
  assert.ok(augSeen > 80 && augSeen < 160, `augment ~60%: ${augSeen}/200`);
});
