/**
 * Board physics, the trick state machine and scoring.
 *
 * Pure: no three.js and no DOM, so a whole run can be simulated in a test.
 * The renderer reads the state out and poses the board from it.
 */

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

export function createSkater() {
  return {
    x: 0,
    y: 0,
    vx: PHYSICS.cruiseSpeed,
    vy: 0,
    pitch: 0, // follows the surface underfoot
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
  const tricks = input.tricks ?? [];

  if (s.state === 'bail') {
    s.bailTimer -= dt;
    s.vx += (PHYSICS.cruiseSpeed - s.vx) * Math.min(1, dt * 2);
    s.x += s.vx * dt * 0.35;
    if (s.bailTimer <= 0) {
      // Never drop back in over a gap, or the bail repeats until you drift out.
      s.x = track.solidGroundAhead(s.x);
      const surface = track.supportAt(s.x, 99) ?? { y: 0, slope: 0 };
      Object.assign(s, {
        state: 'rolling',
        y: surface.y,
        vy: 0,
        roll: 0,
        yaw: 0,
        rollTarget: 0,
        yawTarget: 0,
        pitch: Math.atan(surface.slope),
        tricksThisAir: [],
        charge: 0,
      });
      events.push({ type: 'recover' });
    }
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
    for (const id of tricks) {
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

  /* ---------------------------------------------------------- movement */

  const surface = track.supportAt(s.x, s.y);

  if (s.state === 'grind') {
    const stillOn = surface && surface.grindable && surface.feature === s.grindSurface.feature;
    if (!stillOn) {
      s.state = 'air';
      s.vy = 0;
      events.push({ type: 'grindEnd' });
    } else {
      s.y = surface.y;
      s.score += PHYSICS.grindPointsPerSecond * s.multiplier * dt;
      events.push({ type: 'grinding', dt });
    }
  }

  if (s.state === 'rolling') {
    if (!surface) {
      s.state = 'air'; // rolled off the end of something
      s.vy = 0;
    } else {
      s.y = surface.y;
      s.pitch = Math.atan(surface.slope);
      // Gravity along the slope: ramps cost speed, landings give it back.
      const along = -Math.sin(s.pitch) * PHYSICS.gravity * 0.45;
      s.vx += along * dt;
      s.vx += (PHYSICS.cruiseSpeed - s.vx) * Math.min(1, dt * 0.7);
    }
  }

  if (s.state === 'air') {
    s.airTime += dt;
    s.vy -= PHYSICS.gravity * dt;
    s.y += s.vy * dt;
    advanceRotation(s, dt);
  }

  s.vx = Math.max(PHYSICS.minSpeed, Math.min(PHYSICS.maxSpeed, s.vx));
  const dx = s.vx * dt;
  s.x += dx;
  s.distance += dx;

  /* --------------------------------------------------- leaving a surface */

  if (s.state === 'rolling') {
    const ahead = track.supportAt(s.x, s.y);
    if (!ahead || ahead.y < s.y - 0.35) {
      // The ground fell away — launch along the lip we just left.
      s.state = 'air';
      s.vy = Math.min(PHYSICS.maxLaunch, s.vx * Math.tan(s.pitch));
      s.airTime = 0;
    } else {
      s.y = ahead.y;
      s.pitch = Math.atan(ahead.slope);
    }
  }

  /* --------------------------------------------------- landing and bails */

  if (s.state === 'air') {
    const feature = track.featureAt(s.x);

    // Running into the face of a square-edged ledge.
    if (feature?.kind === 'ledge' && s.y < feature.height - 0.4 && s.vy <= 0) {
      bail(s, events, 'Clipped the ledge');
      return events;
    }
    if (s.y < -14) {
      bail(s, events, 'Fell in the gap');
      return events;
    }

    const below = track.supportAt(s.x, s.y, 0.9);
    if (below && s.vy <= 0 && s.y <= below.y + 0.25) {
      land(s, below, events);
    }
  }

  if (s.state === 'rolling' || s.state === 'grind') {
    s.charge = input.hold ? s.charge : 0;
  }

  return events;
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
  s.state = 'air';
  s.vy = Math.min(PHYSICS.maxLaunch, Math.max(s.vy, 0) + power);
  s.airTime = 0;
  s.tricksThisAir = [];
  s.trickCooldown.roll = 0;
  s.trickCooldown.yaw = 0;
  s.charge = 0;
  events.push({ type: 'pop', power });
}

function land(s, surface, events) {
  const rollError = angleError(s.roll, TAU);
  const yawError = angleError(s.yaw, Math.PI);

  if (rollError > PHYSICS.landTolerance || yawError > PHYSICS.landTolerance) {
    bail(s, events, 'Landed sideways');
    return;
  }

  // Snap the rotations to what was actually landed.
  s.roll = Math.round(s.roll / TAU) * TAU;
  s.yaw = Math.round(s.yaw / Math.PI) * Math.PI;
  s.rollTarget = s.roll;
  s.yawTarget = s.yaw;
  s.y = surface.y;
  s.vy = 0;
  s.pitch = Math.atan(surface.slope);

  const trickPoints = s.tricksThisAir.reduce((sum, id) => sum + TRICKS[id].points, 0);
  const airBonus = Math.round(s.airTime * 90);
  const grindStart = surface.grindable;
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

  events.push({ type: 'land', label, points: gained, multiplier: s.multiplier, airTime: s.airTime });
  s.tricksThisAir = [];
  s.airTime = 0;
}

function bail(s, events, reason) {
  s.state = 'bail';
  s.bailTimer = PHYSICS.bailRecovery;
  s.combo = 0;
  s.multiplier = 1;
  s.charge = 0;
  s.grindSurface = null;
  events.push({ type: 'bail', reason });
}
