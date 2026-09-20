import * as THREE from 'three';

/**
 * Every graphic in the app is drawn to a canvas at runtime, so there are no
 * binary assets to ship and any colour combination is a valid skin.
 */

const GRAPHIC_W = 1024;
const GRAPHIC_H = 340;

/** Deterministic PRNG so a given skin always draws identically. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel) =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Relative luminance, used to pick readable contrast colours. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas, { srgb = true, repeat = null } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (repeat) texture.repeat.set(repeat[0], repeat[1]);
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------ deck skins */

function drawWoodGrain(ctx, w, h, base, { lines = 90, strength = 0.12, seed = 7 } = {}) {
  const random = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1.4;
  for (let i = 0; i < lines; i += 1) {
    const y = random() * h;
    const amp = 3 + random() * 10;
    const freq = 0.004 + random() * 0.01;
    const phase = random() * Math.PI * 2;
    ctx.strokeStyle = random() > 0.5
      ? rgba('#000000', strength * random())
      : rgba('#ffffff', strength * 0.5 * random());
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
}

/** One lick of flame: a bezier tongue that sweeps out to a sharp tip. */
function flameTongue(ctx, x0, y0, length, width, angle, curl) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const tipX = x0 + dx * length;
  const tipY = y0 + dy * length;

  ctx.beginPath();
  ctx.moveTo(x0 - (nx * width) / 2, y0 - (ny * width) / 2);
  ctx.bezierCurveTo(
    x0 + dx * length * 0.35 - nx * width * 0.55,
    y0 + dy * length * 0.35 - ny * width * 0.55 + curl * 0.4,
    tipX - dx * length * 0.22 - nx * width * 0.12,
    tipY - dy * length * 0.22 - ny * width * 0.12 + curl,
    tipX,
    tipY,
  );
  ctx.bezierCurveTo(
    tipX - dx * length * 0.3 + nx * width * 0.22,
    tipY - dy * length * 0.3 + ny * width * 0.22 + curl * 0.8,
    x0 + dx * length * 0.28 + nx * width * 0.75,
    y0 + dy * length * 0.28 + ny * width * 0.75 + curl * 0.25,
    x0 + (nx * width) / 2,
    y0 + (ny * width) / 2,
  );
  ctx.closePath();
  ctx.fill();
}

/** A set of flames rooted on the left edge and licking toward the right. */
function drawFlameGroup(ctx, w, h, palette) {
  const layers = [
    { color: palette.ink, reach: 0.92, inset: 0, seed: 19 },
    { color: palette.accent, reach: 0.56, inset: h * 0.12, seed: 41 },
  ];

  for (const layer of layers) {
    const random = rng(layer.seed);
    const root = w * 0.22 * layer.reach;
    ctx.fillStyle = layer.color;
    ctx.fillRect(-2, layer.inset, root + 2, h - layer.inset * 2);

    const tongues = 7;
    for (let i = 0; i < tongues; i += 1) {
      const y = layer.inset + ((i + 0.5) / tongues) * (h - layer.inset * 2);
      const length = (w * 0.18 + random() * w * 0.4) * layer.reach;
      const width = ((h - layer.inset * 2) / tongues) * (0.85 + random() * 0.8);
      const angle = (random() - 0.5) * 0.45;
      flameTongue(ctx, root - 4, y, length, width, angle, (random() - 0.5) * h * 0.3);
    }
  }
}

function drawFlames(ctx, w, h, palette) {
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, w, h);
  drawFlameGroup(ctx, w, h, palette);
  // Mirror the same flames off the other end so the deck reads both ways up.
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  drawFlameGroup(ctx, w, h, palette);
  ctx.restore();
}

function drawGrid(ctx, w, h, palette) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, palette.base);
  sky.addColorStop(1, shade(palette.base, -0.4));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sun discs at both ends so the deck reads well whichever way it is held.
  for (const cx of [w * 0.22, w * 0.78]) {
    const sun = ctx.createLinearGradient(0, h * 0.1, 0, h * 0.9);
    sun.addColorStop(0, palette.accent);
    sun.addColorStop(1, palette.ink);
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(cx, h * 0.5, h * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.base;
    for (let i = 0; i < 5; i += 1) {
      const y = h * 0.5 + i * h * 0.052;
      ctx.fillRect(cx - h * 0.35, y, h * 0.7, h * 0.016 + i * 1.6);
    }
  }

  ctx.strokeStyle = rgba(palette.ink, 0.75);
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (x - w / 2) * 0.16, h);
    ctx.stroke();
  }
  for (let i = 0; i < 9; i += 1) {
    const y = h * (i / 9) ** 1.6;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawStripes(ctx, w, h, palette) {
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.22);
  const bands = [
    { color: palette.ink, height: h * 0.34, offset: -h * 0.16 },
    { color: palette.accent, height: h * 0.1, offset: h * 0.12 },
    { color: palette.ink, height: h * 0.05, offset: h * 0.22 },
  ];
  for (const band of bands) {
    ctx.fillStyle = band.color;
    ctx.fillRect(-w, band.offset - band.height / 2, w * 2, band.height);
  }
  ctx.restore();

  ctx.fillStyle = rgba(palette.accent, 0.9);
  ctx.fillRect(0, 0, w, 6);
  ctx.fillRect(0, h - 6, w, 6);
}

function drawCamo(ctx, w, h, palette) {
  const random = rng(53);
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, w, h);
  const layers = [palette.ink, palette.accent, shade(palette.base, 0.18)];
  for (let layer = 0; layer < layers.length; layer += 1) {
    ctx.fillStyle = layers[layer];
    const blobs = 26 - layer * 5;
    for (let i = 0; i < blobs; i += 1) {
      const cx = random() * w;
      const cy = random() * h;
      const points = 7 + Math.floor(random() * 4);
      const radius = 28 + random() * 62 - layer * 8;
      ctx.beginPath();
      for (let p = 0; p <= points; p += 1) {
        const angle = (p / points) * Math.PI * 2;
        const r = radius * (0.55 + random() * 0.7);
        const x = cx + Math.cos(angle) * r * 1.5;
        const y = cy + Math.sin(angle) * r * 0.75;
        if (p === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawSplatter(ctx, w, h, palette) {
  const random = rng(101);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, palette.base);
  bg.addColorStop(1, shade(palette.base, 0.22));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  for (const color of [palette.ink, palette.accent, shade(palette.ink, 0.35)]) {
    ctx.fillStyle = color;
    for (let i = 0; i < 34; i += 1) {
      const cx = random() * w;
      const cy = random() * h;
      const r = 6 + random() * 34;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * (0.7 + random() * 0.8), r, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      for (let d = 0; d < 6; d += 1) {
        const dist = r + random() * 70;
        const angle = random() * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, 1 + random() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawChecker(ctx, w, h, palette) {
  const size = h / 5;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w + size; x += size) {
      const even = (Math.round(x / size) + Math.round(y / size)) % 2 === 0;
      ctx.fillStyle = even ? palette.base : palette.ink;
      ctx.fillRect(x, y, size, size);
    }
  }
  ctx.fillStyle = palette.accent;
  ctx.fillRect(0, h * 0.44, w, h * 0.12);
}

function drawFade(ctx, w, h, palette) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, palette.base);
  gradient.addColorStop(0.5, palette.ink);
  gradient.addColorStop(1, palette.accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = rgba('#ffffff', 0.18);
  ctx.lineWidth = 3;
  for (let i = 1; i <= 7; i += 1) {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, i * h * 0.12, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawNatural(ctx, w, h, palette) {
  drawWoodGrain(ctx, w, h, palette.base, { lines: 150, strength: 0.2, seed: 31 });
  ctx.strokeStyle = rgba(palette.ink, 0.9);
  ctx.lineWidth = 8;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.fillStyle = palette.ink;
  ctx.font = `bold ${Math.round(h * 0.26)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINGERBOARD', w / 2, h / 2);
}

export const DECK_SKINS = [
  { id: 'flame', name: 'Ember', draw: drawFlames },
  { id: 'grid', name: 'Grid', draw: drawGrid },
  { id: 'stripes', name: 'Stripe', draw: drawStripes },
  { id: 'camo', name: 'Camo', draw: drawCamo },
  { id: 'splatter', name: 'Splat', draw: drawSplatter },
  { id: 'checker', name: 'Check', draw: drawChecker },
  { id: 'fade', name: 'Fade', draw: drawFade },
  { id: 'natural', name: 'Natural', draw: drawNatural },
  { id: 'custom', name: 'Upload', draw: null },
];

/** The bottom-graphic texture for the current deck settings. */
export function createDeckGraphic(deck) {
  const canvas = makeCanvas(GRAPHIC_W, GRAPHIC_H);
  const ctx = canvas.getContext('2d');
  const palette = { base: deck.base, ink: deck.ink, accent: deck.accent };

  if (deck.skin === 'custom' && deck.customImage) {
    ctx.fillStyle = deck.base;
    ctx.fillRect(0, 0, GRAPHIC_W, GRAPHIC_H);
    drawImageCover(ctx, deck.customImage, GRAPHIC_W, GRAPHIC_H);
  } else {
    const skin = DECK_SKINS.find((entry) => entry.id === deck.skin) ?? DECK_SKINS[0];
    (skin.draw ?? drawFlames)(ctx, GRAPHIC_W, GRAPHIC_H, palette);
  }

  // Screen-printed graphics stop just shy of the edge; a soft vignette also
  // helps the silhouette read against a bright background.
  const vignette = ctx.createRadialGradient(
    GRAPHIC_W / 2, GRAPHIC_H / 2, GRAPHIC_H * 0.2,
    GRAPHIC_W / 2, GRAPHIC_H / 2, GRAPHIC_W * 0.62,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, GRAPHIC_W, GRAPHIC_H);

  return toTexture(canvas);
}

/**
 * The upload path is synchronous on purpose: the caller re-runs the build once
 * the image has decoded, so by the time we get here the bitmap is ready.
 */
const imageCache = new Map();

function drawImageCover(ctx, src, w, h) {
  const image = imageCache.get(src);
  if (!image) return;
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export function preloadImage(src) {
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      imageCache.set(src, image);
      resolve(image);
    };
    image.onerror = reject;
    image.src = src;
  });
}

/* ------------------------------------------------------- deck top & edge */

/** Bare wood veneer for the top face (visible when grip tape is off). */
export function createVeneerTexture(woodColor) {
  const canvas = makeCanvas(1024, 340);
  const ctx = canvas.getContext('2d');
  drawWoodGrain(ctx, 1024, 340, woodColor, { lines: 170, strength: 0.16, seed: 5 });
  return toTexture(canvas);
}

/**
 * The cut edge of the deck: pale veneers separated by thin dark glue lines,
 * which is what actually reads as plywood at this size. UV.v runs across the
 * thickness, so the bands stack the right way.
 */
export function createPlyTexture(woodColor) {
  const height = 256;
  const canvas = makeCanvas(96, height);
  const ctx = canvas.getContext('2d');
  const plies = 7;

  ctx.fillStyle = shade(woodColor, 0.1);
  ctx.fillRect(0, 0, 96, height);

  // Alternate veneers very gently, then lay the glue lines over the joins.
  for (let i = 0; i < plies; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? shade(woodColor, 0.16) : shade(woodColor, 0.02);
    ctx.fillRect(0, (i / plies) * height, 96, height / plies + 1);
  }
  for (let i = 1; i < plies; i += 1) {
    ctx.fillStyle = rgba('#3a2413', 0.42);
    ctx.fillRect(0, (i / plies) * height - 1, 96, 2);
  }

  const random = rng(11);
  for (let i = 0; i < 600; i += 1) {
    ctx.fillStyle = rgba('#000000', 0.05 * random());
    ctx.fillRect(random() * 96, random() * height, 2 + random() * 6, 1);
  }

  return toTexture(canvas, { repeat: [14, 1] });
}

/* ------------------------------------------------------------- grip tape */

/** Grip needs a bumpy roughness/normal feel more than it needs colour. */
export function createGripTextures(grip) {
  const size = 512;
  const colorCanvas = makeCanvas(size, size);
  const ctx = colorCanvas.getContext('2d');
  const random = rng(77);

  ctx.fillStyle = grip.color;
  ctx.fillRect(0, 0, size, size);

  // Silicon-carbide speckle.
  for (let i = 0; i < 26000; i += 1) {
    const value = random();
    ctx.fillStyle = value > 0.5 ? rgba('#ffffff', 0.10 * value) : rgba('#000000', 0.5 * value);
    ctx.fillRect(random() * size, random() * size, 1.6, 1.6);
  }

  if (grip.pattern === 'perforated') {
    ctx.fillStyle = rgba('#ffffff', 0.13);
    for (let y = 12; y < size; y += 36) {
      for (let x = 12; x < size; x += 36) {
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const bumpCanvas = makeCanvas(size, size);
  const bump = bumpCanvas.getContext('2d');
  bump.fillStyle = '#7a7a7a';
  bump.fillRect(0, 0, size, size);
  const bumpRandom = rng(78);
  for (let i = 0; i < 30000; i += 1) {
    const value = bumpRandom();
    bump.fillStyle = value > 0.5 ? `rgba(255,255,255,${value})` : `rgba(0,0,0,${value})`;
    bump.fillRect(bumpRandom() * size, bumpRandom() * size, 2, 2);
  }

  return {
    map: toTexture(colorCanvas, { repeat: [7, 2.2] }),
    bumpMap: toTexture(bumpCanvas, { srgb: false, repeat: [7, 2.2] }),
  };
}

/** A grip cut-out stencil laid over the tape, in the deck's ink colour. */
export function createGripDecal(grip, ink) {
  const canvas = makeCanvas(1024, 340);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 340);
  ctx.fillStyle = ink;
  ctx.font = 'bold 150px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.95;
  ctx.fillText('/// FB', 512, 176);
  return toTexture(canvas);
}

/* ---------------------------------------------------------------- wheels */

/**
 * The wheel is a lathe: U runs around the circumference and V runs along the
 * profile, so V 0-0.36 is one sidewall, 0.42-0.58 the tread and 0.64-1 the
 * other sidewall. Every style here is expressed in those bands.
 */
export function createWheelTexture(wheels) {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const band = (from, to, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, from * size, size, (to - from) * size);
  };

  ctx.fillStyle = wheels.color;
  ctx.fillRect(0, 0, size, size);

  if (wheels.style === 'duo') {
    band(0, 0.36, wheels.accent);
    band(0.64, 1, wheels.accent);
  } else if (wheels.style === 'stripe') {
    band(0.46, 0.54, wheels.accent);
  } else if (wheels.style === 'spoke') {
    // Vertical stripes in the sidewall bands become radial spokes once lathed.
    ctx.fillStyle = rgba(wheels.accent, 0.85);
    for (let i = 0; i < 12; i += 1) {
      const x = (i / 12) * size;
      ctx.fillRect(x, 0, size / 34, 0.34 * size);
      ctx.fillRect(x, 0.66 * size, size / 34, 0.34 * size);
    }
  }

  // A touch of shading where the urethane meets the hub.
  band(0, 0.06, rgba('#000000', 0.22));
  band(0.94, 1, rgba('#000000', 0.22));

  return toTexture(canvas, { repeat: [1, 1] });
}

/* --------------------------------------------------------- environments */

export const BACKGROUNDS = {
  studio: { name: 'Studio', top: '#2c313a', bottom: '#0e1014', floor: '#1b1f26' },
  dusk: { name: 'Dusk', top: '#402a5e', bottom: '#120b1e', floor: '#241738' },
  concrete: { name: 'Park', top: '#8d949c', bottom: '#3a3f46', floor: '#6d737b' },
  void: { name: 'Void', top: '#000000', bottom: '#000000', floor: '#090909' },
  mint: { name: 'Mint', top: '#d8f2ea', bottom: '#7fbfae', floor: '#bfe6da' },
};

/** Radial falloff used as the floor's alpha, so the ground fades out. */
export function createFloorAlpha() {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.45, '#ffffff');
  gradient.addColorStop(1, '#000000');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { srgb: false });
}

export function createBackgroundTexture(key) {
  const preset = BACKGROUNDS[key] ?? BACKGROUNDS.studio;
  const canvas = makeCanvas(8, 256);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, preset.top);
  gradient.addColorStop(1, preset.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = toTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}
