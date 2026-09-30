import * as THREE from 'three';
import { shade, rgba } from '../lib/textures.js';
import {
  TABLE,
  DESK,
  FLOOR_Y,
  RAIL_RADIUS,
  quarterRun,
  quarterProfile,
  wedgeProfile,
  stairsProfile,
} from './park.js';

/**
 * Every object in the park, built in code. Nothing here is downloaded.
 *
 * Scale is the whole point: 1 unit = 10mm, so the table is 700mm deep, a mug is
 * 85mm across and the deck is 96mm long. The desk clutter is not decoration —
 * a pencil and a coffee mug beside the ramps are what make the board read as
 * tiny, because a viewer already knows how big those things are.
 */


function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw, { repeat = [1, 1], srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  return texture;
}

/* ------------------------------------------------------------- materials */

/**
 * Desk oak. The grain is drawn at a deliberate scale — one board of the table
 * is ~120mm wide, so the planks and grain read as furniture next to the deck.
 */
export function createTableTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const base = '#8a5f38';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const random = rng(42);
    const planks = 6;
    for (let i = 0; i < planks; i += 1) {
      const y = (i / planks) * h;
      const tone = 0.06 * (random() - 0.5);
      ctx.fillStyle = shade(base, tone);
      ctx.fillRect(0, y, w, h / planks);

      // Grain runs along the plank.
      for (let g = 0; g < 46; g += 1) {
        const gy = y + random() * (h / planks);
        const amp = 2 + random() * 9;
        const freq = 0.002 + random() * 0.006;
        const phase = random() * Math.PI * 2;
        ctx.strokeStyle = random() > 0.45
          ? rgba('#3a2312', 0.08 + random() * 0.13)
          : rgba('#d7a870', 0.05 + random() * 0.07);
        ctx.lineWidth = 0.8 + random() * 2.2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 10) {
          const yy = gy + Math.sin(x * freq + phase) * amp;
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      // The seam between planks.
      ctx.fillStyle = rgba('#2b1a0d', 0.5);
      ctx.fillRect(0, y, w, 2);
    }

    // A few knots and scuffs so it is not a perfect surface.
    for (let i = 0; i < 5; i += 1) {
      const cx = random() * w;
      const cy = random() * h;
      const r = 5 + random() * 13;
      const knot = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      knot.addColorStop(0, rgba('#2e1c0e', 0.75));
      knot.addColorStop(1, rgba('#2e1c0e', 0));
      ctx.fillStyle = knot;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: [1, 1] });
}

/** Skatepark plywood: pale sheet with a printed grain and worn edges. */
export function createRampTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const base = '#b18a58';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const random = rng(9);
    for (let i = 0; i < 200; i += 1) {
      ctx.strokeStyle = rgba('#5a3a18', 0.09 + random() * 0.16);
      ctx.lineWidth = 0.6 + random() * 2;
      const y = random() * h;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        ctx.lineTo(x, y + Math.sin(x * 0.01 + random()) * 4);
      }
      ctx.stroke();
    }
    // Wheel scuffs down the middle of the transition.
    ctx.fillStyle = rgba('#4a3620', 0.2);
    ctx.fillRect(0, h * 0.42, w, h * 0.16);
    // ExtrudeGeometry emits UVs in world units, so one tile every ~14 units.
  }, { repeat: [0.07, 0.07] });
}

/** Poured concrete for ledges, with aggregate speckle. */
export function createConcreteTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#9b9a95';
    ctx.fillRect(0, 0, w, h);
    const random = rng(23);
    for (let i = 0; i < 9000; i += 1) {
      const v = random();
      ctx.fillStyle = v > 0.5 ? rgba('#ffffff', 0.09 * v) : rgba('#3d3c39', 0.18 * v);
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2.4, 1 + random() * 2.4);
    }
    for (let i = 0; i < 26; i += 1) {
      ctx.strokeStyle = rgba('#5a5955', 0.16);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(random() * w, random() * h);
      ctx.lineTo(random() * w, random() * h);
      ctx.stroke();
    }
  }, { repeat: [0.08, 0.08] });
}

/* ------------------------------------------------------------ obstacles */

/**
 * Extrude a side profile (u along the obstacle, height up) across its width.
 *
 * No bevel: ExtrudeGeometry's bevel grows the outline outward, which would
 * lift every riding surface above where the physics has the wheels.
 */
function extrudeProfile(points, width, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  const mesh = new THREE.Mesh(worldUV(geometry), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * UVs in world units, projected along each face's normal, so a texture's
 * grain is the same size on a kicker, a ledge and a quarter pipe. (The
 * geometry's own UVs stretch 0..1 over every face whatever its size.)
 */
function worldUV(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i += 1) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (nz >= nx && nz >= ny) uv.setXY(i, x, y);
    else if (nx >= ny) uv.setXY(i, z, y);
    else uv.setXY(i, x, z);
  }
  uv.needsUpdate = true;
  return geometry;
}

function box(width, height, depth, material) {
  const mesh = new THREE.Mesh(worldUV(new THREE.BoxGeometry(width, height, depth)), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Steel angle along a grindable top edge, flush with the faces it caps. */
function edging(length, height, material) {
  const size = 0.36;
  const strip = box(length + 0.02, size, size, material);
  strip.position.y = height - size / 2 + 0.01;
  return strip;
}

/**
 * The mesh for one park obstacle, in its own local frame: x along the
 * obstacle (the physics' u) and z across it (w). Every surface is sampled
 * from the profile functions the physics uses, so nothing drawn here can
 * disagree with what the board rides on.
 */
function buildItem(item, materials) {
  const group = new THREE.Group();
  const surface = materials[item.material] ?? materials.ramp;

  switch (item.kind) {
    case 'box': {
      const block = box(item.len, item.height, item.wid, surface);
      block.position.y = item.height / 2;
      group.add(block);
      for (const edge of item.grind ?? []) {
        const sign = edge[1] === '+' ? 1 : -1;
        const along = edge[0] === 'w';
        const strip = edging(along ? item.len : item.wid, item.height, materials.metal);
        if (along) strip.position.z = sign * (item.wid / 2 - 0.17);
        else {
          strip.rotation.y = Math.PI / 2;
          strip.position.x = sign * (item.len / 2 - 0.17);
        }
        group.add(strip);
      }
      break;
    }

    case 'wedge': {
      const points = [[-item.len / 2, 0]];
      const steps = item.curve && item.curve !== 1 ? 24 : 1;
      for (let i = 0; i <= steps; i += 1) {
        const u = -item.len / 2 + (i / steps) * item.len;
        points.push([u, wedgeProfile(item, u)]);
      }
      points.push([item.len / 2, 0]);
      group.add(extrudeProfile(points, item.wid, surface));
      break;
    }

    case 'quarter': {
      const run = quarterRun(item);
      const points = [[0, 0]];
      for (let i = 1; i <= 40; i += 1) {
        const u = (i / 40) * run;
        points.push([u, quarterProfile(item, u)]);
      }
      points.push([run + item.deck, item.height], [run + item.deck, 0]);
      group.add(extrudeProfile(points, item.wid, materials.ramp));

      // Steel coping along the lip, sunk so its top is flush with the deck:
      // centred on the lip it would stand proud of where the wheels ride.
      const radius = 0.34;
      const coping = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, item.wid, 14),
        materials.metal,
      );
      coping.rotation.x = Math.PI / 2;
      coping.position.set(run - radius * 0.4, item.height - radius + 0.02, 0);
      coping.castShadow = true;
      group.add(coping);
      break;
    }

    case 'stairs': {
      const points = [[0, 0]];
      for (let step = 0; step < item.drops - 1; step += 1) {
        const h = stairsProfile(item, step * item.tread);
        points.push([step * item.tread, h], [(step + 1) * item.tread, h]);
      }
      points.push([(item.drops - 1) * item.tread, 0]);
      group.add(extrudeProfile(points, item.wid, surface));
      break;
    }

    default:
      break;
  }

  group.position.set(item.x, 0, item.z);
  group.rotation.y = -(item.rot ?? 0);
  return group;
}

/**
 * A round bar from a to b ([x, z, topY] each), on posts. The given heights are
 * the *top* of the bar — the surface you grind — so the bar's centre is one
 * radius below. Posts and feet stay inside the bar's footprint, where the
 * physics already has the rail as solid.
 */
function buildRail(rail, materials) {
  const group = new THREE.Group();
  const a = new THREE.Vector3(rail.a[0], rail.a[2] - RAIL_RADIUS, rail.a[1]);
  const b = new THREE.Vector3(rail.b[0], rail.b[2] - RAIL_RADIUS, rail.b[1]);
  const length = a.distanceTo(b);

  const bar = new THREE.Mesh(new THREE.CylinderGeometry(RAIL_RADIUS, RAIL_RADIUS, length, 18), materials.metal);
  bar.position.copy(a).add(b).multiplyScalar(0.5);
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  bar.castShadow = true;
  group.add(bar);

  const posts = Math.max(2, Math.round(length / 14) + 1);
  for (let i = 0; i < posts; i += 1) {
    const t = 0.03 + (0.94 * i) / (posts - 1);
    const top = a.clone().lerp(b, t);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, top.y, 10), materials.metal);
    post.position.set(top.x, top.y / 2, top.z);
    post.castShadow = true;
    group.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14), materials.metal);
    foot.position.set(top.x, 0.08, top.z);
    foot.receiveShadow = true;
    group.add(foot);
  }
  return group;
}

/** Every obstacle in the park, built once. */
export function buildPark(park, materials) {
  const group = new THREE.Group();
  for (const item of park.items) {
    group.add(item.kind === 'rail' ? buildRail(item, materials) : buildItem(item, materials));
  }
  return group;
}

/* ------------------------------------------------------ base and desk */

/**
 * The park's base board and the desk under it. The base board is the top of
 * the physics' world (y = 0); the desk is a step down all round it.
 */
export function buildGround(materials, deskTexture) {
  // (deskTexture is materials.desk.map; its tiling is set here with the desk.)
  const group = new THREE.Group();

  const baseThickness = -DESK.y;
  const base = box(TABLE.halfX * 2, baseThickness, TABLE.halfZ * 2, materials.base);
  base.position.y = -baseThickness / 2;
  group.add(base);

  const deskThickness = 4;
  const deskGeometry = worldUV(new THREE.BoxGeometry(DESK.halfX * 2, deskThickness, DESK.halfZ * 2));
  const desk = new THREE.Mesh(deskGeometry, [
    materials.deskEdge, materials.deskEdge, materials.desk,
    materials.deskEdge, materials.deskEdge, materials.deskEdge,
  ]);
  desk.position.y = DESK.y - deskThickness / 2;
  desk.receiveShadow = true;
  deskTexture.repeat.set(1 / 110, 1 / 110);
  group.add(desk);

  // Legs down to the floor, and the floor, for anyone who rides off the edge.
  const legHeight = DESK.y - deskThickness - FLOOR_Y;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = box(6, legHeight, 6, materials.deskEdge);
    leg.position.set(sx * (DESK.halfX - 8), FLOOR_Y + legHeight / 2, sz * (DESK.halfZ - 8));
    group.add(leg);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  group.add(floor);

  return group;
}

/** Painted board for the park base: dark, even, with faint panel seams. */
export function createBaseTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#4d5560';
    ctx.fillRect(0, 0, w, h);
    const random = rng(71);
    for (let i = 0; i < 14000; i += 1) {
      const v = random();
      ctx.fillStyle = v > 0.5 ? rgba('#ffffff', 0.05 * v) : rgba('#1c2027', 0.1 * v);
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
    // Wheel scuffs.
    for (let i = 0; i < 40; i += 1) {
      ctx.strokeStyle = rgba('#20242b', 0.08 + random() * 0.08);
      ctx.lineWidth = 2 + random() * 3;
      ctx.beginPath();
      const x = random() * w;
      const y = random() * h;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (random() - 0.5) * 300, y + (random() - 0.5) * 300, x + (random() - 0.5) * 500, y + (random() - 0.5) * 500);
      ctx.stroke();
    }
    // Panel seams: one tile of texture is one 400mm panel.
    ctx.fillStyle = rgba('#15181d', 0.55);
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, 0, 3, h);
  }, { repeat: [1 / 40, 1 / 40] });
}

/** Floorboards far below, mostly seen when you ride off the desk. */
export function createFloorTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5a3f28';
    ctx.fillRect(0, 0, w, h);
    const random = rng(12);
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = shade('#5a3f28', (random() - 0.5) * 0.12);
      ctx.fillRect(0, (i / 8) * h, w, h / 8 - 3);
    }
  }, { repeat: [14, 14] });
}

/** Clutter on the desk round the park: real sizes, so the board reads as 96mm. */
export const DESK_LAYOUT = [
  { prop: 'mug', x: 142, z: -28, rot: 0.6 },
  { prop: 'can', x: -140, z: 36, rot: 0 },
  { prop: 'pencil', x: 60, z: 96, rot: 0.2 },
  { prop: 'pencil', x: 72, z: 100, rot: -0.1 },
  { prop: 'phone', x: -70, z: -102, rot: 0.15 },
  { prop: 'notepad', x: 150, z: 70, rot: 0.3 },
  { prop: 'coins', x: -150, z: -70, rot: 0 },
  { prop: 'eraser', x: 20, z: -100, rot: 0.8 },
  { prop: 'mug', x: -120, z: 102, rot: 2.1 },
  { prop: 'can', x: 128, z: 104, rot: 0 },
];

export function buildDeskClutter(materials) {
  const group = new THREE.Group();
  for (const { prop, x, z, rot } of DESK_LAYOUT) {
    const item = DESK_PROPS[prop](materials);
    item.position.set(x, DESK.y, z);
    item.rotation.y = rot;
    group.add(item);
  }
  return group;
}

/* --------------------------------------------------------- desk clutter */

/**
 * Household objects at their real sizes. These do the heavy lifting on scale:
 * a 95mm mug standing beside a 96mm board tells you instantly how small it is.
 */
export const DESK_PROPS = {
  mug(materials) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 3.6, 9.5, 28, 1, true), materials.ceramic);
    body.position.y = 4.75;
    body.castShadow = true;
    group.add(body);

    const inside = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.4, 9.1, 28, 1, true), materials.ceramicDark);
    inside.position.y = 4.9;
    inside.material.side = THREE.BackSide;
    group.add(inside);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.5, 28), materials.ceramic);
    base.position.y = 0.25;
    base.castShadow = true;
    group.add(base);

    const coffee = new THREE.Mesh(new THREE.CircleGeometry(3.8, 28), materials.coffee);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 7.6;
    group.add(coffee);

    const handle = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.55, 12, 24, Math.PI * 1.1), materials.ceramic);
    handle.position.set(4.0, 5.2, 0);
    handle.rotation.z = -0.35;
    handle.castShadow = true;
    group.add(handle);
    return group;
  },

  pencil(materials) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 15, 6), materials.pencil);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, 0.38, 0);
    body.castShadow = true;
    group.add(body);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.6, 6), materials.wood);
    cone.rotation.z = -Math.PI / 2;
    cone.position.set(8.3, 0.38, 0);
    cone.castShadow = true;
    group.add(cone);

    const lead = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), materials.graphite);
    lead.rotation.z = -Math.PI / 2;
    lead.position.set(9.3, 0.38, 0);
    group.add(lead);

    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12), materials.metal);
    ferrule.rotation.z = Math.PI / 2;
    ferrule.position.set(-8.1, 0.38, 0);
    group.add(ferrule);

    const eraser = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.9, 12), materials.eraser);
    eraser.rotation.z = Math.PI / 2;
    eraser.position.set(-9.1, 0.38, 0);
    group.add(eraser);
    return group;
  },

  can(materials) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 10.6, 26), materials.canBody);
    body.position.y = 5.9;
    body.castShadow = true;
    group.add(body);
    for (const [y, r] of [[0.4, 2.9], [11.6, 2.9]]) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.8, 26), materials.metal);
      rim.position.y = y;
      rim.castShadow = true;
      group.add(rim);
    }
    const taperTop = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.3, 1, 26), materials.canBody);
    taperTop.position.y = 11.0;
    group.add(taperTop);
    return group;
  },

  phone(materials) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.8, 7.1), materials.phone);
    body.position.y = 0.4;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 6.3), materials.screen);
    screen.rotation.x = -Math.PI / 2;
    screen.position.y = 0.81;
    group.add(screen);
    return group;
  },

  coins(materials) {
    const group = new THREE.Group();
    const random = rng(5);
    for (let i = 0; i < 3; i += 1) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 22), materials.coin);
      coin.position.set((random() - 0.5) * 5, 0.1 + i * 0.02, (random() - 0.5) * 4);
      coin.castShadow = true;
      group.add(coin);
    }
    return group;
  },

  eraser(materials) {
    const group = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.2, 2.1), materials.eraser);
    block.position.y = 0.6;
    block.castShadow = true;
    group.add(block);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.24, 2.14), materials.sleeve);
    sleeve.position.y = 0.6;
    block.add(sleeve);
    return group;
  },

  notepad(materials) {
    const group = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(9, 0.9, 9), materials.paper);
    pad.position.y = 0.45;
    pad.castShadow = true;
    pad.receiveShadow = true;
    group.add(pad);
    return group;
  },
};

export const DESK_PROP_NAMES = Object.keys(DESK_PROPS);

/** Materials for the clutter, all flat colours — no maps needed at this size. */
export function createPropMaterials() {
  const standard = (color, options = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...options });

  return {
    ceramic: standard('#eceff3', { roughness: 0.28 }),
    ceramicDark: standard('#cdd2d8', { roughness: 0.4 }),
    coffee: standard('#2a1509', { roughness: 0.22, metalness: 0.05 }),
    pencil: standard('#e6b422', { roughness: 0.45 }),
    wood: standard('#d9b183', { roughness: 0.7 }),
    graphite: standard('#2b2b30', { roughness: 0.5 }),
    eraser: standard('#f2c9c4', { roughness: 0.85 }),
    sleeve: standard('#3a6fd8', { roughness: 0.6 }),
    canBody: standard('#c2402f', { roughness: 0.3, metalness: 0.5 }),
    phone: standard('#1b1d22', { roughness: 0.35 }),
    screen: new THREE.MeshStandardMaterial({ color: '#0c1118', roughness: 0.08, metalness: 0.2 }),
    coin: standard('#b9a06a', { roughness: 0.3, metalness: 0.9 }),
    paper: standard('#f5e9a8', { roughness: 0.92 }),
    metal: standard('#b6bcc4', { roughness: 0.25, metalness: 0.95 }),
  };
}
