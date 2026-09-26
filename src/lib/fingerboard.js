import * as THREE from 'three';
import {
  resolveShape,
  shapeBounds,
  buildDeckGeometry,
  buildDeckSurfaceGeometry,
  buildHangerGeometry,
  buildBaseplateGeometry,
  buildWheelGeometry,
  buildHexGeometry,
  deckKick,
  deckSlope,
  deckHalfWidth,
} from './geometry.js';
import {
  createDeckGraphic,
  createVeneerTexture,
  createPlyTexture,
  createGripTextures,
  createGripDecal,
  createWheelTexture,
} from './textures.js';

// Rebuilding the deck costs a few milliseconds, which is too much to spend on
// every tick of a slider drag, so a drag gets a coarser mesh and at most one
// rebuild per frame. The full mesh comes back when the handle is released.
const FULL_SEGMENTS_U = 140;
const FULL_SEGMENTS_V = 20;
const DRAFT_SEGMENTS_U = 56;
const DRAFT_SEGMENTS_V = 12;

/** Physical look-up for each truck finish; the tint itself comes from config. */
const TRUCK_FINISHES = {
  polished: { metalness: 1.0, roughness: 0.11 },
  raw: { metalness: 1.0, roughness: 0.44 },
  black: { metalness: 0.7, roughness: 0.38 },
  gold: { metalness: 1.0, roughness: 0.17 },
  anodised: { metalness: 0.92, roughness: 0.24 },
};

export const TRUCK_FINISH_LIST = [
  { id: 'polished', name: 'Polished', color: '#b9c0c9' },
  { id: 'raw', name: 'Raw', color: '#9aa1ab' },
  { id: 'black', name: 'Black', color: '#2a2d33' },
  { id: 'gold', name: 'Gold', color: '#d9a441' },
  { id: 'anodised', name: 'Anodised', color: '#7b5cff' },
];

function disposeTexture(texture) {
  if (texture) texture.dispose();
}

export function createFingerboard() {
  const root = new THREE.Group();
  const spinner = new THREE.Group(); // separate so auto-rotate never fights the camera
  root.add(spinner);

  /* ----------------------------------------------------------- materials */

  const woodMaterial = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.0 });
  const graphicMaterial = new THREE.MeshPhysicalMaterial({
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
  });
  const plyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0.0 });
  const gripMaterial = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0, bumpScale: 0.06 });
  const gripDecalMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const truckMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.12 });
  const bushingMaterial = new THREE.MeshPhysicalMaterial({
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.8,
    transparent: true,
    opacity: 0.92,
  });
  const wheelMaterial = new THREE.MeshPhysicalMaterial({
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  });
  const bearingMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.25 });
  const hardwareMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.2 });

  /* -------------------------------------------------------------- meshes */

  // Every mesh is rebuilt when the shape changes; the materials above are not,
  // so skins survive a reshape without being reapplied.
  const wheels = [];
  let spec = resolveShape();
  let geometries = [];
  let grip = null;
  let gripDecal = null;
  // Remembered across rebuilds, since a reshape replaces the meshes.
  let gripWanted = true;
  let decalWanted = false;

  function track(geometry) {
    geometries.push(geometry);
    return geometry;
  }

  function addMetal(parent, geometry, material = truckMaterial) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** One complete truck plus its two wheels. `dir` is +1 for the nose end. */
  function buildTruck(dir, parts) {
    const truck = new THREE.Group();
    const axleX = spec.wheelbase * dir;
    const baseX = axleX - 0.16 * dir;

    addMetal(truck, parts.baseplate).position.set(baseX, spec.deckBottom, 0);
    addMetal(truck, parts.hanger).position.set(axleX, spec.axleY, 0);

    for (const side of [-1, 1]) {
      addMetal(truck, parts.axle).position.set(axleX, spec.axleY, (side * spec.axleHalf) / 2);
    }

    // Kingpin: tilted ~40 degrees, nut tucked under the deck on the inboard side.
    const kingpin = addMetal(truck, parts.kingpin);
    kingpin.position.set(axleX - 0.16 * dir, spec.axleY + 0.2, 0);
    kingpin.rotation.z = 0.7 * dir;

    const kingpinNut = addMetal(truck, parts.nut);
    kingpinNut.position.set(axleX - 0.44 * dir, spec.axleY + 0.52, 0);
    kingpinNut.rotation.z = 0.7 * dir;

    for (const [offset, lift, scale] of [[-0.3, 0.38, 1], [0.04, -0.12, 0.85]]) {
      const bushing = addMetal(truck, parts.bushing, bushingMaterial);
      bushing.position.set(axleX + offset * dir, spec.axleY + lift, 0);
      bushing.rotation.z = 0.7 * dir;
      bushing.scale.setScalar(scale);
    }

    const washer = addMetal(truck, parts.washer);
    washer.position.set(axleX - 0.38 * dir, spec.axleY + 0.44, 0);
    washer.rotation.z = 0.7 * dir;

    // Pivot arm running from the hanger up into the outboard end of the
    // baseplate. It is mostly hidden on a real truck, so keep it tucked in.
    const pivot = addMetal(truck, parts.pivot);
    pivot.position.set(axleX + 0.26 * dir, spec.axleY + 0.22, 0);
    pivot.rotation.z = -0.75 * dir;

    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(parts.wheel, wheelMaterial);
      wheel.position.set(axleX, spec.axleY, side * spec.wheelZ);
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      truck.add(wheel);
      wheels.push(wheel);

      for (const face of [-1, 1]) {
        addMetal(truck, parts.bearing, bearingMaterial).position.set(
          axleX,
          spec.axleY,
          side * spec.wheelZ + face * (spec.wheelWidth / 2 - 0.02),
        );
      }

      const axleNut = addMetal(truck, parts.nut);
      axleNut.rotation.x = Math.PI / 2;
      axleNut.position.set(axleX, spec.axleY, side * (spec.wheelZ + spec.wheelWidth / 2 + 0.05));
    }

    // Four mounting bolts per truck, each following the deck's local normal.
    for (const dx of [-spec.boltOffsetX, spec.boltOffsetX]) {
      for (const dz of [-spec.boltOffsetZ, spec.boltOffsetZ]) {
        const x = baseX + dx;
        const v = THREE.MathUtils.clamp(dz / deckHalfWidth(x, spec), -1, 1);
        const topY = deckKick(x, spec) + spec.concave * v * v;
        const tilt = Math.atan(deckSlope(x, spec));

        const head = addMetal(truck, parts.boltHead, hardwareMaterial);
        head.position.set(x, topY + 0.05, dz);
        head.rotation.z = tilt;

        const shaft = addMetal(truck, parts.boltShaft, hardwareMaterial);
        shaft.position.set(x, topY - spec.thickness / 2 - 0.16, dz);
        shaft.rotation.z = tilt;

        const nut = addMetal(truck, parts.nut, hardwareMaterial);
        nut.position.set(x, spec.deckBottom - 0.18, dz);
        nut.rotation.z = tilt;
      }
    }

    return truck;
  }

  /** Throw away the current board and build one to `spec`. */
  function buildBody(segmentsU = FULL_SEGMENTS_U, segmentsV = FULL_SEGMENTS_V) {
    spinner.clear();
    for (const geometry of geometries) geometry.dispose();
    geometries = [];
    wheels.length = 0;

    const deck = new THREE.Mesh(
      track(buildDeckGeometry(spec, { segmentsU, segmentsV })),
      [woodMaterial, graphicMaterial, plyMaterial],
    );
    deck.castShadow = true;
    deck.receiveShadow = true;
    spinner.add(deck);

    grip = new THREE.Mesh(
      track(buildDeckSurfaceGeometry(spec, { lift: 0.014, inset: 0.012, segmentsU, segmentsV })),
      gripMaterial,
    );
    grip.castShadow = true;
    spinner.add(grip);

    gripDecal = new THREE.Mesh(
      track(buildDeckSurfaceGeometry(spec, { lift: 0.022, inset: 0.05, trim: 0.02, segmentsU, segmentsV })),
      gripDecalMaterial,
    );
    gripDecal.visible = decalWanted;
    spinner.add(gripDecal);

    const axle = track(new THREE.CylinderGeometry(0.07, 0.07, spec.axleHalf, 16));
    axle.rotateX(Math.PI / 2);
    const bearing = track(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20));
    bearing.rotateX(Math.PI / 2);

    const parts = {
      hanger: track(buildHangerGeometry(spec)),
      baseplate: track(buildBaseplateGeometry()),
      wheel: track(buildWheelGeometry(spec)),
      axle,
      bearing,
      kingpin: track(new THREE.CylinderGeometry(0.048, 0.048, 0.92, 12)),
      pivot: track(new THREE.ConeGeometry(0.085, 0.2, 14)),
      washer: track(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16)),
      bushing: track(new THREE.CylinderGeometry(0.15, 0.11, 0.13, 20)),
      nut: track(buildHexGeometry(0.085, 0.06)),
      boltHead: track(buildHexGeometry(0.056, 0.042)),
      boltShaft: track(new THREE.CylinderGeometry(0.029, 0.029, spec.thickness + 0.42, 10)),
    };

    spinner.add(buildTruck(1, parts));
    spinner.add(buildTruck(-1, parts));

    grip.visible = gripWanted;
  }

  /* -------------------------------------------------------------- update */

  const live = {
    graphic: null,
    veneer: null,
    ply: null,
    gripMap: null,
    gripBump: null,
    gripDecal: null,
    wheel: null,
  };

  function applyDeck(deckConfig) {
    disposeTexture(live.graphic);
    disposeTexture(live.veneer);
    disposeTexture(live.ply);

    live.graphic = createDeckGraphic(deckConfig);
    live.veneer = createVeneerTexture(deckConfig.wood);
    live.ply = createPlyTexture(deckConfig.wood);

    graphicMaterial.map = live.graphic;
    graphicMaterial.clearcoat = deckConfig.gloss;
    graphicMaterial.roughness = THREE.MathUtils.lerp(0.55, 0.16, deckConfig.gloss);
    graphicMaterial.needsUpdate = true;

    woodMaterial.map = live.veneer;
    woodMaterial.needsUpdate = true;

    plyMaterial.map = live.ply;
    plyMaterial.needsUpdate = true;
  }

  function applyGrip(gripConfig, deckConfig) {
    disposeTexture(live.gripMap);
    disposeTexture(live.gripBump);
    disposeTexture(live.gripDecal);
    live.gripDecal = null;

    gripWanted = gripConfig.enabled;
    grip.visible = gripWanted;

    const textures = createGripTextures(gripConfig);
    live.gripMap = textures.map;
    live.gripBump = textures.bumpMap;
    gripMaterial.map = live.gripMap;
    gripMaterial.bumpMap = live.gripBump;
    // Clear grip lets the veneer read through instead of hiding it.
    gripMaterial.transparent = gripConfig.pattern === 'clear';
    gripMaterial.opacity = gripConfig.pattern === 'clear' ? 0.45 : 1;
    gripMaterial.needsUpdate = true;

    decalWanted = gripConfig.enabled && gripConfig.pattern === 'logo-cut';
    gripDecal.visible = decalWanted;
    if (decalWanted) {
      live.gripDecal = createGripDecal(gripConfig, deckConfig.ink);
      gripDecalMaterial.map = live.gripDecal;
      gripDecalMaterial.needsUpdate = true;
    }
  }

  function applyTrucks(trucksConfig) {
    const finish = TRUCK_FINISHES[trucksConfig.finish] ?? TRUCK_FINISHES.polished;
    truckMaterial.color.set(trucksConfig.color);
    truckMaterial.metalness = finish.metalness;
    truckMaterial.roughness = finish.roughness;
    truckMaterial.needsUpdate = true;
    bushingMaterial.color.set(trucksConfig.bushings);
  }

  function applyWheels(wheelsConfig) {
    disposeTexture(live.wheel);
    live.wheel = createWheelTexture(wheelsConfig);
    wheelMaterial.map = live.wheel;
    wheelMaterial.color.set('#ffffff');
    const translucent = wheelsConfig.style === 'clear';
    wheelMaterial.transparent = translucent;
    wheelMaterial.opacity = translucent ? 0.66 : 1;
    wheelMaterial.roughness = translucent ? 0.12 : 0.28;
    wheelMaterial.needsUpdate = true;
    bearingMaterial.color.set(wheelsConfig.bearings);
  }

  function applyHardware(hardwareConfig) {
    hardwareMaterial.color.set(hardwareConfig.color);
  }

  let buildFrame = 0;

  /** Rebuild the geometry for a new shape, keeping every material as-is. */
  function applyShape(shapeConfig, draft) {
    spec = resolveShape(shapeConfig);
    if (!draft) {
      if (buildFrame) cancelAnimationFrame(buildFrame);
      buildFrame = 0;
      buildBody();
      return;
    }
    if (buildFrame) return; // a draft rebuild is already queued for this frame
    buildFrame = requestAnimationFrame(() => {
      buildFrame = 0;
      buildBody(DRAFT_SEGMENTS_U, DRAFT_SEGMENTS_V);
    });
  }

  function update(config, sections, meta = {}) {
    const all = !sections;
    if (all || sections.has('shape')) applyShape(config.shape, meta.draft);
    if (all || sections.has('deck')) applyDeck(config.deck);
    if (all || sections.has('grip') || sections.has('deck')) applyGrip(config.grip, config.deck);
    if (all || sections.has('trucks')) applyTrucks(config.trucks);
    if (all || sections.has('wheels')) applyWheels(config.wheels);
    if (all || sections.has('hardware')) applyHardware(config.hardware);
  }

  function dispose() {
    if (buildFrame) cancelAnimationFrame(buildFrame);
    for (const texture of Object.values(live)) disposeTexture(texture);
    for (const geometry of geometries) geometry.dispose();
    geometries = [];
    for (const material of [
      woodMaterial, graphicMaterial, plyMaterial, gripMaterial, gripDecalMaterial,
      truckMaterial, bushingMaterial, wheelMaterial, bearingMaterial, hardwareMaterial,
    ]) material.dispose();
  }

  buildBody();

  return {
    object: root,
    spinner,
    wheels,
    update,
    dispose,
    /** Where the wheels meet the ground for the current shape. */
    get groundY() {
      return spec.groundY;
    },
    /** Half-extents of the current board, for framing the camera. */
    get bounds() {
      return shapeBounds(spec);
    },
  };
}
