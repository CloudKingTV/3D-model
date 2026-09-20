import * as THREE from 'three';

/**
 * Procedural geometry for the board. Units are centimetres-ish: the deck is
 * 9.6 long, which matches a real 96mm fingerboard at 1 unit = 10mm.
 */

export const DECK_SPEC = {
  length: 9.6,
  width: 3.0,
  thickness: 0.44,
  kickStart: 0.62, // fraction of the half-length where the kick lifts off
  kickHeight: 0.74,
  concave: 0.1,
  taper: 0.2,
};

export const TRUCK_SPEC = {
  wheelbase: 2.6, // distance from deck centre to each baseplate
  axleDrop: 0.66, // axle centre below the underside of the deck
  axleHalf: 1.52,
  wheelZ: 1.24,
  wheelRadius: 0.4,
  wheelWidth: 0.5,
  boltOffsetX: 0.33,
  boltOffsetZ: 0.32,
};

const HALF_L = DECK_SPEC.length / 2;
// The nose is a half-circle, so the arc has to start one tip-width back from
// the end — otherwise the taper closes to a wedge instead of a round tip.
const TIP_HALF_WIDTH = (DECK_SPEC.width / 2) * (1 - DECK_SPEC.taper);
const NOSE_START = 1 - TIP_HALF_WIDTH / HALF_L;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Height of the deck's centre line at `x` — flat in the middle, kicked at the
 * ends. The profile eases out of the flat and then runs almost straight, which
 * is what gives a kick its defined "bend then ramp" look rather than a banana.
 */
export function deckKick(x) {
  const p = Math.min(1, Math.abs(x) / HALF_L);
  if (p <= DECK_SPEC.kickStart) return 0;
  const t = (p - DECK_SPEC.kickStart) / (1 - DECK_SPEC.kickStart);
  const knee = 0.42;
  return DECK_SPEC.kickHeight * ((t * t) / (t + knee)) * (1 + knee);
}

function deckSlope(x) {
  const h = 0.002;
  return (deckKick(x + h) - deckKick(x - h)) / (2 * h);
}

/** Half the deck width at `x`, including the taper and the rounded tips. */
export function deckHalfWidth(x) {
  const p = Math.min(1, Math.abs(x) / HALF_L);
  if (p <= NOSE_START) {
    return (DECK_SPEC.width / 2) * (1 - DECK_SPEC.taper * smoothstep(0.3, NOSE_START, p));
  }
  const q = (p - NOSE_START) / (1 - NOSE_START);
  return Math.max(0.015, TIP_HALF_WIDTH * Math.sqrt(Math.max(0, 1 - q * q)));
}

function concaveAt(v) {
  return DECK_SPEC.concave * v * v;
}

/**
 * A point on the deck's top face.
 * @param {number} u 0..1 along the length
 * @param {number} v -1..1 across the width
 */
function topPoint(u, v, widen = 0, lift = 0) {
  const x = -HALF_L + u * DECK_SPEC.length;
  const halfWidth = deckHalfWidth(x) * (1 + widen);
  const slope = deckSlope(x);
  const inverseLength = 1 / Math.sqrt(1 + slope * slope);
  return {
    x: x - slope * inverseLength * lift,
    y: deckKick(x) + concaveAt(v) + inverseLength * lift,
    z: v * halfWidth,
    slope,
    inverseLength,
  };
}

/**
 * The solid deck: top face (group 0), bottom face (group 1) and the laminated
 * edge (group 2), so a material array can skin each part separately.
 */
export function buildDeckGeometry({ segmentsU = 140, segmentsV = 20 } = {}) {
  const positions = [];
  const uvs = [];
  const topIndices = [];
  const bottomIndices = [];
  const sideIndices = [];

  const push = (x, y, z, u, v) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  const cols = segmentsU + 1;
  const rows = segmentsV + 1;
  const topGrid = [];
  const bottomGrid = [];

  for (let i = 0; i < cols; i += 1) {
    const u = i / segmentsU;
    const topRow = [];
    const bottomRow = [];
    for (let j = 0; j < rows; j += 1) {
      const v = (j / segmentsV) * 2 - 1;
      const point = topPoint(u, v);
      topRow.push(push(point.x, point.y, point.z, u, j / segmentsV));
      // Offset along the surface normal so the deck keeps a constant thickness
      // through the kicks instead of getting thicker as it steepens.
      const bx = point.x + point.slope * point.inverseLength * DECK_SPEC.thickness;
      const by = point.y - point.inverseLength * DECK_SPEC.thickness;
      bottomRow.push(push(bx, by, point.z, u, 1 - j / segmentsV));
    }
    topGrid.push(topRow);
    bottomGrid.push(bottomRow);
  }

  for (let i = 0; i < segmentsU; i += 1) {
    for (let j = 0; j < segmentsV; j += 1) {
      const a = topGrid[i][j];
      const b = topGrid[i + 1][j];
      const c = topGrid[i][j + 1];
      const d = topGrid[i + 1][j + 1];
      topIndices.push(a, c, b, b, c, d);

      const e = bottomGrid[i][j];
      const f = bottomGrid[i + 1][j];
      const g = bottomGrid[i][j + 1];
      const h = bottomGrid[i + 1][j + 1];
      bottomIndices.push(e, f, g, f, h, g);
    }
  }

  // Edge band: duplicate the rim so the corner between face and edge stays crisp.
  const edgeRing = (grid, j, flip) => {
    const ring = [];
    for (let i = 0; i < cols; i += 1) {
      const index = grid[i][j];
      ring.push(push(
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
        i / segmentsU,
        flip ? 1 : 0,
      ));
    }
    return ring;
  };

  // j=0 is the far edge (outward normal -Z) and j=segmentsV the near edge (+Z),
  // so the two rims need opposite winding to face outward.
  for (const [j, winding] of [[0, -1], [segmentsV, 1]]) {
    const top = edgeRing(topGrid, j, false);
    const bottom = edgeRing(bottomGrid, j, true);
    for (let i = 0; i < segmentsU; i += 1) {
      const a = top[i];
      const b = top[i + 1];
      const c = bottom[i];
      const d = bottom[i + 1];
      if (winding > 0) sideIndices.push(a, c, b, b, c, d);
      else sideIndices.push(a, b, c, b, d, c);
    }
  }

  // Cap the nose and tail tips; i=0 faces -X and i=segmentsU faces +X.
  for (const [i, winding] of [[0, -1], [segmentsU, 1]]) {
    for (let j = 0; j < segmentsV; j += 1) {
      const a = topGrid[i][j];
      const b = topGrid[i][j + 1];
      const c = bottomGrid[i][j];
      const d = bottomGrid[i][j + 1];
      if (winding > 0) sideIndices.push(a, b, c, b, d, c);
      else sideIndices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...topIndices, ...bottomIndices, ...sideIndices]);
  geometry.addGroup(0, topIndices.length, 0);
  geometry.addGroup(topIndices.length, bottomIndices.length, 1);
  geometry.addGroup(topIndices.length + bottomIndices.length, sideIndices.length, 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Just the top face, floated above the deck — used for grip tape and decals. */
export function buildDeckSurfaceGeometry({
  lift = 0.012,
  inset = 0.02,
  trim = 0.004,
  segmentsU = 140,
  segmentsV = 20,
} = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const grid = [];

  for (let i = 0; i <= segmentsU; i += 1) {
    const u = trim + (i / segmentsU) * (1 - trim * 2);
    const row = [];
    for (let j = 0; j <= segmentsV; j += 1) {
      const v = ((j / segmentsV) * 2 - 1) * (1 - inset);
      const point = topPoint(u, v, -inset, lift);
      positions.push(point.x, point.y, point.z);
      uvs.push(i / segmentsU, j / segmentsV);
      row.push(positions.length / 3 - 1);
    }
    grid.push(row);
  }

  for (let i = 0; i < segmentsU; i += 1) {
    for (let j = 0; j < segmentsV; j += 1) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i][j + 1];
      const d = grid[i + 1][j + 1];
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* -------------------------------------------------------- sweep helpers */

/**
 * Round a closed 2D polygon by replacing each corner with a quadratic curve.
 * At this scale it is indistinguishable from a true fillet and never degenerates.
 */
export function roundPolygon(points, radius, segments = 4) {
  const out = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const prev = points[(i - 1 + count) % count];
    const cur = points[i];
    const next = points[(i + 1) % count];

    const toPrev = [prev[0] - cur[0], prev[1] - cur[1]];
    const toNext = [next[0] - cur[0], next[1] - cur[1]];
    const lenPrev = Math.hypot(...toPrev) || 1;
    const lenNext = Math.hypot(...toNext) || 1;
    const cut = Math.min(radius, lenPrev / 2, lenNext / 2);

    const start = [cur[0] + (toPrev[0] / lenPrev) * cut, cur[1] + (toPrev[1] / lenPrev) * cut];
    const end = [cur[0] + (toNext[0] / lenNext) * cut, cur[1] + (toNext[1] / lenNext) * cut];

    for (let s = 0; s <= segments; s += 1) {
      const t = s / segments;
      const inv = 1 - t;
      out.push([
        inv * inv * start[0] + 2 * inv * t * cur[0] + t * t * end[0],
        inv * inv * start[1] + 2 * inv * t * cur[1] + t * t * end[1],
      ]);
    }
  }
  return out;
}

/** A rounded trapezoid cross-section, centred on the origin in X. */
export function trapezoidSection(topWidth, bottomWidth, topY, bottomY, radius, segments = 4) {
  return roundPolygon([
    [-topWidth / 2, topY],
    [topWidth / 2, topY],
    [bottomWidth / 2, bottomY],
    [-bottomWidth / 2, bottomY],
  ], radius, segments);
}

/**
 * Sweep a list of equal-length rings along Z and cap both ends.
 * @param {Array<{z:number, points:Array<[number,number]>}>} rings
 */
export function sweepRings(rings) {
  const positions = [];
  const indices = [];
  const uvs = [];
  const ringSize = rings[0].points.length;

  for (const ring of rings) {
    for (let i = 0; i < ringSize; i += 1) {
      const [x, y] = ring.points[i];
      positions.push(x, y, ring.z);
      uvs.push(i / ringSize, (ring.z + 1) / 2);
    }
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < ringSize; i += 1) {
      const next = (i + 1) % ringSize;
      const a = r * ringSize + i;
      const b = r * ringSize + next;
      const c = (r + 1) * ringSize + i;
      const d = (r + 1) * ringSize + next;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Caps, as a fan from the ring centroid.
  for (const [ringIndex, flip] of [[0, true], [rings.length - 1, false]]) {
    const ring = rings[ringIndex];
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ring.points) {
      cx += x / ringSize;
      cy += y / ringSize;
    }
    positions.push(cx, cy, ring.z);
    uvs.push(0.5, 0.5);
    const centre = positions.length / 3 - 1;
    for (let i = 0; i < ringSize; i += 1) {
      const a = ringIndex * ringSize + i;
      const b = ringIndex * ringSize + ((i + 1) % ringSize);
      if (flip) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const lerp = (a, b, t) => a + (b - a) * t;

/** The tapered body of a truck hanger, swept along the axle. */
export function buildHangerGeometry() {
  const halfSpan = 0.96;
  const slices = 26;
  const rings = [];
  for (let i = 0; i <= slices; i += 1) {
    const z = -halfSpan + (i / slices) * halfSpan * 2;
    const q = Math.abs(z) / halfSpan;
    // Hold the full section across the kingpin boss, then taper to the axle.
    const t = smoothstep(0.12, 1.0, q);
    const topWidth = lerp(0.72, 0.2, t);
    const bottomWidth = lerp(0.44, 0.17, t);
    const topY = lerp(0.3, 0.09, t);
    const bottomY = lerp(-0.22, -0.09, t);
    rings.push({
      z,
      points: trapezoidSection(topWidth, bottomWidth, topY, bottomY, 0.07, 3),
    });
  }
  return sweepRings(rings);
}

/** The baseplate: a rounded slab with a raised kingpin boss on the inner side. */
export function buildBaseplateGeometry() {
  const rings = [];
  const slices = 14;
  const halfSpan = 0.62;
  for (let i = 0; i <= slices; i += 1) {
    const z = -halfSpan + (i / slices) * halfSpan * 2;
    const q = Math.abs(z) / halfSpan;
    const t = smoothstep(0.55, 1, q);
    rings.push({
      z,
      points: trapezoidSection(lerp(0.96, 0.62, t), lerp(0.9, 0.58, t), 0, -0.14, 0.05, 3),
    });
  }
  return sweepRings(rings);
}

/** A fingerboard wheel: a lathed urethane profile with rounded shoulders. */
export function buildWheelGeometry(radius = TRUCK_SPEC.wheelRadius, width = TRUCK_SPEC.wheelWidth) {
  const half = width / 2;
  const bevel = radius * 0.16;
  // Ten points, symmetric, so the texture's V runs sidewall / tread / sidewall
  // in even thirds — see createWheelTexture.
  const profile = [
    new THREE.Vector2(0.085, -half),
    new THREE.Vector2(0.17, -half + 0.035), // dished hub around the bearing
    new THREE.Vector2(radius * 0.7, -half + 0.012),
    new THREE.Vector2(radius - bevel * 0.45, -half + bevel * 0.3),
    new THREE.Vector2(radius, -half + bevel),
    new THREE.Vector2(radius, half - bevel),
    new THREE.Vector2(radius - bevel * 0.45, half - bevel * 0.3),
    new THREE.Vector2(radius * 0.7, half - 0.012),
    new THREE.Vector2(0.17, half - 0.035),
    new THREE.Vector2(0.085, half),
  ];
  const geometry = new THREE.LatheGeometry(profile, 48);
  geometry.rotateX(Math.PI / 2); // lathe axis Y -> axle axis Z
  return geometry;
}

/** Hex head for bolts and axle nuts. */
export function buildHexGeometry(radius, height) {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.96, height, 6);
  geometry.rotateY(Math.PI / 12);
  return geometry;
}
