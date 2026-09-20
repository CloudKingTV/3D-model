import * as THREE from 'three';
import {
  DECK_SPEC,
  TRUCK_SPEC,
  buildDeckGeometry,
  buildDeckSurfaceGeometry,
  buildHangerGeometry,
  buildBaseplateGeometry,
  buildWheelGeometry,
  buildHexGeometry,
  deckKick,
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

const DECK_BOTTOM = -DECK_SPEC.thickness;
const AXLE_Y = DECK_BOTTOM - TRUCK_SPEC.axleDrop;
export const GROUND_Y = AXLE_Y - TRUCK_SPEC.wheelRadius;

/** Half-extents of the assembled board, used to auto-frame the camera. */
export const BOARD_BOUNDS = {
  min: new THREE.Vector3(
    -DECK_SPEC.length / 2 - 0.1,
    GROUND_Y,
    -(TRUCK_SPEC.wheelZ + TRUCK_SPEC.wheelWidth / 2 + 0.12),
  ),
  max: new THREE.Vector3(
    DECK_SPEC.length / 2 + 0.1,
    DECK_SPEC.kickHeight + 0.12,
    TRUCK_SPEC.wheelZ + TRUCK_SPEC.wheelWidth / 2 + 0.12,
  ),
};

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

  const deckGeometry = buildDeckGeometry();
  const deck = new THREE.Mesh(deckGeometry, [woodMaterial, graphicMaterial, plyMaterial]);
  deck.castShadow = true;
  deck.receiveShadow = true;
  spinner.add(deck);

  const grip = new THREE.Mesh(buildDeckSurfaceGeometry({ lift: 0.014, inset: 0.012 }), gripMaterial);
  grip.castShadow = true;
  spinner.add(grip);

  const gripDecal = new THREE.Mesh(
    buildDeckSurfaceGeometry({ lift: 0.022, inset: 0.05, trim: 0.02 }),
    gripDecalMaterial,
  );
  gripDecal.visible = false;
  spinner.add(gripDecal);

  const hangerGeometry = buildHangerGeometry();
  const baseplateGeometry = buildBaseplateGeometry();
  const wheelGeometry = buildWheelGeometry();
  const axleGeometry = new THREE.CylinderGeometry(0.07, 0.07, TRUCK_SPEC.axleHalf, 16);
  axleGeometry.rotateX(Math.PI / 2);
  const kingpinGeometry = new THREE.CylinderGeometry(0.048, 0.048, 0.92, 12);
  const pivotGeometry = new THREE.ConeGeometry(0.085, 0.2, 14);
  const washerGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16);
  const bushingGeometry = new THREE.CylinderGeometry(0.15, 0.11, 0.13, 20);
  const nutGeometry = buildHexGeometry(0.085, 0.06);
  const boltHeadGeometry = buildHexGeometry(0.056, 0.042);
  const boltShaftGeometry = new THREE.CylinderGeometry(0.029, 0.029, 0.72, 10);
  const bearingGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20);
  bearingGeometry.rotateX(Math.PI / 2);

  const wheels = [];
  const metalParts = [];
  const bushings = [];

  function addMetal(geometry, material = truckMaterial) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    if (material === truckMaterial) metalParts.push(mesh);
    return mesh;
  }

  /** One complete truck plus its two wheels. `dir` is +1 for the nose end. */
  function buildTruck(dir) {
    const truck = new THREE.Group();
    const axleX = TRUCK_SPEC.wheelbase * dir;
    const baseX = axleX - 0.16 * dir;

    const baseplate = addMetal(baseplateGeometry);
    baseplate.position.set(baseX, DECK_BOTTOM, 0);
    truck.add(baseplate);

    const hanger = addMetal(hangerGeometry);
    hanger.position.set(axleX, AXLE_Y, 0);
    truck.add(hanger);

    for (const side of [-1, 1]) {
      const axle = addMetal(axleGeometry);
      axle.position.set(axleX, AXLE_Y, (side * TRUCK_SPEC.axleHalf) / 2);
      truck.add(axle);
    }

    // Kingpin: tilted ~40 degrees, nut tucked under the deck on the inboard side.
    const kingpin = addMetal(kingpinGeometry);
    kingpin.position.set(axleX - 0.16 * dir, AXLE_Y + 0.2, 0);
    kingpin.rotation.z = 0.7 * dir;
    truck.add(kingpin);

    const kingpinNut = addMetal(nutGeometry);
    kingpinNut.position.set(axleX - 0.44 * dir, AXLE_Y + 0.52, 0);
    kingpinNut.rotation.z = 0.7 * dir;
    truck.add(kingpinNut);

    for (const [offset, lift, scale] of [[-0.3, 0.38, 1], [0.04, -0.12, 0.85]]) {
      const bushing = new THREE.Mesh(bushingGeometry, bushingMaterial);
      bushing.position.set(axleX + offset * dir, AXLE_Y + lift, 0);
      bushing.rotation.z = 0.7 * dir;
      bushing.scale.setScalar(scale);
      bushing.castShadow = true;
      bushings.push(bushing);
      truck.add(bushing);
    }

    const washer = addMetal(washerGeometry);
    washer.position.set(axleX - 0.38 * dir, AXLE_Y + 0.44, 0);
    washer.rotation.z = 0.7 * dir;
    truck.add(washer);

    // Pivot arm running from the hanger up into the outboard end of the
    // baseplate. It is mostly hidden on a real truck, so keep it tucked in.
    const pivot = addMetal(pivotGeometry);
    pivot.position.set(axleX + 0.26 * dir, AXLE_Y + 0.22, 0);
    pivot.rotation.z = -0.75 * dir;
    truck.add(pivot);

    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(axleX, AXLE_Y, side * TRUCK_SPEC.wheelZ);
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      truck.add(wheel);
      wheels.push(wheel);

      for (const face of [-1, 1]) {
        const bearing = addMetal(bearingGeometry, bearingMaterial);
        bearing.position.set(
          axleX,
          AXLE_Y,
          side * TRUCK_SPEC.wheelZ + face * (TRUCK_SPEC.wheelWidth / 2 - 0.02),
        );
        truck.add(bearing);
      }

      const axleNut = addMetal(nutGeometry);
      axleNut.rotation.x = Math.PI / 2;
      axleNut.position.set(axleX, AXLE_Y, side * (TRUCK_SPEC.wheelZ + TRUCK_SPEC.wheelWidth / 2 + 0.05));
      truck.add(axleNut);
    }

    // Four mounting bolts per truck, each following the deck's local normal.
    for (const dx of [-TRUCK_SPEC.boltOffsetX, TRUCK_SPEC.boltOffsetX]) {
      for (const dz of [-TRUCK_SPEC.boltOffsetZ, TRUCK_SPEC.boltOffsetZ]) {
        const x = baseX + dx;
        const halfWidth = deckHalfWidth(x);
        const v = THREE.MathUtils.clamp(dz / halfWidth, -1, 1);
        const topY = deckKick(x) + DECK_SPEC.concave * v * v;
        const slope = (deckKick(x + 0.002) - deckKick(x - 0.002)) / 0.004;
        const tilt = Math.atan(slope);

        const head = new THREE.Mesh(boltHeadGeometry, hardwareMaterial);
        head.position.set(x, topY + 0.05, dz);
        head.rotation.z = tilt;
        head.castShadow = true;
        truck.add(head);

        const shaft = new THREE.Mesh(boltShaftGeometry, hardwareMaterial);
        shaft.position.set(x, topY - 0.3, dz);
        shaft.rotation.z = tilt;
        truck.add(shaft);

        const nut = new THREE.Mesh(nutGeometry, hardwareMaterial);
        nut.position.set(x, DECK_BOTTOM - 0.18, dz);
        nut.rotation.z = tilt;
        nut.castShadow = true;
        truck.add(nut);
      }
    }

    return truck;
  }

  spinner.add(buildTruck(1));
  spinner.add(buildTruck(-1));

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

    grip.visible = gripConfig.enabled;

    const textures = createGripTextures(gripConfig);
    live.gripMap = textures.map;
    live.gripBump = textures.bumpMap;
    gripMaterial.map = live.gripMap;
    gripMaterial.bumpMap = live.gripBump;
    // Clear grip lets the veneer read through instead of hiding it.
    gripMaterial.transparent = gripConfig.pattern === 'clear';
    gripMaterial.opacity = gripConfig.pattern === 'clear' ? 0.45 : 1;
    gripMaterial.needsUpdate = true;

    const wantsDecal = gripConfig.enabled && gripConfig.pattern === 'logo-cut';
    gripDecal.visible = wantsDecal;
    if (wantsDecal) {
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

  function update(config, sections) {
    const all = !sections;
    if (all || sections.has('deck')) applyDeck(config.deck);
    if (all || sections.has('grip') || sections.has('deck')) applyGrip(config.grip, config.deck);
    if (all || sections.has('trucks')) applyTrucks(config.trucks);
    if (all || sections.has('wheels')) applyWheels(config.wheels);
    if (all || sections.has('hardware')) applyHardware(config.hardware);
  }

  function dispose() {
    for (const texture of Object.values(live)) disposeTexture(texture);
    for (const geometry of [
      deckGeometry, hangerGeometry, baseplateGeometry, wheelGeometry, axleGeometry,
      kingpinGeometry, pivotGeometry, washerGeometry, bushingGeometry, nutGeometry,
      boltHeadGeometry, boltShaftGeometry, bearingGeometry, grip.geometry, gripDecal.geometry,
    ]) geometry.dispose();
    for (const material of [
      woodMaterial, graphicMaterial, plyMaterial, gripMaterial, gripDecalMaterial,
      truckMaterial, bushingMaterial, wheelMaterial, bearingMaterial, hardwareMaterial,
    ]) material.dispose();
  }

  return {
    object: root,
    spinner,
    wheels,
    bushings,
    metalParts,
    update,
    dispose,
  };
}
