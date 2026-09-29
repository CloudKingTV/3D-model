// effects.js only touches the DOM to paint one spark sprite, so a tiny canvas
// stub is enough to exercise all of its maths in node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const THREE = await import('three');
const { createEffects } = await import('../src/game/effects.js');

const scene = new THREE.Scene();
const fx = createEffects(scene, { accent: '#ff5722' });
let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); if (!ok) fail += 1; };

const trail = scene.children.find((c) => c.isMesh && c.geometry.attributes.position.count === 36);
check('trail mesh exists', !!trail);
check('trail hidden before use', trail.visible === false);

// Feed a helix, like a nose during a kickflip.
fx.setTrailActive(true);
for (let i = 0; i < 20; i += 1) {
  const t = i * 0.05;
  fx.pushTrail(new THREE.Vector3(t * 40, 6 + Math.sin(t * 18) * 1.4, Math.cos(t * 18) * 1.4));
  fx.update(1 / 60);
}
const pos = trail.geometry.attributes.position.array;
const col = trail.geometry.attributes.color.array;
check('trail visible while spinning', trail.visible === true);
check('trail positions finite', pos.every(Number.isFinite));
check('trail colours finite', col.every(Number.isFinite));
check('trail has width (verts differ)', Math.abs(pos[0] - pos[3]) + Math.abs(pos[2] - pos[5]) > 1e-4);
check('trail head brighter than tail', col[0] > col[col.length - 3]);
check('trail index buffer covers strip', trail.geometry.index.count === (18 - 1) * 6);

// Sparks: spawn, move under gravity, then die out.
const sparks = scene.children.find((c) => c.isPoints);
fx.grindSparks(10, 3, 0, 1 / 60, 46);
fx.burst(10, 3, 0, 20, 30);
fx.update(1 / 60);
const litAfterSpawn = [...sparks.geometry.attributes.color.array].filter((v) => v > 0.01).length;
check('sparks lit after spawn', litAfterSpawn > 0);
check('spark positions finite', [...sparks.geometry.attributes.position.array].every(Number.isFinite));
for (let i = 0; i < 90; i += 1) fx.update(1 / 60);
const litLater = [...sparks.geometry.attributes.color.array].filter((v) => v > 0.01).length;
check('sparks fade out', litLater === 0);

// Rings expand then vanish; shake decays.
fx.impactRing(4, 0, 0, 1.5);
fx.update(1 / 60);
const ring = scene.children.find((c) => c.isMesh && c.geometry.type === 'RingGeometry' && c.visible);
check('impact ring shown', !!ring);
for (let i = 0; i < 40; i += 1) fx.update(1 / 60);
check('impact ring hidden again', scene.children.filter((c) => c.geometry?.type === 'RingGeometry' && c.visible).length === 0);

fx.addShake(1);
check('shake registered', fx.shake > 0.5);
for (let i = 0; i < 40; i += 1) fx.update(1 / 60);
check('shake decays to zero', fx.shake === 0);

// Releasing the trail should retract it rather than leave it hanging.
fx.setTrailActive(false);
for (let i = 0; i < 40; i += 1) fx.update(1 / 60);
check('trail retracts when idle', trail.visible === false);

fx.dispose();
console.log(fail ? `\n${fail} FAILED` : '\nall effects checks passed');
process.exit(fail ? 1 : 0);
