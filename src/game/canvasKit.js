import * as THREE from 'three';

/** Small deterministic random, so every texture draws the same each time. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A texture drawn on a canvas. Every texture in the game is made this way —
 * nothing is downloaded.
 */
export function canvasTexture(width, height, draw, { repeat = [1, 1], srgb = true, wrap = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  return texture;
}

/**
 * UVs in world units, projected along each face's normal, so a texture's
 * grain is the same size on a kicker, a ledge and a wall. (Geometries' own
 * UVs stretch 0..1 over every face whatever its size.)
 */
export function worldUV(geometry, scale = 1) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i += 1) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = position.getX(i) * scale;
    const y = position.getY(i) * scale;
    const z = position.getZ(i) * scale;
    if (nz >= nx && nz >= ny) uv.setXY(i, x, y);
    else if (nx >= ny) uv.setXY(i, z, y);
    else uv.setXY(i, x, z);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** A mesh from a geometry and material, placed. */
export function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** A box with world-scale UVs, sitting with its base at y. */
export function block(width, height, depth, material, x = 0, y = 0, z = 0) {
  return mesh(worldUV(new THREE.BoxGeometry(width, height, depth)), material, x, y + height / 2, z);
}
