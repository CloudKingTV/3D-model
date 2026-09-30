import { h, fmt, confetti } from './dom.js';
import { MARBLES, marblePreview } from '../designs.js';
import { WORLDS } from '../themes.js';
import {
  RARITY, TRAILS, LEAGUES, DAILY, CAPSULE_PRICE, rarityOf, levelInfo, leagueUnlocked, leagueById, prizeFor,
  dailyStatus, claimDaily, missionById, claimMission, openCapsule, buyMarble, buyTrail, dailyDeal, refreshDay,
} from '../progression.js';

/**
 * The menus: home (your marble, the league picker, play), the collection,
 * the shop, missions and the daily reward, and your profile with settings.
 * Plus the modals everything shares: rewards, level-ups, capsule reveals.
 *
 * `app` supplies the save and the actions (see marbles/index.js).
 */

const previewCache = new Map();
/** A marble picture, drawn once per size and cloned after. */
function preview(id, size) {
  const key = `${id}:${size}`;
  if (!previewCache.has(key)) previewCache.set(key, marblePreview(MARBLES[id], size * 2));
  const source = previewCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d').drawImage(source, 0, 0);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.className = 'mm-marble';
  return canvas;
}

export { preview as marbleCanvas };

function trailSwatch(trail) {
  const colours = trail.colours.length ? trail.colours : ['#2a3142', '#2a3142'];
  return h('span.mm-trail-swatch', { style: { background: `linear-gradient(90deg, ${colours.join(', ')})` } });
}

export function createShell(host, app) {
  const root = h('div.mm');
  const top = h('div.mm-top');
  const screen = h('div.mm-screen');
  const tabs = h('nav.mm-tabs');
  const modalLayer = h('div.mm-modals');
  const toastNode = h('div.mm-toast', { role: 'status' });
  root.append(top, screen, tabs, modalLayer, toastNode);
  host.append(root);

  let current = 'home';
  let leagueIndex = Math.max(0, LEAGUES.findIndex((l) => l.id === app.profile.save.league));
  let toastTimer = 0;
  let resetTimer = 0;
  const save = () => app.profile.save;

  const tap = (fn, sound = 'tap') => (event) => {
    app.sfx(sound);
    app.buzz(8);
    fn(event);
  };

  /* -------------------------------------------------------------- top bar */

  function renderTop() {
    const s = save();
    const info = levelInfo(s.xp);
    top.innerHTML = '';
    const parts = [
      h('button.mm-level', { type: 'button', onclick: tap(() => show('profile')), 'aria-label': `Level ${info.level}` }, [
        h('span.mm-level__badge', { text: String(info.level) }),
        h('span.mm-level__bar', {}, h('i', { style: { width: `${Math.round(info.fraction * 100)}%` } })),
      ]),
      h('div.mm-top__spacer'),
      h('button.mm-pill.mm-pill--coins', { type: 'button', onclick: tap(() => show('shop')) }, [
        h('span.mm-coin'), h('b', { text: fmt(s.coins) }),
      ]),
      s.capsules > 0
        ? h('button.mm-pill.mm-pill--capsule', { type: 'button', onclick: tap(() => show('shop')) }, [h('span', { text: '🎁' }), h('b', { text: String(s.capsules) })])
        : null,
    ];
    top.append(...parts.filter(Boolean));
  }

  /* ---------------------------------------------------------------- tabs */

  const TABS = [
    ['home', '🏁', 'Race'],
    ['marbles', '🔮', 'Marbles'],
    ['shop', '🛒', 'Shop'],
    ['missions', '🎯', 'Missions'],
    ['profile', '👤', 'Profile'],
  ];

  function claimable() {
    const s = save();
    refreshDay(s, app.day());
    let n = s.missions.list.filter((m) => !m.claimed && m.progress >= (missionById(m.id)?.target ?? Infinity)).length;
    if (dailyStatus(s, app.day()).available) n += 1;
    return n;
  }

  function renderTabs() {
    tabs.innerHTML = '';
    const badge = claimable();
    for (const [id, icon, label] of TABS) {
      tabs.append(h('button.mm-tab', {
        type: 'button', 'aria-current': current === id ? 'page' : null, onclick: tap(() => show(id)),
      }, [
        h('span.mm-tab__icon', { text: icon }),
        h('span.mm-tab__label', { text: label }),
        id === 'missions' && badge ? h('span.mm-badge', { text: String(badge) }) : null,
        id === 'shop' && save().capsules ? h('span.mm-badge', { text: String(save().capsules) }) : null,
      ]));
    }
  }

  /* ---------------------------------------------------------------- home */

  function renderHome() {
    const s = save();
    const league = LEAGUES[leagueIndex];
    const world = WORLDS[league.world];
    const unlocked = leagueUnlocked(s, league);
    const design = MARBLES[s.marble];
    const rarity = RARITY[rarityOf(design.name)];

    const hero = h('button.mm-hero', { type: 'button', onclick: tap(() => show('marbles')) }, [
      h('div.mm-hero__glow', { style: { background: `radial-gradient(circle, ${rarity.colour}66, transparent 65%)` } }),
      preview(s.marble, 150),
      h('div.mm-hero__name', {}, [h('b', { text: design.name }), h('span.mm-rarity', { text: rarity.label, style: { background: rarity.colour } })]),
    ]);

    const leagueCard = h('div.mm-league', { data: { world: league.world, locked: String(!unlocked) } }, [
      h('button.mm-league__arrow', { type: 'button', 'aria-label': 'Previous league', disabled: leagueIndex === 0, onclick: tap(() => { leagueIndex -= 1; render(); }) }, '‹'),
      h('div.mm-league__body', {}, [
        h('div.mm-league__world', { text: `${world.emoji} ${world.name}` }),
        h('div.mm-league__name', { text: league.name }),
        h('div.mm-league__facts', {}, [
          h('span', { text: `👥 ${league.racers}` }),
          h('span', {}, [h('span.mm-coin.mm-coin--sm'), ` ${league.fee ? fmt(league.fee) : 'Free'}`]),
          h('span', { text: `🏆 ${fmt(prizeFor(league, 1))}` }),
        ]),
        h('div.mm-league__dots', {}, LEAGUES.map((l, i) => h('i', { data: { on: String(i === leagueIndex) } }))),
      ]),
      h('button.mm-league__arrow', { type: 'button', 'aria-label': 'Next league', disabled: leagueIndex === LEAGUES.length - 1, onclick: tap(() => { leagueIndex += 1; render(); }) }, '›'),
    ]);

    const canAfford = s.coins >= league.fee;
    const play = h('button.mm-btn.mm-btn--play', {
      type: 'button',
      disabled: !unlocked,
      onclick: tap(() => {
        if (!canAfford) {
          app.sfx('error');
          toast('Not enough coins — try a cheaper league');
          return;
        }
        s.league = league.id;
        app.profile.commit();
        app.play(league.id);
      }, 'go'),
    }, unlocked
      ? [h('span', { text: 'PLAY' }), h('small', { text: league.fee ? `Entry ${fmt(league.fee)} coins` : 'Free entry' })]
      : [h('span', { text: `🔒 Level ${league.level}` }), h('small', { text: 'Level up to unlock' })]);

    const daily = dailyStatus(s, app.day());
    return h('div.mm-home', {}, [
      h('h1.mm-logo', {}, [h('span', { text: 'MARBLE' }), h('span', { text: 'MAYHEM' })]),
      daily.available ? h('button.mm-gift', { type: 'button', onclick: tap(() => dailyPopup()) }, [h('span', { text: '🎁' }), h('b', { text: 'Daily' })]) : null,
      hero,
      leagueCard,
      play,
      h('div.mm-modes', {}, [
        h('button.mm-btn.mm-btn--mode', { type: 'button', onclick: tap(() => app.party()) }, [h('span', { text: '🎉' }), h('b', { text: 'Party' }), h('small', { text: 'Friends, one phone' })]),
        h('button.mm-btn.mm-btn--mode', { type: 'button', onclick: tap(() => app.predict()) }, [h('span', { text: '🔮' }), h('b', { text: 'Predict' }), h('small', { text: 'Call the winner' })]),
      ]),
      app.exit ? h('button.mm-link', { type: 'button', onclick: tap(() => app.exit(), 'back') }, '← Back to the Fingerboard garage') : null,
    ]);
  }

  /* -------------------------------------------------------- collection */

  let collectionTab = 'marbles';

  function renderMarbles() {
    const s = save();
    const seg = h('div.mm-seg', {}, [['marbles', 'Marbles'], ['trails', 'Trails']].map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': String(collectionTab === id), onclick: tap(() => { collectionTab = id; render(); }),
    }, label)));
    if (collectionTab === 'trails') {
      return h('div.mm-page', {}, [h('h2', { text: 'Collection' }), seg, h('div.mm-list', {}, TRAILS.map((trail) => {
        const owned = s.trails.includes(trail.id);
        const equipped = s.trail === trail.id;
        return h('div.mm-card.mm-card--row', {}, [
          trailSwatch(trail),
          h('div.mm-card__text', {}, [h('b', { text: trail.name }), h('small', { text: owned ? (equipped ? 'Equipped' : 'Owned') : `${fmt(trail.price)} coins` })]),
          equipped ? h('span.mm-tag', { text: '✓' })
            : owned ? h('button.mm-btn.mm-btn--small', { type: 'button', onclick: tap(() => { s.trail = trail.id; app.profile.commit(); render(); }) }, 'Equip')
              : h('button.mm-btn.mm-btn--small.mm-btn--gold', {
                type: 'button',
                onclick: tap(() => {
                  if (!buyTrail(s, trail.id)) { app.sfx('error'); toast('Not enough coins'); return; }
                  s.trail = trail.id;
                  app.sfx('buy');
                  app.profile.commit();
                  render();
                  toast(`${trail.name} trail unlocked!`);
                }),
              }, [h('span.mm-coin.mm-coin--sm'), ` ${fmt(trail.price)}`]),
        ]);
      }))]);
    }
    const owned = s.owned.length;
    const order = MARBLES.map((_, i) => i).sort((a, b) => {
      const ra = Object.keys(RARITY).indexOf(rarityOf(MARBLES[a].name));
      const rb = Object.keys(RARITY).indexOf(rarityOf(MARBLES[b].name));
      return ra - rb || a - b;
    });
    return h('div.mm-page', {}, [
      h('h2', { text: 'Collection' }),
      seg,
      h('p.mm-sub', { text: `${owned} of ${MARBLES.length} marbles` }),
      h('div.mm-grid', {}, order.map((id) => {
        const design = MARBLES[id];
        const rarity = RARITY[rarityOf(design.name)];
        const have = s.owned.includes(id);
        return h('button.mm-tile', {
          type: 'button',
          data: { owned: String(have), equipped: String(s.marble === id) },
          style: { '--rarity': rarity.colour },
          onclick: tap(() => marbleDetail(id)),
        }, [preview(id, 52), h('span', { text: design.name }), have ? null : h('i.mm-tile__lock', { text: '🔒' })]);
      })),
    ]);
  }

  function marbleDetail(id) {
    const s = save();
    const design = MARBLES[id];
    const rarityKey = rarityOf(design.name);
    const rarity = RARITY[rarityKey];
    const have = s.owned.includes(id);
    const close = modal(h('div.mm-detail', { style: { '--rarity': rarity.colour } }, [
      h('div.mm-detail__glow'),
      preview(id, 140),
      h('h3', { text: design.name }),
      h('span.mm-rarity', { text: rarity.label, style: { background: rarity.colour } }),
      h('p.mm-sub', { text: have ? (s.marble === id ? 'Your racer' : 'In your collection') : 'Buy it, or find it in a capsule' }),
      have
        ? h('button.mm-btn.mm-btn--go', {
          type: 'button', disabled: s.marble === id,
          onclick: tap(() => { s.marble = id; app.profile.commit(); close(); render(); toast(`${design.name} is racing for you`); }),
        }, s.marble === id ? 'Equipped' : 'Race with this')
        : h('button.mm-btn.mm-btn--gold', {
          type: 'button',
          onclick: tap(() => {
            if (!buyMarble(s, id, design.name)) { app.sfx('error'); toast('Not enough coins'); return; }
            s.marble = id;
            app.sfx('buy');
            app.profile.commit();
            close();
            render();
            celebrate(`${design.name} unlocked!`);
          }),
        }, [h('span.mm-coin'), ` ${fmt(rarity.price)}`]),
    ]));
  }

  /* ---------------------------------------------------------------- shop */

  function renderShop() {
    const s = save();
    const deal = dailyDeal(s, app.names, app.day());
    const cards = [];
    if (deal) {
      const rarity = RARITY[rarityOf(deal.name)];
      cards.push(h('div.mm-card.mm-card--deal', { style: { '--rarity': rarity.colour } }, [
        h('div.mm-card__ribbon', { text: '-40% today' }),
        preview(deal.id, 84),
        h('div.mm-card__text', {}, [
          h('b', { text: deal.name }),
          h('span.mm-rarity', { text: rarity.label, style: { background: rarity.colour } }),
          h('small', {}, [h('s', { text: fmt(deal.full) }), ' ', h('span.mm-countdown', { text: untilMidnight() })]),
        ]),
        h('button.mm-btn.mm-btn--gold.mm-btn--small', {
          type: 'button',
          onclick: tap(() => {
            if (!buyMarble(s, deal.id, deal.name, deal.price)) { app.sfx('error'); toast('Not enough coins'); return; }
            app.sfx('buy');
            app.profile.commit();
            render();
            celebrate(`${deal.name} unlocked!`);
          }),
        }, [h('span.mm-coin.mm-coin--sm'), ` ${fmt(deal.price)}`]),
      ]));
    }
    cards.push(h('div.mm-card.mm-card--capsule', {}, [
      h('div.mm-capsule', {}, h('span', { text: '🎁' })),
      h('div.mm-card__text', {}, [
        h('b', { text: 'Marble capsule' }),
        h('small', { text: 'A random marble. Duplicates pay back coins.' }),
        h('div.mm-odds', {}, Object.values(RARITY).map((r) => h('span', { style: { color: r.colour }, text: `${r.label} ${r.weight}%` }))),
      ]),
      h('div.mm-card__actions', {}, [
        s.capsules ? h('button.mm-btn.mm-btn--go.mm-btn--small', { type: 'button', onclick: tap(() => capsule(false)) }, `Open (${s.capsules})`) : null,
        h('button.mm-btn.mm-btn--gold.mm-btn--small', { type: 'button', onclick: tap(() => capsule(true)) }, [h('span.mm-coin.mm-coin--sm'), ` ${fmt(CAPSULE_PRICE)}`]),
      ]),
    ]));
    cards.push(h('button.mm-card.mm-card--row', { type: 'button', onclick: tap(() => { collectionTab = 'trails'; show('marbles'); }) }, [
      trailSwatch(TRAILS.find((t) => t.id === 'rainbow')),
      h('div.mm-card__text', {}, [h('b', { text: 'Trails' }), h('small', { text: 'Leave a streak of colour behind your marble' })]),
      h('span.mm-chev', { text: '›' }),
    ]));
    return h('div.mm-page', {}, [h('h2', { text: 'Shop' }), h('p.mm-sub', { text: 'Everything here is bought with coins you win racing.' }), h('div.mm-list', {}, cards)]);
  }

  function capsule(buy) {
    const s = save();
    const result = openCapsule(s, app.names, Math.random, { buy });
    if (!result) {
      app.sfx('error');
      toast(buy ? 'Not enough coins' : 'No capsules left');
      return;
    }
    app.profile.commit();
    renderTop();
    reveal(result);
  }

  /** Shake, crack, and out rolls the marble. */
  function reveal(result) {
    const rarity = RARITY[result.rarity];
    const box = h('div.mm-reveal__capsule', {}, h('span', { text: '🎁' }));
    const body = h('div.mm-reveal', { style: { '--rarity': rarity.colour } }, [box]);
    const close = modal(body, { dismissible: false });
    let shakes = 0;
    const shake = setInterval(() => {
      app.sfx('shake');
      app.buzz(15);
      shakes += 1;
      if (shakes >= 5) {
        clearInterval(shake);
        app.sfx('reveal');
        body.innerHTML = '';
        body.dataset.open = 'true';
        body.append(
          h('div.mm-reveal__rays'),
          preview(result.id, 150),
          h('span.mm-rarity', { text: rarity.label, style: { background: rarity.colour } }),
          h('h3', { text: result.name }),
          h('p.mm-sub', { text: result.duplicate ? `Already yours — +${fmt(result.refund)} coins` : 'New marble!' }),
          h('div.mm-row', {}, [
            result.duplicate ? null : h('button.mm-btn.mm-btn--go', {
              type: 'button', onclick: tap(() => { save().marble = result.id; app.profile.commit(); close(); render(); }),
            }, 'Race with it'),
            h('button.mm-btn.mm-btn--ghost', { type: 'button', onclick: tap(() => { close(); render(); }) }, 'Nice!'),
          ]),
        );
        if (!result.duplicate) confetti(body);
      }
    }, 380);
  }

  /* ------------------------------------------------------------ missions */

  function renderMissions() {
    const s = save();
    refreshDay(s, app.day());
    const daily = dailyStatus(s, app.day());
    const week = h('div.mm-week', {}, DAILY.map((reward, i) => {
      const done = daily.available ? i < daily.index : i <= daily.index;
      const todayCell = i === daily.index;
      return h('div.mm-day', { data: { done: String(done), today: String(todayCell && daily.available) } }, [
        h('small', { text: `Day ${i + 1}` }),
        h('span', { text: reward.capsule ? '🎁' : '🪙' }),
        h('b', { text: fmt(reward.coins) }),
      ]);
    }));
    return h('div.mm-page', {}, [
      h('h2', { text: 'Missions' }),
      h('div.mm-card.mm-card--daily', {}, [
        h('div.mm-card__head', {}, [h('b', { text: 'Daily login' }), h('small', { text: `Streak ${daily.available ? daily.streak - 1 : daily.streak} 🔥` })]),
        week,
        daily.available
          ? h('button.mm-btn.mm-btn--go', { type: 'button', onclick: tap(() => dailyPopup()) }, 'Claim today\'s reward')
          : h('p.mm-sub', { text: `Come back tomorrow · ${untilMidnight()}` }),
      ]),
      h('div.mm-card__head.mm-card__head--out', {}, [h('b', { text: 'Today\'s missions' }), h('small.mm-countdown', { text: `New in ${untilMidnight()}` })]),
      h('div.mm-list', {}, s.missions.list.map((m) => {
        const def = missionById(m.id);
        if (!def) return null;
        const done = m.progress >= def.target;
        return h('div.mm-card.mm-mission', { data: { done: String(done), claimed: String(m.claimed) } }, [
          h('div.mm-card__text', {}, [
            h('b', { text: def.text }),
            h('div.mm-progress', {}, [h('i', { style: { width: `${(m.progress / def.target) * 100}%` } }), h('span', { text: `${m.progress} / ${def.target}` })]),
            h('small', {}, [h('span.mm-coin.mm-coin--sm'), ` ${def.coins}  ·  ⭐ ${def.xp} XP`]),
          ]),
          m.claimed ? h('span.mm-tag', { text: '✓' })
            : !done ? null
            : h('button.mm-btn.mm-btn--small.mm-btn--gold', {
              type: 'button',
              onclick: tap(() => {
                const reward = claimMission(s, m.id);
                if (!reward) return;
                app.sfx('buy');
                app.profile.commit();
                render();
                toast(`+${reward.coins} coins · +${reward.xp} XP`);
                if (reward.levels.length) levelUps(reward.levels);
              }),
            }, 'Claim'),
        ]);
      })),
    ]);
  }

  function untilMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(0, Math.floor((next - now) / 60000));
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  }

  function dailyPopup() {
    const s = save();
    const status = dailyStatus(s, app.day());
    if (!status.available) return;
    const reward = DAILY[status.index];
    const close = modal(h('div.mm-daily', {}, [
      h('div.mm-daily__icon', { text: reward.capsule ? '🎁' : '🪙' }),
      h('h3', { text: `Day ${status.index + 1} reward` }),
      h('p.mm-sub', { text: status.streak > 1 ? `${status.streak} days in a row — keep it going!` : 'Come back every day for bigger rewards.' }),
      h('div.mm-daily__amount', {}, [h('span.mm-coin'), ` +${fmt(reward.coins)}`, reward.capsule ? ' + 🎁 capsule' : '']),
      h('button.mm-btn.mm-btn--go', {
        type: 'button',
        onclick: tap(() => {
          claimDaily(s, app.day());
          app.sfx('levelUp');
          app.profile.commit();
          close();
          render();
        }),
      }, 'Claim'),
    ]));
  }

  /* ------------------------------------------------------------- profile */

  function renderProfile() {
    const s = save();
    const info = levelInfo(s.xp);
    const st = s.stats;
    const toggle = (key, label) => h('label.mm-switch', {}, [
      h('span', { text: label }),
      h('input', {
        type: 'checkbox', checked: s.settings[key] ? true : null,
        onchange: (e) => { app.setSetting(key, e.target.checked); app.sfx('tap'); },
      }),
      h('i'),
    ]);
    const name = h('input.mm-name', {
      value: s.name, maxlength: '14', 'aria-label': 'Your name',
      onchange: (e) => { s.name = e.target.value.trim().slice(0, 14) || 'You'; app.profile.commit(); },
    });
    const quality = h('div.mm-seg.mm-seg--small', {}, [['auto', 'Auto'], ['high', 'High'], ['low', 'Battery']].map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': String(s.settings.quality === id),
      onclick: tap(() => { app.setSetting('quality', id); render(); }),
    }, label)));
    const winRate = st.races ? Math.round((st.wins / st.races) * 100) : 0;
    return h('div.mm-page', {}, [
      h('div.mm-profile', {}, [
        preview(s.marble, 72),
        h('div', {}, [name, h('small', { text: `Level ${info.level} · ${fmt(info.into)} / ${fmt(info.need)} XP` }),
          h('div.mm-progress.mm-progress--xp', {}, h('i', { style: { width: `${info.fraction * 100}%` } }))]),
      ]),
      h('div.mm-stats', {}, [
        ['Races', st.races], ['Wins', st.wins], ['Podiums', st.podiums], ['Win rate', `${winRate}%`],
        ['Best finish', st.bestPlace ? `#${st.bestPlace}` : '—'], ['Fastest', st.fastest ? `${st.fastest.toFixed(1)}s` : '—'],
        ['Coins won', fmt(st.coinsEarned)], ['Power-ups', st.items], ['Marbles', `${s.owned.length}/${MARBLES.length}`],
      ].map(([k, v]) => h('div', {}, [h('b', { text: String(v) }), h('small', { text: k })]))),
      h('h3.mm-h3', { text: 'Settings' }),
      h('div.mm-card.mm-settings', {}, [
        toggle('sound', 'Sound effects'),
        toggle('music', 'Music'),
        toggle('haptics', 'Vibration'),
        toggle('steering', 'Steer your marble (league races)'),
        h('div.mm-setting', {}, [h('span', { text: 'Graphics' }), quality]),
      ]),
      h('button.mm-link.mm-link--danger', {
        type: 'button',
        onclick: tap(() => confirm('Reset all progress?', 'Coins, levels and marbles go back to the start. This can\'t be undone.', 'Reset', () => {
          app.profile.reset();
          render();
          toast('Progress reset');
        })),
      }, 'Reset progress'),
      h('p.mm-fine', { text: 'Marble Mayhem · every sound, marble and world is generated on your device.' }),
    ]);
  }

  /* -------------------------------------------------------------- modals */

  function modal(content, { dismissible = true, onClose } = {}) {
    const backdrop = h('div.mm-modal');
    const sheet = h('div.mm-modal__sheet', {}, content);
    backdrop.append(sheet);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.dataset.closing = 'true';
      setTimeout(() => backdrop.remove(), 180);
      onClose?.();
    };
    if (dismissible) {
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { app.sfx('back'); close(); } });
      sheet.prepend(h('button.mm-modal__close', { type: 'button', 'aria-label': 'Close', onclick: tap(close, 'back') }, '✕'));
    }
    modalLayer.append(backdrop);
    return close;
  }

  function confirm(title, text, action, onYes) {
    const close = modal(h('div.mm-confirm', {}, [
      h('h3', { text: title }),
      h('p.mm-sub', { text }),
      h('div.mm-row', {}, [
        h('button.mm-btn.mm-btn--ghost', { type: 'button', onclick: tap(() => close(), 'back') }, 'Cancel'),
        h('button.mm-btn.mm-btn--danger', { type: 'button', onclick: tap(() => { close(); onYes(); }) }, action),
      ]),
    ]));
    return close;
  }

  function celebrate(text) {
    app.sfx('levelUp');
    confetti(root, 50);
    toast(text);
  }

  /** Level-up cards, one after another. */
  function levelUps(levels, done) {
    if (!levels.length) {
      done?.();
      return;
    }
    const [next, ...rest] = levels;
    app.sfx('levelUp');
    app.buzz([20, 40, 20]);
    const body = h('div.mm-levelup', {}, [
      h('div.mm-levelup__rays'),
      h('small', { text: 'LEVEL UP!' }),
      h('div.mm-levelup__badge', { text: String(next.level) }),
      h('div.mm-levelup__rewards', {}, [
        h('span', {}, [h('span.mm-coin'), ` +${fmt(next.coins)}`]),
        next.capsule ? h('span', { text: '🎁 +1 capsule' }) : null,
        ...next.unlocks.map((u) => h('span.mm-unlock', { text: `🔓 ${u}` })),
      ]),
      h('button.mm-btn.mm-btn--go', { type: 'button', onclick: tap(() => { close(); setTimeout(() => levelUps(rest, done), 200); }) }, 'Awesome!'),
    ]);
    const close = modal(body, { dismissible: false });
    confetti(body, 60);
    renderTop();
  }

  function toast(text) {
    toastNode.textContent = text;
    toastNode.dataset.show = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastNode.dataset.show = 'false'; }, 2200);
  }

  /* -------------------------------------------------------------- render */

  const SCREENS = { home: renderHome, marbles: renderMarbles, shop: renderShop, missions: renderMissions, profile: renderProfile };

  function render() {
    // Keep the league picker on something you can play.
    renderTop();
    renderTabs();
    const scroll = screen.scrollTop;
    screen.innerHTML = '';
    screen.dataset.screen = current;
    root.dataset.screen = current;
    screen.append(SCREENS[current]());
    screen.scrollTop = current === screen.dataset.last ? scroll : 0;
    screen.dataset.last = current;
  }

  function show(tab = current) {
    current = tab;
    root.dataset.hidden = 'false';
    render();
    clearInterval(resetTimer);
    // Keep the countdowns fresh on screens that show them.
    resetTimer = setInterval(() => {
      for (const node of screen.querySelectorAll('.mm-countdown')) {
        node.textContent = node.textContent.startsWith('New in') ? `New in ${untilMidnight()}` : untilMidnight();
      }
    }, 30000);
  }

  // The highest league you can play is the default after a level-up.
  function bestLeague() {
    const s = save();
    const current2 = leagueById(s.league);
    leagueIndex = LEAGUES.indexOf(current2);
  }
  bestLeague();

  return {
    root,
    show,
    render,
    hide() {
      root.dataset.hidden = 'true';
      clearInterval(resetTimer);
    },
    get visible() {
      return root.dataset.hidden !== 'true';
    },
    toast,
    modal,
    confirm,
    levelUps,
    dailyPopup,
    reveal,
    setLeague(id) {
      leagueIndex = Math.max(0, LEAGUES.findIndex((l) => l.id === id));
    },
    dispose() {
      clearTimeout(toastTimer);
      clearInterval(resetTimer);
      root.remove();
    },
  };
}
