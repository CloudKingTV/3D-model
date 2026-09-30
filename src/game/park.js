/**
 * The park: a fixed course of obstacles laid out on a tabletop.
 *
 * Pure: no three.js and no DOM. Every obstacle is described once, here, and
 * both the physics (through `heightAt`) and the meshes (props.js) are built
 * from that one description, so what you see is exactly what the board rides.
 *
 * Coordinates: x and z across the table, y up, 1 unit = 10mm. Each obstacle
 * has its own local frame — `u` along its length, `w` across it — placed at
 * (x, z) and turned by `rot`, where the local u axis points along
 * (cos rot, sin rot) in world x/z.
 */

/**
 * The table the park is set up on: a big wooden table, 2.6m x 1.7m, its top
 * at y = 0. The obstacles sit straight on it. Past its edge is the floor,
 * 750mm down.
 */
export const TABLE = { halfX: 130, halfZ: 85 };
export const FLOOR_Y = -75;
export const RAIL_RADIUS = 0.42;

/* ------------------------------------------------------- local frames */

export function toLocal(item, x, z) {
  const dx = x - item.x;
  const dz = z - item.z;
  const c = Math.cos(item.rot ?? 0);
  const s = Math.sin(item.rot ?? 0);
  return { u: dx * c + dz * s, w: -dx * s + dz * c };
}

export function toWorld(item, u, w) {
  const c = Math.cos(item.rot ?? 0);
  const s = Math.sin(item.rot ?? 0);
  return { x: item.x + u * c - w * s, z: item.z + u * s + w * c };
}

/* ------------------------------------------------------------ profiles */

/**
 * Quarter pipe: a circular transition of radius `radius`, cut off at `height`,
 * then a flat deck. Returns the height `u` along from the toe.
 */
export function quarterRun(q) {
  return Math.sqrt(q.radius * q.radius - (q.radius - q.height) ** 2);
}

export function quarterProfile(q, u) {
  if (u < 0) return 0;
  const run = quarterRun(q);
  if (u < run) return q.radius - Math.sqrt(q.radius * q.radius - u * u);
  return q.height;
}

/** Wedge: rises from 0 at u = -len/2 to `height` at u = +len/2. */
export function wedgeProfile(item, u) {
  const t = (u + item.len / 2) / item.len;
  return item.height * Math.pow(Math.min(1, Math.max(0, t)), item.curve ?? 1);
}

/** Stairs: `drops` equal steps down from `height` over `tread`-long treads. */
export function stairsProfile(item, u) {
  const step = Math.floor(u / item.tread);
  return item.height * (1 - (step + 1) / item.drops);
}

/* ------------------------------------------------------ height queries */

/** Height of one obstacle's solid at (x, z), or -Infinity where it is not. */
function itemHeight(item, x, z) {
  switch (item.kind) {
    case 'box': {
      const { u, w } = toLocal(item, x, z);
      if (Math.abs(u) > item.len / 2 || Math.abs(w) > item.wid / 2) return -Infinity;
      return item.height;
    }
    case 'wedge': {
      const { u, w } = toLocal(item, x, z);
      if (Math.abs(u) > item.len / 2 || Math.abs(w) > item.wid / 2) return -Infinity;
      return wedgeProfile(item, u);
    }
    case 'quarter': {
      const { u, w } = toLocal(item, x, z);
      if (u < 0 || u > quarterRun(item) + item.deck || Math.abs(w) > item.wid / 2) return -Infinity;
      return quarterProfile(item, u);
    }
    case 'stairs': {
      const { u, w } = toLocal(item, x, z);
      if (u < 0 || u >= item.tread * (item.drops - 1) || Math.abs(w) > item.wid / 2) return -Infinity;
      return stairsProfile(item, u);
    }
    case 'cylinder': {
      const dx = x - item.x;
      const dz = z - item.z;
      return dx * dx + dz * dz <= item.radius * item.radius ? item.height : -Infinity;
    }
    case 'rail': {
      const hit = railParam(item, x, z);
      if (!hit || hit.distance > RAIL_RADIUS + 0.05) return -Infinity;
      return hit.y;
    }
    default:
      return -Infinity;
  }
}

/** Closest point on a rail's centre line, in plan. */
function railParam(rail, x, z) {
  const [ax, az] = rail.a;
  const [bx, bz] = rail.b;
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = ((x - ax) * dx + (z - az) * dz) / lengthSq;
  if (t < 0 || t > 1) return null;
  const px = ax + dx * t;
  const pz = az + dz * t;
  return {
    t,
    distance: Math.hypot(x - px, z - pz),
    y: rail.a[2] + (rail.b[2] - rail.a[2]) * t,
  };
}

/** A generous plan-view bounding box, so most queries skip most obstacles. */
function boundsOf(item) {
  if (item.kind === 'cylinder') {
    return {
      minX: item.x - item.radius,
      maxX: item.x + item.radius,
      minZ: item.z - item.radius,
      maxZ: item.z + item.radius,
    };
  }
  if (item.kind === 'rail') {
    const pad = RAIL_RADIUS + 0.1;
    return {
      minX: Math.min(item.a[0], item.b[0]) - pad,
      maxX: Math.max(item.a[0], item.b[0]) + pad,
      minZ: Math.min(item.a[1], item.b[1]) - pad,
      maxZ: Math.max(item.a[1], item.b[1]) + pad,
    };
  }
  let uMin;
  let uMax;
  if (item.kind === 'quarter') {
    uMin = 0;
    uMax = quarterRun(item) + item.deck;
  } else if (item.kind === 'stairs') {
    uMin = 0;
    uMax = item.tread * (item.drops - 1);
  } else {
    uMin = -item.len / 2;
    uMax = item.len / 2;
  }
  const corners = [
    toWorld(item, uMin, -item.wid / 2),
    toWorld(item, uMin, item.wid / 2),
    toWorld(item, uMax, -item.wid / 2),
    toWorld(item, uMax, item.wid / 2),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)) - 0.01,
    maxX: Math.max(...corners.map((c) => c.x)) + 0.01,
    minZ: Math.min(...corners.map((c) => c.z)) - 0.01,
    maxZ: Math.max(...corners.map((c) => c.z)) + 0.01,
  };
}

/* -------------------------------------------------------------- layout */

/**
 * The course. Heights are real fingerboard-park sizes: a 90mm quarter pipe,
 * 30mm ledges, 45mm funbox, 60mm stair platform.
 */
export const LAYOUT = [
  // Store-bought fingerboard obstacles, set out on the table.

  // Quarter pipes at both ends — each a row of four 275mm modules pushed
  // together. Back and forth between them is a session.
  { kind: 'quarter', name: 'quarter pipe', x: -96, z: 0, rot: Math.PI, wid: 110, height: 9, radius: 14, deck: 9, modules: 4 },
  { kind: 'quarter', name: 'quarter pipe', x: 96, z: 0, rot: 0, wid: 110, height: 9, radius: 14, deck: 9, modules: 4 },

  // Funbox in the middle: a flat top between two banks, ledges down its sides.
  { kind: 'box', name: 'funbox', x: 0, z: 0, rot: 0, len: 24, wid: 18, height: 4.5, grind: ['w-', 'w+'], look: 'plywood' },
  { kind: 'wedge', name: 'funbox', x: -19, z: 0, rot: 0, len: 14, wid: 18, height: 4.5, look: 'plywood' },
  { kind: 'wedge', name: 'funbox', x: 19, z: 0, rot: Math.PI, len: 14, wid: 18, height: 4.5, look: 'plywood' },

  // North side: a painted ledge and a flat bar.
  { kind: 'box', name: 'ledge', x: -38, z: -50, rot: 0, len: 44, wid: 5, height: 3, grind: ['w-', 'w+'], look: 'painted' },
  { kind: 'rail', name: 'rail', a: [18, -50, 3.4], b: [66, -50, 3.4], look: 'black' },

  // A manual pad, low enough to ollie onto from flat.
  { kind: 'box', name: 'manual pad', x: 58, z: -18, rot: 0, len: 22, wid: 12, height: 1.6, grind: ['u-', 'u+', 'w-', 'w+'], look: 'concrete' },

  // Two kickers, pointed at open table.
  { kind: 'wedge', name: 'kicker', x: -60, z: 24, rot: 0, len: 10, wid: 12, height: 3.6, curve: 1.6, look: 'plywood' },
  { kind: 'wedge', name: 'kicker', x: 62, z: 30, rot: Math.PI, len: 10, wid: 12, height: 3.6, curve: 1.6, look: 'plywood' },

  // South side: a platform with a bank up one side and stairs down the other,
  // with a handrail down one side of the stairs.
  { kind: 'wedge', name: 'bank', x: -20, z: 58, rot: 0, len: 16, wid: 22, height: 6, look: 'plywood' },
  { kind: 'box', name: 'platform', x: 2, z: 58, rot: 0, len: 28, wid: 22, height: 6, grind: ['w-'], look: 'concrete' },
  { kind: 'stairs', name: 'stairs', x: 16, z: 58, rot: 0, wid: 22, height: 6, drops: 3, tread: 4.5, look: 'concrete' },
  // Parallel to the step noses (4 down over 9 along), 3 above them.
  { kind: 'rail', name: 'handrail', a: [14, 64, 9.9], b: [29, 64, 3.2], look: 'red' },

  // Whatever else lives on the table — all of it solid, some of it skateable.
  // A 300mm ruler bridged across two erasers: the classic homemade ledge.
  { kind: 'box', name: 'ruler', x: -20, z: -70, rot: 0, len: 30, wid: 3, height: 2.2, grind: ['w-', 'w+'], look: 'ruler' },
  // A closed laptop is a very good manual pad.
  { kind: 'box', name: 'laptop', x: -64, z: 62, rot: 0.18, len: 32, wid: 22, height: 1.6, grind: ['u-', 'u+', 'w-', 'w+'], look: 'laptop' },
  // Three hardbacks, stacked: a ledge with a top you can manual across.
  // (Off to the side, clear of the run-out from the handrail.)
  { kind: 'box', name: 'books', x: 80, z: 75, rot: -0.1, len: 23, wid: 15, height: 4.2, grind: ['u-', 'u+', 'w-', 'w+'], look: 'books' },
  // A phone lying face down: a tiny step up.
  { kind: 'box', name: 'phone', x: 30, z: -72, rot: 0.3, len: 15, wid: 7.2, height: 0.8, look: 'phone' },
  { kind: 'cylinder', name: 'mug', x: 112, z: 70, radius: 4.2, height: 9.5, look: 'mug' },
  { kind: 'cylinder', name: 'pencil pot', x: -112, z: -70, radius: 3.8, height: 10, look: 'pencils' },
  // The desk lamp: a heavy round foot and the stem rising out of it.
  { kind: 'cylinder', name: 'lamp', x: -114, z: 68, radius: 7, height: 1.3, look: 'lampBase' },
  { kind: 'cylinder', name: 'lamp', x: -116, z: 70, radius: 0.9, height: 40, look: 'lampStem' },
];

/** Collectible letters, each somewhere that takes a trick to reach. */
export const LETTERS = [
  { letter: 'S', x: -54, y: 8.5, z: 24 }, // pop off the west kicker's lip
  { letter: 'K', x: 42, y: 5.6, z: -50 }, // along the flat bar
  { letter: 'A', x: 0, y: 9, z: 0 }, // over the funbox
  { letter: 'T', x: -106, y: 14, z: -20 }, // an air out of the west quarter
  { letter: 'E', x: 22, y: 8.6, z: 64 }, // down the handrail
];

export const SPAWN = { x: -70, z: -12, heading: 0 };

/* ---------------------------------------------------------- grind lines */

/** Every edge you can grind: rails, ledge edges and quarter-pipe coping. */
function grindLinesFor(item) {
  const lines = [];
  if (item.kind === 'rail') {
    lines.push({
      kind: 'rail',
      name: item.name,
      a: { x: item.a[0], y: item.a[2], z: item.a[1] },
      b: { x: item.b[0], y: item.b[2], z: item.b[1] },
    });
  } else if (item.kind === 'quarter') {
    const u = quarterRun(item);
    const a = toWorld(item, u, -item.wid / 2);
    const b = toWorld(item, u, item.wid / 2);
    lines.push({ kind: 'coping', name: 'coping', a: { ...a, y: item.height }, b: { ...b, y: item.height } });
  } else if (item.kind === 'box') {
    for (const edge of item.grind ?? []) {
      const sign = edge[1] === '+' ? 1 : -1;
      let a;
      let b;
      if (edge[0] === 'u') {
        a = toWorld(item, (sign * item.len) / 2, -item.wid / 2);
        b = toWorld(item, (sign * item.len) / 2, item.wid / 2);
      } else {
        a = toWorld(item, -item.len / 2, (sign * item.wid) / 2);
        b = toWorld(item, item.len / 2, (sign * item.wid) / 2);
      }
      lines.push({ kind: 'ledge', name: item.name, a: { ...a, y: item.height }, b: { ...b, y: item.height } });
    }
  }
  for (const line of lines) {
    const dx = line.b.x - line.a.x;
    const dy = line.b.y - line.a.y;
    const dz = line.b.z - line.a.z;
    line.length = Math.hypot(dx, dy, dz);
    line.planLength = Math.hypot(dx, dz);
    line.dir = { x: dx / line.length, y: dy / line.length, z: dz / line.length };
  }
  return lines;
}

/* ---------------------------------------------------------------- park */

export function createPark(layout = LAYOUT) {
  const items = layout.map((item, index) => ({ ...item, id: index }));
  for (const item of items) item.bounds = boundsOf(item);
  const grindLines = items.flatMap(grindLinesFor).map((line, id) => ({ ...line, id }));

  /** The solid under (x, z): the tallest thing there, the table, or the floor. */
  function heightAt(x, z) {
    if (Math.abs(x) > TABLE.halfX || Math.abs(z) > TABLE.halfZ) return FLOOR_Y;
    let top = 0;
    for (const item of items) {
      const b = item.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const h = itemHeight(item, x, z);
      if (h > top) top = h;
    }
    return top;
  }

  /** Which obstacle is tallest at (x, z) — for naming what you hit. */
  function itemAt(x, z) {
    let best = null;
    let top = 0.01;
    for (const item of items) {
      const b = item.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const h = itemHeight(item, x, z);
      if (h >= top) {
        top = h;
        best = item;
      }
    }
    return best;
  }

  /**
   * Uphill direction of a vertical face between two plan points, found from
   * the height gradient either side of `x, z`. Points out of the solid.
   */
  function faceNormal(x, z, fallbackX, fallbackZ) {
    const e = 0.3;
    const gx = heightAt(x + e, z) - heightAt(x - e, z);
    const gz = heightAt(x, z + e) - heightAt(x, z - e);
    const length = Math.hypot(gx, gz);
    if (length < 1e-6) {
      const f = Math.hypot(fallbackX, fallbackZ) || 1;
      return { x: -fallbackX / f, z: -fallbackZ / f };
    }
    // The solid is uphill, so its outward normal points downhill.
    return { x: -gx / length, z: -gz / length };
  }

  /**
   * The first near-vertical face crossed walking from one plan point to
   * another, if its top is above the line joining `y0` to `y1`. Continuous
   * slopes, however steep the quarter pipe gets, never count: only a jump in
   * height between samples 0.2 apart does.
   */
  function faceBetween(x0, z0, y0, x1, z1, y1, clearance = 0.3) {
    const distance = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(distance / 0.2));
    let previous = heightAt(x0, z0);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const h = heightAt(x, z);
      const line = y0 + (y1 - y0) * t;
      if (h - previous > 0.6 && h > line + clearance) {
        const px = x0 + (x1 - x0) * ((i - 0.5) / steps);
        const pz = z0 + (z1 - z0) * ((i - 0.5) / steps);
        return { x: px, z: pz, height: h, item: itemAt(x, z), normal: faceNormal(px, pz, x1 - x0, z1 - z0) };
      }
      previous = h;
    }
    return null;
  }

  return {
    items,
    grindLines,
    letters: LETTERS,
    spawn: SPAWN,
    heightAt,
    itemAt,
    faceBetween,
    faceNormal,
  };
}
