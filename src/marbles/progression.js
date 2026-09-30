/**
 * Everything you earn and keep: coins, XP and levels, the marbles and trails
 * you own, leagues, daily missions and the daily login reward.
 *
 * Pure: the save is a plain object and every rule is a function of it (and
 * of today's date, passed in), so all of it runs in a Node test. The only
 * I/O is `createProfileStore`, which reads and writes one localStorage key.
 */

/* ------------------------------------------------------------- marbles */

export const RARITY = {
  common: { label: 'Common', price: 250, colour: '#9aa7b8', weight: 60 },
  rare: { label: 'Rare', price: 700, colour: '#3fa0ff', weight: 28 },
  epic: { label: 'Epic', price: 1800, colour: '#b35cff', weight: 10 },
  legendary: { label: 'Legendary', price: 4500, colour: '#ffb020', weight: 2 },
};

/** Rarity by marble name (names match designs.js; order there is the id). */
const RARITY_OF = {
  Ruby: 'common', Cobalt: 'common', Jade: 'common', Sunny: 'common', Onyx: 'common', Pearl: 'common',
  Zebra: 'common', Dotty: 'common', Mint: 'common', Plum: 'common', Coral: 'common', Honey: 'common',
  Chrome: 'rare', Frost: 'rare', Candy: 'rare', Tiger: 'rare', Checkers: 'rare', Earth: 'rare', Sakura: 'rare', Eight: 'rare',
  Goldie: 'epic', Lava: 'epic', Storm: 'epic', Rainbow: 'epic', 'Cat’s Eye': 'epic', Toxic: 'epic', Circuit: 'epic',
  Galaxy: 'legendary', Aurora: 'legendary', Nebula: 'legendary', Plasma: 'legendary', Hologram: 'legendary',
};

export const STARTERS = ['Ruby', 'Cobalt', 'Jade', 'Sunny'];

export function rarityOf(name) {
  return RARITY_OF[name] ?? 'common';
}

/* -------------------------------------------------------------- trails */

export const TRAILS = [
  { id: 'none', name: 'None', price: 0, colours: [] },
  { id: 'spark', name: 'Sparkle', price: 400, colours: ['#fff6c2', '#ffd84d'] },
  { id: 'flame', name: 'Flame', price: 900, colours: ['#ffe066', '#ff7a1a', '#ff2d1a'] },
  { id: 'ice', name: 'Frostbite', price: 900, colours: ['#ffffff', '#8fdcff', '#3f8cff'] },
  { id: 'neon', name: 'Neon', price: 1500, colours: ['#00e5ff', '#ff2bd6'] },
  { id: 'toxic', name: 'Toxic', price: 1500, colours: ['#e6ff5c', '#3dff6e'] },
  { id: 'rainbow', name: 'Rainbow', price: 3000, colours: ['#ff3b3b', '#ffb020', '#ffe93b', '#3dff6e', '#3fa0ff', '#b35cff'] },
];

/* ------------------------------------------------------------- leagues */

export const LEAGUES = [
  {
    id: 'rookie', name: 'Rookie Cup', level: 1, fee: 0, racers: 12, world: 'meadow',
    length: [380, 470], skill: 0.35, top: 150, xp: 1,
  },
  {
    id: 'pro', name: 'Pro Circuit', level: 3, fee: 60, racers: 16, world: 'desert',
    length: [450, 560], skill: 0.5, top: 420, xp: 1.25,
  },
  {
    id: 'elite', name: 'Glacier Series', level: 6, fee: 180, racers: 16, world: 'snow',
    length: [500, 620], skill: 0.65, top: 1000, xp: 1.5,
  },
  {
    id: 'master', name: 'Neon Masters', level: 10, fee: 450, racers: 20, world: 'neon',
    length: [520, 660], skill: 0.8, top: 2400, xp: 1.8,
  },
  {
    id: 'champion', name: 'Volcano Champions', level: 15, fee: 1100, racers: 24, world: 'volcano',
    length: [560, 720], skill: 0.92, top: 5600, xp: 2.2,
  },
];

/** Share of the top prize for 1st, 2nd, 3rd…; everyone else gets the last. */
const PRIZE_SHARE = [1, 0.62, 0.42, 0.28, 0.2, 0.15, 0.12, 0.1];
const PARTICIPATION = 0.05;

export function prizeFor(league, place) {
  const share = PRIZE_SHARE[place - 1] ?? PARTICIPATION;
  return Math.round(league.top * share);
}

/* -------------------------------------------------------------- levels */

export const MAX_LEVEL = 60;

/** XP to go from `level` to the next one. */
export function xpToNext(level) {
  return Math.round(90 + level * 45 + level * level * 3);
}

export function levelInfo(xp) {
  let level = 1;
  let left = xp;
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level += 1;
  }
  const need = xpToNext(level);
  return { level, into: left, need, fraction: level >= MAX_LEVEL ? 1 : left / need };
}

/** What reaching `level` gives you. */
export function levelReward(level) {
  const reward = { coins: 100 + level * 40, capsule: level % 5 === 0, unlocks: [] };
  for (const league of LEAGUES) if (league.level === level) reward.unlocks.push(league.name);
  return reward;
}

/* ------------------------------------------------------------ missions */

/**
 * Daily missions. `stat` names what a race report counts; `target` is how
 * many. Three are dealt each day from this pool.
 */
export const MISSION_POOL = [
  { id: 'race3', text: 'Race 3 times', stat: 'races', target: 3, coins: 120, xp: 60 },
  { id: 'race5', text: 'Race 5 times', stat: 'races', target: 5, coins: 200, xp: 90 },
  { id: 'podium2', text: 'Finish on the podium twice', stat: 'podiums', target: 2, coins: 220, xp: 100 },
  { id: 'win1', text: 'Win a race', stat: 'wins', target: 1, coins: 250, xp: 120 },
  { id: 'tophalf3', text: 'Finish in the top half 3 times', stat: 'topHalf', target: 3, coins: 160, xp: 80 },
  { id: 'coins40', text: 'Collect 40 coins on the track', stat: 'trackCoins', target: 40, coins: 150, xp: 70 },
  { id: 'coins80', text: 'Collect 80 coins on the track', stat: 'trackCoins', target: 80, coins: 240, xp: 110 },
  { id: 'items5', text: 'Use 5 power-ups', stat: 'items', target: 5, coins: 140, xp: 70 },
  { id: 'items12', text: 'Use 12 power-ups', stat: 'items', target: 12, coins: 230, xp: 110 },
  { id: 'bumpers15', text: 'Hit 15 bumpers', stat: 'bumpers', target: 15, coins: 130, xp: 60 },
  { id: 'boosts10', text: 'Roll over 10 boost pads', stat: 'boosts', target: 10, coins: 130, xp: 60 },
  { id: 'shock3', text: 'Hit 3 rivals with a shockwave', stat: 'shockHits', target: 3, coins: 170, xp: 80 },
  { id: 'overtake20', text: 'Overtake 20 marbles', stat: 'overtakes', target: 20, coins: 160, xp: 80 },
  { id: 'party1', text: 'Play a party race', stat: 'party', target: 1, coins: 150, xp: 70 },
  { id: 'predict1', text: 'Predict a podium finish', stat: 'predictHits', target: 1, coins: 200, xp: 90 },
];

/** A small seeded generator, so a day's missions are the same all day. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
const hashDay = (day, salt = 0) => (dayNumber(day) * 2654435761 + salt) >>> 0;

/** Today's date as YYYY-MM-DD in the player's own time zone. */
export function today(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dealMissions(day) {
  const random = rng(hashDay(day, 17));
  const pool = [...MISSION_POOL];
  const picked = [];
  const stats = new Set();
  while (picked.length < 3 && pool.length) {
    const [m] = pool.splice(Math.floor(random() * pool.length), 1);
    // One mission per stat, so the three ask for different things.
    if (stats.has(m.stat)) continue;
    stats.add(m.stat);
    picked.push({ id: m.id, progress: 0, claimed: false });
  }
  return picked;
}

export const missionById = (id) => MISSION_POOL.find((m) => m.id === id);

/* --------------------------------------------------------------- daily */

export const DAILY = [
  { coins: 100 },
  { coins: 150 },
  { coins: 200 },
  { coins: 250, capsule: true },
  { coins: 350 },
  { coins: 450 },
  { coins: 800, capsule: true },
];

/* ---------------------------------------------------------------- save */

export const SAVE_VERSION = 1;

export function newSave(marbleNames) {
  const owned = STARTERS.map((n) => marbleNames.indexOf(n)).filter((i) => i >= 0);
  return {
    v: SAVE_VERSION,
    name: 'You',
    coins: 300,
    xp: 0,
    owned,
    marble: owned[0] ?? 0,
    trails: ['none'],
    trail: 'none',
    capsules: 0,
    league: 'rookie',
    stats: {
      races: 0, wins: 0, podiums: 0, topHalf: 0, trackCoins: 0, items: 0, bumpers: 0, boosts: 0,
      shockHits: 0, overtakes: 0, party: 0, predictHits: 0, coinsEarned: 0, bestPlace: null, fastest: null,
    },
    daily: { last: null, streak: 0 },
    missions: { day: null, list: [] },
    settings: { sound: true, music: true, haptics: true, quality: 'auto', steering: true },
    tutorial: false,
    seenLevel: 1,
  };
}

/** Fill in anything an older save is missing. */
export function migrate(save, marbleNames) {
  const fresh = newSave(marbleNames);
  if (!save || typeof save !== 'object') return fresh;
  const merged = { ...fresh, ...save };
  merged.stats = { ...fresh.stats, ...(save.stats ?? {}) };
  merged.daily = { ...fresh.daily, ...(save.daily ?? {}) };
  merged.missions = { ...fresh.missions, ...(save.missions ?? {}) };
  merged.settings = { ...fresh.settings, ...(save.settings ?? {}) };
  merged.owned = [...new Set((save.owned ?? fresh.owned).filter((i) => Number.isInteger(i) && i >= 0 && i < marbleNames.length))];
  if (!merged.owned.length) merged.owned = fresh.owned;
  if (!merged.owned.includes(merged.marble)) merged.marble = merged.owned[0];
  if (!Array.isArray(merged.trails) || !merged.trails.includes('none')) merged.trails = ['none', ...(merged.trails ?? [])];
  if (!merged.trails.includes(merged.trail)) merged.trail = 'none';
  merged.v = SAVE_VERSION;
  return merged;
}

/** Deal today's missions if the day has turned. */
export function refreshDay(save, day) {
  if (save.missions.day !== day) {
    save.missions = { day, list: dealMissions(day) };
  }
  return save;
}

/** Can the daily reward be claimed, and which day of the week is it? */
export function dailyStatus(save, day) {
  const last = save.daily.last;
  if (last === day) return { available: false, index: (save.daily.streak - 1) % DAILY.length, streak: save.daily.streak };
  const continues = last !== null && dayNumber(day) - dayNumber(last) === 1;
  const streak = continues ? save.daily.streak + 1 : 1;
  return { available: true, index: (streak - 1) % DAILY.length, streak };
}

export function claimDaily(save, day) {
  const status = dailyStatus(save, day);
  if (!status.available) return null;
  const reward = DAILY[status.index];
  save.daily = { last: day, streak: status.streak };
  save.coins += reward.coins;
  if (reward.capsule) save.capsules += 1;
  return { ...reward, day: status.index + 1 };
}

export function leagueById(id) {
  return LEAGUES.find((l) => l.id === id) ?? LEAGUES[0];
}

export function leagueUnlocked(save, league) {
  return levelInfo(save.xp).level >= league.level;
}

/**
 * Credit a finished race. `result`:
 *   mode: 'league' | 'party' | 'predict'
 *   league: league id (league mode)
 *   place, racers: your finish (league mode)
 *   burnt: caught by the fire
 *   time: your finish time
 *   counts: { trackCoins, items, bumpers, boosts, shockHits, overtakes }
 *   predict: { hit: 'win' | 'podium' | null } (predict mode)
 * Returns the report the results screen shows.
 */
export function applyRace(save, result, day) {
  refreshDay(save, day);
  const before = levelInfo(save.xp).level;
  const counts = result.counts ?? {};
  const report = { coins: 0, xp: 0, prize: 0, trackCoins: counts.trackCoins ?? 0, levels: [], missions: [], bonus: [] };
  const tally = { races: 1, ...counts };

  if (result.mode === 'league') {
    const league = leagueById(result.league);
    const place = result.burnt ? result.racers : result.place;
    report.prize = prizeFor(league, place);
    const placeXp = Math.round((40 + Math.max(0, result.racers - place) * 8) * league.xp);
    report.xp += placeXp;
    if (place === 1) { tally.wins = 1; report.bonus.push({ label: 'Victory', xp: Math.round(40 * league.xp) }); }
    if (place <= 3) tally.podiums = 1;
    if (place <= Math.ceil(result.racers / 2)) tally.topHalf = 1;
    const best = save.stats.bestPlace;
    save.stats.bestPlace = best === null ? place : Math.min(best, place);
    if (!result.burnt && result.time && (save.stats.fastest === null || result.time < save.stats.fastest)) save.stats.fastest = result.time;
  } else if (result.mode === 'party') {
    tally.party = 1;
    report.xp += 40;
    report.prize = 60;
  } else if (result.mode === 'predict') {
    report.xp += 30;
    if (result.predict?.hit === 'win') { report.prize = 400; tally.predictHits = 1; }
    else if (result.predict?.hit === 'podium') { report.prize = 150; tally.predictHits = 1; }
  }
  for (const b of report.bonus) report.xp += b.xp ?? 0;
  report.xp += Math.round((counts.trackCoins ?? 0) / 4);
  report.coins = report.prize + (counts.trackCoins ?? 0);

  for (const [k, v] of Object.entries(tally)) {
    if (typeof save.stats[k] === 'number') save.stats[k] += v;
  }

  // Missions.
  for (const mission of save.missions.list) {
    const def = missionById(mission.id);
    if (!def || mission.claimed) continue;
    const was = mission.progress;
    mission.progress = Math.min(def.target, mission.progress + (tally[def.stat] ?? 0));
    if (was < def.target && mission.progress >= def.target) report.missions.push(def);
  }

  save.coins += report.coins;
  save.stats.coinsEarned += report.coins;
  save.xp += report.xp;
  const after = levelInfo(save.xp).level;
  for (let level = before + 1; level <= after; level += 1) {
    const reward = levelReward(level);
    save.coins += reward.coins;
    if (reward.capsule) save.capsules += 1;
    report.levels.push({ level, ...reward });
  }
  return report;
}

export function claimMission(save, id) {
  const mission = save.missions.list.find((m) => m.id === id);
  const def = missionById(id);
  if (!mission || !def || mission.claimed || mission.progress < def.target) return null;
  mission.claimed = true;
  const before = levelInfo(save.xp).level;
  save.coins += def.coins;
  save.xp += def.xp;
  const levels = [];
  for (let level = before + 1; level <= levelInfo(save.xp).level; level += 1) {
    const reward = levelReward(level);
    save.coins += reward.coins;
    if (reward.capsule) save.capsules += 1;
    levels.push({ level, ...reward });
  }
  return { coins: def.coins, xp: def.xp, levels };
}

/** Pay a league's entry fee. False if you can't afford it. */
export function payEntry(save, league) {
  if (save.coins < league.fee) return false;
  save.coins -= league.fee;
  return true;
}

export const CAPSULE_PRICE = 500;

/**
 * Open a capsule (one you own, or buy one): a random marble weighted by
 * rarity. A duplicate turns into coins.
 */
export function openCapsule(save, marbleNames, random = Math.random, { buy = false } = {}) {
  if (buy) {
    if (save.coins < CAPSULE_PRICE) return null;
    save.coins -= CAPSULE_PRICE;
  } else {
    if (save.capsules <= 0) return null;
    save.capsules -= 1;
  }
  const total = Object.values(RARITY).reduce((a, r) => a + r.weight, 0);
  let roll = random() * total;
  let rarity = 'common';
  for (const [key, r] of Object.entries(RARITY)) {
    roll -= r.weight;
    if (roll < 0) { rarity = key; break; }
  }
  const pool = marbleNames.map((n, i) => [n, i]).filter(([n]) => rarityOf(n) === rarity);
  const [name, id] = pool[Math.floor(random() * pool.length)];
  const duplicate = save.owned.includes(id);
  let refund = 0;
  if (duplicate) {
    refund = Math.round(RARITY[rarity].price * 0.3);
    save.coins += refund;
  } else {
    save.owned.push(id);
  }
  return { id, name, rarity, duplicate, refund };
}

export function buyMarble(save, id, name, price = RARITY[rarityOf(name)].price) {
  if (save.owned.includes(id) || save.coins < price) return false;
  save.coins -= price;
  save.owned.push(id);
  return true;
}

export function buyTrail(save, trailId) {
  const trail = TRAILS.find((t) => t.id === trailId);
  if (!trail || save.trails.includes(trailId) || save.coins < trail.price) return false;
  save.coins -= trail.price;
  save.trails.push(trailId);
  return true;
}

/** Today's deal: one marble you don't own, 40% off. */
export function dailyDeal(save, marbleNames, day) {
  const random = rng(hashDay(day, 99));
  const candidates = marbleNames.map((n, i) => i).filter((i) => !save.owned.includes(i));
  if (!candidates.length) return null;
  const id = candidates[Math.floor(random() * candidates.length)];
  const name = marbleNames[id];
  const full = RARITY[rarityOf(name)].price;
  return { id, name, full, price: Math.round(full * 0.6) };
}

/* --------------------------------------------------------------- store */

const SAVE_KEY = 'marble-mayhem:save:v1';

/** Load, keep and save the profile. Storage failures are survivable. */
export function createProfileStore(marbleNames, storage = globalThis.localStorage) {
  let save;
  try {
    save = migrate(JSON.parse(storage?.getItem(SAVE_KEY) ?? 'null'), marbleNames);
  } catch {
    save = newSave(marbleNames);
  }
  return {
    get save() {
      return save;
    },
    commit() {
      try {
        storage?.setItem(SAVE_KEY, JSON.stringify(save));
      } catch {
        /* storage blocked: progress holds for this visit */
      }
    },
    reset() {
      save = newSave(marbleNames);
      this.commit();
    },
  };
}

/* --------------------------------------------------------------- names */

const NAME_A = ['Swift', 'Lucky', 'Turbo', 'Glassy', 'Rolling', 'Shiny', 'Mighty', 'Sneaky', 'Cosmic', 'Wild', 'Mega', 'Tiny', 'Hyper', 'Fuzzy', 'Silent', 'Rapid', 'Jolly', 'Brave', 'Neon', 'Pixel'];
const NAME_B = ['Pebble', 'Comet', 'Bolt', 'Orb', 'Rocket', 'Spinner', 'Glider', 'Bouncer', 'Racer', 'Blitz', 'Marble', 'Nova', 'Dash', 'Zoom', 'Drift', 'Flash', 'Tumble', 'Sprout', 'Wiz', 'Ace'];
const FLAGS = ['🇺🇸', '🇬🇧', '🇨🇦', '🇧🇷', '🇩🇪', '🇫🇷', '🇯🇵', '🇰🇷', '🇲🇽', '🇦🇺', '🇪🇸', '🇮🇹', '🇳🇱', '🇸🇪', '🇵🇭', '🇮🇳', '🇵🇱', '🇹🇷', '🇦🇷', '🇳🇿'];

/** A racer's handle, flag and level for the lobby. */
export function rivalFor(random, level) {
  const a = NAME_A[Math.floor(random() * NAME_A.length)];
  const b = NAME_B[Math.floor(random() * NAME_B.length)];
  const n = random() < 0.55 ? String(Math.floor(random() * 99) + 1) : '';
  return {
    name: `${a}${b}${n}`,
    flag: FLAGS[Math.floor(random() * FLAGS.length)],
    level: Math.max(1, Math.min(MAX_LEVEL, Math.round(level + (random() - 0.4) * 8))),
  };
}

export { rng as seeded };
