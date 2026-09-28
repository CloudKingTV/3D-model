import * as THREE from 'three';
import { shade, rgba } from '../lib/textures.js';

/**
 * Every object in the park, built in code. Nothing here is downloaded.
 *
 * Scale is the whole point: 1 unit = 10mm, so the table is 700mm deep, a mug is
 * 85mm across and the deck is 96mm long. The desk clutter is not decoration —
 * a pencil and a coffee mug beside the ramps are what make the board read as
 * tiny, because a viewer already knows how big those things are.
 */

const RAMP_WIDTH = 15; // 150mm, a realistic fingerboard obstacle
export const TABLE_DEPTH = 72;
export const TABLE_THICKNESS = 2.6;

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
  }, { repeat: [3, 3] });
}

/* ------------------------------------------------------------ obstacles */

/** Extrude a 2D side profile across the ramp's width. */
function extrudeProfile(points, width, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.12,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -width / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function kickerProfile(length, height, steps = 18) {
  const points = [[0, 0]];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push([t * length, height * t ** 1.5]);
  }
  points.push([length, 0]);
  return points;
}

function quarterProfile(length, height, steps = 20) {
  const points = [[0, 0]];
  for (let i = 1; i <= steps; i += 1) {
    const u = Math.min(i / steps, 0.94);
    points.push([u * length, height * (1 - Math.sqrt(Math.max(0, 1 - u * u)))]);
  }
  points.push([length, height], [length, 0]);
  return points;
}

function funboxProfile(length, height, rampLength, steps = 12) {
  const points = [[0, 0]];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push([t * rampLength, height * t ** 1.4]);
  }
  points.push([length - rampLength, height]);
  for (let i = steps - 1; i >= 1; i -= 1) {
    const t = i / steps;
    points.push([length - t * rampLength, height * t ** 1.4]);
  }
  points.push([length, 0]);
  return points;
}

/**
 * Build the mesh for one track feature, positioned in its own local space with
 * the feature starting at x = 0.
 */
export function createFeatureMesh(feature, materials) {
  const group = new THREE.Group();

  switch (feature.kind) {
    case 'kicker':
      group.add(extrudeProfile(kickerProfile(feature.length, feature.height), RAMP_WIDTH, materials.ramp));
      break;

    case 'quarter': {
      group.add(extrudeProfile(quarterProfile(feature.length, feature.height), RAMP_WIDTH, materials.ramp));
      // Steel coping along the lip, which is what you actually hit.
      const coping = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, RAMP_WIDTH, 14),
        materials.metal,
      );
      coping.rotation.x = Math.PI / 2;
      coping.position.set(feature.length, feature.height, 0);
      coping.castShadow = true;
      group.add(coping);
      break;
    }

    case 'funbox':
      group.add(extrudeProfile(
        funboxProfile(feature.length, feature.height, feature.rampLength),
        RAMP_WIDTH,
        materials.ramp,
      ));
      break;

    case 'ledge': {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(feature.length, feature.height, RAMP_WIDTH),
        materials.concrete,
      );
      block.position.set(feature.length / 2, feature.height / 2, 0);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);

      // Steel edging along the grindable top corner.
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(feature.length, 0.5, 0.5),
          materials.metal,
        );
        edge.position.set(feature.length / 2, feature.height - 0.16, side * (RAMP_WIDTH / 2 - 0.16));
        edge.castShadow = true;
        group.add(edge);
      }
      break;
    }

    case 'rail': {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, feature.length, 16),
        materials.metal,
      );
      bar.rotation.z = Math.PI / 2;
      bar.position.set(feature.length / 2, feature.height, 0);
      bar.castShadow = true;
      group.add(bar);

      // Feet, angled in like a real flat bar.
      for (const t of [0.1, 0.9]) {
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.28, 0.28, feature.height, 10),
            materials.metal,
          );
          leg.position.set(feature.length * t, feature.height / 2, side * 1.5);
          leg.rotation.x = side * 0.28;
          leg.castShadow = true;
          group.add(leg);
        }
        const foot = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.3, 5),
          materials.metal,
        );
        foot.position.set(feature.length * t, 0.15, 0);
        foot.receiveShadow = true;
        group.add(foot);
      }
      break;
    }

    default:
      break;
  }

  return group;
}

/* ------------------------------------------------------------ the table */

/** How much table one tile of the wood texture covers, in world units. */
const TABLE_TILE = 44;

/**
 * One segment of tabletop, sized to a feature so a gap is simply a segment
 * that was never built. The top face's UVs are rewritten from the segment's
 * world position, so the grain runs unbroken from one segment to the next
 * instead of restarting at every seam.
 */
export function createTableSegment(length, worldX, material, edgeMaterial) {
  const group = new THREE.Group();

  const geometry = new THREE.BoxGeometry(length, TABLE_THICKNESS, TABLE_DEPTH);
  const uv = geometry.attributes.uv;
  // BoxGeometry lays faces out +x, -x, +y, -y, +z, -z with four vertices each,
  // so the top face is vertices 8..11.
  for (let i = 8; i < 12; i += 1) {
    uv.setXY(
      i,
      (worldX + uv.getX(i) * length) / TABLE_TILE,
      (uv.getY(i) * TABLE_DEPTH) / TABLE_TILE,
    );
  }
  uv.needsUpdate = true;

  const top = new THREE.Mesh(
    geometry,
    [edgeMaterial, edgeMaterial, material, edgeMaterial, edgeMaterial, edgeMaterial],
  );
  top.position.set(length / 2, -TABLE_THICKNESS / 2, 0);
  top.receiveShadow = true;
  group.add(top);

  // A chamfered lip along both long edges, so the table reads as a real slab.
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.55, 0.9), edgeMaterial);
    lip.position.set(length / 2, -0.2, side * (TABLE_DEPTH / 2 - 0.3));
    lip.receiveShadow = true;
    group.add(lip);
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
