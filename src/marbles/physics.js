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
  // Steering and power-ups (league races).
  steer: 11, // sideways acceleration at full steer
  turbo: 44, // acceleration during a turbo
  turboTime: 1.7,
  turboCap: 33,
  ghostTime: 3.2,
  hop: 9.5,
  shockRadius: 5,
  shockKick: 11,
  boxRespawn: 2.5,
  pickupReach: 1.05,
};

export const ITEMS = ['turbo', 'ghost', 'shock', 'hop'];

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

export function createRace(track, count = 24, {
  seed = 1, items = false, steering = false, skill = 0.5, watch = null, rolling = RACE.rolling,
} = {}) {
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
      // Steering (-1..1), the power-up held, and what is running.
      steer: 0,
      ai: true,
      item: null,
      turboUntil: 0,
      ghostUntil: 0,
      aiLane: (random() * 2 - 1) * 2,
      aiThink: random() * 0.12,
      aiUseAt: null,
      coins: 0,
    };
  });

  const pickups = items ? (track.pickups ?? []).map((p, i) => ({ ...p, i, taken: false, back: 0 })) : [];
  const buckets = new Map();
  for (const p of pickups) {
    if (!buckets.has(p.index)) buckets.set(p.index, []);
    buckets.get(p.index).push(p);
  }

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
    boosts: track.obstacles.filter((o) => o.type === 'boost'),
    // Power-ups and steering.
    items,
    steering,
    skill,
    watch, // the marble whose coins and knocks are reported (the player's)
    rolling,
    pickups,
    buckets,
    random,
    t: 0, // simulated time including before the start, for effect timers
    queue: [], // events raised between steps (a power-up used from the UI)
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
  const events = race.queue.splice(0);
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

function collideMarbles(race, events) {
  const list = race.marbles;
  const min = 2 * R;
  const t = race.t;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a.eliminated || a.ghostUntil > t) continue;
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (b.eliminated || b.ghostUntil > t) continue;
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
        if (vn < -3 && (a.id === race.watch || b.id === race.watch)) events.push({ type: 'clack', id: race.watch, speed: -vn });
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
  race.t += h;

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
    const rolling = m.touching && speed > 0.01 ? race.rolling / speed : 0;
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

  collideMarbles(race, events);

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
    if (m.boosting && !race.boosts.some((o) => m.index >= o.from && m.index <= o.to)) m.boosting = false;

    if (race.started && !m.finished) {
      // Steering: a sideways push across the floor while rolling on it.
      if (race.steering) {
        if (m.ai) think(race, m, p, h, events);
        if (m.touching && m.steer) {
          const a = RACE.steer * Math.max(-1, Math.min(1, m.steer)) * h;
          m.vx += p.r[0] * a; m.vy += p.r[1] * a; m.vz += p.r[2] * a;
        }
      }
      if (m.turboUntil > race.t) {
        const along = m.vx * p.t[0] + m.vy * p.t[1] + m.vz * p.t[2];
        if (along < RACE.turboCap) {
          m.vx += p.t[0] * RACE.turbo * h;
          m.vy += p.t[1] * RACE.turbo * h;
          m.vz += p.t[2] * RACE.turbo * h;
        }
      }
      if (race.items) collectPickups(race, m, events);
    }

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

/* ------------------------------------------------------------ power-ups */

/** Coins (the watched marble's) and boxes (anyone without an item). */
function collectPickups(race, m, events) {
  const reach = RACE.pickupReach * RACE.pickupReach;
  for (let i = m.index - 2; i <= m.index + 2; i += 1) {
    const list = race.buckets.get(i);
    if (!list) continue;
    for (const p of list) {
      const d = (m.x - p.x) ** 2 + (m.y - p.y) ** 2 + (m.z - p.z) ** 2;
      if (d > reach) continue;
      if (p.kind === 'coin') {
        if (m.id !== race.watch || p.taken) continue;
        p.taken = true;
        m.coins += 1;
        events.push({ type: 'coin', id: m.id, pickup: p });
      } else if (p.kind === 'box') {
        if (race.t < p.back || m.item) continue;
        p.back = race.t + RACE.boxRespawn;
        m.item = rollItem(race, m);
        m.aiUseAt = null;
        events.push({ type: 'item', id: m.id, item: m.item, pickup: p });
      }
    }
  }
}

/**
 * Which power-up a box gives depends on where you are: the back of the
 * field gets turbos to catch up, the front gets defensive tricks.
 */
function rollItem(race, m) {
  let ahead = 0;
  for (const o of race.marbles) if (o !== m && !o.eliminated && (o.finished || o.progress > m.progress)) ahead += 1;
  const rank = ahead / Math.max(1, race.marbles.length - 1); // 0 front .. 1 back
  const weights = {
    turbo: 0.05 + rank * 0.6,
    ghost: 0.35 - rank * 0.2,
    shock: 0.35 - rank * 0.15,
    hop: 0.25,
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = race.random() * total;
  for (const [item, w] of Object.entries(weights)) {
    roll -= w;
    if (roll < 0) return item;
  }
  return 'turbo';
}

/** Use marble `id`'s power-up now. Returns the item used, or null. */
export function useItem(race, id) {
  const m = race.marbles[id];
  if (!m || !m.item || m.eliminated || m.finished || !race.started) return null;
  const item = m.item;
  m.item = null;
  m.aiUseAt = null;
  const p = race.track.samples[m.index];
  if (item === 'turbo') {
    m.turboUntil = race.t + RACE.turboTime;
  } else if (item === 'ghost') {
    m.ghostUntil = race.t + RACE.ghostTime;
  } else if (item === 'hop') {
    m.vx += p.u[0] * RACE.hop; m.vy += p.u[1] * RACE.hop; m.vz += p.u[2] * RACE.hop;
  } else if (item === 'shock') {
    const hits = [];
    for (const o of race.marbles) {
      if (o === m || o.eliminated || o.finished || o.ghostUntil > race.t) continue;
      const dx = o.x - m.x; const dy = o.y - m.y; const dz = o.z - m.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > RACE.shockRadius || d < 1e-6) continue;
      // Pushed away across the floor and popped up a little.
      const fall = 1 - d / RACE.shockRadius;
      const k = RACE.shockKick * (0.5 + fall * 0.5);
      const along = dx * p.u[0] + dy * p.u[1] + dz * p.u[2];
      const fx = dx - p.u[0] * along; const fy = dy - p.u[1] * along; const fz = dz - p.u[2] * along;
      const fl = Math.hypot(fx, fy, fz) || 1;
      o.vx += (fx / fl) * k + p.u[0] * 3; o.vy += (fy / fl) * k + p.u[1] * 3; o.vz += (fz / fl) * k + p.u[2] * 3;
      // And slowed: a shockwave costs the ones it hits their momentum.
      o.vx *= 0.7; o.vy *= 0.7; o.vz *= 0.7;
      hits.push(o.id);
    }
    race.queue.push({ type: 'shock', id, hits });
  }
  race.queue.push({ type: 'use', id, item });
  return item;
}

/**
 * The computer racers: steer toward boost pads and boxes (when empty-handed),
 * otherwise hold a lane; use power-ups after a moment's thought. `skill`
 * scales how well they do both.
 */
function think(race, m, p, h) {
  m.aiThink -= h;
  if (m.aiThink > 0) return;
  m.aiThink = 0.12;
  const skill = race.skill;
  const ahead = m.index + Math.round(24 / race.track.spacing);
  let target = m.aiLane;
  let found = false;
  for (const o of race.boosts) {
    if (o.from > m.index + 2 && o.from < ahead) {
      target = (o.across[0] + o.across[1]) / 2;
      found = true;
      break;
    }
  }
  if (!m.item && race.items) {
    for (let i = m.index + 3; i < ahead && !found; i += 1) {
      const list = race.buckets.get(i);
      if (!list) continue;
      let best = null;
      for (const q of list) {
        if (q.kind === 'box' && race.t >= q.back && (!best || Math.abs(q.lateral - m.lateral) < Math.abs(best.lateral - m.lateral))) best = q;
      }
      if (best) { target = best.lateral; found = true; }
    }
  }
  if (race.random() < 0.03) m.aiLane = (race.random() * 2 - 1) * Math.max(0, p.half - 1.5) * 0.7;
  target = Math.max(-p.half + 1, Math.min(p.half - 1, target));
  const wobble = (race.random() - 0.5) * (1 - skill) * 1.2;
  m.steer = Math.max(-1, Math.min(1, (target - m.lateral) * 0.7 + wobble)) * (0.35 + skill * 0.65);

  if (m.item && m.autoItem !== false) {
    if (m.aiUseAt === null) m.aiUseAt = race.t + (0.3 + race.random() * 2.2) * (1.7 - skill);
    if (race.t >= m.aiUseAt) {
      // A shockwave waits (a little) for someone to hit.
      if (m.item === 'shock' && race.t < m.aiUseAt + 3) {
        const near = race.marbles.some((o) => o !== m && !o.eliminated && !o.finished && Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z) < RACE.shockRadius * 0.8);
        if (!near) return;
      }
      useItem(race, m.id);
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
