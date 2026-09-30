import { el } from './controls.js';
import { MARBLES, marblePreview } from '../marbles/designs.js';

/**
 * Everything on screen for the marble races: the marble picker, the
 * countdown, the race HUD (clock, your place, a live leaderboard, fire
 * warnings, camera and speed buttons) and the results with a podium.
 */

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const time = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function dot(id) {
  const d = el('i', { class: 'mhud__dot' });
  d.style.background = MARBLES[id].swatch;
  return d;
}

export function createMarbleHud(host, {
  onRace, onNewTrack, onCamera, onSpeed, onExit, onAgain, onChangeMarble,
}) {
  const root = el('div', { class: 'mhud' });
  const overlay = el('div', { class: 'mhud__overlay', hidden: 'hidden' });
  const clock = el('div', { class: 'mhud__clock', text: '0:00.0' });
  const place = el('div', { class: 'mhud__place' });
  const board = el('ol', { class: 'mhud__board' });
  const banner = el('div', { class: 'mhud__banner', 'data-show': 'false' });
  const count = el('div', { class: 'mhud__count', 'data-show': 'false' });
  const cameraButton = el('button', { class: 'hud__exit', type: 'button', text: 'Camera: mine', onclick: () => onCamera() });
  const speedButton = el('button', { class: 'hud__exit', type: 'button', text: '1×', onclick: () => onSpeed() });
  const bar = el('div', { class: 'mhud__bar', hidden: 'hidden' }, [
    el('div', { class: 'mhud__left' }, [clock, place]),
    el('div', { class: 'mhud__right' }, [
      speedButton,
      cameraButton,
      el('button', { class: 'hud__exit', type: 'button', text: 'Garage', onclick: () => onExit() }),
    ]),
  ]);
  root.append(bar, board, banner, count);
  host.append(root, overlay);

  let selected = 0;
  let shownBoard = '';

  function panel(children, wide = false) {
    overlay.innerHTML = '';
    overlay.append(el('div', { class: `hud__panel mhud__panel${wide ? ' mhud__panel--wide' : ''}` }, children));
    overlay.hidden = false;
  }

  return {
    showPicker(chosen, trackName) {
      selected = chosen;
      bar.hidden = true;
      board.hidden = true;
      const tiles = MARBLES.map((design, id) => {
        const tile = el('button', {
          class: 'mhud__tile', type: 'button', 'aria-pressed': String(id === selected), 'aria-label': design.name,
        }, [marblePreview(design, 64), el('span', { text: design.name })]);
        tile.addEventListener('click', () => {
          selected = id;
          for (const t of tiles) t.setAttribute('aria-pressed', 'false');
          tile.setAttribute('aria-pressed', 'true');
        });
        return tile;
      });
      panel([
        el('p', { class: 'hud__eyebrow', text: trackName }),
        el('h2', { text: 'Marble Race' }),
        el('p', { class: 'hud__lead', text: 'Pick your marble. 24 race down a brand-new run — first to the line wins.' }),
        el('div', { class: 'mhud__grid' }, tiles),
        el('div', { class: 'hud__actions mhud__actions' }, [
          el('button', { class: 'hud__go', type: 'button', text: 'Race!', onclick: () => onRace(selected) }),
          el('button', { class: 'hud__ghost', type: 'button', text: 'New track', onclick: () => onNewTrack(selected) }),
          el('button', { class: 'hud__ghost', type: 'button', text: 'Garage', onclick: () => onExit() }),
        ]),
      ], true);
    },

    showCountdown(n) {
      overlay.hidden = true;
      bar.hidden = false;
      board.hidden = false;
      count.textContent = n > 0 ? String(n) : 'GO!';
      count.dataset.show = 'true';
      count.dataset.go = String(n <= 0);
    },
    hideCountdown() {
      count.dataset.show = 'false';
    },

    setCamera(mode) {
      cameraButton.textContent = `Camera: ${mode}`;
    },
    setSpeed(speed) {
      speedButton.textContent = `${speed}×`;
    },

    /** Called every frame; only touches the DOM when something changed. */
    update(standings, playerId, t) {
      const clockText = time(t);
      if (clock.textContent !== clockText) clock.textContent = clockText;
      const mine = standings.findIndex((m) => m.id === playerId);
      const me = standings[mine];
      const placeText = me.eliminated ? 'Burnt out' : `${ordinal(mine + 1)} of ${standings.length}`;
      if (place.textContent !== placeText) place.textContent = placeText;

      // Top five, plus you if you are further back.
      const rows = standings.slice(0, 5).map((m, i) => [i, m]);
      if (mine >= 5) rows.push([mine, me]);
      const key = rows.map(([i, m]) => `${i}${m.id}${m.finished}${m.eliminated}`).join('|');
      if (key === shownBoard) return;
      shownBoard = key;
      board.innerHTML = '';
      for (const [i, m] of rows) {
        const row = el('li', { class: `mhud__row${m.id === playerId ? ' mhud__row--me' : ''}` }, [
          el('b', { text: String(i + 1) }),
          dot(m.id),
          el('span', { text: MARBLES[m.id].name }),
          el('em', { text: m.finished ? '🏁' : m.eliminated ? '🔥' : '' }),
        ]);
        board.append(row);
      }
    },

    banner(text, tone = 'warn') {
      banner.textContent = text;
      banner.dataset.tone = tone;
      banner.dataset.show = String(!!text);
    },

    showResults(standings, playerId, winnerTime) {
      bar.hidden = true;
      board.hidden = true;
      banner.dataset.show = 'false';
      const mine = standings.findIndex((m) => m.id === playerId);
      const me = standings[mine];
      const podium = el('div', { class: 'mhud__podium' }, [1, 0, 2].map((i) => {
        const m = standings[i];
        return el('div', { class: `mhud__step mhud__step--${i + 1}` }, [
          marblePreview(MARBLES[m.id], i === 0 ? 72 : 56),
          el('strong', { text: MARBLES[m.id].name }),
          el('span', { text: m.finished ? time(m.finishTime) : '—' }),
          el('i', { class: 'mhud__plinth', text: String(i + 1) }),
        ]);
      }));
      const list = el('ol', { class: 'mhud__results' }, standings.map((m, i) => el('li', {
        class: m.id === playerId ? 'mhud__row--me' : '',
      }, [
        el('b', { text: String(i + 1) }),
        dot(m.id),
        el('span', { text: MARBLES[m.id].name }),
        el('em', {
          text: m.finished ? (i === 0 ? time(m.finishTime) : `+${(m.finishTime - winnerTime).toFixed(1)}s`) : 'burnt',
        }),
      ])));
      const headline = me.eliminated
        ? `${MARBLES[playerId].name} was caught by the fire`
        : mine === 0 ? `${MARBLES[playerId].name} wins!` : `${MARBLES[playerId].name} finished ${ordinal(mine + 1)}`;
      panel([
        el('p', { class: 'hud__eyebrow', text: 'Results' }),
        el('h2', { text: headline }),
        podium,
        list,
        el('div', { class: 'hud__actions mhud__actions' }, [
          el('button', { class: 'hud__go', type: 'button', text: 'Race again', onclick: () => onAgain() }),
          el('button', { class: 'hud__ghost', type: 'button', text: 'Change marble', onclick: () => onChangeMarble() }),
          el('button', { class: 'hud__ghost', type: 'button', text: 'Garage', onclick: () => onExit() }),
        ]),
      ], true);
    },

    dispose() {
      root.remove();
      overlay.remove();
    },
  };
}
