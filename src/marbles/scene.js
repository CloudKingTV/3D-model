import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MARBLE_RADIUS } from './track.js';
import { MARBLES, createMarbleMaterial } from './designs.js';
import { WORLDS } from './themes.js';
import { mergeStatic } from '../game/batch.js';
import { createEffects } from '../game/effects.js';

/**
 * Everything you see in a marble race: a world (sky, ground and scenery),
 * the run itself built from the generator's own triangles, the obstacles,
 * coins and power-up boxes, the marbles rolling, trails and power-up
 * effects, the fire wall, and a camera that follows a marble or flies free.
 *
 * Glow is real: emissive surfaces brighter than white bloom when the
 * device can afford the half-float targets it needs.
 */

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw, { srgb = true, repeat = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.anisotropy = 4;
  return texture;
}

/** The world's sky: gradient, then clouds, wisps, stars or smoke. */
function createSkyTexture(world) {
  const texture = canvasTexture(1024, 512, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    for (const [stop, colour] of world.sky) g.addColorStop(stop, colour);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const random = seeded(world.id.length * 97 + 3);
    if (world.clouds === 'puffy' || world.clouds === 'smoke') {
      const smoke = world.clouds === 'smoke';
      for (let c = 0; c < (smoke ? 22 : 14); c += 1) {
        const cx = random() * W;
        const cy = (smoke ? 120 : 60) + random() * (smoke ? 120 : 150);
        for (let p = 0; p < 10; p += 1) {
          const r = 20 + random() * 36;
          const puff = ctx.createRadialGradient(cx + (random() - 0.5) * 110, cy + (random() - 0.5) * 20, 0, cx, cy, r * 1.7);
          puff.addColorStop(0, smoke ? 'rgba(30,14,12,0.55)' : 'rgba(255,255,255,0.5)');
          puff.addColorStop(1, smoke ? 'rgba(30,14,12,0)' : 'rgba(255,255,255,0)');
          ctx.fillStyle = puff;
          ctx.fillRect(cx - 180, cy - 110, 360, 220);
        }
      }
      if (smoke) {
        // The glow of the caldera on the horizon.
        const glow = ctx.createRadialGradient(W * 0.3, H * 0.52, 0, W * 0.3, H * 0.52, 260);
        glow.addColorStop(0, 'rgba(255,120,40,0.55)');
        glow.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      }
    } else if (world.clouds === 'wisps') {
      for (let c = 0; c < 18; c += 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(random() * W, 40 + random() * 170, 60 + random() * 120, 4 + random() * 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (world.clouds === 'stars') {
      for (let i = 0; i < 700; i += 1) {
        const y = random() * H * 0.5;
        ctx.fillStyle = `rgba(255,255,255,${(0.3 + random() * 0.7) * (1 - y / (H * 0.55))})`;
        const s = random() < 0.08 ? 2 : 1;
        ctx.fillRect(random() * W, y, s, s);
      }
      // A big moon and the city's glow at the horizon.
      const moon = ctx.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, 60);
      moon.addColorStop(0, 'rgba(255,240,255,1)');
      moon.addColorStop(0.25, 'rgba(255,220,255,0.95)');
      moon.addColorStop(0.3, 'rgba(255,120,220,0.25)');
      moon.addColorStop(1, 'rgba(255,80,200,0)');
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, W, H);
      const haze = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.56);
      haze.addColorStop(0, 'rgba(255,43,214,0)');
      haze.addColorStop(1, 'rgba(255,43,214,0.35)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, H * 0.4, W, H * 0.16);
    }
  });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** Arrow chevrons for boost pads; scrolled along the pad to look alive. */
function createBoostTexture() {
  return canvasTexture(128, 128, (ctx) => {
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
  }, { repeat: true });
}

function createCheckerTexture() {
  return canvasTexture(256, 32, (ctx) => {
    for (let x = 0; x < 16; x += 1) {
      for (let y = 0; y < 2; y += 1) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
}

/**
 * The chute floor's pattern (u across, v along, 4 units per repeat): white
 * so it takes the module's colour, with darker edge bands and a dashed
 * centre line. `glow` draws the same lines bright on black for an
 * emissive map.
 */
function createFloorTexture(glow = false) {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = glow ? '#000' : '#fff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = glow ? '#fff' : 'rgba(0,0,0,0.16)';
    ctx.fillRect(0, 0, 7, 128);
    ctx.fillRect(121, 0, 7, 128);
    ctx.fillStyle = glow ? '#fff' : 'rgba(255,255,255,0.0)';
    if (glow) {
      ctx.fillRect(61, 8, 6, 48);
      ctx.fillRect(61, 72, 6, 48);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(62, 10, 4, 44);
      ctx.fillRect(62, 74, 4, 44);
      // A faint sheen band, like moulded plastic.
      const g = ctx.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0.3, 'rgba(255,255,255,0)');
      g.addColorStop(0.42, 'rgba(255,255,255,0.12)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  }, { repeat: true, srgb: !glow });
}

function createGridTexture() {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 128, 4);
    ctx.fillRect(0, 0, 4, 128);
  }, { repeat: true });
}

function createLavaTexture() {
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    const random = seeded(55);
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i += 1) {
      let x = random() * 512;
      let y = random() * 512;
      ctx.strokeStyle = `rgba(255,${120 + random() * 100},40,${0.5 + random() * 0.5})`;
      ctx.lineWidth = 1 + random() * 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 8; s += 1) {
        x += (random() - 0.5) * 70;
        y += (random() - 0.5) * 70;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 12; i += 1) {
      const x = random() * 512;
      const y = random() * 512;
      const r = 12 + random() * 30;
      const pool = ctx.createRadialGradient(x, y, 0, x, y, r);
      pool.addColorStop(0, 'rgba(255,220,120,1)');
      pool.addColorStop(0.5, 'rgba(255,90,20,0.9)');
      pool.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { repeat: true });
}

/** Windows for the neon towers: rows of lit and dark panes. */
function createWindowTexture() {
  return canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 64, 128);
    const random = seeded(9);
    for (let y = 4; y < 128; y += 8) {
      for (let x = 4; x < 64; x += 10) {
        if (random() < 0.45) continue;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + random() * 0.6})`;
        ctx.fillRect(x, y, 6, 4);
      }
    }
  }, { repeat: true });
}

/** The "?" on a power-up box: a bright badge on each face. */
function createBoxTexture() {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, '#ff4fd8');
    g.addColorStop(0.5, '#ffd84d');
    g.addColorStop(1, '#3fd6ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 116, 116);
    ctx.fillStyle = '#fff';
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#5a1a6b';
    ctx.strokeText('?', 64, 70);
    ctx.fillText('?', 64, 70);
  });
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
 * One renderer for the whole visit: a released WebGL context can never be
 * recreated on the same canvas, so tracks come and go but the renderer stays.
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

/**
 * @param {object} options
 * @param {string} options.world      key into WORLDS
 * @param {number[]} options.designs  design index for each marble id
 * @param {string[]} options.trail    trail colours for the player (empty: none)
 */
export function createMarbleScene(renderer, {
  quality = 'high', track, world: worldId = 'meadow', designs = MARBLES.map((_, i) => i), trail = [],
}) {
  const phone = quality !== 'high';
  const world = WORLDS[worldId] ?? WORLDS.meadow;
  const scene = new THREE.Scene();
  const sky = createSkyTexture(world);
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromEquirectangular(sky);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = world.env;
  pmrem.dispose();
  scene.fog = new THREE.Fog(world.fog, 240, 900);
  renderer.toneMappingExposure = world.exposure;

  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 3000);

  // Sun, with a shadow box that follows the camera's subject: only the
  // marbles cast into it, the run only receives.
  const sun = new THREE.DirectionalLight(world.sun, world.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  const span = 26;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 260 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(world.hemi[0], world.hemi[1], world.hemi[2]));

  /* ------------------------------------------------------------ the run */

  const glowWorld = !!world.floorGlow;
  const textures = {
    boost: createBoostTexture(),
    checker: createCheckerTexture(),
    floor: createFloorTexture(false),
    floorGlow: glowWorld ? createFloorTexture(true) : null,
    ground: world.groundGlow === 'grid' ? createGridTexture() : world.groundGlow === 'lava' ? createLavaTexture() : null,
    windows: world.deco === 'towers' ? createWindowTexture() : null,
    box: createBoxTexture(),
  };
  if (textures.ground) textures.ground.repeat.set(world.groundGlow === 'grid' ? 200 : 16, world.groundGlow === 'grid' ? 200 : 16);

  const materials = {
    floors: world.floors.map((c, i) => new THREE.MeshStandardMaterial({
      color: c,
      map: textures.floor,
      roughness: glowWorld ? 0.35 : 0.28,
      metalness: glowWorld ? 0.3 : 0.05,
      emissive: glowWorld ? world.floorGlow[i % world.floorGlow.length] : '#000000',
      emissiveMap: textures.floorGlow,
      emissiveIntensity: glowWorld ? 2.2 : 0,
    })),
    // Clear acrylic walls, so you can see marbles through the side of the run.
    wall: new THREE.MeshPhysicalMaterial({
      color: glowWorld ? '#b9c8ff' : '#e8f4ff', roughness: 0.05, metalness: 0, transparent: true, opacity: glowWorld ? 0.18 : 0.28,
      clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
    }),
    rim: new THREE.MeshStandardMaterial({
      color: world.rim, roughness: 0.35, emissive: world.rimGlow ? world.rim : '#000000', emissiveIntensity: world.rimGlow,
    }),
    under: new THREE.MeshStandardMaterial({ color: world.under, roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: world.post, roughness: 0.4, metalness: 0.6 }),
    peg: new THREE.MeshStandardMaterial({ color: '#f7f7f5', roughness: 0.2 }),
    pegCap: new THREE.MeshStandardMaterial({ color: '#ff4d6d', roughness: 0.3, emissive: glowWorld ? '#ff4d6d' : '#000000', emissiveIntensity: glowWorld ? 1.2 : 0 }),
    spinner: new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.3, metalness: 0.2, emissive: glowWorld ? '#ffb300' : '#000000', emissiveIntensity: glowWorld ? 1.4 : 0 }),
    hub: new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.6 }),
    boost: new THREE.MeshBasicMaterial({ map: textures.boost, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }),
    gate: new THREE.MeshStandardMaterial({ color: world.accent, roughness: 0.4, side: THREE.DoubleSide }),
    checker: new THREE.MeshStandardMaterial({ map: textures.checker, roughness: 0.5, side: THREE.DoubleSide }),
    ground: textures.ground
      ? new THREE.MeshStandardMaterial({
        color: world.ground, roughness: 0.9, emissive: world.groundGlow === 'grid' ? '#ff2bd6' : '#ff5a1f',
        emissiveMap: textures.ground, emissiveIntensity: world.groundGlow === 'grid' ? 1.1 : 1.8,
      })
      : new THREE.MeshLambertMaterial({ color: world.ground }),
    coin: new THREE.MeshStandardMaterial({ color: '#ffc933', metalness: 1, roughness: 0.22, emissive: '#ff9d00', emissiveIntensity: 0.35 }),
    box: new THREE.MeshStandardMaterial({
      map: textures.box, emissiveMap: textures.box, emissive: '#ffffff', emissiveIntensity: 1.25,
      roughness: 0.2, transparent: true, opacity: 0.92,
    }),
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
      staticGroup.add(new THREE.Mesh(geometry, materials.floors[Number(key.split(':')[1]) % materials.floors.length]));
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
        const ringMaterial = new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffb300', emissiveIntensity: 0.3 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(o.radius * 0.95, 0.16, 8, 24), ringMaterial);
        ring.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        ring.position.set(...o.base).addScaledVector(axis, o.height + 0.05);
        ring.userData.dynamic = true;
        body.userData.dynamic = true;
        walls.add(body, ring);
        bumpers.push({ obstacle: o, ringMaterial, ring, base: ring.scale.clone() });
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
  const finishMatrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...finish.r), new THREE.Vector3(...finish.u), new THREE.Vector3(...finish.t).negate(),
  ).setPosition(finish.x, finish.y, finish.z);
  archGroup.matrix.copy(finishMatrix);
  staticGroup.add(archGroup);

  // Ground far below, for a sense of height.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  staticGroup.add(ground);

  const merged = mergeStatic(staticGroup, { receiveShadow: true, name: 'run' });
  scene.add(merged, walls);

  /* ------------------------------------------------------------ scenery */

  const deco = buildDecorations(world, track, groundY, phone ? 90 : 180, textures);
  scene.add(deco.group);

  /* ------------------------------------------------------------ pickups */

  const coins = (track.pickups ?? []).filter((p) => p.kind === 'coin');
  const boxes = (track.pickups ?? []).filter((p) => p.kind === 'box');
  const coinMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, phone ? 14 : 20), materials.coin, Math.max(1, coins.length));
  const boxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), materials.box, Math.max(1, boxes.length));
  coinMesh.count = 0;
  boxMesh.count = 0;
  coinMesh.frustumCulled = false;
  boxMesh.frustumCulled = false;
  scene.add(coinMesh, boxMesh);
  const scratchMatrix = new THREE.Matrix4();
  const scratchQuat = new THREE.Quaternion();
  const scratchPos = new THREE.Vector3();
  const scratchScale = new THREE.Vector3();
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const tumble = new THREE.Euler();
  const boxScale = boxes.map(() => 1);
  const coinScale = coins.map(() => 1);

  /* ------------------------------------------------------------ marbles */

  const marbleGeometry = new THREE.SphereGeometry(MARBLE_RADIUS, phone ? 20 : 28, phone ? 14 : 20);
  const marbleMaterials = designs.map((d) => createMarbleMaterial(MARBLES[d]));
  const marbleMeshes = marbleMaterials.map((material) => {
    const mesh = new THREE.Mesh(marbleGeometry, material);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });

  // "You" marker: a soft arrow bobbing over the player's marble.
  const markerMaterial = new THREE.MeshBasicMaterial({ color: world.accent, transparent: true, opacity: 0.95, depthTest: false });
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 12), markerMaterial);
  marker.rotation.x = Math.PI;
  marker.renderOrder = 5;
  scene.add(marker);

  /* -------------------------------------------------------------- trail */

  const TRAIL = 34;
  const trailColours = trail.map((c) => new THREE.Color(c));
  const trailPoints = Array.from({ length: TRAIL }, () => new THREE.Vector3());
  let trailFilled = 0;
  const trailGeometry = new THREE.BufferGeometry();
  const trailVerts = new Float32Array(TRAIL * 2 * 3);
  const trailCols = new Float32Array(TRAIL * 2 * 3);
  const trailIndex = [];
  for (let i = 0; i < TRAIL - 1; i += 1) {
    const a = i * 2;
    trailIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailVerts, 3));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailCols, 3));
  trailGeometry.setIndex(trailIndex);
  const trailMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
  trailMesh.frustumCulled = false;
  trailMesh.visible = false;
  scene.add(trailMesh);

  /* --------------------------------------------------------- shockwaves */

  const ringMaterialBase = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.5, 1.6, 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const rings = Array.from({ length: 4 }, () => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 6, 40), ringMaterialBase.clone());
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, life: 0 };
  });

  /* --------------------------------------------------------------- fire */

  const fireMaterial = createFireMaterial();
  const fire = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMaterial);
  fire.add(flame);
  const fireLight = new THREE.PointLight('#ff6a1a', 0, 60, 1.6);
  fire.add(fireLight);
  fire.visible = false;
  scene.add(fire);

  const effects = createEffects(scene, { accent: world.accent });

  /* --------------------------------------------------------------- bloom */

  // Half-float targets so only what is brighter than white glows. Phones
  // that can't render to half floats go without.
  let composer = null;
  let bloomPass = null;
  let bloomOn = false;
  const gl = renderer.getContext();
  const halfFloat = renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
  if (halfFloat && world.bloom > 0) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), world.bloom, 0.55, 1.0);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    bloomOn = !phone || world.bloom >= 0.8;
  }
  const size = { width: 1, height: 1 };

  /* -------------------------------------------------------------- camera */

  let mode = 'mine';
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const wantEye = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  let first = true;
  let shake = 0;
  let fovKick = 0;
  let baseFov = 55;

  const focus = new THREE.Vector3();
  let runYaw = null; // the run's direction under the followed marble, smoothed

  const shortest = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

  function overviewSpot() {
    const b = track.bounds;
    const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const size2 = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    return { eye: new THREE.Vector3(c.x - size2 * 0.6, c.y + size2 * 0.5, c.z - size2 * 0.6), centre: c };
  }

  /**
   * Put the camera where it should be this frame. `controls` carries the
   * player's own orbit (when following a marble) or flight (overview).
   */
  function place(race, subjectId, dt, { preview = false, time = 0, controls = null, speedFactor = 0 } = {}) {
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
      // Keep the flight near the run and above the ground.
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
      // Orbit round the marble; the angle is measured from "behind, along
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
      const lead = Math.max(0, Math.cos(orbit.yaw)) * 4;
      look.set(focus.x + Math.cos(runYaw) * lead, focus.y + 0.4, focus.z + Math.sin(runYaw) * lead);
      camera.position.copy(eye);
      camera.lookAt(look);
    }

    // Shake from knocks and blasts, and a wider view at speed.
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
      shake *= Math.exp(-dt * 9);
    }
    fovKick += (speedFactor * 12 - fovKick) * (1 - Math.exp(-dt * 4));
    const fov = baseFov + fovKick;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    sun.position.set(look.x + 40, look.y + 90, look.z + 30);
    sun.target.position.copy(look);
    sun.target.updateMatrixWorld();
  }

  /* ---------------------------------------------------------------- pose */

  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const burnt = new THREE.Color('#1a1512');
  const turboColour = new THREE.Color('#ffae42');
  const side = new THREE.Vector3();
  const segment = new THREE.Vector3();
  const toCamera = new THREE.Vector3();

  function pose(race, playerId, dt, clock) {
    const t = race.t ?? clock;
    for (const m of race.marbles) {
      const mesh = marbleMeshes[m.id];
      if (!mesh) continue;
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
      const speed = Math.hypot(m.vx, m.vy, m.vz);
      if (speed > 0.05) {
        axis.set(m.ny * m.vz - m.nz * m.vy, m.nz * m.vx - m.nx * m.vz, m.nx * m.vy - m.ny * m.vx);
        if (axis.lengthSq() > 1e-8) {
          axis.normalize();
          spin.setFromAxisAngle(axis, (speed * dt) / MARBLE_RADIUS);
          mesh.quaternion.premultiply(spin);
        }
      }
      // Ghosts go see-through; turbos spit flame.
      const ghost = m.ghostUntil > t;
      if (ghost !== !!mesh.userData.ghost) {
        mesh.userData.ghost = ghost;
        mesh.material.transparent = ghost;
        mesh.material.opacity = ghost ? 0.35 : 1;
        mesh.material.depthWrite = !ghost;
        mesh.material.needsUpdate = true;
      }
      if (m.turboUntil > t && Math.random() < 0.7) {
        effects.burst(m.x - m.vx * 0.03, m.y, m.z - m.vz * 0.03, 1, 3, turboColour);
      }
    }
    for (const s of spinners) s.group.rotation.y = -s.obstacle.angle;
    for (const b of bumpers) {
      const f = b.obstacle.flash ?? 0;
      b.ringMaterial.emissiveIntensity = 0.3 + f * 4;
      b.ring.scale.setScalar(1 + f * 0.25);
    }
    textures.boost.offset.y = -clock * 1.8;

    // Pickups: coins spin, boxes tumble and bob; taken ones shrink away.
    if (race.pickups?.length) {
      let c = 0;
      let b = 0;
      for (const p of race.pickups) {
        if (p.kind === 'coin') {
          const want = p.taken ? 0 : 1;
          coinScale[c] += (want - coinScale[c]) * Math.min(1, dt * 12);
          const s = coinScale[c];
          scratchQuat.setFromAxisAngle(up, clock * 3 + p.index * 0.3).multiply(tilt);
          scratchPos.set(p.x, p.y + (1 - s) * 1.2 + Math.sin(clock * 3 + p.index) * 0.08, p.z);
          scratchScale.setScalar(Math.max(0.0001, s));
          scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
          coinMesh.setMatrixAt(c, scratchMatrix);
          c += 1;
        } else {
          const want = (race.t ?? 0) >= p.back ? 1 : 0;
          boxScale[b] += (want - boxScale[b]) * Math.min(1, dt * 8);
          const s = boxScale[b];
          scratchQuat.setFromEuler(tumble.set(clock * 0.9 + p.i, clock * 1.3 + p.i, 0));
          scratchPos.set(p.x, p.y + Math.sin(clock * 2.5 + p.i) * 0.15, p.z);
          scratchScale.setScalar(Math.max(0.0001, s));
          scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
          boxMesh.setMatrixAt(b, scratchMatrix);
          b += 1;
        }
      }
      coinMesh.count = c;
      boxMesh.count = b;
      coinMesh.instanceMatrix.needsUpdate = true;
      boxMesh.instanceMatrix.needsUpdate = true;
    } else {
      coinMesh.count = 0;
      boxMesh.count = 0;
    }

    const me = race.marbles[playerId];
    marker.visible = !!me && !me.eliminated && playerId !== null;
    if (me) marker.position.set(me.x, me.y + 1.6 + Math.sin(clock * 4) * 0.15, me.z);

    // The player's trail: a camera-facing ribbon through recent positions.
    if (me && trailColours.length && !me.eliminated && race.started) {
      const head = trailPoints[0];
      if (trailFilled === 0 || head.distanceToSquared(scratchPos.set(me.x, me.y, me.z)) > 0.04) {
        for (let i = TRAIL - 1; i > 0; i -= 1) trailPoints[i].copy(trailPoints[i - 1]);
        trailPoints[0].set(me.x, me.y, me.z);
        trailFilled = Math.min(TRAIL, trailFilled + 1);
      }
      if (trailFilled > 3) {
        trailMesh.visible = true;
        for (let i = 0; i < TRAIL; i += 1) {
          const point = trailPoints[Math.min(i, trailFilled - 1)];
          const next = trailPoints[Math.min(i + 1, trailFilled - 1)];
          segment.subVectors(next, point);
          toCamera.subVectors(camera.position, point);
          side.crossVectors(segment, toCamera).normalize();
          const fade = Math.max(0, 1 - i / (trailFilled - 1));
          const width = 0.38 * fade + 0.02;
          const a = i * 6;
          trailVerts[a] = point.x + side.x * width;
          trailVerts[a + 1] = point.y + side.y * width;
          trailVerts[a + 2] = point.z + side.z * width;
          trailVerts[a + 3] = point.x - side.x * width;
          trailVerts[a + 4] = point.y - side.y * width;
          trailVerts[a + 5] = point.z - side.z * width;
          const colour = trailColours[Math.floor((i / TRAIL) * trailColours.length + clock * 3) % trailColours.length];
          const k = fade * fade * 1.6;
          for (const o of [a, a + 3]) {
            trailCols[o] = colour.r * k;
            trailCols[o + 1] = colour.g * k;
            trailCols[o + 2] = colour.b * k;
          }
        }
        trailGeometry.attributes.position.needsUpdate = true;
        trailGeometry.attributes.color.needsUpdate = true;
      }
    } else {
      trailMesh.visible = false;
      if (!race.started) trailFilled = 0;
    }

    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - r.life / 0.5;
      r.mesh.visible = r.life > 0;
      r.mesh.scale.setScalar(0.5 + k * 5);
      r.mesh.material.opacity = 1 - k;
    }

    // Gate drops away once the race is on.
    if (race.gateOpen) gate.position.y = Math.max(gate.position.y - dt * 12, -8);

    // The fire wall, stood across the run where it has reached.
    fire.visible = race.fire.active;
    if (race.fire.active) {
      const i = Math.min(track.samples.length - 1, Math.round(race.fire.s / track.spacing));
      const p = track.samples[i];
      fire.position.set(p.x, p.y, p.z);
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
    deco.update?.(clock);
  }

  /* ------------------------------------------------------------- render */

  function resize(width, height) {
    size.width = width;
    size.height = height;
    camera.aspect = width / height;
    baseFov = width < height ? 68 : 55;
    camera.fov = baseFov + fovKick;
    camera.updateProjectionMatrix();
    if (composer) {
      const ratio = renderer.getPixelRatio();
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      bloomPass.setSize(Math.round((width * ratio) / 2), Math.round((height * ratio) / 2));
    }
  }

  const confettiColours = ['#ff3b5c', '#ffd84d', '#3fd6ff', '#7cff4f', '#b35cff', '#ffffff'].map((c) => new THREE.Color(c));

  return {
    renderer,
    camera,
    place,
    pose,
    resize,
    effects,
    world,
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
    /** Glow is the first. */
    setBloom(on) {
      bloomOn = on && !!composer;
    },
    get bloom() {
      return bloomOn;
    },
    get mode() {
      return mode;
    },
    shake(amount) {
      shake = Math.min(1.2, shake + amount);
    },
    shockwave(m, colour) {
      const r = rings.find((q) => q.life <= 0) ?? rings[0];
      const p = track.samples[m.index];
      r.life = 0.5;
      r.mesh.position.set(m.x, m.y, m.z);
      r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...p.u));
      if (colour) r.mesh.material.color.set(colour).multiplyScalar(2);
      r.mesh.visible = true;
    },
    confetti(x, y, z, count = 60) {
      for (let i = 0; i < count; i += 6) {
        effects.burst(x, y, z, 6, 16, confettiColours[(i / 6) % confettiColours.length]);
      }
    },
    /** Screen position of a point, 0..1, for pop-ups and name tags. */
    project(m, lift = 1) {
      const v = new THREE.Vector3(m.x, m.y + lift, m.z).project(camera);
      return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, behind: v.z > 1 };
    },
    render() {
      if (composer && bloomOn) composer.render();
      else renderer.render(scene, camera);
    },
    dispose() {
      effects.dispose();
      scene.traverse((node) => {
        if (node.isMesh || node.isPoints) node.geometry?.dispose();
      });
      const all = [
        ...Object.values(materials).flat(), ...marbleMaterials, markerMaterial, fireMaterial, trailMaterial, ringMaterialBase,
        ...rings.map((r) => r.mesh.material), ...deco.materials,
        ...bumpers.map((b) => b.ringMaterial), ...(merged.userData.ownedMaterials ?? []),
      ];
      for (const material of all) {
        material.map?.dispose();
        material.dispose();
      }
      for (const texture of Object.values(textures)) texture?.dispose();
      sky.dispose();
      envTarget.dispose();
      composer?.dispose();
      bloomPass?.dispose();
      // The renderer belongs to the caller and outlives this scene.
    },
  };
}

/**
 * Scenery on the ground: trees, cacti and mesas, snowy pines, glowing towers
 * or volcanic rocks, all instanced so a hundred-odd cost a few draw calls.
 */
function buildDecorations(world, track, groundY, count, textures) {
  const group = new THREE.Group();
  const materials = [];
  const random = seeded(track.seed ?? 1);
  const b = track.bounds;
  const pad = 110;
  const coarse = track.samples.filter((_, i) => i % 12 === 0);
  const clearance = (x, z) => {
    let best = Infinity;
    for (const p of coarse) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(best);
  };
  const spots = [];
  for (let i = 0; i < count * 3 && spots.length < count; i += 1) {
    const x = b.minX - pad + random() * (b.maxX - b.minX + pad * 2);
    const z = b.minZ - pad + random() * (b.maxZ - b.minZ + pad * 2);
    const clear = clearance(x, z);
    if (clear < 8) continue;
    spots.push({ x, z, clear, s: 0.7 + random() * 0.8, r: random() * Math.PI * 2 });
  }
  const dummy = new THREE.Object3D();
  function instanced(geometry, material, list, place) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
    list.forEach((spot, i) => {
      place(dummy, spot, i);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = list.length;
    materials.push(material);
    group.add(mesh);
    return mesh;
  }
  const standard = (colour, extra = {}) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, ...extra });

  if (world.deco === 'trees') {
    instanced(new THREE.CylinderGeometry(0.5, 0.7, 5, 6), standard('#6b4a2e'), spots, (d, s) => {
      d.position.set(s.x, groundY + 2.5 * s.s, s.z); d.scale.setScalar(s.s * 1.6); d.rotation.set(0, s.r, 0);
    });
    const leaves = instanced(new THREE.IcosahedronGeometry(3.4, 0), standard('#ffffff', { flatShading: true }), spots, (d, s) => {
      d.position.set(s.x, groundY + 7.5 * s.s * 1.1, s.z); d.scale.set(s.s * 1.6, s.s * 1.9, s.s * 1.6); d.rotation.set(0, s.r, 0);
    });
    const shades = ['#3f8f3a', '#4ea447', '#2f7a36', '#62b04a'].map((c) => new THREE.Color(c));
    spots.forEach((_, i) => leaves.setColorAt(i, shades[i % shades.length]));
  } else if (world.deco === 'cacti') {
    const cacti = spots.filter((_, i) => i % 5 !== 0);
    const mesas = spots.filter((_, i) => i % 5 === 0 && spots[i].clear > 40);
    instanced(new THREE.CapsuleGeometry(0.9, 6, 4, 8), standard('#4f8a43'), cacti, (d, s) => {
      d.position.set(s.x, groundY + 4 * s.s * 1.3, s.z); d.scale.setScalar(s.s * 1.3); d.rotation.set(0, s.r, 0);
    });
    instanced(new THREE.CapsuleGeometry(0.55, 2.4, 4, 8), standard('#4f8a43'), cacti, (d, s) => {
      d.position.set(s.x + Math.cos(s.r) * 1.6 * s.s, groundY + 5.5 * s.s * 1.3, s.z + Math.sin(s.r) * 1.6 * s.s);
      d.scale.setScalar(s.s * 1.3); d.rotation.set(0, s.r, 0);
    });
    instanced(new THREE.CylinderGeometry(14, 18, 22, 7), standard('#b8693c', { flatShading: true }), mesas, (d, s) => {
      d.position.set(s.x, groundY + 11 * s.s, s.z); d.scale.set(s.s, s.s, s.s * 0.8); d.rotation.set(0, s.r, 0);
    });
  } else if (world.deco === 'pines') {
    instanced(new THREE.ConeGeometry(3, 8, 7), standard('#2d5a45', { flatShading: true }), spots, (d, s) => {
      d.position.set(s.x, groundY + 4 * s.s * 1.5, s.z); d.scale.setScalar(s.s * 1.5); d.rotation.set(0, s.r, 0);
    });
    instanced(new THREE.ConeGeometry(1.6, 3, 7), standard('#ffffff', { flatShading: true }), spots, (d, s) => {
      d.position.set(s.x, groundY + 7.6 * s.s * 1.5, s.z); d.scale.setScalar(s.s * 1.5); d.rotation.set(0, s.r, 0);
    });
  } else if (world.deco === 'towers') {
    const material = new THREE.MeshStandardMaterial({
      color: '#15102a', roughness: 0.5, metalness: 0.4, emissive: '#d6b8ff', emissiveMap: textures.windows, emissiveIntensity: 1.3,
    });
    instanced(new THREE.BoxGeometry(8, 1, 8), material, spots, (d, s) => {
      const tall = Math.min(26 + s.clear * 0.5, 90) * s.s;
      d.position.set(s.x, groundY + tall / 2, s.z); d.scale.set(s.s, tall, s.s); d.rotation.set(0, s.r, 0);
    });
    textures.windows.repeat.set(1, 6);
  } else if (world.deco === 'rocks') {
    const rocks = instanced(new THREE.DodecahedronGeometry(3, 0), standard('#2a2020', { flatShading: true }), spots, (d, s) => {
      d.position.set(s.x, groundY + 1.2 * s.s, s.z); d.scale.set(s.s * 1.8, s.s * 1.2, s.s * 1.5); d.rotation.set(s.r, s.r * 2, 0);
    });
    rocks.receiveShadow = false;
    // A few smoking vents, glowing at the top.
    const vents = spots.filter((_, i) => i % 9 === 0);
    instanced(new THREE.ConeGeometry(6, 10, 8, 1, true), standard('#3a2522', { flatShading: true, side: THREE.DoubleSide }), vents, (d, s) => {
      d.position.set(s.x, groundY + 5 * s.s, s.z); d.scale.setScalar(s.s); d.rotation.set(0, s.r, 0);
    });
    instanced(new THREE.CircleGeometry(2.2, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1, 0.2), toneMapped: false }), vents, (d, s) => {
      d.position.set(s.x, groundY + 9.6 * s.s, s.z); d.scale.setScalar(s.s); d.rotation.set(-Math.PI / 2, 0, 0);
    });
  }
  return { group, materials };
}
