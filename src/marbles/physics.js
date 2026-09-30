/**
 * Marble physics and the race around it.
 *
 * Pure: no three.js, no DOM, so hundreds of whole races can be run in a test.
 *
 * Marbles are spheres. They collide with the track's own triangles (found
 * through a spatial hash), with each other, with pegs and bumpers (capsules)
 * and with spinners (moving capsules), and roll down under gravity with a
 * little rolling resistance and air drag. Steps are small enough (1/200s,
 * speed-capped) that nothing moves half a marble in one, so nothing tunnels.
 *
 * Around that: progress along the centre line, placings, finishing, putting
 * a marble back that has jumped the track, and the fire wall that ends the
 * race if something is stuck.
 */

import { MARBLE_RADIUS } from './track.js';

export const RACE = {
  gravity: 26,
  restitution: 0.35,
  marbleRestitution: 0.7,
  rolling: 0.8, // rolling resistance: a small constant deceleration
  drag: 0.012, // quadratic air drag
  maxSpeed: 34,
  boost: 55, // acceleration on a boost pad
  boostCap: 30,
  bumperKick: 13,
  step: 1 / 200,
  // The whole field is normally home within ~25s of the winner, so the fire
  // only comes for a marble that is stuck or hopelessly far behind.
  fireDelay: 30, // seconds after the winner finishes
  fireSafety: 170, // start the fire anyway if nobody has finished by now
  fireCrossing: 25, // seconds for the fire to sweep start to finish
};

const R = MARBLE_RADIUS;

/* -------------------------------------------------------- spatial hash */

const CELL = 2.5;
const key = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;

function buildHash(triangles) {
  const cells = new Map();
  const count = triangles.length / 9;
  for (let t = 0; t < count; t += 1) {
    const o = t * 9;
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let v = 0; v < 3; v += 1) {
      const x = triangles[o + v * 3];
      const y = triangles[o + v * 3 + 1];
      const z = triangles[o + v * 3 + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix += 1) {
      for (let iy = Math.floor(minY / CELL); iy <= Math.floor(maxY / CELL); iy += 1) {
        for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz += 1) {
          const k = key(ix, iy, iz);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(t);
        }
      }
    }
  }
  return cells;
}

/* ------------------------------------------------ closest point helpers */

const cp = new Float64Array(3);

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(px, py, pz, tri, o) {
  const ax = tri[o]; const ay = tri[o + 1]; const az = tri[o + 2];
  const bx = tri[o + 3]; const by = tri[o + 4]; const bz = tri[o + 5];
  const cx = tri[o + 6]; const cy = tri[o + 7]; const cz = tri[o + 8];
  const abx = bx - ax; const aby = by - ay; const abz = bz - az;
  const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
  const apx = px - ax; const apy = py - ay; const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { cp[0] = ax; cp[1] = ay; cp[2] = az; return; }
  const bpx = px - bx; const bpy = py - by; const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { cp[0] = bx; cp[1] = by; cp[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    cp[0] = ax + abx * v; cp[1] = ay + aby * v; cp[2] = az + abz * v; return;
  }
  const cpx = px - cx; const cpy = py - cy; const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { cp[0] = cx; cp[1] = cy; cp[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    cp[0] = ax + acx * w; cp[1] = ay + acy * w; cp[2] = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    cp[0] = bx + (cx - bx) * w; cp[1] = by + (cy - by) * w; cp[2] = bz + (cz - bz) * w; return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  cp[0] = ax + abx * v + acx * w;
  cp[1] = ay + aby * v + acy * w;
  cp[2] = az + abz * v + acz * w;
}

/** Closest point on segment a + d*t, t in [0, 1]. Returns t. */
function closestOnSegment(px, py, pz, ax, ay, az, dx, dy, dz) {
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  cp[0] = ax + dx * t;
  cp[1] = ay + dy * t;
  cp[2] = az + dz * t;
  return t;
}

/* ---------------------------------------------------------------- race */

export function createRace(track, count = 24, { seed = 1 } = {}) {
  const hash = buildHash(track.triangles);
  const gateHash = buildHash(track.gate.triangles);
  // Indexed by id: marbles[id] is always marble id, whatever its grid slot.
  const marbles = new Array(count);

  // A grid behind the start gate, in random order so no marble always
  // starts at the front.
  const order = Array.from({ length: count }, (_, i) => i);
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const columns = 6;
  order.forEach((id, slot) => {
    const row = Math.floor(slot / columns);
    const col = slot % columns;
    const sample = track.samples[Math.max(1, track.gate.index - 2 - row * 2)];
    const across = (col - (columns - 1) / 2) * 1.45;
    marbles[id] = {
      id,
      x: sample.x + sample.r[0] * across + sample.u[0] * (R + 0.02),
      y: sample.y + sample.r[1] * across + sample.u[1] * (R + 0.02),
      z: sample.z + sample.r[2] * across + sample.u[2] * (R + 0.02),
      vx: 0, vy: 0, vz: 0,
      // For drawing the roll: the last surface it touched.
      nx: 0, ny: 1, nz: 0,
      touching: false,
      index: Math.max(1, track.gate.index - 2 - row * 2),
      progress: 0,
      lateral: across,
      finished: false,
      finishTime: null,
      place: null,
      eliminated: false,
      stillFor: 0,
    };
  });

  return {
    track,
    hash,
    gateHash,
    marbles,
    time: 0, // since the gate dropped
    started: false,
    gateOpen: false,
    finishedCount: 0,
    fire: { active: false, s: 0, startsAt: null },
    over: false,
    obstacles: track.obstacles,
  };
}

/** Open the gate and start the clock. */
export function startRace(race) {
  race.started = true;
  race.gateOpen = true;
  race.time = 0;
}

/** Advance by `dt` in fixed small steps. Returns events. */
export function stepRace(race, dt) {
  const events = [];
  const steps = Math.max(1, Math.round(dt / RACE.step));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) substep(race, h, events);
  return events;
}

function collideTriangles(m, triangles, hash) {
  let touched = false;
  const minX = Math.floor((m.x - R) / CELL);
  const maxX = Math.floor((m.x + R) / CELL);
  const minY = Math.floor((m.y - R) / CELL);
  const maxY = Math.floor((m.y + R) / CELL);
  const minZ = Math.floor((m.z - R) / CELL);
  const maxZ = Math.floor((m.z + R) / CELL);
  const seen = collideTriangles.seen;
  seen.clear();
  for (let ix = minX; ix <= maxX; ix += 1) {
    for (let iy = minY; iy <= maxY; iy += 1) {
      for (let iz = minZ; iz <= maxZ; iz += 1) {
        const list = hash.get(key(ix, iy, iz));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 1) {
          const t = list[k];
          if (seen.has(t)) continue;
          seen.add(t);
          closestOnTriangle(m.x, m.y, m.z, triangles, t * 9);
          const dx = m.x - cp[0];
          const dy = m.y - cp[1];
          const dz = m.z - cp[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R * R || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const nz = dz / d;
          resolve(m, nx, ny, nz, R - d, RACE.restitution, 0, 0, 0);
          touched = true;
          if (ny > 0.3) {
            m.nx = nx; m.ny = ny; m.nz = nz;
          }
        }
      }
    }
  }
  return touched;
}
collideTriangles.seen = new Set();

/** Push out of a surface along n by `depth` and bounce off it. */
function resolve(m, nx, ny, nz, depth, restitution, svx, svy, svz) {
  m.x += nx * depth;
  m.y += ny * depth;
  m.z += nz * depth;
  const rvx = m.vx - svx;
  const rvy = m.vy - svy;
  const rvz = m.vz - svz;
  const vn = rvx * nx + rvy * ny + rvz * nz;
  if (vn < 0) {
    // A slow contact does not bounce: it rolls.
    const e = vn > -2 ? 0 : restitution;
    m.vx -= (1 + e) * vn * nx;
    m.vy -= (1 + e) * vn * ny;
    m.vz -= (1 + e) * vn * nz;
  }
}

function collideObstacles(race, m, events) {
  for (const o of race.obstacles) {
    if (o.type === 'peg' || o.type === 'bumper') {
      const reach = o.height + o.radius + R;
      const bx = o.base[0]; const by = o.base[1]; const bz = o.base[2];
      if (Math.abs(m.x - bx) > reach || Math.abs(m.z - bz) > reach || Math.abs(m.y - by) > reach) continue;
      closestOnSegment(m.x, m.y, m.z, bx, by, bz, o.axis[0] * o.height, o.axis[1] * o.height, o.axis[2] * o.height);
      const dx = m.x - cp[0];
      const dy = m.y - cp[1];
      const dz = m.z - cp[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const limit = o.radius + R;
      if (d2 >= limit * limit || d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d; const ny = dy / d; const nz = dz / d;
      if (o.type === 'bumper') {
        resolve(m, nx, ny, nz, limit - d, 0.9, 0, 0, 0);
        // Pop bumpers kick: never leave slower than the kick.
        const out = m.vx * nx + m.vy * ny + m.vz * nz;
        if (out < RACE.bumperKick) {
          const add = RACE.bumperKick - out;
          m.vx += nx * add; m.vy += ny * add; m.vz += nz * add;
        }
        o.flash = 1;
        events.push({ type: 'bumper', id: m.id, obstacle: o });
      } else {
        resolve(m, nx, ny, nz, limit - d, 0.5, 0, 0, 0);
      }
    } else if (o.type === 'spinner') {
      const reach = o.arm + o.radius + R + 0.5;
      const c = o.centre;
      if (Math.abs(m.x - c[0]) > reach || Math.abs(m.z - c[2]) > reach || Math.abs(m.y - c[1]) > reach) continue;
      // Two arms: one bar through the centre, turning about the floor normal.
      const ca = Math.cos(o.angle);
      const sa = Math.sin(o.angle);
      const dir = [
        o.right[0] * ca + o.forward[0] * sa,
        o.right[1] * ca + o.forward[1] * sa,
        o.right[2] * ca + o.forward[2] * sa,
      ];
      const ax = c[0] - dir[0] * o.arm; const ay = c[1] - dir[1] * o.arm; const az = c[2] - dir[2] * o.arm;
      closestOnSegment(m.x, m.y, m.z, ax, ay, az, dir[0] * o.arm * 2, dir[1] * o.arm * 2, dir[2] * o.arm * 2);
      const dx = m.x - cp[0]; const dy = m.y - cp[1]; const dz = m.z - cp[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const limit = o.radius + R;
      if (d2 >= limit * limit || d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      // The arm's own velocity at the contact: omega x r.
      const rx = cp[0] - c[0]; const ry = cp[1] - c[1]; const rz = cp[2] - c[2];
      const w = o.omega;
      const svx = w * (o.axis[1] * rz - o.axis[2] * ry);
      const svy = w * (o.axis[2] * rx - o.axis[0] * rz);
      const svz = w * (o.axis[0] * ry - o.axis[1] * rx);
      resolve(m, dx / d, dy / d, dz / d, limit - d, 0.6, svx, svy, svz);
    }
  }
}

function collideMarbles(race) {
  const list = race.marbles;
  const min = 2 * R;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a.eliminated) continue;
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (b.eliminated) continue;
      const dx = b.x - a.x;
      if (dx > min || dx < -min) continue;
      const dy = b.y - a.y;
      if (dy > min || dy < -min) continue;
      const dz = b.z - a.z;
      if (dz > min || dz < -min) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min * min || d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d; const ny = dy / d; const nz = dz / d;
      const push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; a.z -= nz * push;
      b.x += nx * push; b.y += ny * push; b.z += nz * push;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
      if (vn < 0) {
        const j2 = (-(1 + RACE.marbleRestitution) * vn) / 2;
        a.vx -= j2 * nx; a.vy -= j2 * ny; a.vz -= j2 * nz;
        b.vx += j2 * nx; b.vy += j2 * ny; b.vz += j2 * nz;
      }
    }
  }
}

/** Nearest centre-line sample, searched near the last one. */
function track(race, m) {
  const samples = race.track.samples;
  let best = m.index;
  let bestD = Infinity;
  const lo = Math.max(0, m.index - 12);
  const hi = Math.min(samples.length - 1, m.index + 12);
  for (let i = lo; i <= hi; i += 1) {
    const p = samples[i];
    const d = (m.x - p.x) ** 2 + (m.y - p.y) ** 2 + (m.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  m.index = best;
  const p = samples[best];
  m.lateral = (m.x - p.x) * p.r[0] + (m.y - p.y) * p.r[1] + (m.z - p.z) * p.r[2];
  const along = (m.x - p.x) * p.t[0] + (m.y - p.y) * p.t[1] + (m.z - p.z) * p.t[2];
  m.progress = p.s + along;
  return { p, distance: Math.sqrt(bestD) };
}

function respawn(race, m, events) {
  const samples = race.track.samples;
  const index = Math.max(1, m.index - Math.round(4 / race.track.spacing));
  const p = samples[index];
  m.x = p.x + p.u[0] * (R + 0.4);
  m.y = p.y + p.u[1] * (R + 0.4);
  m.z = p.z + p.u[2] * (R + 0.4);
  m.vx = p.t[0] * 6;
  m.vy = p.t[1] * 6;
  m.vz = p.t[2] * 6;
  m.index = index;
  events.push({ type: 'respawn', id: m.id });
}

function substep(race, h, events) {
  const { marbles, track: layout } = race;
  if (race.started) race.time += h;

  for (const o of race.obstacles) {
    if (o.type === 'spinner') o.angle += o.omega * h;
    if (o.flash) o.flash = Math.max(0, o.flash - h * 4);
  }

  for (const m of marbles) {
    if (m.eliminated) continue;
    if (m.parked) continue;

    // Gravity, drag and rolling resistance.
    m.vy -= RACE.gravity * h;
    const speed = Math.hypot(m.vx, m.vy, m.vz);
    const rolling = m.touching && speed > 0.01 ? RACE.rolling / speed : 0;
    const slow = Math.min(1, (RACE.drag * speed + rolling) * h);
    m.vx -= m.vx * slow;
    m.vy -= m.vy * slow;
    m.vz -= m.vz * slow;
    if (speed > RACE.maxSpeed) {
      const k = RACE.maxSpeed / speed;
      m.vx *= k; m.vy *= k; m.vz *= k;
    }

    m.x += m.vx * h;
    m.y += m.vy * h;
    m.z += m.vz * h;

    m.touching = collideTriangles(m, layout.triangles, race.hash);
    if (!race.gateOpen) collideTriangles(m, layout.gate.triangles, race.gateHash);
    collideObstacles(race, m, events);
  }

  collideMarbles(race);

  for (const m of marbles) {
    if (m.eliminated || m.parked) continue;
    const { p, distance } = track(race, m);

    // Boost pads: a shove along the track while rolling over one.
    for (const o of race.obstacles) {
      if (o.type !== 'boost' || m.index < o.from || m.index > o.to) continue;
      if (m.lateral < o.across[0] || m.lateral > o.across[1] || !m.touching) continue;
      const along = m.vx * p.t[0] + m.vy * p.t[1] + m.vz * p.t[2];
      if (along < RACE.boostCap) {
        m.vx += p.t[0] * RACE.boost * h;
        m.vy += p.t[1] * RACE.boost * h;
        m.vz += p.t[2] * RACE.boost * h;
      }
      if (!m.boosting) events.push({ type: 'boost', id: m.id });
      m.boosting = true;
    }
    if (m.boosting && !race.obstacles.some((o) => o.type === 'boost' && m.index >= o.from && m.index <= o.to)) m.boosting = false;

    // Jumped the track: put it back on, a little way behind.
    if (distance > p.half + p.wall + 8 || m.y < p.y - 12) respawn(race, m, events);

    if (!m.finished && race.started && m.index >= layout.finishIndex) {
      m.finished = true;
      m.finishTime = race.time;
      race.finishedCount += 1;
      m.place = race.finishedCount;
      events.push({ type: 'finish', id: m.id, place: m.place, time: m.finishTime });
      if (race.fire.startsAt === null) race.fire.startsAt = race.time + RACE.fireDelay;
    }

    // Finished marbles that have come to rest in the basin stop simulating.
    const moving = Math.hypot(m.vx, m.vy, m.vz) > 0.15;
    m.stillFor = moving ? 0 : m.stillFor + h;
    if (m.finished && m.stillFor > 1) m.parked = true;
  }

  // The fire wall: after the winner (or a long while with no winner), it
  // sweeps from start to finish and takes anything still behind it.
  if (race.started) {
    const fire = race.fire;
    if (fire.startsAt === null && race.time > RACE.fireSafety) fire.startsAt = race.time;
    if (!fire.active && fire.startsAt !== null && race.time >= fire.startsAt) {
      const left = marbles.filter((m) => !m.finished && !m.eliminated).length;
      if (left > 0) {
        fire.active = true;
        fire.s = 0;
        events.push({ type: 'fireStart', left });
      }
    }
    if (fire.active) {
      fire.s += (layout.length / RACE.fireCrossing) * h;
      for (const m of marbles) {
        if (m.finished || m.eliminated) continue;
        if (m.progress <= fire.s) {
          m.eliminated = true;
          m.eliminatedAt = m.progress;
          events.push({ type: 'eliminated', id: m.id });
        }
      }
      if (fire.s >= layout.length) fire.active = false;
    }
    const remaining = marbles.some((m) => !m.finished && !m.eliminated);
    if (!remaining && !race.over) {
      race.over = true;
      events.push({ type: 'over' });
    }
  }
}

/**
 * Current order: finishers by place, then everyone still racing by how far
 * along they are, then the burnt, furthest first.
 */
export function standings(race) {
  return [...race.marbles].sort((a, b) => {
    const rank = (m) => (m.finished ? 0 : m.eliminated ? 2 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.finished) return a.place - b.place;
    if (a.eliminated) return (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0);
    return b.progress - a.progress;
  });
}
