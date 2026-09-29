/**
 * Clip detector. Runs whole simulated runs and, every physics step, checks
 * whether any part of the board is inside solid geometry: the wheels and the
 * centre against every surface, the nose and tail (with the deck's own lift)
 * against square-edged obstacles, and anything at all inside a rail span
 * below the bar. Reports how many steps were spent clipping, per policy.
 */
import { createTrack } from '../src/game/track.js';
import { createSkater, stepSkater, PHYSICS } from '../src/game/skater.js';
import { resolveShape, noseLiftFor } from '../src/lib/geometry.js';

const DT = 1 / 120;
const SLACK = 0.25;

/** Physics for a board of this shape, measured from the real deck geometry. */
function skaterFor(shape = {}) {
  const spec = resolveShape(shape);
  return createSkater({
    wheelbase: spec.wheelbase,
    length: spec.length,
    width: spec.width,
    height: Math.abs(spec.groundY),
    noseLift: noseLiftFor(spec),
  });
}

function solidTop(track, x) {
  const feature = track.featureAt(x);
  if (!feature) return 0;
  if (feature.kind === 'gap') return -Infinity;
  return track.surfacesAt(x)[0].y;
}

/** Every way the board can be inside something at this instant. */
function clipsAt(track, s) {
  const found = [];
  const tan = Math.tan(s.pitch);
  const { halfBase, halfLength, noseLift } = s;
  const grindDrop = 0; // visual-only offsets are not physics

  for (const [name, offset] of [['back wheel', -halfBase], ['centre', 0], ['front wheel', halfBase]]) {
    const x = s.x + offset;
    const y = s.y + offset * tan - grindDrop;
    const top = solidTop(track, x);
    if (y < top - SLACK) found.push(`${name} in ${track.featureAt(x)?.kind ?? 'table'}`);
  }
  for (const [name, offset] of [['tail', -halfLength], ['nose', halfLength]]) {
    const x = s.x + offset;
    const feature = track.featureAt(x);
    if (!feature || !['ledge', 'rail'].includes(feature.kind)) continue;
    const y = s.y + offset * tan + noseLift;
    if (y < feature.height - SLACK) found.push(`${name} in ${feature.kind}`);
  }
  return found;
}

function run(label, policy, { seconds = 90, seed = 7, shape = {} } = {}) {
  const track = createTrack({ seed });
  const s = skaterFor(shape);
  let holdUntil = -1;
  let steps = 0;
  let clipSteps = 0;
  const kinds = {};
  const bails = {};

  for (let t = 0; t < seconds; t += DT) {
    track.ensureAhead(s.x);
    track.prune(s.x);
    const input = policy(s, t, track, (until) => { holdUntil = until; });
    const events = stepSkater(s, DT, track, { hold: t < holdUntil, tricks: input.tricks ?? [] });
    for (const e of events) if (e.type === 'bail') bails[e.reason] = (bails[e.reason] ?? 0) + 1;

    steps += 1;
    const clips = clipsAt(track, s);
    if (clips.length) {
      clipSteps += 1;
      for (const clip of clips) kinds[clip] = (kinds[clip] ?? 0) + 1;
    }
  }

  const pct = ((clipSteps / steps) * 100).toFixed(2);
  console.log(`${label.padEnd(12)} clipping ${String(clipSteps).padStart(5)} / ${steps} steps (${pct}%)  score=${Math.round(s.score)}`);
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) console.log(`             ${top.map(([k, n]) => `${k}: ${n}`).join(' · ')}`);
  if (Object.keys(bails).length) console.log(`             bails ${JSON.stringify(bails)}`);
  return { clipSteps, steps, score: s.score, bails };
}

/** Pops when the next thing that needs clearing is just ahead of the nose. */
function competent() {
  let held = false;
  let release = 0;
  let thrown = false;
  return (s, t, track, setHold) => {
    if (s.state === 'air' && !thrown && s.airTime > 0.03) {
      thrown = true;
      return { tricks: ['kickflip'] };
    }
    if (s.state === 'air') return {};
    thrown = false;
    if (held) {
      if (t >= release) held = false;
      return {};
    }
    const nose = s.x + s.halfLength;
    const next = track.features.find((f) => f.start > nose - 0.5 && ['ledge', 'rail', 'gap'].includes(f.kind));
    if (!next) return {};
    const distance = next.start - nose;
    const charge = next.kind === 'gap' ? PHYSICS.chargeTime : 0.12;
    const lead = next.kind === 'gap' ? 14 : 5;
    if (distance > 0 && distance < lead) {
      held = true;
      release = t + charge;
      setHold(release);
    }
    return {};
  };
}

const results = {
  idle: run('idle', () => ({})),
  blind: (() => {
    let next = 0.8;
    let holding = false;
    let start = 0;
    return run('blind ollie', (s, t, track, setHold) => {
      if (!holding && t >= next) { holding = true; start = t; setHold(t + 0.18); }
      if (holding && t > start + 0.2) { holding = false; next = t + 1.1; }
      return {};
    });
  })(),
  competent: run('competent', competent()),
};

function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

// Several seeds for the policy a real player is closest to.
let total = 0;
let clipped = 0;
for (const seed of [1, 2, 3, 4, 5]) {
  const r = quietly(() => run('', competent(), { seed }));
  total += r.steps;
  clipped += r.clipSteps;
}
console.log(`\ncompetent over 5 more seeds: ${clipped} / ${total} steps clipping (${((clipped / total) * 100).toFixed(2)}%)`);

// The Shape tab can make the board lower, taller, longer or wider, and every
// one of those moves where the nose, tail and wheels are. Check the extremes.
const SHAPES = {
  'low and mellow': { axleDrop: 0.48, wheelRadius: 0.3, kickHeight: 0.3, concave: 0 },
  'tall and steep': { axleDrop: 0.92, wheelRadius: 0.52, kickHeight: 1.15, concave: 0.22 },
  'long and wide': { length: 11, width: 3.8, wheelbase: 3.4 },
  'short and narrow': { length: 8.6, width: 2.6, wheelbase: 2.0 },
};
for (const [name, shape] of Object.entries(SHAPES)) {
  let shapeClips = 0;
  let shapeSteps = 0;
  for (const seed of [1, 2, 3]) {
    for (const policy of [() => ({}), competent()]) {
      const r = quietly(() => run('', policy, { seed, shape }));
      shapeClips += r.clipSteps;
      shapeSteps += r.steps;
    }
  }
  clipped += shapeClips;
  console.log(`${name.padEnd(18)} ${shapeClips} / ${shapeSteps} steps clipping`);
}

const worst = Math.max(...Object.values(results).map((r) => r.clipSteps)) + clipped;
process.exitCode = worst > 0 ? 1 : 0;
