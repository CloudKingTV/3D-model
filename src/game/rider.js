/**
 * Board physics in three dimensions, the trick state machine and scoring.
 *
 * Pure: no three.js and no DOM, so a whole session can be simulated in a
 * test. The renderer reads the state and poses the board from it.
 *
 * The board is a rigid plank on four wheels. On the ground it rests on the
 * lowest plane that clears every wheel, its belly and its nose and tail, and
 * steers like a skateboard: it rolls where it points, and a slope across it
 * carves it downhill. Anything that rises faster than a slope can (a ledge
 * side, a rail, a step) is a face, and faces are walls — you bump off them at
 * an angle and slam into them head on. In the air the path is swept in short
 * pieces, so nothing is fast enough to pass through anything.
 */

import { TABLE, FLOOR_Y } from './park.js';

const TAU = Math.PI * 2;

export const PHYSICS = {
  gravity: 300, // units/s^2 (1 unit = 10mm); floaty on purpose, it is a game
  slopeGravity: 0.8, // share of gravity felt along a ramp
  pushAccel: 120,
  pushSpeed: 74, // pushing tops out here; ramps can take you faster
  cruiseSpeed: 46, // auto-push keeps you rolling at this on the flat
  brake: 150,
  rollingFriction: 0.1, // fraction of speed lost per second
  maxSpeed: 125,
  turnRate: 2.8, // rad/s at rolling speed
  basePop: 50,
  maxPop: 74,
  chargeTime: 0.4, // seconds of hold for a full-power ollie
  lateOllie: 0.12, // seconds after rolling off a lip that a pop still counts
  spinRate: TAU / 0.8, // a 360 takes 0.8s
  landTolerance: 0.6, // radians of sloppiness allowed on a landing
  vertSlope: 1.3, // leaving a surface steeper than this launches straight up
  slamSpeed: 42, // speed into a face that bails instead of bouncing
  airSlamSpeed: 30,
  bailTime: 1.4,
  grindSnap: 1.35, // plan distance from a grind line that still locks on
  grindFriction: 7,
  grindPointsPerSecond: 150,
  comboTimeout: 3,
  maxTricksPerAir: 4,
  letterRadius: 3.4,
};

// `time` is how long the board takes to go round. Every trick fits inside
// the air of a flat-ground ollie from the trick buttons (about 0.44s).
export const TRICKS = {
  kickflip: { name: 'Kickflip', roll: -TAU, yaw: 0, points: 120, time: 0.32 },
  heelflip: { name: 'Heelflip', roll: TAU, yaw: 0, points: 120, time: 0.32 },
  shuvit: { name: 'Pop Shuv', roll: 0, yaw: -Math.PI, points: 90, time: 0.26 },
  treflip: { name: '360 Flip', roll: -TAU, yaw: -TAU, points: 300, time: 0.38 },
};

const COMBO_NAMES = [
  { has: ['kickflip', 'shuvit'], name: 'Varial Flip' },
  { has: ['heelflip', 'shuvit'], name: 'Varial Heel' },
  { has: ['kickflip', 'heelflip'], name: 'Flip Combo' },
];

const REPEATS = ['', 'Double', 'Triple', 'Quad'];

export function nameTricks(ids) {
  if (ids.length === 0) return 'Ollie';
  if (ids.every((id) => id === ids[0])) {
    return `${REPEATS[ids.length - 1] ?? `${ids.length}x`} ${TRICKS[ids[0]].name}`.trim();
  }
  for (const combo of COMBO_NAMES) {
    if (ids.length === combo.has.length && combo.has.every((id) => ids.includes(id))) return combo.name;
  }
  return ids.map((id) => TRICKS[id].name).join(' + ');
}

const SPIN_POINTS = [0, 100, 250, 450, 700, 1000];

/** 180s completed, from the total body rotation in the air. */
export function spinHalves(radians) {
  return Math.floor((Math.abs(radians) + 0.45) / Math.PI);
}

/* -------------------------------------------------------------- helpers */

function wrap(angle) {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Distance from `angle` to the nearest multiple of `step`. */
function offGrid(angle, step) {
  const r = ((angle % step) + step) % step;
  return Math.min(r, step - r);
}

function nearestMultiple(angle, step) {
  return Math.round(angle / step) * step;
}

export function createRider({
  wheelbase = 2.6,
  length = 9.6,
  width = 3.0,
  wheelZ = 1.24,
  height = 1.5,
  noseLift = 1.8,
} = {}) {
  return {
    halfBase: wheelbase,
    halfLength: length / 2,
    halfWidth: width / 2,
    wheelZ,
    height, // wheel contact up to the deck top
    noseLift,
    belly: 0.9, // deck underside between the trucks, above the wheel line

    x: 0,
    y: 0,
    z: 0,
    heading: 0, // direction of travel; forward is (cos, sin) in x/z
    speed: 0, // along the ground or the rail
    vel: { x: 0, y: 0, z: 0 }, // in the air
    grad: { x: 0, z: 0 }, // slope of the surface under the board
    state: 'ground', // ground | air | grind | bail

    bodyYaw: 0, // board facing relative to travel: 0 regular, PI fakie, plus air spin
    shuv: 0,
    shuvTarget: 0,
    flip: 0,
    flipTarget: 0,
    charge: 0,
    popped: false,
    airTime: 0,
    spinTotal: 0,
    tricksThisAir: [],
    fromGrind: false,

    grind: null, // { line, t, sign, style }
    grindTime: 0,

    combo: 0,
    multiplier: 1,
    comboTimer: 0,
    score: 0,
    letters: [],

    bailTimer: 0,
    bailRoll: 0,
    bailSpin: 0,
    bailVel: { x: 0, z: 0 },
    bailVy: 0,
    ollieWasHeld: false,
  };
}

/** Put the rider at the park's start, stood still. */
export function placeAtSpawn(s, park) {
  s.x = park.spawn.x;
  s.z = park.spawn.z;
  s.heading = park.spawn.heading;
  s.speed = 0;
  const support = restingSupport(s, park, s.x, s.z, s.heading, 0);
  s.y = support.y;
  s.grad = { x: support.gx, z: support.gz };
  s.state = 'ground';
  s.bodyYaw = 0;
  resetTricks(s);
}

function resetTricks(s) {
  s.shuv = 0;
  s.shuvTarget = 0;
  s.flip = 0;
  s.flipTarget = 0;
  s.charge = 0;
  s.popped = false;
  s.airTime = 0;
  s.spinTotal = 0;
  s.tricksThisAir = [];
  s.fromGrind = false;
  s.grind = null;
}

/**
 * Every point on the board that can touch something, in the board's plan
 * frame (a forward, b to the right) with its height above the wheel line.
 * Rows run across the trucks, the belly and the tips at under 0.7 spacing, so
 * even a rail — 0.84 across — cannot slip between two of them.
 */
function contactPoints(s, squash) {
  const hb = s.halfBase * squash;
  const tip = s.halfLength * squash;
  const wz = s.wheelZ;
  const half = wz / 2;
  const hanger = 0.45; // axle and hanger, above the bottom of the wheels
  const points = [
    // The four wheels first: the resting plane is fitted to these.
    { a: hb, b: -wz, lift: 0 },
    { a: hb, b: wz, lift: 0 },
    { a: -hb, b: -wz, lift: 0 },
    { a: -hb, b: wz, lift: 0 },
  ];
  for (const a of [hb, -hb]) {
    for (const b of [-half, 0, half]) points.push({ a, b, lift: hanger });
  }
  for (const a of [hb / 2, 0, -hb / 2]) {
    for (const b of [-s.halfWidth, -half, 0, half, s.halfWidth]) points.push({ a, b, lift: s.belly });
  }
  for (const a of [tip, -tip]) {
    for (const b of [-0.6, 0, 0.6]) points.push({ a, b, lift: s.noseLift });
  }
  return points;
}

/**
 * The lowest straight line, evaluated at 0, that no point rises above: the
 * upper hull of the points, directly over the board's centre of mass. When
 * a hull vertex sits right over the centre, either neighbouring edge will do,
 * so take the slope closest to `hint` — the board's current tilt.
 */
function lowestLine(points, hint) {
  let best = null;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = 0; j < points.length; j += 1) {
      const p = points[i];
      const q = points[j];
      if (!(p.a < q.a) || p.a > 0 || q.a < 0) continue;
      const slope = (q.v - p.v) / (q.a - p.a);
      const y = p.v - slope * p.a;
      let valid = true;
      for (const r of points) {
        if (r.v > y + slope * r.a + 1e-6) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      if (!best || y < best.y - 1e-4
        || (Math.abs(y - best.y) <= 1e-4 && Math.abs(slope - hint) < Math.abs(best.slope - hint))) {
        best = { y, slope };
      }
    }
  }
  return best ?? { y: Math.max(...points.map((p) => p.v)), slope: 0 };
}

/**
 * Where the board rests if set down at (x, z) pointing along `heading`.
 *
 * A rigid plank settles where its centre of mass is held up: over flat
 * ground on its wheels, over a transition on the wheels either side, over a
 * lip on its belly, and with its front wheels past an edge it stays level on
 * the back wheels and belly until the middle goes over. That is the upper
 * hull of every contact point, found along the board and then across it.
 * `pitch` spaces the samples the way a board tilted that far would, so on a
 * steep transition the wheels are sampled where they really are.
 */
export function supportAt(s, park, x, z, heading, pitch) {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const points = contactPoints(s, Math.max(0.3, Math.cos(pitch)));
  const needs = points.map((p) => park.heightAt(x + fx * p.a - fz * p.b, z + fz * p.a + fx * p.b) - p.lift);

  // Along the board: the highest need in each cross-row.
  const rows = new Map();
  points.forEach((p, i) => rows.set(p.a, Math.max(rows.get(p.a) ?? -Infinity, needs[i])));
  const lengthwise = lowestLine([...rows].map(([a, v]) => ({ a, v })), Math.tan(pitch));

  // Across it, with the lengthwise tilt taken out.
  const columns = new Map();
  points.forEach((p, i) => {
    const v = needs[i] - lengthwise.slope * p.a;
    columns.set(p.b, Math.max(columns.get(p.b) ?? -Infinity, v));
  });
  const sideways = lowestLine([...columns].map(([a, v]) => ({ a, v })), 0);

  const along = lengthwise.slope;
  const across = sideways.slope;
  // The two passes are separate, so make certain nothing is left below.
  let y = sideways.y;
  points.forEach((p, i) => {
    const need = needs[i] - along * p.a - across * p.b;
    if (need > y) y = need;
  });

  return {
    y,
    along,
    across,
    gx: along * fx - across * fz,
    gz: along * fz + across * fx,
  };
}

/**
 * `supportAt` for a board actually resting there: the footprint depends on
 * the pitch and the pitch on the footprint, so settle the two together.
 */
export function restingSupport(s, park, x, z, heading, pitchGuess = 0) {
  let pitch = pitchGuess;
  let support = supportAt(s, park, x, z, heading, pitch);
  let highest = support;
  for (let i = 0; i < 4; i += 1) {
    const next = Math.atan(support.along);
    if (Math.abs(next - pitch) < 0.005) {
      highest = support;
      break;
    }
    pitch = next;
    support = supportAt(s, park, x, z, heading, pitch);
    // Near an edge the pitch can flip between two answers (tilted, the
    // board is shorter in plan and misses the edge). Take the higher one.
    if (support.y > highest.y) highest = support;
  }
  // Whatever was chosen, hold it exactly as posed and make sure it is clear.
  const depth = poseDepth(s, park, x, z, highest.y, heading, highest.along, highest.across);
  return depth > 0 ? { ...highest, y: highest.y + depth } : highest;
}

/**
 * How far the board, held exactly in this pose, is into whatever is under
 * it: positive means some contact point is below the surface. The air uses
 * this rather than the resting support, because a board in flight cannot
 * tilt itself to fit round the edge of the thing it is about to hit.
 */
export function poseDepth(s, park, x, z, y, heading, along, across) {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  let depth = -Infinity;
  for (const p of contactPoints(s, Math.max(0.3, Math.cos(Math.atan(along))))) {
    const h = park.heightAt(x + fx * p.a - fz * p.b, z + fz * p.a + fx * p.b);
    const d = h - p.lift - (y + along * p.a + across * p.b);
    if (d > depth) depth = d;
  }
  return depth;
}

/** The board's slope along and across a facing, from the surface gradient. */
function slopesFor(s, facing) {
  return {
    along: s.grad.x * Math.cos(facing) + s.grad.z * Math.sin(facing),
    across: -s.grad.x * Math.sin(facing) + s.grad.z * Math.cos(facing),
  };
}

/**
 * True when the board would sit cleanly at (x, z): every contact point is on
 * one continuous surface, not straddling an edge or half inside something.
 */
function cleanSpot(s, park, x, z, heading) {
  const support = restingSupport(s, park, x, z, heading, 0);
  if (!Number.isFinite(support.y) || support.y < -1) return false;
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const points = contactPoints(s, Math.max(0.3, Math.cos(Math.atan(support.along))));
  let top = -Infinity;
  let bottom = Infinity;
  for (const p of points) {
    const h = park.heightAt(x + fx * p.a - fz * p.b, z + fz * p.a + fx * p.b);
    const plane = support.y + support.along * p.a + support.across * p.b;
    top = Math.max(top, h - plane);
    bottom = Math.min(bottom, h - plane);
  }
  return top - bottom < 0.8 && Math.abs(support.across) < 0.6;
}

/** The first face any probe runs into moving the board between two poses. */
function sweepFaces(s, park, from, to, heading, along, across) {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const sx = -fz;
  const sz = fx;
  const pitch = Math.atan(along);
  for (const p of contactPoints(s, Math.max(0.3, Math.cos(pitch)))) {
    const ox = fx * p.a + sx * p.b;
    const oz = fz * p.a + sz * p.b;
    const rise = along * p.a + across * p.b + p.lift;
    const face = park.faceBetween(
      from.x + ox, from.z + oz, from.y + rise,
      to.x + ox, to.z + oz, to.y + rise,
    );
    if (face) return face;
  }
  return null;
}

function nameOf(item) {
  return item?.name ?? 'wall';
}

/* ---------------------------------------------------------------- step */

/**
 * Advance the rider by `dt`.
 * input: { steer: -1..1 (right +), throttle: -1..1, ollie: bool held, tricks: [ids] }
 * Returns the events that happened this step, for sound, effects and pop-ups.
 */
export function stepRider(s, dt, park, input = {}) {
  const events = [];
  const steer = Math.max(-1, Math.min(1, input.steer ?? 0));
  const throttle = Math.max(-1, Math.min(1, input.throttle ?? 0));
  const ollie = !!input.ollie;
  const released = s.ollieWasHeld && !ollie;
  s.ollieWasHeld = ollie;
  const tricks = input.tricks ?? [];

  if (s.state === 'bail') {
    stepBail(s, dt, park, events);
    return events;
  }

  // Combos end if you just roll around.
  if (s.state === 'ground' && s.combo > 0) {
    s.comboTimer -= dt;
    if (s.comboTimer <= 0) {
      events.push({ type: 'comboEnd', combo: s.combo, multiplier: s.multiplier });
      s.combo = 0;
      s.multiplier = 1;
    }
  }

  if (s.state === 'ground' || s.state === 'grind') {
    if (ollie) s.charge = Math.min(1, s.charge + dt / PHYSICS.chargeTime);
    // A trick pressed on the ground is an ollie and that trick, straight away.
    const wantsTrick = tricks.length > 0;
    if (released || wantsTrick) {
      popOff(s, park, events, wantsTrick ? Math.max(s.charge, 0.7) : s.charge);
      if (s.state === 'bail') return events;
    }
  }

  if (s.state === 'air') {
    // Late pop: rolling off a lip with the button still down still counts.
    if (released && !s.popped && s.airTime < PHYSICS.lateOllie) {
      s.vel.y = popped(s.vel.y, popPower(s.charge));
      s.popped = true;
      s.charge = 0;
      events.push({ type: 'pop' });
    }
    for (const id of tricks) startTrick(s, id);
  }

  const assists = { autoPush: !!input.autoPush, spinAssist: !!input.spinAssist };
  if (s.state === 'ground') stepGround(s, dt, park, steer, throttle, events, assists);
  else if (s.state === 'grind') stepGrind(s, dt, events);
  else if (s.state === 'air') stepAir(s, dt, park, steer, events, assists);

  if (s.state !== 'bail') collectLetters(s, park, events);
  if (s.state !== 'air') animateTricks(s, dt);
  return events;
}

function popPower(charge) {
  return PHYSICS.basePop + (PHYSICS.maxPop - PHYSICS.basePop) * charge;
}

/**
 * Vertical speed after popping while already moving up at `up`. Snapping
 * the tail on a kicker lip helps, but it does not stack a whole flat-ground
 * ollie on top of the ramp's own launch.
 */
function popped(up, power) {
  const rising = Math.max(0, up);
  return up + power * (1 - 0.45 * Math.min(1, rising / 40));
}

function popOff(s, park, events, charge) {
  const power = popPower(charge);
  if (s.state === 'grind') {
    const { line, sign } = s.grind;
    const along = s.speed * sign;
    // Hop off to the side that is lower, so you land beside a ledge rather
    // than straddling its edge.
    const side = sideAwayFrom(line, park);
    s.vel = {
      x: line.dir.x * along + side.x * 11,
      y: line.dir.y * along + power * 0.85,
      z: line.dir.z * along + side.z * 11,
    };
    s.fromGrind = true;
    s.grind = null;
    events.push({ type: 'grindEnd' });
  } else {
    const pitch = Math.atan(s.grad.x * Math.cos(s.heading) + s.grad.z * Math.sin(s.heading));
    const horizontal = s.speed * Math.cos(pitch);
    s.vel = {
      x: Math.cos(s.heading) * horizontal,
      y: popped(s.speed * Math.sin(pitch), power),
      z: Math.sin(s.heading) * horizontal,
    };
    if (Math.tan(pitch) > PHYSICS.vertSlope) vertLaunch(s);
  }
  s.state = 'air';
  s.airTime = 0;
  s.popped = true;
  s.charge = 0;
  s.spinTotal = 0;
  s.tricksThisAir = [];
  events.push({ type: 'pop' });
}

/** Unit plan vector off a grind line toward the lower ground beside it. */
function sideAwayFrom(line, park) {
  const nx = -line.dir.z;
  const nz = line.dir.x;
  const length = Math.hypot(nx, nz) || 1;
  const mx = (line.a.x + line.b.x) / 2;
  const mz = (line.a.z + line.b.z) / 2;
  const left = park.heightAt(mx - (nx / length) * 2.5, mz - (nz / length) * 2.5);
  const right = park.heightAt(mx + (nx / length) * 2.5, mz + (nz / length) * 2.5);
  const sign = right <= left ? 1 : -1;
  return { x: (nx / length) * sign, z: (nz / length) * sign };
}

/**
 * Leaving a near-vertical face: go straight up and come back down into the
 * ramp, instead of flying over the deck. Keeps any speed along the lip, so a
 * carved air still travels.
 */
function vertLaunch(s) {
  const g = Math.hypot(s.grad.x, s.grad.z);
  if (g < 1e-6) return;
  const ux = s.grad.x / g;
  const uz = s.grad.z / g;
  const into = s.vel.x * ux + s.vel.z * uz;
  s.vel.x += -into * ux - ux * 3;
  s.vel.z += -into * uz - uz * 3;
  s.vert = true;
}

function startTrick(s, id) {
  const trick = TRICKS[id];
  if (!trick || s.tricksThisAir.length >= PHYSICS.maxTricksPerAir) return;
  // One trick per axis at a time, but a flip and a shuv together is a varial.
  if (trick.roll && Math.abs(s.flipTarget - s.flip) > 0.9) return;
  if (trick.yaw && Math.abs(s.shuvTarget - s.shuv) > 0.9) return;
  s.flipTarget += trick.roll;
  s.shuvTarget += trick.yaw;
  if (trick.roll) s.flipRate = Math.abs(trick.roll) / trick.time;
  if (trick.yaw) s.shuvRate = Math.abs(trick.yaw) / trick.time;
  s.tricksThisAir.push(id);
  if (s.tricksThisAir.length === 1 && s.charge > 0) s.charge = 0;
}

function animateTricks(s, dt) {
  const toward = (value, target, rate) => {
    const d = target - value;
    const step = rate * dt;
    return Math.abs(d) <= step ? target : value + Math.sign(d) * step;
  };
  s.flip = toward(s.flip, s.flipTarget, s.flipRate ?? TAU / 0.32);
  s.shuv = toward(s.shuv, s.shuvTarget, s.shuvRate ?? Math.PI / 0.26);
}

/* -------------------------------------------------------------- ground */

function stepGround(s, dt, park, steer, throttle, events, assists = {}) {
  const support = restingSupport(s, park, s.x, s.z, s.heading, Math.atan(slopeAlong(s)));
  const along = support.along;
  const across = support.across;

  // Steering, and a slope across the board carves it downhill. A stopped
  // board still pivots, just slowly — but never swings its nose into a wall.
  const g = PHYSICS.gravity * PHYSICS.slopeGravity;
  const grip = Math.max(0.35, Math.min(1, s.speed / 18));
  const lateral = -g * (across / Math.sqrt(1 + across * across));
  const turn = steer * PHYSICS.turnRate * grip * dt + (lateral / Math.max(Math.abs(s.speed), 12)) * dt;
  if (turn && !turnBlocked(s, park, s.heading, s.heading + turn, along, across)) {
    s.heading = wrap(s.heading + turn);
  }

  // Gravity along the slope.
  s.speed -= g * (along / Math.sqrt(1 + along * along)) * dt;

  if (throttle > 0 && s.speed < PHYSICS.pushSpeed) {
    s.speed = Math.min(PHYSICS.pushSpeed, s.speed + PHYSICS.pushAccel * throttle * dt);
  } else if (throttle < 0) {
    s.speed = Math.max(Math.min(s.speed, 0), s.speed + PHYSICS.brake * throttle * dt);
  } else if (throttle === 0 && assists.autoPush && Math.abs(along) < 0.15 && s.speed < PHYSICS.cruiseSpeed) {
    // Auto-push: on the flat the rider keeps pushing to a steady roll, so a
    // thumb on a phone is free for tricks instead of holding the stick up.
    s.speed = Math.min(PHYSICS.cruiseSpeed, s.speed + PHYSICS.pushAccel * 0.55 * dt);
  }
  s.speed -= s.speed * PHYSICS.rollingFriction * dt;
  s.speed = Math.min(PHYSICS.maxSpeed, s.speed);

  // Rolling backwards is just riding fakie: turn the direction of travel
  // round and leave the board where it is.
  if (s.speed < 0) {
    s.heading = wrap(s.heading + Math.PI);
    s.bodyYaw = wrap(s.bodyYaw + Math.PI);
    s.speed = -s.speed;
  }

  const pitch = Math.atan(along);
  const distance = s.speed * Math.cos(pitch) * dt;
  const pieces = Math.max(1, Math.ceil(distance / 0.25));
  const piece = distance / pieces;
  let current = support;
  s.y = support.y;

  for (let i = 0; i < pieces; i += 1) {
    const fx = Math.cos(s.heading);
    const fz = Math.sin(s.heading);
    const to = { x: s.x + fx * piece, z: s.z + fz * piece };
    const predicted = s.y + current.along * piece;

    const face = sweepFaces(s, park, { x: s.x, z: s.z, y: s.y }, { ...to, y: predicted }, s.heading, current.along, current.across);
    if (face) {
      hitFace(s, face, events, false, park, current);
      return;
    }

    const next = restingSupport(s, park, to.x, to.z, s.heading, Math.atan(current.along));

    // The ground fell away faster than the line we were riding, or curves
    // away over a lip faster than gravity can hold the board to it: take off.
    const bend = Math.atan(current.along) - Math.atan(next.along);
    const surfaceStep = piece * Math.sqrt(1 + current.along * current.along);
    const flung = bend > 0.02 && s.speed * s.speed * (bend / surfaceStep) > PHYSICS.gravity * Math.cos(Math.atan(next.along)) * 1.2;
    if (predicted - next.y > 0.35 || flung) {
      s.x = to.x;
      s.z = to.z;
      s.grad = { x: current.gx, z: current.gz };
      s.y = Math.max(predicted, next.y);
      // Leave with the tilt it left from, clear of whatever it left.
      const overlap = poseDepth(s, park, s.x, s.z, s.y, s.heading, current.along, current.across);
      if (overlap > 0) s.y += overlap;
      leaveGround(s, current.along);
      return;
    }
    // Rising faster than a slope ever does, but missed by the face sweep.
    if (next.y - predicted > 0.9) {
      const normal = park.faceNormal(to.x, to.z, fx, fz);
      hitFace(s, { normal, item: park.itemAt(to.x, to.z) }, events, false, park, current);
      return;
    }

    s.x = to.x;
    s.z = to.z;
    s.y = next.y;
    current = next;
  }

  s.grad = { x: current.gx, z: current.gz };
  if (s.x < -TABLE.halfX || s.x > TABLE.halfX || s.z < -TABLE.halfZ || s.z > TABLE.halfZ) {
    leaveGround(s, 0);
  }
}

/** A face that some part of the board would swing into turning in place. */
function turnBlocked(s, park, from, to, along, across) {
  const points = contactPoints(s, Math.max(0.3, Math.cos(Math.atan(along))));
  for (const p of points) {
    const rise = s.y + along * p.a + across * p.b + p.lift;
    const x0 = s.x + Math.cos(from) * p.a - Math.sin(from) * p.b;
    const z0 = s.z + Math.sin(from) * p.a + Math.cos(from) * p.b;
    const x1 = s.x + Math.cos(to) * p.a - Math.sin(to) * p.b;
    const z1 = s.z + Math.sin(to) * p.a + Math.cos(to) * p.b;
    if (park.faceBetween(x0, z0, rise, x1, z1, rise)) return true;
  }
  return false;
}

function slopeAlong(s) {
  return s.grad.x * Math.cos(s.heading) + s.grad.z * Math.sin(s.heading);
}

function leaveGround(s, along) {
  const pitch = Math.atan(along);
  const horizontal = s.speed * Math.cos(pitch);
  s.vel = {
    x: Math.cos(s.heading) * horizontal,
    y: s.speed * Math.sin(pitch),
    z: Math.sin(s.heading) * horizontal,
  };
  s.vert = false;
  if (along > PHYSICS.vertSlope) vertLaunch(s);
  s.state = 'air';
  s.airTime = 0;
  s.popped = false;
  s.spinTotal = 0;
  s.tricksThisAir = [];
}

/**
 * Hit a wall: glance off it, or slam into it if you ran at it square and fast.
 * On the ground `speed` is along the heading; in the air it is `vel`.
 */
function hitFace(s, face, events, airborne, park = null, surface = null) {
  const n = face.normal;
  const vx = airborne ? s.vel.x : Math.cos(s.heading) * s.speed;
  const vz = airborne ? s.vel.z : Math.sin(s.heading) * s.speed;
  const into = vx * n.x + vz * n.z; // negative: moving into the face
  const planSpeed = Math.hypot(vx, vz);
  const square = planSpeed > 1e-6 ? -into / planSpeed : 0;

  if (-into > (airborne ? PHYSICS.airSlamSpeed : PHYSICS.slamSpeed) && square > 0.6) {
    bail(s, events, `Slammed into the ${nameOf(face.item)}`, {
      x: n.x * Math.min(18, -into * 0.3),
      z: n.z * Math.min(18, -into * 0.3),
    }, park);
    return;
  }

  // Take out the motion into the face, with a little bounce, and scrub speed.
  const bounce = 1.25;
  const rx = (vx - bounce * into * n.x) * 0.85;
  const rz = (vz - bounce * into * n.z) * 0.85;
  events.push({ type: 'bump', strength: Math.min(1, -into / 40) });

  if (airborne) {
    s.vel.x = rx;
    s.vel.z = rz;
    return;
  }
  let speed = Math.hypot(rx, rz);
  let heading = Math.atan2(rz, rx);
  // The board can only swing to the new line if nothing is in the way of
  // its nose and tail; wedged in a corner it rolls straight back instead.
  const axisTurn = wrap(2 * (heading - s.heading)) / 2;
  if (!airborne && park && surface && turnBlocked(s, park, s.heading, s.heading + axisTurn, surface.along, surface.across)) {
    const alongAxis = rx * Math.cos(s.heading) + rz * Math.sin(s.heading);
    heading = alongAxis >= 0 ? s.heading : s.heading + Math.PI;
    speed = Math.abs(alongAxis);
  }
  // A near head-on bounce sends you back the way you came: that is riding
  // fakie, so the board keeps facing the wall rather than spinning round.
  const turned = Math.abs(wrap(heading - s.heading));
  if (turned > Math.PI / 2) s.bodyYaw = wrap(s.bodyYaw + Math.PI);
  s.heading = wrap(heading);
  s.speed = speed;
  // Turned on a slope, the board settles differently: settle it.
  if (park && surface) {
    const rest = restingSupport(s, park, s.x, s.z, s.heading, Math.atan(surface.along));
    s.y = rest.y;
    s.grad = { x: rest.gx, z: rest.gz };
  }
}

/* ----------------------------------------------------------------- air */

function stepAir(s, dt, park, steer, events, assists = {}) {
  s.airTime += dt;
  let spin = steer * PHYSICS.spinRate * dt;
  // Spin assist: let go of the turn and the board settles to the nearest
  // half-turn, the way a rider finishes a spin — so a slightly short 180
  // still lands as a 180 instead of sideways.
  if (assists.spinAssist && Math.abs(steer) < 0.15 && s.airTime > 0.08) {
    const off = nearestMultiple(s.bodyYaw, Math.PI) - s.bodyYaw;
    spin += off * Math.min(1, dt * 8);
  }
  const shuvBefore = s.shuv;
  s.bodyYaw += spin;
  s.spinTotal += spin;
  animateTricks(s, dt);
  s.vel.y -= PHYSICS.gravity * dt;

  // Level out toward whatever is underneath: flat ground levels the board,
  // a transition below keeps it lined up to come back in.
  const below = supportAt(s, park, s.x, s.z, s.heading, 0);
  const ease = Math.min(1, dt * 5);
  const gradBefore = { ...s.grad };
  s.grad.x += (below.gx - s.grad.x) * ease;
  s.grad.z += (below.gz - s.grad.z) * ease;

  // Turning or tilting in the air must not swing the nose or tail into
  // something beside you: brush against it and the board is nudged clear,
  // run it in deeper and the turn simply stops.
  const facingNow = s.heading + s.bodyYaw + s.shuv;
  const pose = slopesFor(s, facingNow);
  const overlap = poseDepth(s, park, s.x, s.z, s.y, facingNow, pose.along, pose.across);
  if (overlap > 0) {
    if (overlap <= 0.5) {
      s.y += overlap;
    } else {
      s.bodyYaw -= spin;
      s.spinTotal -= spin;
      s.shuv = shuvBefore;
      s.grad = gradBefore;
    }
  }

  const move = Math.hypot(s.vel.x, s.vel.y, s.vel.z) * dt;
  const pieces = Math.min(16, Math.max(1, Math.ceil(move / 0.25)));
  for (let i = 0; i < pieces; i += 1) {
    const from = { x: s.x, y: s.y, z: s.z };
    const to = {
      x: s.x + (s.vel.x * dt) / pieces,
      y: s.y + (s.vel.y * dt) / pieces,
      z: s.z + (s.vel.z * dt) / pieces,
    };

    const line = findGrind(s, park, from, to);
    if (line) {
      startGrind(s, line, to, events);
      return;
    }

    const facing = s.heading + s.bodyYaw + s.shuv;
    const { along, across } = slopesFor(s, facing);
    const depth = poseDepth(s, park, to.x, to.z, to.y, facing, along, across);
    if (depth > 0) {
      // Touching down with a rail or an edge under the board is a grind,
      // even if the tail met a down-rail before the middle reached it.
      const grind = findGrind(s, park, from, to, 1.6);
      if (grind) {
        startGrind(s, grind, to, events);
        return;
      }
      // Some part of the board went into the side of something rather than
      // down onto its top: that is a wall.
      const face = sweepFaces(s, park, from, to, facing, along, across);
      if (face) {
        hitFace(s, face, events, true, park);
        if (s.state === 'bail') return;
        continue;
      }
      // Coming down onto it — or rising more slowly than it does.
      const support = restingSupport(s, park, to.x, to.z, s.heading, Math.atan(slopeAlong(s)));
      const planSpeed = s.vel.x * Math.cos(s.heading) + s.vel.z * Math.sin(s.heading);
      if (s.vel.y <= planSpeed * support.along + 1) {
        s.x = to.x;
        s.y = to.y;
        s.z = to.z;
        land(s, park, support, events);
        return;
      }
      // Rising faster than the surface: ride up over its edge.
      to.y += depth;
    }
    s.x = to.x;
    s.y = to.y;
    s.z = to.z;
  }

  // Off the edge of the table and on the way to the floor.
  if (s.state === 'air' && s.y < FLOOR_Y + 63) {
    bail(s, events, 'Fell off the table', { x: 0, z: 0 }, park);
  }
}

/** A grind line the board has just come down onto, lined up to grind it. */
function findGrind(s, park, from, to, slack = 0.1) {
  if (to.y > from.y + 0.02) return null; // only on the way down
  if (Math.abs(s.flipTarget - s.flip) > PHYSICS.landTolerance) return null;

  let best = null;
  let bestDistance = PHYSICS.grindSnap;
  for (const line of park.grindLines) {
    const dx = line.b.x - line.a.x;
    const dz = line.b.z - line.a.z;
    const t = ((to.x - line.a.x) * dx + (to.z - line.a.z) * dz) / (line.planLength * line.planLength);
    if (t < 0.02 || t > 0.98) continue;
    const px = line.a.x + dx * t;
    const pz = line.a.z + dz * t;
    const distance = Math.hypot(to.x - px, to.z - pz);
    if (distance > bestDistance) continue;
    const y = line.a.y + (line.b.y - line.a.y) * t;
    if (from.y < y - 0.15 || to.y > y + slack || to.y < y - 1.5) continue;

    const along = s.vel.x * line.dir.x + s.vel.y * line.dir.y + s.vel.z * line.dir.z;
    if (Math.abs(along) < 8) continue;

    const style = grindStyle(s, line);
    if (!style) continue;
    best = { line, t, along, style, x: px, y, z: pz };
    bestDistance = distance;
  }
  return best;
}

/** 50-50 with the board along the line, boardslide across it, else nothing. */
function grindStyle(s, line) {
  const facing = s.heading + s.bodyYaw + s.shuvTarget;
  const lineAngle = Math.atan2(line.dir.z, line.dir.x);
  const off = offGrid(facing - lineAngle, Math.PI); // 0..PI/2
  if (off < 0.6) return line.kind === 'coping' ? 'Coping Grind' : '50-50';
  if (off > 0.95 && line.kind !== 'coping') return line.kind === 'rail' ? 'Boardslide' : 'Lipslide';
  return null;
}

function startGrind(s, hit, to, events) {
  const { line, t, along, style } = hit;
  const sign = Math.sign(along) || 1;
  const facingBefore = s.heading + s.bodyYaw + s.shuvTarget;

  // Air tricks into a grind count as a landing.
  scoreAir(s, events, { intoGrind: true });

  s.state = 'grind';
  s.grind = { line, t, sign, style };
  s.grindTime = 0;
  s.speed = Math.max(16, Math.abs(along));
  s.x = hit.x;
  s.y = hit.y;
  s.z = hit.z;
  s.heading = Math.atan2(line.dir.z * sign, line.dir.x * sign);
  const lineSlope = line.dir.y / Math.max(1e-6, Math.hypot(line.dir.x, line.dir.z));
  s.grad = { x: (line.dir.x / Math.hypot(line.dir.x, line.dir.z)) * lineSlope, z: (line.dir.z / Math.hypot(line.dir.x, line.dir.z)) * lineSlope };

  // Keep the board facing as it came in, snapped to the grind's angle.
  const step = style === 'Boardslide' || style === 'Lipslide' ? Math.PI / 2 : Math.PI;
  const offset = style === 'Boardslide' || style === 'Lipslide'
    ? nearestOdd(facingBefore - s.heading)
    : nearestMultiple(wrap(facingBefore - s.heading), step);
  s.bodyYaw = wrap(offset);
  s.shuv = 0;
  s.shuvTarget = 0;
  s.flip = 0;
  s.flipTarget = 0;
  s.charge = 0;
  s.vert = false;
  s.comboTimer = PHYSICS.comboTimeout;
  events.push({ type: 'grindStart', style, kind: line.kind, name: line.name });
}

/** Nearest odd multiple of PI/2: the board square across the line. */
function nearestOdd(angle) {
  const k = Math.round((wrap(angle) - Math.PI / 2) / Math.PI);
  return Math.PI / 2 + k * Math.PI;
}

/* --------------------------------------------------------------- grind */

function stepGrind(s, dt, events) {
  const { line } = s.grind;
  const drop = line.dir.y * s.grind.sign; // rise per unit travelled
  s.speed -= PHYSICS.gravity * PHYSICS.slopeGravity * drop * dt;
  s.speed -= PHYSICS.grindFriction * dt;
  s.grind.t += (s.grind.sign * s.speed * dt) / line.length;
  s.grindTime += dt;

  const points = PHYSICS.grindPointsPerSecond * dt * s.multiplier;
  s.score += points;
  s.comboTimer = PHYSICS.comboTimeout;
  events.push({ type: 'grinding', points });

  const t = Math.min(1, Math.max(0, s.grind.t));
  s.x = line.a.x + (line.b.x - line.a.x) * t;
  s.y = line.a.y + (line.b.y - line.a.y) * t;
  s.z = line.a.z + (line.b.z - line.a.z) * t;

  if (s.grind.t <= 0 || s.grind.t >= 1 || s.speed < 5) {
    const along = Math.max(s.speed, 4) * s.grind.sign;
    s.vel = { x: line.dir.x * along, y: line.dir.y * along, z: line.dir.z * along };
    if (s.speed < 5) {
      // Ran out of speed: tip off to the low side.
      const nx = -line.dir.z;
      const nz = line.dir.x;
      s.vel.x += nx * 8;
      s.vel.z += nz * 8;
    }
    s.state = 'air';
    s.airTime = 0;
    s.popped = true;
    s.spinTotal = 0;
    s.tricksThisAir = [];
    s.fromGrind = true;
    s.grind = null;
    events.push({ type: 'grindEnd' });
  }
}

/* ------------------------------------------------------------- landing */

function land(s, park, contact, events) {
  let support = contact;
  const facing = s.bodyYaw + s.shuvTarget;
  if (Math.abs(s.flipTarget - s.flip) > PHYSICS.landTolerance) {
    s.y = support.y;
    bail(s, events, 'Didn\'t finish the flip', { x: 0, z: 0 }, park);
    return;
  }
  if (offGrid(facing + (s.shuv - s.shuvTarget), Math.PI) > PHYSICS.landTolerance) {
    s.y = support.y;
    bail(s, events, 'Landed sideways', { x: 0, z: 0 }, park);
    return;
  }
  // The air pose found the contact; where it comes to rest is the settled
  // pose for the surface it met.
  const rest = restingSupport(s, park, s.x, s.z, s.heading, Math.atan(support.along));
  support = rest;
  const hung = hangUp(s, park, support);
  if (hung) {
    s.y = support.y;
    bail(s, events, `Hung up on the ${nameOf(hung)}`, { x: -Math.cos(s.heading) * 6, z: -Math.sin(s.heading) * 6 }, park);
    return;
  }

  // Keep the speed that runs along the surface; the rest is the impact.
  const fx = Math.cos(s.heading);
  const fz = Math.sin(s.heading);
  const norm = Math.sqrt(1 + support.along * support.along);
  let speed = (s.vel.x * fx + s.vel.z * fz + s.vel.y * support.along) / norm;
  s.bodyYaw = wrap(nearestMultiple(facing, Math.PI));
  if (speed < 0) {
    s.heading = wrap(s.heading + Math.PI);
    s.bodyYaw = wrap(s.bodyYaw + Math.PI);
    speed = -speed;
  }
  s.speed = Math.min(PHYSICS.maxSpeed, speed * 0.97);
  s.y = support.y;
  s.grad = { x: support.gx, z: support.gz };
  s.state = 'ground';
  s.vert = false;

  scoreAir(s, events, { intoGrind: false });
  s.shuv = 0;
  s.shuvTarget = 0;
  s.flip = 0;
  s.flipTarget = 0;
  s.fromGrind = false;
}

/**
 * Landed straddling an edge: the ground under the board jumps somewhere
 * between the wheels or across them. Returns what it hung up on.
 */
function hangUp(s, park, support) {
  const fx = Math.cos(s.heading);
  const fz = Math.sin(s.heading);
  const sx = -fz;
  const sz = fx;
  const squash = Math.max(0.3, Math.cos(Math.atan(support.along)));
  // Along the board only a step *up* ahead of you hangs you up: front wheels
  // down a step from the back ones is just rolling down the stairs. Across
  // it, a step either way means you are straddling an edge.
  const lines = [
    { from: [-s.halfBase * squash, 0], to: [s.halfBase * squash, 0], upOnly: true },
    { from: [0, -s.wheelZ], to: [0, s.wheelZ], upOnly: false },
  ];
  for (const { from: [a0, b0], to: [a1, b1], upOnly } of lines) {
    let previous = null;
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const a = a0 + (a1 - a0) * t;
      const b = b0 + (b1 - b0) * t;
      const x = s.x + fx * a + sx * b;
      const z = s.z + fz * a + sz * b;
      const h = park.heightAt(x, z);
      const jump = previous === null ? 0 : h - previous.h;
      if (upOnly ? jump > 0.9 : Math.abs(jump) > 0.9) {
        return park.itemAt(h > previous.h ? x : previous.x, h > previous.h ? z : previous.z) ?? { name: 'edge' };
      }
      previous = { h, x, z };
    }
  }
  return null;
}

/** Score whatever was done in the air, on a landing or into a grind. */
function scoreAir(s, events, { intoGrind }) {
  const tricks = s.tricksThisAir;
  const halves = spinHalves(s.spinTotal);
  const trickPoints = tricks.reduce((sum, id) => sum + TRICKS[id].points, 0);
  const spinPoints = SPIN_POINTS[Math.min(halves, SPIN_POINTS.length - 1)];
  const airPoints = s.airTime > 0.4 ? (s.airTime - 0.4) * 220 : 0;
  const base = trickPoints + spinPoints + airPoints;
  const scored = trickPoints + spinPoints > 0 || s.airTime > 0.55 || (s.fromGrind && !intoGrind);

  let label = tricks.length ? nameTricks(tricks) : (halves ? '' : 'Ollie');
  if (halves) label = `${halves * 180}${label ? ` ${label}` : ''}`;
  if (s.bodyYaw && offGrid(s.bodyYaw + s.shuvTarget, TAU) > Math.PI / 2 && !intoGrind) {
    label = `${label} to Fakie`;
  }

  if (scored) {
    s.combo += 1;
    s.multiplier = Math.min(8, 1 + s.combo * 0.5);
    const points = base * s.multiplier;
    s.score += points;
    s.comboTimer = PHYSICS.comboTimeout;
    if (!intoGrind || tricks.length || halves) {
      events.push({
        type: 'land',
        label,
        points,
        multiplier: s.multiplier,
        tricks: tricks.length,
        spins: halves,
        airTime: s.airTime,
        intoGrind,
      });
    }
  } else if (!intoGrind) {
    events.push({ type: 'touchdown', airTime: s.airTime });
  }
  s.tricksThisAir = [];
  s.spinTotal = 0;
  s.airTime = 0;
}

/* ---------------------------------------------------------------- bail */

function bail(s, events, reason, knock, park = null) {
  const wasCombo = s.combo;
  const airborne = s.state === 'air';
  const planSpeed = airborne ? Math.hypot(s.vel.x, s.vel.z) : s.speed;
  s.state = 'bail';
  s.bailTimer = PHYSICS.bailTime;
  // Carry some of the run into the tumble, unless we bounced off something.
  s.bailVel = knock.x || knock.z
    ? { x: knock.x, z: knock.z }
    : {
      x: Math.cos(s.heading) * Math.min(planSpeed, 60) * 0.35,
      z: Math.sin(s.heading) * Math.min(planSpeed, 60) * 0.35,
    };
  s.bailVy = reason === 'Fell off the table' ? s.vel.y : 18;
  s.y = Math.max(s.y, park?.heightAt(s.x, s.z) ?? s.y);
  s.bailRoll = 0;
  s.bailSpin = (Math.sin(s.x * 12.9898 + s.z * 78.233) > 0 ? 1 : -1) * 11;
  s.grind = null;
  s.combo = 0;
  s.multiplier = 1;
  s.charge = 0;
  s.speed = 0;
  events.push({ type: 'bail', reason, lostCombo: wasCombo });
}

function stepBail(s, dt, park, events) {
  s.bailTimer -= dt;

  const offTable = Math.abs(s.x) > TABLE.halfX || Math.abs(s.z) > TABLE.halfZ;
  if (!offTable) {
    // Tumble along the ground, sliding down any slope, never through a face.
    const ground = park.heightAt(s.x, s.z);
    const onGround = s.y <= ground + 0.05;
    if (onGround) {
      const e = 0.5;
      const gx = (park.heightAt(s.x + e, s.z) - park.heightAt(s.x - e, s.z)) / (2 * e);
      const gz = (park.heightAt(s.x, s.z + e) - park.heightAt(s.x, s.z - e)) / (2 * e);
      if (Math.abs(gx) < 4 && Math.abs(gz) < 4) {
        s.bailVel.x -= gx * PHYSICS.gravity * 0.5 * dt;
        s.bailVel.z -= gz * PHYSICS.gravity * 0.5 * dt;
      }
      const friction = Math.max(0, 1 - dt * 2.6);
      s.bailVel.x *= friction;
      s.bailVel.z *= friction;
    }
    const nx = s.x + s.bailVel.x * dt;
    const nz = s.z + s.bailVel.z * dt;
    const face = park.faceBetween(s.x, s.z, s.y, nx, nz, s.y, 0.2);
    if (face) {
      s.bailVel.x *= -0.2;
      s.bailVel.z *= -0.2;
    } else {
      s.x = nx;
      s.z = nz;
    }
  } else {
    s.x += s.bailVel.x * dt;
    s.z += s.bailVel.z * dt;
  }

  s.bailVy -= PHYSICS.gravity * dt;
  s.y += s.bailVy * dt;
  const floor = park.heightAt(s.x, s.z);
  if (s.y <= floor) {
    s.y = floor;
    s.bailVy = s.bailVy < -20 ? -s.bailVy * 0.25 : 0;
    s.bailSpin *= 0.7;
  }
  s.bailRoll += s.bailSpin * dt;
  if (s.bailTimer < 0.45) {
    // Right itself before getting back on.
    const target = nearestMultiple(s.bailRoll, TAU);
    s.bailRoll += (target - s.bailRoll) * Math.min(1, dt * 10);
    s.bailSpin = 0;
  }
  s.grad.x *= 0.9;
  s.grad.z *= 0.9;

  if (s.bailTimer <= 0) recover(s, park, events);
}

function recover(s, park, events) {
  let offTable = Math.abs(s.x) > TABLE.halfX - 1 || Math.abs(s.z) > TABLE.halfZ - 1 || s.y < -5;
  const headingBefore = s.heading;
  const heading = wrap(s.heading + nearestMultiple(s.bodyYaw + s.shuvTarget, Math.PI / 2));
  if (!offTable) {
    // Get back on somewhere the whole board fits: never straddling an edge.
    const spot = nearestCleanSpot(s, park, s.x, s.z, heading);
    if (spot) {
      s.x = spot.x;
      s.z = spot.z;
    } else {
      offTable = true;
    }
  }
  if (offTable) {
    // Fell off: back on the table near where you went over, facing in.
    const x = Math.max(-TABLE.halfX + 12, Math.min(TABLE.halfX - 12, s.x));
    const z = Math.max(-TABLE.halfZ + 12, Math.min(TABLE.halfZ - 12, s.z));
    const inward = Math.atan2(-z, -x);
    const spot = nearestCleanSpot(s, park, x, z, inward);
    if (spot) {
      s.x = spot.x;
      s.z = spot.z;
      s.heading = inward;
      s.bodyYaw = 0;
      const support = restingSupport(s, park, s.x, s.z, s.heading, 0);
      s.y = support.y;
      s.grad = { x: support.gx, z: support.gz };
      s.state = 'ground';
      s.speed = 0;
      resetTricks(s);
    } else {
      placeAtSpawn(s, park);
    }
  } else {
    // Face the way the board is pointing, stood still.
    s.heading = heading;
    s.bodyYaw = 0;
    const support = restingSupport(s, park, s.x, s.z, s.heading, 0);
    s.y = support.y;
    s.grad = { x: support.gx, z: support.gz };
    s.state = 'ground';
    s.speed = 0;
    resetTricks(s);
  }
  s.bailRoll = 0;
  s.bailSpin = 0;
  events.push({ type: 'recover', respawned: offTable, headingBefore });
}

function nearestCleanSpot(s, park, x, z, heading) {
  if (cleanSpot(s, park, x, z, heading)) return { x, z };
  for (let radius = 1.5; radius <= 18; radius += 1.5) {
    for (let k = 0; k < 12; k += 1) {
      const angle = (k / 12) * TAU;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      if (Math.abs(px) > TABLE.halfX - 6 || Math.abs(pz) > TABLE.halfZ - 6) continue;
      if (cleanSpot(s, park, px, pz, heading)) return { x: px, z: pz };
    }
  }
  return null;
}

/* ------------------------------------------------------------- letters */

function collectLetters(s, park, events) {
  for (let i = 0; i < park.letters.length; i += 1) {
    if (s.letters.includes(i)) continue;
    const l = park.letters[i];
    const d = Math.hypot(s.x - l.x, s.y + 1 - l.y, s.z - l.z);
    if (d > PHYSICS.letterRadius) continue;
    s.letters.push(i);
    const all = s.letters.length === park.letters.length;
    const points = all ? 2500 : 500;
    s.score += points;
    events.push({ type: 'letter', letter: l.letter, index: i, points, all });
  }
}

