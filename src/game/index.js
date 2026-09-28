import { createTrack } from './track.js';
import { createSkater, stepSkater, PHYSICS } from './skater.js';
import { createGameScene } from './scene.js';

const STEP = 1 / 120; // fixed physics step, independent of frame rate
const RUN_SECONDS = 90;
const BEST_KEY = 'fingerboard-3d:best:v1';

/** Which trick each control fires. */
const KEY_TRICKS = {
  KeyA: 'kickflip',
  ArrowLeft: 'kickflip',
  KeyD: 'heelflip',
  ArrowRight: 'heelflip',
  KeyS: 'shuvit',
  ArrowDown: 'shuvit',
  KeyW: 'bigspin',
  ArrowUp: 'bigspin',
};

const SWIPE_TRICKS = {
  left: 'kickflip',
  right: 'heelflip',
  down: 'shuvit',
  up: 'bigspin',
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

export function createGame(canvas, { config, hud, quality = 'high' }) {
  const view = createGameScene(canvas, { quality });
  view.applyConfig(config);

  let track = createTrack({ seed: (Math.random() * 1e9) | 0 });
  let skater = createSkater();
  let pendingTricks = [];
  let holding = false;
  let timeLeft = RUN_SECONDS;
  let best = readBest();
  let status = 'ready'; // ready | playing | over
  let accumulator = 0;
  let last = 0;
  let running = true;
  let frameHandle = 0;

  hud.setBest(best);
  hud.setScore(0);
  hud.setTime(RUN_SECONDS);
  hud.showStart();

  /* ------------------------------------------------------------- input */

  function fireTrick(id) {
    if (status !== 'playing' || !id) return;
    pendingTricks.push(id);
  }

  function beginHold() {
    if (status === 'ready') {
      start();
      return;
    }
    if (status === 'over') {
      restart();
      return;
    }
    holding = true;
  }

  function endHold() {
    holding = false;
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      beginHold();
      return;
    }
    if (event.code === 'KeyP') {
      togglePause();
      return;
    }
    const trick = KEY_TRICKS[event.code];
    if (trick) {
      event.preventDefault();
      fireTrick(trick);
    }
  }

  function onKeyUp(event) {
    if (event.code === 'Space') {
      event.preventDefault();
      endHold();
    }
  }

  // Touch: a still press charges the ollie, a flick throws a trick.
  let touchStart = null;
  const SWIPE_DISTANCE = 26;

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    touchStart = { x: event.clientX, y: event.clientY, swiped: false };
    beginHold();
  }

  function onPointerMove(event) {
    if (!touchStart || touchStart.swiped) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    if (Math.hypot(dx, dy) < SWIPE_DISTANCE) return;

    touchStart.swiped = true;
    holding = false; // a flick is not a charge
    const direction = Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? 'left' : 'right')
      : (dy < 0 ? 'up' : 'down');
    fireTrick(SWIPE_TRICKS[direction]);
  }

  function onPointerUp() {
    touchStart = null;
    endHold();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  /* -------------------------------------------------------------- loop */

  function step(dt) {
    track.ensureAhead(skater.x);
    track.prune(skater.x);

    const events = stepSkater(skater, dt, track, {
      hold: holding,
      tricks: pendingTricks,
    });
    pendingTricks = [];

    for (const event of events) {
      if (event.type === 'land') {
        hud.flashTrick(event.label, event.points, event.multiplier);
      } else if (event.type === 'bail') {
        hud.flashBail(event.reason);
      } else if (event.type === 'grindStart') {
        hud.flashTrick('Grind', 0, skater.multiplier);
      }
    }

    timeLeft -= dt;
    if (timeLeft <= 0) finish();
  }

  function frame(now) {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);

    const delta = last ? Math.min(0.06, (now - last) / 1000) : 0;
    last = now;

    if (status === 'playing') {
      accumulator += delta;
      let guard = 0;
      while (accumulator >= STEP && guard++ < 12) {
        step(STEP);
        accumulator -= STEP;
      }
      hud.setScore(skater.score);
      hud.setTime(Math.max(0, timeLeft));
      hud.setCombo(skater.combo, skater.multiplier);
      hud.setCharge(skater.charge);
    }

    track.ensureAhead(skater.x);
    view.syncFeatures(track, skater.x);
    view.syncProps(skater.x);
    view.poseBoard(skater);
    view.updateCamera(skater, Math.max(delta, 1 / 240));
    view.render(skater);
  }

  /* ----------------------------------------------------------- control */

  function start() {
    status = 'playing';
    hud.hideOverlays();
  }

  function restart() {
    track = createTrack({ seed: (Math.random() * 1e9) | 0 });
    skater = createSkater();
    pendingTricks = [];
    holding = false;
    timeLeft = RUN_SECONDS;
    accumulator = 0;
    hud.setScore(0);
    hud.setCombo(0, 1);
    status = 'playing';
    hud.hideOverlays();
  }

  function finish() {
    status = 'over';
    const score = Math.round(skater.score);
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
      hud.showPaused();
    } else if (status === 'paused') {
      status = 'playing';
      hud.hideOverlays();
    }
  }

  frameHandle = requestAnimationFrame(frame);

  return {
    resize(width, height) {
      view.resize(width, height);
    },
    applyConfig(config) {
      view.applyConfig(config);
    },
    start,
    restart,
    get status() {
      return status;
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      view.dispose();
    },
  };
}

export { RUN_SECONDS, PHYSICS };
