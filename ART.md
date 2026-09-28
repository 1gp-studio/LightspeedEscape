# 光速逃亡 · Pixel-art direction (v2 art pass)

Goal: move the whole game from "clean vector" to **pixel art that reads like the original FTL** — chunky
steel-grey ships with visible plating, readable rooms, little pixel crew, bright pixel lasers, dithered
shields, blocky explosions — while staying 100% procedural (no image files; everything drawn in code) and
keeping every gameplay rule, layout contract and touch target from SPEC.md unchanged.

## Global rules
- **One art pixel = 2 CSS px** (`--px` in base.css). Canvas art is drawn into a low-resolution buffer and
  upscaled with `imageSmoothingEnabled = false` (CSS `image-rendering: pixelated`), so every ship, crew,
  projectile, explosion and background star lands on the same pixel grid. Text on the canvas (msg line,
  callouts, numbers) is drawn at full resolution on top so it stays legible.
- No blur, no soft gradients, no rounded corners, no drop-shadow blur. Shading = 2–4 flat tones per material,
  hard edges, occasional 2×2 dithering (checkerboard) for transparency/glows.
- Palette (extend, don't replace, the tokens in base.css):
  - hull steel: `#1b2233 #2c374f #46546f #6f7f9c #a7b4cc` (dark → light), enemy hulls tinted by `ship.tint`
  - room floor `#8d93a1` / `#6d7382` grid lines, walls `#1a1e29`, doors `#e5b64c`
  - power green `#62e07e`, shield cyan `#52c6ff`, ion violet `#9d88ff`, fire `#ff8a3d #ffd166 #c2410c`,
    danger `#ff5d5d`, O₂-low tint `#ff6f91`
  - space `#05070e #0b1022` with sparse 1-px stars in 3 brightness levels + a dithered nebula blob tinted by sector
- Fonts: Latin/digits `Silkscreen` (unambiguous digits) (`--font-ui`, loaded in index.html); Chinese stays system font (no
  simplified-Chinese pixel font on Google Fonts) — keep it bold and crisp; title keeps `ZCOOL QingKe HuangYou`.
- DOM frames: use the base.css frame system — square corners, `box-shadow: var(--pix-frame)` (dark outline +
  2px steel border + dark inner line), flat fills, hard 2px drop `var(--pix-drop)`, `steps()` animations.
  Remove clip-path bevels and gradients from view.css / screens.css.

## Canvas (render.js)
- Ships: procedural pixel hull around the room grid — layered plating with panel seams and rivets, lighter top
  edge / darker bottom edge (light from top-left), nose cone, engine block with 2–3 frame animated pixel
  thruster flame, wing/fin details generated deterministically from the template id (no randomness per frame).
  Cache the static hull per ship+size.
- Rooms: light-grey floor with 1-art-px tile grid, dark 1-px walls, yellow door gaps on shared edges; system
  glyphs as small pixel icons (≈9×9 art px) inside a dark console block; unpowered = grey, damaged = red with a
  blinking pixel spark, ionized = violet crackle. Fire = animated 3-frame pixel flames per burning tile; breach =
  black hole with jagged rim + drifting debris pixels; low O₂ = pulsing pink overlay (dithered).
- Crew: ~7×10 art-px sprites, per-race silhouette + palette (人类 skin/uniform, 机工族 teal boxy head,
  岩石族 wide brown rocky, 迅影族 slim lime), 2-frame walk cycle facing movement direction, small pixel wrench /
  extinguisher when repairing / firefighting, 1-px HP bar when hurt, selection = blinking yellow bracket corners.
- Shields: dithered ellipse outline (2 px) whose alpha/brightness reflects layers; hit = expanding pixel ring.
- Projectiles: lasers = bright 1–2 px core with colored 1-px trail (player green/red for enemy, like FTL);
  ions = pulsing blue pixel orb; missiles = tiny sprite with blinking exhaust pixels; beams = thick pixel line
  with bright core and flicker; asteroids = lumpy grey sprites.
- Explosions: blocky expanding clusters (white → yellow → orange → dark smoke), debris pixels, pixel
  screen-shake (integer offsets). Ship destruction = multi-burst sequence.
- `miniShip` (new-game cards) and any preview must use the same pixel renderer.

## HUD / overlays
- Top bar, context strip, weapon cards, system chips: FTL-like steel frames, segmented pixel bars (hull bar as
  discrete green/yellow/red blocks, power pips as square blocks), pixel icons (convert `G.dom.ICONS` usage to
  crisp rendering or add pixel variants), hard pressed states.
- Overlays (event, store, ship, map, reward, sector, end, menu, settings, help, title, new game): steel-framed
  panels, pixel section dividers, pixel star map (square beacons, dithered fleet zone, dashed pixel edges),
  title screen with a pixel starfield + pixel ship; keep all text sizes ≥ SPEC minimums.
- Keep reduced-motion support, 60 fps, and every tap target ≥ 44 px (40 compact).
