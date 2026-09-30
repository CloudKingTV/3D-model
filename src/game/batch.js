import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];

/** A copy of one material group of a geometry, in world space, non-indexed. */
function prepare(geometry, matrix, group = null) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (group) {
    // Slice out just this group's triangles.
    const sliced = new THREE.BufferGeometry();
    for (const name of KEEP) {
      const attribute = g.attributes[name];
      if (!attribute) continue;
      const size = attribute.itemSize;
      const count = Math.min(group.count, attribute.count - group.start);
      sliced.setAttribute(name, new THREE.BufferAttribute(
        attribute.array.slice(group.start * size, (group.start + count) * size),
        size,
      ));
    }
    g.dispose();
    g = sliced;
  }
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP.includes(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.morphAttributes = {};
  g.applyMatrix4(matrix);
  return g;
}

/**
 * Plain-coloured materials — no textures, nothing see-through or glowing —
 * that differ only in colour can share one material, with the colour moved
 * into the vertices. Returns the key for the shared material, or null.
 */
function colourKey(material) {
  if (material.map || material.alphaMap || material.transparent || material.vertexColors) return null;
  if (material.emissive && material.emissive.getHex() !== 0) return null;
  if (material.isMeshLambertMaterial) return 'lambert';
  if (material.isMeshBasicMaterial) return 'basic';
  if (material.isMeshStandardMaterial) {
    const q = (v) => Math.round(v * 10) / 10;
    return `standard:${q(material.roughness)}:${q(material.metalness)}`;
  }
  return null;
}

function sharedColourMaterial(key, from) {
  if (key === 'lambert') return new THREE.MeshLambertMaterial({ vertexColors: true });
  if (key === 'basic') return new THREE.MeshBasicMaterial({ vertexColors: true });
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: Math.round(from.roughness * 10) / 10,
    metalness: Math.round(from.metalness * 10) / 10,
  });
}

function paint(geometry, colour) {
  const count = geometry.attributes.position.count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/**
 * Collapse a tree of static meshes into one mesh per material.
 *
 * A phone's GPU is far happier drawing twenty big meshes than five hundred
 * small ones: every separate mesh is a separate draw call, with its own state
 * changes, and on mobile those dominate long before triangles do. Everything
 * that never moves — the room, the table, the obstacles — goes through here.
 * Meshes marked `userData.dynamic`, and anything that is not a mesh, are
 * carried over as they are.
 */
export function mergeStatic(root, { receiveShadow = false, castShadow = false, name = 'static', disposeSource = true } = {}) {
  root.updateMatrixWorld(true);
  const byMaterial = new Map();
  const shared = new Map(); // colour key -> shared vertex-coloured material
  const loose = [];

  // Hidden parts (an unused decal, a toggled-off grip) stay hidden: they
  // are left out rather than baked in.
  root.traverseVisible((node) => {
    if (node === root) return;
    if (!node.isMesh || node.userData.dynamic) {
      if ((node.isMesh || node.isSprite || node.isLight) && node.parent) loose.push(node);
      return;
    }
    const add = (material, geometry) => {
      const key = colourKey(material);
      let target = material;
      if (key) {
        if (!shared.has(key)) shared.set(key, sharedColourMaterial(key, material));
        target = shared.get(key);
        paint(geometry, material.color);
      }
      if (!byMaterial.has(target)) byMaterial.set(target, []);
      byMaterial.get(target).push(geometry);
    };
    if (Array.isArray(node.material)) {
      for (const group of node.geometry.groups) {
        const material = node.material[group.materialIndex];
        if (material) add(material, prepare(node.geometry, node.matrixWorld, group));
      }
    } else {
      add(node.material, prepare(node.geometry, node.matrixWorld));
    }
  });

  const out = new THREE.Group();
  out.name = name;
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.receiveShadow = receiveShadow;
    mesh.castShadow = castShadow;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  // Loose things keep their world placement.
  for (const node of loose) out.attach(node);

  if (disposeSource) {
    root.traverse((node) => {
      if (node.isMesh && !node.userData.dynamic && !loose.includes(node)) node.geometry.dispose();
    });
  }
  // Materials made here belong to the merged group; dispose them with it.
  out.userData.ownedMaterials = [...shared.values()];
  return out;
}
