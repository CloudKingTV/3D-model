import { el } from './controls.js';

/**
 * The game's on-screen furniture: score, timer, combo, charge meter and the
 * start / pause / game-over overlays. Kept as DOM rather than drawn into the
 * canvas so it stays crisp and readable at any pixel ratio.
 */
export function createGameHud(host, { onExit, onRestart }) {
  const coarse = matchMedia('(pointer: coarse)').matches;

  const score = el('div', { class: 'hud__score', text: '0' });
  const best = el('div', { class: 'hud__best', text: 'Best 0' });
  const time = el('div', { class: 'hud__time', text: '1:30' });
  const combo = el('div', { class: 'hud__combo', 'data-show': 'false' });
  const flash = el('div', { class: 'hud__flash' });
  const chargeFill = el('i', { class: 'hud__chargefill' });
  const charge = el('div', { class: 'hud__charge', 'data-show': 'false' }, [chargeFill]);

  const overlay = el('div', { class: 'hud__overlay', hidden: 'hidden' });

  host.append(
    el('div', { class: 'hud' }, [
      el('div', { class: 'hud__corner hud__corner--left' }, [score, best]),
      el('div', { class: 'hud__corner hud__corner--right' }, [
        time,
        el('button', { class: 'hud__exit', type: 'button', text: 'Garage', onclick: onExit }),
      ]),
      combo,
      flash,
      charge,
    ]),
    overlay,
  );

  let flashTimer = 0;

  function panel(children) {
    overlay.innerHTML = '';
    overlay.append(el('div', { class: 'hud__panel' }, children));
    overlay.hidden = false;
  }

  const controlHint = coarse
    ? [
      ['Hold', 'crouch — longer hold, bigger ollie'],
      ['Release', 'pop'],
      ['Swipe ←  →', 'kickflip / heelflip'],
      ['Swipe ↓  ↑', 'pop shuv / 360 shuv'],
    ]
    : [
      ['Hold Space', 'crouch — longer hold, bigger ollie'],
      ['Release', 'pop'],
      ['A / D', 'kickflip / heelflip'],
      ['S / W', 'pop shuv / 360 shuv'],
    ];

  function hintList() {
    return el('dl', { class: 'hud__keys' }, controlHint.flatMap(([key, what]) => [
      el('dt', { text: key }),
      el('dd', { text: what }),
    ]));
  }

  return {
    setScore(value) {
      score.textContent = Math.round(value).toLocaleString();
    },
    setBest(value) {
      best.textContent = `Best ${Math.round(value).toLocaleString()}`;
    },
    setTime(seconds) {
      const whole = Math.ceil(seconds);
      time.textContent = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
      time.dataset.low = String(seconds <= 10);
    },
    setCombo(count, multiplier) {
      combo.dataset.show = String(count > 0);
      combo.textContent = `${multiplier.toFixed(1)}×  ·  ${count} combo`;
    },
    setCharge(value) {
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
    showStart() {
      panel([
        el('p', { class: 'hud__eyebrow', text: '90 seconds' }),
        el('h2', { text: 'Fingerboard Park' }),
        el('p', { class: 'hud__lead', text: 'Grind the rails, launch the transitions, land clean. Every landing without a bail raises your multiplier.' }),
        hintList(),
        el('button', {
          class: 'hud__go',
          type: 'button',
          text: coarse ? 'Tap to drop in' : 'Press Space to drop in',
          onclick: onRestart,
        }),
      ]);
    },
    showPaused() {
      panel([
        el('h2', { text: 'Paused' }),
        hintList(),
        el('p', { class: 'hud__lead', text: 'Press P to carry on.' }),
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
