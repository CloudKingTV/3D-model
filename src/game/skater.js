/**
 * Board physics, the trick state machine and scoring.
 *
 * Pure: no three.js and no DOM, so a whole run can be simulated in a test.
 * The renderer reads the state out and poses the board from it.
 */

import { STEP_KINDS } from './track.js';

const TAU = Math.PI * 2;

export const PHYSICS = {
  gravity: 560, // units/s^2 (1 unit = 10mm)
  cruiseSpeed: 46,
  minSpeed: 26,
  maxSpeed: 74,
  basePop: 98,
  maxPop: 128,
  // A 96mm board launched 250mm in the air stops reading as a fingerboard, so
  // vertical speed is capped however steep the transition was.
  maxLaunch: 132,
  chargeTime: 0.45, // seconds of hold for a full-power ollie
  rollRate: TAU / 0.3, // a kickflip takes 0.3s
  yawRate: Math.PI / 0.26,
  landTolerance: 0.55, // radians of sloppiness allowed on a landing
  bailRecovery: 1.1,
  grindPointsPerSecond: 140,
  // Per axis, so a flip and a shuv thrown together still make a varial while
  // holding one control down cannot queue a new trick every frame.
  trickCooldown: 0.12,
  maxTricksPerAir: 4,
};

export const TRICKS = {
  kickflip: { name: 'Kickflip', axis: 'roll', amount: -TAU, points: 120 },
  heelflip: { name: 'Heelflip', axis: 'roll', amount: TAU, points: 120 },
  shuvit: { name: 'Pop Shuv', axis: 'yaw', amount: -Math.PI, points: 90 },
  bigspin: { name: '360 Shuv', axis: 'yaw', amount: -TAU, points: 200 },
};

/** Real names for the combinations worth recognising. */
const COMBO_NAMES = [
  { has: ['kickflip', 'bigspin'], name: 'Bigspin Flip' },
  { has: ['heelflip', 'bigspin'], name: 'Bigspin Heel' },
  { has: ['kickflip', 'shuvit'], name: 'Varial Flip' },
  { has: ['heelflip', 'shuvit'], name: 'Varial Heel' },
  { has: ['kickflip', 'heelflip'], name: 'Flip Combo' },
];

export function nameTricks(ids) {
  if (ids.length === 0) return 'Ollie';
  if (ids.length === 1) return TRICKS[ids[0]].name;
  for (const combo of COMBO_NAMES) {
    if (combo.has.every((id) => ids.includes(id))) return combo.name;
  }
  return ids.map((id) => TRICKS[id].name).join(' + ');
}

export function createSkater({
  wheelbase = 2.6,
  length = 9.6,
  width = 3.0,
  height = 1.5,
  noseLift = 1.8,
} = {}) {
  return {
    halfBase: wheelbase, // centre to each axle
    halfLength: length / 2, // centre to nose and tail
    halfWidth: width / 2,
    halfHeight: height / 2, // half of wheel contact to deck top
    noseLift, // underside of the nose and tail tips, above the wheel line
    x: 0,
    y: 0,
    vx: PHYSICS.cruiseSpeed,
    vy: 0,
    pitch: 0, // nose up is positive
    roll: 0,
    yaw: 0,
    rollTarget: 0,
    yawTarget: 0,
    state: 'rolling', // rolling | air | grind | bail
    grindSurface: null,
    charge: 0,
    airTime: 0,
    tricksThisAir: [],
    trickCooldown: { roll: 0, yaw: 0 },
    combo: 0,
    multiplier: 1,
    score: 0,
    bailTimer: 0,
    bailVx: 0,
    bailRoll: 0,
    bailSpin: 0,
    lastLanding: null,
    distance: 0,
  };
}

/** How far `angle` is from the nearest multiple of `step`. */
function angleError(angle, step) {
  const wrapped = ((angle % step) + step) % step;
  return Math.min(wrapped, step - wrapped);
}

function multiplierFor(combo) {
  return Math.min(8, 1 + combo * 0.5);
}

/** Nose and tail tips, which ride higher than the wheels by the kick. */
function tipsOf(s) {
  return { halfLength: s.halfLength, lift: s.noseLift };
}

function advance(s, dt) {
  s.vx = Math.max(PHYSICS.minSpeed, Math.min(PHYSICS.maxSpeed, s.vx));
  const dx = s.vx * dt;
  s.x += dx;
  s.distance += dx;
  return dx;
}

/**
 * Would any part of the deck be inside something at (x, y)? Stops a bailing
 * board sliding — forwards or backwards — through whatever is there.
 */
function wouldClip(s, track, x, y) {
  const tan = Math.tan(s.pitch);
  const probes = [[-s.halfLength, s.noseLift], [-s.halfBase, 0], [s.halfBase, 0], [s.halfLength, s.noseLift]];
  for (const [offset, lift] of probes) {
    if (y + offset * tan + lift < track.topAt(x + offset) - 0.3) return true;
  }
  return false;
}

/**
 * Where a loose, bailing board comes to rest: the lowest line that is on or
 * above the top of whatever is under each wheel and the middle, and that
 * keeps the nose and tail tips (which sit `noseLift` higher) on or above
 * whatever is under them. A board that bounced off a rail with its nose over
 * the rail comes down leaning on it, instead of dropping its nose through it.
 *
 * Returns null when nothing on either side of the middle can hold it up.
 */
function restingLine(s, track, x) {
  const points = [
    [-s.halfLength, s.noseLift],
    [-s.halfBase, 0],
    [0, 0],
    [s.halfBase, 0],
    [s.halfLength, s.noseLift],
  ].map(([offset, lift]) => ({ offset, y: track.topAt(x + offset) - lift }))
    .filter((p) => p.y > -Infinity);

  // Something has to be under the middle, or on both sides of it.
  const behind = points.some((p) => p.offset <= 0);
  const ahead = points.some((p) => p.offset >= 0);
  if (!behind || !ahead) return null;

  let best = null;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const slope = (b.y - a.y) / (b.offset - a.offset);
      const at = (offset) => a.y + (offset - a.offset) * slope;
      if (!points.every((p) => p.y <= at(p.offset) + 1e-6)) continue;
      const centre = at(0);
      const lower = !best || centre < best.y - 1e-6;
      const flatter = best && Math.abs(centre - best.y) <= 1e-6 && Math.abs(slope) < Math.abs(best.slope);
      if (lower || flatter) best = { y: centre, slope };
    }
  }
  if (best) return best;
  const only = points[0]; // a single point, and it is under the middle
  return { y: only.y, slope: 0 };
}

/**
 * A loose board must never stay inside anything. If one end is in, push it out
 * the way it came — back if the front is caught, forward if the tail is — and
 * if both ends are caught it is bridging a gap, so it sits on top instead.
 */
function depenetrate(s, track) {
  const probes = [
    [-s.halfLength, s.noseLift], [-s.halfBase, 0], [0, 0], [s.halfBase, 0], [s.halfLength, s.noseLift],
  ];
  for (let guard = 0; guard < 40; guard += 1) {
    const tan = Math.tan(s.pitch);
    let front = false;
    let back = false;
    for (const [offset, lift] of probes) {
      if (s.y + offset * tan + lift < track.topAt(s.x + offset) - 0.2) {
        if (offset > 0) front = true;
        else if (offset < 0) back = true;
        else { front = true; back = true; }
      }
    }
    if (!front && !back) return;
    if (front && back) s.y += 0.25;
    else s.x += front ? -0.25 : 0.25;
  }
}

function blockedReason(feature) {
  if (feature.kind === 'rail') return 'Hit the rail';
  if (feature.kind === 'ledge') return 'Clipped the ledge';
  return 'Hit the edge';
}

/**
 * Coming off the end of a ledge or rail, or over the lip of a gap, the deck's
 * centre goes past the edge while its back wheel is still above it. Rather
 * than drop level through the step, the board pivots nose-down on that edge.
 */
function pivotOnEdge(s, track, x, y) {
  const centreTop = track.topAt(x);
  // Both the back wheel and the tail tip are held clear of whatever they are
  // over; the tail sits `noseLift` higher but reaches much further back.
  for (const [offset, lift] of [[s.halfBase, 0], [s.halfLength, s.noseLift]]) {
    const top = track.topAt(x - offset);
    if (!(top > centreTop + 0.6)) continue;
    if (y + lift < top - offset * 1.2) continue; // already dropped well clear
    const needed = Math.max(-1.1, Math.atan((y + lift - top) / offset));
    if (s.pitch > needed) s.pitch = needed;
  }
}

/**
 * Advance one fixed step.
 * @param {object} s     skater state, mutated in place
 * @param {number} dt    seconds
 * @param {object} track from createTrack()
 * @param {object} input { hold: boolean, tricks: string[] }
 * @returns {Array} events for the renderer and HUD to react to
 */
export function stepSkater(s, dt, track, input = {}) {
  const events = [];

  if (s.state === 'bail') {
    stepBail(s, dt, track, events);
    return events;
  }

  /* ------------------------------------------------------------- input */

  if (s.state === 'rolling' || s.state === 'grind') {
    if (input.hold) {
      s.charge = Math.min(1, s.charge + dt / PHYSICS.chargeTime);
    } else if (s.charge > 0) {
      pop(s, events);
    }
  }

  s.trickCooldown.roll = Math.max(0, s.trickCooldown.roll - dt);
  s.trickCooldown.yaw = Math.max(0, s.trickCooldown.yaw - dt);

  if (s.state === 'air') {
    for (const id of input.tricks ?? []) {
      const trick = TRICKS[id];
      if (!trick) continue;
      if (s.trickCooldown[trick.axis] > 0) continue;
      if (s.tricksThisAir.length >= PHYSICS.maxTricksPerAir) break;
      if (trick.axis === 'roll') s.rollTarget += trick.amount;
      else s.yawTarget += trick.amount;
      s.tricksThisAir.push(id);
      s.trickCooldown[trick.axis] = PHYSICS.trickCooldown;
      events.push({ type: 'trick', id, name: trick.name });
    }
  }

  /* ------------------------------------------------------------ grinding */

  let moved = false;

  if (s.state === 'grind') {
    // A grind follows the middle of the deck: it lasts until the board's centre
    // runs off the end, not the moment a wheel does.
    const under = track.supportAt(s.x, s.y, 0.7);
    if (under?.grindable && under.feature === s.grindSurface?.feature) {
      s.y = under.y;
      s.pitch = 0;
      s.score += PHYSICS.grindPointsPerSecond * s.multiplier * dt;
      events.push({ type: 'grinding', dt });
      advance(s, dt);
      moved = true;
    } else {
      s.state = 'air';
      s.vy = 0;
      s.airTime = 0;
      s.grindSurface = null;
      events.push({ type: 'grindEnd' });
    }
  }

  /* ------------------------------------------------------------- rolling */

  if (s.state === 'rolling') {
    const support = track.boardSupport(s.x, s.y, s.pitch, s.halfBase, 0.6, tipsOf(s));
    if (!support) {
      s.state = 'air';
      s.vy = 0;
      s.airTime = 0;
    } else {
      s.y = support.y;
      s.pitch = Math.atan(support.slope);
      // Gravity along the slope: ramps cost speed, landings give it back.
      s.vx += -Math.sin(s.pitch) * PHYSICS.gravity * 0.45 * dt;
      s.vx += (PHYSICS.cruiseSpeed - s.vx) * Math.min(1, dt * 0.7);
      const dx = advance(s, dt);
      moved = true;

      const blocker = track.blockedBy(s.x, s.y, s.pitch, s.halfBase, s.halfLength, { noseLift: s.noseLift });
      if (blocker) {
        s.x -= dx; // back out of the face we just touched
        bail(s, events, blockedReason(blocker), { knockback: true });
        return events;
      }

      const ahead = track.boardSupport(s.x, s.y, s.pitch, s.halfBase, 0.6, tipsOf(s));
      if (!ahead || ahead.y < s.y - 0.6) {
        // The ground fell away — launch along the line we were riding.
        s.state = 'air';
        s.vy = Math.min(PHYSICS.maxLaunch, s.vx * Math.tan(s.pitch));
        s.airTime = 0;
      } else {
        s.y = ahead.y;
        s.pitch = Math.atan(ahead.slope);
      }
    }
  }

  /* ----------------------------------------------------------------- air */

  if (s.state === 'air' && !moved) {
    s.airTime += dt;
    advanceRotation(s, dt);
    s.vy -= PHYSICS.gravity * dt;
    // A board in flight levels out rather than holding its take-off angle.
    s.pitch *= Math.max(0, 1 - dt * 4);

    const fromX = s.x;
    const fromY = s.y;
    s.vx = Math.max(PHYSICS.minSpeed, Math.min(PHYSICS.maxSpeed, s.vx));
    const toX = fromX + s.vx * dt;
    const toY = fromY + s.vy * dt;
    s.distance += toX - fromX;

    // Sweep the path travelled this step instead of only testing where it
    // ends. At full pop the board covers more than a unit per step, which is
    // enough to jump clean through a rail or a ledge top.
    const steps = Math.min(12, Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 0.22)));
    let lastX = fromX;
    let lastY = fromY;

    for (let i = 1; i <= steps; i += 1) {
      const x = fromX + ((toX - fromX) * i) / steps;
      const y = fromY + ((toY - fromY) * i) / steps;
      pivotOnEdge(s, track, x, y);

      // Square faces first: nothing lands inside a ledge.
      const blocker = track.blockedBy(x, y, s.pitch, s.halfBase, s.halfLength, { noseLift: s.noseLift });
      if (blocker) {
        s.x = lastX;
        s.y = lastY;
        bail(s, events, blockedReason(blocker), { knockback: true });
        return events;
      }

      // Landed the moment any wheel touches, not when the middle does — a
      // board coming down nose-first is landing, not burying its nose. And
      // "coming down" is relative to the surface: a board still rising, but
      // more slowly than the ramp under it, has met that ramp.
      const support = track.boardSupport(x, y, s.pitch, s.halfBase, 0.3, tipsOf(s));
      if (support && s.vy <= s.vx * support.slope + 1) {
        if (support.clearance <= 0.14) {
          land(s, support, events, x, y);
          return events;
        }
      }

      // Only then the table edge, which is for boards down in a gap. Put the
      // offending point back on the gap side of the wall it went through.
      const edge = track.hitsTableEdge(x, y, s.pitch, s.halfBase, 0.3);
      if (edge) {
        s.x = Math.min(lastX, edge.feature.start - edge.offset - 0.05);
        s.y = lastY;
        bail(s, events, edge.feature.kind === 'flat' ? 'Hit the edge' : 'Hit the ramp', { knockback: true });
        return events;
      }
      lastX = x;
      lastY = y;
    }

    s.x = toX;
    s.y = toY;
    if (s.y < -14) {
      bail(s, events, 'Fell in the gap');
      return events;
    }
  }

  if (s.state === 'rolling' || s.state === 'grind') {
    s.charge = input.hold ? s.charge : 0;
  }

  return events;
}

/**
 * A bail is still physical: the board is knocked up and spins over sideways,
 * bounces off whatever is under it and is stopped by walls — so it tumbles on
 * top of the table rather than sliding through what it just hit.
 */
function stepBail(s, dt, track, events) {
  s.bailTimer -= dt;

  const nextX = s.x + s.bailVx * dt;
  if (wouldClip(s, track, nextX, s.y)) {
    s.bailVx = 0; // a wall, a step or the back of a ramp: it stops there
  } else {
    s.x = nextX;
  }
  s.bailVx *= Math.max(0, 1 - dt * 1.6);

  s.vy -= PHYSICS.gravity * dt;
  s.y += s.vy * dt;
  s.bailRoll += s.bailSpin * dt;
  s.pitch *= Math.max(0, 1 - dt * 5);

  // Spun onto its side the deck is wider than it is tall, so keep its lowest
  // edge on the surface rather than its wheels.
  const r = s.bailRoll;
  const lift = s.halfHeight * Math.abs(Math.cos(r)) + s.halfWidth * Math.abs(Math.sin(r)) - s.halfHeight;
  // The floor is the top of whatever is under each contact point — not the
  // highest thing below the board, which misses a ramp the board is already
  // partly over and lets it settle half inside it. Resting on the tops, a
  // board tumbling past the end of a ramp lies against its edge instead.
  const floor = restingLine(s, track, s.x);
  if (floor) {
    const tan = Math.tan(s.pitch);
    let clearance = Infinity;
    const probes = [
      [-s.halfLength, s.noseLift], [-s.halfBase, 0], [0, 0], [s.halfBase, 0], [s.halfLength, s.noseLift],
    ];
    for (const [offset, tipLift] of probes) {
      const top = track.topAt(s.x + offset);
      if (top > -Infinity) clearance = Math.min(clearance, s.y - lift + offset * tan + tipLift - top);
    }
    if (clearance <= 0) {
      s.y = floor.y + lift;
      s.pitch = Math.atan(floor.slope);
      s.vy = s.vy < -16 ? -s.vy * 0.3 : 0; // clatter, then settle
      s.bailSpin *= 0.6;
    }
  }
  if (s.y < -40) {
    s.y = -40;
    s.vy = 0;
  }
  depenetrate(s, track);

  // Over the last stretch it rights itself, ready to go again.
  if (s.bailTimer < 0.45) {
    const upright = Math.round(s.bailRoll / TAU) * TAU;
    s.bailRoll += (upright - s.bailRoll) * Math.min(1, dt * 8);
    s.bailSpin *= Math.max(0, 1 - dt * 6);
  }

  if (s.bailTimer <= 0) recover(s, track, events);
}

/** Put the board back down somewhere it can actually ride away from. */
function recover(s, track, events) {
  s.x = track.safeSpotAhead(s.x, s.halfLength);
  const surface = track.boardSupport(s.x, 999, 0, s.halfBase, 0) ?? { y: 0, slope: 0 };
  Object.assign(s, {
    state: 'rolling',
    y: surface.y,
    vx: PHYSICS.cruiseSpeed * 0.8,
    vy: 0,
    pitch: Math.atan(surface.slope),
    roll: 0,
    yaw: 0,
    rollTarget: 0,
    yawTarget: 0,
    bailRoll: 0,
    bailSpin: 0,
    bailVx: 0,
    tricksThisAir: [],
    charge: 0,
  });
  events.push({ type: 'recover' });
}

function advanceRotation(s, dt) {
  const rollStep = PHYSICS.rollRate * dt;
  const rollGap = s.rollTarget - s.roll;
  s.roll += Math.sign(rollGap) * Math.min(Math.abs(rollGap), rollStep);

  const yawStep = PHYSICS.yawRate * dt;
  const yawGap = s.yawTarget - s.yaw;
  s.yaw += Math.sign(yawGap) * Math.min(Math.abs(yawGap), yawStep);
}

function pop(s, events) {
  const power = PHYSICS.basePop + s.charge * (PHYSICS.maxPop - PHYSICS.basePop);
  if (s.state === 'grind') {
    events.push({ type: 'grindEnd' });
    s.grindSurface = null;
  }
  // Popping on a ramp keeps the ramp's own upward speed and adds the pop to
  // it — an ollie halfway up a quarter goes higher than one on the flat.
  const rampRise = s.state === 'rolling' ? Math.max(0, s.vx * Math.tan(s.pitch)) : 0;
  s.state = 'air';
  s.vy = Math.min(PHYSICS.maxLaunch, rampRise + power);
  s.airTime = 0;
  s.tricksThisAir = [];
  s.trickCooldown.roll = 0;
  s.trickCooldown.yaw = 0;
  s.charge = 0;
  events.push({ type: 'pop', power });
}

/**
 * The board has touched down at (x, y). Only a clean landing snaps it onto its
 * resting line; a bail starts from exactly where it touched, so the tumble
 * begins from a position that is not already inside anything.
 */
function land(s, support, events, x, y) {
  s.x = x;
  s.y = y;
  const rollError = angleError(s.roll, TAU);
  const yawError = angleError(s.yaw, Math.PI);

  if (rollError > PHYSICS.landTolerance || yawError > PHYSICS.landTolerance) {
    bail(s, events, 'Landed sideways');
    return;
  }

  // Coming down just short of a ledge or rail, the front truck lands on its
  // top edge with the middle of the board still off it. That is a hang-up —
  // the board catches on the edge — not a landing and certainly not a grind.
  const { front, mid } = support;
  if (front && STEP_KINDS.has(front.kind) && (!mid || mid.y < front.y - 0.6)) {
    bail(s, events, 'Hung up on the edge', { knockback: true });
    return;
  }

  // A grind is whatever is under the middle of the deck, level. A wheel on
  // the end of a rail with the rest of the board off it does not count.
  const grindStart = Boolean(mid?.grindable) && Math.abs(support.slope) < 0.2;
  const surface = grindStart ? mid : support.surface;

  // Rolling over a ramp's crest re-seats the wheels constantly. Those are not
  // landings: reattach silently rather than firing a trick pop-up for each one.
  const trivial = s.tricksThisAir.length === 0
    && !grindStart
    && s.airTime < 0.09;
  if (trivial) {
    s.y = support.y;
    s.vy = 0;
    s.pitch = Math.atan(support.slope);
    s.state = 'rolling';
    s.airTime = 0;
    return;
  }

  // Snap the rotations to what was actually landed.
  s.roll = Math.round(s.roll / TAU) * TAU;
  s.yaw = Math.round(s.yaw / Math.PI) * Math.PI;
  s.rollTarget = s.roll;
  s.yawTarget = s.yaw;
  s.y = support.y;
  s.vy = 0;
  s.pitch = Math.atan(support.slope);

  const trickPoints = s.tricksThisAir.reduce((sum, id) => sum + TRICKS[id].points, 0);
  const airBonus = Math.round(s.airTime * 90);
  const base = trickPoints + airBonus + (grindStart ? 60 : 0);

  // Rolling off a funbox lip is not a trick: a landing only extends the combo
  // if something was actually done with it.
  const earned = s.tricksThisAir.length > 0 || grindStart || s.airTime > 0.25;
  if (earned) {
    s.combo += 1;
    s.multiplier = multiplierFor(s.combo);
  }
  const gained = Math.round(base * s.multiplier);
  s.score += gained;

  const label = nameTricks(s.tricksThisAir);
  s.lastLanding = { label, points: gained, multiplier: s.multiplier, grind: grindStart };

  if (grindStart) {
    s.state = 'grind';
    s.grindSurface = surface;
    events.push({ type: 'grindStart', surface });
  } else {
    s.state = 'rolling';
  }

  events.push({
    type: 'land',
    label,
    points: gained,
    multiplier: s.multiplier,
    airTime: s.airTime,
    tricks: s.tricksThisAir.length,
    grind: grindStart,
  });
  s.tricksThisAir = [];
  s.airTime = 0;
}

function bail(s, events, reason, { knockback = false } = {}) {
  s.state = 'bail';
  s.bailTimer = PHYSICS.bailRecovery;
  s.combo = 0;
  s.multiplier = 1;
  s.charge = 0;
  s.grindSurface = null;
  // Hit a face: bounced back off it. Anything else: carried on a little.
  s.bailVx = knockback ? -Math.min(16, s.vx * 0.3) : s.vx * 0.3;
  s.vy = reason === 'Fell in the gap' ? Math.min(s.vy, 0) : 30;
  s.bailRoll = s.roll;
  // Deterministic, so a simulated run always tumbles the same way.
  s.bailSpin = (Math.sin(s.x * 12.9898) > 0 ? 1 : -1) * 10;
  events.push({ type: 'bail', reason });
}
