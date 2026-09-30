import * as THREE from 'three';
import { ROOM } from './room.js';

/**
 * Daylight: a low afternoon sun through the window, and everything that
 * follows from it.
 *
 * The sun is the only shadow-casting light, and its shadow map covers the
 * whole room but is rendered once, at load: the walls, the window frame and
 * every obstacle are static, so their shadows never change. That gets the
 * window's patch of sunlight on the table, the glazing bars' shadows across
 * it, and ramps shading each other, for nothing per frame. The one thing that
 * moves, the board, gets a projected soft shadow of its own instead
 * (`createBoardShadow`), shown only when the board is actually in the sun.
 */

/** Toward the sun from the middle of the table: through the window, low. */
export const TO_SUN = new THREE.Vector3(-25, 107, -240).normalize();
/** The direction sunlight travels. */
export const SUN_DIRECTION = TO_SUN.clone().negate();

const WINDOW_BARS = 1.8; // half-width of the glazing bars' shadow

export function createSun({ mapSize = 4096 } = {}) {
  const sun = new THREE.DirectionalLight('#ffecd2', 6.2);
  sun.position.copy(TO_SUN).multiplyScalar(520);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const camera = sun.shadow.camera;
  camera.near = 200;
  camera.far = 1000;
  camera.left = -230;
  camera.right = 230;
  camera.top = 190;
  camera.bottom = -190;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  sun.shadow.autoUpdate = false; // static: drawn once, see needsUpdate below
  sun.shadow.needsUpdate = true;
  return sun;
}

/**
 * How much direct sun reaches (x, y, z): 0 or 1. Blocked by anything taller
 * along the ray toward the sun, or by the wall round the window and its bars.
 */
export function sunVisibility(park, x, y, z) {
  // Obstacles first: march toward the sun over the park's heights.
  for (let t = 0.6; t < 70; t += 0.6) {
    const px = x + TO_SUN.x * t;
    const py = y + TO_SUN.y * t;
    const pz = z + TO_SUN.z * t;
    if (py > 45) break; // nothing on the table is taller
    if (park.heightAt(px, pz) > py) return 0;
  }
  // Then the back wall: through the glass, or not.
  const t = (ROOM.minZ - z) / TO_SUN.z;
  const hx = x + TO_SUN.x * t;
  const hy = y + TO_SUN.y * t;
  const w = ROOM.window;
  if (hx < w.x - w.width / 2 || hx > w.x + w.width / 2 || hy < w.bottom || hy > w.top) return 0;
  if (Math.abs(hx - w.x) < WINDOW_BARS) return 0;
  if (Math.abs(hy - (w.bottom + w.top) / 2) < WINDOW_BARS) return 0;
  return 1;
}

/* --------------------------------------------------------- board shadow */

/** A soft board-shaped shadow: the deck's outline, blurred. */
function createBoardShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const shape = (inset, alpha) => {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    const r = 34 - inset;
    const x0 = 16 + inset;
    const x1 = 240 - inset;
    const y0 = 14 + inset;
    const y1 = 82 - inset;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x1 - r, y0);
    ctx.arc(x1 - r, (y0 + y1) / 2, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + r, y1);
    ctx.arc(x0 + r, (y0 + y1) / 2, r, Math.PI / 2, Math.PI * 1.5);
    ctx.fill();
  };
  // Layered from the soft outside in: a penumbra without a canvas filter,
  // which not every phone browser supports.
  for (let i = 0; i < 12; i += 1) shape(i * 1.4, 0.09);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/**
 * The board's own shadow: its outline projected along the sunlight onto
 * whatever is below, tilted to that surface, sharp-ish and dark in the sun,
 * a faint contact smudge in shade, and fading as the board rises.
 */
export function createBoardShadow(park, { length = 9.6, width = 3 } = {}) {
  const texture = createBoardShadowTexture();
  const material = new THREE.MeshBasicMaterial({
    color: '#000000',
    alphaMap: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length * 1.12, width * 1.35), material);
  mesh.renderOrder = 2;
  mesh.userData.dynamic = true;

  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const tilt = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  let sun = 1; // eased, so walking into shade fades rather than pops

  /** `facing` is the board's yaw, `roll` its flip, `height` its wheels' y. */
  function update(x, y, z, facing, roll, dt, airborne) {
    // Follow the light down from the middle of the deck to the first surface.
    let hx = x;
    let hz = z;
    let hy = park.heightAt(x, z);
    const start = y + 0.9;
    for (let t = 0; t < 60; t += 0.25) {
      const px = x + SUN_DIRECTION.x * t;
      const py = start + SUN_DIRECTION.y * t;
      const pz = z + SUN_DIRECTION.z * t;
      const ground = park.heightAt(px, pz);
      if (py <= ground) {
        hx = px;
        hy = ground;
        hz = pz;
        break;
      }
    }
    // A contact shadow never strays far from under the board.
    const above = Math.max(0, y - park.heightAt(x, z));
    const lit = sunVisibility(park, hx, hy + 0.05, hz);
    sun += (lit - sun) * Math.min(1, dt * 10);
    const tx = sun > 0.5 ? hx : x;
    const tz = sun > 0.5 ? hz : z;
    const ty = sun > 0.5 ? hy : park.heightAt(x, z);

    // Lie on the surface there.
    const e = 0.6;
    const gx = (park.heightAt(tx + e, tz) - park.heightAt(tx - e, tz)) / (2 * e);
    const gz = (park.heightAt(tx, tz + e) - park.heightAt(tx, tz - e)) / (2 * e);
    const steep = Math.abs(gx) > 4 || Math.abs(gz) > 4;
    normal.set(steep ? 0 : -gx, 1, steep ? 0 : -gz).normalize();
    tilt.setFromUnitVectors(up, normal);
    turn.setFromAxisAngle(up, -facing);
    mesh.quaternion.copy(tilt).multiply(turn);
    mesh.rotateX(-Math.PI / 2);
    mesh.position.set(tx, ty + 0.04, tz);
    // A flipping board is narrower side-on.
    mesh.scale.set(1, Math.max(0.35, Math.abs(Math.cos(roll))), 1);

    const fade = Math.max(0, 1 - above / 22);
    const direct = 0.6 * sun;
    const contact = 0.35 * Math.max(0, 1 - above / 3);
    material.opacity = Math.min(0.7, (direct + contact * (1 - sun)) * fade);
    mesh.visible = material.opacity > 0.01 && !(airborne && above > 40);
  }

  return {
    mesh,
    update,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/* ------------------------------------------------------------ dust */

/**
 * Dust turning in the sunlight: specks scattered through the shafts that
 * come in at the window's four panes, drifting on the GPU so they cost
 * nothing on the CPU. (Solid light-shaft volumes were tried and read as
 * geometry rather than air; the motes alone sell the sunlight.)
 */
export function createSunbeams() {
  const w = ROOM.window;
  const midY = (w.bottom + w.top) / 2;
  const panes = [
    [w.x - w.width / 2, w.x - WINDOW_BARS, w.bottom, midY - WINDOW_BARS],
    [w.x + WINDOW_BARS, w.x + w.width / 2, w.bottom, midY - WINDOW_BARS],
    [w.x - w.width / 2, w.x - WINDOW_BARS, midY + WINDOW_BARS, w.top],
    [w.x + WINDOW_BARS, w.x + w.width / 2, midY + WINDOW_BARS, w.top],
  ];

  // Dust: points scattered through the shafts at table height, drifting on
  // the GPU so they cost nothing on the CPU.
  const count = 420;
  const dust = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  let n = 0;
  let guard = 0;
  while (n < count && guard < 20000) {
    guard += 1;
    const [x0, x1, y0, y1] = panes[Math.floor(Math.random() * panes.length)];
    const p = new THREE.Vector3(x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0), ROOM.minZ + 1);
    p.addScaledVector(SUN_DIRECTION, 150 + Math.random() * 330);
    if (p.y < 1 || p.y > 70) continue; // the air over and round the table
    dust.set([p.x, p.y, p.z], n * 3);
    seeds[n] = Math.random();
    n += 1;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust.subarray(0, n * 3), 3));
  dustGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds.subarray(0, n), 1));
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uScale;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        float t = uTime * (0.15 + seed * 0.2) + seed * 40.0;
        p += vec3(sin(t * 1.3) * 2.5, sin(t * 0.7 + seed * 6.0) * 1.8 - mod(uTime * 0.4 + seed * 30.0, 30.0) * 0.08, cos(t) * 2.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * (0.05 + seed * 0.05) / -mv.z;
        vTwinkle = 0.55 + 0.45 * sin(uTime * 2.0 + seed * 20.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * 0.45 * vTwinkle;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motes = new THREE.Points(dustGeometry, dustMaterial);
  motes.frustumCulled = false;
  motes.userData.dynamic = true;

  const group = new THREE.Group();
  group.add(motes);
  return {
    group,
    update(dt, pixelHeight) {
      dustMaterial.uniforms.uTime.value += dt;
      dustMaterial.uniforms.uScale.value = pixelHeight;
    },
    dispose() {
      dustGeometry.dispose();
      dustMaterial.dispose();
    },
  };
}

/**
 * Capture the room as seen from over the table and use it as the scene's
 * environment: every glossy surface — coping, rails, laptop, varnish —
 * reflects this room's window and walls rather than a generic studio, and
 * the soft ambient light carries the room's own colours. Done once.
 */
export function captureEnvironment(renderer, scene, hide = []) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hidden = hide.filter((o) => o.visible);
  for (const o of hidden) o.visible = false;
  const previous = scene.environment;
  scene.environment = null;
  const target = pmrem.fromScene(scene, 0.02, 1, 1600, { position: new THREE.Vector3(0, 14, 10), size: 256 });
  scene.environment = previous;
  for (const o of hidden) o.visible = true;
  pmrem.dispose();
  return target;
}
