// Content validation for src/data/events.js and src/data/text.js (SPEC §8, §9 tips, reason codes).
// Every check collects all problems first so one run lists every broken event.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadGame, ROOT } from './load.mjs';

const G = loadGame({ layers: ['core', 'data'] });
const EVENTS = G.data.events;
const TEXT = G.data.text;

const RACES = Object.keys(G.data.crew.races);
const SYS = Object.keys(G.data.systems.defs);
const WEAPONS = G.data.weapons;
const AUGS = G.data.rules.augments;
const WEAPON_TYPES = ['laser', 'ion', 'missile', 'beam'];
const FACTIONS = ['rebel', 'pirate', 'auto', 'sector'];

// Pool minimum counts (SPEC §8) and the sectors each pool is drawn from (for once-event coverage).
const POOLS = {
  start_intro: 1, start: 3, any: 6, civilian: 5, hostile: 5, pirate: 5, nebula: 5, final: 5,
  distress: 6, store: 2, empty: 3, combat_rebel: 3, combat_pirate: 3, combat_auto: 3,
  combat_elite: 2, boss: 1, stranded: 3,
};
const POOL_RANGE = {
  start_intro: [0, 0], start: [1, 4], any: [0, 4], civilian: [0, 3], hostile: [1, 3], pirate: [1, 3],
  nebula: [1, 3], final: [4, 4], distress: [0, 4], store: [0, 4], empty: [0, 4], combat_rebel: [0, 4],
  combat_pirate: [0, 4], combat_auto: [0, 4], combat_elite: [0, 4], boss: [4, 4], stranded: [0, 4],
};

const len = (s) => [...s].length;
const isInt = (v) => Number.isInteger(v);
const nonZeroAmount = (v) =>
  (isInt(v) && v !== 0) ||
  (Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] <= v[1] && v[0] !== 0 &&
    Math.sign(v[0]) === Math.sign(v[1]));
const lo = (v) => (Array.isArray(v) ? v[0] : v);
const hi = (v) => (Array.isArray(v) ? v[1] : v);

// fx key -> value validator (SPEC §8)
const FX = {
  scrap: nonZeroAmount,
  fuel: nonZeroAmount,
  missiles: nonZeroAmount,
  hull: nonZeroAmount,
  crew: (v) => v === 'random' || RACES.includes(v),
  loseCrew: (v) => v === 1,
  crewDamage: (v) => isInt(v) && v > 0,
  weapon: (v) => ['random', 'tier1', 'tier2', 'tier3'].includes(v) || !!WEAPONS[v],
  augment: (v) => v === 'random' || !!AUGS[v],
  upgrade: (v) => v === 'random' || SYS.includes(v),
  sysDamage: (v) => v === 'random' || SYS.includes(v),
  reactor: (v) => v === 1,
  fleet: (v) => typeof v === 'number' && Number.isFinite(v) && v !== 0,
};
// Reward-size guard rails (the engine scales positive scrap by sector on top of these).
const FX_RANGE = {
  scrap: (v) => (lo(v) > 0 ? lo(v) >= 8 && hi(v) <= 35 : lo(v) >= -40),
  fuel: (v) => Math.abs(lo(v)) >= 1 && Math.abs(hi(v)) <= 4,
  missiles: (v) => Math.abs(lo(v)) >= 1 && Math.abs(hi(v)) <= 3,
  hull: (v) => Math.abs(lo(v)) >= 2 && Math.abs(hi(v)) <= 6,
  crewDamage: (v) => v >= 10 && v <= 40,
  fleet: (v) => Math.abs(v) <= 1.5,
};

const BLUE_REQ = {
  race: (v) => RACES.includes(v),
  weaponType: (v) => WEAPON_TYPES.includes(v),
  weapon: (v) => !!WEAPONS[v],
  system: (v) =>
    !!v && typeof v === 'object' && Object.keys(v).every((k) => k === 'id' || k === 'level') &&
    SYS.includes(v.id) && isInt(v.level) && v.level >= 2 && v.level <= G.data.systems.defs[v.id].maxLevel,
  crewCount: (v) => isInt(v) && v >= 2 && v <= G.data.rules.maxCrew,
  augment: (v) => !!AUGS[v],
};
const COST_REQ = ['scrap', 'fuel', 'missiles'];
const OUTCOME_KEYS = ['w', 'text', 'fx', 'goto', 'combat', 'store'];
const COMBAT_KEYS = ['faction', 'elite', 'boss', 'rewardMult', 'win'];

// ---------------------------------------------------------------- walkers
function* eachNode(ev) {
  for (const [nid, node] of Object.entries(ev.nodes || {})) yield [nid, node];
}
function* eachChoice(ev) {
  for (const [nid, node] of eachNode(ev)) for (const [ci, c] of (node.choices || []).entries()) yield [nid, ci, c];
}
function* eachOutcome(ev) {
  for (const [nid, ci, c] of eachChoice(ev)) for (const [oi, o] of (c.outcomes || []).entries()) yield [nid, ci, c, oi, o];
}
const fxEntries = (o) => (o.fx || []).map((e) => [Object.keys(e)[0], e[Object.keys(e)[0]]]);
const tagged = (tag) => EVENTS.filter((e) => e.tags.includes(tag));
const winNodes = (ev) => new Set([...eachOutcome(ev)].map((x) => x[4].combat && x[4].combat.win).filter(Boolean));
const where = (ev, nid, ci, oi) => `${ev.id}.${nid}` + (ci != null ? `#${ci}` : '') + (oi != null ? `/${oi}` : '');

function expectNoProblems(problems) {
  assert.equal(problems.length, 0, '\n  ' + problems.join('\n  '));
}

// ---------------------------------------------------------------- structure
test('events: array of unique, well-formed events', () => {
  const p = [];
  assert.ok(Array.isArray(EVENTS) && EVENTS.length > 0, 'G.data.events must be a non-empty array');
  const ids = new Set();
  for (const ev of EVENTS) {
    if (typeof ev.id !== 'string' || !ev.id) p.push('event without id');
    if (ids.has(ev.id)) p.push(`duplicate id ${ev.id}`);
    ids.add(ev.id);
    if (!Array.isArray(ev.tags) || !ev.tags.length) p.push(`${ev.id}: tags must be a non-empty array`);
    else for (const t of ev.tags) if (!(t in POOLS)) p.push(`${ev.id}: unknown tag ${t}`);
    if (!(typeof ev.weight === 'number' && ev.weight > 0)) p.push(`${ev.id}: weight must be > 0`);
    if (!(isInt(ev.minSector) && isInt(ev.maxSector) && ev.minSector >= 0 && ev.maxSector <= 4 && ev.minSector <= ev.maxSector))
      p.push(`${ev.id}: bad sector range ${ev.minSector}..${ev.maxSector}`);
    if (typeof ev.once !== 'boolean') p.push(`${ev.id}: once must be boolean`);
    if (!ev.nodes || !ev.nodes.start) p.push(`${ev.id}: missing start node`);
  }
  // plain JSON: no functions / undefined / shared cycles
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(EVENTS))), JSON.stringify(EVENTS));
  expectNoProblems(p);
});

test('events: roughly 60 events', () => {
  assert.ok(EVENTS.length >= 55 && EVENTS.length <= 80, `have ${EVENTS.length}`);
});

test('events: nodes, choices and outcomes follow the schema', () => {
  const p = [];
  for (const ev of EVENTS) {
    for (const [nid, node] of eachNode(ev)) {
      if (typeof node.text !== 'string') p.push(`${where(ev, nid)}: node text missing`);
      if (!Array.isArray(node.choices) || node.choices.length < 1 || node.choices.length > 5)
        p.push(`${where(ev, nid)}: needs 1..5 choices`);
      else if (!node.choices.some((c) => !c.req)) p.push(`${where(ev, nid)}: needs at least one choice without req`);
    }
    for (const [nid, ci, c] of eachChoice(ev)) {
      if (typeof c.text !== 'string' || !c.text) p.push(`${where(ev, nid, ci)}: choice text missing`);
      if (!Array.isArray(c.outcomes) || !c.outcomes.length) p.push(`${where(ev, nid, ci)}: no outcomes`);
      else if (!c.outcomes.some((o) => o.w > 0)) p.push(`${where(ev, nid, ci)}: no outcome with w > 0`);
    }
    for (const [nid, ci, , oi, o] of eachOutcome(ev)) {
      const at = where(ev, nid, ci, oi);
      for (const k of Object.keys(o)) if (!OUTCOME_KEYS.includes(k)) p.push(`${at}: unknown outcome key ${k}`);
      if (!(typeof o.w === 'number' && Number.isFinite(o.w) && o.w > 0)) p.push(`${at}: w must be > 0`);
      if (typeof o.text !== 'string') p.push(`${at}: outcome text must be a string`);
      const exits = ['goto', 'combat', 'store'].filter((k) => o[k] != null);
      if (exits.length > 1) p.push(`${at}: at most one of goto/combat/store (${exits})`);
      if (o.goto != null && !(typeof o.goto === 'string' && ev.nodes[o.goto])) p.push(`${at}: goto ${o.goto} does not exist`);
      if (o.goto === nid) p.push(`${at}: goto loops to its own node`);
      if (o.store != null && o.store !== true) p.push(`${at}: store must be true`);
      if (o.fx != null && !Array.isArray(o.fx)) p.push(`${at}: fx must be an array`);
    }
  }
  expectNoProblems(p);
});

test('events: fx keys and values are known and well-typed', () => {
  const p = [];
  for (const ev of EVENTS) {
    for (const [nid, ci, , oi, o] of eachOutcome(ev)) {
      const at = where(ev, nid, ci, oi);
      for (const e of o.fx || []) {
        const keys = Object.keys(e);
        if (keys.length !== 1) { p.push(`${at}: each fx entry needs exactly one key, got ${keys}`); continue; }
        const [k] = keys;
        const v = e[k];
        if (!FX[k]) { p.push(`${at}: unknown fx key ${k}`); continue; }
        if (!FX[k](v)) { p.push(`${at}: bad fx value ${k}=${JSON.stringify(v)}`); continue; }
        if (FX_RANGE[k] && !FX_RANGE[k](v)) p.push(`${at}: fx ${k}=${JSON.stringify(v)} outside the reward-size guard rails`);
      }
    }
  }
  expectNoProblems(p);
});

test('events: req keys and values are known; cost gates pay in every outcome', () => {
  const p = [];
  for (const ev of EVENTS) {
    for (const [nid, ci, c] of eachChoice(ev)) {
      if (c.req == null) continue;
      const at = where(ev, nid, ci);
      const keys = Object.keys(c.req);
      if (!keys.length) p.push(`${at}: empty req`);
      const blue = keys.filter((k) => BLUE_REQ[k]);
      const cost = keys.filter((k) => COST_REQ.includes(k));
      for (const k of keys) if (!BLUE_REQ[k] && !COST_REQ.includes(k)) p.push(`${at}: unknown req key ${k}`);
      if (blue.length && cost.length) p.push(`${at}: a choice is either blue or cost-gated, not both`);
      for (const k of blue) if (!BLUE_REQ[k](c.req[k])) p.push(`${at}: bad req ${k}=${JSON.stringify(c.req[k])}`);
      for (const k of cost) {
        const n = c.req[k];
        if (!(isInt(n) && n > 0)) { p.push(`${at}: cost gate ${k} must be a positive integer`); continue; }
        for (const [oi, o] of c.outcomes.entries()) {
          if (!fxEntries(o).some(([fk, fv]) => fk === k && fv === -n))
            p.push(`${at}/${oi}: cost gate ${k} ${n} but the outcome does not pay ${k}: -${n}`);
        }
      }
      // blue options must be clearly worth taking: no gamble, no losses
      if (blue.length) {
        if (c.outcomes.length !== 1) p.push(`${at}: blue choice should have exactly one (sure) outcome`);
        for (const o of c.outcomes) {
          if (o.combat) p.push(`${at}: blue choice leads to combat`);
          for (const [fk, fv] of fxEntries(o)) {
            const bad = ['loseCrew', 'crewDamage', 'sysDamage'].includes(fk) ||
              (['scrap', 'fuel', 'missiles', 'hull'].includes(fk) && lo(fv) < 0) || (fk === 'fleet' && fv > 0);
            if (bad) p.push(`${at}: blue choice has a penalty ${fk}=${JSON.stringify(fv)}`);
          }
        }
      }
    }
  }
  expectNoProblems(p);
});

test('events: combat specs are valid and win nodes exist', () => {
  const p = [];
  for (const ev of EVENTS) {
    const wins = winNodes(ev);
    for (const [nid, ci, , oi, o] of eachOutcome(ev)) {
      if (o.combat == null) continue;
      const at = where(ev, nid, ci, oi);
      const c = o.combat;
      if (typeof c !== 'object') { p.push(`${at}: combat must be an object`); continue; }
      for (const k of Object.keys(c)) if (!COMBAT_KEYS.includes(k)) p.push(`${at}: unknown combat key ${k}`);
      if (!FACTIONS.includes(c.faction)) p.push(`${at}: combat faction ${c.faction}`);
      if (c.elite != null && c.elite !== true) p.push(`${at}: elite must be true when present`);
      if (c.boss != null && c.boss !== true) p.push(`${at}: boss must be true when present`);
      if (c.rewardMult != null && !(typeof c.rewardMult === 'number' && c.rewardMult > 0 && c.rewardMult <= 2))
        p.push(`${at}: rewardMult must be in (0, 2]`);
      if (c.win != null && !(typeof c.win === 'string' && ev.nodes[c.win] && c.win !== 'start'))
        p.push(`${at}: combat.win ${c.win} does not exist`);
      if (c.boss && c.win) p.push(`${at}: the flagship fight ends the run; no win node`);
    }
    // a node reached after a won fight never chains straight into another fight
    for (const w of wins) {
      for (const c of ev.nodes[w] ? ev.nodes[w].choices : [])
        for (const o of c.outcomes) if (o.combat) p.push(`${ev.id}.${w}: win node leads to another combat`);
    }
  }
  expectNoProblems(p);
});

test('events: every node is reachable from start', () => {
  const p = [];
  for (const ev of EVENTS) {
    const seen = new Set(['start']);
    const queue = ['start'];
    while (queue.length) {
      const nid = queue.shift();
      const node = ev.nodes[nid];
      if (!node) continue;
      for (const c of node.choices || [])
        for (const o of c.outcomes || []) {
          for (const next of [o.goto, o.combat && o.combat.win]) {
            if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
          }
        }
    }
    for (const nid of Object.keys(ev.nodes)) if (!seen.has(nid)) p.push(`${ev.id}.${nid}: unreachable`);
  }
  expectNoProblems(p);
});

// ---------------------------------------------------------------- pools
test('events: pool minimum counts', () => {
  const p = [];
  for (const [tag, min] of Object.entries(POOLS)) {
    const n = tagged(tag).length;
    if (n < min) p.push(`pool ${tag}: ${n} < ${min}`);
  }
  assert.equal(tagged('start_intro').length, 1, 'exactly one start_intro');
  assert.equal(tagged('boss').length, 1, 'exactly one boss event');
  // the run starts these by id as well as by tag
  assert.ok(EVENTS.some((e) => e.id === 'start_intro' && e.tags.includes('start_intro')));
  assert.ok(EVENTS.some((e) => e.id === 'boss' && e.tags.includes('boss')));
  expectNoProblems(p);
});

test('events: every pool has a repeatable event for every sector it is drawn in', () => {
  const p = [];
  for (const [tag, [a, b]] of Object.entries(POOL_RANGE)) {
    for (let s = a; s <= b; s++) {
      const ok = tagged(tag).some((e) => !e.once && e.minSector <= s && s <= e.maxSector);
      if (!ok) p.push(`pool ${tag}: no non-once event for sector ${s}`);
    }
  }
  expectNoProblems(p);
});

test('events: combat_rebel / combat_pirate / combat_auto lead to combat with their own faction', () => {
  const p = [];
  for (const f of ['rebel', 'pirate', 'auto']) {
    for (const ev of tagged('combat_' + f)) {
      const combats = [...eachOutcome(ev)].filter((x) => x[4].combat);
      if (!combats.length) p.push(`${ev.id}: combat_${f} event never leads to combat`);
      for (const [nid, ci, , oi, o] of combats) {
        const at = where(ev, nid, ci, oi);
        if (o.combat.faction !== f && o.combat.faction !== 'sector') p.push(`${at}: faction ${o.combat.faction} in combat_${f}`);
        if (o.combat.elite || o.combat.boss) p.push(`${at}: combat_${f} must not start elite/boss fights`);
      }
      // the plain (no req) path of the start node must be able to reach a fight
      const plain = ev.nodes.start.choices.filter((c) => !c.req);
      if (!plain.some((c) => c.outcomes.some((o) => o.combat || o.goto)))
        p.push(`${ev.id}: no unconditional choice can lead to the fight`);
    }
  }
  expectNoProblems(p);
});

test('events: combat_elite and boss have no way out', () => {
  const p = [];
  for (const ev of tagged('combat_elite')) {
    for (const [nid, ci, c, oi, o] of eachOutcome(ev)) {
      const at = where(ev, nid, ci, oi);
      if (c.req) p.push(`${at}: elite events offer no gated/blue choices`);
      if (o.goto) continue;
      if (!o.combat) { p.push(`${at}: combat_elite outcome must start a fight`); continue; }
      if (o.combat.elite !== true) p.push(`${at}: combat_elite fight needs elite:true`);
      if (o.combat.boss) p.push(`${at}: combat_elite is not the boss`);
      if (o.combat.faction !== 'rebel' && o.combat.faction !== 'sector') p.push(`${at}: elite ships are rebels`);
    }
  }
  for (const ev of tagged('boss')) {
    if (!(ev.minSector <= 4 && ev.maxSector === 4)) p.push(`${ev.id}: boss must be available in sector 4`);
    for (const [nid, ci, c, oi, o] of eachOutcome(ev)) {
      const at = where(ev, nid, ci, oi);
      if (c.req) p.push(`${at}: boss event offers no gated/blue choices`);
      if (o.fx && o.fx.length) p.push(`${at}: boss event has fx`);
      if (o.goto) continue;
      if (!(o.combat && o.combat.boss === true)) p.push(`${at}: boss event must only lead to the boss fight`);
      else if (o.combat.elite) p.push(`${at}: boss fight is not elite`);
    }
  }
  expectNoProblems(p);
});

test('events: store events always open the store; stranded events never cost fuel', () => {
  const p = [];
  for (const ev of tagged('store')) {
    for (const [nid, ci, , oi, o] of eachOutcome(ev)) {
      if (o.goto) continue;
      if (o.store !== true) p.push(`${where(ev, nid, ci, oi)}: store event outcome must open the store`);
    }
  }
  for (const ev of tagged('stranded')) {
    let givesFuel = false;
    for (const [nid, ci, c, oi, o] of eachOutcome(ev)) {
      const at = where(ev, nid, ci, oi);
      if (c.req && c.req.fuel != null) p.push(`${at}: stranded event gates on fuel`);
      for (const [k, v] of fxEntries(o)) {
        if (k === 'fuel' && lo(v) < 0) p.push(`${at}: stranded event costs fuel`);
        if (k === 'fuel' && lo(v) > 0) givesFuel = true;
      }
    }
    if (!givesFuel) p.push(`${ev.id}: stranded event never gives fuel`);
  }
  for (const ev of tagged('start_intro')) {
    for (const [nid, ci, , oi, o] of eachOutcome(ev)) if (o.combat) p.push(`${where(ev, nid, ci, oi)}: intro starts a fight`);
  }
  expectNoProblems(p);
});

test('events: blue options cover every race, weapon type, several systems and an augment', () => {
  const blue = { race: new Set(), weaponType: new Set(), weapon: new Set(), system: new Set(), augment: new Set(), crewCount: new Set() };
  for (const ev of EVENTS)
    for (const [, , c] of eachChoice(ev)) {
      if (!c.req) continue;
      for (const k of Object.keys(blue)) if (c.req[k] != null) blue[k].add(k === 'system' ? c.req.system.id : c.req[k]);
    }
  for (const r of RACES) assert.ok(blue.race.has(r), `no blue option for race ${r}`);
  for (const t of WEAPON_TYPES) assert.ok(blue.weaponType.has(t), `no blue option for weapon type ${t}`);
  assert.ok(blue.system.size >= 3, `blue options for only ${blue.system.size} systems`);
  assert.ok(blue.augment.size >= 1, 'no blue option for an augment');
  assert.ok(blue.weapon.size >= 1, 'no blue option for a specific weapon');
});

test('events: text lengths fit a phone', () => {
  const p = [];
  for (const ev of EVENTS) {
    for (const [nid, node] of eachNode(ev)) {
      const n = len(node.text || '');
      if (n < 40 || n > 140) p.push(`${where(ev, nid)}: node text ${n} chars (40–140)`);
    }
    for (const [nid, ci, c] of eachChoice(ev)) {
      const n = len(c.text || '');
      if (n < 1 || n > 22) p.push(`${where(ev, nid, ci)}: choice text ${n} chars (<= 22)`);
    }
    for (const [nid, ci, , oi, o] of eachOutcome(ev)) {
      const at = where(ev, nid, ci, oi);
      if (o.text === '') {
        if ((o.fx && o.fx.length) || o.goto || o.combat || o.store) p.push(`${at}: empty text is only for a plain close`);
        continue;
      }
      const n = len(o.text);
      if (n < 20 || n > 120) p.push(`${at}: outcome text ${n} chars (20–120)`);
    }
  }
  expectNoProblems(p);
});

test('content is original: no FTL names', () => {
  // Only player-visible strings (ids such as the foundation's race id 'engi' are not shown).
  const banned = /kestrel|engi|zoltan|mantis|rockm[ae]n|slug|lanius|crystal|螳螂|佐尔坦|蛞蝓|小鹰号|红隼号|水晶族|兰尼乌斯/i;
  const strings = [];
  for (const ev of EVENTS) {
    for (const [, node] of eachNode(ev)) strings.push(node.text);
    for (const [, , c] of eachChoice(ev)) strings.push(c.text);
    for (const [, , , , o] of eachOutcome(ev)) strings.push(o.text);
  }
  (function collect(v) {
    if (typeof v === 'string') strings.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  })(TEXT);
  const hits = strings.filter((s) => banned.test(s));
  assert.equal(hits.length, 0, `banned names in: ${hits.join(' | ')}`);
  // Latin letters never appear in Chinese content text (weapon marks like "II" live in weapons.js).
  const latin = strings.filter((s) => /[A-Za-z]/.test(s));
  assert.equal(latin.length, 0, `Latin text in: ${latin.join(' | ')}`);
});

test('content sources stay ES2017 and pure', () => {
  for (const rel of ['src/data/events.js', 'src/data/text.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/\?\.|\?\?/.test(src), `${rel}: optional chaining / nullish coalescing`);
    assert.ok(!/Math\.random|\bwindow\b|\bdocument\b|\bDate\b|localStorage/.test(src), `${rel}: impure API`);
    assert.ok(/^\/\/ /.test(src) && src.includes("'use strict'"), `${rel}: header comment + IIFE with use strict`);
  }
});

// ---------------------------------------------------------------- text.js
test('text: help pages', () => {
  assert.ok(Array.isArray(TEXT.help) && TEXT.help.length >= 8 && TEXT.help.length <= 10, 'help needs 8–10 sections');
  for (const h of TEXT.help) {
    assert.ok(typeof h.title === 'string' && len(h.title) >= 1 && len(h.title) <= 8, `help title ${h.title}`);
    assert.ok(typeof h.body === 'string' && len(h.body) >= 30 && len(h.body) <= 200, `help body of ${h.title}: ${len(h.body)}`);
  }
});

test('text: every coach tip exists and fits the bubble', () => {
  const ids = ['t_pause', 't_arm', 't_target', 't_power', 't_crew', 't_shield', 't_ftl', 't_o2', 't_map'];
  for (const id of ids) {
    const t = TEXT.tips && TEXT.tips[id];
    assert.ok(typeof t === 'string' && t.length > 0, `tip ${id} missing`);
    assert.ok(len(t) <= 40, `tip ${id} is ${len(t)} chars (<= 40)`);
  }
});

test('text: every reason code has Chinese text', () => {
  const codes = [
    // powerBlock
    'noSystem', 'max', 'broken', 'ion', 'reactor', 'fixed',
    // toggleBlock
    'capacity',
    // weaponState.why
    'charging', 'off', 'noTarget', 'noMissiles', 'volley', 'noCombat',
    // misc
    'combat', 'fuel', 'scrap', 'cargoFull', 'crewFull', 'lastCrew', 'maxLevel', 'notAdjacent', 'finalSector',
    'augmentFull', 'soldOut',
  ];
  for (const c of codes) {
    const r = TEXT.reasons && TEXT.reasons[c];
    assert.ok(typeof r === 'string' && r.length > 0 && len(r) <= 20, `reason ${c}`);
  }
  assert.equal(TEXT.reasons.combat, '战斗中无法操作');
  assert.equal(TEXT.reasons.finalSector, '必须击毁叛军旗舰');
});

test('text: display names, end texts and sector flavor', () => {
  for (const k of ['start', 'event', 'combat', 'store', 'empty', 'distress', 'boss'])
    assert.ok(TEXT.kindNames[k], `kindNames.${k}`);
  for (const [id, f] of Object.entries(G.data.enemies.factions)) assert.equal(TEXT.factionNames[id], f.name, `factionNames.${id}`);
  for (const k of ['none', 'asteroid', 'sun', 'fleet']) assert.ok(TEXT.hazardNames[k], `hazardNames.${k}`);
  assert.equal(TEXT.hazardNames.fleet, '舰队炮击');
  for (const k of ['win', 'derelict', 'surrender', 'enemyFled', 'lose']) assert.ok(TEXT.resultNames[k], `resultNames.${k}`);
  for (const k of ['hull', 'crew', 'flagship']) {
    const t = TEXT.endTexts[k];
    assert.ok(typeof t === 'string', `endTexts.${k}`);
    const sentences = t.split(/[。！？]/).filter((s) => s.trim()).length;
    assert.ok(sentences >= 2 && sentences <= 3, `endTexts.${k} has ${sentences} sentences`);
  }
  for (const id of Object.keys(G.data.sectors.types)) {
    const s = TEXT.sectorFlavor[id];
    assert.ok(typeof s === 'string' && len(s) >= 6 && len(s) <= 30, `sectorFlavor.${id}`);
  }
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(TEXT))), JSON.stringify(TEXT));
});

// ---------------------------------------------------------------- through the real engine
// Drives every choice of every node through G.Events / G.Run (skipped while the sim layer is a stub).
const GS = (() => { try { return loadGame(); } catch (e) { return null; } })();
const SIM = !!(GS && GS.Events && typeof GS.Events.choose === 'function' && GS.Run && typeof GS.Run.create === 'function');
const SEEDS = 8;
const AUG_REQS = [...new Set(EVENTS.flatMap((ev) => [...eachChoice(ev)].map((x) => x[2].req && x[2].req.augment).filter(Boolean)))];

function maxedRun(seed) {
  const run = GS.Run.create({ seed, shipId: 'falcon', difficulty: 'normal' });
  const p = run.player;
  for (const r of RACES) GS.Events.addCrew(run, r);
  const ids = ['laser_burst2', 'ion_1', 'missile_artemis', 'beam_fire'];
  p.weaponSlots = Math.max(p.weaponSlots, ids.length);
  p.weapons = ids.map((id) => ({ uid: GS.U.uid(run, 'w'), id, on: false, want: false, charge: 0, target: null }));
  for (const [id, s] of Object.entries(p.systems)) s.level = GS.data.systems.defs[id].maxLevel;
  run.augments = AUG_REQS.slice(0, GS.data.rules.augmentMax);
  run.res.scrap = 500;
  run.res.fuel = 20;
  run.res.missiles = 20;
  return run;
}

function checkSane(run, at) {
  assert.ok(run.player.hull >= 1, `${at}: hull ${run.player.hull}`);
  assert.ok(run.player.crew.length >= 1, `${at}: no crew left`);
  for (const c of run.player.crew) assert.ok(c.hp >= 1, `${at}: crew hp ${c.hp}`);
  for (const k of ['scrap', 'fuel', 'missiles']) assert.ok(run.res[k] >= 0, `${at}: ${k} ${run.res[k]}`);
  assert.ok(GS.U.stringify(run).length > 0);
}

test('engine: every choice of every node plays through G.Events', { skip: !SIM && 'sim layer not implemented' }, () => {
  assert.ok(AUG_REQS.length <= GS.data.rules.augmentMax, 'blue augment reqs must fit in one ship for this test');
  let plays = 0;
  for (const ev of GS.data.events) {
    for (const [nid, node] of Object.entries(ev.nodes)) {
      node.choices.forEach((choice, ci) => {
        for (let s = 1; s <= SEEDS; s++) {
          const at = `${ev.id}.${nid}#${ci} seed ${s}`;
          const run = maxedRun(1000 * s + 17 * ci + ev.id.length);
          run.sectorIndex = ev.minSector;
          assert.ok(GS.Events.start(run, ev.id, nid), `${at}: start`);
          const vis = GS.Events.choices(run);
          assert.equal(vis.length, node.choices.length, `${at}: a maxed ship sees every choice`);
          const v = vis.find((x) => x.idx === ci);
          assert.ok(v && v.enabled, `${at}: choice enabled`);
          assert.equal(v.blue, !!(choice.req && Object.keys(choice.req).some((k) => BLUE_REQ[k])), `${at}: blue flag`);
          const res = GS.Events.choose(run, ci);
          assert.ok(res, `${at}: choose returned a result`);
          const o = choice.outcomes.find((x) => x.text === res.text);
          assert.ok(o, `${at}: result text comes from an outcome`);
          if (run.event && run.event.result) GS.Events.cont(run);
          if (o.goto) {
            assert.equal(run.mode, 'event', at);
            assert.equal(run.event.node, o.goto, at);
          } else if (o.combat) {
            assert.equal(run.mode, 'combat', at);
            assert.equal(!!run.combat.boss, !!o.combat.boss, `${at}: boss flag`);
            assert.equal(!!run.combat.elite, !!o.combat.elite, `${at}: elite flag`);
            if (o.combat.faction !== 'sector') assert.equal(run.combat.faction, o.combat.faction, `${at}: faction`);
            if (o.combat.win) {
              assert.equal(JSON.stringify(run.after), JSON.stringify({ eventId: ev.id, node: o.combat.win }), `${at}: after`);
              // win the fight and claim the reward -> the event resumes at the win node
              run.combat.result = 'win';
              GS.Run.finishCombat(run);
              assert.equal(run.mode, 'reward', `${at}: reward after win`);
              GS.Run.claimReward(run);
              assert.equal(run.mode, 'event', `${at}: resumes the event`);
              assert.equal(run.event.id + '.' + run.event.node, ev.id + '.' + o.combat.win, `${at}: win node`);
            }
          } else if (o.store) {
            assert.equal(run.mode, 'hub', at);
            assert.ok(GS.Run.hasStore(run), `${at}: store opened`);
          } else {
            assert.equal(run.mode, 'hub', at);
          }
          checkSane(run, at);
          plays++;
        }
      });
    }
  }
  assert.ok(plays > 500, `only ${plays} plays`);
});

test('engine: a crippled ship always has a way through and event fx never kill', { skip: !SIM && 'sim layer not implemented' }, () => {
  for (const ev of GS.data.events) {
    for (const [nid, node] of Object.entries(ev.nodes)) {
      for (let s = 1; s <= SEEDS; s++) {
        const run = GS.Run.create({ seed: 50 + s * 31 + ev.id.length, shipId: 'falcon', difficulty: 'hard' });
        const p = run.player;
        p.crew = p.crew.slice(0, 1);
        p.crew[0].hp = 1;
        p.hull = 1;
        run.res = { scrap: 0, fuel: 0, missiles: 0 };
        run.sectorIndex = ev.maxSector;
        GS.Events.start(run, ev.id, nid);
        const vis = GS.Events.choices(run).filter((c) => c.enabled && c.idx < node.choices.length);
        assert.ok(vis.length >= 1, `${ev.id}.${nid}: no real choice for a broke, one-crew ship`);
        const pickC = vis[s % vis.length];
        GS.Events.choose(run, pickC.idx);
        if (run.event && run.event.result) GS.Events.cont(run);
        checkSane(run, `${ev.id}.${nid}#${pickC.idx} crippled seed ${s}`);
      }
    }
  }
});
