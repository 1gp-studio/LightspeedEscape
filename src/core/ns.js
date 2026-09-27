// Global namespace. Every source file is an IIFE that attaches to G.
// Layers: core -> data -> sim (pure, no DOM, runs in node tests) -> ui (DOM/canvas) -> main.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  var G = (root.G = root.G || {});

  G.VERSION = '0.1.0';
  G.TITLE = '光速逃亡';
  G.TAGLINE = '带着情报穿越五个星区，甩开身后的叛军舰队';
  // Shown under the title on the title screen. Put your friend's name here, e.g. '送给 阿杰'.
  G.DEDICATION = '';

  G.CFG = {
    SIM_DT: 1 / 30,          // fixed simulation step (s)
    MAX_FRAME_DT: 0.25,      // clamp for long frames / tab switches
    SECTORS: 5,              // sector indices 0..4; index 4 is the final sector with the flagship
    SAVE_KEY: 'lightspeed.run.v1',
    SETTINGS_KEY: 'lightspeed.settings.v1',
    META_KEY: 'lightspeed.meta.v1',
    AUTOSAVE_INTERVAL: 10,   // seconds of combat between autosaves
  };

  G.data = G.data || {};
})();
