// Event content (SPEC §8): sector-start beacons, text events, distress calls, stores, combat intros,
// the rebel fleet, the flagship and the stranded (fuel 0) pool. All text is original Simplified Chinese.
//
//   event   = { id, tags: [pool], weight, minSector, maxSector, once, nodes: { start: Node, ... } }
//   Node    = { text, choices: [Choice] }            node text 40–140 chars
//   Choice  = { text, req?, outcomes: [Outcome] }     choice text <= 22 chars
//   Outcome = { w, text, fx?, goto?, combat?, store?: true }   text 20–120 chars ('' + nothing else = close)
//   fx      = [{ key: value }]  one effect per entry, applied by G.Events.apply
//   req     = blue (race / weaponType / weapon / system / crewCount / augment: hidden when unmet)
//             or cost gate (scrap / fuel / missiles: shown disabled; every outcome pays with a negative fx)
// tests/events.test.mjs validates schema, reachability, pools and text limits of this file.
(function () {
  'use strict';
  var G = globalThis.G;

  // A plain exit choice that closes the dialog immediately.
  function leave(text) {
    return { text: text || '离开', outcomes: [{ w: 1, text: '' }] };
  }

  G.data.events = [
    // =============================================================== start_intro (sector 0)
    {
      id: 'start_intro', tags: ['start_intro'], weight: 1, minSector: 0, maxSector: 0, once: false,
      nodes: {
        start: {
          text: '联邦舰队在五个星区之外集结待命。你的飞船载着足以扭转战局的叛军情报，而叛军舰队正沿着航道紧追不舍。燃料有限，时间更少。',
          choices: [
            { text: '全员就位，准备跃迁', outcomes: [{ w: 1, text: '' }] },
            { text: '先听听任务简报', outcomes: [
              { w: 1, text: '大副清了清嗓子，把全息星图投到了舰桥中央。', goto: 'brief' },
            ] },
          ],
        },
        brief: {
          text: '简报很短：每次跃迁消耗 1 单位燃料；叛军舰队每跳都会逼近；沿途收集废料来升级飞船。抵达第五星区，击毁叛军旗舰。其余的，随机应变。',
          choices: [
            { text: '明白，出发', outcomes: [{ w: 1, text: '' }] },
          ],
        },
      },
    },

    // =============================================================== start (sector entry beacons)
    {
      id: 'start_buoy', tags: ['start'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一个联邦补给浮标在星区入口闪着微光。它的舱门只够取走一只货箱：燃料箱和弹药箱并排卡在导轨上。',
          choices: [
            { text: '把两只货箱都拆下来', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族绕开了卡榫，两只货箱都被拖进了货舱。浮标发出一声委屈的哔哔声。', fx: [{ fuel: 2 }, { missiles: 2 }] },
            ] },
            { text: '取燃料箱', outcomes: [
              { w: 1, text: '燃料箱的封条完好无损。管道接驳完成时，轮机长长舒了一口气。', fx: [{ fuel: 3 }] },
            ] },
            { text: '取弹药箱', outcomes: [
              { w: 1, text: '弹药箱里码着几枚导弹，外壳上还印着联邦军械库的钢印。', fx: [{ missiles: 3 }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'start_wreck', tags: ['start'], weight: 1, minSector: 0, maxSector: 4, once: true,
      nodes: {
        start: {
          text: '跃迁点旁漂着一艘联邦巡逻舰的残骸。舰桥被整个削掉了，逃生舱一个都没有弹出来。残骸里还残留着微弱的能量读数。',
          choices: [
            { text: '拆下完好的反应堆模块', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族从动力舱里取出一组完好的反应堆模块，接进了你们的反应堆。多出的这一格能量，是阵亡者留下的礼物。', fx: [{ reactor: 1 }] },
            ] },
            { text: '搜刮残骸', outcomes: [
              { w: 1, text: '你们拆下了还能用的零件。没有人说话，大家都知道这些东西原本属于谁。', fx: [{ scrap: [14, 22] }] },
              { w: 1, text: '残骸的反应堆突然泄漏，辐射顺着对接管道扩散到了整艘船，你们只抢回了一点零件。', fx: [{ crewDamage: 20 }, { scrap: 8 }] },
            ] },
            { text: '为阵亡者举行太空葬礼', outcomes: [
              { w: 1, text: '遗体被送往恒星的方向。船员们沉默了很久，之后干活却比以往更卖力。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'start_convoy', tags: ['start'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一支难民船队正从星区入口经过。领头的船长认出了你们的舰徽，犹豫着要不要打招呼。难民们的船大多破旧不堪。',
          choices: [
            { text: '和同乡叙叙旧', req: { race: 'human' }, outcomes: [
              { w: 1, text: '对方船长是你一名船员的同乡。临别时他塞来一份叛军巡逻表，你们据此避开了几支巡逻队，把追兵甩远了一些。', fx: [{ fleet: -0.6 }] },
            ] },
            { text: '分给他们一些燃料', req: { fuel: 2 }, outcomes: [
              { w: 2, text: '难民们感激不尽，把船上唯一值钱的东西塞给了你们。', fx: [{ fuel: -2 }, { scrap: [20, 28] }] },
              { w: 1, text: '难民中一名年轻的机械师执意要跟你们走，说这是他报恩的唯一方式。', fx: [{ fuel: -2 }, { crew: 'random' }] },
            ] },
            { text: '主动问候', outcomes: [
              { w: 1, text: '船长提醒你们留意前方的叛军巡逻，还送来一点他们省下的物资。', fx: [{ scrap: [8, 12] }] },
              { w: 1, text: '船长只是点头致意。他们自己也所剩无几，你们没好意思多说什么。' },
            ] },
            leave('继续前进'),
          ],
        },
      },
    },
    {
      id: 'start_listening', tags: ['start'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '新星区的入口信标上挂着一枚叛军监听器，指示灯还在规律地闪烁。它显然还没有发现你们。',
          choices: [
            { text: '改写它的广播内容', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族往监听器里塞了一段假坐标。叛军舰队得白白绕上一大段远路了。', fx: [{ fleet: -0.8 }] },
            ] },
            { text: '用离子脉冲让它短路', req: { weaponType: 'ion' }, outcomes: [
              { w: 1, text: '监听器陷入了无限重启。叛军收到的最后一条报告显示：此处一切正常。', fx: [{ fleet: -0.5 }] },
            ] },
            { text: '开火摧毁它', outcomes: [
              { w: 1, text: '监听器化作一团火花，残骸里还有些值钱的元件。附近的叛军很快会注意到它失联了。', fx: [{ scrap: [10, 16] }, { fleet: 0.4 }] },
            ] },
            { text: '悄悄绕开', outcomes: [
              { w: 1, text: '你们关掉应答机，贴着信标的阴影滑了过去。监听器毫无反应。' },
            ] },
          ],
        },
      },
    },

    // =============================================================== any (event beacons, every sector)
    {
      id: 'any_derelict', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘无人应答的货船在信标旁缓缓自转。舱门半开，货舱的灯还亮着，看不出船员去了哪里。',
          choices: [
            { text: '让机工族接管主控', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族唤醒了货船的主控电脑。它乖乖打开了所有货舱，还交出了一门封存的武器。', fx: [{ scrap: [12, 18] }, { weapon: 'tier1' }] },
            ] },
            { text: '派迅影族快进快出', req: { race: 'swift' }, outcomes: [
              { w: 1, text: '迅影族在安保系统反应过来之前扫荡了半个货舱，毫发无伤地回到了船上。', fx: [{ scrap: [20, 28] }] },
            ] },
            { text: '派人登船搜索', outcomes: [
              { w: 1, text: '货舱里堆着没来得及卸下的物资，你们装走了能带走的一切。', fx: [{ scrap: [15, 25] }] },
              { w: 1, text: '舱门在身后自动闭合，通风口里爬出一群护卫机器人。船员们带着伤撤了回来。', fx: [{ crewDamage: 25 }] },
            ] },
            leave('不去冒险'),
          ],
        },
      },
    },
    {
      id: 'any_merchant', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘涂满广告的小货船主动靠了过来。船主自称是这片星域最诚实的商人，坚持要你们看看他的货。',
          choices: [
            { text: '让再生仓分析样品', req: { augment: 'replicator' }, outcomes: [
              { w: 1, text: '弹药再生仓扫描了商人的样品，当场复制出几枚一模一样的导弹。商人的脸都绿了。', fx: [{ missiles: 3 }] },
            ] },
            { text: '买燃料', req: { scrap: 12 }, outcomes: [
              { w: 1, text: '船主爽快地接上了输油管。价格不算便宜，但这里是荒郊野外。', fx: [{ scrap: -12 }, { fuel: 3 }] },
            ] },
            { text: '买导弹', req: { scrap: 15 }, outcomes: [
              { w: 1, text: '三枚导弹，编号都被磨掉了。船主眨眨眼：别问来路。', fx: [{ scrap: -15 }, { missiles: 3 }] },
            ] },
            { text: '卖掉几枚导弹', req: { missiles: 2 }, outcomes: [
              { w: 1, text: '船主仔细验了验货，数出一把废料递了过来，还夸你们保养得好。', fx: [{ missiles: -2 }, { scrap: [10, 14] }] },
            ] },
            leave('没兴趣'),
          ],
        },
      },
    },
    {
      id: 'any_ion_storm', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '前方信标被一场离子风暴吞没了。紫色的电弧在船壳上乱跳，仪表盘开始胡乱报数。导航员建议你们尽快做出决定。',
          choices: [
            { text: '靠双层护盾硬闯过去', req: { system: { id: 'shields', level: 4 } }, outcomes: [
              { w: 1, text: '双层护盾把电弧全挡在了外面。你们还顺手收集了风暴里带电的残骸。', fx: [{ scrap: [20, 28] }] },
            ] },
            { text: '冲进风暴眼', outcomes: [
              { w: 1, text: '你们在风暴眼里捕获了一团高能粒子，拆解后得到了不少废料。', fx: [{ scrap: [15, 22] }] },
              { w: 1, text: '一道电弧击穿了船壳，烧坏了一个系统。船员们手忙脚乱地开始抢修。', fx: [{ sysDamage: 'random' }, { hull: -2 }] },
            ] },
            { text: '关闭系统，等它过去', outcomes: [
              { w: 1, text: '漫长的等待之后风暴散去了。叛军舰队可没有在原地等你们。', fx: [{ fleet: 0.5 }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'any_escape_pod', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一个逃生舱在雷达上闪烁，外壳上的标识已经烧得看不清了。舱内的生命信号十分微弱，随时可能熄灭。',
          choices: [
            { text: '先让医疗舱扫描再开舱', req: { system: { id: 'medbay', level: 2 } }, outcomes: [
              { w: 1, text: '扫描确认舱内安全。幸存者在医疗舱里恢复得很快，醒来后决定留下来帮忙。', fx: [{ crew: 'random' }] },
            ] },
            { text: '拖进来打开', outcomes: [
              { w: 2, text: '里面是一名饿坏了的幸存者。吃完三份口粮后，他问你们还缺不缺人手。', fx: [{ crew: 'random' }] },
              { w: 1, text: '舱里没有人，只有一枚已经启动的诱饵炸弹。它在货舱门口炸出了一个大坑。', fx: [{ hull: -4 }] },
              { w: 1, text: '幸存者身上带着一种孢子，很快全船的人都病倒了。他本人没能撑过去。', fx: [{ crewDamage: 25 }] },
            ] },
            { text: '不去理会', outcomes: [
              { w: 1, text: '你们关掉了雷达提示音。那个信号在身后慢慢变弱，最终消失了。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'any_gambler', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座旋转的赌场空间站向所有过路飞船广播：一局定输赢，押多少赔多少，童叟无欺。广播的背景音里全是欢呼声。',
          choices: [
            { text: '让迅影族盯着荷官的手', req: { race: 'swift' }, outcomes: [
              { w: 1, text: '迅影族盯了三局，当众拆穿了荷官出老千的手法。赌场老板赶紧塞来一笔封口费。', fx: [{ scrap: [25, 32] }] },
            ] },
            { text: '押上一笔废料', req: { scrap: 15 }, outcomes: [
              { w: 1, text: '骰子停在了你这边。荷官不情不愿地推来一大堆筹码。', fx: [{ scrap: -15 }, { scrap: 30 }] },
              { w: 1, text: '庄家笑眯眯地收走了你的废料。在赌场里，庄家永远是赢家。', fx: [{ scrap: -15 }] },
            ] },
            leave('不赌'),
          ],
        },
      },
    },
    {
      id: 'any_star_whale', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一头体长数公里的星鲸正在信标附近进食。它的鳞片之间嵌着许多古老飞船的残骸，有些看上去还很值钱。',
          choices: [
            { text: '用光束切下一片鳞片', req: { weaponType: 'beam' }, outcomes: [
              { w: 1, text: '光束精准地切下了一片松动的鳞片，里面富含稀有金属。星鲸甚至没有察觉。', fx: [{ scrap: [25, 32] }] },
            ] },
            { text: '搜刮鳞片间的残骸', outcomes: [
              { w: 1, text: '星鲸毫无察觉，你们捞走了几块值钱的古董合金。', fx: [{ scrap: [18, 26] }] },
              { w: 1, text: '星鲸翻了个身，巨大的尾鳍扫中了船体，警报响成一片。', fx: [{ hull: -4 }] },
            ] },
            { text: '借它的引力场滑行', outcomes: [
              { w: 2, text: '星鲸的引力推着你们滑出一大段距离，足足省下了一次跃迁的燃料。', fx: [{ fuel: 1 }] },
              { w: 1, text: '星鲸忽然加速游走，把你们晾在了原地。船员们面面相觑。' },
            ] },
            leave('别打扰它'),
          ],
        },
      },
    },
    {
      id: 'any_sensor_ghost', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '传感器捕捉到一个时隐时现的信号，像是一艘关闭了引擎的飞船，又像是一团漂浮的碎片。',
          choices: [
            { text: '发射离子脉冲试探', req: { weaponType: 'ion' }, outcomes: [
              { w: 1, text: '离子脉冲逼出了一艘潜伏的敌舰。它的系统被打乱，只好仓皇跃迁，丢下了一批货物。', fx: [{ scrap: [15, 22] }, { missiles: 1 }] },
            ] },
            { text: '靠近查看', outcomes: [
              { w: 1, text: '是一艘装死的敌舰！等你们靠近时，它的武器已经充能完毕。', combat: { faction: 'sector' } },
              { w: 1, text: '只是一堆漂浮的集装箱。撬开一看，里面的东西还能用。', fx: [{ scrap: [15, 22] }] },
            ] },
            leave('别碰它'),
          ],
        },
      },
    },
    {
      id: 'any_rock_miners', tags: ['any'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座小型采矿站的对接口被一块小行星碎块卡住了。矿工们在频道里喊话：谁能帮忙把石头打碎？',
          choices: [
            { text: '用激光把岩块打碎', req: { weaponType: 'laser' }, outcomes: [
              { w: 1, text: '几轮点射之后，岩块碎成了小块。矿工们送来一批矿石和燃料作为报酬。', fx: [{ scrap: [15, 22] }, { fuel: 1 }] },
            ] },
            { text: '派人手动清理', outcomes: [
              { w: 1, text: '船员们拿着切割枪干了大半天，矿工们付了一笔辛苦费。', fx: [{ scrap: [10, 15] }] },
              { w: 1, text: '一块巨石突然崩裂，碎片击穿了气闸，船员们全都挂了彩。矿工们连声道歉，但没有钱。', fx: [{ crewDamage: 20 }] },
            ] },
            leave('爱莫能助'),
          ],
        },
      },
    },

    // =============================================================== civilian
    {
      id: 'civ_liner', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘客运班轮停在信标旁，引擎舱冒着白烟。船长请求协助：三百名乘客已经在太空里困了两天。',
          choices: [
            { text: '派机工族修理引擎', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族半小时就修好了引擎，顺手换掉了几段老化线路。船长坚持要付报酬。', fx: [{ scrap: [20, 28] }, { fuel: 1 }] },
            ] },
            { text: '分给他们燃料', req: { fuel: 2 }, outcomes: [
              { w: 1, text: '班轮靠你们的燃料勉强启航。乘客们凑出了满满一旅行箱的谢礼。', fx: [{ fuel: -2 }, { scrap: [18, 26] }] },
            ] },
            { text: '派船员过去帮忙', outcomes: [
              { w: 1, text: '修理不算顺利，但引擎总算重新点火了。船长付了一些废料。', fx: [{ scrap: [10, 15] }] },
              { w: 1, text: '引擎舱突然爆燃，冲击波顺着对接口震伤了整船人。班轮只能继续等待救援。', fx: [{ crewDamage: 20 }] },
            ] },
            { text: '爱莫能助', outcomes: [
              { w: 1, text: '你们离开时，班轮的求救广播还在循环播放，一遍又一遍。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'civ_farm', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一颗农业殖民星的麦田正被一种发光的真菌吞噬。农场主愿意付钱请人帮忙，但没人知道该怎么办。',
          choices: [
            { text: '用燃烧光束烧掉菌斑', req: { weapon: 'beam_fire' }, outcomes: [
              { w: 1, text: '燃烧光束从田野上空扫过，真菌在火光中化为灰烬。农场主们几乎倾尽所有来感谢你们。', fx: [{ scrap: [25, 35] }, { fuel: 2 }] },
            ] },
            { text: '让岩石族下田焚烧', req: { race: 'rock' }, outcomes: [
              { w: 1, text: '岩石族扛着火焰喷射器走进麦田，在自己点起的火海里面不改色。殖民者送来了粮食和废料。', fx: [{ scrap: [20, 28] }] },
            ] },
            { text: '派人帮忙清理', outcomes: [
              { w: 1, text: '你们铲掉了大片菌斑，一部分收成保住了。农场主付了辛苦费。', fx: [{ scrap: [10, 16] }] },
              { w: 1, text: '真菌孢子随着船员飘回了飞船，船员们全都过敏，咳了一整天。', fx: [{ crewDamage: 15 }] },
            ] },
            leave(),
          ],
        },
      },
    },
    {
      id: 'civ_volunteer', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '殖民地的港口挤满了想离开的年轻人。有人听说你们在和叛军作对，挤到舷梯前请求上船。',
          choices: [
            { text: '收下一名志愿者', outcomes: [
              { w: 2, text: '年轻人背着行李上了船，眼里闪着光。希望这份热情能撑过下一场战斗。', fx: [{ crew: 'random' }] },
              { w: 1, text: '上船第二天，这名“志愿者”就卷走了一批物资，趁着停靠溜之大吉。', fx: [{ scrap: -12 }] },
            ] },
            { text: '婉言拒绝', outcomes: [
              { w: 1, text: '你告诉他们前面的路很危险。他们说，留在这里也一样。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'civ_dock', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座民用维修船坞正在打折促销。站长围着你们的船转了一圈，说船体看起来像被小行星啃过。',
          choices: [
            { text: '和站长切磋维修技术', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '站长和你的机工族聊得忘了时间，临走前免费给你们做了一次全套保养。', fx: [{ hull: 6 }] },
            ] },
            { text: '付费修补船体', req: { scrap: 10 }, outcomes: [
              { w: 1, text: '焊枪的火花亮了一整夜，船体上最显眼的几处伤都补好了。价格还算公道。', fx: [{ scrap: -10 }, { hull: 6 }] },
            ] },
            leave('只是路过'),
          ],
        },
      },
    },
    {
      id: 'civ_broadcast', tags: ['civilian'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '殖民地电台正在直播一场才艺大赛。主持人突然呼叫你们：路过的勇士们，要不要来露一手？',
          choices: [
            { text: '让迅影族表演杂技', req: { race: 'swift' }, outcomes: [
              { w: 1, text: '迅影族的空翻快得连镜头都跟不上，全场沸腾。奖金和赞助商的礼物塞满了货舱。', fx: [{ scrap: [22, 30] }, { missiles: 1 }] },
            ] },
            { text: '派人上台表演', outcomes: [
              { w: 1, text: '你的船员唱了一首跑调的军歌，意外赢得了满堂彩和一笔奖金。', fx: [{ scrap: [15, 22] }] },
              { w: 1, text: '表演被嘘下了台。没有什么实际损失，除了全船的自尊心。' },
            ] },
            leave('婉拒'),
          ],
        },
      },
    },

    // =============================================================== hostile (rebel-controlled)
    {
      id: 'hos_checkpoint', tags: ['hostile'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '叛军检查站横在航道中央，巡逻艇的炮口正对着你们。频道里传来命令：停船，接受检查。',
          choices: [
            { text: '全速冲过检查站', req: { system: { id: 'engines', level: 3 } }, outcomes: [
              { w: 1, text: '引擎全开，你们在巡逻艇调转炮口之前就冲出了射程，只留下一串尾焰。' },
            ] },
            { text: '伪装成货船蒙混过关', outcomes: [
              { w: 1, text: '检查官扫了一眼伪造的舱单，打着哈欠挥手放行了。' },
              { w: 1, text: '伪装被识破了！巡逻艇二话不说，炮口立刻亮了起来。', combat: { faction: 'rebel' } },
            ] },
            { text: '塞点好处费', req: { scrap: 20 }, outcomes: [
              { w: 1, text: '检查官把废料揣进口袋，假装什么也没有看见。', fx: [{ scrap: -20 }] },
            ] },
            { text: '先发制人，开火！', outcomes: [
              { w: 1, text: '你们抢先开火，检查站的警报声响彻了整个频道。', combat: { faction: 'rebel' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'hos_prisoners', tags: ['hostile'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座叛军劳改营的轨道平台上关押着几十名囚犯。守卫舰只有一艘，看上去懒洋洋的，连护盾都没有全开。',
          choices: [
            { text: '派迅影族潜入开锁', req: { race: 'swift' }, outcomes: [
              { w: 1, text: '迅影族趁守卫换班溜进平台，打开了所有牢门。囚犯们四散逃生，一人执意跟你们走。', fx: [{ crew: 'random' }, { scrap: [8, 12] }] },
            ] },
            { text: '攻击守卫舰', outcomes: [
              { w: 1, text: '你们的炮口转向守卫舰。平台上的囚犯们开始拼命敲打舷窗。', combat: { faction: 'rebel', win: 'freed' } },
            ] },
            { text: '我们无能为力', outcomes: [
              { w: 1, text: '你们调转了航向。舷窗后的那些面孔，会在很多个夜里回来找你。' },
            ] },
          ],
        },
        freed: {
          text: '守卫舰已经无力阻拦。囚犯们涌向对接口，大多数人选择各自逃生，但有一个人留在了你们的气闸前。',
          choices: [
            { text: '欢迎加入', outcomes: [
              { w: 1, text: '这名前囚犯曾是联邦的技师。他说自己欠你们一条命，打算用余生来还。', fx: [{ crew: 'random' }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'hos_depot', tags: ['hostile'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座叛军补给站的守卫似乎都去参加换防仪式了。燃料罐和弹药箱就堆在外面的平台上，无人看管。',
          choices: [
            { text: '全员出动，能搬多少搬多少', req: { crewCount: 5 }, outcomes: [
              { w: 1, text: '人多力量大。守卫回来之前，你们把燃料和导弹都搬空了。', fx: [{ fuel: 3 }, { missiles: 3 }] },
            ] },
            { text: '偷燃料', outcomes: [
              { w: 1, text: '你们接上输油管抽了个痛快，全程没有人发现。', fx: [{ fuel: 3 }] },
              { w: 1, text: '警报突然响起，你们只抽到一点就仓皇撤离。叛军舰队收到了你们的坐标。', fx: [{ fuel: 1 }, { fleet: 0.6 }] },
            ] },
            { text: '偷导弹', outcomes: [
              { w: 1, text: '弹药箱比想象的轻，你们搬得飞快，全程没有人发现。', fx: [{ missiles: 3 }] },
              { w: 1, text: '一名守卫提前回来了，他拉响了警报。一艘叛军巡逻艇正在赶来。', combat: { faction: 'rebel' } },
            ] },
            leave('不冒险'),
          ],
        },
      },
    },
    {
      id: 'hos_defector', tags: ['hostile'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘叛军穿梭机发来加密通讯：一名叛军军官想要叛逃，愿意带着一箱补给投奔联邦。他请求你们立刻答复。',
          choices: [
            { text: '让人类船员先盘问他', req: { race: 'human' }, outcomes: [
              { w: 1, text: '你的船员用几个只有老兵才懂的问题试探了他。他是真心的，还带来了叛军的巡逻时刻表。', fx: [{ crew: 'human' }, { fleet: -0.5 }] },
            ] },
            { text: '接收叛逃者', outcomes: [
              { w: 2, text: '军官如约登船，还带来了一箱物资。他说：我受够了这场战争。', fx: [{ crew: 'human' }, { scrap: [8, 12] }] },
              { w: 1, text: '这是个陷阱！穿梭机背后的阴影里跳出了一艘叛军战舰。', combat: { faction: 'rebel' } },
            ] },
            { text: '拒绝，太危险了', outcomes: [
              { w: 1, text: '穿梭机孤零零地悬在信标旁。几分钟后，你们看见它被一艘叛军战舰击落了。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'hos_minefield', tags: ['hostile'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '叛军在信标周围布下了一片雷区。水雷的红色指示灯像萤火虫一样漂浮在航道上，一眼望不到头。',
          choices: [
            { text: '交给自动驾驶精算航线', req: { system: { id: 'piloting', level: 2 } }, outcomes: [
              { w: 1, text: '自动驾驶算出了一条完美的航线。你们还顺手回收了几颗没有激活的水雷。', fx: [{ missiles: 2 }] },
            ] },
            { text: '用激光逐个引爆水雷', req: { weaponType: 'laser' }, outcomes: [
              { w: 1, text: '激光一颗接一颗地引爆了水雷。爆炸后的残骸里还能捡到不少零件。', fx: [{ scrap: [12, 18] }] },
            ] },
            { text: '小心穿过', outcomes: [
              { w: 1, text: '驾驶员屏住了呼吸。你们毫发无伤地穿过了整片雷区。' },
              { w: 1, text: '一颗水雷擦着船尾爆炸了，碎片在船壳上划出了长长的伤口。', fx: [{ hull: -4 }] },
            ] },
            { text: '绕远路', outcomes: [
              { w: 1, text: '绕行花了不少时间，叛军舰队又逼近了一些。', fx: [{ fleet: 0.5 }] },
            ] },
          ],
        },
      },
    },

    // =============================================================== pirate
    {
      id: 'pir_market', tags: ['pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一个藏在小行星里的黑市向你们开放了。摊主压低声音：刚到一门军用舰炮，不问来路，价格好商量。他身后还堆着一大堆没人要的废铁。',
          choices: [
            { text: '让打捞网给废铁估价', req: { augment: 'scrap_arm' }, outcomes: [
              { w: 1, text: '打捞网的扫描仪一眼看出废铁堆里混着好货。你们用白菜价全买了下来，转手就是一笔。', fx: [{ scrap: [25, 32] }] },
            ] },
            { text: '买下那门武器', req: { scrap: 30 }, outcomes: [
              { w: 3, text: '货是真的。摊主甚至帮你们把它搬进了货舱。', fx: [{ scrap: -30 }, { weapon: 'tier2' }] },
              { w: 1, text: '拆开包装才发现是一堆废铁拼成的仿制品，摊主早已不见踪影。好歹还能拆出点废料。', fx: [{ scrap: -30 }, { scrap: 8 }] },
            ] },
            leave('只是看看'),
          ],
        },
      },
    },
    {
      id: 'pir_ransom', tags: ['pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一伙海盗扣押了一艘民船，把船员绑在舷窗前示众。海盗头子向过路船只喊价：赎一个人，二十五废料。',
          choices: [
            { text: '支付赎金救一个人', req: { scrap: 25 }, outcomes: [
              { w: 1, text: '海盗倒也守信，把一名吓坏了的船员推进了你们的气闸。她说愿意为你们工作。', fx: [{ scrap: -25 }, { crew: 'random' }] },
            ] },
            { text: '开火救人', outcomes: [
              { w: 1, text: '海盗头子骂了一句，丢下人质朝你们扑了过来。', combat: { faction: 'pirate', win: 'rescued' } },
            ] },
            { text: '这不关我们的事', outcomes: [
              { w: 1, text: '你们离开时，海盗的笑声还在公共频道里回荡。' },
            ] },
          ],
        },
        rescued: {
          text: '海盗船已经无力再战。民船上的幸存者挤在舷窗前，一个接一个地向你们敬礼。他们已经很久没见过联邦的舰徽了。',
          choices: [
            { text: '接收幸存者', outcomes: [
              { w: 1, text: '他们把仅剩的物资留给了你们，其中一人主动报名加入。', fx: [{ crew: 'random' }, { scrap: [8, 12] }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'pir_duel', tags: ['pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一名海盗船长拦住去路，却没有开火。他提议来一场赤手空拳的决斗：你们赢了，他交出一箱货；输了，你们的货归他。',
          choices: [
            { text: '派岩石族应战', req: { race: 'rock' }, outcomes: [
              { w: 1, text: '海盗船长一拳打在岩石族胸口，然后抱着手嚎了半天。他愿赌服输，交出了货箱。', fx: [{ scrap: [22, 30] }, { missiles: 1 }] },
            ] },
            { text: '派人应战', outcomes: [
              { w: 1, text: '你的船员在第三回合把海盗船长按在了地上。对方愿赌服输。', fx: [{ scrap: [18, 25] }] },
              { w: 1, text: '你的船员输了，决斗随即变成群殴，海盗们把你们全船的人都揍得鼻青脸肿，还哄笑着搬走了一些物资。', fx: [{ crewDamage: 25 }, { scrap: -10 }] },
            ] },
            { text: '拒绝决斗', outcomes: [
              { w: 1, text: '海盗船长嫌你们无趣，骂骂咧咧地掉头走了。' },
              { w: 1, text: '海盗船长认为这是奇耻大辱，当场下令开火！', combat: { faction: 'pirate' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'pir_scrap_war', tags: ['pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '两伙海盗正为一艘失事货船的打捞权火并。其中一方呼叫你们：帮我们打跑那帮杂碎，战利品分你一半！',
          choices: [
            { text: '加入战斗', outcomes: [
              { w: 1, text: '你们对准了另一伙海盗。盟友欢呼一声，然后……跃迁跑了，留下你们单挑。', combat: { faction: 'pirate', win: 'loot' } },
            ] },
            { text: '等他们两败俱伤', outcomes: [
              { w: 1, text: '双方几乎同归于尽。你们在碎片中捡到了不少好东西。', fx: [{ scrap: [15, 22] }] },
              { w: 1, text: '等你们靠近时，胜利的一方早已把失事货船搬空，只给你们留下了一串尾焰。' },
            ] },
            leave(),
          ],
        },
        loot: {
          text: '剩下的海盗四散而逃，那艘失事货船终于归你们了。它的货舱被炮火掀开了一半，但里面似乎还有东西。',
          choices: [
            { text: '打捞失事货船', outcomes: [
              { w: 1, text: '货舱的角落里还躺着一门完好的武器，外加几箱没开封的补给。', fx: [{ weapon: 'random' }, { scrap: [8, 12] }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'pir_smuggler', tags: ['pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘走私快船请求对接。船长想用一批来路不明的货物换你们的燃料，他的燃料舱快见底了。',
          choices: [
            { text: '亮出导弹发射架', req: { weaponType: 'missile' }, outcomes: [
              { w: 1, text: '走私船长瞟了一眼你们的导弹发射架，识趣地把一部分货物当作“见面礼”送了过来。', fx: [{ scrap: [15, 22] }, { missiles: 2 }] },
            ] },
            { text: '用燃料换货', req: { fuel: 2 }, outcomes: [
              { w: 2, text: '走私货是一批保养良好的导弹，比市价划算得多。', fx: [{ fuel: -2 }, { missiles: 3 }] },
              { w: 1, text: '货箱里是……成箱的罐头午餐肉。至少这个月不会有人饿着，吃不完的还能转手卖掉。', fx: [{ fuel: -2 }, { scrap: 8 }] },
            ] },
            { text: '扣下他的货', outcomes: [
              { w: 1, text: '走私船长举手投降，货物归你们了。不知为何，你心里有点不是滋味。', fx: [{ scrap: [15, 22] }] },
              { w: 1, text: '走私船长可不是好惹的，他的快船调转船头就开了火！', combat: { faction: 'pirate' } },
            ] },
            leave('不做生意'),
          ],
        },
      },
    },

    // =============================================================== nebula
    {
      id: 'neb_probe', tags: ['nebula'], weight: 1, minSector: 0, maxSector: 4, once: true,
      nodes: {
        start: {
          text: '星云深处漂着一个联邦科研探测器。天线已经折断，数据核心却还在运转，像是在等人来取。',
          choices: [
            { text: '让机工族读取数据核心', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '核心里是一份联邦的舰船改装方案。机工族连夜照着图纸改好了一个系统。', fx: [{ upgrade: 'random' }] },
            ] },
            { text: '用离子脉冲重启它', req: { weaponType: 'ion' }, outcomes: [
              { w: 1, text: '探测器重启后传来一份星云航道图。你们抄了一条近路，还拆下了它的备用电池。', fx: [{ fleet: -0.8 }, { scrap: 10 }] },
            ] },
            { text: '回收探测器', outcomes: [
              { w: 1, text: '探测器的零件拆下来，能换不少废料。精密仪器总是很值钱。', fx: [{ scrap: [14, 20] }] },
              { w: 1, text: '探测器的自毁程序被触发了。爆炸不大，但足够让人心疼。', fx: [{ hull: -3 }] },
            ] },
            leave(),
          ],
        },
      },
    },
    {
      id: 'neb_voice', tags: ['nebula'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '传感器全部失灵，只有无线电里有一个女声在反复念着一串坐标。星云把她的声音拉得很长很长。',
          choices: [
            { text: '前往那串坐标', outcomes: [
              { w: 1, text: '坐标处漂着一艘古老的补给船，货舱原封未动。播放录音的设备就在驾驶台上。', fx: [{ fuel: 2 }, { scrap: [10, 15] }] },
              { w: 1, text: '坐标处等着的是一艘敌舰。那段录音，是它设下的诱饵。', combat: { faction: 'sector' } },
              { w: 1, text: '坐标处什么也没有。无线电里的声音也消失了，仿佛从来不曾存在。' },
            ] },
            { text: '关掉无线电', outcomes: [
              { w: 1, text: '声音消失了。舰桥里安静得有些过分，没有人愿意先开口。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'neb_gas', tags: ['nebula'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '这一带的星云富含可用作燃料的氢同位素。只要打开进气口慢慢收集就行，前提是别让火花溅进去。',
          choices: [
            { text: '用氧气系统过滤杂质', req: { system: { id: 'oxygen', level: 2 } }, outcomes: [
              { w: 1, text: '氧气系统的过滤器分离出了纯净的同位素，整个过程一点风险都没有。', fx: [{ fuel: 4 }] },
            ] },
            { text: '开始采集', outcomes: [
              { w: 2, text: '进气口吞下了大团星云，燃料储罐的读数慢慢爬了上去。', fx: [{ fuel: 3 }] },
              { w: 1, text: '一团高温气体窜进管道，引发了一场小型爆燃，烧坏了一个系统。储罐里只多了一点燃料。', fx: [{ fuel: 1 }, { sysDamage: 'random' }] },
            ] },
            leave('不冒险'),
          ],
        },
      },
    },
    {
      id: 'neb_station', tags: ['nebula'], weight: 1, minSector: 0, maxSector: 4, once: true,
      nodes: {
        start: {
          text: '星云里藏着一座废弃的研究站。所有舱门都被人从外面焊死了，门上用红漆写着：别进来。',
          choices: [
            { text: '派迅影族快速侦察', req: { race: 'swift' }, outcomes: [
              { w: 1, text: '迅影族在里面的东西醒来之前抓起一台原型设备就跑，头也没回。设备还能用。', fx: [{ augment: 'random' }] },
            ] },
            { text: '切开舱门进去', outcomes: [
              { w: 1, text: '研究站里空无一人，实验台上留着一台完好的原型设备。', fx: [{ augment: 'random' }] },
              { w: 1, text: '里面的东西还活着。你的船员拼命逃了回来，但有一个人没能跑掉。', fx: [{ loseCrew: 1 }] },
              { w: 1, text: '研究站里只有灰尘和一堆看不懂的笔记。你们拆走了一些设备。', fx: [{ scrap: [10, 15] }] },
            ] },
            { text: '尊重警告，离开', outcomes: [
              { w: 1, text: '有些门还是关着比较好。你们悄悄离开，没有人回头。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'neb_ambush', tags: ['nebula'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘叛军巡逻艇在星云里迷了路，传感器和你们的一样失灵了。它离得很近，却显然没有察觉。',
          choices: [
            { text: '发动突袭', outcomes: [
              { w: 1, text: '你们悄悄绕到它的侧面才开火。先下手为强，打赢了战利品会更丰厚。', combat: { faction: 'rebel', rewardMult: 1.25 } },
            ] },
            { text: '悄悄溜走', outcomes: [
              { w: 1, text: '你们关掉所有发光的系统，顺着星云的暗流滑走了。巡逻艇始终没有察觉。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'neb_lights', tags: ['nebula'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '舷窗外的星云忽然亮起无数光点，像一群发光的水母绕着飞船打转。船上的电子设备开始嗡嗡作响。',
          choices: [
            { text: '用低功率光束引导光群', req: { weaponType: 'beam' }, outcomes: [
              { w: 1, text: '光群顺着光束聚拢又散开，在船壳上留下一层闪亮的晶体沉积。商人会爱死它的。', fx: [{ scrap: [22, 30] }] },
            ] },
            { text: '伸出机械臂捕捉一只', outcomes: [
              { w: 1, text: '光点在储藏罐里凝固成一块晶体，拿到市场上能卖个好价钱。', fx: [{ scrap: [15, 22] }] },
              { w: 1, text: '光点在机械臂上炸开，电流窜遍了半艘船，一个系统冒起了烟。', fx: [{ sysDamage: 'random' }] },
            ] },
            { text: '静静观赏', outcomes: [
              { w: 1, text: '光点绕着飞船转了三圈，然后消失在星云深处。船员们说这是个好兆头。' },
            ] },
          ],
        },
      },
    },

    // =============================================================== final (sector 4)
    {
      id: 'fin_remnant', tags: ['final'], weight: 1, minSector: 4, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘伤痕累累的联邦护卫舰认出了你们的应答码。舰长说：我们只剩下这些补给了，拿去，把情报送到。',
          choices: [
            { text: '用医疗舱救治伤员', req: { system: { id: 'medbay', level: 2 } }, outcomes: [
              { w: 1, text: '你们救治了护卫舰上的伤员。一名痊愈的炮手坚持留在你们船上，说要亲手送旗舰上路。舰长把补给也一并送了过来。', fx: [{ crew: 'human' }, { missiles: 2 }, { hull: 3 }] },
            ] },
            { text: '接受补给', outcomes: [
              { w: 1, text: '护卫舰的船员把最后的弹药和维修材料搬了过来，然后调头驶向叛军舰队。', fx: [{ missiles: 2 }, { hull: 4 }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'fin_outpost', tags: ['final'], weight: 1, minSector: 4, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '叛军在联邦基地外围设了一座监听站，正把附近每一艘飞船的动向实时汇报给旗舰。它的天线阵列正对着你们的方向。',
          choices: [
            { text: '用离子炮让它瘫痪', req: { weaponType: 'ion' }, outcomes: [
              { w: 1, text: '离子脉冲让监听站陷入了长久的沉默。旗舰暂时失去了你们的踪迹。', fx: [{ fleet: -1 }] },
            ] },
            { text: '摧毁监听站', outcomes: [
              { w: 1, text: '监听站的防卫艇拦了上来，炮口已经开始充能。', combat: { faction: 'rebel', win: 'silenced' } },
            ] },
            { text: '绕开它', outcomes: [
              { w: 1, text: '你们绕了一大圈。监听站的报告里仍然写着你们最后出现的坐标。', fx: [{ fleet: 0.5 }] },
            ] },
          ],
        },
        silenced: {
          text: '防卫艇已被解决，监听站失去了保护。在把它炸成碎片之前，你们可以先看看它的数据库。',
          choices: [
            { text: '下载数据后摧毁', outcomes: [
              { w: 1, text: '数据里有叛军的补给路线。你们顺路截下了一批燃料，再把监听站炸成了烟花。', fx: [{ fuel: 2 }, { scrap: [10, 15] }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'fin_mines', tags: ['final'], weight: 1, minSector: 4, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '联邦基地外的航道布满了叛军的智能水雷，它们会追踪引擎的热量。旗舰就在雷区的另一边。',
          choices: [
            { text: '用光束扫出一条通道', req: { weaponType: 'beam' }, outcomes: [
              { w: 1, text: '光束扫过之处，水雷接连殉爆。通道打开了，还留下了不少可以回收的残骸。', fx: [{ scrap: [12, 18] }] },
            ] },
            { text: '关闭引擎滑行穿越', outcomes: [
              { w: 1, text: '你们像一块太空垃圾一样滑过了雷区，水雷毫无反应。' },
              { w: 1, text: '一颗水雷还是嗅到了引擎的余热，在船腹下方炸开。', fx: [{ hull: -5 }] },
            ] },
            { text: '强行突破', outcomes: [
              { w: 1, text: '你们硬扛着一连串爆炸冲了过去，船壳上又多了几道焦痕。', fx: [{ hull: -3 }] },
              { w: 1, text: '爆炸震坏了一个系统，船员们在浓烟中抢修，总算冲出了雷区。', fx: [{ hull: -2 }, { sysDamage: 'random' }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'fin_frigate', tags: ['final'], weight: 1, minSector: 4, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘联邦护卫舰正被两艘叛军战舰围攻。其中一艘叛军舰转向了你们，另一艘仍在猛攻护卫舰。',
          choices: [
            { text: '迎战！', outcomes: [
              { w: 1, text: '你们挡在了护卫舰和叛军之间。战斗开始了。', combat: { faction: 'rebel', win: 'saved' } },
            ] },
            { text: '趁乱离开', outcomes: [
              { w: 1, text: '你们离开时，护卫舰的信号从雷达上消失了。没有人提起这件事。' },
            ] },
          ],
        },
        saved: {
          text: '解决了眼前的敌人后，另一艘叛军舰也撤退了。护卫舰舰长向你们致谢，并坚持要送你们一件礼物。',
          choices: [
            { text: '收下礼物', outcomes: [
              { w: 1, text: '那是一门崭新的重型激光，本该装在他们自己的舰上。舰长说：你们比我们更需要它。', fx: [{ weapon: 'laser_heavy2' }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'fin_militia', tags: ['final'], weight: 1, minSector: 4, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一颗即将被叛军占领的殖民星上，最后一批民兵挤在发射场。他们说，与其投降，不如跟着你们去打旗舰。',
          choices: [
            { text: '带上一名民兵', outcomes: [
              { w: 1, text: '一名老练的民兵登上了你们的船，其他人留下来掩护平民撤离。', fx: [{ crew: 'random' }] },
            ] },
            { text: '资助他们撤离', req: { scrap: 20 }, outcomes: [
              { w: 1, text: '你们的废料换来了撤离船的燃料。民兵队长把自己的导弹和装甲板都留给了你们。', fx: [{ scrap: -20 }, { missiles: 3 }, { hull: 4 }] },
            ] },
            { text: '他们留下更有用', outcomes: [
              { w: 1, text: '民兵们点点头，转身走向防御阵地。你们没有回头看。' },
            ] },
          ],
        },
      },
    },

    // =============================================================== distress
    {
      id: 'dis_freighter', tags: ['distress'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘货船发出求救信号：船体破裂，氧气正在泄漏。频道里能听见船员们急促的呼吸声，还有断断续续的哭喊。',
          choices: [
            { text: '派机工族修补船体', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族三下五除二补好了破口，还顺手修好了对方的氧气系统。船长感激得说不出话来。', fx: [{ scrap: [20, 28] }, { fuel: 1 }] },
            ] },
            { text: '靠上去救援', outcomes: [
              { w: 2, text: '你们及时封住了破口。船长把一批货物作为谢礼送了过来。', fx: [{ scrap: [15, 22] }] },
              { w: 1, text: '靠近后才发现那是诱饵！货船的阴影里冲出了一艘海盗船。', combat: { faction: 'pirate' } },
            ] },
            { text: '可能是陷阱，离开', outcomes: [
              { w: 1, text: '你们关掉了求救频道。那个急促的呼吸声，你以后会在梦里听见。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'dis_colony_fire', tags: ['distress'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座殖民站的反应堆舱起火了，火势正向居住区蔓延。站长请求所有能灭火的人前来支援。',
          choices: [
            { text: '派岩石族进入火场', req: { race: 'rock' }, outcomes: [
              { w: 1, text: '岩石族在火海里慢悠悠地关掉了阀门，出来时身上还冒着烟。殖民者把最好的东西都送了过来。', fx: [{ scrap: [22, 30] }, { missiles: 2 }] },
            ] },
            { text: '派迅影族灭火', req: { race: 'swift' }, outcomes: [
              { w: 1, text: '迅影族在走廊间来回穿梭，火势很快被控制住了。站长送来了燃料和废料。', fx: [{ scrap: [15, 22] }, { fuel: 2 }] },
            ] },
            { text: '派船员帮忙灭火', outcomes: [
              { w: 1, text: '大火终于被扑灭。殖民者们凑了些废料答谢你们。', fx: [{ scrap: [12, 18] }] },
              { w: 1, text: '火场突然爆燃，烈焰顺着对接口卷进了飞船，船上所有人都被烧伤。殖民站最终没能保住。', fx: [{ crewDamage: 30 }] },
            ] },
            { text: '爱莫能助', outcomes: [
              { w: 1, text: '你们离开时，殖民站的灯光一盏接一盏地熄灭了。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'dis_trap', tags: ['distress'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一个求救信号在小行星带边缘反复播放，但信号源的位置有点奇怪：它藏在一块巨大的岩石后面。',
          choices: [
            { text: '高速绕到岩石背面', req: { system: { id: 'engines', level: 3 } }, outcomes: [
              { w: 1, text: '你们高速绕到岩石背后，撞见一艘埋伏的敌舰正对着空处瞄准。它慌忙逃走，丢下了诱饵货箱。', fx: [{ scrap: [15, 22] }, { missiles: 1 }] },
            ] },
            { text: '直接过去看看', outcomes: [
              { w: 1, text: '果然是陷阱！一艘敌舰从岩石后面冲了出来，武器早已充能。', combat: { faction: 'sector' } },
              { w: 1, text: '是一名受困的矿工，他的飞船被岩石卡住了。获救后他决定跟你们走。', fx: [{ crew: 'random' }] },
            ] },
            leave('不理会'),
          ],
        },
      },
    },
    {
      id: 'dis_miner', tags: ['distress'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一名矿工的采矿艇被卡在两块旋转的小行星之间，氧气只够撑一个小时。他说他可以付钱。',
          choices: [
            { text: '用激光切开岩石', req: { weaponType: 'laser' }, outcomes: [
              { w: 1, text: '激光精准地切开了岩石。矿工把他这个月的收成全都塞给了你们。', fx: [{ scrap: [20, 28] }] },
            ] },
            { text: '用牵引索硬拉', outcomes: [
              { w: 1, text: '采矿艇被拉了出来。矿工连声道谢，付了一笔钱。', fx: [{ scrap: [12, 18] }] },
              { w: 1, text: '牵引索绷断了，反弹的钢缆砸坏了船壳。矿工最终还是自己爬了出来。', fx: [{ hull: -3 }] },
            ] },
            { text: '来不及了，离开', outcomes: [
              { w: 1, text: '频道里的呼救声越来越弱，最后只剩下沙沙的杂音。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'dis_lifeboat', tags: ['distress'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘救生艇载着十几名乘客在信标附近漂流。艇上的氧气循环器已经坏了，空气撑不了多久。',
          choices: [
            { text: '把氧气输送给救生艇', req: { system: { id: 'oxygen', level: 2 } }, outcomes: [
              { w: 1, text: '你们的氧气系统撑住了救生艇，直到附近殖民地派来接驳船。乘客们凑了一大笔答谢金。', fx: [{ scrap: [22, 30] }] },
            ] },
            { text: '把他们接上船', outcomes: [
              { w: 2, text: '乘客们挤满了走廊。在下一站下船前，一位工程师决定留下来。', fx: [{ crew: 'random' }] },
              { w: 1, text: '乘客中混着一名叛军特工，他在下船前破坏了一个系统，然后消失了。', fx: [{ sysDamage: 'random' }] },
            ] },
            { text: '发去殖民地的坐标', outcomes: [
              { w: 1, text: '你们发送了最近殖民地的坐标。能不能撑到那里，就看他们的运气了。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'dis_rebel_wreck', tags: ['distress'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘叛军运输舰受了重伤，正在发出求救信号。几十名叛军士兵挤在尚有空气的几个舱室里。',
          choices: [
            { text: '救援他们', outcomes: [
              { w: 1, text: '士兵们沉默地接受了帮助。他们的指挥官临别时送来一箱燃料，什么也没说。', fx: [{ fuel: 2 }, { scrap: [8, 12] }] },
              { w: 1, text: '一名士兵趁乱发出了你们的坐标。叛军舰队正在加速赶来。', fx: [{ fleet: 0.8 }] },
            ] },
            { text: '拆走他们的物资', outcomes: [
              { w: 1, text: '你们卸走了运输舰上所有能用的东西，包括氧气罐。没有人问那些士兵后来怎么样了。', fx: [{ scrap: [20, 28] }, { missiles: 2 }] },
            ] },
            { text: '离开', outcomes: [
              { w: 1, text: '你们离开了。这场战争里，谁也说不清自己是不是站在对的一边。' },
            ] },
          ],
        },
      },
    },

    // =============================================================== store (every outcome opens the store)
    {
      id: 'store_station', tags: ['store'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '信标旁是一座热闹的贸易站，大屏幕上滚动着今日特价。站长亲自出来迎接：要什么有什么，只要付得起。',
          choices: [
            { text: '进入商店', outcomes: [
              { w: 1, text: '对接完成。商人们已经探头探脑地打量起你们的货舱了。', store: true },
            ] },
          ],
        },
      },
    },
    {
      id: 'store_scrapyard', tags: ['store'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一座堆满废旧飞船的回收站。老板是个独眼的老机械师：我这儿的东西都能用，就是长得丑了点。',
          choices: [
            { text: '帮老板修好压缩机', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族修好了老板那台罢工多年的压缩机。老板乐得合不拢嘴，塞来一些废料，然后打开了仓库。', fx: [{ scrap: [10, 15] }], store: true },
            ] },
            { text: '看看货', outcomes: [
              { w: 1, text: '老板掀开一块油布，露出一排排擦得锃亮的“二手”货。', store: true },
            ] },
          ],
        },
      },
    },
    {
      id: 'store_caravan', tags: ['store'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一支流动商队在信标附近扎营。几艘货船首尾相连，搭成了一条热闹的集市长廊，吆喝声此起彼伏。',
          choices: [
            { text: '和商队首领喝一杯', req: { race: 'human' }, outcomes: [
              { w: 1, text: '商队首领喝得很尽兴，拍着你的肩膀送了一罐燃料，然后亲自领你们去逛集市。', fx: [{ fuel: 1 }], store: true },
            ] },
            { text: '开始交易', outcomes: [
              { w: 1, text: '商贩们纷纷招手。先看看有什么好东西吧，钱要花在刀刃上。', store: true },
            ] },
          ],
        },
      },
    },

    // =============================================================== empty
    {
      id: 'empty_void', tags: ['empty'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '这里什么也没有。只有遥远的星光，和引擎冷却时发出的轻微咔哒声。船员们难得地安静下来。',
          choices: [
            { text: '继续前进', outcomes: [{ w: 1, text: '' }] },
          ],
        },
      },
    },
    {
      id: 'empty_debris', tags: ['empty'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '信标附近漂浮着一片古老的战斗残骸，早就被人翻过无数遍了。也许还剩下点什么，也许只是浪费时间。',
          choices: [
            { text: '再翻一遍', outcomes: [
              { w: 1, text: '你们在一块装甲板背后找到了一些没被拿走的零件。', fx: [{ scrap: [8, 12] }] },
              { w: 1, text: '除了灰尘和几具不愿细看的东西，什么也没找到。' },
            ] },
            leave('不浪费时间'),
          ],
        },
      },
    },
    {
      id: 'empty_rest', tags: ['empty'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一片宁静的星域，没有信号，也没有威胁。难得的喘息机会，船员们都松了一口气，有人甚至哼起了歌。',
          choices: [
            { text: '抓紧时间检修船体', outcomes: [
              { w: 2, text: '船员们爬出舱外，补上了几块松动的装甲板。', fx: [{ hull: 2 }] },
              { w: 1, text: '检修时发现的问题比修好的还多。算了，至少心里有数了。' },
            ] },
            leave('继续前进'),
          ],
        },
      },
    },

    // =============================================================== combat_rebel
    {
      id: 'cr_patrol', tags: ['combat_rebel'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘叛军巡逻舰锁定了你们。通讯官的声音冷冰冰的：交出情报，可以饶你们不死。你们都知道这句话不可信。',
          choices: [
            { text: '报出伪造的叛军身份码', req: { race: 'human' }, outcomes: [
              { w: 1, text: '你的船员报出一串以假乱真的叛军身份码。巡逻舰犹豫片刻，放你们离开了。' },
            ] },
            { text: '准备战斗！', outcomes: [
              { w: 1, text: '你们切断了通讯。武器开始充能，巡逻舰也亮起了炮口。', combat: { faction: 'rebel' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'cr_interceptor', tags: ['combat_rebel'], weight: 1.5, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘叛军拦截舰从跃迁点里冲了出来，炮口早已亮起。看样子，它在这里等你们很久了。雷达上没有其他援兵。',
          choices: [
            { text: '迎战！', outcomes: [
              { w: 1, text: '没有时间犹豫了。拉响警报，全员进入战斗岗位！', combat: { faction: 'rebel' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'cr_bounty', tags: ['combat_rebel'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘挂着叛军旗帜的猎杀舰出现在雷达上。它的船壳上画满了击杀标记，多得有点吓人。它的炮口正在缓缓转向你们。',
          choices: [
            { text: '全速甩开它', req: { system: { id: 'engines', level: 4 } }, outcomes: [
              { w: 1, text: '你们的引擎功率远超对方预期。猎杀舰追了一阵，被远远甩开，只好悻悻放弃。' },
            ] },
            { text: '迎战', outcomes: [
              { w: 1, text: '猎杀舰的船长似乎很期待在船壳上再添一个新标记。', combat: { faction: 'rebel' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'cr_convoy', tags: ['combat_rebel'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '你们撞见一艘正在装卸补给的叛军运输舰。它的护航舰立刻调转船头，朝你们扑了过来。运输舰则忙着收起舷梯。',
          choices: [
            { text: '攻击护航舰', outcomes: [
              { w: 1, text: '先解决护航舰，那艘笨重的运输舰就跑不了了。', combat: { faction: 'rebel', win: 'cargo' } },
            ] },
            { text: '赶紧撤离', outcomes: [
              { w: 1, text: '护航舰没有追来。它的任务是保护运输舰，不是追击你们。' },
              { w: 1, text: '护航舰紧追不舍，炮火擦着船壳飞过。看来只能打一仗了。', combat: { faction: 'rebel' } },
            ] },
          ],
        },
        cargo: {
          text: '护航舰已经不再构成威胁，运输舰的船员弃船逃走了。它的货舱门还敞开着，里面堆得满满当当。',
          choices: [
            { text: '搬走补给', outcomes: [
              { w: 1, text: '货舱里堆满了燃料和导弹。叛军的后勤官今晚大概要挨骂了。', fx: [{ fuel: 2 }, { missiles: 2 }] },
            ] },
          ],
        },
      },
    },

    // =============================================================== combat_pirate
    {
      id: 'cp_toll', tags: ['combat_pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘海盗船横在航道上。船长咧嘴一笑：过路费二十五废料。不给？那就拿你们的船来抵。',
          choices: [
            { text: '让全体船员在舷窗前亮相', req: { crewCount: 5 }, outcomes: [
              { w: 1, text: '海盗船长看了看你们满船的人手，又看了看自己的，决定今天放个假。' },
            ] },
            { text: '付过路费', req: { scrap: 25 }, outcomes: [
              { w: 1, text: '海盗船长数了数废料，满意地吹了声口哨，让开了航道。', fx: [{ scrap: -25 }] },
            ] },
            { text: '拒绝', outcomes: [
              { w: 1, text: '海盗船长啐了一口：敬酒不吃吃罚酒！他的炮口亮了起来。', combat: { faction: 'pirate' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'cp_raider', tags: ['combat_pirate'], weight: 1.5, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '警报响起！一艘改装过的海盗掠夺舰正高速接近，船头焊着一对巨大的钢爪，显然不是来做生意的。',
          choices: [
            { text: '迎战！', outcomes: [
              { w: 1, text: '钢爪张开了。所有人各就各位，准备迎接冲击！', combat: { faction: 'pirate' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'cp_slavers', tags: ['combat_pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘海盗船的货舱里关着一群俘虏，船长打算把他们卖到边境矿场。看到你们，他立刻亮出了炮口。',
          choices: [
            { text: '开战，解救俘虏', outcomes: [
              { w: 1, text: '你们的武器开始充能。俘虏们还不知道，今天是他们的幸运日。', combat: { faction: 'pirate', win: 'freed' } },
            ] },
          ],
        },
        freed: {
          text: '海盗船已经无力反抗。俘虏们被接到了你们的船上，大多数人打算在下一个殖民地下船，回到各自的家乡。',
          choices: [
            { text: '问问有没有人愿意留下', outcomes: [
              { w: 1, text: '一名俘虏握着你的手说，他想亲眼看着叛军旗舰爆炸。', fx: [{ crew: 'random' }] },
              { w: 1, text: '他们都只想回家。临下船前，俘虏们凑了些废料塞给你们。', fx: [{ scrap: [10, 15] }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'cp_hunters', tags: ['combat_pirate'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘赏金猎手快船咬住了你们的尾巴。频道里循环播放着悬赏令：你们的人头值五百废料。',
          choices: [
            { text: '亮出导弹发射架', req: { weaponType: 'missile' }, outcomes: [
              { w: 1, text: '猎手掂量了一下挨一枚导弹的代价，决定去找更容易的目标。' },
            ] },
            { text: '提出付钱了事', req: { scrap: 20 }, outcomes: [
              { w: 2, text: '猎手收了钱，爽快地关掉了悬赏令。生意就是生意。', fx: [{ scrap: -20 }] },
              { w: 1, text: '猎手收了钱，然后开火了。五百比二十多得多。', fx: [{ scrap: -20 }], combat: { faction: 'pirate' } },
            ] },
            { text: '迎战', outcomes: [
              { w: 1, text: '想拿赏金？那得先问问我们的炮口答不答应。', combat: { faction: 'pirate' } },
            ] },
          ],
        },
      },
    },

    // =============================================================== combat_auto
    {
      id: 'ca_drone', tags: ['combat_auto'], weight: 1.5, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一架自动侦察机在信标附近巡航。它的扫描光束从你们的船体上扫过，停顿了一秒，然后锁定了武器舱。',
          choices: [
            { text: '迎战！', outcomes: [
              { w: 1, text: '无人机没有船员，也不会投降。要么打掉它，要么跳走。', combat: { faction: 'auto' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'ca_sentinel', tags: ['combat_auto'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘古老的自动哨舰从休眠中醒来，发出一串无人能懂的警告。它的武器舱正在缓缓展开。',
          choices: [
            { text: '发送古老的握手协议', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族用古老的机器语言和哨舰聊了几句。哨舰收起武器，还把一批储存的备件送了过来。', fx: [{ scrap: [12, 18] }] },
            ] },
            { text: '迎战', outcomes: [
              { w: 1, text: '哨舰的警告变成了一声尖啸。它不打算听解释。', combat: { faction: 'auto' } },
            ] },
          ],
        },
      },
    },
    {
      id: 'ca_hunter', tags: ['combat_auto'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘自动猎杀者停在信标的阴影里，外壳上留着几个新鲜的弹孔。它的程序只剩下一条：消灭一切。',
          choices: [
            { text: '用离子脉冲扰乱识别', req: { weaponType: 'ion' }, outcomes: [
              { w: 1, text: '离子脉冲让它的敌我识别系统短路。猎杀者把你们当成了友军，调头离开了。' },
            ] },
            { text: '迎战', outcomes: [
              { w: 1, text: '猎杀者的传感器红光一闪，所有炮口同时转向了你们。', combat: { faction: 'auto' } },
            ] },
          ],
        },
      },
    },

    // =============================================================== combat_elite (overtaken by the fleet)
    {
      id: 'ce_vanguard', tags: ['combat_elite'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '叛军舰队的先锋追上了你们。一艘精英战舰脱离编队直扑过来，身后的舰队炮火已经开始覆盖这片空域。',
          choices: [
            { text: '迎战！', outcomes: [
              { w: 1, text: '舰队炮击随时会落下。要么速战速决，要么尽快跃迁逃离。', combat: { faction: 'rebel', elite: true } },
            ] },
          ],
        },
      },
    },
    {
      id: 'ce_net', tags: ['combat_elite'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '跃迁出口处，叛军舰队早已张网以待。一艘精英战舰锁定了你们，远处舰队的炮火正在逼近。',
          choices: [
            { text: '开火！', outcomes: [
              { w: 1, text: '精英战舰的护盾比普通战舰厚得多。别恋战，跃迁引擎一充满就走。', combat: { faction: 'rebel', elite: true } },
            ] },
          ],
        },
      },
    },

    // =============================================================== boss (final beacon)
    {
      id: 'boss', tags: ['boss'], weight: 1, minSector: 4, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '叛军旗舰出现在雷达上，庞大的船体几乎遮住了身后的恒星。它的每一个炮口都转向了你们。这是最后一战。',
          choices: [
            { text: '为了联邦，开火！', outcomes: [
              { w: 1, text: '所有武器充能。这一次，没有退路，也不需要退路。', combat: { faction: 'rebel', boss: true } },
            ] },
          ],
        },
      },
    },

    // =============================================================== stranded (fuel 0, waiting for rescue)
    {
      id: 'str_trader', tags: ['stranded'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '燃料耗尽，你们只能在原地漂流，一遍遍地发出求援信号。几个小时后，一艘商船终于回应了。',
          choices: [
            { text: '讲讲你们的使命', req: { race: 'human' }, outcomes: [
              { w: 1, text: '商人听完你们的故事，把燃料罐加满后分文未取，只留下一句：替我们多打几炮。', fx: [{ fuel: 4 }] },
            ] },
            { text: '买燃料', req: { scrap: 15 }, outcomes: [
              { w: 1, text: '商人趁火打劫，要价高得离谱。但燃料就是燃料。', fx: [{ scrap: -15 }, { fuel: 3 }] },
            ] },
            { text: '恳求帮助', outcomes: [
              { w: 2, text: '商人叹了口气，还是分给了你们一点燃料：出门在外，谁都不容易。', fx: [{ fuel: 2 }] },
              { w: 1, text: '商人摇摇头走了。也许下一艘路过的船会更慷慨。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'str_quiet', tags: ['stranded'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '你们关掉了所有非必要系统，在寂静中等待。求援信号发出了一遍又一遍，却迟迟没有回音。',
          choices: [
            { text: '从管道里挤出残余燃料', req: { race: 'engi' }, outcomes: [
              { w: 1, text: '机工族把残留在管道里的燃料一点点收集起来，足够再跳上两次。', fx: [{ fuel: 2 }] },
            ] },
            { text: '继续等待', outcomes: [
              { w: 1, text: '一个联邦补给浮标漂进了牵引范围，里面还剩下一些燃料。', fx: [{ fuel: 2 }] },
              { w: 1, text: '什么也没有等到。叛军舰队的引擎光芒已经出现在星图边缘。' },
            ] },
          ],
        },
      },
    },
    {
      id: 'str_pirates', tags: ['stranded'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '求援信号引来了一艘海盗船。它绕着你们转了两圈，显然在估算这艘瘫痪的猎物值多少钱。',
          choices: [
            { text: '付钱请他们离开', req: { scrap: 20 }, outcomes: [
              { w: 1, text: '海盗收了钱，临走前还扔下一罐燃料。算是职业道德吧。', fx: [{ scrap: -20 }, { fuel: 2 }] },
              { w: 1, text: '海盗收了钱，然后开火了。对瘫痪的猎物，用不着讲信用。', fx: [{ scrap: -20 }], combat: { faction: 'pirate', win: 'siphon' } },
            ] },
            { text: '迎战', outcomes: [
              { w: 1, text: '引擎没油了，炮可还能打。让他们见识一下！', combat: { faction: 'pirate', win: 'siphon' } },
            ] },
          ],
        },
        siphon: {
          text: '海盗船已经无力再战。它的燃料舱还完好无损，船员们兴奋地接上了输油管，开始计算能抽多少。',
          choices: [
            { text: '抽取燃料', outcomes: [
              { w: 1, text: '燃料源源不断地流进储罐。这下可以继续上路了。', fx: [{ fuel: 3 }] },
            ] },
          ],
        },
      },
    },
    {
      id: 'str_federation', tags: ['stranded'], weight: 1, minSector: 0, maxSector: 4, once: false,
      nodes: {
        start: {
          text: '一艘联邦侦察艇回应了你们的求援信号。飞行员说自己也只剩下最后几罐燃料了，但愿意帮忙。',
          choices: [
            { text: '用导弹交换燃料', req: { missiles: 2 }, outcomes: [
              { w: 1, text: '飞行员正缺弹药，爽快地多分了你们一些燃料。', fx: [{ missiles: -2 }, { fuel: 4 }] },
            ] },
            { text: '请求分一点燃料', outcomes: [
              { w: 1, text: '侦察艇分给你们一些燃料，然后消失在跃迁的闪光中。', fx: [{ fuel: 2 }] },
            ] },
          ],
        },
      },
    },
  ];
})();
