/** Small DOM helpers for the marble game's screens. */

/**
 * h('button.mm-btn.mm-btn--go', { onclick, text: 'Play' }, [children])
 * Classes can ride on the tag; `style` takes an object, `data` a dataset.
 */
export function h(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = `${node.className} ${value}`.trim();
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('--')) node.style.setProperty(k, v);
        else node.style[k] = v;
      }
    }
    else if (key === 'data') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export const clockText = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Count a number up in a node, ticking as it goes. */
export function countUp(node, from, to, { duration = 900, onTick, prefix = '', suffix = '' } = {}) {
  const start = performance.now();
  let lastShown = from;
  return new Promise((resolve) => {
    function frame(now) {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      const value = Math.round(from + (to - from) * eased);
      node.textContent = `${prefix}${fmt(value)}${suffix}`;
      if (value !== lastShown) {
        lastShown = value;
        onTick?.();
      }
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

/** Burst of CSS confetti over `host`. */
export function confetti(host, count = 70) {
  const layer = h('div.mm-confetti');
  const colours = ['#ff3b5c', '#ffd84d', '#3fd6ff', '#7cff4f', '#b35cff', '#ff9f43'];
  for (let i = 0; i < count; i += 1) {
    const bit = h('i', {
      style: {
        left: `${Math.random() * 100}%`,
        background: colours[i % colours.length],
        animationDelay: `${Math.random() * 0.4}s`,
        animationDuration: `${1.8 + Math.random() * 1.6}s`,
        transform: `rotate(${Math.random() * 360}deg)`,
        '--drift': `${(Math.random() - 0.5) * 160}px`,
      },
    });
    layer.append(bit);
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 4000);
}

export const ITEM_INFO = {
  turbo: { icon: '🚀', name: 'Turbo', tip: 'A burst of speed' },
  ghost: { icon: '👻', name: 'Ghost', tip: 'Pass through rivals' },
  shock: { icon: '⚡', name: 'Shockwave', tip: 'Blast rivals away' },
  hop: { icon: '🦘', name: 'Hop', tip: 'Jump over trouble' },
};
