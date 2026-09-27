// Player-facing text that is not an event: help pages, coach tips, failure reasons, display names
// for beacon kinds / factions / hazards / combat results, end-of-run texts and sector flavor lines.
// All Simplified Chinese. Tips <= 40 chars (they sit in a small coach bubble).
(function () {
  'use strict';
  var G = globalThis.G;

  G.data.text = {
    // ---- help (menu → 玩法) ----
    help: [
      {
        title: '目标',
        body: '驾驶飞船穿越 5 个星区，在最后一个星区击毁叛军旗舰。每次跃迁消耗 1 燃料；叛军舰队每跳都会逼近，' +
          '被它追上的信标会遇到精英战舰和舰队炮击。船体归零或船员全部阵亡即告失败。',
      },
      {
        title: '暂停',
        body: '武器栏右端是暂停键（电脑上按空格）。暂停时所有指令照样能下达：分配能量、选择目标、调度船员。' +
          '每局的第一场战斗会自动暂停，不用着急。',
      },
      {
        title: '开火',
        body: '点下方的武器卡片选中武器，没供能时会自动供能。然后按住敌舰，拖到想打的舱室再松手，就锁定了目标；' +
          '也可以点两船之间状态条里的系统图标快速瞄准。再点一次卡片取消选中。导弹武器每次瞄准只发射一枚（单发）。',
      },
      {
        title: '能量',
        body: '最下方左侧的大数字是反应堆剩余能量。点系统图标 +1 格能量，在两船之间的状态条里点 − 减少；' +
          '在图标上上滑加、下滑减也可以。每门武器单独供能。受损或被离子干扰的系统，可用的格数会变少。',
      },
      {
        title: '护盾与闪避',
        body: '每 2 格护盾能量撑起 1 层护盾，能挡下激光和离子弹，但挡不住导弹；光束每遇到 1 层护盾伤害 −1。' +
          '闪避率来自引擎能量，有人驾驶和操作引擎时更高。',
      },
      {
        title: '船员',
        body: '点左侧的船员头像，或点有船员的舱室来选中他，再点一个舱室就会走过去。' +
          '站在护盾、引擎、武器、驾驶舱里的船员会操作该系统并提供加成。「全员回岗」让大家回到各自的岗位。',
      },
      {
        title: '损伤与维修',
        body: '船员会自动灭火、堵破口、修理所在舱室的系统。火会烧伤船员、损坏系统；破口会漏掉氧气。' +
          '记得给氧气系统供能，伤员送进医疗舱治疗。岩石族不怕火，机工族修得快，迅影族跑得快。',
      },
      {
        title: '跃迁与星图',
        body: '战斗中跃迁引擎会自动充能，充满后点「跃迁」即可逃离（旗舰战除外）。在星图上选择相连的信标跃迁，' +
          '也可以往回走；到达出口后前往下一个星区。燃料耗尽时只能原地等待救援。',
      },
      {
        title: '事件与商店',
        body: '信标上会发生各种事件。蓝色选项需要特定的船员种族、武器、系统或增强模块，结果通常更好。' +
          '废料可以在商店购买燃料、导弹、武器、船员和增强模块，也能在「飞船」界面升级系统和反应堆。',
      },
      {
        title: '小技巧',
        body: '先用离子或导弹打掉护盾，再用激光集火。打开「齐射」让武器一起开火，避免被护盾逐发挡下。' +
          '优先瞄准敌方的武器和护盾舱室。别把废料攒着不花——升级才是活下去的关键。',
      },
    ],

    // ---- coach tips (G.Tips; each <= 40 chars) ----
    tips: {
      t_pause: '战斗已暂停。暂停中也能下达所有指令，准备好了再点这里继续。',
      t_arm: '点武器卡片选中武器，没供能时会自动供能。',
      t_target: '按住敌舰拖到目标舱室再松手，或点这里的系统图标快速瞄准。',
      t_power: '点系统图标 +1 格能量，上滑加、下滑减。反应堆能量有限，按需分配。',
      t_crew: '点船员头像，再点受损的舱室，派他去灭火、堵破口或修理。',
      t_shield: '敌方护盾挡下了攻击。先用导弹或离子削掉护盾，或打开齐射。',
      t_ftl: '跃迁引擎已充满，点这里可以立即逃离战斗。',
      t_o2: '氧气不足！给氧气系统供能，并派人堵住破口。',
      t_map: '点「星图」选择下一个信标。每次跃迁消耗 1 燃料。',
    },

    // ---- failure reasons (powerBlock / toggleBlock / weaponState.why / shop & run results) ----
    reasons: {
      // powerBlock
      noSystem: '没有安装这个系统',
      max: '该系统的能量已满',
      broken: '系统已损坏，需要维修',
      ion: '系统受到离子干扰',
      reactor: '反应堆能量不足',
      fixed: '驾驶舱无需分配能量',
      // toggleBlock (reactor / broken shared with powerBlock)
      capacity: '武器系统容量不足，请升级武器系统',
      // weaponState.why
      charging: '充能中',
      off: '未供能',
      noTarget: '未选择目标',
      noMissiles: '导弹耗尽',
      volley: '等待齐射',
      noCombat: '不在战斗中',
      // shop / ship / run
      combat: '战斗中无法操作',
      fuel: '燃料不足',
      scrap: '废料不足',
      missiles: '导弹不足',
      cargoFull: '货舱已满',
      crewFull: '船员已满',
      lastCrew: '不能解雇最后一名船员',
      maxLevel: '已达到最高等级',
      notAdjacent: '该信标不相连',
      finalSector: '必须击毁叛军旗舰',
      augmentFull: '增强模块已满（最多 3 个）',
      soldOut: '已售罄',
      owned: '已经拥有该增强模块',
      noSlot: '没有空余的武器槽',
      notExit: '只能从星区出口离开',
      noStore: '这里没有商店',
      noFlee: '跃迁引擎尚未充满',
      boss: '无法从旗舰战中逃离',
    },

    // ---- display names ----
    kindNames: {
      start: '起点',
      event: '未知信号',
      combat: '敌舰信号',
      store: '商店',
      empty: '空旷星域',
      distress: '求救信号',
      boss: '叛军旗舰',
      exit: '星区出口',
    },
    factionNames: {
      player: '联邦',
      rebel: '叛军',
      pirate: '海盗',
      auto: '自动无人舰',
    },
    hazardNames: {
      none: '无',
      asteroid: '小行星带',
      sun: '恒星耀斑',
      fleet: '舰队炮击',
    },
    resultNames: {
      win: '胜利',
      derelict: '敌舰船员全灭',
      surrender: '敌舰投降',
      enemyFled: '敌舰逃走了',
      lose: '战败',
    },

    // ---- end of run (end.reason) ----
    endTexts: {
      hull: '船体在最后一次爆炸中解体。情报随着残骸散落在群星之间，叛军舰队继续向联邦推进。',
      crew: '最后一名船员倒下了。飞船仍在自动航行，像一座漂流的墓碑，再也不会抵达任何地方。',
      flagship: '叛军旗舰在连串爆炸中解体，火光照亮了半个星区。情报安全送达，联邦舰队开始反攻。' +
        '你们的名字会被写进史书——至少会出现在脚注里。',
    },

    // ---- one line per sector type (sector select / hub card) ----
    sectorFlavor: {
      civilian: '商船往来的繁忙航线，求救信号和生意一样多。',
      hostile: '叛军巡逻艇无处不在，每个信标都可能是陷阱。',
      pirate: '这里没有法律，只有价码。',
      nebula: '浓雾遮住了扫描仪，也遮住了追兵的视线。',
      final: '联邦基地就在前方，叛军旗舰挡在中间。',
    },
  };
})();
