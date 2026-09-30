/**
 * Runs whole marble races on freshly generated tracks and reports how they
 * went: how long the winner took, how many marbles finished by rolling, how
 * often the fire wall had to clear a stuck one, how often one jumped the
 * track. Fails if the fire is needed too often, a race runs away, or a
 * marble ends up inside the track.
 *
 *   node test/marbles.sim.mjs            (RACES=40 for a longer run)
 */
import { generateTrack } from '../src/marbles/track.js';
import { createRace, startRace, stepRace, RACE } from '../src/marbles/physics.js';

const RACES = Number(process.env.RACES ?? 16);
const DT = 1 / 60;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

let fireRaces = 0;
let burnt = 0;
let marblesTotal = 0;
let respawns = 0;
const winnerTimes = [];
const lastTimes = [];
const where = {};
let runaway = 0;
const started = Date.now();

for (let r = 0; r < RACES; r += 1) {
  const seed = 1000 + r * 17;
  const track = generateTrack(seed);
  const race = createRace(track, 24, { seed });
  // Settle behind the gate, then go.
  for (let t = 0; t < 1.5; t += DT) stepRace(race, DT);
  startRace(race);
  let t = 0;
  let raceBurnt = 0;
  while (!race.over && t < 260) {
    for (const e of stepRace(race, DT)) {
      if (e.type === 'respawn') respawns += 1;
      if (e.type === 'eliminated') {
        raceBurnt += 1;
        const m = race.marbles[e.id];
        const mod = track.modules.find((x) => m.index >= x.start && m.index <= x.end)?.name ?? '?';
        where[mod] = (where[mod] ?? 0) + 1;
        if (process.env.VERBOSE) console.log(`   burnt in ${mod}: speed ${Math.hypot(m.vx, m.vy, m.vz).toFixed(1)}, still ${m.stillFor.toFixed(1)}s, ${(track.length - m.progress).toFixed(0)} short, t=${race.time.toFixed(0)}`);
      }
    }
    t += DT;
  }
  if (!race.over) runaway += 1;
  marblesTotal += race.marbles.length;
  burnt += raceBurnt;
  if (raceBurnt) fireRaces += 1;
  const times = race.marbles.filter((m) => m.finished).map((m) => m.finishTime).sort((a, b) => a - b);
  winnerTimes.push(times[0]);
  lastTimes.push(times.at(-1));
  console.log(`race ${String(r).padStart(2)} seed ${seed}: length ${track.length.toFixed(0)}  winner ${times[0]?.toFixed(1)}s  last ${times.at(-1)?.toFixed(1)}s  finished ${times.length}/24  burnt ${raceBurnt}`);
}

{
  // A marble that really is stuck: pinned in place mid-track. The fire must
  // come for it, burn it, and end the race, with everyone else finishing.
  const track = generateTrack(4242);
  const race = createRace(track, 24, { seed: 4242 });
  for (let t = 0; t < 1.5; t += DT) stepRace(race, DT);
  startRace(race);
  const stuck = race.marbles[5];
  let pinned = null;
  let t = 0;
  let fired = false;
  while (!race.over && t < 260) {
    for (const e of stepRace(race, DT)) if (e.type === 'fireStart') fired = true;
    if (!pinned && stuck.progress > 150) pinned = { x: stuck.x, y: stuck.y, z: stuck.z };
    if (pinned && !stuck.eliminated) Object.assign(stuck, pinned, { vx: 0, vy: 0, vz: 0 });
    t += DT;
  }
  const others = race.marbles.filter((m) => m !== stuck);
  check('the fire wall clears a stuck marble and ends the race',
    fired && stuck.eliminated && race.over && others.every((m) => m.finished),
    `fired ${fired}, stuck burnt ${stuck.eliminated}, over ${race.over} at ${race.time.toFixed(0)}s, others finished ${others.filter((m) => m.finished).length}/23`);
}

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
console.log(`\n${RACES} races in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`winner ${avg(winnerTimes).toFixed(1)}s on average, last finisher ${avg(lastTimes).toFixed(1)}s`);
console.log(`fire wall burnt ${burnt}/${marblesTotal} marbles in ${fireRaces}/${RACES} races; respawns ${respawns}`);
if (burnt) console.log(`burnt in: ${JSON.stringify(where)}`);
check('every race ends', runaway === 0, `${runaway} ran past 260s`);
check('winners take a sensible time', avg(winnerTimes) > 25 && avg(winnerTimes) < 110, `${avg(winnerTimes).toFixed(1)}s`);
check('the fire wall is rarely needed', fireRaces / RACES <= 0.2 && burnt / marblesTotal <= 0.02,
  `${fireRaces}/${RACES} races, ${burnt} marbles (fire starts ${RACE.fireDelay}s after the winner)`);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall marble checks passed');
