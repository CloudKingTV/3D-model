import { h, fmt, ordinal, clockText, countUp, confetti, ITEM_INFO } from './dom.js';
import { marbleCanvas } from './shell.js';
import { MARBLES } from '../designs.js';
import { WORLDS } from '../themes.js';
import { levelInfo } from '../progression.js';

/**
 * Everything on screen around a race: the lobby filling up, the party and
 * predict set-ups, the race HUD (place, clock, coins, a strip showing the
 * whole field, steering pads, the power-up button) and the results with
 * rewards counting up.
 *
 * `field[id]` describes each marble: { design, name, flag, level, human }.
 */

export function createRaceUi(host, app) {
  const root = h('div.mm-race', { data: { mode: 'none' } });
  host.append(root);
  let hud = null;
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clear = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    root.innerHTML = '';
    root.dataset.mode = 'none';
    hud = null;
  };
  const tap = (fn, sound = 'tap') => (event) => {
    app.sfx(sound);
    app.buzz(8);
    fn(event);
  };
  const dot = (field, id) => h('i.mm-dot', { style: { background: MARBLES[field[id].design].swatch } });

  /* --------------------------------------------------------------- lobby */

  /** Racers join one by one, then `onReady`. Tap to skip ahead. */
  function lobby({ title, subtitle, world, field, trackName, onReady, onCancel }) {
    clear();
    root.dataset.mode = 'lobby';
    const w = WORLDS[world];
    const count = h('b', { text: `0 / ${field.length}` });
    const list = h('ol.mm-lobby__list');
    const status = h('p.mm-lobby__status', { text: 'Finding racers…' });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      timers = [];
      list.innerHTML = '';
      field.forEach((racer, id) => list.append(row(racer, id)));
      count.textContent = `${field.length} / ${field.length}`;
      status.textContent = 'Everyone\'s here!';
      app.sfx('box');
      later(() => onReady(), 650);
    };
    const row = (racer, id) => h('li', { data: { human: String(!!racer.human) } }, [
      marbleCanvas(racer.design, 26),
      h('span.mm-lobby__flag', { text: racer.flag ?? '' }),
      h('span.mm-lobby__name', { text: racer.name }),
      racer.level ? h('small', { text: String(racer.level) }) : null,
    ]);
    const panel = h('div.mm-lobby', { onclick: () => finish() }, [
      h('div.mm-lobby__head', {}, [
        h('small', { text: `${w.emoji} ${w.name} · ${trackName}` }),
        h('h2', { text: title }),
        subtitle ? h('p.mm-sub', { text: subtitle }) : null,
      ]),
      h('div.mm-lobby__count', {}, [h('span.mm-spinner'), count]),
      list,
      status,
      h('small.mm-lobby__skip', { text: 'Tap to skip' }),
      onCancel ? h('button.mm-link', { type: 'button', onclick: (e) => { e.stopPropagation(); app.sfx('back'); clear(); onCancel(); } }, 'Leave') : null,
    ]);
    root.append(panel);
    // Humans are there first, then the rest trickle in.
    const order = field.map((_, i) => i).sort((a, b) => Number(!!field[b].human) - Number(!!field[a].human));
    let shown = 0;
    order.forEach((id, k) => {
      later(() => {
        list.append(row(field[id], id));
        shown += 1;
        count.textContent = `${shown} / ${field.length}`;
        app.sfx('tick');
        list.scrollTop = list.scrollHeight;
        if (shown === field.length) finish();
      }, 250 + k * (1700 / field.length) + Math.random() * 90);
    });
  }

  /* --------------------------------------------------------------- party */

  function partySetup({ names: initial, onStart, onCancel }) {
    clear();
    root.dataset.mode = 'party';
    const names = initial.length ? [...initial] : ['Player 1', 'Player 2'];
    const list = h('div.mm-party__list');
    const draw = () => {
      list.innerHTML = '';
      names.forEach((name, i) => {
        list.append(h('div.mm-party__row', {}, [
          h('span.mm-party__n', { text: String(i + 1) }),
          h('input', {
            value: name, maxlength: '12', 'aria-label': `Player ${i + 1} name`,
            oninput: (e) => { names[i] = e.target.value; },
          }),
          names.length > 2 ? h('button.mm-party__x', { type: 'button', 'aria-label': 'Remove', onclick: tap(() => { names.splice(i, 1); draw(); }, 'back') }, '✕') : null,
        ]));
      });
      add.disabled = names.length >= 8;
    };
    const add = h('button.mm-btn.mm-btn--ghost.mm-btn--small', { type: 'button', onclick: tap(() => { names.push(`Player ${names.length + 1}`); draw(); }) }, '+ Add player');
    root.append(h('div.mm-panel', {}, [
      h('h2', { text: '🎉 Party race' }),
      h('p.mm-sub', { text: 'Everyone gets a random marble, and only your marbles race. Pass the phone round, then watch it play out.' }),
      list,
      add,
      h('div.mm-row', {}, [
        h('button.mm-btn.mm-btn--ghost', { type: 'button', onclick: tap(() => { clear(); onCancel(); }, 'back') }, 'Back'),
        h('button.mm-btn.mm-btn--go', { type: 'button', onclick: tap(() => onStart(names.map((n, i) => n.trim() || `Player ${i + 1}`))) }, 'Shuffle marbles'),
      ]),
    ]));
    draw();
  }

  /** The slot-machine reveal of who got which marble. */
  function partyReveal({ field, onDone }) {
    clear();
    root.dataset.mode = 'party';
    const humans = field.map((r, id) => [r, id]).filter(([r]) => r.human);
    const cards = humans.map(([racer]) => {
      const slot = h('div.mm-slot', {}, marbleCanvas(Math.floor(Math.random() * MARBLES.length), 64));
      const label = h('b', { text: '???' });
      return { racer, slot, label, node: h('div.mm-party__card', {}, [slot, h('span', { text: racer.name }), label]) };
    });
    const go = h('button.mm-btn.mm-btn--go', { type: 'button', disabled: true, onclick: tap(() => onDone(), 'go') }, 'Race!');
    root.append(h('div.mm-panel', {}, [h('h2', { text: 'Your marbles' }), h('div.mm-party__cards', {}, cards.map((c) => c.node)), go]));
    cards.forEach((c, k) => {
      let spins = 0;
      const spin = () => {
        spins += 1;
        c.slot.innerHTML = '';
        const settle = spins > 10 + k * 4;
        c.slot.append(marbleCanvas(settle ? c.racer.design : Math.floor(Math.random() * MARBLES.length), 64));
        app.sfx('tick');
        if (settle) {
          c.label.textContent = MARBLES[c.racer.design].name;
          c.node.dataset.done = 'true';
          app.sfx('coin');
          if (k === cards.length - 1) go.disabled = false;
        } else later(spin, 60 + spins * 6);
      };
      later(spin, 200);
    });
  }

  /* ------------------------------------------------------------- predict */

  function predictSetup({ field, onPick, onCancel }) {
    clear();
    root.dataset.mode = 'predict';
    let pick = null;
    const start = h('button.mm-btn.mm-btn--go', { type: 'button', disabled: true, onclick: tap(() => onPick(pick), 'go') }, 'Pick a marble');
    const tiles = field.map((racer, id) => h('button.mm-tile', {
      type: 'button',
      onclick: tap(() => {
        pick = id;
        for (const t of tiles) t.dataset.equipped = 'false';
        tiles[id].dataset.equipped = 'true';
        start.disabled = false;
        start.textContent = `Back ${MARBLES[racer.design].name}`;
      }),
    }, [marbleCanvas(racer.design, 44), h('span', { text: MARBLES[racer.design].name })]));
    root.append(h('div.mm-panel.mm-panel--wide', {}, [
      h('h2', { text: '🔮 Predict the winner' }),
      h('p.mm-sub', { text: 'No steering, no power-ups — pure luck. Winner pays 400 coins, a podium finish 150.' }),
      h('div.mm-grid.mm-grid--predict', {}, tiles),
      h('div.mm-row', {}, [h('button.mm-btn.mm-btn--ghost', { type: 'button', onclick: tap(() => { clear(); onCancel(); }, 'back') }, 'Back'), start]),
    ]));
  }

  /* ----------------------------------------------------------------- hud */

  /**
   * @param {object} o
   * @param {boolean} o.steering  show the steering pads and power-up button
   * @param {boolean} o.speedButton  show 1x / 2x / 4x
   */
  function raceHud({ field, playerId, steering, speedButton, tutorial, onPause, onCamera, onSpeed, onSteer, onItem }) {
    clear();
    root.dataset.mode = 'race';
    const place = h('b.mm-hud__place', { text: '—' });
    const of = h('small', { text: `/ ${field.length}` });
    const clock = h('span.mm-hud__clock', { text: '0:00.0' });
    const coins = h('b', { text: '0' });
    const strip = h('div.mm-strip');
    const stripDots = field.map((racer, id) => {
      const d = h('i', { style: { background: MARBLES[racer.design].swatch }, data: { me: String(id === playerId), human: String(!!racer.human) } });
      strip.append(d);
      return d;
    });
    const board = h('ol.mm-board');
    const banner = h('div.mm-banner', { data: { show: 'false' } });
    const count = h('div.mm-count', { data: { show: 'false' } });
    const tags = h('div.mm-tags');
    const cameraButton = h('button.mm-round', { type: 'button', 'aria-label': 'Camera', onclick: tap(() => onCamera()) }, '🎥');
    const speed = speedButton ? h('button.mm-round.mm-round--text', { type: 'button', onclick: tap(() => onSpeed()) }, '1×') : null;
    const hint = h('div.mm-hint', { data: { show: 'false' } });
    let hintTimer = 0;

    const itemButton = h('button.mm-item', { type: 'button', 'aria-label': 'Use power-up', data: { has: 'false' } }, [h('span.mm-item__icon', { text: '❔' }), h('small', { text: 'EMPTY' })]);
    const steerPad = (dir) => {
      const b = h('button.mm-steer', { type: 'button', 'aria-label': dir < 0 ? 'Steer left' : 'Steer right' }, dir < 0 ? '◀' : '▶');
      const press = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.dataset.on = 'true'; onSteer(dir, true); app.buzz(6); };
      const release = () => { b.dataset.on = 'false'; onSteer(dir, false); };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    itemButton.addEventListener('pointerdown', (e) => { e.preventDefault(); onItem(); });

    root.append(
      h('div.mm-hud__top', {}, [
        h('button.mm-round', { type: 'button', 'aria-label': 'Pause', onclick: tap(() => onPause()) }, '❚❚'),
        h('div.mm-hud__centre', {}, [h('div.mm-hud__placewrap', {}, [place, of]), clock]),
        h('div.mm-hud__right', {}, [speed, cameraButton]),
      ]),
      h('div.mm-hud__sub', {}, [strip, steering ? h('div.mm-hud__coins', {}, [h('span.mm-coin.mm-coin--sm'), coins]) : null]),
      board,
      tags,
      banner,
      count,
      hint,
      steering ? h('div.mm-controls', {}, [h('div.mm-steerpair', {}, [steerPad(-1), steerPad(1)]), itemButton]) : null,
    );
    if (tutorial && steering) {
      const coach = h('div.mm-coach', {}, [
        h('div', {}, [h('b', { text: '◀ ▶' }), h('span', { text: 'Hold to steer your marble' })]),
        h('div', {}, [h('b', { text: '❓' }), h('span', { text: 'Roll through boxes for power-ups, tap to use' })]),
        h('div', {}, [h('b', { text: '🪙' }), h('span', { text: 'Grab coins · swipe to look around' })]),
      ]);
      root.append(coach);
      later(() => coach.remove(), 6500);
    }

    let shownBoard = '';
    let lastPlace = 0;
    hud = {
      update(order, race, t) {
        const text = clockText(t);
        if (clock.textContent !== text) clock.textContent = text;
        const mine = order.findIndex((m) => m.id === playerId);
        if (mine >= 0) {
          const me = order[mine];
          const p = me.eliminated ? '🔥' : ordinal(mine + 1);
          if (place.textContent !== p) {
            place.textContent = p;
            if (lastPlace && mine + 1 < lastPlace) { place.dataset.bump = 'up'; setTimeout(() => { place.dataset.bump = ''; }, 300); }
            lastPlace = mine + 1;
          }
          const c = String(race.marbles[playerId].coins ?? 0);
          if (coins.textContent !== c) coins.textContent = c;
        }
        // The field on one strip, start to finish.
        const length = race.track.length;
        for (const m of race.marbles) {
          const d = stripDots[m.id];
          if (!d) continue;
          const f = m.finished ? 1 : Math.max(0, Math.min(1, m.progress / length));
          d.style.left = `${(f * 100).toFixed(1)}%`;
          d.dataset.out = String(!!m.eliminated);
        }
        // Top three, plus you.
        const rows = order.slice(0, 3).map((m, i) => [i, m]);
        if (mine >= 3) rows.push([mine, order[mine]]);
        const key = rows.map(([i, m]) => `${i}${m.id}${m.finished}${m.eliminated}`).join('|');
        if (key !== shownBoard) {
          shownBoard = key;
          board.innerHTML = '';
          for (const [i, m] of rows) {
            const racer = field[m.id];
            board.append(h('li', { data: { me: String(m.id === playerId), human: String(!!racer.human) } }, [
              h('b', { text: String(i + 1) }), dot(field, m.id), h('span', { text: racer.name }),
              h('em', { text: m.finished ? '🏁' : m.eliminated ? '🔥' : '' }),
            ]));
          }
        }
      },
      setItem(item) {
        itemButton.dataset.has = String(!!item);
        itemButton.querySelector('.mm-item__icon').textContent = item ? ITEM_INFO[item].icon : '❔';
        itemButton.querySelector('small').textContent = item ? ITEM_INFO[item].name.toUpperCase() : 'EMPTY';
        if (item) {
          itemButton.dataset.pop = 'true';
          setTimeout(() => { itemButton.dataset.pop = 'false'; }, 350);
        }
      },
      /** Name tags over marbles (party races). */
      tags(list) {
        tags.innerHTML = '';
        for (const tag of list) {
          tags.append(h('span.mm-tagname', { text: tag.name, style: { left: `${tag.x * 100}%`, top: `${tag.y * 100}%`, borderColor: tag.colour } }));
        }
      },
      banner(text, tone = 'warn') {
        banner.textContent = text;
        banner.dataset.tone = tone;
        banner.dataset.show = String(!!text);
      },
      countdown(n) {
        count.textContent = n > 0 ? String(n) : 'GO!';
        count.dataset.show = 'true';
        count.dataset.go = String(n <= 0);
        count.dataset.n = String(n);
      },
      hideCountdown() {
        count.dataset.show = 'false';
      },
      setSpeed(s) {
        if (speed) speed.textContent = `${s}×`;
      },
      setCamera(mode) {
        cameraButton.textContent = { mine: '🎥', leader: '👑', overview: '🕊️' }[mode] ?? '🎥';
      },
      hint(text) {
        hint.textContent = text;
        hint.dataset.show = 'true';
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => { hint.dataset.show = 'false'; }, 3500);
      },
      flash(tone) {
        root.dataset.flash = tone;
        setTimeout(() => { root.dataset.flash = ''; }, 250);
      },
      speedLines(on) {
        root.dataset.speed = String(on);
      },
    };
    return hud;
  }

  function pauseMenu({ onResume, onQuit, onSettings, settings, quitLabel }) {
    const overlay = h('div.mm-pause', {}, h('div.mm-panel', {}, [
      h('h2', { text: 'Paused' }),
      h('div.mm-settings', {}, [['sound', 'Sound effects'], ['music', 'Music'], ['haptics', 'Vibration']].map(([key, label]) => h('label.mm-switch', {}, [
        h('span', { text: label }),
        h('input', { type: 'checkbox', checked: settings[key] ? true : null, onchange: (e) => onSettings(key, e.target.checked) }),
        h('i'),
      ]))),
      h('button.mm-btn.mm-btn--go', { type: 'button', onclick: tap(() => { overlay.remove(); onResume(); }) }, 'Resume'),
      h('button.mm-btn.mm-btn--ghost', { type: 'button', onclick: tap(() => { overlay.remove(); onQuit(); }, 'back') }, quitLabel),
    ]));
    root.append(overlay);
    return () => overlay.remove();
  }

  /* ------------------------------------------------------------- results */

  /**
   * @param {object} o
   * @param {object[]} o.order   final standings
   * @param {object} o.report    rewards from progression.applyRace
   * @param {object} o.before    { xp } before the race
   */
  function results({ mode, field, order, playerId, report, before, save, extra = [], againLabel, onAgain, onHome, headline }) {
    clear();
    root.dataset.mode = 'results';
    const mine = order.findIndex((m) => m.id === playerId);
    const me = order[mine];
    const podium = h('div.mm-podium', {}, [1, 0, 2].map((i) => {
      const m = order[i];
      if (!m) return null;
      const racer = field[m.id];
      return h('div.mm-step', { data: { n: String(i + 1), me: String(m.id === playerId) } }, [
        marbleCanvas(racer.design, i === 0 ? 64 : 50),
        h('b', { text: racer.name }),
        h('small', { text: m.finished ? `${m.finishTime.toFixed(1)}s` : '—' }),
        h('i.mm-step__plinth', { text: String(i + 1) }),
      ]);
    }));
    const winner = order[0];
    const standings = h('ol.mm-standings', {}, order.map((m, i) => {
      const racer = field[m.id];
      return h('li', { data: { me: String(m.id === playerId), human: String(!!racer.human) } }, [
        h('b', { text: String(i + 1) }), dot(field, m.id), h('span', { text: racer.name }),
        h('em', { text: m.finished ? (i === 0 || !winner.finished ? `${m.finishTime.toFixed(1)}s` : `+${(m.finishTime - winner.finishTime).toFixed(1)}s`) : m.eliminated ? '🔥' : 'racing' }),
      ]);
    }));

    // A party has no "you": the trophy goes to whoever won.
    const place = mode === 'party' ? '🏆' : me?.eliminated ? '🔥' : me ? ordinal(mine + 1) : '';
    const rewards = h('div.mm-rewards');
    const xpBar = h('div.mm-progress.mm-progress--xp', {}, h('i'));
    const xpText = h('small');
    const lines = [];
    if (report) {
      if (report.prize) lines.push(['Prize', report.prize]);
      if (report.trackCoins) lines.push(['Coins picked up', report.trackCoins]);
      for (const [label, value] of extra) lines.push([label, value]);
      for (const line of lines) {
        line.node = h('b', { text: '+0' });
        rewards.append(h('div.mm-reward', {}, [h('span', { text: line[0] }), h('span.mm-reward__v', {}, [h('span.mm-coin.mm-coin--sm'), line.node])]));
      }
      rewards.append(h('div.mm-reward.mm-reward--xp', {}, [h('span', { text: `⭐ +${report.xp} XP` }), xpText]), xpBar);
      for (const mission of report.missions) rewards.append(h('div.mm-reward.mm-reward--mission', {}, [h('span', { text: `🎯 ${mission.text}` }), h('b', { text: 'Done!' })]));
    }

    const panel = h('div.mm-results', {}, [
      h('div.mm-results__head', {}, [
        place ? h('div.mm-results__place', { data: { top: String(mine === 0) } }, place) : null,
        h('h2', { text: headline }),
      ]),
      podium,
      rewards,
      h('details.mm-details', {}, [h('summary', { text: 'Full results' }), standings]),
      h('div.mm-row.mm-row--sticky', {}, [
        h('button.mm-btn.mm-btn--ghost', { type: 'button', onclick: tap(() => onHome(), 'back') }, 'Home'),
        h('button.mm-btn.mm-btn--go', { type: 'button', onclick: tap(() => onAgain(), 'go') }, againLabel),
      ]),
    ]);
    root.append(panel);
    if (mine === 0 || (mode !== 'league' && report?.prize >= 150)) confetti(root, 90);

    // Count everything up, then fill the XP bar.
    (async () => {
      await new Promise((r) => later(r, 450));
      for (const line of lines) {
        if (!line.node) continue;
        await countUp(line.node, 0, line[1], { prefix: '+', duration: 700, onTick: () => app.sfx('coinsCount') });
      }
      if (report) {
        const start = levelInfo(before.xp);
        const end = levelInfo(save.xp);
        xpText.textContent = `Level ${end.level}`;
        const bar = xpBar.firstChild;
        bar.style.transition = 'none';
        bar.style.width = `${start.fraction * 100}%`;
        requestAnimationFrame(() => {
          bar.style.transition = 'width 0.9s cubic-bezier(.2,.8,.2,1)';
          bar.style.width = end.level > start.level ? '100%' : `${end.fraction * 100}%`;
        });
        if (end.level > start.level) {
          later(() => {
            bar.style.transition = 'none';
            bar.style.width = '0%';
            requestAnimationFrame(() => {
              bar.style.transition = 'width 0.6s ease-out';
              bar.style.width = `${end.fraction * 100}%`;
            });
          }, 950);
        }
      }
    })();
  }

  return {
    root,
    lobby,
    partySetup,
    partyReveal,
    predictSetup,
    raceHud,
    pauseMenu,
    results,
    get hud() {
      return hud;
    },
    clear,
    dispose() {
      clear();
      root.remove();
    },
  };
}

export { fmt };
