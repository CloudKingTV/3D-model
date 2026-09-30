import * as THREE from 'three';
import { shade, rgba } from '../lib/textures.js';
import { rng, canvasTexture, worldUV, mesh, block } from './canvasKit.js';
import { TABLE, FLOOR_Y } from './park.js';

/**
 * The bedroom the table stands in: walls, a window onto the sky, a bed, a
 * bookshelf, posters, a rug. Everything is drawn in code.
 *
 * It is scenery seen through a tilt-shift blur, so it is built for cost, not
 * close-up detail: plain boxes, Lambert shading instead of full PBR, and a
 * handful of textures. The table is the one piece of furniture you look at
 * up close, so it gets the proper wood.
 *
 * Units are the game's: 1 = 10mm. The floor is at FLOOR_Y, the tabletop at 0.
 */

export const ROOM = {
  minX: -320,
  maxX: 320,
  minZ: -240,
  maxZ: 300,
  ceiling: 175,
  window: { x: -10, width: 220, bottom: 18, top: 150 },
};

const TABLE_THICKNESS = 4;

/* ------------------------------------------------------------- textures */

/** Oak tabletop: wide planks, grain along them, a few knots. */
function createTableTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const base = '#9a6a3e';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const random = rng(42);
    const planks = 6;
    for (let i = 0; i < planks; i += 1) {
      const y = (i / planks) * h;
      ctx.fillStyle = shade(base, 0.07 * (random() - 0.5));
      ctx.fillRect(0, y, w, h / planks);
      for (let g = 0; g < 46; g += 1) {
        const gy = y + random() * (h / planks);
        const amp = 2 + random() * 9;
        const freq = 0.002 + random() * 0.006;
        const phase = random() * Math.PI * 2;
        ctx.strokeStyle = random() > 0.45
          ? rgba('#3a2312', 0.08 + random() * 0.12)
          : rgba('#d7a870', 0.05 + random() * 0.07);
        ctx.lineWidth = 0.8 + random() * 2.2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 10) ctx.lineTo(x, gy + Math.sin(x * freq + phase) * amp);
        ctx.stroke();
      }
      ctx.fillStyle = rgba('#2b1a0d', 0.55);
      ctx.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 5; i += 1) {
      const cx = random() * w;
      const cy = random() * h;
      const r = 5 + random() * 12;
      const knot = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      knot.addColorStop(0, rgba('#2e1c0e', 0.7));
      knot.addColorStop(1, rgba('#2e1c0e', 0));
      ctx.fillStyle = knot;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: [1 / 110, 1 / 110] });
}

/** Painted plaster: an even warm white with a faint roller texture. */
function createWallTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e9e1d3';
    ctx.fillRect(0, 0, w, h);
    const random = rng(3);
    for (let i = 0; i < 2600; i += 1) {
      ctx.fillStyle = random() > 0.5 ? rgba('#ffffff', 0.05) : rgba('#b9ad98', 0.06);
      ctx.fillRect(random() * w, random() * h, 2 + random() * 5, 1 + random() * 3);
    }
  }, { repeat: [1 / 90, 1 / 90] });
}

/** Floorboards, narrower and darker than the table. */
function createFloorTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const base = '#6b4a2e';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const random = rng(12);
    const boards = 8;
    for (let i = 0; i < boards; i += 1) {
      const y = (i / boards) * h;
      ctx.fillStyle = shade(base, (random() - 0.5) * 0.14);
      ctx.fillRect(0, y, w, h / boards - 2);
      const joint = random() * w;
      ctx.fillStyle = rgba('#241408', 0.6);
      ctx.fillRect(joint, y, 2, h / boards);
      for (let g = 0; g < 10; g += 1) {
        ctx.strokeStyle = rgba('#2e1c0e', 0.1);
        ctx.beginPath();
        const gy = y + random() * (h / boards);
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy + (random() - 0.5) * 6);
        ctx.stroke();
      }
    }
  }, { repeat: [1 / 110, 1 / 110] });
}

/** A woven rug under the table: border bands and a diamond field. */
function createRugTexture() {
  return canvasTexture(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#34465e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d9c9a6';
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.strokeStyle = '#b35c3c';
    ctx.lineWidth = 5;
    ctx.strokeRect(40, 40, w - 80, h - 80);
    ctx.fillStyle = rgba('#d9c9a6', 0.35);
    for (let x = 80; x < w - 60; x += 48) {
      for (let y = 80; y < h - 60; y += 48) {
        ctx.beginPath();
        ctx.moveTo(x, y - 14);
        ctx.lineTo(x + 14, y);
        ctx.lineTo(x, y + 14);
        ctx.lineTo(x - 14, y);
        ctx.closePath();
        ctx.fill();
      }
    }
    const random = rng(2);
    for (let i = 0; i < 4000; i += 1) {
      ctx.fillStyle = rgba(random() > 0.5 ? '#ffffff' : '#000000', 0.04);
      ctx.fillRect(random() * w, random() * h, 2, 2);
    }
  }, { wrap: false });
}

/** What you see out of the window: sky, cloud, rooftops and trees. */
function createSkyTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#5f97d6');
    sky.addColorStop(0.55, '#a9cdf0');
    sky.addColorStop(0.8, '#e6eef2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const random = rng(17);
    // Soft clouds.
    for (let c = 0; c < 9; c += 1) {
      const cx = random() * w;
      const cy = 40 + random() * h * 0.4;
      for (let p = 0; p < 9; p += 1) {
        const r = 22 + random() * 40;
        const g = ctx.createRadialGradient(cx + (random() - 0.5) * 120, cy + (random() - 0.5) * 24, 0, cx, cy, r * 1.6);
        g.addColorStop(0, rgba('#ffffff', 0.55));
        g.addColorStop(1, rgba('#ffffff', 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - 200, cy - 120, 400, 240);
      }
    }
    // Trees, then houses in front of them.
    ctx.fillStyle = '#4f6d4e';
    for (let x = 0; x < w; x += 18) {
      const r = 20 + random() * 30;
      ctx.beginPath();
      ctx.arc(x, h * 0.72 - random() * 30, r, 0, Math.PI * 2);
      ctx.fill();
    }
    let x = -20;
    while (x < w) {
      const width = 80 + random() * 110;
      const height = 60 + random() * 70;
      const top = h * 0.78 - height;
      ctx.fillStyle = shade('#b59c86', (random() - 0.5) * 0.3);
      ctx.fillRect(x, top, width, h - top);
      ctx.fillStyle = shade('#6d4a3c', (random() - 0.5) * 0.3);
      ctx.beginPath();
      ctx.moveTo(x - 6, top);
      ctx.lineTo(x + width / 2, top - 30 - random() * 20);
      ctx.lineTo(x + width + 6, top);
      ctx.fill();
      ctx.fillStyle = rgba('#2c3a4a', 0.6);
      for (let wx = x + 12; wx < x + width - 16; wx += 26) {
        for (let wy = top + 14; wy < h * 0.78 - 10; wy += 28) ctx.fillRect(wx, wy, 12, 14);
      }
      x += width + 6 + random() * 20;
    }
    ctx.fillStyle = '#5e7a55';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  }, { wrap: false });
}

/** Posters: made-up skate and music prints, all type and shapes. */
function createPosterTexture(kind) {
  return canvasTexture(256, 360, (ctx, w, h) => {
    if (kind === 0) {
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#16181c';
      ctx.font = '900 64px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('KEEP', w / 2, 90);
      ctx.fillText('PUSH', w / 2, 158);
      ctx.fillText('ING', w / 2, 226);
      // A board, side on.
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(40, 280);
      ctx.quadraticCurveTo(60, 300, 128, 300);
      ctx.quadraticCurveTo(196, 300, 216, 280);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(80, 322, 12, 0, Math.PI * 2);
      ctx.arc(176, 322, 12, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 1) {
      ctx.fillStyle = '#1e2a44';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i += 1) {
        ctx.fillStyle = ['#ff5a3c', '#ffb23c', '#3cc8ff', '#b06bff', '#56e39f', '#ff5a8a'][i];
        ctx.beginPath();
        ctx.arc(w / 2, 150, 110 - i * 17, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f4efe4';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SUMMER', w / 2, 305);
      ctx.fillText('SESSION', w / 2, 340);
    } else {
      ctx.fillStyle = '#efe9dd';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c23b2e';
      ctx.fillRect(22, 22, w - 44, h - 120);
      ctx.fillStyle = '#efe9dd';
      ctx.font = '900 42px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DIY', w / 2, 150);
      ctx.fillText('PARK', w / 2, 200);
      ctx.fillStyle = '#16181c';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText('build it yourself', w / 2, h - 60);
    }
  }, { wrap: false });
}

/** Rows of book spines for the shelf. */
function createSpinesTexture() {
  return canvasTexture(512, 128, (ctx, w, h) => {
    const random = rng(33);
    const colours = ['#8f2a2a', '#1f3354', '#2f5a3f', '#c99a3a', '#5a3b6e', '#e2dccf', '#2b2b2f', '#b3582c'];
    let x = 0;
    while (x < w) {
      const width = 10 + random() * 16;
      const top = random() * 26;
      ctx.fillStyle = colours[Math.floor(random() * colours.length)];
      ctx.fillRect(x, top, width, h - top);
      ctx.fillStyle = rgba('#ffffff', 0.25);
      ctx.fillRect(x + 2, top + 16, width - 4, 3);
      ctx.fillRect(x + 2, h - 22, width - 4, 3);
      x += width + 1;
    }
  }, { wrap: false });
}

/** Duvet cover: soft broad stripes. */
function createDuvetTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d7dde6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9fb2c9';
    for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 22, h);
  }, { repeat: [1 / 60, 1 / 60] });
}

/* --------------------------------------------------------------- build */

/**
 * `lite` (phones) shades the room with Lambert, which is cheap but ignores
 * the captured environment light; otherwise the room is physically based
 * like everything else, so its walls pick up the window's bounce light.
 */
export function createRoomMaterials({ lite = false } = {}) {
  const textures = {
    table: createTableTexture(),
    wall: createWallTexture(),
    floor: createFloorTexture(),
    rug: createRugTexture(),
    sky: createSkyTexture(),
    spines: createSpinesTexture(),
    duvet: createDuvetTexture(),
    posters: [0, 1, 2].map(createPosterTexture),
  };
  const lambert = lite
    ? (options) => new THREE.MeshLambertMaterial(options)
    : (options) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...options });
  const materials = {
    // The table is looked at from a centimetre away: varnished oak, the
    // grain raised through the finish, the window reflected in the lacquer.
    table: lite
      ? new THREE.MeshStandardMaterial({
        map: textures.table, bumpMap: textures.table, bumpScale: 0.6, roughness: 0.5,
      })
      : new THREE.MeshPhysicalMaterial({
        map: textures.table,
        bumpMap: textures.table,
        bumpScale: 0.8,
        roughness: 0.58,
        // A satin lacquer rather than a mirror: into the sun it glares
        // softly instead of whiting out the view.
        clearcoat: 0.3,
        clearcoatRoughness: 0.32,
      }),
    tableEdge: new THREE.MeshStandardMaterial({ color: '#6e4526', roughness: 0.5 }),
    wall: lambert({ map: textures.wall }),
    skirting: lambert({ color: '#f4f1ea' }),
    // Varnished boards: glossier than the walls, so the window shows in them.
    floor: lite
      ? new THREE.MeshLambertMaterial({ map: textures.floor })
      : new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.45 }),
    rug: lambert({ map: textures.rug }),
    ceiling: lambert({ color: '#f3efe8' }),
    windowFrame: lambert({ color: '#f7f6f2' }),
    // Brighter than white: daylight outside is far brighter than the room,
    // and on desktop the glow pass haloes the window because of it.
    sky: new THREE.MeshBasicMaterial({ map: textures.sky, color: new THREE.Color(1.7, 1.7, 1.7) }),
    curtain: lambert({ color: '#7d93a8' }),
    radiator: lambert({ color: '#eceae4' }),
    shelf: lambert({ color: '#caa57a' }),
    spines: lambert({ map: textures.spines }),
    bedFrame: lambert({ color: '#5b4632' }),
    mattress: lambert({ color: '#eeeae2' }),
    duvet: lambert({ map: textures.duvet }),
    pillow: lambert({ color: '#f5f3ee' }),
    posters: textures.posters.map((map) => lambert({ map })),
    door: lambert({ color: '#efece5' }),
    handle: new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.9, roughness: 0.3 }),
    chair: lambert({ color: '#2c3036' }),
    chairSeat: lambert({ color: '#3b4a63' }),
    deck: lambert({ color: '#2a2d33' }),
    deckWood: lambert({ color: '#c79b62' }),
    wheel: lambert({ color: '#f1efe6' }),
    truck: new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.85, roughness: 0.35 }),
    pot: lambert({ color: '#c46a45' }),
    leaves: lambert({ color: '#3f7a45' }),
    light: new THREE.MeshBasicMaterial({ color: '#fffaf0' }),
  };
  return { materials, textures };
}

function plane(width, height, material, x, y, z, rotY = 0) {
  const m = mesh(worldUV(new THREE.PlaneGeometry(width, height)), material, x, y, z);
  m.rotation.y = rotY;
  return m;
}

/** The table: a thick oak top on four legs with an apron under it. */
export function buildTable(m) {
  const group = new THREE.Group();
  const w = TABLE.halfX * 2;
  const d = TABLE.halfZ * 2;
  const topGeometry = worldUV(new THREE.BoxGeometry(w, TABLE_THICKNESS, d));
  const top = new THREE.Mesh(topGeometry, [m.tableEdge, m.tableEdge, m.table, m.tableEdge, m.tableEdge, m.tableEdge]);
  top.position.y = -TABLE_THICKNESS / 2;
  group.add(top);

  const legHeight = -TABLE_THICKNESS - FLOOR_Y;
  const inset = 10;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    group.add(block(7, legHeight, 7, m.tableEdge, sx * (TABLE.halfX - inset), FLOOR_Y, sz * (TABLE.halfZ - inset)));
  }
  const apronY = -TABLE_THICKNESS - 10;
  group.add(block(w - 2 * inset, 10, 2.5, m.tableEdge, 0, apronY, -(TABLE.halfZ - inset)));
  group.add(block(w - 2 * inset, 10, 2.5, m.tableEdge, 0, apronY, TABLE.halfZ - inset));
  group.add(block(2.5, 10, d - 2 * inset, m.tableEdge, -(TABLE.halfX - inset), apronY, 0));
  group.add(block(2.5, 10, d - 2 * inset, m.tableEdge, TABLE.halfX - inset, apronY, 0));
  return group;
}

/** Walls, floor, ceiling, window and everything standing in the room. */
export function buildRoom(m) {
  const group = new THREE.Group();
  const { minX, maxX, minZ, maxZ, ceiling } = ROOM;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const height = ceiling - FLOOR_Y;
  const midY = FLOOR_Y + height / 2;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // Floor, ceiling and the rug under the table.
  const floor = plane(width, depth, m.floor, cx, FLOOR_Y, cz);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  const ceilingPlane = plane(width, depth, m.ceiling, cx, ceiling, cz);
  ceilingPlane.rotation.x = Math.PI / 2;
  group.add(ceilingPlane);
  const rug = mesh(new THREE.PlaneGeometry(380, 280), m.rug, 0, FLOOR_Y + 0.3, 10);
  rug.rotation.x = -Math.PI / 2;
  group.add(rug);

  // Side and front walls.
  group.add(plane(depth, height, m.wall, minX, midY, cz, Math.PI / 2));
  group.add(plane(depth, height, m.wall, maxX, midY, cz, -Math.PI / 2));
  group.add(plane(width, height, m.wall, cx, midY, maxZ, Math.PI));

  // Back wall, built round the window opening.
  const win = ROOM.window;
  const left = win.x - win.width / 2;
  const right = win.x + win.width / 2;
  group.add(plane(left - minX, height, m.wall, (minX + left) / 2, midY, minZ));
  group.add(plane(maxX - right, height, m.wall, (right + maxX) / 2, midY, minZ));
  group.add(plane(win.width, win.bottom - FLOOR_Y, m.wall, win.x, (FLOOR_Y + win.bottom) / 2, minZ));
  group.add(plane(win.width, ceiling - win.top, m.wall, win.x, (win.top + ceiling) / 2, minZ));

  // Skirting boards.
  group.add(block(width, 10, 1.5, m.skirting, cx, FLOOR_Y, minZ + 0.8));
  group.add(block(width, 10, 1.5, m.skirting, cx, FLOOR_Y, maxZ - 0.8));
  group.add(block(1.5, 10, depth, m.skirting, minX + 0.8, FLOOR_Y, cz));
  group.add(block(1.5, 10, depth, m.skirting, maxX - 0.8, FLOOR_Y, cz));

  // The window: frame, glazing bars, sill, and the view.
  const frame = 6;
  const winMidY = (win.bottom + win.top) / 2;
  group.add(block(win.width + frame * 2, frame, 8, m.windowFrame, win.x, win.top, minZ));
  group.add(block(win.width + frame * 2, frame, 8, m.windowFrame, win.x, win.bottom - frame, minZ));
  group.add(block(frame, win.top - win.bottom, 8, m.windowFrame, left - frame / 2, win.bottom, minZ));
  group.add(block(frame, win.top - win.bottom, 8, m.windowFrame, right + frame / 2, win.bottom, minZ));
  group.add(block(3, win.top - win.bottom, 4, m.windowFrame, win.x, win.bottom, minZ));
  group.add(block(win.width, 3, 4, m.windowFrame, win.x, winMidY - 1.5, minZ));
  group.add(block(win.width + 30, 3, 22, m.windowFrame, win.x, win.bottom - frame - 3, minZ + 9));
  group.add(plane(900, 480, m.sky, win.x, 70, minZ - 320));

  // A plant on the sill.
  group.add(mesh(new THREE.CylinderGeometry(7, 5.5, 13, 16), m.pot, win.x - 70, win.bottom - 3 + 6.5, minZ + 10));
  const random = rng(6);
  for (let i = 0; i < 9; i += 1) {
    const leaf = mesh(new THREE.SphereGeometry(5 + random() * 3, 10, 8), m.leaves,
      win.x - 70 + (random() - 0.5) * 12, win.bottom + 16 + random() * 14, minZ + 10 + (random() - 0.5) * 10);
    leaf.scale.y = 1.3;
    group.add(leaf);
  }

  // Curtains either side, gathered.
  for (const side of [-1, 1]) {
    const x = win.x + side * (win.width / 2 + 26);
    for (let f = 0; f < 5; f += 1) {
      group.add(mesh(new THREE.CylinderGeometry(4.5, 5, 185, 10), m.curtain, x + (f - 2) * 7, ceiling - 6 - 185 / 2, minZ + 12));
    }
  }
  group.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, win.width + 120, 10).rotateZ(Math.PI / 2), m.handle, win.x, ceiling - 5, minZ + 12));

  // Radiator under the window.
  for (let f = 0; f < 18; f += 1) {
    group.add(block(4, 55, 8, m.radiator, win.x - 70 + f * 8, FLOOR_Y + 14, minZ + 8));
  }

  // Bookshelf on the left wall.
  const shelfX = minX + 16;
  const shelfZ = -70;
  const shelfW = 110;
  const shelfH = 190;
  group.add(block(30, shelfH, 2, m.shelf, shelfX, FLOOR_Y, shelfZ - shelfW / 2));
  group.add(block(30, shelfH, 2, m.shelf, shelfX, FLOOR_Y, shelfZ + shelfW / 2));
  group.add(block(2, shelfH, shelfW, m.shelf, minX + 1, FLOOR_Y, shelfZ));
  for (let s = 0; s <= 5; s += 1) {
    const y = FLOOR_Y + 2 + s * 37;
    group.add(block(30, 2.5, shelfW, m.shelf, shelfX, y, shelfZ));
    if (s < 5) {
      const books = plane(shelfW - 6, 30, m.spines, shelfX + 12, y + 2.5 + 15, shelfZ, Math.PI / 2);
      books.geometry = new THREE.PlaneGeometry(shelfW - 6, 30);
      group.add(books);
      group.add(block(20, 30, shelfW - 6, m.shelf, shelfX - 3, y + 2.5, shelfZ));
    }
  }

  // The bed along the right wall.
  const bedX0 = maxX - 150;
  const bedZ0 = 70;
  const bedZ1 = maxZ - 8;
  const bedCx = (bedX0 + maxX) / 2;
  const bedCz = (bedZ0 + bedZ1) / 2;
  group.add(block(150, 28, bedZ1 - bedZ0, m.bedFrame, bedCx, FLOOR_Y, bedCz));
  group.add(block(144, 20, bedZ1 - bedZ0 - 6, m.mattress, bedCx, FLOOR_Y + 28, bedCz));
  group.add(block(150, 8, bedZ1 - bedZ0 - 60, m.duvet, bedCx, FLOOR_Y + 46, bedCz - 30));
  group.add(block(150, 22, 16, m.duvet, bedCx, FLOOR_Y + 32, bedZ0 + 1));
  group.add(block(60, 12, 40, m.pillow, bedCx - 36, FLOOR_Y + 48, bedZ1 - 32));
  group.add(block(60, 12, 40, m.pillow, bedCx + 36, FLOOR_Y + 48, bedZ1 - 32));
  group.add(block(154, 95, 6, m.bedFrame, bedCx, FLOOR_Y, bedZ1 + 1));

  // Posters.
  const poster = (index, x, y, z, rotY) => group.add(plane(56, 79, m.posters[index], x, y, z, rotY));
  poster(0, maxX - 0.6, 75, bedCz - 50, -Math.PI / 2);
  poster(1, maxX - 0.6, 75, bedCz + 40, -Math.PI / 2);
  poster(2, -220, 70, minZ + 0.6, 0);

  // The door on the front wall.
  group.add(block(90, 205, 3, m.door, -180, FLOOR_Y, maxZ - 2));
  group.add(block(100, 6, 5, m.windowFrame, -180, FLOOR_Y + 205, maxZ - 2));
  group.add(mesh(new THREE.SphereGeometry(3, 12, 10), m.handle, -180 + 34, FLOOR_Y + 100, maxZ - 7));

  // A desk chair pulled up to the table.
  const chair = new THREE.Group();
  chair.add(block(46, 5, 44, m.chairSeat, 0, 46, 0));
  chair.add(block(44, 48, 5, m.chairSeat, 0, 55, 22));
  chair.add(mesh(new THREE.CylinderGeometry(2.5, 2.5, 40, 10), m.chair, 0, 25, 0));
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * Math.PI * 2;
    const leg = block(30, 3, 4, m.chair, Math.cos(a) * 14, 3, Math.sin(a) * 14);
    leg.rotation.y = -a;
    chair.add(leg);
  }
  chair.position.set(40, FLOOR_Y, 128);
  chair.rotation.y = 0.35;
  group.add(chair);

  // A real skateboard leaning on the wall: the same shape as the one on the
  // table, eight times bigger.
  const board = new THREE.Group();
  board.add(block(20, 1.4, 80, m.deckWood, 0, 0, 0));
  board.add(block(20.2, 0.2, 80.2, m.deck, 0, 1.4, 0));
  for (const z of [-26, 26]) {
    board.add(block(14, 3, 3, m.truck, 0, -3, z));
    for (const x of [-9, 9]) {
      board.add(mesh(new THREE.CylinderGeometry(2.7, 2.7, 3.2, 14).rotateZ(Math.PI / 2), m.wheel, x, -5, z));
    }
  }
  board.position.set(175, FLOOR_Y + 40, minZ + 12);
  board.rotation.x = -1.3;
  group.add(board);

  // Ceiling light.
  group.add(mesh(new THREE.CylinderGeometry(22, 26, 5, 24), m.light, 0, ceiling - 3, 30));
  return group;
}
