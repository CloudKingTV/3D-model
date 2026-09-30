import { generateTrack } from './track.js';
import { createRace, startRace, stepRace, standings, RACE } from './physics.js';
import { createMarbleRenderer, createMarbleScene } from './scene.js';
import { MARBLES } from './designs.js';
import { createMarbleHud } from '../ui/marbleHud.js';
import { createComicPops } from '../game/comic.js';

/**
 * The marble races: pick a marble, watch 24 of them race down a freshly
 * generated run, see where yours came.
 *
 * Flow: picker (the run flies past behind it) → countdown at the gate →
 * the race → results. Every race is a new track unless you ask to keep it.
 */

const PICK_KEY = 'fingerboard-3d:marble:v1';
const TRACK_WORDS = ['Canyon', 'Cascade', 'Corkscrew', 'Rapids', 'Summit', 'Chute', 'Tumble', 'Zigzag', 'Plunge', 'Twister'];
const FRAME = 1 / 60;

function readPick() {
  try {
    const n = Number(localStorage.getItem(PICK_KEY));
    return Number.isInteger(n) && n >= 0 && n < MARBLES.length ? n : 0;
  } catch {
    return 0;
  }
}

function savePick(id) {
  try {
    localStorage.setItem(PICK_KEY, String(id));
  } catch {
    /* storage blocked: the pick holds for this visit */
  }
}

export function createMarbleGame(canvas, { host, quality = 'high', onExit }) {
  const renderer = createMarbleRenderer(canvas, { quality });
  const comic = createComicPops(host);
  let playerId = readPick();
  let seed = 0;
  let track = null;
  let race = null;
  let view = null;
  let phase = 'pick'; // pick | countdown | racing | done
  let countdown = 0;
  let clock = 0;
  let speed = 1;
  let accumulator = 0;
  let overAt = null;
  let last = 0;
  let frameHandle = 0;
  let running = true;
  const size = { width: 1, height: 1 };

  const hud = createMarbleHud(host, {
    onRace(id) {
      playerId = id;
      savePick(id);
      beginCountdown();
    },
    onNewTrack(id) {
      playerId = id;
      newTrack();
      hud.showPicker(playerId, trackName());
    },
    onCamera() {
      const modes = ['mine', 'leader', 'overview'];
      const next = modes[(modes.indexOf(view.mode) + 1) % modes.length];
      view.setMode(next);
      hud.setCamera(next);
    },
    onSpeed() {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
      hud.setSpeed(speed);
    },
    onExit: () => onExit?.(),
    onAgain() {
      newTrack();
      beginCountdown();
    },
    onChangeMarble() {
      newTrack();
      phase = 'pick';
      hud.showPicker(playerId, trackName());
    },
  });

  function trackName() {
    return `${TRACK_WORDS[seed % TRACK_WORDS.length]} run · #${seed % 10000}`;
  }

  function newTrack() {
    view?.dispose();
    seed = (Math.random() * 1e9) >>> 0;
    track = generateTrack(seed);
    race = createRace(track, MARBLES.length, { seed });
    view = createMarbleScene(renderer, { quality, track });
    view.resize(size.width, size.height);
    phase = 'pick';
    clock = 0;
    speed = 1;
    overAt = null;
    comic.clear();
    hud.banner('');
    hud.setSpeed(1);
    hud.setCamera(view.mode);
  }

  function beginCountdown() {
    phase = 'countdown';
    countdown = 3.2;
    view.setMode('mine');
    hud.setCamera('mine');
    hud.showCountdown(3);
  }

  function screenOf(m) {
    const p = view.project(m);
    return { x: Math.min(0.85, Math.max(0.15, p.x)), y: Math.min(0.7, Math.max(0.2, p.y - 0.1)) };
  }

  function handle(events) {
    for (const e of events) {
      const m = race.marbles[e.id];
      if (e.type === 'finish') {
        const name = MARBLES[e.id].name;
        if (e.place === 1) {
          comic.flourish(`${name} wins!`, `${e.time.toFixed(1)}s`);
          view.effects.burst(m.x, m.y + 0.5, m.z, 40, 22);
        }
        if (e.id === playerId) {
          comic.pop({
            tier: e.place === 1 ? 'huge' : e.place <= 3 ? 'big' : 'small',
            word: e.place === 1 ? 'WINNER!' : `${e.place}${['th', 'st', 'nd', 'rd'][e.place % 10 < 4 && Math.floor(e.place / 10) !== 1 ? e.place % 10 : 0]}!`,
            detail: `${name} · ${e.time.toFixed(1)}s`,
            ...screenOf(m),
          });
        }
      } else if (e.type === 'eliminated' && e.id === playerId) {
        comic.pop({ tier: 'bail', word: 'TOASTED!', detail: `${MARBLES[e.id].name} was caught by the fire`, ...screenOf(m) });
      } else if (e.type === 'bumper' && e.id === playerId) {
        view.effects.burst(m.x, m.y, m.z, 8, 10);
      } else if (e.type === 'boost' && e.id === playerId) {
        view.effects.burst(m.x, m.y, m.z, 6, 8);
      } else if (e.type === 'fireStart') {
        hud.banner(`🔥 Fire wall! ${e.left} marble${e.left === 1 ? '' : 's'} still on the run`, 'fire');
        comic.pop({ tier: 'bail', word: 'FIRE!', detail: 'clearing the run', x: 0.5, y: 0.3 });
      }
    }
  }

  /** Who the camera follows: yours, or once yours is home, the pack. */
  function subject() {
    const order = standings(race);
    if (view.mode === 'leader') {
      return (order.find((m) => !m.finished && !m.eliminated) ?? order[0]).id;
    }
    const me = race.marbles[playerId];
    if (phase === 'racing' && (me.parked || me.eliminated)) {
      return (order.find((m) => !m.finished && !m.eliminated) ?? me).id;
    }
    return playerId;
  }

  function frame(now) {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);
    const delta = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    clock += delta;

    if (phase === 'pick') {
      // Marbles settle behind the gate while you choose.
      stepRace(race, delta);
    } else if (phase === 'countdown') {
      stepRace(race, delta);
      countdown -= delta;
      hud.showCountdown(Math.ceil(countdown - 0.2));
      if (countdown <= 0.2) {
        startRace(race);
        phase = 'racing';
        setTimeout(() => hud.hideCountdown(), 600);
      }
    } else if (phase === 'racing' || phase === 'done') {
      accumulator += delta * speed;
      let guard = 0;
      while (accumulator >= FRAME && guard++ < 8) {
        handle(stepRace(race, FRAME));
        accumulator -= FRAME;
      }
      if (phase === 'racing') {
        const fire = race.fire;
        if (!fire.active && fire.startsAt !== null && race.marbles.some((m) => !m.finished && !m.eliminated)) {
          const left = Math.ceil(fire.startsAt - race.time);
          if (left <= 10 && left > 0) hud.banner(`🔥 Fire wall in ${left}s`, 'warn');
        } else if (!fire.active) {
          hud.banner('');
        }
        if (race.over && overAt === null) overAt = clock;
        if (overAt !== null && clock - overAt > 2.5) {
          phase = 'done';
          const order = standings(race);
          hud.showResults(order, playerId, order[0].finishTime ?? 0);
        }
      }
    }

    if (phase !== 'pick') hud.update(standings(race), playerId, race.time);
    view.pose(race, playerId, delta, clock);
    view.place(race, subject(), Math.max(delta, 1 / 240), { preview: phase === 'pick', time: clock });
    view.effects.update(Math.min(delta, 1 / 30));
    view.render();
  }

  newTrack();
  hud.showPicker(playerId, trackName());
  frameHandle = requestAnimationFrame(frame);

  return {
    resize(width, height) {
      size.width = width;
      size.height = height;
      renderer.setSize(width, height, false);
      view?.resize(width, height);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frameHandle);
      view?.dispose();
      hud.dispose();
      comic.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export { RACE };
