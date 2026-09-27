// Crew races and name pool.
//   hp: max HP   speed: walk multiplier   repair: repair/breach multiplier   fire: firefighting multiplier
//   fireImmune: takes no fire damage     color: body color used by the renderer
(function () {
  'use strict';
  var G = globalThis.G;

  G.data.crew = {
    races: {
      human: {
        id: 'human', name: '人类', hp: 100, speed: 1.0, repair: 1.0, fire: 1.0, fireImmune: false,
        color: '#f2c29b', desc: '各方面都很均衡。',
      },
      engi: {
        id: 'engi', name: '机工族', hp: 100, speed: 1.0, repair: 2.0, fire: 1.0, fireImmune: false,
        color: '#79d8c4', desc: '天生的工程师，维修速度翻倍。',
      },
      rock: {
        id: 'rock', name: '岩石族', hp: 150, speed: 0.55, repair: 1.0, fire: 1.2, fireImmune: true,
        color: '#c98a5b', desc: '皮糙肉厚、不怕火，但走得很慢。',
      },
      swift: {
        id: 'swift', name: '迅影族', hp: 90, speed: 1.5, repair: 0.8, fire: 1.5, fireImmune: false,
        color: '#b9e36e', desc: '行动迅捷，灭火很快，维修稍慢。',
      },
    },
    // Weighted odds when an event/store rolls a random race.
    raceOdds: { human: 4, engi: 2, rock: 2, swift: 2 },
    names: [
      '阿亮', '小岚', '老周', '铁头', '米拉', '阿柯', '大熊', '小满', '白鸦', '阿飞',
      '朵朵', '老K', '星野', '阿澈', '南风', '石头', '青柠', '维克', '小七', '阿桑',
      '蓝鲸', '萝卜', '海燕', '老贺', '夏至', '阿吉', '凯文', '灰灰', '雷子', '小鹿',
      '北辰', '莉莉', '木木', '老韩', '雪球', '阿诺', '泽塔', '豆包', '露娜', '阿坤',
    ],
  };
})();
