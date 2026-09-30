import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createFingerboard } from '../lib/fingerboard.js';
import { createTiltShift } from './tiltshift.js';
import { createEffects } from './effects.js';
import { DESK } from './park.js';
import {
  createTableTexture,
  createRampTexture,
  createConcreteTexture,
  createBaseTexture,
  createFloorTexture,
  createPropMaterials,
  buildPark,
  buildGround,
  buildDeskClutter,
} from './props.js';

/** A dim room for the desk to sit in; it reads behind the park. */
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

export function createGameScene(canvas, { quality = 'high', accent = '#ff5722', park }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = createRoomBackdrop();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1600);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.5;

  /* ------------------------------------------------------------- lights */

  // Warm key from above, like a desk lamp. Its shadow is what grounds the
  // board, so the shadow camera follows the board round the park.
  const key = new THREE.DirectionalLight('#ffe6c4', 3.0);
  key.castShadow = true;
  const shadowSize = quality === 'high' ? 2048 : 1024;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 200;
  const shadowSpan = 44;
  key.shadow.camera.left = -shadowSpan;
  key.shadow.camera.right = shadowSpan;
  key.shadow.camera.top = shadowSpan;
  key.shadow.camera.bottom = -shadowSpan;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight('#9fc4ff', 0.6);
  fill.position.set(-60, 40, -50);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight('#3a4a66', '#120d08', 0.55));

  /* ---------------------------------------------------------- materials */

  const textures = {
    desk: createTableTexture(),
    ramp: createRampTexture(),
    concrete: createConcreteTexture(),
    base: createBaseTexture(),
    floor: createFloorTexture(),
  };
  const materials = {
    ramp: new THREE.MeshStandardMaterial({ map: textures.ramp, roughness: 0.72 }),
    concrete: new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c3c9d2', roughness: 0.22, metalness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: '#6d4726', roughness: 0.55 }),
    base: new THREE.MeshStandardMaterial({ map: textures.base, roughness: 0.8 }),
    desk: new THREE.MeshStandardMaterial({ map: textures.desk, roughness: 0.62, metalness: 0.02 }),
    deskEdge: new THREE.MeshStandardMaterial({ color: '#5b3b20', roughness: 0.55 }),
    floor: new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.8 }),
    ring: new THREE.MeshStandardMaterial({
      color: '#ffcf3d', emissive: '#ff9d00', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6,
    }),
  };
  const propMaterials = createPropMaterials();

  /* -------------------------------------------------------------- world */

  scene.add(buildGround(materials, textures.desk));
  scene.add(buildPark(park, materials));
  scene.add(buildDeskClutter(propMaterials));

  const letters = park.letters.map((l) => {
    const letter = createLetter(l.letter, materials.ring);
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
  flipGroup.add(board.object);
  scene.add(root);

  // Off the roll axis on purpose: a point on the centre line would not move
  // during a kickflip, so the trail would draw nothing.
  const noseMarker = new THREE.Object3D();
  noseMarker.position.set(4.6, -0.2, 1.4);
  board.object.add(noseMarker);

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
    board.object.position.y = lift - middle;

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
    const targetY = Math.max(rider.y, DESK.y);
    followY = snap ? targetY : followY + (targetY - followY) * (1 - Math.exp(-dt * 4));

    punch = Math.max(0, punch - dt * 2.2);
    const pull = 1 - punch * 0.25;
    let distance = framing.distance * pull;
    let height = framing.height * pull;

    const bx = rider.x;
    const bz = rider.z;
    const eyeY = followY + 2;
    // Walk back from the board toward the ideal spot; stop short of anything
    // that would come between them.
    const cx = -Math.cos(cameraYaw);
    const cz = -Math.sin(cameraYaw);
    for (let i = 1; i <= 12; i += 1) {
      const t = i / 12;
      const px = bx + cx * distance * t;
      const pz = bz + cz * distance * t;
      const lineY = eyeY + (followY + height - eyeY) * t;
      const ground = park.heightAt(px, pz);
      if (ground + 1.2 > lineY) {
        const keep = Math.max(0.35, (i - 1) / 12);
        distance *= keep;
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

    key.position.set(rider.x + 30, Math.max(rider.y, 0) + 70, rider.z + 24);
    key.target.position.set(rider.x, Math.max(rider.y, 0), rider.z);
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
  const post = createTiltShift(renderer, scene, camera);
  // A deeper sharp band than the side view had: the chase camera looks down
  // the park, and the rider needs to read what is coming.
  post.setRange(0.16);
  const projected = new THREE.Vector3();

  function resize(width, height) {
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
    for (const material of [...Object.values(materials), ...Object.values(propMaterials)]) material.dispose();
    for (const texture of Object.values(textures)) texture.dispose();
    scene.background.dispose();
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
    effects,
    poseBoard,
    updateCamera,
    animateLetters,
    resize,
    render,
    dispose,

    /** Re-skin the board from the customiser's config. */
    applyConfig(config) {
      board.update(config, null);
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
