/**
 * The rules behind coins, XP, levels, missions, the daily reward, the shop
 * and capsules — all pure, so checked here without a browser.
 *
 *   node test/progression.test.mjs
 */
import {
  newSave, migrate, levelInfo, xpToNext, START_LEVEL, START_XP, applyRace, claimMission, refreshDay, dailyStatus, claimDaily,
  openCapsule, buyMarble, buyTrail, payEntry, LEAGUES, prizeFor, dealMissions, dailyDeal, createProfileStore, MISSION_POOL,
} from '../src/marbles/progression.js';

const NAMES = ['Ruby', 'Cobalt', 'Jade', 'Sunny', 'Onyx', 'Pearl', 'Chrome', 'Goldie', 'Galaxy', 'Lava', 'Frost', 'Zebra',
  'Dotty', 'Candy', 'Tiger', 'Mint', 'Plum', 'Coral', 'Storm', 'Rainbow', 'Checkers', 'Earth', 'Eight', 'Cat’s Eye',
  'Aurora', 'Nebula', 'Plasma', 'Toxic', 'Circuit', 'Sakura', 'Honey', 'Hologram'];
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const day = '2026-05-10';
const s = newSave(NAMES);
check('a new player owns the four starters and races with one', s.owned.length === 4 && s.owned.includes(s.marble));
check('a new player starts at level 15 with every league open', levelInfo(s.xp).level === START_LEVEL && levelInfo(s.xp).into === 0);
check('an older, lower save catches up to level 15', levelInfo(migrate({ xp: 120 }, NAMES).xp).level === START_LEVEL
  && migrate({ xp: START_XP + 999 }, NAMES).xp === START_XP + 999);
check('levels follow the XP curve', levelInfo(0).level === 1 && levelInfo(xpToNext(1)).level === 2 && levelInfo(xpToNext(1) - 1).level === 1);

// A win in the Rookie Cup.
refreshDay(s, day);
const before = s.coins;
const report = applyRace(s, { mode: 'league', league: 'rookie', place: 1, racers: 12, time: 40, counts: { trackCoins: 12, items: 3, bumpers: 2, boosts: 1, shockHits: 0, overtakes: 5 } }, day);
check('a win pays the top prize plus coins picked up', report.coins === prizeFor(LEAGUES[0], 1) + 12, `${report.coins}`);
check('and the coins land in the save', s.coins >= before + report.coins, `${before} -> ${s.coins}`);
check('a win counts as a win, a podium and top half', s.stats.wins === 1 && s.stats.podiums === 1 && s.stats.topHalf === 1);
check('XP is earned', report.xp > 0 && s.xp === START_XP + report.xp, `${report.xp}`);

// Last place still earns something; burnt counts as last.
const r2 = applyRace(s, { mode: 'league', league: 'rookie', place: 5, racers: 12, burnt: true, counts: {} }, day);
check('being burnt pays the last-place prize', r2.prize === prizeFor(LEAGUES[0], 12), `${r2.prize}`);

// Missions progress and can be claimed once.
const m = s.missions.list[0];
const def = MISSION_POOL.find((x) => x.id === m.id);
m.progress = def.target;
const coins = s.coins;
const claim = claimMission(s, m.id);
check('a finished mission pays out once', claim && s.coins === coins + def.coins + claim.levels.reduce((a, l) => a + l.coins, 0) && claimMission(s, m.id) === null);
check('three different missions a day', new Set(dealMissions(day).map((x) => MISSION_POOL.find((p) => p.id === x.id).stat)).size === 3);
check('the same missions all day, different the next', JSON.stringify(dealMissions(day)) === JSON.stringify(dealMissions(day)) && JSON.stringify(dealMissions(day)) !== JSON.stringify(dealMissions('2026-05-11')));

// Daily reward and the streak.
const d = newSave(NAMES);
check('the daily reward is ready on day one', dailyStatus(d, day).available);
claimDaily(d, day);
check('and only once a day', !dailyStatus(d, day).available && claimDaily(d, day) === null);
claimDaily(d, '2026-05-11');
check('coming back the next day builds the streak', d.daily.streak === 2);
claimDaily(d, '2026-05-14');
check('missing a day starts it again', d.daily.streak === 1);

// Levelling up pays out.
const l = newSave(NAMES);
// One XP short of level 3: a party race (40 XP) takes it there.
l.xp = xpToNext(1) + xpToNext(2) - 1;
const lc = l.coins;
const lv = applyRace(l, { mode: 'party', counts: {} }, day);
check('levelling up pays coins and reports the level', lv.levels.length === 1 && lv.levels[0].level === 3 && l.coins === lc + lv.coins + lv.levels[0].coins, `${lv.levels.map((x) => x.level)}`);
check('reaching a league\'s level unlocks it', lv.levels[0].unlocks.includes(LEAGUES[1].name));

// Shop.
const b = newSave(NAMES);
b.coins = 10000;
const chromeId = NAMES.indexOf('Chrome');
check('buying a marble adds it to the collection', buyMarble(b, chromeId, 'Chrome') && b.owned.includes(chromeId));
check('you cannot buy it twice', !buyMarble(b, chromeId, 'Chrome'));
check('trails can be bought', buyTrail(b, 'flame') && b.trails.includes('flame') && !buyTrail(b, 'flame'));
const poor = newSave(NAMES);
poor.coins = 10;
check('an entry fee needs the coins', !payEntry(poor, LEAGUES[1]) && poor.coins === 10 && payEntry(poor, LEAGUES[0]));
check('the daily deal is a marble you do not own, 40% off', (() => { const deal = dailyDeal(b, NAMES, day); return deal && !b.owned.includes(deal.id) && deal.price < deal.full; })());

// Capsules: every roll is a real marble; duplicates refund.
const c = newSave(NAMES);
c.coins = 1e6;
let dupes = 0;
for (let i = 0; i < 300; i += 1) {
  const out = openCapsule(c, NAMES, Math.random, { buy: true });
  if (!out || out.id < 0 || out.id >= NAMES.length) { check('capsule rolls a marble', false); break; }
  if (out.duplicate) dupes += 1;
}
check('capsules fill the collection over time', c.owned.length > 20, `${c.owned.length}/${NAMES.length}, ${dupes} duplicates`);
check('an unaffordable capsule does nothing', openCapsule(newSave(NAMES), NAMES, Math.random, { buy: true }) === null);

// Saves survive storage and old versions.
const store = new Map();
const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const p1 = createProfileStore(NAMES, storage);
p1.save.coins = 1234;
p1.commit();
check('progress is saved and read back', createProfileStore(NAMES, storage).save.coins === 1234);
check('a broken save starts fresh', createProfileStore(NAMES, { getItem: () => '{nope', setItem() {} }).save.coins === newSave(NAMES).coins);
const old = migrate({ coins: 5, owned: [99, 1], marble: 99 }, NAMES);
check('an old save is filled in and cleaned up', old.coins === 5 && old.owned.every((i) => i < NAMES.length) && old.owned.includes(old.marble) && old.settings.sound === true);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall progression checks passed');
