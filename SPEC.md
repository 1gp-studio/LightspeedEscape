# 光速逃亡 — Pocket FTL-like for phones (portrait) · SPEC v2

A lightweight, portrait-only, touch-first homage to *FTL: Faster Than Light*, built as a gift for an FTL fan.
One run ≈ 20–30 minutes: 5 sectors (index 0..4); the last one ends with the rebel flagship.
All UI text is **Simplified Chinese**. All content (names, events, ship names) is **original** — never copy FTL's
text, names (e.g. "Kestrel", "Artemis", "Engi", "Zoltan", "Mantis") or art.

Deliverables:
- `dist/lightspeed.html` — one self-contained file (any phone browser; offline except the Google font).
- `dist/artifact.html` — same page as a claude.ai Artifact fragment (the host adds the html/head/body skeleton).

---------------------------------------------------------------------------------------------------

## 1. Hard constraints

1. **Zero runtime dependencies**, no bundler, no npm install. Each source file is an IIFE attaching to the global
   namespace `G` (`var G = globalThis.G;`). No ES modules.
2. Language level ES2017 (const/let/arrow/template/classes OK). **Never** use `?.`, `??`, or other ES2020+ syntax.
3. Layers and purity:
   - `src/core`, `src/data`, `src/sim` are **pure**: no `window`, `document`, `localStorage`, `requestAnimationFrame`,
     `Math.random`, `Date`. They run in node (`tests/load.mjs` loads them into a `vm` context).
     Exception: `src/sim/save.js` may touch `localStorage`, only inside try/catch and only if it exists.
   - All gameplay randomness uses `G.RNG` with `run.rng`. The whole run (including an in-progress combat) is
     JSON-serializable (`G.U.stringify`, which drops `_`-prefixed keys) and resumable.
   - **Query functions are pure**: anything named `can*`, `*State`, `*Info`, `*Block`, `*Cost`, `preview*`,
     `fleetEta`, `reachable` never calls `G.RNG` and never mutates.
   - `src/ui` + `src/main.js` own DOM/canvas/audio. The UI never changes rules directly; it calls sim functions.
4. Artifact host rules: no `alert/confirm/prompt` (use `G.UI.confirm`), no `window.open`, downloads or print;
   `localStorage` may throw → try/catch everywhere and work without it; audio only after a user gesture;
   only the Google Fonts `<link>` in `index.html` is external; size with `height:100%` chains, never `100vh`.
5. Portrait phone first. Real **#view sizes** to support (CSS px, inside browser chrome):
   360×560 (compact), 360×640, 390×664 (iOS Safari), 390×763 (standalone), 430×932. Wider screens get a
   centered ≤480px column. Touch targets ≥ 44px (≥ 40px in compact mode, #view height < 600).
6. 60 fps on a mid-range phone. Canvas DPR capped at 2. Fixed sim step `G.CFG.SIM_DT` (1/30 s).

## 2. Repository layout & ownership

```
index.html                 dev entry; its <script>/<link> order IS the build manifest (do not add files)
build.mjs  serve.mjs       node build.mjs → dist/* ; node serve.mjs → http://localhost:5173 (launch.json "game")
SPEC.md                    this file (source of truth)
src/core/{ns,rng,util}.js                        [foundation]
src/data/{rules,systems,weapons,crew,ships,enemies,sectors}.js   [foundation]  ALL tuning lives in rules.js
src/data/events.js, src/data/text.js             [content]
src/sim/{ship,crew,enemies,ai,combat}.js         [sim-combat]
src/sim/{map,events,store,run,save}.js           [sim-meta]
src/ui/dom.js, src/css/base.css                  [foundation]
src/ui/{input,render,view}.js, src/main.js, src/css/view.css        [ui-view]
src/ui/audio.js, src/ui/screens/*.js, src/css/screens.css           [ui-screens]
tests/load.mjs, tests/data.test.mjs              [foundation]
tests/*.test.mjs  (per owner) ; tests/bot.mjs    headless auto-player for balance
```
Every file listed in `index.html` already exists as a stub, so `node build.mjs` and `node --test tests/` stay green.
Agents edit only files they own; if something you need from another owner is missing, code against this spec.
**Screen registration map** (no other screen files): `title.js` → title, newgame · `menu.js` → menu, settings,
help · `reward.js` → reward, offer · `map.js` → map · `event.js` → event · `store.js` → store · `ship.js` → ship ·
`sector.js` → sector · `end.js` → end.
Node tests: `node --test tests/`. vm-context objects are another realm: compare with `JSON.stringify` / primitives,
not `deepStrictEqual`. Sim tests may install a guard: `vm.runInContext("Math.random=()=>{throw Error('rand')}", ctx)`.

## 3. Game overview (player-facing)

- Choose 游隼号 or 雷鸣号 and a difficulty. Cross 5 sectors of beacons to the rebel flagship. Each jump costs 1 fuel.
- The beacon map is an undirected graph: you may jump to any connected beacon, including backwards; revisits are
  safe (nothing new happens; a store stays open). The rebel fleet sweeps up from the start row each jump —
  beacons it covers are dangerous (elite ship + fleet barrage).
- Beacons: text events (blue choices unlocked by crew race / weapons / systems), hostile ships, stores, distress calls.
- Combat is real-time with pause (every command works while paused). Route reactor power, aim weapons at enemy rooms,
  move crew to man stations, repair systems, fight fires and seal breaches, flee by FTL when charged.
- Spend 废料 on system upgrades, reactor bars, weapons, augments (max 3 passive upgrades), crew, fuel, missiles,
  hull repair. Win: destroy the flagship. Lose: hull 0 or all crew dead.
- Glossary (use consistently): 废料 scrap, 燃料 fuel, 导弹 missiles, 船体 hull, 反应堆 reactor, 护盾 shields,
  引擎 engines, 武器 weapons, 氧气 oxygen, 医疗舱 medbay, 驾驶舱 piloting, 闪避 evasion, 跃迁 jump/FTL, 信标 beacon,
  星区 sector, 叛军舰队 rebel fleet, 火灾 fire, 破口 breach, 离子 ion, 齐射 volley, 增强模块 augment, 货舱 cargo.

## 4. State shapes (plain JSON; `_`-prefixed keys are runtime-only and dropped on save)

### Run
```js
Run = {
  v: 1, seed, rng: { s }, nextId,
  difficulty: 'easy'|'normal'|'hard', shipId,
  mode: 'event'|'hub'|'combat'|'reward'|'sectorSelect'|'gameover'|'victory',
  player: Ship,
  res: { scrap, fuel, missiles },          // initialised from G.data.ships[shipId].res
  cargo: [weaponId],                       // unequipped weapons, length <= rules.cargoMax
  augments: [augId],                       // length <= rules.augmentMax
  volley: false,                           // player 齐射 toggle, persists across fights
  sectorIndex, sector: Sector, at: beaconId,
  event: EventState|null,                  // non-null iff mode === 'event'
  combat: Combat|null,                     // non-null iff mode === 'combat'
  reward: Reward|null,                     // non-null iff mode === 'reward' (display copy; already applied)
  after: { eventId, node }|null,           // event node resumed after a won fight (outcome.combat.win)
  sectorChoices: [typeId]|null,            // non-null iff mode === 'sectorSelect'
  end: { win, reason: 'hull'|'crew'|'flagship', text }|null,
  stats: { jumps, beacons, kills, derelicts, surrenders, fled, scrapEarned, crewLost, crewHired, time, combatTime },
  flags: {},                               // once-events { [eventId]: true }, flagshipDown, metaDone, free-form
  _fx: [FxEvent]                           // runtime queue; G.Run.fx / G.Run.drainFx
}
```

### Ship
```js
Ship = {
  id: 'player'|'enemy', name, templateId, faction: 'player'|'rebel'|'pirate'|'auto',
  crewless, boss, elite, w, h, tint,
  rooms: [Room],                           // index === room.id
  systems: { [sysId]: System },            // only installed ones
  weapons: [WeaponInst], weaponSlots,
  crew: [Crew],                            // dead crew are removed
  hull, hullMax, reactor,
  shieldLayers, shieldCharge,              // layers up; 0..1 progress to next layer
  ftl,                                     // 0..1 (player: any time it can charge; enemy: only when fleeing)
  missiles,                                // enemy only: stock (player uses run.res.missiles)
  fleeing, canFlee, canSurrender, surrenderOffered,   // enemy AI traits
  volley,                                  // AI volley behaviour (flagship, elites)
  phase: 1|2, chargeMult: 1, surgeT,       // boss
  _adj: [[roomId]]
}
Room = { id, x, y, w, h, sys: sysId|null, o2 /*0..100*/, fire /*0..tiles*/, breach /*0..tiles*/,
         fireT, fireProg, breachProg, sysFireProg }
System = { id, room, level, power, want, damage, ion, ionT, repairProg }
   usable = max(0, level - damage - ion); invariant power <= usable.
   systems.weapons.power is DERIVED = Σ def.power of `on` weapons; weapons.want is unused.
   systems.piloting.power = usable (no reactor).
WeaponInst = { uid, id, on, want, charge /*seconds*/, target: roomId|null }
Crew = { id, name, race, hp, hpMax, room, slot, path: [roomId], hopT, station: roomId|null,
         task: 'idle'|'walk'|'man'|'repair'|'fire'|'breach' }
```

### Combat
```js
Combat = {
  enemy: Ship, faction, elite, boss, rewardMult,
  hazard: 'none'|'asteroid'|'sun'|'fleet', hazardT: { player, enemy, flare, fleet },
  time, aiT,
  projectiles: [Projectile], beams: [Beam],
  pending: null|'win'|'derelict'|'lose'|'enemyFled'|'surrender', pendingT,
  result: null|'win'|'derelict'|'lose'|'enemyFled'|'surrender',
  offer: null|{ type: 'surrender', scrap, fuel, missiles, text },   // freezes the fight until answered
  msg: null|{ text, kind, t },             // latest HUD status line
  flags: {}                                // one-shot things inside a fight (crisis pauses fired, etc.)
}
Projectile = { id, from: 'player'|'enemy'|'hazard', to: 'player'|'enemy', kind: 'laser'|'ion'|'missile'|'asteroid'|'fleet',
               weapon: weaponId|null, slot: int|null, target: roomId, delay, t, dur,
               dmg, ion, sysDmg, crewDmg, fire, breach }
Beam = { id, from, to, weapon, slot, rooms: [roomId], applied: [bool], delay /*= rules.flight.beam*/, t,
         dur /*= rules.beamSweep*/, dmg, fire, crewDmg, sysDmg }
```

### FxEvent (`run._fx`) — consumed by render, audio, vibration, toasts, tips
`side` = the ship the effect happens on. `from`/`to` = shooter / target ship.
```
{ t:'launch', from, to, kind, weapon, slot, target, id }    { t:'beam', from, to, weapon, slot, rooms, id }
{ t:'miss', from, to, id, target }                          { t:'shield', from, to, id, target, side }
{ t:'hit', from, to, id, target, side, dmg, kind }          { t:'ion', side, sys }
{ t:'fire', side, room }  { t:'breach', side, room }        { t:'sysDamage', side, sys }
{ t:'crewDied', side, name }  { t:'destroyed', side }
{ t:'phase2' }  { t:'surgeWarn', in }  { t:'surge' }  { t:'flare' }
{ t:'enemyFleeing' }  { t:'combatStart', boss, elite }  { t:'combatEnd', result }
{ t:'msg', text, kind: ''|'warn'|'bad'|'good' }
```

### Sector / Beacon / Event / Store / Reward
```js
Sector = { index, type, name, rows, beacons: [Beacon], edges: [[a, b]] /*undirected*/, start, exit, fleet }
Beacon = { id, row, x /*0..1*/, kind: 'start'|'event'|'combat'|'store'|'empty'|'distress'|'boss',
           faction: 'rebel'|'pirate'|'auto'|null, exit, visited, hazard: 'none'|'asteroid'|'sun', store: Store|null }
EventState = { id, node, result: null|EventResult, ctx: {} }
EventResult = { text, fx: [FxSummary], next: 'goto'|'combat'|'store'|'end', goto, combat }
FxSummary = { key, amount, label /* '+15 废料' */, good }
Store = { items: [StoreItem] }
StoreItem = { key, type: 'fuel'|'missiles'|'repair'|'weapon'|'crew'|'augment', id, name, price, stock }
Reward = { result, scrap, fuel, missiles, weapon: id|null, crew: { name, race }|null, text, fx: [FxSummary] }
Settings = { sound: true, vibrate: true, speed: 1, autoPause: true, crisisPause: true, tips: true }
Meta = { runs: 0, wins: 0, bestSector: 0, tipsSeen: {} }
```

## 5. Rules (all constants from `G.data.rules`)

**Power.** Reactor systems = `G.data.systems.reactorOrder` (shields, engines, oxygen, medbay).
`reactorUsed = Σ systems[id].power (reactorOrder, installed) + systems.weapons.power`; `reactorFree = reactor - reactorUsed`.
Never derive accounting from `defs[*].reactor` flags.
- `addPower(ship, id)` for reactor systems: ok iff `power < usable && reactorFree >= 1` → `power++, want = power`.
  For `'weapons'`: turn on the lowest slot with `!on` whose power fits `reactorFree` and weapon capacity.
  For `'piloting'`: always false.
- `removePower(ship, id)`: reactor systems `power--, want = power`; `'weapons'`: turn off the highest `on` slot
  (`want = false`).
- `toggleWeapon(ship, slot)`: on → off (`want=false`); off → on needs `reactorFree >= def.power` and
  `weapons.power + def.power <= usable(weapons)`; sets `want = true`.
- `enforcePower(ship)` after any damage/ion and every tick: `power = min(power, usable)`; weapons turn off from the
  last slot until they fit (keep `want`).
- `restorePower(ship)` every tick after enforce: shields, engines, oxygen, medbay, then weapons in slot order —
  raise power toward `want` / re-enable `want && !on` weapons using only free reactor power.
- Upgrades (`level++`) leave damage and power unchanged; a new reactor bar is simply free power.

**Manning.** A crew member mans a station system (`station:true`) when it stands in that room, is not walking, has no
fire/breach/repair to do there, and the system's usable > 0. At most one crew mans a system (it moves to slot 0).
Bonuses: shields recharge ×`mannedShieldMult`, weapons charge ×`mannedWeaponMult`, engines +5 evasion, piloting +5.
Crewless ships: piloting counts as working with mult `crewlessPilotMult`; no manning bonuses.

**Evasion** = `evasionInfo(ship).total`:
`0` if engines power 0 or piloting usable 0 (or piloting level 1 unmanned on a crewed ship). Else
`mult = crewless ? crewlessPilotMult : (pilotManned ? 1 : autopilot[usable(piloting)])`,
`total = clamp(round((evasionByEngine[engines.power] + (enginesManned ? 5 : 0)) × mult + (pilotManned ? 5 : 0)), 0, evasionMax)`.

**Shields.** `maxLayers = floor(shields.power / 2)`. Each tick: if `shieldLayers > maxLayers` → `= maxLayers`.
If `shieldLayers >= maxLayers` → `shieldCharge = 0`. Else `shieldCharge += dt / shieldRecharge ×
(manned ? mannedShieldMult : 1) / (aug shield_booster ? shieldBoosterMult : 1)`; at ≥ 1 → layer++, charge = 0.
Knocking a layer down does not change `shieldCharge`.

**Combat start** (`G.Combat.create`): player `ftl = 0`; every player weapon `charge = 0, target = null`
(augment `pre_igniter`: powered weapons start fully charged); enemy weapons `charge = RNG.range(0, 0.25) × def.charge`;
both ships `shieldLayers = maxLayers`, `shieldCharge = 0`; enemy `ftl = 0`. Out of combat (`idle`) weapons never
charge (unpowered decay only) and FTL does not charge; `G.Run.jump` sets `player.ftl = 0`.

**Weapons.** Charge only while `run.combat` exists and there is no `pending`/`result`:
`charge += dt × (manned ? mannedWeaponMult : 1) × ship.chargeMult × (aug auto_loader ? autoLoaderMult : 1)`, capped
at `def.charge`. Unpowered weapons lose `weaponDecay` s/s. `weaponState(run, ship, slot).why` ∈
`'' | 'charging' | 'off' | 'noTarget' | 'noMissiles' | 'volley' | 'noCombat'` (`''` = ready and will fire).
A player weapon fires when `on`, charged, targeted, has ammo (`def.missile === 0 || res.missiles >= def.missile`),
and — if `run.volley` — every **eligible** weapon is charged (eligible = on && targeted && has ammo; weapons that are
off/untargeted/out of ammo never hold the volley). Firing: `charge = 0`; `shots` projectiles with
`delay = i × burstGap`, or one Beam; consume missiles (augment `replicator`: `replicatorChance` to not consume).
Targets persist for lasers/ions/beams; **player missile weapons clear their target after each shot** (one tap = one
missile; the card says 单发). `setTarget` returns false unless `roomId === null` or `0 <= roomId < enemy.rooms.length`.
Enemies: same charge rules, unlimited targeting, `enemy.missiles` stock (AI unpowers missile weapons at 0).
Volley ordering comes from flight times (`rules.flight`: ion 0.9 < missile 1.1 < laser 1.2 < beam 1.9), so a
simultaneous volley lands ion → missile → lasers → beam. Projectiles resolving in the same tick resolve in creation order.

**Projectiles.** After `delay`, `t += dt`; at `t >= dur` resolve on the target ship:
1. Evasion (laser, ion, missile, asteroid, fleet): `RNG.chance(evasion/100)` → fx `miss`.
2. Laser/ion/asteroid/fleet vs `shieldLayers > 0` → `shieldLayers--`, fx `shield`. Ion also adds `ion` stacks to the
   shields system. Nothing else happens.
3. Missiles ignore shields.
4. Hit: `hull -= dmg`; room system `damage = min(level, damage + sysDmg)`; crew in room −`crewDmg`; roll `fire` →
   `fire = min(tiles, fire+1)` (fx fire); roll `breach` likewise (fx breach). Ion on an unshielded room: system
   `ion = min(level, ionMaxStacks, ion + n)`, `ionT = ionDuration` (fx ion); no hull damage.
Ion decay: while `ion > 0`: `ionT -= dt`; at 0 → `ion--`, reset `ionT` if still > 0.

**Beams.** Never miss. `rooms = beamRooms(target, room, beamLen)`: `row = targetRoom.y`; candidates = rooms with
`y <= row < y + h`; take the target, then candidates with `x > target.x` ascending, then `x < target.x` descending;
truncate to `len`. Timeline: nothing until `t >= delay` (`rules.flight.beam`, the charge-up glow); room k of n is
applied once when `t >= delay + dur × (k + 1) / n` using the target's `shieldLayers` at that moment:
`eff = dmg - shieldLayers`; if `eff > 0` → hull/system damage `eff`, crew `crewDmg`, fire roll. For `dmg === 0`
(fire beam): crew/fire effects only when `shieldLayers === 0`. Beams never reduce layers.

**Crew work** (per room, crew standing there, priority fire > breach > repair > man):
fire: `fireProg += Σ fireExtRate × race.fire × dt` → at 1: `fire--`, reset. breach: `breachRate × race.repair`.
repair: `repairRate × race.repair` → at 1: `damage--`. Crewless ships: self-repair `crewlessSelfRepair` bars/s on the
most damaged system. **Movement**: BFS over `adj`; hop time = center distance in tiles / (`crewWalkTilesPerSec ×
race.speed`). Arrival takes the lowest free slot (slot 0 kept for the manning crew in station rooms); rooms may overflow.
**Crew damage**: fire `(fireCrewDps + fireCrewDpsPerTile × fire) × dt` unless `fireImmune`; o2 `< suffocateBelow` →
`suffocateDps × dt`; medbay heals `medbayHps[medbay.power] × dt` in its room (not while burning). HP ≤ 0 → removed,
fx `crewDied`, `stats.crewLost++` (player).

**Environment** (crewed ships): o2 `+ oxygenRate[oxygen.power]` (or `- oxygenLeak` with no oxygen power),
`- breachDrain × breach`, `- fireO2Use × fire`, then diffusion with adjacent rooms (`oxygenDiffuse`), clamp 0..100.
Fire, every `fireGrowInterval` per burning room: o2 < `fireDieBelowO2` → `fire--`; else if o2 ≥ `fireNeedO2` and
`fire < tiles` → `fireGrowChance` → `fire++`; `fireSpreadChance × fire/tiles` → one random adjacent non-burning room
gets fire 1. Fire damages the room's system: `sysFireProg += fireSysDmgRate × fire × dt` → at 1 `damage++`.
**Crewless ships**: no oxygen (treat 100); fire never grows or spreads; every `fireGrowInterval` each burning room
does `fire--`; `sysFireProg` still applies.

**FTL.** Player `canChargeFtl` = engines power > 0 && piloting usable > 0 && (piloting manned || autopilot[usable] > 0).
In combat `ftl += dt / ftlTime × (aug ftl_booster ? ftlBoosterMult : 1)`,
`ftlTime = max(ftlTimeMin, ftlTimeBase − ftlTimePerEngine × engines.power)`. `G.Combat.canFlee` = `ftl >= 1` &&
`!combat.boss`. Fleeing opens the map; choosing a beacon calls `G.Run.jump` (no reward, `stats.fled++`).
Enemy: only while `fleeing` and engines power > 0 && piloting usable > 0 && (crewless || piloting manned ||
piloting usable ≥ 2): `ftl += dt / max(enemyFtlTimeMin, enemyFtlTime − ftlTimePerEngine × engines.power)`.
At 1 → pending `enemyFled`.

**Hazards.** `asteroid`: each ship gets an asteroid projectile (`from:'hazard'`, dmg 1, blocked by shields, can miss)
every `asteroidInterval` s. `sun`: every `flareInterval` s, `flareFires` random rooms per ship catch fire (fx flare).
`fleet` (all `combat_elite` fights): every `fleetShotInterval` s a `fleet` projectile (`rules.fleetShot`, flight
`rules.flight.fleet`) at a random **player** room; blocked by shields, can miss. The HUD shows 舰队炮击.

**Boss.** `canFlee` false. Phase 2 once at `hull <= phase2.at × hullMax`: if `repairAll`, clear all flagship damage,
ion, fires, breaches; `chargeMult = phase2.chargeMult`; `surgeT = surgeInterval`; fx `phase2` + msg `text`.
Phase 2 surge: `surgeT -= dt`; at `surgeWarn` emit fx `surgeWarn` + msg `warnText` (kind 'bad'); at 0 spawn
`surgeShots` laser projectiles (dmg 1, delay i×0.15) at player rooms by `targetWeights`, fx `surge`, reset timer.

**End of combat.** Decisive moment → `pending`, `pendingT = endDelay`; when it elapses `result = pending`.
Order: player hull ≤ 0 or no player crew → `lose` (takes precedence) · enemy hull ≤ 0 → `win` (fx destroyed) ·
enemy had crew and all died → `derelict` · enemy fled → `enemyFled` · surrender accepted → `surrender` (immediate).

**Enemy AI** (`G.AI`; think every `aiThinkInterval` s; fire checks every tick):
- init: power shields/engines/oxygen/medbay to level, weapons in slot order within `weapons` level; `reactor` =
  total wanted power; crew placed at stations (piloting, weapons, shields, engines, then others).
- targeting: when a weapon is charged and untargeted, pick a player room by `targetWeights` (missiles weight shields
  ×2; beams +1 per crew in the room). Re-pick after each shot. `volley` ships wait until all powered, non-empty
  weapons are charged.
- crew: send the nearest idle crew to rooms with fire > breach > damaged system (one per problem room); return idle
  crew to stations; crew with hp < 35% go to a working medbay until ≥ 90%.
- flee: `canFlee && hull <= enemyFleeHullFrac × hullMax` → `fleeing = true`, fx `enemyFleeing`, msg '敌舰正在为跃迁引擎充能！'.
- surrender: `canSurrender && !surrenderOffered && hull <= enemySurrenderHullFrac × hullMax` → `combat.offer`
  (reward ≈ normal × `surrenderMult`), `surrenderOffered = true`. `answerOffer(run, true)` → result `surrender`;
  false → fight continues.

## 6. Sim API (exact names)

### G.Ship (`sim/ship.js`)
```
build(run, spec) -> Ship    spec = { id, name, templateId, faction, crewless, tint, w, h, rooms, hullMax, hull?, reactor,
                                     weaponSlots, systems: {sysId: level}, weapons: [weaponId], crew: [{race, room?, name?}],
                                     boss?, elite?, missiles? }
                            Player ships get starting power; enemy ships leave build with power = want = 0 (AI.init powers them).
createPlayer(run, shipId) -> Ship   from G.data.ships; unique crew names from G.data.crew.names; starting power priority:
                            shields full, weapons on, oxygen 1, engines full, medbay 1 — while reactor bars remain.
adj(ship) ; roomAt(ship, gx, gy) -> id|-1 ; roomCenter(ship, id) -> {x,y} ; slotPos(ship, id, slot) -> {x,y}
sysRoom(ship, sysId) -> Room|null ; tiles(room)
usable(sys) ; reactorUsed(ship) ; reactorFree(ship)
addPower(ship, sysId) -> bool ; removePower(ship, sysId) -> bool ; toggleWeapon(ship, slot) -> bool
powerBlock(ship, sysId) -> ''|'noSystem'|'max'|'broken'|'ion'|'reactor'|'fixed'       // why addPower fails
toggleBlock(ship, slot) -> ''|'reactor'|'capacity'|'broken'                             // why turning a weapon on fails
enforcePower(ship) ; restorePower(ship)
maxLayers(ship) ; evasion(ship) ; evasionInfo(ship) -> { total, base, engMan, pilotMan, mult, why: ''|'engines'|'piloting' }
ftlTime(ship) ; canChargeFtl(ship)
isManned(ship, sysId) ; mannedBy(ship, sysId) -> Crew|null
damageSystem(ship, sysId, n) ; ionSystem(ship, sysId, n)
jumpReset(ship)             damage 0, ion 0, fires/breaches 0, o2 100, progress reset, shields full. NEVER touches hull.
beamRooms(ship, roomId, len) -> [roomId] ; aliveCrew(ship) -> [Crew]
```
### G.Crew (`sim/crew.js`)
```
create(run, race, name?) -> Crew ; place(ship, crew, roomId)
order(ship, crewId, roomId) -> bool     walk there; if the room has a station system no other crew is stationed at
                                        AND the crew has no station (or a less important one: piloting > weapons >
                                        shields > engines), crew.station = roomId; otherwise the saved station stays
returnToStations(ship)                  first fills empty stations (piloting > weapons > shields > engines) from
                                        station-less crew (cockpit may take the lowest-priority station holder), then
                                        sends everyone back
step(run, ship, dt, ctx) ; pos(ship, crew) -> {x,y} (interpolated grid coords)
ctx = { fx: function (ev) { G.U.fx(run, ev); }, inCombat: bool }; every ship-scoped fx sets side = ship.id
sim-combat must not depend on G.Run: read the current beacon as run.sector && run.sector.beacons[run.at] (may be absent
in tests), augments via G.U.hasAug(run, id), difficulty via G.data.rules.difficulty[run.difficulty || 'normal'].
```
### G.Enemies (`sim/enemies.js`)
```
generate(run, { faction, elite?, hullType? }) -> Ship
  d = clamp(sectorIndex + (elite ? elite.dBonus : 0), 0, 5); diff = rules.difficulty[run.difficulty]
  hullType = spec.hullType || weightedKey(faction.hulls)
  hullMax = hullBase[hullType] + hullPerD × d + roll(hullRand) + diff.enemyHull (min 5)
  shields power = 2 × int(lo/2, hi/2) of shieldsByD[d] (+ elite.shieldsBonus), clamp ≤ maxShieldPower
  engines = roll(enginesByD[d]); piloting = pilotingByD[d]; oxygen = oxygenLevel; medbay = medbayByD[d] (if rooms exist)
  budget = max(1, weaponBudgetByD[d] + diff.enemyPower); up to maxWeapons picks, uniform over faction.weapons with
    tier <= maxTierByD[d], power <= remaining budget, d >= minDByWeapon[w] (default 0), <= maxMissileWeapons missiles
  weapons level = Σ picked power (min 1); missiles = missilesByD[d]
  crew = roll(crewByHull[hullType]) races by faction.crew weights, placed piloting, weapons, shields, engines, others
  name = elite ? elite.name : pick(faction.names); canFlee = chance(flee), canSurrender = chance(surrender)
    (both false when crewless, elite or boss); volley = elite
flagship(run) -> Ship     from G.data.enemies.flagship (+ diff.enemyHull), boss:true, volley:true
```
### G.AI (`sim/ai.js`)  `init(run, combat)`, `step(run, combat, dt)` (see §5).
### G.Combat (`sim/combat.js`)
```
create(run, spec) -> Combat   spec = { faction?: 'rebel'|'pirate'|'auto'|'sector', elite?, boss?, rewardMult?, hazard? }
   faction = (!spec.faction || spec.faction === 'sector') ? (beacon.faction || weightedKey(type.factions)) : spec.faction
   hazard = spec.hazard || (spec.elite ? 'fleet' : beacon.hazard) || 'none'
   enemy = spec.boss ? G.Enemies.flagship(run) : G.Enemies.generate(run, { faction, elite })
   run.combat = combat; G.AI.init(run, combat); combat-start resets (§5); fx combatStart. Returns combat.
step(run, dt)                 both ships, projectiles, beams, hazards, AI, boss, end checks; no-op while offer/result set
stepShip(run, ship, dt, ctx)  per-ship systems/crew/environment (also used out of combat)
idle(run, dt)                 out-of-combat tick for the player ship (crew walk/repair, fires, oxygen, medbay)
setTarget(run, slot, roomId|null) -> bool ; setVolley(run, bool) (writes run.volley)
weaponState(run, ship, slot) -> { frac, ready, why }     pure
canFlee(run) -> bool ; answerOffer(run, accept) ; previewBeam(run, slot, roomId) -> [roomId]
say(run, text, kind)          combat.msg = {text, kind, t: time} + fx msg
drainFx(run)                  alias of G.Run.drainFx
```
### G.Map (`sim/map.js`)
```
generate(run, sectorIndex, typeId) -> Sector
   rows = sectorRows (final: finalRows). Row 0: start (x .5). Last row: exit (x .5; final sector: kind 'boss').
   Normal middle rows: 2–3 beacons, x in 0.12..0.88 with jitter, min spacing 0.22.
   Final sector: rows 1–2 normal (kinds from final.kinds), row 3 is ONE store beacon (x .5) that every row-2 beacon links
   to and that links to the boss; its store always has repair, ≥4 fuel, ≥4 missiles.
   Edges (undirected): each beacon to its 1–2 nearest in the next row; every next-row beacon gets ≥1 link; horizontal
   neighbours link with sameRowEdgeChance. Graph must be connected.
   Kinds by type.kinds (normal sectors guarantee ≥1 store, never start/exit); faction per non-start beacon via
   weightedKey(type.factions); hazards on combat beacons via type.hazards. fleet = fleetStart.
neighbors(sector, id) ; beacon(sector, id) ; isOvertaken(sector, beacon) (row <= fleet) ; advanceFleet(run, mult)
fleetEta(run, beaconId?) -> int     max(0, ceil((beacon.row − fleet) / (type.fleetSpeed × diff.fleetMult))); 0 = overtaken
jumpsLeft(sector, fromId) -> int    shortest hop count to exit
reachable(run) -> [beaconId]        neighbors filtered by G.Run.canJump(run, id).ok
iconsHidden(run) -> bool            nebula: store/distress icons hidden until visited
```
### G.Events (`sim/events.js`)
```
pick(run, tag) -> eventId      weighted among events with the tag, minSector <= sector <= maxSector, !(once && flags[id])
start(run, eventId, node?)     run.event = { id, node: node || 'start', result: null, ctx: {} }; mode 'event'; set once-flag
node(run) -> node def
choices(run) -> [{ idx, text, blue, enabled, note }]   blue choices whose req fails are hidden; cost gates shown disabled;
                               note = '〔机工族〕' style label for blue choices, '需要 20 废料' for cost gates
choose(run, idx) -> EventResult   rolls the outcome, applies fx NOW, stores run.event.result
cont(run) -> { openStore }     goto → same event new node; combat → G.Run.startCombat (+ run.after if outcome.combat.win);
                               store → beacon.store ||= G.Store.create(run), mode hub, openStore true; end → mode hub
apply(run, fx) -> FxSummary    one effect (also used by rewards and tests)
```
### G.Store (`sim/store.js`)
```
create(run) -> Store     fuel (stock 4–8, rules.fuelPrice), missiles (4–8, rules.missilePrice), repair (hullRepairPrice[sector]/pt),
                         3 weapons (tier <= maxTierByD[sector], distinct), 1–2 crew (raceOdds, crewPrice), augment (60%, not owned)
canBuy(run, key, qty?) -> { ok, reason, price } ; buy(run, key, qty?) -> { ok, reason }
sell(run, cargoIdx) -> { ok, reason }      weapon cost × sellMult
sellAugment(run, augId) -> { ok, reason }  cost × sellMult
repairPrice(run) -> scrap per hull point
```
### G.Run (`sim/run.js`)
```
create({ seed, shipId, difficulty }) -> Run    sector 0 civilian; res = clone(ships[shipId].res); mode 'event' ('start_intro')
step(run, dt) -> bool     THE per-tick entry: combat → G.Combat.step, then finishCombat when result set; hub → G.Combat.idle;
                          any mode: no alive player crew → gameover('crew'). stats.time += dt (combatTime in combat).
                          Returns true if run.mode changed OR combat.offer went null → set.
fx(run, ev) ; drainFx(run) -> [FxEvent]      aliases of G.U.fx / G.U.drainFx (core/util.js; sim modules may call G.U.* directly)
beacon(run) ; hasStore(run) (mode hub && beacon.store) ; hasAug(run, id) (= G.U.hasAug)
canJump(run, id) -> { ok, reason }   neighbor, fuel >= 1, and (mode hub || (mode combat && G.Combat.canFlee(run)))
jump(run, id)          fuel--, advanceFleet, stats.jumps++, jumpReset(player), heal crew to full if medbay level >= 1,
                       player.ftl = 0, combat → null (stats.fled++ if fleeing), at = id, arrive(run)
arrive(run)            beacon.visited := true (remember the old value). Order:
                       1. kind 'boss' && !flags.flagshipDown → event 'boss' (ignores overtaken/visited)
                       2. overtaken → pick('combat_elite')
                       3. was visited → mode hub
                       4. by kind: start → 'start' (sector 0 first visit: 'start_intro'); event → [sector type, 'any'];
                          combat → 'combat_' + beacon.faction; distress → 'distress'; store → 'store'; empty → 'empty'
startCombat(run, spec)  G.Combat.create + mode 'combat'
finishCombat(run)       c = run.combat; player weapons charge 0, target null; player.ftl = 0; run.combat = null; then by c.result:
   lose → mode gameover, end { win:false, reason: player.hull <= 0 ? 'hull' : 'crew' }
   win/derelict && c.boss → flags.flagshipDown, mode victory, end { win:true, reason:'flagship' }
   win/derelict/surrender → roll + APPLY reward now: scrap = round(roll(scrapBase) × (1 + scrapPerSector × sectorIndex) ×
       type.rewardMult × c.rewardMult × diff.scrapMult × (derelict ? derelictMult : 1) × (surrender ? surrenderMult : 1)
       × (aug scrap_arm ? scrapMult : 1)); fuel/missiles/weapon/crew by chances; weapon → cargo if room else scrap
       floor(cost × sellMult) (text 货舱已满，已拆解); crew only if alive < maxCrew; stats.kills++ (+derelicts/surrenders),
       scrapEarned += scrap; run.reward = display copy; mode reward
   enemyFled → mode hub + fx msg '敌舰跃迁逃走了'
claimReward(run)        never touches res: reward = null; after ? Events.start(after) : mode hub
upgradeCost(run, sysId) -> n|null ; upgradeSystem(run, sysId) -> {ok, reason}
reactorCost(run) -> n|null (rules.reactorCostBase + (reactor − 8) × reactorCostStep; null at reactorMax) ; upgradeReactor(run)
equip(run, cargoIdx) / unequip(run, slot) -> {ok, reason}   (weapon charge 0, target null)
dismissCrew(run, crewId) -> {ok, reason}                     never the last crew
All mutating shop/upgrade/equip/dismiss calls return { ok:false, reason:'战斗中无法操作' } while mode === 'combat'.
atExit(run) ; leaveSector(run) -> {ok, reason}   mode hub, at exit, fuel >= 1, not final sector ('必须击毁叛军旗舰');
                        fuel--, sectorIndex < 3 → mode sectorSelect with 2 distinct choosable types; sectorIndex 3 → final
chooseSector(run, idx)  sectorIndex++, new sector, at = start, arrive (sector start event)
isStranded(run) -> bool (mode hub && fuel 0) ; wait(run)   advanceFleet(waitFleetAdvance); overtaken here → 'combat_elite'
                        event; else 'stranded' event
```
### G.Save (`sim/save.js`)
```
serialize(run) -> string (G.U.stringify) ; deserialize(str) -> Run|null   (validates v === 1 && ships[shipId];
                        rebuilds caches only — never calls AI.init)
save(run)               mode gameover/victory → clear() instead ; load() -> Run|null ; clear() ; has()
loadSettings() / saveSettings(s) ; loadMeta() / saveMeta(m)     (defaults as in §4; merge unknown keys)
```

## 7. Run flow

```
create → event(start_intro) → hub ⇄ [map] → jump → arrive → event | hub
event ─choose→ result ─cont→ goto(event) | combat | hub(+store opens)
combat → win/derelict/surrender → reward ─claim→ hub (or after-event) ; boss win → victory
       → enemyFled → hub ; lose → gameover ; player flees (map in combat, canFlee) → jump → arrive
hub at exit ─leaveSector→ sectorSelect ─choose→ next sector start ; sector 3 exit → final sector directly
hub with fuel 0 → wait → stranded | combat_elite ; overtaken beacon → combat_elite
no alive crew (any mode) → gameover ; hull 0 only happens in combat (event fx never kill)
```

## 8. Events content (`src/data/events.js`)
```js
G.data.events = [ {
  id: 'civ_trader', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: false,
  nodes: {
    start: { text: '……', choices: [
      { text: '……', req: { race: 'engi' }, outcomes: [ { w: 1, text: '……', fx: [{ scrap: [10, 20] }], goto: 'b' } ] },
      { text: '……', outcomes: [ { w: 2, text: '……', combat: { faction: 'pirate' } }, { w: 1, text: '……', fx: [{ fuel: 2 }] } ] },
    ] },
    b: { text: '……', choices: [ { text: '离开', outcomes: [ { w: 1, text: '', fx: [] } ] } ] },
  } }, ... ]
```
- Outcome = `{ w, text, fx?, goto?, combat?, store?: true }`. It ends the event unless it has goto/combat/store.
  An outcome with empty text, no fx and no goto/combat/store closes the dialog immediately.
- `fx` keys: `scrap, fuel, missiles, hull` (number or [a,b]; positive scrap × (1 + eventScrapPerSector × sector)),
  `crew: 'random'|race`, `loseCrew: 1`, `crewDamage: n`, `weapon: 'random'|'tier1'|'tier2'|'tier3'|weaponId`,
  `augment: 'random'|augId`, `upgrade: 'random'|sysId`, `sysDamage: 'random'|sysId`, `reactor: 1`, `fleet: ±x`.
  Event fx never kill: hull stays ≥ 1, crew HP ≥ 1, `loseCrew` never removes the last crew member.
- `req`: `race`, `weaponType` ('laser'|'ion'|'missile'|'beam'), `weapon`, `system: { id, level }`, `crewCount`,
  `augment` → **blue** choices (hidden when unmet); `scrap`, `fuel`, `missiles` → cost gates (shown disabled when
  unmet; pay with a negative fx).
- `combat: { faction: 'rebel'|'pirate'|'auto'|'sector', elite?, boss?, rewardMult?, win?: nodeId }`. Inside a
  `combat_X` event every combat outcome uses faction X or 'sector'.
- Pools (tags) and minimum counts: `start_intro` 1 · `start` ≥3 · `any` ≥6 · civilian/hostile/pirate/nebula/final
  ≥5 each · `distress` ≥6 · `store` ≥2 · `empty` ≥3 · `combat_rebel`/`combat_pirate`/`combat_auto` ≥3 each (all lead
  to combat; some offer a way out) · `combat_elite` ≥2 (elite:true) · `boss` 1 (boss:true, no way out) · `stranded` ≥3.
  ≈ 60 events. Blue options for every race, every weapon type, several systems and at least one augment.
- `G.data.text` (content): `help` (array of { title, body }), `tips` (§9), `reasons` (powerBlock/toggleBlock/weapon
  `why`/misc codes → Chinese), `kindNames` (beacon kinds), `factionNames`, `hazardNames`, `endTexts`.

## 9. UI (portrait)

### Structure
`#view` hosts the persistent **main view**: a CSS grid; zones 2–4 share one `<canvas>` placed behind DOM rows.
Overlays via `G.UI.open(name)`. Router (`G.App.sync`, §10) maps run.mode → overlays. Modal overlays pause the sim.

### Grid (exact)
`grid-template-rows: 40px minmax(0,45fr) 44px minmax(0,55fr) 6px 56px 6px 56px 6px`
(#view is already inset from the notch/home bar in standalone mode by base.css; do not add safe-area padding again). **Compact** (#view height < 600): top 36, context 40,
weapons 52, systems 52. Horizontal gutter 8px. Rows:
1. **Top bar**: segmented hull bar + number (flex), 废料/燃料/导弹 chips, menu button (40×40, 44px hit).
2. **Enemy zone**: 24px header (name · faction on the left; shield pips, 闪避 %, 5px hull bar on the right), one 16px
   row of enemy weapon chips (short name + 3px charge bar; grey unpowered; red pulse ≥ 85%; 齐射 marker; red FTL bar
   '跃迁充能 NN%' while fleeing), then the enemy ship. Hub mode: beacon info card instead (sector name/type, beacon
   kind, '叛军舰队约 N 跳', hazard).
3. **Context strip** (44px, full width) — content depends on `G.View.sel`:
   - none (combat): `[闪避 25% · 氧 96%] [FTL bar 120px → primary 跃迁 96×40 when canFlee] [齐射 64×40 toggle]`;
     hazard 'fleet' shows '舰队炮击 Ns'; boss phase 2 shows surge countdown.
   - weapon armed: `〔连发II〕选目标` + quick-pick 40×40 icons for each installed enemy system (red/violet when
     damaged/ionized; tap = target that system's room) + [清除目标] + [断电]/[通电].
   - crew selected: `阿亮 · 岩石族 HP 120/150 → 点舱室移动` + [回岗] + [取消].
   - system focused (4 s after a chip tap): `[−56×40] 护盾 ▮▮▯▯ 2/4 · 1层 [+56×40]`.
   - hub: sector name · 叛军舰队约 N 跳 · 燃料.
   Combat `msg` is NOT here: draw it as one line of 14px canvas text at the bottom of the enemy zone, fading after 3 s.
4. **Player zone**: crew grid on the left (44×44 tiles, 40 compact; race-colored disc, 2-char name 12px, 3px HP bar,
   12px task badge 修/火/破/岗/走; `rows = floor((zoneH − 48)/(tile+4))`, `cols = ceil(n/rows)`; 8px inset from the
   screen edge) with a 40px [全员回岗] button under it; the player ship nose-up to the right, shield bubble around it.
   Paused: 2px `--accent` inset frame around zones 2–4 and a pill '已暂停 · 暂停中也能下达指令'.
5. **Weapons row** (combat): `weaponSlots` cards (67–74 × 56; empty slots dim dashed) + pause/play 52×56 at the right
   end (thumb zone). Card: slot number + short name (13px), 6px charge bar, power pips (def.power) left + target badge
   (target system short name) right; '无弹' red when out of missiles; '单发' tag on missile weapons.
   Hub: [星图] [飞船] [商店 when hasStore] + pause.
6. **Systems row**: reactor block 52×56 (big free-power number in `--power`, small 'x/y' used/total; pips only when
   reactor ≤ 12) + 5 chips 52×56 (shields, engines, weapons, oxygen, medbay; no piloting chip): icon, one row of pips
   5×8 (on = filled green, off = outline, ion = violet hatch, damaged = red ×), level number 12px.

Layout sharing: view.js measures zones 2 and 4 (getBoundingClientRect on resize) into
`G.View.layout = { enemy: {x,y,w,h,tile,ox,oy}, player: {...}, crewPanel: {...} }`; render.js and input use only this.
Tile = `floor(min(boxW / (ship.w + 0.5), boxH / (ship.h + 0.5)))`. Enemy box = zone − header rows − 8px. Player box =
(zone width − crew panel − 8) × (zone height − 16). The enemy is mirrored on y only:
`screenY = oy + (ship.h − y − h) × tile`; x unchanged (so beam order is unchanged); input inverts the same way.

### Input model (`src/ui/input.js` + view.js)
One exclusive selection `G.View.sel = { mode: 'none'|'weapon'|'crew'|'system', slot, crewId, sysId, until }` —
UI-only, never stored on the run, reset on every mode change (clear crew if dead).
- Pointer events only; first pointer only; tap = up within 10px & 400ms; drag threshold 10px; **no long-press**
  anywhere; suppress contextmenu/selectstart/gesturestart; non-passive touchmove preventDefault on #view.
- Weapon card tap: arm it (auto-power via toggleWeapon if off; if that fails keep armed and show the reason) /
  tap the armed card again = disarm / tap another card = switch.
- Enemy zone while armed: **press-drag-release**: pointerdown highlights the room under the finger (nearest room if
  inside the ship box but between rooms; clamp if within 16px outside), a 28px callout 40px above the finger with the
  room's system name (or 空舱室) and for beams the `previewBeam` rooms; release commits `G.Combat.setTarget` and sets
  sel none; release > 24px outside the zone cancels. Or tap a quick-pick icon.
- Crew: tap a crew tile, or tap a player room containing crew (repeat taps cycle) → select; then tap a player room →
  `G.Crew.order`; selection clears after a successful order. Tapping elsewhere → none.
- System chip tap = +1 (`addPower`; on failure `deny` sound + reason in context strip) and focus it for 4 s; the − lives
  in the context strip. Vertical swipe ≥ 14px on a chip = ∓1 (expert shortcut).
- `G.Render.pickRoom(side, px, py) -> roomId|-1`: exact hit first; else nearest room whose rect expanded by
  max(0, (44 − tile)/2) px contains the point.
- Desktop: Space toggles pause.

### Canvas (render.js)
Starfield + sector-tinted nebula; both ships (hull silhouette auto-built around the rooms: inflated bounding shape +
nose at y=0 end + engine glow at the other end, tinted `ship.tint`); rooms (floor, 1.5px walls, door ticks on shared
edges, system glyph via `Path2D(G.dom.ICONS[sys])` sized 0.6×min(roomW,roomH), grey when unpowered, red when damaged,
violet when ionized); low-O2 red tint; fire; breach cracks; crew discs 0.55×tile (0.45 when >2 in a room, race color,
1.5px outline, HP bar only when hurt, selection ring, walking interpolation via `G.Crew.pos`); shield bubble (ellipse,
alpha by layers, ripple on absorb); projectiles (laser streaks, ion orbs, missiles with trails, asteroids/fleet shells);
beam charge-up glow then sweep; explosions/particles (Math.random allowed here); target reticles (14px circle + 11px slot
digit, stacked from the room's top-right); while a weapon is armed draw every enemy room's hit area outline; screen shake
on player hull hits (respect prefers-reduced-motion). LOD for tiles < 24px: no door ticks, fire as a room overlay with
one flame glyph; O2 % text only when < 50 and tile ≥ 28px.
`G.Render = { init(canvas), resize(), frame(dt), fx(ev), pickRoom(side, px, py), miniShip(canvas, template, opts) }`
(`miniShip` draws a ship template nose-up fit to a canvas — used by the newgame screen).

### Overlays
- **title** (full): 光速逃亡 in `--font-title`, tagline, `G.DEDICATION`, 继续 (if save) · 新游戏 · 玩法 · 设置, meta stats.
- **newgame**: ship cards (name, desc, `G.Render.miniShip`, weapons, crew, hull/reactor) + difficulty (简单/普通/困难) + 出发.
- **map**: vertical sector map (start bottom, exit top), undirected edges, beacons (visited dimmed, current pulsing,
  reachable highlighted, store/distress icons unless `iconsHidden`, exit/boss label, overtaken red zone rising from
  the bottom), header: sector name, fuel, '舰队 N 跳后抵达出口'. Tap a reachable beacon → detail + 跃迁 button.
  At exit: 前往下一星区. Fuel 0: 等待救援. Flee mode (from combat): title 紧急跃迁; closing returns to the fight.
- **event**: bottom sheet: text, choices (blue in `--blue-opt` with note), then result text + fx chips + 继续.
- **reward**: 胜利 / 敌舰投降 / 敌舰船员全灭 + reward chips + acquired weapon/crew + 继续.
- **offer**: center dialog '敌舰请求投降', offer text + chips, [拒绝，继续战斗] / [接受] → `answerOffer` + sync.
- **store**: tabs 补给 · 武器 (buy; sell cargo) · 船员 · 增强 (augment for sale; sell owned).
- **ship**: tabs 系统 (upgrade systems + reactor; level bars, cost, desc; augments list) · 武器 (slots + cargo; tap to
  equip/unequip) · 船员 (list, race traits, dismiss via confirm). Read-only in combat.
- **sector**: two cards (type name, desc, color, fleet speed hint) → chooseSector.
- **end**: victory/defeat, reason, stats, 再来一局 / 返回标题.
- **menu**: 继续 · 设置 · 玩法 · 放弃本局 (confirm) · 返回标题. **settings**: 音效, 震动, 战斗速度 (0.75/1/1.25),
  战斗开始时暂停, 危机时自动暂停, 新手提示. **help**: `G.data.text.help`.

### Tips (owner: view.js as `G.Tips.check(run, ev?)`)
Non-modal coach bubble (`modal:false`, `cls:'clear'`) anchored to an element, [知道了] 44px, closes also when the player
does the thing. One at a time; `Meta.tipsSeen`; skipped when `settings.tips` is false. Text in `G.data.text.tips[id]`.
t_pause (first combat start; the first combat of a run always starts paused) → pause button · t_arm → weapon card 1 ·
t_target (first arm) → context strip · t_power (first power deny or 2nd combat) → systems row · t_crew (first player
fire/breach/sysDamage) → crew grid · t_shield (first player shot absorbed) → enemy header · t_ftl (first canFlee) →
跃迁 button · t_o2 (a player room o2 < 30) → oxygen chip · t_map (first hub) → 星图 button.

### Visual language
Tokens in `base.css` (`--power` green, `--shield` cyan, `--ion` violet, `--danger` red, `--fire` orange, `--accent` amber
for selection/primary, `--blue-opt` special choices). Beveled (cut-corner) panels/buttons. Tabular figures. Chinese via
system fonts; Latin/numerals Chakra Petch. `.btn.small` only inside sheets. Chinese text ≥ 12.5px.

## 10. App glue (`src/main.js`)
```
G.App = { run, settings, meta, paused, _lastMode,
  boot(), newRun({ shipId, difficulty }), continueRun(), quitToTitle(), sync(), setPaused(bool), save() }
```
Frame loop (every rAF):
```
blocked = !run || (run.mode !== 'combat' && run.mode !== 'hub') || App.paused || G.UI.modalOpen() || !!(run.combat && run.combat.offer)
if (!blocked) { acc += min(frameDt, MAX_FRAME_DT) × settings.speed; n = 0;
  while (acc >= SIM_DT && n < 8) { acc -= SIM_DT; n++; if (G.Run.step(run, SIM_DT)) { changed = true; acc = 0; break; } }
  if (n === 8) acc = 0; } else acc = 0;
evs = run ? G.Run.drainFx(run) : []  → G.Render.fx, G.Audio.fx, vibrate (player hull hits, settings.vibrate),
        toast for msg fx outside combat, crisis auto-pause (settings.crisisPause: phase2, surgeWarn, enemyFleeing,
        first player hull ≤ 30% in a fight, first crew HP < 25% — once each per fight), G.Tips.check(run, ev)
if (changed) sync();   G.View.frame(frameDt); G.UI.update(frameDt)    // even when paused
```
`sync()` (after ANY sim action from the UI, and after mode changes):
```
want = { event:'event', reward:'reward', sectorSelect:'sector', gameover:'end', victory:'end' }[run.mode] || null
if (run.mode === 'combat' && run.combat.offer) want = 'offer'
['event','reward','sector','end','offer'].forEach(n => { if (n !== want && G.UI.isOpen(n)) G.UI.close(n) })
if (run.mode !== _lastMode) { G.UI.closeAll(e => ['menu','settings','help'].indexOf(e.name) >= 0);
   G.View.resetSel(); combat start → paused = (first combat of run) || settings.autoPause;
   into gameover/victory && !flags.metaDone → meta.runs++, wins++ on victory, bestSector, saveMeta, flags.metaDone = true }
if (want && !G.UI.isOpen(want)) G.UI.open(want)
_lastMode = run.mode; G.View.refresh(); G.UI.refresh(); G.Save.save(run)
```
Autosave every `AUTOSAVE_INTERVAL` s of combat and on `visibilitychange` → hidden (also pause). `continueRun`: load;
if null or mode gameover/victory → clear() and stay on title. Audio unlock on first pointerdown.
Artifact hot-reload (optional): `window.claude && window.claude.hot` snapshot = serialized run.

## 11. Audio (`src/ui/audio.js`)
`G.Audio = { unlock(), play(name), fx(ev), setEnabled(bool) }` — WebAudio-synthesized (no files): laser, ion, missile,
beam, hit, shield, miss, explode, bigExplode, click, deny, power, jump, alarm, fire, coin, victory, defeat, surge.
Low master volume; ≤ 1 identical sound per 60 ms.

## 12. Testing / acceptance
- `node --test tests/` passes: data integrity; power invariants (reactorUsed ≤ reactor, power ≤ usable) under random
  damage/ion; shields/ion/beam/volley ordering; burst2 vs 1 layer manned → exactly 2 hull damage; volley never
  deadlocks (missiles 0); combat-start resets (no instant flee, no pre-charged weapons); fire/breach/oxygen; crew
  pathing; crewless fire burn-out; run flow create → events → jumps → sector change → final → boss; boss beacon
  overrides overtaken/visited; save/load round-trip mid-combat is deterministic (same seed + same inputs → same state);
  events schema (every goto exists, fx/req keys known, pools satisfied, combat_X factions).
- `node tests/bot.mjs --runs 200` finishes without exceptions; reports win rate, sector reached, run length.
  Target (normal, simple bot): win rate 25–60 %, average ≥ 3 sectors cleared, 25–40 beacons per run.
- Browser: no console errors through a scripted playthrough; layout correct at the §1.5 #view sizes; no tap target
  under 40px; player tiles ≥ 22px at 360×560.
