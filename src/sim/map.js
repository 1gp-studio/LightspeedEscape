// Sector map: beacon graph generation, rebel fleet advance and map queries.
//   G.Map.generate(run, sectorIndex, typeId) -> Sector
//   neighbors / beacon / isOvertaken / advanceFleet / fleetEta / jumpsLeft / reachable / iconsHidden
// Pure sim module: all randomness through G.RNG with run.rng.
(function () {
  'use strict';
  var G = globalThis.G;

  var X_LO = 0.12, X_HI = 0.88, MIN_GAP = 0.22;
  var EPS = 1e-6;

  function rules() { return G.data.rules; }
  function typeOf(sector) { return G.data.sectors.types[sector.type] || G.data.sectors.types.civilian; }
  function diffOf(run) { var d = rules().difficulty; return d[run.difficulty || 'normal'] || d.normal; }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  // ------------------------------------------------------------------ generation helpers

  // n x positions in [X_LO, X_HI], sorted, pairwise >= MIN_GAP apart.
  function placeRow(rng, n) {
    var xs, i, ok;
    for (var tries = 0; tries < 60; tries++) {
      xs = [];
      for (i = 0; i < n; i++) xs.push(G.RNG.range(rng, X_LO, X_HI));
      xs.sort(function (a, b) { return a - b; });
      ok = true;
      for (i = 1; i < n; i++) if (xs[i] - xs[i - 1] < MIN_GAP) { ok = false; break; }
      if (ok) return xs.map(round3);
    }
    xs = [];
    for (i = 0; i < n; i++) xs.push(round3(X_LO + (X_HI - X_LO) * (i + 0.5) / n));
    return xs;
  }

  // Do two edges between the same pair of rows cross? e = [upperRowBeacon, lowerRowBeacon] (by x).
  function crosses(ea, eb) {
    if (ea[0] === eb[0] || ea[1] === eb[1]) return false;
    return (ea[0].x - eb[0].x) * (ea[1].x - eb[1].x) < 0;
  }

  function byDistance(list, x) {
    return list.slice().sort(function (a, b) {
      var d = Math.abs(a.x - x) - Math.abs(b.x - x);
      return d !== 0 ? d : a.id - b.id;
    });
  }

  // ------------------------------------------------------------------ generate
  function generate(run, sectorIndex, typeId) {
    var R = rules(), rng = run.rng;
    var type = G.data.sectors.types[typeId] || G.data.sectors.types.civilian;
    var isFinal = type.id === 'final';
    var nRows = isFinal ? R.finalRows : R.sectorRows;
    var beacons = [], rows = [], r, i;

    function add(row, x, kind) {
      var b = { id: beacons.length, row: row, x: x, kind: kind, faction: null, exit: false, visited: false,
                hazard: 'none', store: null };
      beacons.push(b);
      rows[row].push(b);
      return b;
    }

    // --- beacons per row
    for (r = 0; r < nRows; r++) {
      rows.push([]);
      if (r === 0) add(0, 0.5, 'start');
      else if (r === nRows - 1) add(r, 0.5, isFinal ? 'boss' : null).exit = true;
      else if (isFinal && r === nRows - 2) add(r, 0.5, 'store');
      else {
        var xs = placeRow(rng, G.RNG.int(rng, 2, 3));
        for (i = 0; i < xs.length; i++) add(r, xs[i], null);
      }
    }

    // --- kinds (type.kinds), store guarantee in normal sectors (never the start or the exit beacon)
    beacons.forEach(function (b) { if (b.kind === null) b.kind = G.RNG.weightedKey(rng, type.kinds) || 'event'; });
    if (!isFinal) {
      var middle = beacons.filter(function (b) { return b.row > 0 && !b.exit; });
      if (!middle.some(function (b) { return b.kind === 'store'; })) G.RNG.pick(rng, middle).kind = 'store';
    }

    // --- factions and hazards
    beacons.forEach(function (b) {
      if (b.kind === 'start') return;
      b.faction = b.kind === 'boss' ? 'rebel' : (G.RNG.weightedKey(rng, type.factions) || 'rebel');
      if (b.kind === 'combat') b.hazard = G.RNG.weightedKey(rng, type.hazards || { none: 1 }) || 'none';
    });

    // --- edges (undirected; stored as [lowerId, higherId], no duplicates)
    var edges = [], seen = {};
    function link(a, b) {
      var lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id), k = lo + '-' + hi;
      if (lo === hi || seen[k]) return false;
      seen[k] = true;
      edges.push([lo, hi]);
      return true;
    }
    for (r = 0; r < nRows - 1; r++) {
      var cur = rows[r], nxt = rows[r + 1], vert = [], linked = {};
      var addVert = function (a, b) { if (link(a, b)) { vert.push([a, b]); linked[b.id] = true; } };
      var freeOfCrossing = function (a, b) {
        for (var k = 0; k < vert.length; k++) if (crosses([a, b], vert[k])) return false;
        return true;
      };
      // 1. each beacon -> its nearest in the next row (nearest links never cross)
      cur.forEach(function (a) { addVert(a, byDistance(nxt, a.x)[0]); });
      // 2. sometimes a second nearest link, if it does not cross
      cur.forEach(function (a) {
        if (nxt.length < 2 || G.RNG.int(rng, 1, 2) < 2) return;
        var second = byDistance(nxt, a.x)[1];
        if (freeOfCrossing(a, second)) addVert(a, second);
      });
      // 3. every next-row beacon gets at least one link
      nxt.forEach(function (b) {
        if (linked[b.id]) return;
        var cands = byDistance(cur, b.x);
        var pick = G.U.find(cands, function (a) { return freeOfCrossing(a, b); }) || cands[0];
        addVert(pick, b);
      });
    }
    // horizontal neighbours
    rows.forEach(function (row) {
      var sorted = row.slice().sort(function (a, b) { return a.x - b.x; });
      for (var k = 1; k < sorted.length; k++) {
        if (G.RNG.chance(rng, R.sameRowEdgeChance)) link(sorted[k - 1], sorted[k]);
      }
    });

    var names = G.data.sectors.names[type.id] || [type.name];
    var sector = {
      index: sectorIndex, type: type.id, name: G.RNG.pick(rng, names) || type.name, rows: nRows,
      beacons: beacons, edges: edges, start: 0, exit: beacons.length - 1, fleet: R.fleetStart,
    };

    // final sector: the fixed store before the flagship is stocked up front (repair, >= 4 fuel, >= 4 missiles)
    if (isFinal && G.Store && typeof G.Store.create === 'function') {
      beacons.forEach(function (b) {
        if (b.kind === 'store') b.store = G.Store.create(run, { sectorIndex: sectorIndex, final: true });
      });
    }
    return sector;
  }

  // ------------------------------------------------------------------ queries
  function beacon(sector, id) { return sector.beacons[id] || null; }

  function neighbors(sector, id) {
    var out = [];
    sector.edges.forEach(function (e) {
      if (e[0] === id) out.push(e[1]);
      else if (e[1] === id) out.push(e[0]);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function isOvertaken(sector, b) {
    if (typeof b === 'number') b = sector.beacons[b];
    return !!b && b.row <= sector.fleet + EPS;
  }

  // Fleet front advances by type.fleetSpeed × difficulty.fleetMult × mult rows.
  function advanceFleet(run, mult) {
    var s = run.sector;
    var step = typeOf(s).fleetSpeed * diffOf(run).fleetMult * (mult == null ? 1 : mult);
    s.fleet = Math.round((s.fleet + step) * 1e6) / 1e6;
    return s.fleet;
  }

  // Jumps until the fleet covers the beacon (default: the current beacon). 0 = already overtaken.
  function fleetEta(run, beaconId) {
    var s = run.sector;
    var b = s.beacons[beaconId == null ? run.at : beaconId];
    if (!b) return 0;
    if (isOvertaken(s, b)) return 0;
    var speed = typeOf(s).fleetSpeed * diffOf(run).fleetMult;
    if (speed <= 0) return 99;
    return Math.max(1, Math.ceil((b.row - s.fleet) / speed - EPS));
  }

  // Shortest hop count from a beacon to the sector exit (BFS). -1 if unreachable.
  function jumpsLeft(sector, fromId) {
    var dist = {}, q = [fromId];
    dist[fromId] = 0;
    while (q.length) {
      var a = q.shift();
      if (a === sector.exit) return dist[a];
      neighbors(sector, a).forEach(function (b) {
        if (dist[b] == null) { dist[b] = dist[a] + 1; q.push(b); }
      });
    }
    return -1;
  }

  function reachable(run) {
    if (!run.sector) return [];
    return neighbors(run.sector, run.at).filter(function (id) { return G.Run.canJump(run, id).ok; });
  }

  function iconsHidden(run) {
    return !!(run.sector && typeOf(run.sector).hidesIcons);
  }

  G.Map = {
    generate: generate,
    neighbors: neighbors,
    beacon: beacon,
    isOvertaken: isOvertaken,
    advanceFleet: advanceFleet,
    fleetEta: fleetEta,
    jumpsLeft: jumpsLeft,
    reachable: reachable,
    iconsHidden: iconsHidden,
    typeOf: typeOf,
  };
})();
