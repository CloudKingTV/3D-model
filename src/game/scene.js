import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createFingerboard } from '../lib/fingerboard.js';
import { createTiltShift } from './tiltshift.js';
import { createEffects } from './effects.js';
import { createKitMaterials, buildPark, buildTableClutter } from './props.js';
import { createRoomMaterials, buildRoom, buildTable } from './room.js';
import { mergeStatic } from './batch.js';
import { bakeTableShadows } from './bakedShadows.js';

/**
 * Where the daylight comes from, relative to what it lights: through the
 * window behind the far side of the table, high and a little to the left.
 * The baked table shadows and the board's live shadow both use it.
 */
const SUN_OFFSET = new THREE.Vector3(-30, 85, -100);

/** A collectible letter: the glyph drawn on a canvas, in a spinning ring. */
function createLetter(letter, ringMaterial) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '900 104px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#1b1200';
  ctx.strokeText(letter, 64, 70);
  ctx.fillStyle = '#ffd93d';
  ctx.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const group = new THREE.Group();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(3.6, 3.6, 1);
  group.add(sprite);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.16, 10, 40), ringMaterial);
  group.add(ring);
  return { group, ring, sprite, texture };
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Rendering budgets, best first. A phone that cannot hold its frame rate
 * steps down one at a time: resolution first, then shadow detail, then the
 * tilt-shift blur, and last the shadow itself.
 */
const QUALITY_LEVELS = [
  { ratio: 2, shadow: 2048, blur: true, shadows: true },
  { ratio: 1.5, shadow: 1024, blur: true, shadows: true },
  { ratio: 1.25, shadow: 1024, blur: true, shadows: true },
  { ratio: 1, shadow: 512, blur: true, shadows: true },
  { ratio: 0.85, shadow: 512, blur: false, shadows: true, lamp: false },
  { ratio: 0.7, shadow: 512, blur: false, shadows: false, lamp: false },
];

export function createGameScene(canvas, { quality = 'high', accent = '#ff5722', park }) {
  const phone = quality !== 'high';
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !phone,
    powerPreference: 'high-performance',
  });
  let level = phone ? 2 : 0;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_LEVELS[level].ratio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Counted per frame across every pass (shadow, scene, blur), not per pass.
  renderer.info.autoReset = false;
  // Reading back each shader's compile log makes the driver finish compiling
  // there and then, which stalls the first frames. Only worth it while
  // developing.
  renderer.debug.checkShaderErrors = !!import.meta.env?.DEV;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe0f2');

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.35;

  /* ------------------------------------------------------------- lights */

  // Daylight through the window. It is the only light that casts a live
  // shadow, and the only thing that casts into it is the board: the
  // obstacles' shadows are baked into the table (below), so the shadow map
  // stays a few hundred triangles however much is on the table.
  const key = new THREE.DirectionalLight('#fff0d8', 2.8);
  key.castShadow = true;
  const shadowSize = QUALITY_LEVELS[level].shadow;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.camera.near = 60;
  key.shadow.camera.far = 220;
  const shadowSpan = 16;
  key.shadow.camera.left = -shadowSpan;
  key.shadow.camera.right = shadowSpan;
  key.shadow.camera.top = shadowSpan;
  key.shadow.camera.bottom = -shadowSpan;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);

  // Sky light from the window and bounce off the floor.
  scene.add(new THREE.HemisphereLight('#dbe8ff', '#6b4e33', 0.75));

  /* -------------------------------------------------------------- world */

  const kit = createKitMaterials();
  const room = createRoomMaterials();
  const ring = new THREE.MeshStandardMaterial({
    color: '#ffcf3d', emissive: '#ff9d00', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6,
  });

  // Everything that never moves is merged down to one mesh per material:
  // on a phone, draw calls cost far more than triangles.
  const built = buildPark(park, kit.materials);
  const parkGroup = new THREE.Group();
  parkGroup.add(built.group, buildTableClutter(kit.materials), buildTable(room.materials));
  scene.add(mergeStatic(parkGroup, { receiveShadow: true, name: 'park' }));
  scene.add(mergeStatic(buildRoom(room.materials), { receiveShadow: false, name: 'room' }));

  const sunDirection = SUN_OFFSET.clone().negate().normalize();
  const baked = bakeTableShadows(park, sunDirection);
  scene.add(baked.mesh);

  // The desk lamp is on: a warm pool of light over its corner of the table.
  const lamp = new THREE.PointLight('#ffc98a', 1600, 0, 2);
  if (built.lampHead) lamp.position.copy(built.lampHead);
  scene.add(lamp);

  const letters = park.letters.map((l) => {
    const letter = createLetter(l.letter, ring);
    letter.group.position.set(l.x, l.y, l.z);
    scene.add(letter.group);
    return letter;
  });

  /* ------------------------------------------------------------- board */

  const board = createFingerboard();
  // root: contact point on the ground. yaw: which way the board faces.
  // tilt: the surface under it. flip: kickflips, round the board's own long
  // axis at its middle, so the wheels are not what it spins about.
  const root = new THREE.Group();
  const yawGroup = new THREE.Group();
  const pitchGroup = new THREE.Group();
  const rollGroup = new THREE.Group();
  const flipGroup = new THREE.Group();
  root.add(yawGroup);
  yawGroup.add(pitchGroup);
  pitchGroup.add(rollGroup);
  rollGroup.add(flipGroup);
  scene.add(root);

  // Off the roll axis on purpose: a point on the centre line would not move
  // during a kickflip, so the trail would draw nothing.
  const noseMarker = new THREE.Object3D();
  noseMarker.position.set(4.6, -0.2, 1.4);

  // The board is forty-odd parts — bolts, nuts, bushings, bearings — each its
  // own draw call, twice over with its shadow. What gets drawn is a merged
  // copy, one mesh per material, rebuilt whenever the board's look changes.
  let boardProxy = null;
  function rebuildBoardProxy() {
    if (boardProxy) {
      flipGroup.remove(boardProxy);
      boardProxy.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
      for (const material of boardProxy.userData.ownedMaterials ?? []) material.dispose();
    }
    board.object.removeFromParent();
    const position = board.object.position.clone();
    board.object.position.set(0, 0, 0);
    boardProxy = mergeStatic(board.object, { castShadow: true, disposeSource: false, name: 'board' });
    board.object.position.copy(position);
    boardProxy.add(noseMarker);
    flipGroup.add(boardProxy);
  }
  rebuildBoardProxy();

  const effects = createEffects(scene, { accent });

  /* -------------------------------------------------------------- pose */

  const trailPoint = new THREE.Vector3();
  let lastSpin = 0;

  function facingOf(rider) {
    return rider.heading + rider.bodyYaw + rider.shuv;
  }

  function poseBoard(rider) {
    const spec = board.spec;
    const lift = -spec.groundY; // wheel bottoms up to the deck top
    const middle = lift * 0.55;
    flipGroup.position.y = middle;
    boardProxy.position.y = lift - middle;

    const facing = facingOf(rider);
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const along = rider.grad.x * fx + rider.grad.z * fz;
    const across = -rider.grad.x * fz + rider.grad.z * fx;

    root.position.set(rider.x, rider.y, rider.z);
    yawGroup.rotation.y = -facing;
    pitchGroup.rotation.z = Math.atan(along);
    rollGroup.rotation.x = -Math.atan(across);
    flipGroup.rotation.x = rider.flip;

    // Loading an ollie: tail down, nose up, pivoting on the back wheels.
    const load = rider.charge * 0.16;
    if (load > 0 && rider.state === 'ground') {
      pitchGroup.rotation.z += load;
      root.position.y += spec.wheelbase * Math.tan(load);
    }

    if (rider.state === 'grind' && rider.grind) {
      const style = rider.grind.style;
      // A 50-50 rides on the trucks' hangers, a slide on the deck's belly.
      const slide = style === 'Boardslide' || style === 'Lipslide';
      root.position.y -= slide ? lift - spec.thickness : Math.max(0, spec.wheelRadius - 0.2);
      // Metal on metal buzzes, upward only so it never dips into the rail.
      root.position.y += Math.random() * 0.05;
      rollGroup.rotation.x += (Math.random() - 0.5) * 0.03;
    }

    if (rider.state === 'bail') {
      // Tumbling: roll over, lifted so the lowest edge stays on the ground.
      const r = rider.bailRoll;
      const halfHeight = lift / 2;
      rollGroup.rotation.x += r;
      root.position.y += halfHeight * Math.abs(Math.cos(r)) + (spec.width / 2) * Math.abs(Math.sin(r)) - halfHeight;
    }

    const spinRate = Math.abs(rider.bodyYaw - lastSpin);
    lastSpin = rider.bodyYaw;
    const spinning = rider.state === 'air'
      && (Math.abs(rider.flipTarget - rider.flip) > 0.05
        || Math.abs(rider.shuvTarget - rider.shuv) > 0.05
        || spinRate > 0.02);
    effects.setTrailActive(spinning);
    if (spinning) {
      noseMarker.updateWorldMatrix(true, false);
      noseMarker.getWorldPosition(trailPoint);
      effects.pushTrail(trailPoint);
    }
  }

  /* ------------------------------------------------------------ camera */

  const framing = { distance: 25, height: 10 };
  const desired = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const smoothedLook = new THREE.Vector3();
  let cameraYaw = null;
  let followY = 0;
  let punch = 0;

  /**
   * Third person, behind the board and a little above, looking past it to
   * where it is going. Swings round behind the direction of travel, never
   * snapping; pulls in rather than ending up inside a ramp.
   */
  function updateCamera(rider, dt, { snap = false } = {}) {
    const travelling = rider.state === 'bail' ? cameraYaw ?? rider.heading : rider.heading;
    if (cameraYaw === null || snap) cameraYaw = travelling;
    const swing = rider.state === 'air' ? 2.2 : 3.6;
    cameraYaw += shortestAngle(cameraYaw, travelling) * (1 - Math.exp(-dt * swing));

    // Follow height lazily so airs rise in the frame; never down off the desk.
    const targetY = Math.max(rider.y, -20);
    followY = snap ? targetY : followY + (targetY - followY) * (1 - Math.exp(-dt * 4));

    punch = Math.max(0, punch - dt * 2.2);
    const pull = 1 - punch * 0.25;
    let distance = framing.distance * pull;
    let height = framing.height * pull;

    const bx = rider.x;
    const bz = rider.z;
    const eyeY = followY + 2.5;
    const cx = -Math.cos(cameraYaw);
    const cz = -Math.sin(cameraYaw);
    // Keep a clear line from the board back to the camera. Something low in
    // the way — a laptop, a ledge — the camera rises over; only something it
    // would have to climb too far for (the back of a quarter pipe, a mug)
    // makes it come in closer instead.
    const maxHeight = height * 1.9;
    for (let i = 1; i <= 14; i += 1) {
      const t = i / 14;
      const px = bx + cx * distance * t;
      const pz = bz + cz * distance * t;
      const ground = park.heightAt(px, pz) + 0.8;
      const lineY = eyeY + (followY + height - eyeY) * t;
      if (ground <= lineY) continue;
      const needed = eyeY + (ground - eyeY) / t - followY;
      if (needed <= maxHeight) {
        height = needed;
      } else {
        distance *= Math.max(0.35, (i - 1) / 14);
        height = Math.max(height, ground + 2.5 - followY);
        break;
      }
    }

    desired.set(bx + cx * distance, followY + height, bz + cz * distance);
    desired.y = Math.max(desired.y, park.heightAt(desired.x, desired.z) + 2.2);
    if (snap) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 7));

    const shake = effects.shake;
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake * 1.6;
      camera.position.y += (Math.random() - 0.5) * shake * 1.6;
      camera.position.z += (Math.random() - 0.5) * shake * 1.6;
    }

    // Aim past the board, so what is coming takes up the frame.
    lookTarget.set(
      bx + Math.cos(cameraYaw) * 9,
      followY + 1.2,
      bz + Math.sin(cameraYaw) * 9,
    );
    if (snap) smoothedLook.copy(lookTarget);
    else smoothedLook.lerp(lookTarget, 1 - Math.exp(-dt * 10));
    camera.lookAt(smoothedLook);

    // The sun's shadow box rides along with the board.
    const ground = Math.max(rider.y, 0);
    key.position.set(rider.x + SUN_OFFSET.x, ground + SUN_OFFSET.y, rider.z + SUN_OFFSET.z);
    key.target.position.set(rider.x, ground, rider.z);
    key.target.updateMatrixWorld();
  }

  /* ----------------------------------------------------------- letters */

  let clock = 0;
  function animateLetters(dt, collected) {
    clock += dt;
    letters.forEach((letter, i) => {
      letter.group.visible = !collected.includes(i);
      letter.group.position.y = park.letters[i].y + Math.sin(clock * 2 + i) * 0.35;
      letter.ring.rotation.y = clock * 1.6 + i;
    });
  }

  /* ------------------------------------------------------ post & resize */

  // Always on: the miniature illusion is the point, not a nicety.
  const post = createTiltShift(renderer, scene, camera, { lowPrecision: phone });
  // A deeper sharp band than the side view had: the chase camera looks down
  // the park, and the rider needs to read what is coming.
  post.setRange(0.2);
  post.setFeather(0.4);
  // Gentler than the side-on view: the room around now tells you the board
  // is small, so the blur only has to hint at it, and the park ahead must
  // stay readable.
  post.setStrength(3);
  const projected = new THREE.Vector3();

  // Compile every shader in the background while the start screen is up, so
  // dropping in does not stutter on the first frames.
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    renderer.compileAsync(scene, camera).catch(() => {});
  }

  const size = { width: 1, height: 1 };

  /** Step down to the next cheaper rendering budget. False at the bottom. */
  function lowerQuality() {
    if (level >= QUALITY_LEVELS.length - 1) return false;
    level += 1;
    const next = QUALITY_LEVELS[level];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.ratio));
    if (next.shadow !== key.shadow.mapSize.x) {
      key.shadow.mapSize.set(next.shadow, next.shadow);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    key.castShadow = next.shadows;
    // The lamp is a second per-pixel light on every lit surface: the
    // cheapest budgets go without it.
    lamp.visible = next.lamp !== false;
    post.setEnabled(next.blur);
    resize(size.width, size.height);
    return true;
  }

  function resize(width, height) {
    size.width = width;
    size.height = height;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.aspect = aspect;
    // Tall phones get a wider lens and a longer shot, rather than a crop.
    const portrait = Math.min(1, Math.max(0, (1 - aspect) / 0.5));
    camera.fov = THREE.MathUtils.lerp(48, 62, portrait);
    framing.distance = THREE.MathUtils.lerp(25, 31, portrait);
    framing.height = THREE.MathUtils.lerp(10, 13, portrait);
    camera.updateProjectionMatrix();
    post.setSize(width, height, renderer.getPixelRatio());
  }

  function render(rider) {
    renderer.info.reset();
    // Keep the sharp band on the board wherever it is in the frame.
    projected.set(rider.x, rider.y + 1, rider.z).project(camera);
    post.setFocus(0.5 + projected.y * 0.5);
    post.render();
  }

  function dispose() {
    effects.dispose();
    scene.traverse((node) => {
      if (node.isMesh || node.isSprite) node.geometry?.dispose();
    });
    for (const letter of letters) {
      letter.texture.dispose();
      letter.sprite.material.dispose();
    }
    board.dispose();
    for (const material of boardProxy.userData.ownedMaterials ?? []) material.dispose();
    for (const group of scene.children) {
      for (const material of group.userData?.ownedMaterials ?? []) material.dispose();
    }
    const materials = [...Object.values(kit.materials), ...Object.values(room.materials).flat(), ring, baked.material];
    for (const material of materials) material.dispose();
    const textures = [...Object.values(kit.textures), ...Object.values(room.textures).flat(), baked.texture];
    for (const texture of textures) texture.dispose();
    environment.dispose();
    pmrem.dispose();
    post.dispose();
    renderer.dispose();
    // Give the GL context back now rather than whenever it is collected:
    // phones allow only a few at once, and every trip into the park makes
    // one. Left to pile up, the browser starts killing the garage's.
    renderer.forceContextLoss();
  }

  return {
    scene,
    camera,
    renderer,
    board,
    effects,
    poseBoard,
    updateCamera,
    animateLetters,
    lowerQuality,
    /** What the last frame cost: draw calls and triangles, all passes. */
    get stats() {
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    get qualityLevel() {
      return level;
    },
    resize,
    render,
    dispose,

    /** Re-skin the board from the customiser's config. */
    applyConfig(config) {
      board.update(config, null);
      rebuildBoardProxy();
      effects.setAccent(config.deck.ink);
    },

    /** Where the board is on screen, 0..1, so pop-ups can appear next to it. */
    projectBoard(rider) {
      projected.set(rider.x, rider.y + 1.5, rider.z).project(camera);
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
