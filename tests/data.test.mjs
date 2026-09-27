// Data integrity: layouts, systems, weapons, enemy tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './load.mjs';

const G = loadGame({ layers: ['core', 'data'], allowMissing: true });
const SYS = Object.keys(G.data.systems.defs);

function checkLayout(name, L, { crewless = false } = {}) {
  const occ = new Map();
  L.rooms.forEach((r, i) => {
    assert.ok(r.w * r.h >= 2, `${name} room ${i} must be >= 2 tiles`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= L.w && r.y + r.h <= L.h, `${name} room ${i} out of grid`);
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = r.y; y < r.y + r.h; y++) {
        const k = `${x},${y}`;
        assert.ok(!occ.has(k), `${name} rooms ${occ.get(k)} and ${i} overlap at ${k}`);
        occ.set(k, i);
      }
    if (r.sys) assert.ok(SYS.includes(r.sys), `${name} room ${i} unknown system ${r.sys}`);
  });
  const sys = L.rooms.map((r) => r.sys).filter(Boolean);
  assert.equal(new Set(sys).size, sys.length, `${name} has duplicate system rooms`);
  for (const need of ['shields', 'engines', 'weapons', 'piloting']) assert.ok(sys.includes(need), `${name} lacks ${need}`);
  if (!crewless) assert.ok(sys.includes('oxygen'), `${name} lacks oxygen`);
  // connectivity
  const n = L.rooms.length;
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    const a = q.shift();
    for (let b = 0; b < n; b++) if (!seen.has(b) && G.U.rectsTouch(L.rooms[a], L.rooms[b])) { seen.add(b); q.push(b); }
  }
  assert.equal(seen.size, n, `${name} rooms are not all connected`);
}

test('player ship layouts are valid', () => {
  for (const id of G.data.shipOrder) {
    const s = G.data.ships[id];
    checkLayout(id, s);
    for (const [sys, lvl] of Object.entries(s.systems)) {
      assert.ok(s.rooms.some((r) => r.sys === sys), `${id} has level for ${sys} but no room`);
      assert.ok(lvl >= 1 && lvl <= G.data.systems.defs[sys].maxLevel);
    }
    for (const r of s.rooms) if (r.sys) assert.ok(s.systems[r.sys] != null, `${id} room ${r.sys} has no level`);
    assert.ok(s.weapons.length <= s.weaponSlots);
    const wpow = s.weapons.reduce((a, w) => a + G.data.weapons[w].power, 0);
    assert.ok(wpow <= s.systems.weapons, `${id} starting weapons need ${wpow} > weapons level`);
    const reactorNeed = s.systems.shields + s.systems.engines + 1 + 1 + wpow;
    assert.ok(reactorNeed <= s.reactor + 2, `${id} reactor ${s.reactor} far below need ${reactorNeed}`);
    for (const c of s.crew) {
      assert.ok(G.data.crew.races[c.race], `${id} crew race ${c.race}`);
      assert.ok(c.room >= 0 && c.room < s.rooms.length);
    }
  }
});

test('enemy hull layouts are valid', () => {
  for (const [id, h] of Object.entries(G.data.hulls)) checkLayout(id, h, { crewless: !!h.crewless });
});

test('weapons are well-formed', () => {
  for (const [id, w] of Object.entries(G.data.weapons)) {
    assert.equal(w.id, id);
    assert.ok(['laser', 'ion', 'missile', 'beam'].includes(w.type), id);
    assert.ok(w.power >= 1 && w.charge > 0 && w.shots >= 1 && w.tier >= 1 && w.tier <= 3 && w.cost > 0, id);
    if (w.type === 'beam') assert.ok(w.beamLen >= 1, id);
    if (w.type === 'missile') assert.ok(w.missile >= 1, id);
    if (w.type === 'ion') assert.ok(w.ion >= 1 && w.dmg === 0, id);
    assert.ok(w.name && w.short && w.desc, id);
  }
});

test('enemy tables reference real things', () => {
  const E = G.data.enemies;
  for (const f of Object.values(E.factions)) {
    for (const h of Object.keys(f.hulls)) assert.ok(G.data.hulls[h], `${f.id} hull ${h}`);
    for (const w of f.weapons) assert.ok(G.data.weapons[w], `${f.id} weapon ${w}`);
    for (const r of Object.keys(f.crew)) assert.ok(G.data.crew.races[r], `${f.id} race ${r}`);
    assert.ok(f.names.length > 0);
  }
  for (const w of E.flagship.weapons) assert.ok(G.data.weapons[w]);
  const fw = E.flagship.weapons.reduce((a, w) => a + G.data.weapons[w].power, 0);
  assert.ok(fw <= E.flagship.systems.weapons, `flagship weapons need ${fw} > weapons level ${E.flagship.systems.weapons}`);
  checkLayout('flagship-template', G.data.hulls[E.flagship.hull]);
  for (const w of Object.keys(E.minDByWeapon)) assert.ok(G.data.weapons[w], `minDByWeapon ${w}`);
  assert.equal(E.missilesByD.length, 6);
  for (const k of ['shieldsByD', 'enginesByD', 'weaponBudgetByD', 'maxTierByD', 'pilotingByD', 'medbayByD'])
    assert.equal(E[k].length, 6, k);
  // each faction can fill the d=0 budget with tier-1 weapons
  for (const f of Object.values(E.factions)) {
    assert.ok(f.weapons.some((w) => G.data.weapons[w].tier === 1 && G.data.weapons[w].power <= E.weaponBudgetByD[0]), f.id);
  }
});

test('sectors are well-formed', () => {
  const S = G.data.sectors;
  for (const [id, t] of Object.entries(S.types)) {
    assert.equal(t.id, id);
    for (const f of Object.keys(t.factions)) assert.ok(G.data.enemies.factions[f], `${id} faction ${f}`);
    assert.ok(S.names[id] && S.names[id].length, `${id} names`);
  }
  for (const c of S.choosable) assert.ok(S.types[c]);
});

test('systems costs cover every upgradable level', () => {
  for (const d of Object.values(G.data.systems.defs))
    for (let l = 2; l <= d.maxLevel; l++) assert.ok(d.costs[l] > 0, `${d.id} L${l}`);
});
