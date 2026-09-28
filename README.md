# Fingerboard Studio

An interactive 3D fingerboard you can spin, inspect and re-skin — in the browser,
on a laptop or a phone. Nothing to install to look at it, and no 3D assets to
download: the deck, trucks, wheels and every graphic are generated in code.

![Fingerboard Studio](docs/preview.png)

## What it does

- **A real board, modelled procedurally.** The deck is built from its actual
  profile — flat through the middle, kicked nose and tail, rolled concave across
  the width, a rounded nose in plan view and a seven-ply laminated edge. Trucks
  are a full assembly: baseplate, tapered hanger, axles, kingpin, bushings,
  pivot, washers, axle nuts and eight mounting bolts.
- **Spin it.** Drag to orbit, scroll or pinch to zoom, two fingers to pan. Five
  framed camera stops (Hero, Top, Graphic, Side, Nose) that re-fit themselves to
  whatever size window you are in.
- **Reshape it.** Deck length, width, concave, kick height and length, wheelbase,
  wheel size and ride height are all live sliders labelled in millimetres, plus
  five stock sizes. The deck is rebuilt from those numbers, so the graphic, grip
  and hardware follow the new shape.
- **Re-skin it.** Eight deck graphics, each driven by three colours you pick;
  grip tape colour and pattern; truck finish, tint and bushings; wheel style and
  urethane colour; hardware; veneer; lacquer gloss. Or upload your own image and
  it gets printed on the underside of the deck.
- **Built for a phone.** The customiser is a drag-up bottom sheet, the camera
  reframes around it so the board is never hidden behind the UI, and gestures,
  safe areas and orientation changes are all handled.
- **Share a build.** The Share button puts the whole configuration in the URL,
  so a link opens the exact same board on any other device.

## The game

**Skate it** in the top bar drops the board you just built into a park laid out
on a desk. Ninety seconds, score as much as you can.

- **Hold** to crouch, **release** to pop. Longer hold, bigger ollie.
- **A / D** (or swipe left / right) kickflip and heelflip.
- **S / W** (or swipe down / up) pop shuv and 360 shuv.
- A flip and a shuv thrown together make a varial — they turn on separate axes,
  so both land in one air.
- Land on a rail or a ledge to grind it. Every clean landing raises the
  multiplier; a bail resets it.

The park is endless and generated from a seed: flats, kickers, quarter pipes
with coping, funboxes, concrete ledges, flat bars and gaps, getting bolder the
further you get.

Scale is the point. The deck is 96mm, the table is 700mm deep, the mug beside
the run is 85mm across and the pencil is 175mm long — real sizes, so the board
reads as tiny against things you already know the size of. A tilt-shift pass
keeps a narrow band in focus and blurs the rest, which is what a macro lens
does to something this small, and it tracks the board around the frame.

## Trying it on your phone

### Right now, no setup — over your Wi-Fi

```bash
npm install
npm run dev:lan
```

Vite prints a **Network:** address such as `http://192.168.1.24:5173/`. Type that
into your phone's browser while it is on the same network. `npm run preview`
serves a production build the same way. This needs nothing configured on GitHub.

### A permanent link — GitHub Pages

`.github/workflows/deploy.yml` builds and publishes the site on every push, but
it needs two one-time clicks that only a repo owner can do — the Actions token
is not permitted to make them:

1. **Settings → Pages → Source: GitHub Actions.** Until this is set, the deploy
   job fails with *"Get Pages site failed."*
2. **Get this branch onto the default branch.** GitHub only allows Pages
   deployments from the default branch by default, and this repo's default is
   currently `claude/marketing-posts-x-6hfk7p`. Either merge
   `claude/fingerboard-3d-viewer-s77665` into the default branch, make it the
   default (Settings → Branches), or add it under
   Settings → Environments → `github-pages` → Deployment branches.

Then re-run the workflow from the Actions tab. The site lands at
`https://cloudkingtv.github.io/3D-model/`.

## Running it locally

```bash
npm install
npm run dev             # dev server at http://localhost:5173
npm run build           # production build into dist/
npm run preview         # serve the built site
npm run build:artifact  # repackage the build as a Claude Artifact page
```

Requires Node 20+. The only runtime dependency is [three.js](https://threejs.org).

`build:artifact` writes `dist/artifact.html` — the same app with the document
skeleton stripped, for hosts that supply their own. Publish it together with the
two files in `dist/assets/` that it names.

The app adapts to being embedded in a frame: breakpoints follow its own width
rather than the viewport's, and the Share button hides itself, because a
cross-origin frame does not pass the URL hash its links depend on.

## How it is put together

```
index.html           markup shell — canvas, top bar, panel
src/main.js          wiring: store <-> viewer <-> UI, sheet drag, share, snapshot
src/styles.css       the whole UI, responsive down to small phones
src/lib/geometry.js  deck surface maths, truck sweeps, wheel lathe
src/lib/fingerboard.js  assembles the board and owns every material
src/lib/textures.js  canvas-drawn graphics: skins, grip, ply, wheels, backdrops
src/lib/viewer.js    renderer, lighting, orbit controls, camera framing
src/lib/state.js     config store, presets, localStorage and share links
src/ui/controls.js   small DOM builders (swatches, sliders, toggles, tiles)
src/ui/panel.js      the customiser tabs
src/ui/gameHud.js    score, timer, combo and the game overlays
src/game/track.js    procedural park: features and surface queries (pure)
src/game/skater.js   physics, trick state machine and scoring (pure)
src/game/props.js    table, ramps, rails and the desk clutter
src/game/scene.js    game scene, camera follow, feature recycling
src/game/tiltshift.js the miniature-faking blur
src/game/index.js    game loop, input and run lifecycle
```

Two details worth knowing if you want to extend it:

- **Deck geometry** is a parametric surface. `deckKick(x, spec)` gives the
  centre-line height and `deckHalfWidth(x, spec)` the outline; the solid is that
  surface plus a copy offset along its own normal, so the deck keeps a constant
  thickness through the kicks. `resolveShape()` turns the handful of numbers the
  Shape tab edits into the full spec every builder reads, including the derived
  ones (where the nose arc starts, how far the axles reach, ride height).
- **Reshaping rebuilds the meshes but not the materials**, so skins survive it.
  A slider drag rebuilds at reduced tessellation, at most once per frame, and
  restores full detail when the handle is released.
- **Adding a skin** means adding one `draw(ctx, w, h, palette)` function to
  `DECK_SKINS` in `src/lib/textures.js`. It receives a canvas sized to the deck's
  aspect ratio and the user's three colours; everything else is automatic.
