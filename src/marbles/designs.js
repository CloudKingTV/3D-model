import * as THREE from 'three';

/**
 * The 24 marbles: a name, a surface drawn on a canvas (wrapped round the
 * sphere, 2:1, like a globe) and how shiny it is. The same canvas drawing
 * makes the 3D material and the little picture on the picker, so what you
 * choose is what races. Nothing here is downloaded.
 */

const W = 256;
const H = 128;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fill = (colour) => (ctx) => {
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, W, H);
};

/** A soft two-tone swirl, wrapped round the equator. */
const swirl = (base, ...bands) => (ctx) => {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  bands.forEach((colour, i) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 14 - i * 3;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 4) {
      const y = H / 2 + Math.sin((x / W) * Math.PI * 4 + i * 1.7) * (26 - i * 6) + Math.sin((x / W) * Math.PI * 10 + i) * 4;
      if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
};

const stripes = (a, b, count, vertical = false) => (ctx) => {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = i % 2 ? b : a;
    if (vertical) ctx.fillRect((i / count) * W, 0, W / count + 1, H);
    else ctx.fillRect(0, (i / count) * H, W, H / count + 1);
  }
};

const dots = (base, dot, size, seed) => (ctx) => {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const random = rng(seed);
  ctx.fillStyle = dot;
  for (let i = 0; i < 38; i += 1) {
    const x = random() * W;
    const y = 10 + random() * (H - 20);
    ctx.beginPath();
    // Wider toward the poles, so the dots look round on the sphere.
    ctx.ellipse(x, y, size / Math.max(0.35, Math.sin((y / H) * Math.PI)), size, 0, 0, Math.PI * 2);
    ctx.fill();
  }
};

export const MARBLES = [
  { name: 'Ruby', draw: swirl('#b3121f', '#ff5a5f'), roughness: 0.08, swatch: '#d4202c' },
  { name: 'Cobalt', draw: swirl('#123fa8', '#4f86ff'), roughness: 0.08, swatch: '#1f55d6' },
  { name: 'Jade', draw: swirl('#0f7a4d', '#7ee0a8', '#0a4d30'), roughness: 0.1, swatch: '#15a064' },
  { name: 'Sunny', draw: stripes('#ffc629', '#fff3c4', 6), roughness: 0.12, swatch: '#ffc629' },
  { name: 'Onyx', draw: swirl('#0d0e11', '#2d3038'), roughness: 0.05, swatch: '#16181c' },
  { name: 'Pearl', draw: swirl('#f4f1ec', '#f5d9e8', '#d9ecf5'), roughness: 0.18, swatch: '#f1ece6' },
  { name: 'Chrome', draw: fill('#e6e9ee'), roughness: 0.04, metalness: 1, swatch: '#c9ced6' },
  { name: 'Goldie', draw: fill('#f2c14e'), roughness: 0.12, metalness: 1, swatch: '#e0ac2b' },
  {
    name: 'Galaxy',
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0b0826');
      g.addColorStop(0.5, '#2b1356');
      g.addColorStop(1, '#0a1a3d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const random = rng(7);
      for (let i = 0; i < 6; i += 1) {
        const r = ctx.createRadialGradient(random() * W, random() * H, 0, random() * W, random() * H, 40);
        r.addColorStop(0, 'rgba(255,90,200,0.35)');
        r.addColorStop(1, 'rgba(255,90,200,0)');
        ctx.fillStyle = r;
        ctx.fillRect(0, 0, W, H);
      }
      for (let i = 0; i < 160; i += 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.4 + random() * 0.6})`;
        ctx.fillRect(random() * W, random() * H, 1 + random(), 1 + random());
      }
    },
    roughness: 0.06,
    swatch: '#2b1356',
  },
  {
    name: 'Lava',
    draw(ctx) {
      ctx.fillStyle = '#1a0d08';
      ctx.fillRect(0, 0, W, H);
      const random = rng(3);
      ctx.strokeStyle = '#ff6a1a';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 24; i += 1) {
        let x = random() * W;
        let y = random() * H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 6; s += 1) {
          x += (random() - 0.5) * 40;
          y += (random() - 0.5) * 24;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    glow: true,
    roughness: 0.4,
    swatch: '#ff6a1a',
  },
  { name: 'Frost', draw: swirl('#bfe4f7', '#ffffff', '#8fcbee'), roughness: 0.1, swatch: '#bfe4f7' },
  { name: 'Zebra', draw: stripes('#111111', '#f5f5f5', 10, true), roughness: 0.15, swatch: '#777777' },
  { name: 'Dotty', draw: dots('#ff4f9a', '#ffffff', 5, 11), roughness: 0.12, swatch: '#ff4f9a' },
  {
    name: 'Candy',
    draw(ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e21b3c';
      for (let i = -H; i < W + H; i += 36) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 0);
        ctx.lineTo(i + 16 + H, H);
        ctx.lineTo(i + H, H);
        ctx.fill();
      }
    },
    roughness: 0.1,
    swatch: '#e21b3c',
  },
  {
    name: 'Tiger',
    draw(ctx) {
      ctx.fillStyle = '#f08a1c';
      ctx.fillRect(0, 0, W, H);
      const random = rng(19);
      ctx.fillStyle = '#1b1208';
      for (let x = 0; x < W; x += 14 + random() * 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + 10 + random() * 10, H / 2, x - 4 + random() * 8, H);
        ctx.lineTo(x + 5, H);
        ctx.quadraticCurveTo(x + 14, H / 2, x + 6, 0);
        ctx.fill();
      }
    },
    roughness: 0.2,
    swatch: '#f08a1c',
  },
  { name: 'Mint', draw: dots('#9fe3c6', '#4a2b1a', 3, 21), roughness: 0.15, swatch: '#9fe3c6' },
  { name: 'Plum', draw: swirl('#4b1466', '#9c4dcc'), roughness: 0.08, swatch: '#6a1f8f' },
  { name: 'Coral', draw: swirl('#ff7b6b', '#ffd0c4'), roughness: 0.1, swatch: '#ff7b6b' },
  {
    name: 'Storm',
    draw(ctx) {
      ctx.fillStyle = '#3c4453';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#c9f2ff';
      ctx.lineWidth = 3;
      const random = rng(5);
      for (let b = 0; b < 4; b += 1) {
        let x = 20 + b * 60;
        let y = 0;
        ctx.beginPath();
        ctx.moveTo(x, y);
        while (y < H) {
          x += (random() - 0.5) * 30;
          y += 12 + random() * 12;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    glow: true,
    roughness: 0.2,
    swatch: '#3c4453',
  },
  {
    name: 'Rainbow',
    draw(ctx) {
      ['#e8403a', '#f28a1c', '#f5d31e', '#43b649', '#2b7fd9', '#7a3fc4'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(0, (i / 6) * H, W, H / 6 + 1);
      });
    },
    roughness: 0.1,
    swatch: 'linear-gradient(#e8403a, #f5d31e, #43b649, #2b7fd9)',
  },
  {
    name: 'Checkers',
    draw(ctx) {
      for (let x = 0; x < 16; x += 1) {
        for (let y = 0; y < 8; y += 1) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          ctx.fillRect(x * (W / 16), y * (H / 8), W / 16 + 1, H / 8 + 1);
        }
      }
    },
    roughness: 0.15,
    swatch: '#888',
  },
  {
    name: 'Earth',
    draw(ctx) {
      ctx.fillStyle = '#1f5fbf';
      ctx.fillRect(0, 0, W, H);
      const random = rng(29);
      ctx.fillStyle = '#3f9e4d';
      for (let c = 0; c < 7; c += 1) {
        const cx = random() * W;
        const cy = 20 + random() * (H - 40);
        for (let p = 0; p < 14; p += 1) {
          ctx.beginPath();
          ctx.arc(cx + (random() - 0.5) * 50, cy + (random() - 0.5) * 26, 5 + random() * 9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#f4f7fa';
      ctx.fillRect(0, 0, W, 9);
      ctx.fillRect(0, H - 9, W, 9);
    },
    roughness: 0.2,
    swatch: '#1f5fbf',
  },
  {
    name: 'Eight',
    draw(ctx) {
      ctx.fillStyle = '#0c0c0f';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(W / 4, H / 2, 22, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0c0c0f';
      ctx.font = '900 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('8', W / 4, H / 2 + 2);
    },
    roughness: 0.05,
    swatch: '#0c0c0f',
  },
  {
    name: 'Cat’s Eye',
    draw(ctx) {
      ctx.fillStyle = '#d7eef2';
      ctx.fillRect(0, 0, W, H);
      ['#18a0c4', '#f0a21c', '#18a0c4', '#f0a21c'].forEach((c, i) => {
        ctx.fillStyle = c;
        const x = (i / 4) * W + W / 8;
        ctx.beginPath();
        ctx.ellipse(x, H / 2, 9, H / 2 - 6, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    roughness: 0.03,
    swatch: '#9fd3de',
  },
];

/** The marble's surface as a canvas (shared by the material and the picker). */
export function drawMarble(design) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  design.draw(canvas.getContext('2d'));
  return canvas;
}

export function createMarbleMaterial(design, canvas = drawMarble(design)) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: design.roughness ?? 0.1,
    metalness: design.metalness ?? 0,
    // Glass-hard lacquer: a sharp reflection of the sky over the colour.
    clearcoat: design.metalness ? 0 : 1,
    clearcoatRoughness: 0.04,
    emissiveMap: design.glow ? map : null,
    emissive: design.glow ? new THREE.Color(0.9, 0.9, 0.9) : new THREE.Color(0, 0, 0),
    emissiveIntensity: design.glow ? 0.9 : 0,
  });
}

/**
 * A small round picture of the marble for the picker: its surface drawn
 * into a circle, shaded and glossed so it reads as a sphere.
 */
export function marblePreview(design, size = 88) {
  const surface = drawMarble(design);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.clip();
  // The front half of the wrap, slightly bulged by drawing it wider.
  ctx.drawImage(surface, W * 0.15, 0, W * 0.5, H, -size * 0.15, 0, size * 1.3, size);
  const shade = ctx.createRadialGradient(r * 0.7, r * 0.6, r * 0.2, r, r, r);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  const gloss = ctx.createRadialGradient(r * 0.62, r * 0.5, 0, r * 0.62, r * 0.5, r * 0.45);
  gloss.addColorStop(0, 'rgba(255,255,255,0.85)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  return canvas;
}
