// Pointer input for the main view (SPEC §9 Input model). One gesture at a time (first pointer only):
//   tap          = up within 10px and 400ms of the down → G.View.tap(act, data, x, y)
//   aim          = press on the enemy zone while a weapon is armed: the room under the finger is highlighted
//                  while dragging, release commits the target (G.View.aimMove / aimEnd)
//   chip swipe   = vertical drag >= 14px on a system chip: up +1, down −1 (one more step every 22px)
//   drag-scroll  = horizontal drag on a [data-scroll] strip (quick-pick icons)
// No long-press anywhere. Suppresses context menu, text selection, pinch/double-tap zoom. Space = pause.
// Elements opt in with data-act="…" (+ data-* payload). Coordinates passed on are canvas-local CSS px.
(function () {
  'use strict';
  var G = globalThis.G;

  var TAP_DIST = 10, TAP_MS = 400, SWIPE = 14, SWIPE_STEP = 22;
  var root = null;
  var g = null;   // active gesture

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0; }
  function stop(e) { if (e.cancelable) e.preventDefault(); }

  function actEl(target) {
    var el = target && target.closest ? target.closest('[data-act]') : null;
    return el && root.contains(el) ? el : null;
  }
  // Press feedback only on controls: the zone containers (enemy / player / ctx) would brighten and shift 1px
  // against the canvas-drawn ships (and stay offset during a stationary aim hold).
  var NO_PRESS = { enemy: 1, player: 1, ctx: 1 };
  function press(el, on) { if (el && !NO_PRESS[el.getAttribute('data-act')]) el.classList.toggle('press', !!on); }

  function down(e) {
    if (g) return;                                            // first pointer only
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var el = actEl(e.target);
    var act = el ? el.getAttribute('data-act') : '';
    if (el && (el.disabled || el.classList.contains('disabled'))) { el = null; act = 'noop'; }
    var p = G.View.toCanvas(e.clientX, e.clientY);
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: now(), el: el, act: act, moved: false,
          mode: 'tap', net: 0, lastWant: 0, scroll: null, sl0: 0 };
    var sc = e.target && e.target.closest ? e.target.closest('[data-scroll]') : null;
    if (sc && root.contains(sc)) { g.scroll = sc; g.sl0 = sc.scrollLeft; }
    if (act === 'enemy' && G.View.canAim()) {
      g.mode = 'aim';
      G.View.aimMove(p.x, p.y, e.clientX, e.clientY);
    } else if (act === 'chip') g.mode = 'chip';
    press(el, true);
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function move(e) {
    if (!g || e.pointerId !== g.id) return;
    var dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.moved && dx * dx + dy * dy > TAP_DIST * TAP_DIST) { g.moved = true; if (g.mode !== 'chip') press(g.el, false); }
    if (g.mode === 'aim') {
      var p = G.View.toCanvas(e.clientX, e.clientY);
      G.View.aimMove(p.x, p.y, e.clientX, e.clientY);
      return;
    }
    if (g.mode === 'chip') {
      var ady = Math.abs(dy);
      var want = ady >= SWIPE && ady > Math.abs(dx) ? (dy < 0 ? 1 : -1) * (1 + Math.floor((ady - SWIPE) / SWIPE_STEP)) : 0;
      // Act only when the wanted step count changes (a refused step is not retried on every move), then step the
      // net change (successes only) toward it one call at a time, stopping at the first refusal. Drifting back
      // toward the start undoes steps the same way in both directions.
      if (want === g.lastWant) return;
      g.lastWant = want;
      if (want !== 0) g.swiped = true;
      var sys = g.el.getAttribute('data-sys');
      while (g.net !== want) {
        var dir = want > g.net ? 1 : -1;
        if (!G.View.chipStep(sys, dir)) break;
        g.net += dir;
      }
      return;
    }
    if (g.scroll && g.moved && Math.abs(dx) > Math.abs(dy)) {
      g.mode = 'scroll';
      g.scroll.scrollLeft = g.sl0 - dx;
    }
  }

  function up(e) {
    if (!g || e.pointerId !== g.id) return;
    var cur = g;
    g = null;
    press(cur.el, false);
    try { root.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = G.View.toCanvas(e.clientX, e.clientY);
    var isTap = !cur.moved && now() - cur.t0 <= TAP_MS;
    if (cur.mode === 'aim') { G.View.aimEnd(p.x, p.y, e.clientX, e.clientY); return; }
    if (cur.mode === 'chip' && cur.swiped) return;
    if (cur.mode === 'scroll') return;
    if (isTap) G.View.tap(cur.act, cur.el ? cur.el.dataset : {}, p.x, p.y);
  }

  function cancel(e) {
    if (!g || (e && e.pointerId !== g.id)) return;
    press(g.el, false);
    if (g.mode === 'aim') G.View.aimCancel();
    g = null;
  }

  function key(e) {
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    var r = G.App && G.App.run;
    if (!r || G.UI.modalOpen()) return;
    var inPlay = r.mode === 'combat' || r.mode === 'hub';
    if (e.code === 'Space' || e.key === ' ') {
      if (!inPlay) return;
      e.preventDefault();
      if (e.repeat) return;
      G.App.setPaused(!G.App.paused);
    } else if (e.key === 'Escape') {
      G.View.resetSel();
    } else if (/^[1-4]$/.test(e.key) && r.mode === 'combat') {
      G.View.tap('weapon', { slot: String(+e.key - 1) }, 0, 0);
    } else if (e.key === 'v' || e.key === 'V') {
      if (r.mode === 'combat') G.View.tap('volley', {}, 0, 0);
    }
  }

  function init(el) {
    root = el;
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('contextmenu', stop);
    root.addEventListener('selectstart', stop);
    root.addEventListener('dblclick', stop);
    root.addEventListener('touchmove', stop, { passive: false });
    root.addEventListener('touchstart', function (e) { if (e.touches && e.touches.length > 1) stop(e); }, { passive: false });
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    document.addEventListener('keydown', key);
  }

  G.Input = { init: init };
})();
