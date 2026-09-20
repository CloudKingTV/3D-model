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
- **Re-skin it.** Eight deck graphics, each driven by three colours you pick;
  grip tape colour and pattern; truck finish, tint and bushings; wheel style and
  urethane colour; hardware; veneer; lacquer gloss. Or upload your own image and
  it gets printed on the underside of the deck.
- **Built for a phone.** The customiser is a drag-up bottom sheet, the camera
  reframes around it so the board is never hidden behind the UI, and gestures,
  safe areas and orientation changes are all handled.
- **Share a build.** The Share button puts the whole configuration in the URL,
  so a link opens the exact same board on any other device.

## Trying it on your phone

**Published site.** Every push to the default branch deploys to GitHub Pages via
`.github/workflows/deploy.yml`. Open the repo's **Settings → Pages** once and set
**Source** to **GitHub Actions**; after that the site lives at
`https://<your-username>.github.io/<repo>/` — open that on your phone.

**Straight off your laptop, same Wi-Fi.** No deploy needed:

```bash
npm install
npm run dev:lan
```

Vite prints a **Network:** address such as `http://192.168.1.24:5173/`. Type that
into your phone's browser. `npm run preview` does the same for a production build.

## Running it locally

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the built site
```

Requires Node 20+. The only runtime dependency is [three.js](https://threejs.org).

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
```

Two details worth knowing if you want to extend it:

- **Deck geometry** is a parametric surface. `deckKick(x)` gives the centre-line
  height and `deckHalfWidth(x)` the outline; the solid is that surface plus a
  copy offset along its own normal, so the deck keeps a constant thickness
  through the kicks. Change `DECK_SPEC` in `src/lib/geometry.js` to reshape it.
- **Adding a skin** means adding one `draw(ctx, w, h, palette)` function to
  `DECK_SKINS` in `src/lib/textures.js`. It receives a canvas sized to the deck's
  aspect ratio and the user's three colours; everything else is automatic.
