import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createFingerboard } from '../lib/fingerboard.js';
import { createTiltShift } from './tiltshift.js';
import { createEffects } from './effects.js';
import {
  TABLE_DEPTH,
  createTableTexture,
  createRampTexture,
  createConcreteTexture,
  createFeatureMesh,
  createTableSegment,
  createPropMaterials,
  DESK_PROPS,
  DESK_PROP_NAMES,
} from './props.js';

const PROP_SPACING = 34; // one piece of desk clutter roughly every 340mm

/** A dim room for the table to sit in; the far edge reads against it. */
function createRoomBackdrop() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#141b26');
  gradient.addColorStop(0.5, '#243044');
  gradient.addColorStop(0.78, '#3a3428');
  gradient.addColorStop(1, '#4a3826');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

function slotRandom(slot, salt) {
  let a = (slot * 2654435761 + salt * 40503) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createGameScene(canvas, { quality = 'high', accent = '#ff5722' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = createRoomBackdrop();

  // A long lens kept close: the compression reads as a macro photograph.
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 600);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.5;

  /* ------------------------------------------------------------- lights */

  // Warm key from above, like a desk lamp just out of frame. Its shadow is
  // what grounds the board on the table, so it follows the skater.
  const key = new THREE.DirectionalLight('#ffe6c4', 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 160;
  const shadowSpan = 46;
  key.shadow.camera.left = -shadowSpan;
  key.shadow.camera.right = shadowSpan;
  key.shadow.camera.top = shadowSpan;
  key.shadow.camera.bottom = -shadowSpan;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight('#9fc4ff', 0.55);
  fill.position.set(-40, 30, -30);
  scene.add(fill);

  scene.add(new THREE.HemisphereLight('#3a4a66', '#120d08', 0.5));

  /* ---------------------------------------------------------- materials */

  const tableTexture = createTableTexture();
  const tableMaterial = new THREE.MeshStandardMaterial({
    map: tableTexture,
    roughness: 0.62,
    metalness: 0.02,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#6d4726', roughness: 0.55 });

  const rampTexture = createRampTexture();
  const concreteTexture = createConcreteTexture();
  const featureMaterials = {
    ramp: new THREE.MeshStandardMaterial({ map: rampTexture, roughness: 0.72 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c3c9d2', roughness: 0.22, metalness: 0.95 }),
  };
  const propMaterials = createPropMaterials();

  /* ------------------------------------------------------------- board */

  const board = createFingerboard();
  const rollGroup = new THREE.Group();
  const yawGroup = new THREE.Group();
  const pitchGroup = new THREE.Group();
  // Nested so a flip happens around the board's own long axis *after* a shuv
  // has turned it — which is exactly what makes a varial look right.
  rollGroup.add(board.object);
  yawGroup.add(rollGroup);
  pitchGroup.add(yawGroup);
  scene.add(pitchGroup);

  // Off the roll axis on purpose: a point on the board's centre line would not
  // move during a kickflip, so the trail would draw nothing.
  const noseMarker = new THREE.Object3D();
  noseMarker.position.set(4.6, -0.2, 1.4);
  board.object.add(noseMarker);

  const effects = createEffects(scene, { accent });

  /* ------------------------------------------------- world bookkeeping */

  const featureGroups = new Map(); // feature.id -> THREE.Group
  const propGroups = new Map(); // slot index -> THREE.Group

  function disposeTree(object) {
    object.traverse((node) => {
      if (node.isMesh) node.geometry.dispose();
    });
  }

  /** Build meshes for any track feature that does not have them yet. */
  function syncFeatures(track, x) {
    for (const feature of track.features) {
      if (featureGroups.has(feature.id)) continue;
      const group = new THREE.Group();
      group.position.x = feature.start;

      // A gap is literally a missing piece of table, so skip its top.
      if (feature.kind !== 'gap') {
        group.add(createTableSegment(feature.length, feature.start, tableMaterial, edgeMaterial));
      }
      group.add(createFeatureMesh(feature, featureMaterials));

      featureGroups.set(feature.id, group);
      scene.add(group);
    }

    const alive = new Set(track.features.map((f) => f.id));
    for (const [id, group] of featureGroups) {
      if (alive.has(id)) continue;
      scene.remove(group);
      disposeTree(group);
      featureGroups.delete(id);
    }
  }

  /** Scatter desk clutter along both edges of the table, recycled with the run. */
  function syncProps(x) {
    const first = Math.floor((x - 120) / PROP_SPACING);
    const last = Math.ceil((x + 340) / PROP_SPACING);

    for (let slot = first; slot <= last; slot += 1) {
      if (propGroups.has(slot) || slot < 0) continue;
      const pick = DESK_PROP_NAMES[Math.floor(slotRandom(slot, 1) * DESK_PROP_NAMES.length)];
      const group = DESK_PROPS[pick](propMaterials);
      // Obstacles are 15 wide, so anything past |z| = 13 is clear of the run.
      // Near ones land in the foreground blur, far ones sit on the skyline —
      // both read as "things on a desk" beside a very small board.
      const front = slotRandom(slot, 2) > 0.5;
      const near = 13 + slotRandom(slot, 4) * 9;
      const far = -(15 + slotRandom(slot, 5) * (TABLE_DEPTH / 2 - 19));
      group.position.set(
        slot * PROP_SPACING + slotRandom(slot, 3) * 18,
        0,
        front ? near : far,
      );
      group.rotation.y = slotRandom(slot, 6) * Math.PI * 2;
      propGroups.set(slot, group);
      scene.add(group);
    }

    for (const [slot, group] of propGroups) {
      if (slot >= first && slot <= last) continue;
      scene.remove(group);
      disposeTree(group);
      propGroups.delete(slot);
    }
  }

  /* -------------------------------------------------------------- pose */

  const trailPoint = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  let smoothedY = 0;
  // Portrait phones get a wider lens and a longer shot; see resize().
  const framing = { scale: 1 };

  function poseBoard(skater) {
    const contactY = board.groundY;
    pitchGroup.position.set(skater.x, skater.y - contactY / 2, 0);
    board.object.position.y = -contactY / 2;

    pitchGroup.rotation.z = skater.pitch + (skater.state === 'bail' ? skater.bailTimer * 2.4 : 0);
    yawGroup.rotation.y = skater.yaw;
    rollGroup.rotation.x = skater.roll;

    // Crouch into the pop: the board squats before it leaves the ground.
    const squat = skater.charge * 0.5;
    board.object.position.y -= squat * 0.35;
    board.object.rotation.z = -squat * 0.1;

    // Metal on metal: a grind should buzz rather than glide perfectly.
    if (skater.state === 'grind') {
      pitchGroup.position.y += (Math.random() - 0.5) * 0.06;
      rollGroup.rotation.x += (Math.random() - 0.5) * 0.03;
    }

    // The trail only means anything while the board is actually spinning.
    const spinning = skater.state === 'air'
      && (Math.abs(skater.rollTarget - skater.roll) > 0.05
        || Math.abs(skater.yawTarget - skater.yaw) > 0.05);
    effects.setTrailActive(spinning);
    if (spinning) {
      noseMarker.updateWorldMatrix(true, false);
      noseMarker.getWorldPosition(trailPoint);
      effects.pushTrail(trailPoint);
    }
  }

  function updateCamera(skater, dt) {
    // Never follow the board down a gap: the camera would end up under the
    // table looking up, which reads as a broken shot rather than a fall.
    const followY = Math.max(skater.y, -1.5);
    smoothedY += (followY - smoothedY) * Math.min(1, dt * 3.2);
    // Roughly 25 degrees up: high enough to read as looking down at a table,
    // low enough that flips still read against the horizon.
    // A landing worth celebrating pulls the camera in for a moment.
    punch = Math.max(0, punch - dt * 2.2);
    const pull = 1 - punch * 0.16;

    cameraTarget.set(
      skater.x + 9 * framing.scale * pull,
      smoothedY + 23 * framing.scale * pull,
      50 * framing.scale * pull,
    );
    camera.position.lerp(cameraTarget, Math.min(1, dt * 6));

    const shake = effects.shake;
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake * 2.2;
      camera.position.y += (Math.random() - 0.5) * shake * 2.2;
    }
    // Aimed a little high so the desk clutter behind the run stays in frame —
    // a mug you can see all of is what makes the board look 96mm long.
    lookTarget.set(skater.x + 3, smoothedY + 3.6 * framing.scale, -2);
    camera.lookAt(lookTarget);

    key.position.set(skater.x + 26, 58, 30);
    key.target.position.set(skater.x, skater.y, 0);
    key.target.updateMatrixWorld();
  }

  /* ------------------------------------------------------ post & resize */

  // Always on: the miniature illusion is the point, not a nicety.
  const post = createTiltShift(renderer, scene, camera);
  const projected = new THREE.Vector3();
  let punch = 0;

  function resize(width, height) {
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.aspect = aspect;

    // A 30-degree lens on a tall phone leaves almost no horizontal field, which
    // crops the board off the side of the screen. Widen the lens and stand
    // further back as the frame gets taller, instead of cropping the action.
    const portrait = Math.min(1, Math.max(0, (1 - aspect) / 0.5));
    camera.fov = THREE.MathUtils.lerp(30, 42, portrait);
    framing.scale = THREE.MathUtils.lerp(1, 1.55, portrait);

    camera.updateProjectionMatrix();
    post.setSize(width, height, renderer.getPixelRatio());
  }

  function render(skater) {
    // Keep the sharp band on the board wherever it is in the frame.
    // NDC y runs -1 (bottom) to +1 (top) and so does the shader's vUv.y, so
    // this maps straight across. Negating it mirrors the band and blurs the
    // one thing that should be sharp.
    projected.set(skater.x + 2, skater.y, 0).project(camera);
    post.setFocus(0.5 + projected.y * 0.5);
    post.render();
  }

  function dispose() {
    effects.dispose();
    for (const [, group] of featureGroups) disposeTree(group);
    for (const [, group] of propGroups) disposeTree(group);
    featureGroups.clear();
    propGroups.clear();
    board.dispose();
    for (const material of [tableMaterial, edgeMaterial, ...Object.values(featureMaterials), ...Object.values(propMaterials)]) {
      material.dispose();
    }
    for (const texture of [tableTexture, rampTexture, concreteTexture]) texture.dispose();
    environment.dispose();
    pmrem.dispose();
    post.dispose();
    renderer.dispose();
  }

  return {
    scene,
    camera,
    renderer,
    board,
    syncFeatures,
    syncProps,
    poseBoard,
    updateCamera,
    resize,
    render,
    dispose,
    effects,

    /** Re-skin the board from the customiser's config. */
    applyConfig(config) {
      board.update(config, null);
      effects.setAccent(config.deck.ink);
    },

    /** Where the board is on screen, 0..1, so pop-ups can appear next to it. */
    projectBoard(skater) {
      projected.set(skater.x, skater.y + 1.5, 0).project(camera);
      return { x: projected.x * 0.5 + 0.5, y: 0.5 - projected.y * 0.5 };
    },

    /** Pull the camera in briefly; 0..1. */
    punchIn(amount) {
      punch = Math.min(1, punch + amount);
    },

    stepEffects(dt) {
      effects.update(dt);
    },
  };
}
