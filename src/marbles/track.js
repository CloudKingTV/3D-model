/**
 * Marble run generator.
 *
 * Pure: no three.js, no DOM. A seed becomes a whole track — a descending
 * chute built from modules (curves, a spiral, a peg field, bumpers, a
 * spinner, a funnel, waves, a split, boosts, a plunge) — with everything the
 * physics needs (collision triangles, obstacles, the centre line for
 * progress) and everything the renderer needs (the same triangles, grouped
 * by colour, with normals and UVs). The physics and the picture come from
 * one set of triangles, so a marble can only ever touch what you can see.
 *
 * Units: a marble is 1 across (radius 0.5).
 */

export const MARBLE_RADIUS = 0.5;
const DS = 0.75; // centre-line sample spacing
const DEG = Math.PI / 180;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Colours for the chute floor, one per module, like a toy marble run. */
export const FLOOR_COLOURS = ['#2f7de1', '#f2b33d', '#e2453c', '#35b36b', '#8b5cf6', '#12b3c4', '#f07c2b', '#e94f9a'];

/* --------------------------------------------------------------- frame */

function frame(heading, slope, bank) {
  // Tangent: along the heading, tipped down by the slope.
  const cs = Math.cos(slope);
  const t = [cs * Math.cos(heading), -Math.sin(slope), cs * Math.sin(heading)];
  // Level right-hand vector, then banked: a positive bank drops the right
  // edge (the inside of a right-hand turn).
  const rl = [-Math.sin(heading), 0, Math.cos(heading)];
  // Up, perpendicular to both.
  const ul = [
    rl[1] * t[2] - rl[2] * t[1],
    rl[2] * t[0] - rl[0] * t[2],
    rl[0] * t[1] - rl[1] * t[0],
  ];
  const len = Math.hypot(...ul);
  const u0 = ul.map((v) => v / len);
  const cb = Math.cos(bank);
  const sb = Math.sin(bank);
  const r = rl.map((v, i) => v * cb - u0[i] * sb);
  const u = u0.map((v, i) => v * cb + rl[i] * sb);
  return { t, r, u };
}

/* ------------------------------------------------------------- modules */

/**
 * Every module says how long it is and what the chute does along it: turn
 * rate, slope, half-width, bank, wall height, floor waves, a divider. Values
 * are eased in over the first few units so one module flows into the next.
 * Obstacles are placed by fractions along the module and across the chute.
 */
const MODULES = {
  straight(random) {
    const length = 18 + random() * 12;
    return {
      name: 'straight', length, slope: (11 + random() * 3) * DEG, half: 4.5,
      boosts: random() < 0.6 ? [{ at: 0.35 + random() * 0.3, across: [-2.5, 2.5] }] : [],
    };
  },
  curve(random) {
    const turn = (50 + random() * 60) * DEG * (random() < 0.5 ? -1 : 1);
    const radius = 15 + random() * 6;
    return {
      name: 'curve', length: Math.abs(turn) * radius, turnRate: turn / (Math.abs(turn) * radius),
      slope: 10 * DEG, half: 4.5, bank: Math.sign(turn) * 0.42, wall: 4,
    };
  },
  spiral(random) {
    const turn = (360 + random() * 180) * DEG * (random() < 0.5 ? -1 : 1);
    const radius = 12;
    return {
      name: 'spiral', length: Math.abs(turn) * radius, turnRate: turn / (Math.abs(turn) * radius),
      slope: 10 * DEG, half: 4.5, bank: Math.sign(turn) * 0.5, wall: 4.5,
    };
  },
  pegs(random) {
    return { name: 'pegs', length: 30, slope: 16 * DEG, half: 7, pegField: true, seed: random() };
  },
  bumpers(random) {
    return { name: 'bumpers', length: 26, slope: 12 * DEG, half: 6.5, bumperField: true, seed: random() };
  },
  spinner(random) {
    return {
      name: 'spinner', length: 20, slope: 11 * DEG, half: 5,
      spinners: [{ at: 0.55, omega: (random() < 0.5 ? -1 : 1) * (2 + random() * 1.2) }],
    };
  },
  funnel() {
    return { name: 'funnel', length: 30, slope: 15 * DEG, half: (f) => (f < 0.5 ? 7 - f * 2 * 4 : 3 + (f - 0.5) * 2 * 1.5) };
  },
  waves() {
    // Gentle enough that no crest ever rises against the slope.
    return { name: 'waves', length: 32, slope: 14 * DEG, half: 4.5, wave: { amp: 0.22, length: 8 } };
  },
  split(random) {
    return {
      name: 'split', length: 38, slope: 12 * DEG, half: 6.5, divider: [0.14, 0.86],
      boosts: [{ at: 0.45, across: random() < 0.5 ? [0.8, 5.6] : [-5.6, -0.8] }],
      pegRow: true,
    };
  },
  plunge() {
    return { name: 'plunge', length: 16, slope: 28 * DEG, half: 4.5, wall: 3.5 };
  },
};

const POOL = ['straight', 'curve', 'curve', 'curve', 'spiral', 'pegs', 'bumpers', 'spinner', 'funnel', 'waves', 'split', 'plunge'];

/* ------------------------------------------------------------ generate */

function tryGenerate(seed) {
  const random = rng(seed);
  const samples = [];
  const obstacles = [];
  const modules = [];

  let x = 0;
  let y = 0;
  let z = 0;
  let heading = 0;
  // Current (eased) chute parameters.
  let slope = 4 * DEG;
  let half = 5;
  let bank = 0;
  let wall = 3;

  function emit(spec, colour) {
    const steps = Math.max(2, Math.ceil(spec.length / DS));
    const startIndex = samples.length;
    const ease = 5; // units over which parameters blend into this module's
    const from = { slope, half, bank, wall };
    for (let i = 0; i < steps; i += 1) {
      const f = i / steps;
      const along = i * DS;
      const k = Math.min(1, along / ease);
      const blend = (a, b) => a + (b - a) * (k * k * (3 - 2 * k));
      const targetHalf = typeof spec.half === 'function' ? spec.half(f) : spec.half ?? 4.5;
      slope = blend(from.slope, spec.slope ?? 11 * DEG);
      half = typeof spec.half === 'function' ? blend(from.half, targetHalf) : blend(from.half, targetHalf);
      // Bank eases in and back out within the module, so the next one
      // always starts level — slowly enough that no edge of the floor ever
      // rises while it does: the low inside edge of a turn coming back up
      // faster than the chute drops is exactly a pocket a marble stops in.
      const bankEase = Math.min(16, spec.length / 2.2);
      // (The easing curve changes fastest in its middle, at 1.5x the average.)
      const maxBank = (0.5 * Math.tan(spec.slope ?? 11 * DEG) * bankEase) / Math.max(targetHalf, 1);
      const bankTarget = Math.sign(spec.bank ?? 0) * Math.min(Math.abs(spec.bank ?? 0), maxBank);
      const inOut = Math.max(0, Math.min(1, along / bankEase, (spec.length - along) / bankEase));
      bank = bankTarget * inOut * inOut * (3 - 2 * inOut);
      wall = blend(from.wall, spec.wall ?? 3);

      const { t, r, u } = frame(heading, slope, bank);
      let lift = 0;
      if (spec.wave) {
        const fade = Math.min(1, along / 4, (spec.length - along) / 4);
        lift = Math.sin((along / spec.wave.length) * Math.PI * 2) * spec.wave.amp * fade;
      }
      samples.push({
        s: samples.length * DS,
        x, y, z,
        t, r, u,
        half,
        wall,
        lift,
        colour,
        module: modules.length,
        divider: spec.divider ? f >= spec.divider[0] && f <= spec.divider[1] : false,
      });
      x += t[0] * DS;
      y += t[1] * DS;
      z += t[2] * DS;
      heading += (spec.turnRate ?? 0) * DS;
    }
    const endIndex = samples.length - 1;
    modules.push({ name: spec.name, start: startIndex, end: endIndex });
    placeObstacles(spec, startIndex, endIndex);
  }

  function sampleAt(fraction, a, b) {
    return samples[Math.round(a + (b - a) * fraction)];
  }

  /** A point on the floor of sample `p`, `across` units from the centre. */
  function floorPoint(p, across) {
    return [
      p.x + p.r[0] * across + p.u[0] * p.lift,
      p.y + p.r[1] * across + p.u[1] * p.lift,
      p.z + p.r[2] * across + p.u[2] * p.lift,
    ];
  }

  function placeObstacles(spec, a, b) {
    const random = rng(Math.floor((spec.seed ?? random2()) * 1e9));
    for (const boost of spec.boosts ?? []) {
      const i0 = Math.round(a + (b - a) * boost.at);
      obstacles.push({ type: 'boost', from: i0, to: Math.min(b, i0 + Math.round(6 / DS)), across: boost.across });
    }
    for (const spinner of spec.spinners ?? []) {
      const p = sampleAt(spinner.at, a, b);
      const base = floorPoint(p, 0);
      obstacles.push({
        type: 'spinner',
        centre: base.map((v, i) => v + p.u[i] * 0.55),
        axis: p.u,
        right: p.r,
        forward: p.t,
        arm: 3.4,
        radius: 0.32,
        omega: spinner.omega,
        angle: 0,
      });
    }
    if (spec.pegField) {
      // Staggered rows; gaps of at least 2.2 so a marble (1 across) passes.
      let row = 0;
      for (let f = 0.18; f < 0.86; f += 3 / spec.length) {
        const p = sampleAt(f, a, b);
        const offset = row % 2 ? 1.5 : 0;
        for (let across = -p.half + 1.8 + offset; across < p.half - 1.6; across += 3) {
          obstacles.push(peg(p, across + (random() - 0.5) * 0.3, 0.32, 2.2));
        }
        row += 1;
      }
    }
    if (spec.pegRow) {
      // A few pegs in the lane without the boost.
      const boostSide = spec.boosts[0].across[0] > 0 ? 1 : -1;
      for (const f of [0.35, 0.5, 0.65]) {
        const p = sampleAt(f, a, b);
        obstacles.push(peg(p, -boostSide * (2.2 + (f === 0.5 ? 1.8 : 0)), 0.32, 2.2));
      }
    }
    if (spec.bumperField) {
      const placed = [];
      let guard = 0;
      while (placed.length < 4 && guard < 200) {
        guard += 1;
        const f = 0.2 + random() * 0.6;
        const p = sampleAt(f, a, b);
        const across = (random() * 2 - 1) * (p.half - 2.6);
        const at = floorPoint(p, across);
        // Keep a marble-wide gap to the walls and to every other bumper.
        if (placed.some((q) => Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]) < 4.6)) continue;
        placed.push(at);
        obstacles.push({ ...peg(p, across, 1.0, 1.6), type: 'bumper' });
      }
    }
  }
  const random2 = random;

  function peg(p, across, radius, height) {
    const base = floorPoint(p, across);
    return { type: 'peg', base, axis: p.u, radius, height };
  }

  // Start box: marbles sit behind a gate on a gentle slope.
  emit({ name: 'start', length: 12, slope: 4 * DEG, half: 5, wall: 3.5 }, 0);
  const gateIndex = Math.round(10 / DS);

  let length = samples.length * DS;
  const target = 560 + random() * 180;
  let colour = 1;
  let last = 'start';
  const used = {};
  // How many of each feature one run may have: variety over repetition.
  const LIMIT = { spiral: 1, plunge: 2, pegs: 2, bumpers: 2, spinner: 2, funnel: 2, waves: 2, split: 2 };
  while (length < target) {
    let name = POOL[Math.floor(random() * POOL.length)];
    // Never two of the same in a row, nor more of one than its limit.
    let tries = 0;
    while ((name === last || (used[name] ?? 0) >= (LIMIT[name] ?? Infinity)) && tries < 20) {
      name = POOL[Math.floor(random() * POOL.length)];
      tries += 1;
    }
    used[name] = (used[name] ?? 0) + 1;
    last = name;
    emit(MODULES[name](random), colour % FLOOR_COLOURS.length);
    colour += 1;
    length = samples.length * DS;
  }

  // Finish straight, the line, and a run-out into a walled basin.
  emit({ name: 'finish', length: 22, slope: 7 * DEG, half: 5, wall: 3.5 }, 0);
  const finishIndex = samples.length - Math.round(8 / DS);
  emit({ name: 'runout', length: 18, slope: 3 * DEG, half: 7, wall: 4 }, 0);

  if (!validate(samples, gateIndex, finishIndex)) return null;
  return build(seed, samples, obstacles, modules, gateIndex, finishIndex);
}

/**
 * No part of the chute may pass through (or just over) another, and every
 * line down it — left edge, middle, right edge — must keep going downhill,
 * so there is nowhere a marble can come to rest.
 */
function validate(samples, from, to) {
  const floorY = (p, across) => p.y + p.r[1] * across + p.u[1] * p.lift;
  const span = 4; // three units: a marble stops in a dip, not on one flat step
  for (let i = from; i + span <= to; i += 1) {
    const a = samples[i];
    const b = samples[i + span];
    for (const side of [-1, 0, 1]) {
      if (floorY(b, side * (b.half - 0.5)) - floorY(a, side * (a.half - 0.5)) > -0.03) {
        validate.failure = `rise at sample ${i} side ${side}`;
        return false;
      }
    }
  }
  for (let i = 0; i < samples.length; i += 2) {
    const a = samples[i];
    for (let j = i + Math.round(40 / DS); j < samples.length; j += 2) {
      const b = samples[j];
      const plan = Math.hypot(a.x - b.x, a.z - b.z);
      if (plan < a.half + b.half + 3 && Math.abs(a.y - b.y) < 9) return false;
    }
  }
  return true;
}

/* ---------------------------------------------------------------- build */

function build(seed, samples, obstacles, modules, gateIndex, finishIndex) {
  // Collision triangles (flat array of 9 floats each) and render groups.
  const tris = [];
  const groups = new Map(); // key -> { positions, normals, uvs }
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, { positions: [], normals: [], uvs: [] });
    return groups.get(key);
  };

  // Each triangle is wound to face the way its normals say, so faces are
  // never culled from the side they are meant to be seen from.
  const add = (g, a, b, c, na, nb, nc, ua, ub, uc, collide = true) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const want = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (face[0] * want[0] + face[1] * want[1] + face[2] * want[2] < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
      [ub, uc] = [uc, ub];
    }
    g.positions.push(...a, ...b, ...c);
    g.normals.push(...na, ...nb, ...nc);
    g.uvs.push(...ua, ...ub, ...uc);
    if (collide) tris.push(...a, ...b, ...c);
  };
  const quad = (g, p00, p10, p11, p01, n0, n1, uv, collide = true) => {
    // p00-p10 along the first sample, p01-p11 along the next.
    add(g, p00, p10, p11, n0, n0, n1, uv[0], uv[1], uv[2], collide);
    add(g, p00, p11, p01, n0, n1, n1, uv[0], uv[2], uv[3], collide);
  };

  const edge = (p, across, up = 0) => [
    p.x + p.r[0] * across + p.u[0] * (p.lift + up),
    p.y + p.r[1] * across + p.u[1] * (p.lift + up),
    p.z + p.r[2] * across + p.u[2] * (p.lift + up),
  ];
  const neg = (v) => v.map((c) => -c);

  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    const va = a.s / 4;
    const vb = b.s / 4;
    // Floor, wound so its front face looks up.
    const floor = group(`floor:${a.colour}`);
    quad(floor, edge(a, a.half), edge(a, -a.half), edge(b, -b.half), edge(b, b.half), a.u, b.u,
      [[1, va], [0, va], [0, vb], [1, vb]]);
    // Underside, a little below, facing down (render only).
    const under = group('under');
    quad(under, edge(a, -a.half, -0.5), edge(a, a.half, -0.5), edge(b, b.half, -0.5), edge(b, -b.half, -0.5), neg(a.u), neg(b.u),
      [[0, va], [1, va], [1, vb], [0, vb]], false);
    // Walls, facing inward.
    const walls = group('wall');
    quad(walls, edge(a, -a.half), edge(a, -a.half, a.wall), edge(b, -b.half, b.wall), edge(b, -b.half), a.r, b.r,
      [[0, va], [1, va], [1, vb], [0, vb]]);
    quad(walls, edge(a, a.half, a.wall), edge(a, a.half), edge(b, b.half), edge(b, b.half, b.wall), neg(a.r), neg(b.r),
      [[1, va], [0, va], [0, vb], [1, vb]]);
    // Outer faces of the walls (render only).
    const outer = group('wallOuter');
    quad(outer, edge(a, -a.half - 0.3, a.wall), edge(a, -a.half - 0.3, -0.5), edge(b, -b.half - 0.3, -0.5), edge(b, -b.half - 0.3, b.wall), neg(a.r), neg(b.r),
      [[0, va], [1, va], [1, vb], [0, vb]], false);
    quad(outer, edge(a, a.half + 0.3, -0.5), edge(a, a.half + 0.3, a.wall), edge(b, b.half + 0.3, b.wall), edge(b, b.half + 0.3, -0.5), a.r, b.r,
      [[1, va], [0, va], [0, vb], [1, vb]], false);
    // Wall tops.
    const rim = group('rim');
    for (const side of [-1, 1]) {
      const inner = side * a.half;
      const outerA = side * (a.half + 0.3);
      quad(rim, edge(a, inner, a.wall), edge(a, outerA, a.wall), edge(b, side * (b.half + 0.3), b.wall), edge(b, side * b.half, b.wall),
        a.u, b.u, [[0, va], [1, va], [1, vb], [0, vb]], false);
    }
    // Divider down the middle of a split: two thin faces.
    if (a.divider && b.divider) {
      const div = group('wall');
      const h = 2.2;
      quad(div, edge(a, 0.15), edge(a, 0.15, h), edge(b, 0.15, h), edge(b, 0.15), a.r, b.r, [[0, va], [1, va], [1, vb], [0, vb]]);
      quad(div, edge(a, -0.15, h), edge(a, -0.15), edge(b, -0.15), edge(b, -0.15, h), neg(a.r), neg(b.r), [[1, va], [0, va], [0, vb], [1, vb]]);
      quad(group('rim'), edge(a, -0.15, h), edge(a, 0.15, h), edge(b, 0.15, h), edge(b, -0.15, h), a.u, b.u, [[0, va], [1, va], [1, vb], [0, vb]], false);
    }
  }
  // Pointed noses where each divider starts, so a marble glances off it.
  for (let i = 1; i < samples.length - 1; i += 1) {
    const a = samples[i];
    if (!a.divider || samples[i - 1].divider) continue;
    const nose = samples[Math.max(0, i - Math.round(2 / DS))];
    const tip = edge(nose, 0);
    const tipTop = edge(nose, 0, 2.2);
    const div = group('wall');
    const n1 = neg(a.r).map((v, k) => v - a.t[k]);
    const n2 = a.r.map((v, k) => v - a.t[k]);
    add(div, tip, edge(a, -0.15), edge(a, -0.15, 2.2), n1, n1, n1, [0, 0], [1, 0], [1, 1]);
    add(div, tip, edge(a, -0.15, 2.2), tipTop, n1, n1, n1, [0, 0], [1, 1], [0, 1]);
    add(div, tip, tipTop, edge(a, 0.15, 2.2), n2, n2, n2, [0, 0], [0, 1], [1, 1]);
    add(div, tip, edge(a, 0.15, 2.2), edge(a, 0.15), n2, n2, n2, [0, 0], [1, 1], [1, 0]);
  }
  // Back wall of the start box and the end wall of the basin.
  for (const [p, facing] of [[samples[0], 1], [samples[samples.length - 1], -1]]) {
    const n = p.t.map((v) => v * facing);
    const w = p.half;
    quad(group('wall'), edge(p, -w), edge(p, w), edge(p, w, p.wall), edge(p, -w, p.wall), n, n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // And its back, for looking at the track from outside.
    quad(group('wallOuter'), edge(p, -w, -0.5), edge(p, w, -0.5), edge(p, w, p.wall), edge(p, -w, p.wall), neg(n), neg(n), [[0, 0], [1, 0], [1, 1], [0, 1]], false);
  }

  // The start gate: a separate set of triangles, removed when the race starts.
  const gate = samples[gateIndex];
  const gateTris = [];
  const gw = gate.half;
  const gateCorners = [edge(gate, -gw), edge(gate, gw), edge(gate, gw, 2.5), edge(gate, -gw, 2.5)];
  gateTris.push(...gateCorners[0], ...gateCorners[1], ...gateCorners[2], ...gateCorners[0], ...gateCorners[2], ...gateCorners[3]);

  const render = {};
  for (const [key, g] of groups) {
    render[key] = {
      positions: new Float32Array(g.positions),
      normals: new Float32Array(g.normals),
      uvs: new Float32Array(g.uvs),
    };
  }

  const bounds = samples.reduce((m, p) => ({
    minX: Math.min(m.minX, p.x), maxX: Math.max(m.maxX, p.x),
    minY: Math.min(m.minY, p.y), maxY: Math.max(m.maxY, p.y),
    minZ: Math.min(m.minZ, p.z), maxZ: Math.max(m.maxZ, p.z),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });

  return {
    seed,
    samples,
    spacing: DS,
    modules,
    obstacles,
    triangles: new Float32Array(tris),
    gate: { index: gateIndex, triangles: new Float32Array(gateTris), corners: gateCorners },
    finishIndex,
    length: finishIndex * DS,
    render,
    bounds,
  };
}

/** A new track for `seed`. Retries internally until one does not overlap itself. */
export function generateTrack(seed) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const track = tryGenerate((seed * 7919 + attempt * 104729) >>> 0);
    if (track) return track;
  }
  throw new Error('could not lay out a track');
}
