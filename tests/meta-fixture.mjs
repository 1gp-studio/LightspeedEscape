// Shared fixtures for the sim-meta tests (map / run / save). Not a test file itself.
//   installEvents(G)        replaces G.data.events with a small, known event set
//   ready(G)                true when the sim-combat modules are implemented (not stubs)
//   newRun(G, opts)         G.Run.create with the fixture events installed
//   installRandomGuard(G)   makes Math.random throw inside the sim realm

const leave = { text: '离开', outcomes: [{ w: 1, text: '' }] };
const simple = (id, tags, extra = {}) => ({
  id, tags, weight: 1, minSector: 0, maxSector: 4, once: false,
  nodes: { start: { text: id, choices: [{ text: '好', outcomes: [{ w: 1, text: id + ' 结束' }] }] } },
  ...extra,
});
const fight = (id, tags, combat) => ({
  id, tags, weight: 1, minSector: 0, maxSector: 4,
  nodes: { start: { text: id, choices: [{ text: '开战', outcomes: [{ w: 1, text: '开战', combat }] }] } },
});

export const FIXTURE_EVENTS = [
  simple('intro', ['start_intro']),
  simple('st_a', ['start']),
  simple('any_a', ['any']),
  simple('hostile_a', ['hostile']),
  simple('pirate_a', ['pirate']),
  simple('nebula_a', ['nebula']),
  simple('final_a', ['final']),
  {
    id: 'civ_test', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: true,
    nodes: {
      start: {
        text: '测试事件',
        choices: [
          { text: '机工族', req: { race: 'engi' }, outcomes: [{ w: 1, text: '蓝', fx: [{ scrap: 10 }] }] },
          { text: '付钱', req: { scrap: 20 }, outcomes: [{ w: 1, text: '付了', fx: [{ scrap: -20 }, { fuel: 3 }], goto: 'b' }] },
          { text: '开打', outcomes: [{ w: 1, text: '打', combat: { faction: 'pirate', win: 'after' } }] },
          { text: '商店', outcomes: [{ w: 1, text: '店', store: true }] },
          { text: '离子', req: { weaponType: 'ion' }, outcomes: [{ w: 1, text: '离子蓝' }] },
          { text: '护盾8', req: { system: { id: 'shields', level: 8 } }, outcomes: [{ w: 1, text: 'x' }] },
          leave,
        ],
      },
      b: { text: '第二页', choices: [{ text: '结束', outcomes: [{ w: 1, text: '再见', fx: [{ missiles: 1 }] }] }] },
      after: { text: '战后', choices: [{ text: '收下', outcomes: [{ w: 1, text: '谢谢', fx: [{ scrap: 5 }] }] }] },
    },
  },
  {
    id: 'locked', tags: ['locked'], weight: 1,
    nodes: { start: { text: '只有付费选项', choices: [
      { text: '付钱', req: { fuel: 999 }, outcomes: [{ w: 1, text: '付了' }] },
    ] } },
  },
  {
    id: 'late_only', tags: ['late'], weight: 1, minSector: 3, maxSector: 4,
    nodes: { start: { text: 'late', choices: [leave] } },
  },
  fight('cr', ['combat_rebel'], { faction: 'rebel' }),
  fight('cp', ['combat_pirate'], { faction: 'pirate' }),
  fight('ca', ['combat_auto'], { faction: 'auto' }),
  fight('elite', ['combat_elite'], { faction: 'rebel', elite: true }),
  fight('boss', ['boss'], { faction: 'rebel', boss: true }),
  simple('distress_a', ['distress']),
  {
    id: 'store_a', tags: ['store'], weight: 1,
    nodes: { start: { text: '商店', choices: [{ text: '逛逛', outcomes: [{ w: 1, text: '', store: true }] }] } },
  },
  simple('empty_a', ['empty']),
  {
    id: 'stranded_a', tags: ['stranded'], weight: 1,
    nodes: { start: { text: '求救', choices: [{ text: '等', outcomes: [{ w: 1, text: '来了', fx: [{ fuel: 3 }] }] }] } },
  },
];

export function installEvents(G, events = FIXTURE_EVENTS) {
  G.data.events = JSON.parse(JSON.stringify(events));
}

export function ready(G, ...mods) {
  const need = mods.length ? mods : ['Ship.createPlayer', 'Crew.create', 'Combat.create', 'Combat.step', 'Combat.idle',
    'Enemies.generate', 'AI.init'];
  return need.every((path) => {
    const [a, b] = path.split('.');
    return G[a] && typeof G[a][b] === 'function';
  });
}

export function newRun(G, opts = {}) {
  installEvents(G, opts.events);
  return G.Run.create({ seed: opts.seed || 1234, shipId: opts.shipId || 'falcon', difficulty: opts.difficulty || 'normal' });
}

// Make Math.random throw inside G's vm realm (the sim must only use G.RNG).
export function installRandomGuard(G) {
  const RealmFunction = G.U.clamp.constructor;
  new RealmFunction("Math.random = function () { throw new Error('Math.random used in sim'); };")();
}
