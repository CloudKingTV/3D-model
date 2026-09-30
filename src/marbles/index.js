import { generateTrack } from './track.js';
import { createRace, startRace, stepRace, standings, useItem, RACE } from './physics.js';
import { createMarbleRenderer, createMarbleScene } from './scene.js';
import { MARBLES } from './designs.js';
import { WORLDS } from './themes.js';
import {
  createProfileStore, refreshDay, today, leagueById, payEntry, applyRace, rivalFor, seeded, levelInfo, TRAILS, dailyStatus,
} from './progression.js';
import { createAudio, createHaptics } from './audio.js';
import { createShell } from './ui/shell.js';
import { createRaceUi } from './ui/race.js';
import { ITEM_INFO } from './ui/dom.js';
import { createComicPops } from '../game/comic.js';
import { createCameraControls, FOLLOW_DEFAULT } from './cameraControls.js';
import { isTouchDevice } from '../lib/device.js';
import './marbles.css';

/**
 * Marble Mayhem: the marble racing game.
 *
 * Menus (home, collection, shop, missions, profile) over a slow flyover of
 * the last run; then a mode:
 *   league  — pay in, race a lobby of rivals, steer and use power-ups, win
 *             coins and XP by where you finish
 *   party   — friends on one phone each get a random marble and watch
 *   predict — back one marble in a pure-luck race
 * Every race is a new track in the league's world.
 */

const TRACK_WORDS = ['Canyon', 'Cascade', 'Corkscrew', 'Rapids', 'Summit', 'Chute', 'Tumble', 'Zigzag', 'Plunge', 'Twister', 'Spiral', 'Rush'];
const FRAME = 1 / 60;
const NAMES = MARBLES.map((m) => m.name);

export function createMarbleGame(canvas, { host, quality = 'high', onExit = null }) {
  const touch = isTouchDevice();
  const profile = createProfileStore(NAMES);
  const save = () => profile.save;
  refreshDay(save(), today());
  profile.commit();

  const renderer = createMarbleRenderer(canvas, { quality });
  const comic = createComicPops(host);
  const controls = createCameraControls(canvas);
  const audio = createAudio({ sound: save().settings.sound, music: save().settings.music });
  const haptics = createHaptics(save().settings.haptics);

  let track = null;
  let race = null;
  let view = null;
  let session = null; // { mode, league, field, playerId, pick, humans }
  let phase = 'menu'; // menu | lobby | setup | countdown | racing | results
  let countdown = 0;
  let lastCount = 0;
  let clock = 0;
  let speed = 1;
  let accumulator = 0;
  let doneAt = null;
  let paused = false;
  let closePause = null;
  let last = 0;
  let frameHandle = 0;
  let running = true;
  let steerLeft = false;
  let steerRight = false;
  let counts = null;
  let rank = 0;
  let turboUntil = 0;
  let partyNames = save().partyNames ?? [];
  const size = { width: 1, height: 1 };

  /* ------------------------------------------------------------- the app */

  const app = {
    profile,
    names: NAMES,
    day: () => today(),
    sfx: (name, arg) => audio.play(name, arg),
    buzz: (pattern) => haptics.buzz(pattern),
    setSetting(key, value) {
      save().settings[key] = value;
      profile.commit();
      if (key === 'sound') audio.setSound(value);
      if (key === 'music') audio.setMusic(value);
      if (key === 'haptics') haptics.set(value);
      if (key === 'quality') applyQuality(true);
    },
    play: (leagueId) => startLeague(leagueId),
    party: () => startParty(),
    predict: () => startPredict(),
    exit: onExit ? () => onExit() : null,
  };

  const shell = createShell(host, app);
  const ui = createRaceUi(host, app);

  /* ---------------------------------------------------------- the stage */

  function trackName(seed) {
    return `${TRACK_WORDS[seed % TRACK_WORDS.length]} Run #${seed % 1000}`;
  }

  /**
   * A fresh track, race and scene. `field` decides how many marbles race
   * and which designs they wear.
   */
  function stage({ world, length, field, items, steering, skill, playerId }) {
    view?.dispose();
    controls.setEnabled(false);
    Object.assign(controls.follow, FOLLOW_DEFAULT);
    const seed = (Math.random() * 1e9) >>> 0;
    track = generateTrack(seed, { length });
    race = createRace(track, field.length, {
      seed, items, steering, skill, watch: playerId, rolling: WORLDS[world].rolling ?? RACE.rolling,
    });
    for (const [id, racer] of field.entries()) {
      // Your own marble: you steer and use its power-ups (unless you've
      // switched steering off, when it drives itself but still waits for
      // you to fire its power-ups).
      if (racer.human && id === playerId) {
        race.marbles[id].ai = !save().settings.steering;
        race.marbles[id].autoItem = false;
      }
    }
    const trail = TRAILS.find((t) => t.id === save().trail)?.colours ?? [];
    view = createMarbleScene(renderer, {
      quality, track, world, designs: field.map((r) => r.design), trail: playerId !== null && session?.mode === 'league' ? trail : [],
    });
    view.resize(size.width, size.height);
    applyQuality(false);
    clock = 0;
    speed = 1;
    accumulator = 0;
    doneAt = null;
    comic.clear();
    return seed;
  }

  /** The backdrop for the menus: a run in your league's world, flown over. */
  function menuStage() {
    const league = leagueById(save().league);
    const field = MARBLES.slice(0, 12).map((_, i) => ({ design: (save().marble + i) % MARBLES.length, name: '' }));
    session = { mode: 'menu', field, playerId: null };
    stage({ world: league.world, length: [380, 470], field, items: true, steering: false, skill: 0.5, playerId: null });
  }

  /* ------------------------------------------------------------- fields */

  function shuffledDesigns(exclude, random) {
    const pool = MARBLES.map((_, i) => i).filter((i) => !exclude.includes(i));
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  }

  /* -------------------------------------------------------------- modes */

  function startLeague(leagueId) {
    const league = leagueById(leagueId);
    if (!payEntry(save(), league)) {
      shell.toast('Not enough coins');
      return;
    }
    profile.commit();
    const random = seeded((Math.random() * 1e9) >>> 0);
    const level = levelInfo(save().xp).level;
    const designs = shuffledDesigns([save().marble], random);
    const field = [{ design: save().marble, name: save().name, flag: '⭐', level, human: true }];
    while (field.length < league.racers) {
      field.push({ ...rivalFor(random, level), design: designs[field.length - 1] });
    }
    session = { mode: 'league', league: league.id, field, playerId: 0, before: { xp: save().xp } };
    enterLobby(league.world, league.length, { items: true, steering: true, skill: league.skill }, {
      title: league.name, subtitle: league.fee ? `Entry paid · win up to ${league.top.toLocaleString()} coins` : 'Free entry',
    });
  }

  function enterLobby(world, length, rules, { title, subtitle }) {
    shell.hide();
    phase = 'lobby';
    audio.setTrack('race');
    const seed = stage({ world, length, field: session.field, playerId: session.playerId, ...rules });
    ui.lobby({
      title, subtitle, world, field: session.field, trackName: trackName(seed),
      onReady: () => beginCountdown(),
    });
  }

  function startParty() {
    shell.hide();
    phase = 'setup';
    ui.partySetup({
      names: partyNames,
      onCancel: () => goHome(),
      onStart(names) {
        partyNames = names;
        save().partyNames = names;
        profile.commit();
        const random = seeded((Math.random() * 1e9) >>> 0);
        const designs = shuffledDesigns([], random);
        const count = Math.max(12, names.length);
        const field = [];
        for (let i = 0; i < count; i += 1) {
          const design = designs[i];
          field.push(i < names.length ? { design, name: names[i], human: true } : { design, name: MARBLES[design].name });
        }
        session = { mode: 'party', field, playerId: 0, before: { xp: save().xp } };
        ui.partyReveal({
          field,
          onDone: () => enterLobby(leagueById(save().league).world, [380, 470], { items: false, steering: false, skill: 0.5 }, {
            title: 'Party race', subtitle: `${names.length} players`,
          }),
        });
      },
    });
  }

  function startPredict() {
    shell.hide();
    phase = 'setup';
    const random = seeded((Math.random() * 1e9) >>> 0);
    const designs = shuffledDesigns([], random).slice(0, 16);
    const field = designs.map((design) => ({ design, name: MARBLES[design].name }));
    ui.predictSetup({
      field,
      onCancel: () => goHome(),
      onPick(pick) {
        field[pick].human = true;
        session = { mode: 'predict', field, playerId: pick, pick, before: { xp: save().xp } };
        enterLobby(leagueById(save().league).world, [420, 520], { items: false, steering: false, skill: 0.5 }, {
          title: 'Predict', subtitle: `You backed ${MARBLES[field[pick].design].name}`,
        });
      },
    });
  }

  /* ----------------------------------------------------------- the race */

  const HINTS = touch
    ? { follow: 'Swipe to look around · pinch to zoom', fly: 'Drag to look · pinch to fly · two fingers to slide' }
    : { follow: 'Drag to look around · scroll to zoom', fly: 'WASD to fly · Q/E down/up · drag to look' };

  function setCamera(next) {
    view.setMode(next);
    ui.hud?.setCamera(next);
    const flying = next === 'overview';
    controls.setMode(flying ? 'fly' : 'follow');
    if (flying) controls.fly.ready = false;
    ui.hud?.hint(`${{ mine: session.mode === 'party' ? 'Following the players' : 'Following your marble', leader: 'Following the leader', overview: 'Free camera' }[next]} · ${flying ? HINTS.fly : HINTS.follow}`);
  }

  function beginCountdown() {
    phase = 'countdown';
    countdown = 3.2;
    lastCount = 4;
    counts = { trackCoins: 0, items: 0, bumpers: 0, boosts: 0, shockHits: 0, overtakes: 0 };
    rank = 0;
    paused = false;
    const league = session.mode === 'league';
    const steering = league;
    ui.raceHud({
      field: session.field,
      playerId: session.playerId,
      steering,
      speedButton: !league,
      tutorial: league && !save().tutorial,
      onPause: () => pause(),
      onCamera() {
        const modes = ['mine', 'leader', 'overview'];
        setCamera(modes[(modes.indexOf(view.mode) + 1) % modes.length]);
      },
      onSpeed() {
        speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
        ui.hud.setSpeed(speed);
      },
      onSteer(dir, down) {
        if (dir < 0) steerLeft = down; else steerRight = down;
      },
      onItem: () => fireItem(),
    });
    if (league && !save().tutorial) {
      save().tutorial = true;
      profile.commit();
    }
    setCamera(session.mode === 'party' ? 'leader' : 'mine');
    controls.setEnabled(true);
    ui.hud.countdown(3);
  }

  function fireItem() {
    if (phase !== 'racing' || paused || session.playerId === null) return;
    const used = useItem(race, session.playerId);
    if (!used) {
      audio.play('error');
      return;
    }
    counts.items += 1;
    ui.hud.setItem(null);
    haptics.buzz(25);
  }

  function pause() {
    if (paused || (phase !== 'racing' && phase !== 'countdown')) return;
    paused = true;
    const s = save().settings;
    closePause = ui.pauseMenu({
      settings: s,
      quitLabel: session.mode === 'league' ? 'Quit race (lose entry)' : 'Quit race',
      onResume: () => { paused = false; last = 0; },
      onQuit: () => { paused = false; goHome(); },
      onSettings: (key, value) => app.setSetting(key, value),
    });
  }

  function screenOf(m) {
    const p = view.project(m);
    return { x: Math.min(0.85, Math.max(0.15, p.x)), y: Math.min(0.7, Math.max(0.2, p.y - 0.1)) };
  }

  const near = (m) => {
    const c = view.cameraPosition;
    return (c.x - m.x) ** 2 + (c.y - m.y) ** 2 + (c.z - m.z) ** 2 < 30 * 30;
  };

  function handle(events) {
    const me = session.playerId;
    const humans = session.field;
    for (const e of events) {
      const m = race.marbles[e.id];
      const mine = e.id === me && session.mode === 'league';
      switch (e.type) {
        case 'finish': {
          const name = humans[e.id].name;
          if (e.place === 1) {
            comic.flourish(`${name} wins!`, `${e.time.toFixed(1)}s`);
            view.confetti(m.x, m.y + 0.5, m.z, 70);
          }
          if (e.id === me || humans[e.id].human) {
            audio.play(e.place === 1 ? 'win' : 'finish');
            haptics.buzz([30, 50, 30]);
            comic.pop({
              tier: e.place === 1 ? 'huge' : e.place <= 3 ? 'big' : 'small',
              word: e.place === 1 ? 'WINNER!' : `${e.place}${['th', 'st', 'nd', 'rd'][e.place % 10 < 4 && Math.floor(e.place / 10) !== 1 ? e.place % 10 : 0]}!`,
              detail: `${name} · ${e.time.toFixed(1)}s`,
              ...screenOf(m),
            });
          }
          break;
        }
        case 'eliminated':
          if (e.id === me || humans[e.id].human) {
            audio.play('lose');
            comic.pop({ tier: 'bail', word: 'TOASTED!', detail: `${humans[e.id].name} was caught by the fire`, ...screenOf(m) });
          }
          break;
        case 'bumper':
          if (mine) {
            counts.bumpers += 1;
            audio.play('bumper');
            view.shake(0.25);
            haptics.buzz(12);
            view.effects.burst(m.x, m.y, m.z, 8, 10);
          } else if (near(m)) audio.play('bumper');
          break;
        case 'boost':
          if (mine) {
            counts.boosts += 1;
            audio.play('boost');
            turboUntil = Math.max(turboUntil, clock + 0.6);
            view.effects.burst(m.x, m.y, m.z, 6, 8);
          }
          break;
        case 'coin':
          counts.trackCoins += 1;
          audio.play('coin');
          haptics.buzz(5);
          view.effects.burst(e.pickup.x, e.pickup.y, e.pickup.z, 5, 5, undefined);
          break;
        case 'item':
          if (mine) {
            audio.play('box');
            haptics.buzz(15);
            ui.hud?.setItem(e.item);
            ui.hud?.hint(`${ITEM_INFO[e.item].icon} ${ITEM_INFO[e.item].name} — ${ITEM_INFO[e.item].tip}. Tap to use!`);
          }
          break;
        case 'use':
          if (mine || near(m)) audio.play(e.item);
          if (mine && e.item === 'turbo') turboUntil = clock + RACE.turboTime;
          if (e.item === 'hop') view.effects.burst(m.x, m.y - 0.4, m.z, 8, 6);
          break;
        case 'shock': {
          view.shockwave(m);
          if (e.hits.includes(me) && session.mode === 'league') {
            audio.play('hit');
            view.shake(0.7);
            haptics.buzz(40);
            ui.hud?.flash('hit');
            comic.pop({ tier: 'bail', word: 'ZAPPED!', detail: `by ${humans[e.id].name}`, ...screenOf(race.marbles[me]) });
          }
          if (mine) {
            counts.shockHits += e.hits.length;
            view.shake(0.35);
            if (e.hits.length) comic.pop({ tier: e.hits.length > 2 ? 'huge' : 'big', word: 'BOOM!', detail: `${e.hits.length} rival${e.hits.length === 1 ? '' : 's'} blasted`, ...screenOf(m) });
          }
          break;
        }
        case 'clack':
          audio.play('clack', e.speed);
          break;
        case 'respawn':
          if (mine) comic.pop({ tier: 'bail', word: 'OOPS!', detail: 'back on track', ...screenOf(m) });
          break;
        case 'fireStart':
          audio.play('fire');
          ui.hud?.banner(`🔥 Fire wall! ${e.left} marble${e.left === 1 ? '' : 's'} still on the run`, 'fire');
          comic.pop({ tier: 'bail', word: 'FIRE!', detail: 'clearing the run', x: 0.5, y: 0.3 });
          break;
        default:
          break;
      }
    }
  }

  /** Who the camera follows. */
  function subject() {
    const order = standings(race);
    const racing = order.find((m) => !m.finished && !m.eliminated) ?? order[0];
    if (view.mode === 'leader') return racing.id;
    if (session.mode === 'party') {
      const human = order.find((m) => session.field[m.id].human && !m.finished && !m.eliminated);
      return (human ?? racing).id;
    }
    const me = race.marbles[session.playerId];
    if (phase === 'racing' && (me.parked || me.eliminated)) return racing.id;
    return session.playerId;
  }

  /** The race is decided for you: show the results soon. */
  function decided() {
    if (race.over) return true;
    if (session.mode === 'league') {
      const me = race.marbles[session.playerId];
      return me.finished || me.eliminated;
    }
    // Watching: the podium is set and every player (or your pick) is home.
    const order = standings(race);
    const podium = order.slice(0, 3).every((m) => m.finished);
    const humans = race.marbles.filter((m) => session.field[m.id].human);
    return podium && humans.every((m) => m.finished || m.eliminated);
  }

  function finishRace() {
    phase = 'results';
    controls.setEnabled(false);
    steerLeft = false;
    steerRight = false;
    audio.setRoll(0, false);
    audio.setTrack('menu');
    const order = standings(race);
    const s = save();
    const mine = order.findIndex((m) => m.id === session.playerId);
    const me = order[mine];
    let result;
    let headline;
    const extra = [];
    if (session.mode === 'league') {
      result = { mode: 'league', league: session.league, place: mine + 1, racers: order.length, burnt: me.eliminated, time: me.finishTime, counts };
      headline = me.eliminated ? 'Caught by the fire!' : mine === 0 ? 'Victory!' : mine < 3 ? 'On the podium!' : mine < order.length / 2 ? 'Nice run!' : 'Better luck next time';
    } else if (session.mode === 'party') {
      result = { mode: 'party', counts: {} };
      const best = order.find((m) => session.field[m.id].human);
      headline = `${session.field[best.id].name} wins the party!`;
    } else {
      const hit = mine === 0 ? 'win' : mine < 3 ? 'podium' : null;
      result = { mode: 'predict', predict: { hit }, counts: {} };
      headline = hit === 'win' ? 'You called it!' : hit === 'podium' ? 'So close — podium!' : `${MARBLES[session.field[session.pick].design].name} came ${mine + 1}${['th', 'st', 'nd', 'rd'][(mine + 1) % 10 < 4 && Math.floor((mine + 1) / 10) !== 1 ? (mine + 1) % 10 : 0]}`;
    }
    const report = applyRace(s, result, today());
    profile.commit();
    if (session.mode === 'league') audio.play(mine === 0 ? 'win' : mine < 3 ? 'finish' : 'lose');
    const league = session.mode === 'league' ? leagueById(session.league) : null;
    ui.results({
      mode: session.mode,
      field: session.field,
      order,
      playerId: session.playerId,
      report,
      before: session.before,
      save: s,
      extra,
      headline,
      againLabel: league ? (league.fee ? `Race again · ${league.fee}` : 'Race again') : session.mode === 'party' ? 'New party race' : 'Predict again',
      onAgain() {
        if (league) {
          if (s.coins < league.fee) {
            goHome();
            shell.toast('Not enough coins for another entry');
            return;
          }
          startLeague(league.id);
        } else if (session.mode === 'party') startParty();
        else startPredict();
      },
      onHome: () => goHome(),
    });
    if (report.levels.length) setTimeout(() => shell.levelUps(report.levels), 2600);
  }

  function goHome() {
    closePause?.();
    closePause = null;
    phase = 'menu';
    paused = false;
    ui.clear();
    comic.clear();
    controls.setEnabled(false);
    audio.setRoll(0, false);
    audio.setTrack('menu');
    if (!session || session.mode === 'menu' || !race) menuStage();
    else session = { ...session, mode: 'menu' };
    shell.show('home');
  }

  /* ------------------------------------------------------------ quality */

  // Resolution first, then glow, then shadows, when frames run slow.
  const RATIOS = [2, 1.5, 1.25, 1, 0.8, 0.65];
  let level = quality === 'high' ? 0 : 2;
  const frameTimes = [];
  let windowStart = 0;
  let settleUntil = 0;

  function applyQuality(reset) {
    const setting = save().settings.quality;
    if (reset) level = setting === 'high' ? 0 : setting === 'low' ? 3 : quality === 'high' ? 0 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RATIOS[level]));
    renderer.setSize(size.width, size.height, false);
    view?.resize(size.width, size.height);
    view?.setShadows(level < RATIOS.length - 2 && setting !== 'low');
    if (setting === 'low' || level >= 3) view?.setBloom(false);
    else if (reset || setting === 'high') view?.setBloom(true);
    canvas.dataset.quality = String(level);
  }

  function watchFrameRate(now, raw) {
    if (save().settings.quality !== 'auto') return;
    if (now < settleUntil || raw <= 0 || raw > 400) return;
    if (!frameTimes.length) windowStart = now;
    frameTimes.push(raw);
    if (now - windowStart < 1500 || frameTimes.length < 6) return;
    const median = [...frameTimes].sort((a, b) => a - b)[frameTimes.length >> 1];
    frameTimes.length = 0;
    if (median <= 25) return;
    if (view?.bloom && level >= 1) {
      view.setBloom(false);
    } else if (level < RATIOS.length - 1) {
      level = Math.min(RATIOS.length - 1, level + (median > 60 ? 2 : 1));
      applyQuality(false);
    } else return;
    settleUntil = now + 800;
  }

  /* ------------------------------------------------------------- input */

  // Swipes and pinches are for the camera: never let them scroll or zoom
  // the page, except inside scrolling panels.
  const stopGesture = (event) => {
    if (event.target.closest?.('.mm-screen, .mm-panel, .mm-results, .mm-modal__sheet, .mm-lobby__list, .hud__panel')) return;
    event.preventDefault();
  };
  host.addEventListener('touchmove', stopGesture, { passive: false });

  const unlockAudio = () => audio.unlock();
  host.addEventListener('pointerdown', unlockAudio);
  const onKey = (event) => {
    if (event.target?.closest?.('input, textarea')) return;
    const down = event.type === 'keydown';
    if (phase !== 'racing' && phase !== 'countdown') return;
    if (controls.mode === 'fly') return;
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') steerLeft = down;
    else if (event.code === 'ArrowRight' || event.code === 'KeyD') steerRight = down;
    else if (down && (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW')) {
      event.preventDefault();
      fireItem();
    } else if (down && event.code === 'Escape') pause();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const onVisibility = () => {
    audio.suspend(document.hidden);
    if (document.hidden) pause();
  };
  document.addEventListener('visibilitychange', onVisibility);

  /* -------------------------------------------------------------- frame */

  function frame(now) {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);
    const raw = last ? now - last : 0;
    const delta = Math.min(0.05, raw / 1000);
    last = now;
    if (!settleUntil) settleUntil = now + 1000;
    watchFrameRate(now, raw);
    if (!view) return;
    if (paused) {
      view.render();
      return;
    }
    clock += delta;

    if (phase === 'menu' || phase === 'lobby' || phase === 'setup') {
      // Marbles settle behind the gate; the camera flies the run.
      stepRace(race, delta);
    } else if (phase === 'countdown') {
      stepRace(race, delta);
      countdown -= delta;
      const n = Math.ceil(countdown - 0.2);
      if (n !== lastCount && n > 0) {
        lastCount = n;
        ui.hud.countdown(n);
        audio.play('count');
        haptics.buzz(10);
      }
      if (countdown <= 0.2) {
        startRace(race);
        phase = 'racing';
        ui.hud.countdown(0);
        audio.play('go');
        audio.play('gate');
        haptics.buzz(30);
        setTimeout(() => ui.hud?.hideCountdown(), 700);
      }
    } else if (phase === 'racing' || phase === 'results') {
      // Your steering, straight onto your marble.
      if (session.mode === 'league' && phase === 'racing') {
        const me = race.marbles[session.playerId];
        if (!me.ai) me.steer = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
      }
      accumulator += delta * speed;
      let guard = 0;
      while (accumulator >= FRAME && guard++ < 8) {
        handle(stepRace(race, FRAME));
        accumulator -= FRAME;
      }
      if (phase === 'racing') {
        const order = standings(race);
        const fire = race.fire;
        if (!fire.active && fire.startsAt !== null && race.marbles.some((m) => !m.finished && !m.eliminated)) {
          const left = Math.ceil(fire.startsAt - race.time);
          if (left <= 10 && left > 0) ui.hud.banner(`🔥 Fire wall in ${left}s`, 'warn');
        } else if (!fire.active) {
          ui.hud.banner('');
        }
        // Overtakes: places gained after the start's shuffle settles.
        if (session.mode === 'league') {
          const place = order.findIndex((m) => m.id === session.playerId) + 1;
          if (race.time > 3 && rank && place < rank) counts.overtakes += rank - place;
          rank = place;
        }
        ui.hud.update(order, race, race.time);
        if (session.mode === 'party') {
          const tags = [];
          for (const m of race.marbles) {
            if (!session.field[m.id].human || m.eliminated) continue;
            const p = view.project(m, 1.4);
            if (p.behind || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
            tags.push({ name: session.field[m.id].name, x: p.x, y: p.y, colour: MARBLES[session.field[m.id].design].swatch.startsWith('#') ? MARBLES[session.field[m.id].design].swatch : '#fff' });
          }
          ui.hud.tags(tags);
        }
        ui.hud.speedLines(clock < turboUntil);
        if (decided() && doneAt === null) doneAt = clock;
        if (doneAt !== null && clock - doneAt > 2.6) finishRace();
      }
    }

    // The rolling sound follows the marble the camera is on.
    if (phase === 'racing' || phase === 'countdown') {
      const m = race.marbles[subject()];
      audio.setRoll(Math.hypot(m.vx, m.vy, m.vz), m.touching && !m.finished);
    }

    const followed = phase === 'racing' || phase === 'countdown' || phase === 'results' ? subject() : null;
    view.pose(race, session.mode === 'menu' ? null : session.playerId, delta, clock);
    controls.update(delta);
    const preview = phase === 'menu' || phase === 'lobby' || phase === 'setup';
    let speedFactor = 0;
    if (followed !== null && !preview) {
      const m = race.marbles[followed];
      speedFactor = Math.max(0, Math.min(1, (Math.hypot(m.vx, m.vy, m.vz) - 14) / 20)) + (clock < turboUntil ? 0.5 : 0);
    }
    view.place(race, followed ?? 0, Math.max(delta, 1 / 240), { preview, time: clock, controls, speedFactor });
    view.effects.update(Math.min(delta, 1 / 30));
    view.render();
  }

  /* --------------------------------------------------------------- boot */

  menuStage();
  shell.show('home');
  audio.setTrack('menu');
  if (dailyStatus(save(), today()).available) setTimeout(() => shell.dailyPopup(), 700);
  frameHandle = requestAnimationFrame(frame);

  return {
    resize(width, height) {
      size.width = width;
      size.height = height;
      renderer.setSize(width, height, false);
      view?.resize(width, height);
    },
    /** For tests. */
    get race() {
      return race;
    },
    get controls() {
      return controls;
    },
    get cameraPosition() {
      return view?.cameraPosition;
    },
    get phase() {
      return phase;
    },
    get save() {
      return save();
    },
    get session() {
      return session;
    },
    /** For tests: run the race on quickly, as if `seconds` had passed. */
    simulate(seconds) {
      for (let t = 0; t < seconds && phase === 'racing'; t += FRAME) handle(stepRace(race, FRAME));
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frameHandle);
      host.removeEventListener('touchmove', stopGesture);
      host.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      view?.dispose();
      shell.dispose();
      ui.dispose();
      comic.dispose();
      audio.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export { RACE };
