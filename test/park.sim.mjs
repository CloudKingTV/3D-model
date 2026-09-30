/**
 * Drives the 3D rider round the park with scripted and random inputs.
 *
 * Checks, every physics step, that no part of the board is inside anything,
 * and that the things the park is for actually happen: kicker airs, vert airs
 * that come back into the quarter, grinds on rails and ledges, walls that stop
 * you. Exits non-zero on any clipping or failed scenario.
 *
 *   node test/park.sim.mjs
 */
import { createPark } from '../src/game/park.js';
import { createRider, placeAtSpawn, stepRider, restingSupport, poseDepth } from '../src/game/rider.js';
import { resolveShape, noseLiftFor } from '../src/lib/geometry.js';

const DT = 1 / 120;
const park = createPark();
let failures = 0;

function riderFor(shape = {}) {
  const spec = resolveShape(shape);
  const s = createRider({
    wheelbase: spec.wheelbase,
    length: spec.length,
    width: spec.width,
    wheelZ: spec.wheelZ,
    height: Math.abs(spec.groundY),
    noseLift: noseLiftFor(spec),
  });
  placeAtSpawn(s, park);
  return s;
}

/** How far the board is inside the surface right now (0 when it is not). */
function penetration(s) {
  if (s.state === 'grind') return 0;
  if (s.state === 'bail') return Math.max(0, park.heightAt(s.x, s.z) - 0.3 - s.y);
  // The board exactly as posed: its facing and its tilt.
  const facing = s.state === 'air' ? s.heading + s.bodyYaw + s.shuv : s.heading;
  const along = s.grad.x * Math.cos(facing) + s.grad.z * Math.sin(facing);
  const across = -s.grad.x * Math.sin(facing) + s.grad.z * Math.cos(facing);
  return Math.max(0, poseDepth(s, park, s.x, s.z, s.y, facing, along, across));
}

function place(s, x, z, heading, speed) {
  s.x = x;
  s.z = z;
  s.heading = heading;
  s.speed = speed;
  s.state = 'ground';
  const support = restingSupport(s, park, x, z, heading, 0);
  s.y = support.y;
  s.grad = { x: support.gx, z: support.gz };
}

/** Run `seconds` with `policy(s, t)` returning input; collect everything. */
function run(s, seconds, policy) {
  const log = { events: [], states: new Set(), maxY: -Infinity, clip: 0, worst: 0, worstAt: null, steps: 0 };
  for (let t = 0; t < seconds; t += DT) {
    const events = stepRider(s, DT, park, policy(s, t));
    for (const e of events) log.events.push({ ...e, t });
    log.states.add(s.state);
    log.maxY = Math.max(log.maxY, s.y);
    const depth = penetration(s);
    if (depth > 0.3) {
      log.clip += 1;
      if (depth > log.worst) {
        log.worst = depth;
        log.worstAt = { t: t.toFixed(2), state: s.state, x: s.x.toFixed(1), y: s.y.toFixed(2), z: s.z.toFixed(1) };
      }
    }
    log.steps += 1;
  }
  return log;
}

const count = (log, type, extra = () => true) => log.events.filter((e) => e.type === type && extra(e)).length;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

/* ------------------------------------------------------------ scenarios */

{
  // Rolling straight at the manual pad without popping: stopped by it.
  const s = riderFor();
  place(s, 30, -18, 0, 50);
  const log = run(s, 1.2, () => ({}));
  const inside = Math.abs(s.x - 58) < 11 && Math.abs(s.z + 18) < 6 && s.y < 1;
  check('rolling into the manual pad does not pass through it', !inside && log.clip === 0,
    `x=${s.x.toFixed(1)} y=${s.y.toFixed(2)} bumps=${count(log, 'bump')} bails=${count(log, 'bail')}`);
}

{
  // Ollie up onto the manual pad.
  const s = riderFor();
  place(s, 18, -18, 0, 55);
  let onPad = false;
  const log = run(s, 1.2, (r, t) => {
    if (r.state === 'ground' && Math.abs(r.y - 1.6) < 0.05) onPad = true;
    return { ollie: t > 0.2 && t < 0.35 };
  });
  check('ollie onto the manual pad', onPad && log.clip === 0 && count(log, 'bail') === 0,
    `x=${s.x.toFixed(1)} state=${s.state} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Straight up the east quarter: vert air, back down into the ramp, rolling away fakie.
  const s = riderFor();
  place(s, 60, 0, 0, 74);
  const log = run(s, 3, () => ({ throttle: 1 }));
  const aired = log.maxY > 10;
  check('vert air off the quarter comes back in', aired && count(log, 'bail') === 0 && s.x < 100 && log.clip === 0,
    `maxY=${log.maxY.toFixed(1)} x=${s.x.toFixed(1)} state=${s.state} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Kicker: roll over it and fly.
  const s = riderFor();
  place(s, -80, 24, 0, 70);
  const log = run(s, 1.6, (r, t) => ({ throttle: 1, ollie: t > 0.12 && t < 0.3 }));
  check('kicker launches', log.maxY > 7 && count(log, 'bail') === 0 && log.clip === 0,
    `maxY=${log.maxY.toFixed(1)} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Ollie onto the flat bar along its length: 50-50.
  const s = riderFor();
  place(s, 0, -50, 0, 55);
  const log = run(s, 1.4, (r, t) => ({ ollie: t > 0.05 && t < 0.2 }));
  const grinds = log.events.filter((e) => e.type === 'grindStart');
  check('ollie onto the flat bar grinds it', grinds.length > 0 && log.clip === 0,
    `${grinds.map((g) => `${g.style} ${g.name}`).join(', ') || 'no grind'} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Ledge: ride parallel beside it and pop onto its edge.
  const s = riderFor();
  place(s, -72, -44, -0.1, 55);
  const log = run(s, 1.2, (r, t) => ({ ollie: t > 0.05 && t < 0.2 }));
  const grinds = log.events.filter((e) => e.type === 'grindStart');
  check('ollie onto the ledge edge grinds it', grinds.length > 0 && log.clip === 0,
    `${grinds.map((g) => `${g.style} ${g.name}`).join(', ') || 'no grind'}`);
}

{
  // Up the bank, along the platform and down the stairs.
  const s = riderFor();
  place(s, -40, 52, 0, 74);
  const log = run(s, 2.2, () => ({ throttle: 1 }));
  check('bank, platform and stairs', s.x > 30 && log.clip === 0 && count(log, 'bail') === 0,
    `x=${s.x.toFixed(1)} maxY=${log.maxY.toFixed(1)} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Kickflip off flat lands clean; a spin with no input left is a 180.
  const s = riderFor();
  place(s, -80, -12, 0, 50);
  const log = run(s, 1.2, (r, t) => ({ tricks: t < DT ? ['kickflip'] : [] }));
  const lands = log.events.filter((e) => e.type === 'land');
  check('kickflip on flat', lands.some((e) => e.label === 'Kickflip'),
    lands.map((e) => e.label).join(', ') || log.events.map((e) => e.type).join(','));
}

for (const id of ['kickflip', 'heelflip', 'shuvit', 'treflip']) {
  // Each trick button, pressed while rolling on flat, lands clean.
  const s = riderFor();
  place(s, -80, -12, 0, 50);
  const log = run(s, 1.2, (r, t) => ({ tricks: t < DT ? [id] : [] }));
  const lands = log.events.filter((e) => e.type === 'land');
  check(`${id} from the trick button lands`, lands.length === 1 && count(log, 'bail') === 0,
    `${lands.map((e) => e.label).join(', ')} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  const s = riderFor();
  place(s, -80, -12, 0, 50);
  const log = run(s, 1.4, (r, t) => ({ ollie: t < 0.4, steer: r.state === 'air' && Math.abs(r.spinTotal) < Math.PI - 0.05 ? 1 : 0 }));
  const lands = log.events.filter((e) => e.type === 'land');
  check('frontside 180', lands.some((e) => e.label.startsWith('180')),
    `${lands.map((e) => e.label).join(', ')} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Riding off the edge of the table: a fall, then back on near the edge,
  // facing in, rather than all the way back at the start.
  const s = riderFor();
  place(s, 0, 74, Math.PI / 2, 60);
  const log = run(s, 3, () => ({}));
  const fell = log.events.some((e) => e.type === 'bail' && e.reason === 'Fell off the table');
  const back = s.state === 'ground' && Math.abs(s.z) < 85 && Math.hypot(s.x - 0, s.z - 73) < 20;
  check('riding off the table edge falls and respawns nearby', fell && back && log.clip === 0,
    `state=${s.state} at ${s.x.toFixed(1)},${s.z.toFixed(1)} ${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // The mug on the table is solid all round.
  const s = riderFor();
  place(s, 112, 50, Math.PI / 2, 50);
  const log = run(s, 1, () => ({}));
  check('the mug is solid', Math.hypot(s.x - 112, s.z - 70) > 4.2 && log.clip === 0,
    `at ${s.x.toFixed(1)},${s.z.toFixed(1)} ${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Ollie onto the closed laptop and roll across it.
  const s = riderFor();
  place(s, -64, 28, Math.PI / 2, 50);
  let onTop = false;
  const log = run(s, 1.2, (r, t) => {
    if (r.state === 'ground' && Math.abs(r.y - 1.6) < 0.05) onTop = true;
    return { ollie: t > 0.05 && t < 0.25 };
  });
  check('ollie onto the laptop', onTop && log.clip === 0 && count(log, 'bail') === 0,
    `bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Auto-push keeps a stopped board rolling on the flat; spin assist turns a
  // short spin into a clean 180.
  const s = riderFor();
  place(s, -80, -12, 0, 0);
  run(s, 2, () => ({ autoPush: true }));
  check('auto-push rolls you up to cruising speed', s.speed > 40, `speed=${s.speed.toFixed(1)}`);

  const r = riderFor();
  place(r, -80, -12, 0, 45);
  const log = run(r, 1.4, (b, t) => ({
    ollie: t < 0.4,
    spinAssist: true,
    steer: b.state === 'air' && Math.abs(b.spinTotal) < 2.4 ? 1 : 0, // stops at ~140 degrees
  }));
  const lands = log.events.filter((e) => e.type === 'land');
  check('spin assist finishes a short 180', lands.some((e) => e.label.startsWith('180')) && count(log, 'bail') === 0,
    `${lands.map((e) => e.label).join(', ')} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Ollie onto the down-rail from the platform: the tail meets the sloping
  // bar before the middle does, and that is still a grind, not a hang-up.
  const s = riderFor();
  place(s, -6, 64, 0, 45);
  const log = run(s, 1.2, (r) => ({ ollie: r.x < 2 }));
  const grinds = log.events.filter((e) => e.type === 'grindStart');
  check('ollie onto the handrail grinds it', grinds.length > 0 && count(log, 'bail') === 0 && log.clip === 0,
    `${grinds.map((g) => `${g.style} ${g.name}`).join(', ') || 'no grind'} bails=${log.events.filter((e) => e.type === 'bail').map((e) => e.reason)}`);
}

{
  // Every letter can be had, each with a line that takes a trick to ride.
  const lines = [
    { letter: 'S', at: [-80, 24, 0, 60], policy: (r) => ({ throttle: 1, ollie: r.x < -57 }) },
    { letter: 'K', at: [0, -50, 0, 55], policy: (r, t) => ({ ollie: t > 0.05 && t < 0.2 }) },
    { letter: 'A', at: [-40, 0, 0, 60], policy: (r) => ({ throttle: 1, ollie: r.x > -8 && r.x < -3 }) },
    { letter: 'T', at: [-60, -20, Math.PI, 74], policy: () => ({ throttle: 1 }), seconds: 3 },
    { letter: 'E', at: [-6, 64, 0, 45], policy: (r) => ({ ollie: r.x < 2 }) },
  ];
  const got = [];
  for (const line of lines) {
    const s = riderFor();
    place(s, ...line.at);
    const log = run(s, line.seconds ?? 2, line.policy);
    if (log.events.some((e) => e.type === 'letter' && e.letter === line.letter)) got.push(line.letter);
  }
  check('every letter is reachable', got.length === lines.length, `got ${got.join('') || 'none'}`);
}

/* -------------------------------------------------------- random sessions */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPolicy(seed) {
  const random = mulberry(seed);
  let steer = 0;
  let nextSteer = 0;
  let ollieUntil = -1;
  let nextOllie = 1;
  const ids = ['kickflip', 'heelflip', 'shuvit', 'treflip'];
  return (s, t) => {
    if (t > nextSteer) {
      steer = random() < 0.4 ? 0 : (random() * 2 - 1);
      nextSteer = t + 0.3 + random() * 1.2;
    }
    if (t > nextOllie) {
      ollieUntil = t + 0.1 + random() * 0.3;
      nextOllie = t + 0.8 + random() * 1.5;
    }
    const tricks = s.state === 'air' && random() < 0.02 ? [ids[Math.floor(random() * ids.length)]] : [];
    return { steer, throttle: random() < 0.85 ? 1 : 0, ollie: t < ollieUntil, tricks };
  };
}

let totalClip = 0;
let totalSteps = 0;
const tally = {};
const bails = {};
for (const shape of [{}, { length: 8.4, width: 2.6, kickHeight: 1.1 }, { length: 10.4, width: 3.4, kickHeight: 0.4 }]) {
  for (let seed = 1; seed <= Number(process.env.SEEDS ?? 4); seed += 1) {
    const s = riderFor(shape);
    const log = run(s, 90, randomPolicy(seed * 97 + (shape.length ?? 0)));
    totalClip += log.clip;
    totalSteps += log.steps;
    for (const e of log.events) {
      tally[e.type] = (tally[e.type] ?? 0) + 1;
      if (e.type === 'bail') bails[e.reason] = (bails[e.reason] ?? 0) + 1;
    }
    if (log.clip) console.log(`  clip seed ${seed} ${JSON.stringify(shape)}: ${log.clip} steps, worst ${log.worst.toFixed(2)} at ${JSON.stringify(log.worstAt)}`);
  }
}
console.log(`\nrandom sessions: ${totalClip} / ${totalSteps} steps clipping`);
console.log(`events ${JSON.stringify(tally)}`);
console.log(`bails ${JSON.stringify(bails)}`);
check('no clipping in random sessions', totalClip === 0);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall park checks passed');
