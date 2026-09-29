/**
 * Comic-book pop-ups: starbursts, big outlined shout words and the flourish
 * that fires on a really good landing.
 *
 * The bursts are CSS clip-path stars and the lettering is a heavy system face
 * with a drawn-on outline, so nothing here is a downloaded asset either.
 */

/** A spiky comic starburst as a clip-path polygon. */
function starburst(spikes, innerRatio) {
  const coords = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = (i % 2 === 0 ? 0.5 : 0.5 * innerRatio) * 100;
    const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    coords.push(`${(50 + Math.cos(angle) * radius).toFixed(1)}% ${(50 + Math.sin(angle) * radius).toFixed(1)}%`);
  }
  return `polygon(${coords.join(',')})`;
}

const WORDS = {
  small: ['NICE!', 'POP!', 'SWEET!', 'CLEAN!'],
  big: ['RAD!', 'BOOM!', 'POW!', 'WHAM!', 'BANG!'],
  huge: ['WOW!', 'EXCELLENT!', 'KA-POW!', 'INSANE!', 'MASSIVE!'],
  grind: ['GRIND!', 'SHRED!', 'SCREEECH!'],
  bail: ['OOF!', 'WIPEOUT!', 'OUCH!', 'SPLAT!'],
};

const PALETTE = {
  small: { fill: '#ffd93d', ink: '#1b1200' },
  big: { fill: '#ff8c1a', ink: '#2a1000' },
  huge: { fill: '#ff3b5c', ink: '#fff4e0' },
  grind: { fill: '#3ddcff', ink: '#062330' },
  bail: { fill: '#9aa3b2', ink: '#12151c' },
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function createComicPops(host) {
  const layer = document.createElement('div');
  layer.className = 'comic';
  host.append(layer);

  const live = new Set();

  /**
   * @param {object} options
   * @param {'small'|'big'|'huge'|'grind'|'bail'} options.tier
   * @param {string} [options.detail]  second line, e.g. the trick name
   * @param {number} [options.x]       0..1 across the screen
   * @param {number} [options.y]       0..1 down the screen
   */
  function pop({ tier = 'small', detail = '', word, x = 0.5, y = 0.35 } = {}) {
    const palette = PALETTE[tier] ?? PALETTE.small;
    const node = document.createElement('div');
    node.className = `comic__pop comic__pop--${tier}`;
    node.style.left = `${Math.min(0.86, Math.max(0.14, x)) * 100}%`;
    node.style.top = `${Math.min(0.8, Math.max(0.12, y)) * 100}%`;
    node.style.setProperty('--tilt', `${(Math.random() - 0.5) * 16}deg`);
    node.style.setProperty('--fill', palette.fill);
    node.style.setProperty('--ink', palette.ink);

    const burst = document.createElement('i');
    burst.className = 'comic__burst';
    burst.style.clipPath = starburst(11 + Math.floor(Math.random() * 4), 0.62);

    const shadow = document.createElement('i');
    shadow.className = 'comic__burstshadow';
    shadow.style.clipPath = burst.style.clipPath;

    const label = document.createElement('span');
    label.className = 'comic__word';
    label.textContent = word ?? pick(WORDS[tier] ?? WORDS.small);

    node.append(shadow, burst, label);

    if (detail) {
      const sub = document.createElement('span');
      sub.className = 'comic__detail';
      sub.textContent = detail;
      node.append(sub);
    }

    layer.append(node);
    live.add(node);
    // Long enough for the drift-and-fade to finish; the element is inert after.
    setTimeout(() => {
      node.remove();
      live.delete(node);
    }, 1400);
  }

  /** The full-width flourish for a landing worth making a fuss of. */
  function flourish(text, detail) {
    const node = document.createElement('div');
    node.className = 'comic__flourish';
    node.innerHTML = '<i class="comic__rays"></i>';

    const label = document.createElement('strong');
    label.textContent = text;
    node.append(label);

    if (detail) {
      const sub = document.createElement('span');
      sub.textContent = detail;
      node.append(sub);
    }

    layer.append(node);
    setTimeout(() => node.remove(), 1500);
  }

  return {
    pop,
    flourish,
    clear() {
      layer.innerHTML = '';
      live.clear();
    },
    dispose() {
      layer.remove();
    },
  };
}

export { WORDS };
