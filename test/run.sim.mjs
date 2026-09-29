import { createTrack } from '../src/game/track.js';
import { createSkater, stepSkater, PHYSICS } from '../src/game/skater.js';

const DT = 1 / 120;

/** Run a scripted policy for `seconds` and report what happened. */
function run(label, policy, { seconds = 90, seed = 7 } = {}) {
  const track = createTrack({ seed });
  const s = createSkater();
  const tally = { pop: 0, land: 0, bail: 0, trick: 0, grindStart: 0, reasons: {} };
  let maxY = 0, maxAir = 0, holdUntil = -1;

  for (let t = 0; t < seconds; t += DT) {
    track.ensureAhead(s.x);
    track.prune(s.x);
    const input = policy(s, t, track, (until) => { holdUntil = until; });
    const events = stepSkater(s, DT, track, { hold: t < holdUntil, tricks: input.tricks ?? [] });
    for (const e of events) {
      if (tally[e.type] !== undefined) tally[e.type] += 1;
      if (e.type === 'bail') tally.reasons[e.reason] = (tally.reasons[e.reason] ?? 0) + 1;
      if (e.type === 'land') maxAir = Math.max(maxAir, e.airTime);
    }
    maxY = Math.max(maxY, s.y);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) throw new Error(`${label}: NaN at t=${t.toFixed(2)}`);
  }
  console.log(`${label.padEnd(22)} score=${String(Math.round(s.score)).padStart(6)} dist=${Math.round(s.distance).toString().padStart(5)} ` +
    `pops=${tally.pop} lands=${tally.land} bails=${tally.bail} grinds=${tally.grindStart} tricks=${tally.trick} maxAir=${maxAir.toFixed(2)}s maxY=${maxY.toFixed(1)}`);
  if (Object.keys(tally.reasons).length) console.log(`  bail reasons: ${JSON.stringify(tally.reasons)}`);
  return { s, tally, maxAir };
}

// 1. Do nothing: should roll, survive ramps, and only bail on ledges/gaps.
run('idle', () => ({}));

// 2. Ollie on a timer, no tricks: should land most of them.
{
  let next = 0.8, held = false, holdStart = 0;
  run('ollie only', (s, t, track, setHold) => {
    if (!held && t >= next) { held = true; holdStart = t; setHold(t + 0.18); }
    if (held && t > holdStart + 0.2) { held = false; next = t + 1.1; }
    return {};
  });
}

// 3. Charge fully and throw one kickflip per air: the core loop.
{
  let held = false, holdStart = 0, next = 0.9, thrown = false;
  run('charge + kickflip', (s, t, track, setHold) => {
    if (s.state !== 'air' && !held && t >= next) { held = true; holdStart = t; setHold(t + PHYSICS.chargeTime); }
    if (held && t > holdStart + PHYSICS.chargeTime) { held = false; next = t + 1.2; thrown = false; }
    if (s.state === 'air' && !thrown && s.airTime > 0.02) { thrown = true; return { tricks: ['kickflip'] }; }
    return {};
  });
}

// 4. Greedy: two tricks every air, which should need a full charge to land.
{
  let held = false, holdStart = 0, next = 0.9, thrown = false;
  run('charge + varial', (s, t, track, setHold) => {
    if (s.state !== 'air' && !held && t >= next) { held = true; holdStart = t; setHold(t + PHYSICS.chargeTime); }
    if (held && t > holdStart + PHYSICS.chargeTime) { held = false; next = t + 1.2; thrown = false; }
    if (s.state === 'air' && !thrown && s.airTime > 0.02) { thrown = true; return { tricks: ['kickflip', 'shuvit'] }; }
    return {};
  });
}

// 5. Spam: far too many rotations to land, should bail constantly but never break.
{
  let held = false, holdStart = 0;
  run('spam', (s, t, track, setHold) => {
    if (s.state !== 'air' && !held) { held = true; holdStart = t; setHold(t + 0.05); }
    if (held && t > holdStart + 0.06) held = false;
    if (s.state === 'air') return { tricks: ['bigspin', 'kickflip'] };
    return {};
  });
}

// Feature mix actually generated.
{
  const track = createTrack({ seed: 7 });
  track.ensureAhead(2600, 0);
  const counts = {};
  for (const f of track.features) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  console.log('\nfeature mix over 2600 units:', JSON.stringify(counts));
}
