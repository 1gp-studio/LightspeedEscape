// All gameplay tuning constants in one place. Balance passes edit THIS file first.
// Units: time in seconds, oxygen in percent (0..100), crew HP in points, rates per second.
(function () {
  'use strict';
  var G = globalThis.G;

  G.data.rules = {
    // ---- power / systems ----
    evasionByEngine: [0, 5, 10, 15, 20, 25, 28, 31, 35], // index = engines power
    evasionMannedEngines: 5,
    evasionMannedPilot: 5,
    evasionMax: 60,
    autopilot: [0, 0, 0.5, 0.8],   // evasion multiplier when piloting is UNMANNED, index = piloting usable level
    crewlessPilotMult: 1.0,        // crewless (drone) ships: piloting always counts as working
    shieldRecharge: 2.0,           // seconds to restore one layer
    mannedShieldMult: 1.1,         // recharge speed multiplier when shields are manned
    mannedWeaponMult: 1.1,         // weapon charge speed multiplier when weapons are manned
    ftlTimeBase: 32, ftlTimePerEngine: 3, ftlTimeMin: 8, // FTL charge time = max(min, base - perEngine * enginesPower)
    weaponDecay: 3,                // seconds of charge lost per second while a weapon is unpowered
    ionDuration: 5,                // seconds per ion stack
    ionMaxStacks: 2,               // a system never holds more than this many ion stacks

    // ---- crew work (progress per second per crew member, times race multipliers) ----
    repairRate: 0.18,              // system repair; 1.0 progress = 1 damage bar fixed
    fireExtRate: 0.35,             // 1.0 progress = 1 burning tile extinguished
    breachRate: 0.25,              // 1.0 progress = 1 breach sealed
    crewWalkTilesPerSec: 2.6,      // times race.speed
    crewlessSelfRepair: 1 / 8,     // crewless ships repair this many bars per second on their own

    // ---- crew damage / healing ----
    crewDmgPerDmg: 15,             // default crew damage per point of weapon damage in the hit room
    fireCrewDps: 3,                // per crew in a burning room ...
    fireCrewDpsPerTile: 1,         // ... plus this per burning tile
    suffocateBelow: 5,             // oxygen % below which crew suffocate
    suffocateDps: 5,
    medbayHps: [0, 6, 12, 18],     // index = medbay power

    // ---- environment ----
    oxygenRate: [0, 1.2, 2.2, 3.2],// % per second added to every room, index = oxygen power
    oxygenLeak: 0.5,               // % per second lost everywhere when oxygen power is 0
    oxygenDiffuse: 0.8,            // fraction of the difference exchanged per second between adjacent rooms
    breachDrain: 8,                // % per second per breach
    fireO2Use: 1.5,                // % per second per burning tile
    fireSysDmgRate: 0.08,          // system damage progress per second per burning tile
    fireGrowInterval: 5,           // seconds between fire growth/spread checks in a room
    fireGrowChance: 0.5,           // chance to add a burning tile (needs oxygen >= fireNeedO2)
    fireSpreadChance: 0.35,        // chance to ignite one adjacent room (times burning fraction)
    fireNeedO2: 30,
    fireDieBelowO2: 10,            // below this oxygen, one burning tile dies every fireGrowInterval

    // ---- projectiles ----
    // Seconds in the air. Ordered so a simultaneous volley lands ion -> missile -> laser -> beam
    // (ions strip shields first, beams sweep last). For beams this is the charge-up before the sweep.
    flight: { ion: 0.9, missile: 1.1, laser: 1.2, beam: 1.9, asteroid: 1.6, fleet: 1.6 },
    burstGap: 0.22,                // seconds between shots of one burst
    beamSweep: 0.8,                // seconds for a beam to cross its rooms

    // ---- hazards ----
    asteroidInterval: [5, 9],      // seconds between asteroid impacts (each ship rolls separately)
    flareInterval: [22, 30],       // seconds between solar flares
    flareFires: 2,                 // rooms ignited per ship per flare
    fleetShotInterval: [9, 13],    // 'fleet' hazard (overtaken beacons): barrage on the player only
    fleetShot: { dmg: 1, sysDmg: 1, fire: 0.1, breach: 0.1 },

    // ---- AI ----
    aiThinkInterval: 1.0,
    enemyFleeHullFrac: 0.3,
    enemySurrenderHullFrac: 0.4,
    enemyFtlTime: 32,              // enemy flee charge = max(enemyFtlTimeMin, enemyFtlTime - ftlTimePerEngine * engines)
    enemyFtlTimeMin: 15,

    // ---- combat end ----
    endDelay: 1.6,                 // seconds between a decisive event and combat.result being set (explosion anim)

    // ---- economy ----
    fuelPrice: 3,
    missilePrice: 5,
    hullRepairPrice: [2, 2, 3, 3, 4], // scrap per hull point, index = sector
    crewPrice: { human: 45, engi: 50, rock: 55, swift: 45 },
    sellMult: 0.5,
    cargoMax: 4,
    maxCrew: 8,
    reward: {
      scrapBase: [15, 23],
      scrapPerSector: 0.4,        // scrap *= 1 + scrapPerSector * sector
      fuelChance: 0.55, fuel: [1, 3],
      missileChance: 0.65, missiles: [2, 3],
      weaponChance: 0.08,
      crewChance: 0.04,
      derelictMult: 1.4,           // enemy crew all dead
      surrenderMult: 0.7,
      eliteMult: 0.4,              // fleet (overtaken beacon) fights pay little
    },
    eventScrapPerSector: 0.2,      // positive event scrap *= 1 + this * sector

    difficulty: {
      easy:   { label: '简单', scrapMult: 1.25, enemyHull: -2, enemyPower: -1, fleetMult: 0.85 },
      normal: { label: '普通', scrapMult: 1.0,  enemyHull: 0,  enemyPower: 0,  fleetMult: 1.0 },
      hard:   { label: '困难', scrapMult: 0.85, enemyHull: 2,  enemyPower: 1,  fleetMult: 1.1 },
    },

    // ---- map / rebel fleet ----
    sectorRows: 7,                 // rows 0..6: row 0 = start beacon, last row = exit beacon
    finalRows: 5,
    fleetStart: -1.0,              // fleet front, in row units; beacons with row <= fleet are overtaken
    sameRowEdgeChance: 0.5,        // chance to link horizontally adjacent beacons in a row
    waitFleetAdvance: 1.0,         // multiplier of sector fleet speed when waiting for rescue (stranded)

    // ---- reactor ---- cost to go from R to R+1 = reactorCostBase + (R - 8) * reactorCostStep
    reactorMax: 25,
    reactorCostBase: 15,
    reactorCostStep: 2,

    // ---- augments (passive ship upgrades; at most augmentMax installed) ----
    augmentMax: 3,
    augments: {
      scrap_arm:      { name: '残骸打捞网', cost: 40, desc: '获得的废料 +10%。' },
      pre_igniter:    { name: '热启动电容', cost: 55, desc: '战斗开始时所有已供能武器立即充满。' },
      auto_loader:    { name: '急速供弹链', cost: 45, desc: '武器充能速度 ×1.1。' },
      shield_booster: { name: '护盾谐振器', cost: 45, desc: '护盾恢复时间 ×0.8。' },
      replicator:     { name: '弹药再生仓', cost: 35, desc: '发射导弹时有 25% 几率不消耗导弹。' },
      ftl_booster:    { name: '曲率预热环', cost: 30, desc: '跃迁引擎充能速度 ×1.35。' },
    },
    augmentFx: { scrapMult: 1.1, autoLoaderMult: 1.1, shieldBoosterMult: 0.8, replicatorChance: 0.25, ftlBoosterMult: 1.35 },
  };
})();
