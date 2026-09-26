/**
 * Central configuration for the board.
 *
 * Everything the UI can change lives in one flat-ish object so it can be
 * serialised to localStorage (so a phone remembers your board) and to the URL
 * hash (so you can fire a build across to another device by sharing a link).
 */

export const DEFAULT_CONFIG = {
  // Physical dimensions, in the same units as the model: 1 = 10mm, so a
  // width of 3.0 is a 30mm deck.
  shape: {
    length: 9.6,
    width: 3.0,
    concave: 0.1,
    kickHeight: 0.74,
    kickStart: 0.62,
    wheelbase: 2.6,
    wheelRadius: 0.4,
    axleDrop: 0.66,
  },
  deck: {
    skin: 'flame',
    base: '#16181d',
    ink: '#ff5722',
    accent: '#ffd54a',
    wood: '#c89a63',
    customImage: null, // data URL when the user uploads their own graphic
    gloss: 0.55,
  },
  grip: {
    enabled: true,
    color: '#15151a',
    pattern: 'classic', // classic | perforated | logo-cut | clear
    tint: 0.0,
  },
  trucks: {
    finish: 'polished', // polished | raw | black | gold | anodised
    color: '#b9c0c9',
    bushings: '#ff8a2b',
  },
  wheels: {
    color: '#f2f3f5',
    style: 'solid', // solid | duo | stripe | spoke | clear
    accent: '#2b7fff',
    bearings: '#8d939c',
  },
  hardware: {
    color: '#c7ccd4',
  },
  scene: {
    background: 'studio', // studio | dusk | concrete | void | mint
    floor: true,
    shadows: true,
    autoRotate: false,
    rotateSpeed: 1.0,
  },
};

export const PRESETS = [
  {
    id: 'ember',
    name: 'Ember',
    swatch: ['#ff5722', '#16181d', '#ffd54a'],
    config: {
      deck: { skin: 'flame', base: '#16181d', ink: '#ff5722', accent: '#ffd54a' },
      grip: { color: '#141419', pattern: 'classic' },
      trucks: { finish: 'black', color: '#2a2d33', bushings: '#ff8a2b' },
      wheels: { color: '#f5f5f7', style: 'solid', accent: '#ff5722' },
      hardware: { color: '#d8ad4a' },
    },
  },
  {
    id: 'arcade',
    name: 'Arcade',
    swatch: ['#12f7d6', '#1b1040', '#ff2e97'],
    config: {
      deck: { skin: 'grid', base: '#1b1040', ink: '#12f7d6', accent: '#ff2e97' },
      grip: { color: '#101018', pattern: 'perforated' },
      trucks: { finish: 'anodised', color: '#7b5cff', bushings: '#12f7d6' },
      wheels: { color: '#2a1a5e', style: 'clear', accent: '#ff2e97' },
      hardware: { color: '#c2c8d2' },
    },
  },
  {
    id: 'dispatch',
    name: 'Dispatch',
    swatch: ['#f2c200', '#1d1d1d', '#ffffff'],
    config: {
      deck: { skin: 'stripes', base: '#1d1d1d', ink: '#f2c200', accent: '#ffffff' },
      grip: { color: '#17171a', pattern: 'logo-cut' },
      trucks: { finish: 'raw', color: '#9aa1ab', bushings: '#f2c200' },
      wheels: { color: '#1d1d1d', style: 'duo', accent: '#f2c200' },
      hardware: { color: '#b6bcc4' },
    },
  },
  {
    id: 'bone',
    name: 'Bone',
    swatch: ['#efe7d8', '#b4a58a', '#3a3a38'],
    config: {
      deck: { skin: 'natural', base: '#e6d6b8', ink: '#8a6b43', accent: '#3a3a38' },
      grip: { color: '#2b2b2e', pattern: 'clear' },
      trucks: { finish: 'polished', color: '#c6ccd4', bushings: '#e2d3ae' },
      wheels: { color: '#efe7d8', style: 'solid', accent: '#b4a58a' },
      hardware: { color: '#cdd2d9' },
    },
  },
  {
    id: 'field',
    name: 'Field',
    swatch: ['#5a6b45', '#2f3626', '#d3c89b'],
    config: {
      deck: { skin: 'camo', base: '#2f3626', ink: '#5a6b45', accent: '#d3c89b' },
      grip: { color: '#191b16', pattern: 'classic' },
      trucks: { finish: 'black', color: '#31352c', bushings: '#8a9668' },
      wheels: { color: '#d3c89b', style: 'solid', accent: '#5a6b45' },
      hardware: { color: '#8f9688' },
    },
  },
  {
    id: 'riptide',
    name: 'Riptide',
    swatch: ['#00d4ff', '#04243a', '#ffffff'],
    config: {
      deck: { skin: 'splatter', base: '#04243a', ink: '#00d4ff', accent: '#ffffff' },
      grip: { color: '#0d1720', pattern: 'perforated' },
      trucks: { finish: 'polished', color: '#c3cad3', bushings: '#00d4ff' },
      wheels: { color: '#eafcff', style: 'spoke', accent: '#00d4ff' },
      hardware: { color: '#c9ced6' },
    },
  },
  {
    id: 'checker',
    name: 'Checker',
    swatch: ['#ffffff', '#111111', '#e63946'],
    config: {
      deck: { skin: 'checker', base: '#111111', ink: '#ffffff', accent: '#e63946' },
      grip: { color: '#121214', pattern: 'classic' },
      trucks: { finish: 'raw', color: '#a8aeb7', bushings: '#e63946' },
      wheels: { color: '#ffffff', style: 'duo', accent: '#111111' },
      hardware: { color: '#b9bfc7' },
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    swatch: ['#ff9a3c', '#ff3c78', '#2b1055'],
    config: {
      deck: { skin: 'fade', base: '#2b1055', ink: '#ff3c78', accent: '#ff9a3c' },
      grip: { color: '#16101f', pattern: 'clear' },
      trucks: { finish: 'gold', color: '#d9a441', bushings: '#ff3c78' },
      wheels: { color: '#ffd9a0', style: 'clear', accent: '#ff3c78' },
      hardware: { color: '#d9a441' },
    },
  },
];

/** Stock sizes, the way a fingerboard shop would list them. */
export const SHAPE_PRESETS = [
  {
    id: 'street',
    name: 'Street',
    note: '96 × 30mm',
    shape: { length: 9.6, width: 3.0, concave: 0.1, kickHeight: 0.74, kickStart: 0.62, wheelbase: 2.6 },
  },
  {
    id: 'wide',
    name: 'Wide',
    note: '98 × 34mm',
    shape: { length: 9.8, width: 3.4, concave: 0.13, kickHeight: 0.78, kickStart: 0.6, wheelbase: 2.7 },
  },
  {
    id: 'mini',
    name: 'Mini',
    note: '91 × 28mm',
    shape: { length: 9.1, width: 2.8, concave: 0.09, kickHeight: 0.7, kickStart: 0.62, wheelbase: 2.4 },
  },
  {
    id: 'cruiser',
    name: 'Cruiser',
    note: '104 × 33mm',
    shape: { length: 10.4, width: 3.3, concave: 0.06, kickHeight: 0.52, kickStart: 0.7, wheelbase: 3.0 },
  },
  {
    id: 'popsicle',
    name: 'Pop',
    note: '100 × 31mm',
    shape: { length: 10.0, width: 3.1, concave: 0.14, kickHeight: 0.88, kickStart: 0.58, wheelbase: 2.8 },
  },
];

const STORAGE_KEY = 'fingerboard-3d:config:v1';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep clone that is happy with the plain data we keep in config. */
export function clone(value) {
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

/** Merge `patch` into `target` in place, one level of nesting deep. */
export function merge(target, patch) {
  for (const key of Object.keys(patch)) {
    if (isPlainObject(patch[key]) && isPlainObject(target[key])) {
      merge(target[key], patch[key]);
    } else {
      target[key] = clone(patch[key]);
    }
  }
  return target;
}

/**
 * A tiny observable store. Subscribers get (config, changedSections) so the
 * renderer can rebuild only the materials that actually moved.
 */
export function createStore() {
  const config = merge(clone(DEFAULT_CONFIG), loadSaved() ?? {});
  const listeners = new Set();

  function notify(sections, meta) {
    for (const listener of listeners) listener(config, sections, meta);
  }

  return {
    get config() {
      return config;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Apply a patch such as `{ deck: { ink: '#fff' } }`.
     * `draft: true` marks a value still being dragged, which lets expensive
     * listeners (the geometry rebuild) do cheaper work until it settles.
     */
    patch(part, options = {}) {
      merge(config, part);
      if (options.persist !== false) save(config);
      notify(new Set(Object.keys(part)), { draft: options.draft === true });
    },
    /** Replace everything (presets, share links, reset). */
    replace(next, options = {}) {
      merge(config, merge(clone(DEFAULT_CONFIG), next));
      if (options.persist !== false) save(config);
      notify(new Set(Object.keys(DEFAULT_CONFIG)), { draft: false });
    },
    reset() {
      this.replace(clone(DEFAULT_CONFIG));
    },
  };
}

function save(config) {
  try {
    // The custom image can be megabytes; keep it out of localStorage.
    const slim = clone(config);
    slim.deck.customImage = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    /* private browsing, quota, disabled storage — not worth breaking over */
  }
}

function loadSaved() {
  const fromUrl = readShareHash();
  if (fromUrl) return fromUrl;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- sharing */

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Build a link that rebuilds this exact board on another device. */
export function buildShareUrl(config) {
  const slim = clone(config);
  slim.deck.customImage = null; // too big for a URL
  const url = new URL(window.location.href);
  url.hash = `b=${toBase64Url(JSON.stringify(slim))}`;
  return url.toString();
}

function readShareHash() {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash.startsWith('b=')) return null;
    return JSON.parse(fromBase64Url(hash.slice(2)));
  } catch {
    return null;
  }
}
