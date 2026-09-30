import * as THREE from 'three';
import { shade, rgba } from '../lib/textures.js';
import { rng, canvasTexture, worldUV, mesh, block } from './canvasKit.js';
import {
  TABLE,
  RAIL_RADIUS,
  quarterRun,
  quarterProfile,
  wedgeProfile,
  stairsProfile,
} from './park.js';

/**
 * The fingerboard kit on the table, built in code. Nothing here is
 * downloaded.
 *
 * The obstacles are drawn the way the real ones are made: birch plywood
 * ramps screwed together, steel coping, powder-coated rails on base plates,
 * a painted ledge with angle-iron edges. The rest of the table is whatever
 * would be on it — a closed laptop, a stack of hardbacks, a ruler bridged
 * across two erasers, a mug. Scale is the point: 1 unit = 10mm, and those
 * are everyday things you already know the size of, which is what makes a
 * 96mm board read as tiny.
 *
 * Every shape comes from the same description the physics uses (park.js),
 * so what you see is exactly what the board rides.
 */

/* ------------------------------------------------------------- textures */

/** Birch ply: pale, with a fine straight grain and the odd darker streak. */
function createPlywoodTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const base = '#d7b98b';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const random = rng(9);
    for (let i = 0; i < 260; i += 1) {
      ctx.strokeStyle = random() > 0.8
        ? rgba('#8b6236', 0.12 + random() * 0.14)
        : rgba('#a27a4a', 0.06 + random() * 0.1);
      ctx.lineWidth = 0.5 + random() * 1.8;
      const y = random() * h;
      const wave = random() * 3;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.012 + wave) * 2.5);
      ctx.stroke();
    }
    // Wheel wear down the middle of the riding surface.
    const wear = ctx.createLinearGradient(0, 0, 0, h);
    wear.addColorStop(0, rgba('#5a4026', 0));
    wear.addColorStop(0.5, rgba('#5a4026', 0.1));
    wear.addColorStop(1, rgba('#5a4026', 0));
    ctx.fillStyle = wear;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: [1 / 16, 1 / 16] });
}

/** Cast concrete-look resin, as fingerboard ledges and pads are sold. */
function createConcreteTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#a8a7a2';
    ctx.fillRect(0, 0, w, h);
    const random = rng(23);
    for (let i = 0; i < 9000; i += 1) {
      const v = random();
      ctx.fillStyle = v > 0.5 ? rgba('#ffffff', 0.08 * v) : rgba('#3d3c39', 0.16 * v);
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2.4, 1 + random() * 2.4);
    }
    for (let i = 0; i < 18; i += 1) {
      ctx.strokeStyle = rgba('#5a5955', 0.14);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(random() * w, random() * h);
      ctx.lineTo(random() * w, random() * h);
      ctx.stroke();
    }
  }, { repeat: [1 / 14, 1 / 14] });
}

/** Black-painted ledge, the paint rubbed through where it has been waxed. */
function createPaintedTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#26272b';
    ctx.fillRect(0, 0, w, h);
    const random = rng(51);
    for (let i = 0; i < 120; i += 1) {
      ctx.fillStyle = rgba('#8a8f99', 0.05 + random() * 0.08);
      ctx.fillRect(random() * w, random() * h, 6 + random() * 40, 1 + random() * 2);
    }
  }, { repeat: [1 / 8, 1 / 8] });
}

/** A clear plastic ruler: centimetre and millimetre ticks, printed numbers. */
function createRulerTexture() {
  const texture = canvasTexture(1024, 64, (ctx, w, h) => {
    ctx.fillStyle = '#e8f1f4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#23303a';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const perCm = w / 30;
    for (let mm = 0; mm <= 300; mm += 1) {
      const x = (mm / 300) * w;
      const tall = mm % 10 === 0 ? 22 : mm % 5 === 0 ? 14 : 8;
      ctx.fillRect(x, 0, 1, tall);
      if (mm % 10 === 0 && mm > 0 && mm < 300) ctx.fillText(String(mm / 10), x, 38);
    }
    ctx.fillStyle = rgba('#23303a', 0.5);
    ctx.fillText('30 cm', perCm * 26, 56);
  }, { wrap: false });
  return texture;
}

/** A sheet of paper with a pencil sketch of a ramp on it. */
function createSketchTexture() {
  return canvasTexture(512, 724, (ctx, w, h) => {
    ctx.fillStyle = '#f7f5ee';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = rgba('#8fb3d9', 0.5);
    ctx.lineWidth = 1;
    for (let y = 60; y < h; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba('#3a3a3a', 0.75);
    ctx.lineWidth = 2.2;
    // A quarter pipe, side on, with dimensions.
    ctx.beginPath();
    ctx.moveTo(80, 420);
    ctx.lineTo(300, 420);
    ctx.quadraticCurveTo(420, 420, 420, 250);
    ctx.lineTo(470, 250);
    ctx.lineTo(470, 420);
    ctx.lineTo(420, 420);
    ctx.stroke();
    ctx.font = 'italic 22px "Comic Sans MS", "Chalkboard SE", cursive';
    ctx.fillStyle = rgba('#3a3a3a', 0.85);
    ctx.fillText('QP — 90mm tall', 90, 200);
    ctx.fillText('r = 140', 250, 330);
    ctx.fillText('coping: 6mm steel rod', 90, 520);
    ctx.fillText('x2 !!', 90, 560);
  }, { wrap: false });
}

/* ------------------------------------------------------------ materials */

export function createKitMaterials() {
  const textures = {
    plywood: createPlywoodTexture(),
    concrete: createConcreteTexture(),
    painted: createPaintedTexture(),
    ruler: createRulerTexture(),
    sketch: createSketchTexture(),
  };
  const standard = (options) => new THREE.MeshStandardMaterial({ roughness: 0.6, ...options });
  const materials = {
    plywood: standard({ map: textures.plywood, roughness: 0.62 }),
    plySide: standard({ map: textures.plywood, color: '#c9a77a', roughness: 0.7 }),
    concrete: standard({ map: textures.concrete, roughness: 0.88 }),
    painted: standard({ map: textures.painted, roughness: 0.55 }),
    steel: standard({ color: '#c3c9d2', roughness: 0.25, metalness: 0.95 }),
    screw: standard({ color: '#6f747c', roughness: 0.4, metalness: 0.9 }),
    railBlack: standard({ color: '#1f2226', roughness: 0.42, metalness: 0.5 }),
    railRed: standard({ color: '#c8352b', roughness: 0.4, metalness: 0.35 }),
    aluminium: standard({ color: '#b9bcc2', roughness: 0.35, metalness: 0.85 }),
    aluminiumDark: standard({ color: '#8e9299', roughness: 0.4, metalness: 0.8 }),
    logo: standard({ color: '#eef1f5', roughness: 0.2, metalness: 0.6 }),
    pages: standard({ color: '#efe6cf', roughness: 0.9 }),
    bookRed: standard({ color: '#8f2a2a', roughness: 0.75 }),
    bookNavy: standard({ color: '#1f3354', roughness: 0.75 }),
    bookGreen: standard({ color: '#2f5a3f', roughness: 0.75 }),
    gold: standard({ color: '#c9a44c', roughness: 0.35, metalness: 0.8 }),
    eraser: standard({ color: '#f09aa0', roughness: 0.85 }),
    ruler: new THREE.MeshStandardMaterial({
      map: textures.ruler, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.88,
    }),
    phone: standard({ color: '#16181c', roughness: 0.3, metalness: 0.4 }),
    lens: standard({ color: '#0a0b0d', roughness: 0.05, metalness: 0.6 }),
    ceramic: standard({ color: '#f1efe9', roughness: 0.25 }),
    ceramicBlue: standard({ color: '#3f6fb0', roughness: 0.3 }),
    coffee: standard({ color: '#2a1509', roughness: 0.15 }),
    potMetal: standard({ color: '#3c3f45', roughness: 0.45, metalness: 0.6 }),
    pencil: standard({ color: '#e6b422', roughness: 0.45 }),
    pencilBlue: standard({ color: '#2f6fd1', roughness: 0.45 }),
    pencilGreen: standard({ color: '#3a9d52', roughness: 0.45 }),
    pencilWood: standard({ color: '#d9b183', roughness: 0.7 }),
    graphite: standard({ color: '#2b2b30', roughness: 0.5 }),
    lamp: standard({ color: '#1d1f23', roughness: 0.45, metalness: 0.55 }),
    lampInside: new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe2a8', emissiveIntensity: 1.2, roughness: 0.6 }),
    bulb: new THREE.MeshBasicMaterial({ color: '#fff6e0' }),
    paper: standard({ map: textures.sketch, roughness: 0.95 }),
    sticky: standard({ color: '#f7e36b', roughness: 0.9 }),
    stickyPink: standard({ color: '#f6a3c4', roughness: 0.9 }),
    coin: standard({ color: '#b9a06a', roughness: 0.3, metalness: 0.9 }),
    toolHandle: standard({ color: '#e04d2c', roughness: 0.5 }),
  };
  return { materials, textures };
}

/* ------------------------------------------------------------ obstacles */

/**
 * Extrude a side profile (u along the obstacle, height up) across its width.
 * The two flat ends — the obstacle's sides — get `sideMaterial`; the
 * surfaces the profile sweeps out get `surfaceMaterial`.
 *
 * No bevel: ExtrudeGeometry's bevel grows the outline outward, which would
 * lift every riding surface above where the physics has the wheels.
 */
function extrudeProfile(points, width, surfaceMaterial, sideMaterial = surfaceMaterial) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  return new THREE.Mesh(worldUV(geometry), [sideMaterial, surfaceMaterial]);
}

/** Steel angle along a grindable top edge, flush with the faces it caps. */
function edging(length, height, material) {
  const size = 0.36;
  const strip = mesh(new THREE.BoxGeometry(length + 0.02, size, size), material);
  strip.position.y = height - size / 2 + 0.01;
  return strip;
}

function screw(material, x, y, z) {
  return mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), material, x, y + 0.02, z);
}

const BOX_LOOKS = {
  plywood: (m) => ({ top: m.plywood, side: m.plySide, edge: m.steel }),
  concrete: (m) => ({ top: m.concrete, side: m.concrete, edge: m.steel }),
  painted: (m) => ({ top: m.painted, side: m.painted, edge: m.steel }),
};

/** A box obstacle: plain material boxes, or one of the household things. */
function buildBox(item, m) {
  const group = new THREE.Group();
  const { len, wid, height } = item;

  switch (item.look) {
    case 'laptop': {
      group.add(block(len, height / 2, wid, m.aluminiumDark));
      group.add(block(len - 0.1, height / 2, wid - 0.1, m.aluminium, 0, height / 2, 0));
      // Hinge along the back and a logo on the lid.
      group.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, len * 0.8, 10).rotateZ(Math.PI / 2), m.aluminiumDark, 0, height / 2, -wid / 2 + 0.35));
      group.add(mesh(new THREE.CircleGeometry(1.4, 24).rotateX(-Math.PI / 2), m.logo, 0, height + 0.01, 0));
      break;
    }
    case 'books': {
      // Three hardbacks, each a cover wrapped round a slightly smaller block
      // of pages, kept inside the physics footprint.
      const covers = [m.bookNavy, m.bookRed, m.bookGreen];
      const each = height / 3;
      covers.forEach((cover, i) => {
        const y = i * each;
        const shrink = i * 0.35;
        const l = len - shrink;
        const w = wid - shrink;
        group.add(block(l, 0.2, w, cover, 0, y, 0));
        group.add(block(l, 0.2, w, cover, 0, y + each - 0.2, 0));
        group.add(block(0.3, each, w, cover, -l / 2 + 0.15, y, 0)); // spine
        group.add(block(l - 0.6, each - 0.4, w - 0.5, m.pages, 0.15, y + 0.2, 0));
        group.add(block(0.32, 0.25, w * 0.6, m.gold, -l / 2 + 0.15, y + each * 0.5, 0));
      });
      break;
    }
    case 'ruler': {
      // A 300mm ruler bridged across two erasers.
      const eraserLength = 4.4;
      for (const side of [-1, 1]) {
        group.add(block(eraserLength, height - 0.4, wid, m.eraser, side * (len / 2 - eraserLength / 2), 0, 0));
      }
      const ruler = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, wid), m.ruler);
      ruler.position.y = height - 0.2;
      group.add(ruler);
      break;
    }
    case 'phone': {
      group.add(block(len, height, wid, m.phone));
      // Face down, so the camera bump is on top.
      group.add(block(3.2, 0.12, 3.2, m.phone, -len / 2 + 2.4, height, -wid / 2 + 2.2));
      group.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 16), m.lens, -len / 2 + 1.7, height + 0.14, -wid / 2 + 1.6));
      break;
    }
    default: {
      const look = (BOX_LOOKS[item.look] ?? BOX_LOOKS.concrete)(m);
      const geometry = worldUV(new THREE.BoxGeometry(len, height, wid));
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
      const faces = [look.side, look.side, look.top, look.side, look.side, look.side];
      group.add(mesh(geometry, faces, 0, height / 2, 0));
      for (const edge of item.grind ?? []) {
        const sign = edge[1] === '+' ? 1 : -1;
        const along = edge[0] === 'w';
        const strip = edging(along ? len : wid, height, look.edge);
        if (along) strip.position.z = sign * (wid / 2 - 0.17);
        else {
          strip.rotation.y = Math.PI / 2;
          strip.position.x = sign * (len / 2 - 0.17);
        }
        group.add(strip);
      }
      break;
    }
  }
  return group;
}

function buildWedge(item, m) {
  const points = [[-item.len / 2, 0]];
  const steps = item.curve && item.curve !== 1 ? 24 : 1;
  for (let i = 0; i <= steps; i += 1) {
    const u = -item.len / 2 + (i / steps) * item.len;
    points.push([u, wedgeProfile(item, u)]);
  }
  points.push([item.len / 2, 0]);
  const group = new THREE.Group();
  group.add(extrudeProfile(points, item.wid, m.plywood, m.plySide));
  // A steel plate where the ramp meets the table, as on a real kicker.
  group.add(block(0.9, 0.05, item.wid, m.steel, -item.len / 2 + 0.45, 0, 0));
  return group;
}

/** A quarter pipe as a row of separate modules, pushed together. */
function buildQuarter(item, m) {
  const group = new THREE.Group();
  const run = quarterRun(item);
  const points = [[0, 0]];
  for (let i = 1; i <= 40; i += 1) {
    const u = (i / 40) * run;
    points.push([u, quarterProfile(item, u)]);
  }
  points.push([run + item.deck, item.height], [run + item.deck, 0]);

  const modules = item.modules ?? 1;
  const width = item.wid / modules;
  const radius = 0.34;
  for (let k = 0; k < modules; k += 1) {
    const w = -item.wid / 2 + width * (k + 0.5);
    // A hair narrower than its slot, so the seams between modules show.
    const module = extrudeProfile(points, width - 0.12, m.plywood, m.plySide);
    module.position.z = w;
    group.add(module);

    // Steel coping, sunk so its top is flush with the deck.
    const coping = mesh(
      new THREE.CylinderGeometry(radius, radius, width - 0.3, 12).rotateX(Math.PI / 2),
      m.steel,
      run - radius * 0.4,
      item.height - radius + 0.02,
      w,
    );
    group.add(coping);
    // Deck screws, two rows.
    for (const du of [run + 1.4, run + item.deck - 1.2]) {
      for (const dw of [-0.32, 0, 0.32]) group.add(screw(m.screw, du, item.height, w + dw * width));
    }
    // And along the bottom plate where the ramp meets the table.
    group.add(block(1.2, 0.05, width - 0.3, m.steel, 0.6, 0, w));
  }
  return group;
}

function buildStairs(item, m) {
  const points = [[0, 0]];
  for (let step = 0; step < item.drops - 1; step += 1) {
    const h = stairsProfile(item, step * item.tread);
    points.push([step * item.tread, h], [(step + 1) * item.tread, h]);
  }
  points.push([(item.drops - 1) * item.tread, 0]);
  const group = new THREE.Group();
  group.add(extrudeProfile(points, item.wid, m.concrete));
  // Steel nosing on each step edge.
  for (let step = 0; step < item.drops - 1; step += 1) {
    const h = stairsProfile(item, step * item.tread);
    group.add(mesh(new THREE.BoxGeometry(0.3, 0.3, item.wid), m.steel, step * item.tread + 0.15, h - 0.15, 0));
  }
  return group;
}

/**
 * A round bar from a to b ([x, z, topY] each), on posts with base plates.
 * The heights given are the *top* of the bar — the surface you grind — so the
 * bar's centre is one radius below. Posts and plates stay inside the bar's
 * footprint, where the physics already has the rail as solid.
 */
function buildRail(rail, m) {
  const material = rail.look === 'red' ? m.railRed : m.railBlack;
  const group = new THREE.Group();
  const a = new THREE.Vector3(rail.a[0], rail.a[2] - RAIL_RADIUS, rail.a[1]);
  const b = new THREE.Vector3(rail.b[0], rail.b[2] - RAIL_RADIUS, rail.b[1]);
  const length = a.distanceTo(b);
  const direction = b.clone().sub(a).normalize();

  const bar = new THREE.Mesh(new THREE.CylinderGeometry(RAIL_RADIUS, RAIL_RADIUS, length, 16), material);
  bar.position.copy(a).add(b).multiplyScalar(0.5);
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  group.add(bar);

  const heading = Math.atan2(direction.z, direction.x);
  const posts = Math.max(2, Math.round(length / 14) + 1);
  for (let i = 0; i < posts; i += 1) {
    const t = 0.04 + (0.92 * i) / (posts - 1);
    const top = a.clone().lerp(b, t);
    group.add(mesh(new THREE.BoxGeometry(0.5, top.y, 0.5), material, top.x, top.y / 2, top.z));
    const plate = mesh(new THREE.BoxGeometry(2.4, 0.2, 0.9), material, top.x, 0.1, top.z);
    plate.rotation.y = -heading;
    group.add(plate);
  }
  return group;
}

/** Round things standing on the table. */
function buildCylinder(item, m) {
  const group = new THREE.Group();
  const r = item.radius;
  const h = item.height;
  switch (item.look) {
    case 'mug': {
      const body = new THREE.CylinderGeometry(r - 0.1, r - 0.35, h, 28, 1, true);
      group.add(mesh(body, m.ceramicBlue, 0, h / 2, 0));
      const inside = new THREE.CylinderGeometry(r - 0.35, r - 0.55, h - 0.3, 28, 1, true);
      const insideMesh = mesh(inside, m.ceramic, 0, h / 2 + 0.15, 0);
      insideMesh.material = m.ceramic;
      group.add(insideMesh);
      group.add(mesh(new THREE.CylinderGeometry(r - 0.35, r - 0.35, 0.4, 28), m.ceramicBlue, 0, 0.2, 0));
      group.add(mesh(new THREE.CircleGeometry(r - 0.4, 28).rotateX(-Math.PI / 2), m.coffee, 0, h - 1.8, 0));
      group.add(mesh(new THREE.TorusGeometry(2.3, 0.55, 10, 20, Math.PI * 1.1).rotateZ(-Math.PI / 2 - 0.05), m.ceramicBlue, r + 0.9, h * 0.55, 0));
      break;
    }
    case 'pencils': {
      group.add(mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true), m.potMetal, 0, h / 2, 0));
      group.add(mesh(new THREE.CylinderGeometry(r, r, 0.3, 24), m.potMetal, 0, 0.15, 0));
      const random = rng(4);
      const colours = [m.pencil, m.pencilBlue, m.pencilGreen, m.pencil, m.pencilBlue];
      colours.forEach((material, i) => {
        const angle = (i / colours.length) * Math.PI * 2;
        const lean = 0.12 + random() * 0.12;
        const length = 16 + random() * 2;
        const pencil = new THREE.Group();
        pencil.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, length, 6), material, 0, length / 2, 0));
        pencil.add(mesh(new THREE.ConeGeometry(0.38, 1.4, 6), m.pencilWood, 0, length + 0.7, 0));
        pencil.add(mesh(new THREE.ConeGeometry(0.12, 0.45, 6), m.graphite, 0, length + 1.25, 0));
        pencil.position.set(Math.cos(angle) * 1.6, 0.4, Math.sin(angle) * 1.6);
        pencil.rotation.set(Math.sin(angle) * lean, 0, -Math.cos(angle) * lean);
        group.add(pencil);
      });
      break;
    }
    case 'lampBase': {
      group.add(mesh(new THREE.CylinderGeometry(r - 0.4, r, h, 32), m.lamp, 0, h / 2, 0));
      break;
    }
    case 'lampStem': {
      // Stem, an elbow, an arm leaning out over the table, and the shade.
      group.add(mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 12), m.lamp, 0, h / 2, 0));
      group.add(mesh(new THREE.SphereGeometry(1.4, 12, 10), m.lamp, 0, h, 0));
      const elbow = new THREE.Vector3(0, h, 0);
      const head = new THREE.Vector3(24, h + 8, -14);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, elbow.distanceTo(head), 10), m.lamp);
      arm.position.copy(elbow).lerp(head, 0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), head.clone().sub(elbow).normalize());
      group.add(arm);
      const shade = new THREE.Group();
      shade.add(mesh(new THREE.CylinderGeometry(2, 7.5, 9, 24, 1, true), m.lamp, 0, 0, 0));
      shade.add(mesh(new THREE.CylinderGeometry(1.95, 7.3, 8.8, 24, 1, true), m.lampInside, 0, -0.05, 0));
      const bulb = mesh(new THREE.SphereGeometry(2.2, 14, 10), m.bulb, 0, -2.5, 0);
      shade.add(bulb);
      shade.position.copy(head);
      shade.rotation.z = -0.5;
      shade.rotation.x = 0.3;
      group.add(shade);
      group.userData.lampHead = head.clone().add(new THREE.Vector3(0, -3, 0));
      break;
    }
    default:
      group.add(mesh(new THREE.CylinderGeometry(r, r, h, 24), m.concrete, 0, h / 2, 0));
  }
  return group;
}

/**
 * Every obstacle and object in the park, built once. Returns the group and
 * where the desk lamp's bulb is, for the light.
 */
export function buildPark(park, materials) {
  const group = new THREE.Group();
  let lampHead = null;
  for (const item of park.items) {
    let object;
    switch (item.kind) {
      case 'rail':
        group.add(buildRail(item, materials));
        continue;
      case 'box':
        object = buildBox(item, materials);
        break;
      case 'wedge':
        object = buildWedge(item, materials);
        break;
      case 'quarter':
        object = buildQuarter(item, materials);
        break;
      case 'stairs':
        object = buildStairs(item, materials);
        break;
      case 'cylinder':
        object = buildCylinder(item, materials);
        if (object.userData.lampHead) lampHead = object.userData.lampHead.clone().add(new THREE.Vector3(item.x, 0, item.z));
        break;
      default:
        continue;
    }
    object.position.set(item.x, 0, item.z);
    object.rotation.y = -(item.rot ?? 0);
    group.add(object);
  }
  return { group, lampHead };
}

/**
 * Flat things lying on the table: a sketch of the next ramp, sticky notes,
 * some change, the little screwdriver that comes with a fingerboard. They
 * sit in corners away from the lines, and are too thin to ride into.
 */
export function buildTableClutter(m) {
  const group = new THREE.Group();
  const flat = (width, depth, material, x, z, rot, y = 0.02) => {
    const piece = mesh(new THREE.BoxGeometry(width, 0.06, depth), material, x, y, z);
    piece.rotation.y = rot;
    group.add(piece);
  };
  flat(21, 29.7, m.paper, 112, -70, 0.35);
  flat(7.6, 7.6, m.sticky, -104, -80, 0.2, 0.05);
  flat(7.6, 7.6, m.stickyPink, -95, -76, -0.3, 0.06);
  flat(7.6, 7.6, m.sticky, 122, 64, 0.5, 0.05);
  const random = rng(8);
  for (let i = 0; i < 4; i += 1) {
    const coin = mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.18, 20), m.coin, 42 + random() * 8, 0.09 + i * 0.01, 80 + random() * 3);
    group.add(coin);
  }
  // Fingerboard screwdriver: a handle and a short shaft.
  const tool = new THREE.Group();
  tool.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 5, 10).rotateZ(Math.PI / 2), m.toolHandle, 0, 0.55, 0));
  tool.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8).rotateZ(Math.PI / 2), m.steel, 4.1, 0.55, 0));
  tool.position.set(100, 0, -76);
  tool.rotation.y = 0.8;
  group.add(tool);
  return group;
}

export { TABLE };
