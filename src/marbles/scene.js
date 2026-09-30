import * as THREE from 'three';
import { MARBLE_RADIUS, FLOOR_COLOURS } from './track.js';
import { MARBLES, createMarbleMaterial } from './designs.js';
import { mergeStatic } from '../game/batch.js';
import { createEffects } from '../game/effects.js';

/**
 * Everything you see in a marble race: the sky, the run itself built from
 * the generator's own triangles, the obstacles, the marbles rolling, the
 * fire wall, and a camera that can follow your marble, the leader, or take
 * in the whole run.
 */

/** A painted sky: blue overhead, bright haze at the horizon, a few clouds. */
function createSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#3d7fd6');
  g.addColorStop(0.45, '#8fc1f0');
  g.addColorStop(0.52, '#e6f1f7');
  g.addColorStop(0.56, '#b9cfa0');
  g.addColorStop(1, '#5e7d4a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  let seed = 3;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let c = 0; c < 14; c += 1) {
    const cx = random() * 1024;
    const cy = 60 + random() * 150;
    for (let p = 0; p < 10; p += 1) {
      const r = 20 + random() * 36;
      const puff = ctx.createRadialGradient(cx + (random() - 0.5) * 110, cy + (random() - 0.5) * 20, 0, cx, cy, r * 1.7);
      puff.addColorStop(0, 'rgba(255,255,255,0.5)');
      puff.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = puff;
      ctx.fillRect(cx - 180, cy - 110, 360, 220);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** Arrow chevrons for boost pads; scrolled along the pad to look alive. */
function createBoostTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a0f00';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#ffb21a';
  for (let i = 0; i < 2; i += 1) {
    const y = i * 64;
    ctx.beginPath();
    ctx.moveTo(20, y + 44);
    ctx.lineTo(64, y + 12);
    ctx.lineTo(108, y + 44);
    ctx.lineTo(108, y + 60);
    ctx.lineTo(64, y + 28);
    ctx.lineTo(20, y + 60);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createCheckerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 16; x += 1) {
    for (let y = 0; y < 2; y += 1) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A sheet of flame: noise-driven, additive, scrolling upward. */
function createFireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vec2(vUv.x * 6.0, vUv.y * 2.5 - uTime * 2.2);
        float n = fbm(p);
        float height = 1.0 - vUv.y;
        float flame = smoothstep(0.15, 0.9, n * 1.35 * height + height * 0.45 - 0.1);
        float edges = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        vec3 colour = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.35), flame);
        gl_FragColor = vec4(colour * flame * edges * 1.6, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * One renderer for the whole visit to the marble races: a released WebGL
 * context can never be recreated on the same canvas, so tracks come and go
 * but the renderer stays.
 */
export function createMarbleRenderer(canvas, { quality = 'high' } = {}) {
  const phone = quality !== 'high';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.debug.checkShaderErrors = !!import.meta.env?.DEV;
  return renderer;
}

export function createMarbleScene(renderer, { quality = 'high', track }) {
  const phone = quality !== 'high';
  const scene = new THREE.Scene();
  const sky = createSkyTexture();
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromEquirectangular(sky);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();
  scene.fog = new THREE.Fog('#cfe2ef', 260, 900);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 3000);

  // Sun, with a shadow box that follows the camera's subject: only the
  // marbles cast into it, the run only receives.
  const sun = new THREE.DirectionalLight('#fff2dc', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  const span = 26;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 260 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#56704a', 0.9));

  /* ------------------------------------------------------------ the run */

  const textures = { boost: createBoostTexture(), checker: createCheckerTexture() };
  const materials = {
    floors: FLOOR_COLOURS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.28, metalness: 0.05 })),
    // Clear acrylic walls, so you can see marbles through the side of the run.
    wall: new THREE.MeshPhysicalMaterial({
      color: '#e8f4ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28,
      clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
    }),
    rim: new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.35 }),
    under: new THREE.MeshStandardMaterial({ color: '#39414d', roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: '#9aa4b1', roughness: 0.4, metalness: 0.6 }),
    peg: new THREE.MeshStandardMaterial({ color: '#f7f7f5', roughness: 0.2 }),
    pegCap: new THREE.MeshStandardMaterial({ color: '#ff4d6d', roughness: 0.3 }),
    spinner: new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.3, metalness: 0.2 }),
    hub: new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.6 }),
    boost: new THREE.MeshBasicMaterial({ map: textures.boost, toneMapped: false }),
    gate: new THREE.MeshStandardMaterial({ color: '#ff5a36', roughness: 0.4 }),
    checker: new THREE.MeshStandardMaterial({ map: textures.checker, roughness: 0.5, side: THREE.DoubleSide }),
    ground: new THREE.MeshLambertMaterial({ color: '#6f9a55' }),
  };

  const bufferGeometry = (data) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    return g;
  };

  const staticGroup = new THREE.Group();
  const walls = new THREE.Group();
  for (const [key, data] of Object.entries(track.render)) {
    const geometry = bufferGeometry(data);
    if (key.startsWith('floor:')) {
      staticGroup.add(new THREE.Mesh(geometry, materials.floors[Number(key.split(':')[1])]));
    } else if (key === 'wall' || key === 'wallOuter') {
      // Transparent: kept out of the merge, drawn after everything solid.
      const mesh = new THREE.Mesh(geometry, materials.wall);
      mesh.userData.dynamic = true;
      mesh.renderOrder = 2;
      walls.add(mesh);
    } else {
      staticGroup.add(new THREE.Mesh(geometry, key === 'rim' ? materials.rim : materials.under));
    }
  }

  // Posts down to the ground, every so often.
  const groundY = track.bounds.minY - 40;
  for (let i = 0; i < track.samples.length; i += Math.round(24 / track.spacing)) {
    const p = track.samples[i];
    const top = p.y - 0.6;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, top - groundY, 8), materials.post);
    post.position.set(p.x, (top + groundY) / 2, p.z);
    staticGroup.add(post);
  }

  // Obstacles.
  const spinners = [];
  const bumpers = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const o of track.obstacles) {
    if (o.type === 'peg' || o.type === 'bumper') {
      const axis = new THREE.Vector3(...o.axis);
      const q = new THREE.Quaternion().setFromUnitVectors(up, axis);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, o.height, o.type === 'peg' ? 12 : 24), o.type === 'peg' ? materials.peg : materials.pegCap);
      body.quaternion.copy(q);
      body.position.set(...o.base).addScaledVector(axis, o.height / 2);
      if (o.type === 'peg') {
        staticGroup.add(body);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(o.radius * 1.05, 10, 8), materials.pegCap);
        cap.position.set(...o.base).addScaledVector(axis, o.height);
        staticGroup.add(cap);
      } else {
        // Pop bumpers flash when hit, so each has its own glowing ring.
        const ringMaterial = new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffb300', emissiveIntensity: 0.2 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(o.radius * 0.95, 0.16, 8, 24), ringMaterial);
        ring.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        ring.position.set(...o.base).addScaledVector(axis, o.height + 0.05);
        ring.userData.dynamic = true;
        body.userData.dynamic = true;
        walls.add(body, ring);
        bumpers.push({ obstacle: o, ringMaterial });
      }
    } else if (o.type === 'spinner') {
      const group = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(o.radius, o.arm * 2, 4, 10), materials.spinner);
      bar.rotation.z = Math.PI / 2;
      group.add(bar);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 16), materials.hub);
      group.add(hub);
      // Local frame: x along `right`, y along `axis`, z along `forward`.
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...o.right), new THREE.Vector3(...o.axis), new THREE.Vector3(...o.forward),
      );
      const holder = new THREE.Group();
      holder.quaternion.setFromRotationMatrix(basis);
      holder.position.set(...o.centre);
      holder.add(group);
      holder.traverse((n) => { n.userData.dynamic = true; });
      walls.add(holder);
      spinners.push({ obstacle: o, group });
    } else if (o.type === 'boost') {
      // A strip of chevrons laid on the floor over the pad's extent.
      const positions = [];
      const uvs = [];
      for (let i = o.from; i < o.to; i += 1) {
        const a = track.samples[i];
        const b = track.samples[i + 1];
        const at = (p, across) => [
          p.x + p.r[0] * across + p.u[0] * (p.lift + 0.03),
          p.y + p.r[1] * across + p.u[1] * (p.lift + 0.03),
          p.z + p.r[2] * across + p.u[2] * (p.lift + 0.03),
        ];
        const v0 = (i - o.from) * track.spacing / 3;
        const v1 = v0 + track.spacing / 3;
        const [l, r] = o.across;
        positions.push(...at(a, l), ...at(a, r), ...at(b, r), ...at(a, l), ...at(b, r), ...at(b, l));
        uvs.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      const pad = new THREE.Mesh(g, materials.boost);
      pad.userData.dynamic = true;
      walls.add(pad);
    }
  }

  // Start gate: a panel that drops away at the start.
  const gateCorners = track.gate.corners.map((c) => new THREE.Vector3(...c));
  const gateGeometry = new THREE.BufferGeometry().setFromPoints([
    gateCorners[0], gateCorners[1], gateCorners[2], gateCorners[0], gateCorners[2], gateCorners[3],
  ]);
  gateGeometry.computeVertexNormals();
  const gate = new THREE.Mesh(gateGeometry, materials.gate);
  gate.material.side = THREE.DoubleSide;
  scene.add(gate);

  // Finish arch: two posts and a chequered banner across the line.
  const finish = track.samples[track.finishIndex];
  const archGroup = new THREE.Group();
  const posts = [-1, 1].map((side) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 9, 10), materials.post);
    post.position.set(side * (finish.half + 0.8), 4.5, 0);
    return post;
  });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(finish.half * 2 + 1.6, 1.4), materials.checker);
  banner.position.y = 8.2;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(finish.half * 2, 0.6), materials.checker);
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.04;
  archGroup.add(...posts, banner, line);
  archGroup.matrixAutoUpdate = false;
  archGroup.matrix.makeBasis(
    new THREE.Vector3(...finish.r), new THREE.Vector3(...finish.u), new THREE.Vector3(...finish.t).negate(),
  ).setPosition(finish.x, finish.y, finish.z);
  staticGroup.add(archGroup);

  // Ground far below, for a sense of height.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  staticGroup.add(ground);

  const merged = mergeStatic(staticGroup, { receiveShadow: true, name: 'run' });
  scene.add(merged, walls);

  /* ------------------------------------------------------------ marbles */

  const marbleGeometry = new THREE.SphereGeometry(MARBLE_RADIUS, phone ? 20 : 28, phone ? 14 : 20);
  const marbleMaterials = MARBLES.map((design) => createMarbleMaterial(design));
  const marbleMeshes = marbleMaterials.map((material) => {
    const mesh = new THREE.Mesh(marbleGeometry, material);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });

  // "You" marker: a soft arrow bobbing over the player's marble.
  const markerMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false });
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 12), markerMaterial);
  marker.rotation.x = Math.PI;
  marker.renderOrder = 5;
  scene.add(marker);

  /* --------------------------------------------------------------- fire */

  const fireMaterial = createFireMaterial();
  const fire = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMaterial);
  fire.add(flame);
  const fireLight = new THREE.PointLight('#ff6a1a', 0, 60, 1.6);
  fire.add(fireLight);
  fire.visible = false;
  scene.add(fire);

  const effects = createEffects(scene, { accent: '#ff7a1a' });

  /* -------------------------------------------------------------- camera */

  let mode = 'mine';
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const wantEye = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  let first = true;

  const focus = new THREE.Vector3();
  let runYaw = null; // the run's direction under the followed marble, smoothed

  const shortest = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

  function overviewSpot() {
    const b = track.bounds;
    const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    return { eye: new THREE.Vector3(c.x - size * 0.6, c.y + size * 0.5, c.z - size * 0.6), centre: c };
  }

  /**
   * Put the camera where it should be this frame. `controls` carries the
   * player's own orbit (when following a marble) or flight (overview).
   */
  function place(race, subjectId, dt, { preview = false, time = 0, controls = null } = {}) {
    const samples = track.samples;
    if (preview) {
      // Fly slowly down the run, looking along it.
      const i = Math.floor((time * 6) / track.spacing) % Math.max(1, samples.length - 20);
      const p = samples[i];
      const q = samples[Math.min(samples.length - 1, i + 14)];
      wantEye.set(p.x - p.r[0] * 10, p.y + 12, p.z - p.r[2] * 10);
      wantLook.set(q.x, q.y, q.z);
      const k = first ? 1 : 1 - Math.exp(-dt * 1.5);
      eye.lerp(wantEye, k);
      look.lerp(wantLook, k);
      first = false;
      camera.position.copy(eye);
      camera.lookAt(look);
    } else if (mode === 'overview' && controls) {
      const fly = controls.fly;
      if (!fly.ready) {
        if (fly.home) {
          // Back over the whole run, looking at the middle of it.
          const { eye: spot, centre } = overviewSpot();
          fly.x = spot.x; fly.y = spot.y; fly.z = spot.z;
          const d = centre.clone().sub(spot).normalize();
          fly.yaw = Math.atan2(d.z, d.x);
          fly.pitch = Math.asin(d.y);
        } else {
          // Take off from wherever the camera already is: no jump.
          const d = new THREE.Vector3();
          camera.getWorldDirection(d);
          fly.x = camera.position.x; fly.y = camera.position.y; fly.z = camera.position.z;
          fly.yaw = Math.atan2(d.z, d.x);
          fly.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
        }
        fly.ready = true;
        fly.home = false;
      }
      // Keep the flight near the run and above the ground, so the track is
      // never more than a turn of the head away.
      const b = track.bounds;
      const margin = Math.max(40, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5);
      fly.x = Math.max(b.minX - margin, Math.min(b.maxX + margin, fly.x));
      fly.z = Math.max(b.minZ - margin, Math.min(b.maxZ + margin, fly.z));
      fly.y = Math.max(groundY + 1.5, Math.min(b.maxY + margin, fly.y));
      const cp = Math.cos(fly.pitch);
      camera.position.set(fly.x, fly.y, fly.z);
      look.set(fly.x + Math.cos(fly.yaw) * cp * 30, fly.y + Math.sin(fly.pitch) * 30, fly.z + Math.sin(fly.yaw) * cp * 30);
      camera.lookAt(look);
      eye.copy(camera.position);
    } else {
      const m = race.marbles[subjectId];
      const p = samples[Math.min(samples.length - 1, m.index)];
      // Orbit round the marble. The angle is measured from "behind, along
      // the run", so a look behind stays a look behind as the run turns.
      const heading = Math.atan2(p.t[2], p.t[0]);
      if (runYaw === null || first) {
        runYaw = heading;
        focus.set(m.x, m.y, m.z);
      }
      runYaw += shortest(runYaw, heading) * (1 - Math.exp(-dt * 3));
      const k = first ? 1 : 1 - Math.exp(-dt * 12);
      focus.lerp(wantLook.set(m.x, m.y, m.z), k);
      first = false;

      const orbit = controls?.follow ?? { yaw: 0, pitch: 0.55, distance: 10.5 };
      const a = runYaw + Math.PI + orbit.yaw;
      const cp = Math.cos(orbit.pitch);
      eye.set(
        focus.x + Math.cos(a) * cp * orbit.distance,
        focus.y + Math.sin(orbit.pitch) * orbit.distance,
        focus.z + Math.sin(a) * cp * orbit.distance,
      );
      // Looking along the run when behind the marble; straight at it once
      // swung round to the side or the front.
      const lead = Math.max(0, Math.cos(orbit.yaw)) * 4;
      look.set(
        focus.x + Math.cos(runYaw) * lead,
        focus.y + 0.4,
        focus.z + Math.sin(runYaw) * lead,
      );
      camera.position.copy(eye);
      camera.lookAt(look);
    }

    sun.position.set(look.x + 40, look.y + 90, look.z + 30);
    sun.target.position.copy(look);
    sun.target.updateMatrixWorld();
  }

  /* ---------------------------------------------------------------- pose */

  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const burnt = new THREE.Color('#1a1512');

  function pose(race, playerId, dt, clock) {
    for (const m of race.marbles) {
      const mesh = marbleMeshes[m.id];
      if (m.eliminated) {
        // Charred, shrinking, gone.
        m.burn = (m.burn ?? 0) + dt;
        mesh.material.color.lerp(burnt, Math.min(1, dt * 4));
        const s = Math.max(0, 1 - m.burn / 1.2);
        mesh.scale.setScalar(s);
        mesh.visible = s > 0;
        if (!m.burnt) {
          m.burnt = true;
          effects.burst(m.x, m.y, m.z, 20, 14, new THREE.Color('#ff7a1a'));
        }
        continue;
      }
      mesh.position.set(m.x, m.y, m.z);
      // Roll: turn about (contact normal x velocity) by distance / radius.
      const speed = Math.hypot(m.vx, m.vy, m.vz);
      if (speed > 0.05) {
        axis.set(m.ny * m.vz - m.nz * m.vy, m.nz * m.vx - m.nx * m.vz, m.nx * m.vy - m.ny * m.vx);
        if (axis.lengthSq() > 1e-8) {
          axis.normalize();
          spin.setFromAxisAngle(axis, (speed * dt) / MARBLE_RADIUS);
          mesh.quaternion.premultiply(spin);
        }
      }
    }
    for (const s of spinners) s.group.rotation.y = -s.obstacle.angle;
    for (const b of bumpers) b.ringMaterial.emissiveIntensity = 0.2 + (b.obstacle.flash ?? 0) * 3;
    textures.boost.offset.y = -clock * 1.8;

    const me = race.marbles[playerId];
    marker.visible = !me.eliminated;
    marker.position.set(me.x, me.y + 1.6 + Math.sin(clock * 4) * 0.15, me.z);

    // Gate drops away once the race is on.
    if (race.gateOpen) gate.position.y = Math.max(gate.position.y - dt * 12, -8);

    // The fire wall, stood across the run where it has reached.
    fire.visible = race.fire.active;
    if (race.fire.active) {
      const i = Math.min(track.samples.length - 1, Math.round(race.fire.s / track.spacing));
      const p = track.samples[i];
      fire.position.set(p.x, p.y, p.z);
      fire.matrixAutoUpdate = true;
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...p.r), new THREE.Vector3(...p.u), new THREE.Vector3(...p.t).negate(),
      );
      fire.quaternion.setFromRotationMatrix(basis);
      flame.scale.set(p.half * 2 + 3, 9, 1);
      flame.position.y = 4.2;
      fireLight.position.set(0, 3, 2);
      fireLight.intensity = 600 + Math.sin(clock * 20) * 120;
      fireMaterial.uniforms.uTime.value = clock;
      if (Math.random() < 0.6) {
        const across = (Math.random() - 0.5) * p.half * 2;
        effects.burst(p.x + p.r[0] * across, p.y + 1, p.z + p.r[2] * across, 1, 8, new THREE.Color('#ffae42'));
      }
    }
  }

  /* ------------------------------------------------------------- render */

  function resize(width, height) {
    camera.aspect = width / height;
    camera.fov = width < height ? 68 : 55;
    camera.updateProjectionMatrix();
  }

  return {
    renderer,
    camera,
    place,
    pose,
    resize,
    effects,
    setMode(next) {
      mode = next;
    },
    get cameraPosition() {
      return camera.position.clone();
    },
    /** Shadows are the last thing a struggling phone gives up. */
    setShadows(on) {
      sun.castShadow = on;
    },
    get mode() {
      return mode;
    },
    /** Screen position of a marble, 0..1, for pop-ups. */
    project(m) {
      const v = new THREE.Vector3(m.x, m.y + 1, m.z).project(camera);
      return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      effects.dispose();
      scene.traverse((node) => {
        if (node.isMesh || node.isPoints) node.geometry?.dispose();
      });
      const all = [
        ...Object.values(materials).flat(), ...marbleMaterials, markerMaterial, fireMaterial,
        ...bumpers.map((b) => b.ringMaterial), ...(merged.userData.ownedMaterials ?? []),
      ];
      for (const material of all) {
        material.map?.dispose();
        material.dispose();
      }
      for (const texture of Object.values(textures)) texture.dispose();
      sky.dispose();
      envTarget.dispose();
      // The renderer belongs to the caller and outlives this scene.
    },
  };
}
