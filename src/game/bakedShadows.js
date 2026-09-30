import * as THREE from 'three';
import { TABLE } from './park.js';

/**
 * Shadows and contact darkening on the tabletop, worked out once from the
 * park's own heights and painted into a texture.
 *
 * Every obstacle standing on the table throws a shadow away from the window
 * and darkens the wood where it meets it. Drawing those with a real-time
 * shadow map would mean rendering the whole park into it every frame; baked,
 * they cost nothing, and the live shadow map only has to draw the board.
 *
 * `sun` is the direction light travels *toward* the table (unit vector).
 */
export function bakeTableShadows(park, sun, { resolution = 1 } = {}) {
  const width = Math.round(TABLE.halfX * 2 * resolution);
  const depth = Math.round(TABLE.halfZ * 2 * resolution);
  const cell = 1 / resolution;

  // Heights on a grid, sampled once; everything below reads this.
  const heights = new Float32Array(width * depth);
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const x = -TABLE.halfX + (i + 0.5) * cell;
      const z = -TABLE.halfZ + (j + 0.5) * cell;
      heights[j * width + i] = Math.max(0, park.heightAt(x, z));
    }
  }
  const heightAtCell = (i, j) => (i < 0 || j < 0 || i >= width || j >= depth ? 0 : heights[j * width + i]);

  // March from each tabletop point back toward the light; anything taller
  // than the ray at that point shades it.
  const toLight = new THREE.Vector3(-sun.x, -sun.y, -sun.z).normalize();
  const plan = Math.hypot(toLight.x, toLight.z);
  const rise = toLight.y / plan; // ray height gained per unit of plan distance
  const stepX = (toLight.x / plan) * cell;
  const stepZ = (toLight.z / plan) * cell;
  const tallest = heights.reduce((m, h) => Math.max(m, h), 0);
  const reach = Math.ceil(tallest / (rise * cell)) + 1;

  const shade = new Float32Array(width * depth);
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      if (heights[j * width + i] > 0.05) continue; // under an obstacle: hidden anyway
      let dark = 0;
      for (let k = 1; k <= reach; k += 1) {
        const h = heightAtCell(Math.round(i + stepX * k), Math.round(j + stepZ * k));
        if (h > k * cell * rise) {
          // Fade the far end of long shadows, like a real penumbra.
          dark = Math.max(dark, 1 - (k / reach) * 0.35);
          break;
        }
      }
      // Contact darkening: how much of the nearby sky is blocked.
      let occluded = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const h = heightAtCell(i + di, j + dj);
        if (h > 0.3) occluded += Math.min(1, h / 3) / (Math.abs(di) + Math.abs(dj));
      }
      shade[j * width + i] = Math.min(1, dark * 0.75 + occluded * 0.12);
    }
  }

  // Soften: two passes of a separable box blur.
  const blur = (src, radius) => {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let j = 0; j < depth; j += 1) {
      for (let i = 0; i < width; i += 1) {
        let sum = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d += 1) {
          const ii = i + d;
          if (ii < 0 || ii >= width) continue;
          sum += src[j * width + ii];
          n += 1;
        }
        tmp[j * width + i] = sum / n;
      }
    }
    for (let j = 0; j < depth; j += 1) {
      for (let i = 0; i < width; i += 1) {
        let sum = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d += 1) {
          const jj = j + d;
          if (jj < 0 || jj >= depth) continue;
          sum += tmp[jj * width + i];
          n += 1;
        }
        out[j * width + i] = sum / n;
      }
    }
    return out;
  };
  const soft = blur(blur(shade, 2), 1);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = depth;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, depth);
  for (let p = 0; p < soft.length; p += 1) {
    const v = Math.round(soft[p] * 255);
    image.data[p * 4] = v;
    image.data[p * 4 + 1] = v;
    image.data[p * 4 + 2] = v;
    image.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  // A dark layer just above the wood, see-through except where shaded.
  const material = new THREE.MeshBasicMaterial({
    color: '#1d140c',
    alphaMap: texture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.halfX * 2, TABLE.halfZ * 2), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.01;
  plane.renderOrder = 1;
  plane.userData.dynamic = true; // keep it out of the static merge: it is transparent and alone
  return { mesh: plane, texture, material };
}
