import { el } from './controls.js';
import { isTouchDevice } from '../lib/device.js';

/**
 * The game's on-screen furniture: score, timer, combo, charge meter and the
 * start / pause / game-over overlays. Kept as DOM rather than drawn into the
 * canvas so it stays crisp and readable at any pixel ratio.
 */
export function createGameHud(host, {
  onExit,
  onRestart,
  onPause,
  settings = null,
  onSetting = () => {},
  letters = ['S', 'K', 'A', 'T', 'E'],
}) {
  const coarse = isTouchDevice();

  const score = el('div', { class: 'hud__score', text: '0' });
  const best = el('div', { class: 'hud__best', text: 'Best 0' });
  const time = el('div', { class: 'hud__time', text: '2:00' });
  const letterSlots = letters.map((letter) => el('span', { class: 'hud__letter', text: letter }));
  const letterRow = el('div', { class: 'hud__letters', 'aria-label': 'Letters collected' }, letterSlots);
  const combo = el('div', { class: 'hud__combo', 'data-show': 'false' });
  const flash = el('div', { class: 'hud__flash' });
  const chargeFill = el('i', { class: 'hud__chargefill' });
  const charge = el('div', { class: 'hud__charge', 'data-show': 'false' }, [chargeFill]);

  const overlay = el('div', { class: 'hud__overlay', hidden: 'hidden' });

  host.append(
    el('div', { class: 'hud' }, [
      el('div', { class: 'hud__corner hud__corner--left' }, [score, best, letterRow, combo]),
      el('div', { class: 'hud__corner hud__corner--right' }, [
        time,
        el('div', { class: 'hud__buttons' }, [
          el('button', { class: 'hud__exit', type: 'button', text: 'Pause', onclick: () => onPause?.() }),
          el('button', { class: 'hud__exit', type: 'button', text: 'Garage', onclick: onExit }),
        ]),
      ]),
      flash,
      charge,
    ]),
    overlay,
  );

  let flashTimer = 0;
  // Written every frame, so only touch the DOM when something changed:
  // needless text and style writes cost phones real frame time.
  const shown = {};
  const changed = (key, value) => {
    if (shown[key] === value) return false;
    shown[key] = value;
    return true;
  };

  function panel(children) {
    overlay.innerHTML = '';
    overlay.append(el('div', { class: 'hud__panel' }, children));
    overlay.hidden = false;
  }

  const controlHint = coarse
    ? [
      ['Left stick', 'steer · down to brake (up to push, if auto-push is off)'],
      ['Hold Ollie', 'crouch — let go to pop, longer hold, higher'],
      ['Trick buttons', 'flip it — on the ground they ollie too'],
      ['Stick in the air', 'spin 180s and 360s'],
    ]
    : [
      ['W / ↑', 'push · S / ↓ brake'],
      ['A D / ← →', 'steer — in the air, spin'],
      ['Hold Space', 'crouch — let go to pop, longer hold, higher'],
      ['J  K  L  I', 'kickflip · shuv · heelflip · 360 flip'],
    ];

  /** Assists and feedback, switchable from the start and pause screens. */
  const SETTINGS = [
    { key: 'autoPush', label: 'Auto-push', detail: 'keep rolling without holding forward' },
    { key: 'spinAssist', label: 'Spin assist', detail: 'let go mid-spin and it settles to a clean 180' },
    { key: 'haptics', label: 'Vibration', detail: 'a buzz on pops, landings and bails', touchOnly: true },
  ];

  function settingsList() {
    if (!settings) return null;
    return el('div', { class: 'hud__settings' }, SETTINGS
      .filter((s) => !s.touchOnly || (coarse && 'vibrate' in navigator))
      .map((s) => {
        const input = el('input', { type: 'checkbox', class: 'hud__switch' });
        input.checked = !!settings[s.key];
        input.addEventListener('change', () => onSetting(s.key, input.checked));
        return el('label', { class: 'hud__setting' }, [
          el('span', { class: 'hud__settingtext' }, [
            el('strong', { text: s.label }),
            el('small', { text: s.detail }),
          ]),
          input,
        ]);
      }));
  }

  function hintList() {
    return el('dl', { class: 'hud__keys' }, controlHint.flatMap(([key, what]) => [
      el('dt', { text: key }),
      el('dd', { text: what }),
    ]));
  }

  return {
    setScore(value) {
      const text = Math.round(value).toLocaleString();
      if (changed('score', text)) score.textContent = text;
    },
    setBest(value) {
      best.textContent = `Best ${Math.round(value).toLocaleString()}`;
    },
    setTime(seconds) {
      const whole = Math.ceil(seconds);
      if (!changed('time', whole)) return;
      time.textContent = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
      time.dataset.low = String(seconds <= 10);
    },
    setCombo(count, multiplier) {
      if (!changed('combo', `${count}:${multiplier}`)) return;
      combo.dataset.show = String(count > 0);
      combo.textContent = `${multiplier.toFixed(1)}×  ·  ${count} combo`;
    },
    setCharge(value) {
      if (!changed('charge', Math.round(value * 50))) return;
      charge.dataset.show = String(value > 0.01);
      chargeFill.style.transform = `scaleX(${value})`;
    },
    flashTrick(label, points, multiplier) {
      flash.dataset.tone = 'good';
      flash.innerHTML = points
        ? `<strong>${label}</strong><span>+${Math.round(points).toLocaleString()} · ${multiplier.toFixed(1)}×</span>`
        : `<strong>${label}</strong>`;
      flash.dataset.show = 'true';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash.dataset.show = 'false'; }, 1100);
    },
    flashBail(reason) {
      flash.dataset.tone = 'bad';
      flash.innerHTML = `<strong>Bail</strong><span>${reason}</span>`;
      flash.dataset.show = 'true';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash.dataset.show = 'false'; }, 1100);
    },
    setLetters(collected) {
      letterSlots.forEach((slot, i) => { slot.dataset.got = String(collected.includes(i)); });
    },
    showStart() {
      panel([
        el('p', { class: 'hud__eyebrow', text: '2 minute session' }),
        el('h2', { text: 'Fingerboard Park' }),
        el('p', { class: 'hud__lead', text: 'Roam the park: air the quarter pipes, grind the rails and ledges, drop the stairs, and find the letters S-K-A-T-E. Keep landing tricks to build your multiplier.' }),
        hintList(),
        settingsList(),
        el('button', {
          class: 'hud__go',
          type: 'button',
          text: coarse ? 'Drop in' : 'Drop in (Space)',
          onclick: onRestart,
        }),
      ]);
    },
    showPaused() {
      panel([
        el('h2', { text: 'Paused' }),
        hintList(),
        settingsList(),
        el('button', {
          class: 'hud__go',
          type: 'button',
          text: coarse ? 'Carry on' : 'Carry on (P)',
          onclick: () => onPause?.(),
        }),
      ]);
    },
    showGameOver(finalScore, bestScore, isBest) {
      panel([
        el('p', { class: 'hud__eyebrow', text: "Time's up" }),
        el('h2', { class: 'hud__final', text: Math.round(finalScore).toLocaleString() }),
        isBest
          ? el('p', { class: 'hud__badge', text: 'New best' })
          : el('p', { class: 'hud__lead', text: `Best ${Math.round(bestScore).toLocaleString()}` }),
        el('div', { class: 'hud__actions' }, [
          el('button', { class: 'hud__go', type: 'button', text: 'Skate again', onclick: onRestart }),
          el('button', { class: 'hud__ghost', type: 'button', text: 'Back to garage', onclick: onExit }),
        ]),
      ]);
    },
    hideOverlays() {
      overlay.hidden = true;
      overlay.innerHTML = '';
    },
    dispose() {
      clearTimeout(flashTimer);
    },
  };
}
