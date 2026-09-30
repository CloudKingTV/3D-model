import { createPark } from './park.js';
import { createRider, placeAtSpawn, stepRider, PHYSICS } from './rider.js';
import { createGameScene } from './scene.js';
import { createComicPops } from './comic.js';
import { createTouchControls } from '../ui/touchControls.js';
import { noseLiftFor } from '../lib/geometry.js';

const STEP = 1 / 120; // fixed physics step, independent of frame rate
const RUN_SECONDS = 120;
const BEST_KEY = 'fingerboard-3d:best:park:v1';

const STEER_LEFT = new Set(['KeyA', 'ArrowLeft']);
const STEER_RIGHT = new Set(['KeyD', 'ArrowRight']);
const PUSH = new Set(['KeyW', 'ArrowUp']);
const BRAKE = new Set(['KeyS', 'ArrowDown']);

/** Which trick each key throws. */
const KEY_TRICKS = {
  KeyJ: 'kickflip',
  KeyK: 'shuvit',
  KeyL: 'heelflip',
  KeyI: 'treflip',
};

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(score)));
  } catch {
    /* private mode, blocked storage — the run still counts, it just is not kept */
  }
}

export function createGame(canvas, { config, hud, comicHost, quality = 'high' }) {
  const park = createPark();
  const view = createGameScene(canvas, { quality, accent: config.deck.ink, park });
  view.applyConfig(config);
  const host = comicHost ?? canvas.parentElement;
  const comic = createComicPops(host);

  /** Physics sized to the board actually on screen, whatever shape it is. */
  function newRider() {
    const spec = view.board.spec;
    const rider = createRider({
      wheelbase: spec.wheelbase,
      length: spec.length,
      width: spec.width,
      wheelZ: spec.wheelZ,
      height: Math.abs(spec.groundY),
      noseLift: noseLiftFor(spec),
    });
    placeAtSpawn(rider, park);
    return rider;
  }

  let rider = newRider();
  let pendingTricks = [];
  const keys = new Set();
  let timeLeft = RUN_SECONDS;
  let best = readBest();
  let status = 'ready'; // ready | playing | paused | over
  let accumulator = 0;
  let last = 0;
  let slowMotion = 0; // seconds of dilated time remaining
  let running = true;
  let frameHandle = 0;

  const touch = createTouchControls(host, {
    onTrick(id) {
      if (status === 'playing') pendingTricks.push(id);
    },
  });
  // Touch controls on phones, or as soon as anyone touches the screen.
  touch.setVisible(matchMedia('(pointer: coarse)').matches);
  const onFirstTouch = (event) => {
    if (event.pointerType === 'touch') touch.setVisible(true);
  };
  window.addEventListener('pointerdown', onFirstTouch);

  hud.setBest(best);
  hud.setScore(0);
  hud.setTime(RUN_SECONDS);
  hud.setLetters([]);
  hud.showStart();
  view.updateCamera(rider, STEP, { snap: true });

  /* ------------------------------------------------------------- input */

  function onKeyDown(event) {
    if (event.code === 'KeyP' || event.code === 'Escape') {
      togglePause();
      return;
    }
    if (event.code === 'Space' || event.code === 'Enter') {
      if (status === 'ready' || status === 'over') {
        event.preventDefault();
        restart();
        return;
      }
    }
    const trick = KEY_TRICKS[event.code];
    if (trick) {
      event.preventDefault();
      if (!event.repeat && status === 'playing') pendingTricks.push(trick);
      return;
    }
    if (event.code === 'Space' || STEER_LEFT.has(event.code) || STEER_RIGHT.has(event.code)
      || PUSH.has(event.code) || BRAKE.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onBlur() {
    keys.clear();
    if (status === 'playing') togglePause();
  }

  const held = (set) => [...set].some((code) => keys.has(code));

  function readInput() {
    const steer = (held(STEER_RIGHT) ? 1 : 0) - (held(STEER_LEFT) ? 1 : 0) + touch.steer;
    const throttle = (held(PUSH) ? 1 : 0) - (held(BRAKE) ? 1 : 0) + touch.throttle;
    const tricks = pendingTricks;
    pendingTricks = [];
    return {
      steer: Math.max(-1, Math.min(1, steer)),
      throttle: Math.max(-1, Math.min(1, throttle)),
      ollie: keys.has('Space') || touch.ollie,
      tricks,
    };
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  /* -------------------------------------------------------------- loop */

  function step(dt, input) {
    const events = stepRider(rider, dt, park, input);
    for (const event of events) handleEvent(event, dt);
    timeLeft -= dt;
    if (timeLeft <= 0) finish();
  }

  /** How loud a landing should be, from what was actually done with it. */
  function tierFor(event) {
    if (event.tricks >= 2 || event.spins >= 2 || event.multiplier >= 3.5 || (event.tricks && event.spins)) return 'huge';
    if (event.tricks >= 1 || event.spins >= 1 || event.airTime > 0.6) return 'big';
    return 'small';
  }

  function handleEvent(event, dt) {
    // Grind ticks fire every physics step, so only project when a pop-up
    // actually needs a screen position.
    let cached = null;
    const screen = () => (cached ??= view.projectBoard(rider));
    const near = () => {
      const where = screen();
      return {
        x: where.x + (Math.random() - 0.5) * 0.14,
        y: where.y - 0.13 - Math.random() * 0.1,
      };
    };

    switch (event.type) {
      case 'pop':
        view.effects.burst(rider.x, rider.y, rider.z, 6, 16);
        break;

      case 'grinding':
        view.effects.grindSparks(rider.x, rider.y, rider.z, dt, rider.speed, Math.cos(rider.heading), Math.sin(rider.heading));
        break;

      case 'grindStart':
        hud.flashTrick(event.style, 0, rider.multiplier);
        view.effects.burst(rider.x, rider.y, rider.z, 14, 26);
        view.effects.addShake(0.12);
        comic.pop({ tier: 'grind', detail: `${event.style} · ${rider.multiplier.toFixed(1)}x`, ...near() });
        break;

      case 'land': {
        hud.flashTrick(event.label, event.points, event.multiplier);
        const tier = tierFor(event);
        view.effects.impactRing(rider.x, rider.y, rider.z, tier === 'huge' ? 1.5 : 1);
        view.effects.burst(rider.x, rider.y, rider.z, tier === 'huge' ? 30 : 14, 30);
        view.effects.addShake(tier === 'huge' ? 0.4 : 0.14);
        comic.pop({ tier, detail: `${event.label} +${Math.round(event.points)}`, ...near() });
        if (tier === 'huge') {
          // The closest thing to a cutscene that does not take the run away
          // from you: time dips, the camera leans in, the panel shouts.
          comic.flourish(event.label, `${Math.round(event.points)} pts · ${event.multiplier.toFixed(1)}x`);
          view.punchIn(1);
          slowMotion = 0.42;
        }
        break;
      }

      case 'touchdown':
        if (event.airTime > 0.25) view.effects.impactRing(rider.x, rider.y, rider.z, 0.6);
        break;

      case 'bump':
        view.effects.addShake(0.1 + event.strength * 0.2);
        break;

      case 'bail':
        hud.flashBail(event.reason);
        view.effects.burst(rider.x, rider.y, rider.z, 22, 34);
        view.effects.addShake(0.5);
        comic.pop({ tier: 'bail', detail: event.reason, x: screen().x, y: screen().y - 0.12 });
        break;

      case 'recover':
        if (event.respawned) view.updateCamera(rider, STEP, { snap: true });
        break;

      case 'letter':
        hud.setLetters(rider.letters);
        comic.pop({ tier: 'big', word: `${event.letter}!`, detail: `Letter +${event.points}`, ...near() });
        if (event.all) {
          comic.flourish('S-K-A-T-E!', `All five letters · +${event.points}`);
          view.punchIn(1);
          slowMotion = 0.42;
        }
        break;

      default:
        break;
    }
  }

  function frame(now) {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);

    const delta = last ? Math.min(0.06, (now - last) / 1000) : 0;
    last = now;

    if (status === 'playing') {
      let scale = 1;
      if (slowMotion > 0) {
        slowMotion = Math.max(0, slowMotion - delta);
        // Ease back to full speed rather than snapping out of it.
        scale = 0.38 + 0.62 * (1 - Math.min(1, slowMotion / 0.42));
      }
      accumulator += delta * scale;
      let guard = 0;
      while (accumulator >= STEP && guard++ < 12) {
        step(STEP, readInput());
        accumulator -= STEP;
      }
      hud.setScore(rider.score);
      hud.setTime(Math.max(0, timeLeft));
      hud.setCombo(rider.combo, rider.multiplier);
      hud.setCharge(rider.charge);
    }

    view.stepEffects(Math.min(delta, 1 / 30));
    view.animateLetters(Math.min(delta, 1 / 30), rider.letters);
    view.poseBoard(rider);
    view.updateCamera(rider, Math.max(delta, 1 / 240));
    view.render(rider);
  }

  /* ----------------------------------------------------------- control */

  function restart() {
    rider = newRider();
    comic.clear();
    pendingTricks = [];
    keys.clear();
    timeLeft = RUN_SECONDS;
    accumulator = 0;
    slowMotion = 0;
    hud.setScore(0);
    hud.setCombo(0, 1);
    hud.setLetters([]);
    status = 'playing';
    hud.hideOverlays();
    view.updateCamera(rider, STEP, { snap: true });
  }

  function finish() {
    status = 'over';
    const score = Math.round(rider.score);
    const isBest = score > best;
    if (isBest) {
      best = score;
      writeBest(best);
      hud.setBest(best);
    }
    hud.showGameOver(score, best, isBest);
  }

  function togglePause() {
    if (status === 'playing') {
      status = 'paused';
      keys.clear();
      hud.showPaused();
    } else if (status === 'paused') {
      status = 'playing';
      last = 0;
      hud.hideOverlays();
    }
  }

  frameHandle = requestAnimationFrame(frame);

  return {
    resize(width, height) {
      view.resize(width, height);
    },
    applyConfig(next) {
      view.applyConfig(next);
    },
    start: restart,
    restart,
    togglePause,
    get status() {
      return status;
    },
    /** For tests and debugging: the live physics state. */
    get rider() {
      return rider;
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onFirstTouch);
      touch.dispose();
      comic.dispose();
      view.dispose();
    },
  };
}

export { RUN_SECONDS, PHYSICS };
