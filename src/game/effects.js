import * as THREE from 'three';

/**
 * Sparks, flip trails and impact rings — the things that make a landing feel
 * like it happened rather than just scoring.
 *
 * Everything is pooled: one Points object for every spark in the scene and one
 * reused ribbon for the trail, so a busy run allocates nothing per frame.
 */

const MAX_SPARKS = 320;
const TRAIL_SAMPLES = 18;

/** A soft round dot for the spark sprites. */
function createSparkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,236,170,0.85)');
  gradient.addColorStop(1, 'rgba(255,170,40,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEffects(scene, { accent = '#ff5722' } = {}) {
  /* ------------------------------------------------------------- sparks */

  const sparkTexture = createSparkTexture();
  const sparkPositions = new Float32Array(MAX_SPARKS * 3);
  const sparkColors = new Float32Array(MAX_SPARKS * 3);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

  const sparkPoints = new THREE.Points(
    sparkGeometry,
    new THREE.PointsMaterial({
      size: 0.55,
      map: sparkTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);

  // Parallel arrays rather than objects: this runs every frame.
  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    sparks.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
  }
  let sparkCursor = 0;

  function spawnSpark(x, y, z, vx, vy, vz, life, color) {
    const spark = sparks[sparkCursor];
    const i3 = sparkCursor * 3;
    sparkCursor = (sparkCursor + 1) % MAX_SPARKS;

    sparkPositions[i3] = x;
    sparkPositions[i3 + 1] = y;
    sparkPositions[i3 + 2] = z;
    spark.life = life;
    spark.maxLife = life;
    spark.vx = vx;
    spark.vy = vy;
    spark.vz = vz;
    spark.r = color.r;
    spark.g = color.g;
    spark.b = color.b;
  }

  const hot = new THREE.Color('#fff0b8');
  const ember = new THREE.Color('#ff9a2b');
  const accentColor = new THREE.Color(accent);
  const scratch = new THREE.Color();

  /**
   * A continuous shower off a grind, thrown backwards along the rail.
   * (dirX, dirZ) is the direction of travel in plan.
   */
  function grindSparks(x, y, z, dt, speed, dirX = 1, dirZ = 0) {
    const count = Math.min(6, Math.round(dt * 150));
    for (let i = 0; i < count; i += 1) {
      scratch.copy(Math.random() > 0.45 ? hot : ember);
      const back = -speed * (0.25 + Math.random() * 0.5);
      const side = (Math.random() - 0.5) * 22;
      spawnSpark(
        x + (Math.random() - 0.5) * 1.2,
        y + 0.1,
        z + (Math.random() - 0.5) * 1.0,
        dirX * back - dirZ * side,
        Math.random() * 26 + 6,
        dirZ * back + dirX * side,
        0.24 + Math.random() * 0.3,
        scratch,
      );
    }
  }

  /** A one-off burst: landings, pops, bails. */
  function burst(x, y, z, count, power, color = hot) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random();
      scratch.copy(color).lerp(hot, Math.random() * 0.5);
      spawnSpark(
        x, y + 0.15, z,
        Math.cos(angle) * spread * power,
        Math.random() * power * 0.8 + 4,
        Math.sin(angle) * spread * power,
        0.26 + Math.random() * 0.34,
        scratch,
      );
    }
  }

  /* -------------------------------------------------------------- trail */

  // A ribbon through the nose of the board. While it is flipping the samples
  // spiral, which draws the rotation instead of just implying it.
  const trailPoints = [];
  for (let i = 0; i < TRAIL_SAMPLES; i += 1) trailPoints.push(new THREE.Vector3());
  let trailFilled = 0;
  let trailActive = false;

  const trailGeometry = new THREE.BufferGeometry();
  const trailVerts = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  const trailCols = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  const trailIndex = [];
  for (let i = 0; i < TRAIL_SAMPLES - 1; i += 1) {
    const a = i * 2;
    trailIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailVerts, 3));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailCols, 3));
  trailGeometry.setIndex(trailIndex);

  const trailMesh = new THREE.Mesh(
    trailGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Additive, so fading the vertex colour to black fades the ribbon out
      // without needing per-vertex alpha.
      blending: THREE.AdditiveBlending,
    }),
  );
  trailMesh.frustumCulled = false;
  trailMesh.visible = false;
  scene.add(trailMesh);

  const up = new THREE.Vector3(0, 1, 0);
  const segment = new THREE.Vector3();
  const side = new THREE.Vector3();

  function pushTrail(position) {
    for (let i = TRAIL_SAMPLES - 1; i > 0; i -= 1) trailPoints[i].copy(trailPoints[i - 1]);
    trailPoints[0].copy(position);
    trailFilled = Math.min(TRAIL_SAMPLES, trailFilled + 1);
  }

  function rebuildTrail() {
    if (trailFilled < 3) {
      trailMesh.visible = false;
      return;
    }
    trailMesh.visible = true;
    for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
      const point = trailPoints[Math.min(i, trailFilled - 1)];
      const next = trailPoints[Math.min(i + 1, trailFilled - 1)];
      segment.subVectors(next, point);
      if (segment.lengthSq() < 1e-6) segment.set(1, 0, 0);
      side.crossVectors(segment, up).normalize();
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);

      const fade = Math.max(0, 1 - i / (trailFilled - 1));
      const width = 0.42 * fade;
      const a = i * 6;
      trailVerts[a] = point.x + side.x * width;
      trailVerts[a + 1] = point.y + side.y * width;
      trailVerts[a + 2] = point.z + side.z * width;
      trailVerts[a + 3] = point.x - side.x * width;
      trailVerts[a + 4] = point.y - side.y * width;
      trailVerts[a + 5] = point.z - side.z * width;

      const intensity = fade * fade * 0.9;
      for (const offset of [a, a + 3]) {
        trailCols[offset] = accentColor.r * intensity;
        trailCols[offset + 1] = accentColor.g * intensity;
        trailCols[offset + 2] = accentColor.b * intensity;
      }
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.color.needsUpdate = true;
  }

  /* -------------------------------------------------------------- rings */

  const RING_COUNT = 5;
  const rings = [];
  for (let i = 0; i < RING_COUNT; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1, 28),
      new THREE.MeshBasicMaterial({
        color: '#ffe6a8',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, life: 0, maxLife: 0.42, scale: 1 });
  }
  let ringCursor = 0;

  function impactRing(x, y, z, strength = 1) {
    const ring = rings[ringCursor];
    ringCursor = (ringCursor + 1) % RING_COUNT;
    ring.mesh.position.set(x, y + 0.12, z);
    ring.mesh.scale.setScalar(1.2);
    ring.mesh.visible = true;
    ring.life = ring.maxLife;
    ring.strength = strength;
  }

  /* ------------------------------------------------------------- update */

  let shake = 0;

  function update(dt, gravity = 300) {
    // Sparks
    for (let i = 0; i < MAX_SPARKS; i += 1) {
      const spark = sparks[i];
      const i3 = i * 3;
      if (spark.life <= 0) {
        sparkColors[i3] = 0;
        sparkColors[i3 + 1] = 0;
        sparkColors[i3 + 2] = 0;
        continue;
      }
      spark.life -= dt;
      spark.vy -= gravity * dt;
      sparkPositions[i3] += spark.vx * dt;
      sparkPositions[i3 + 1] += spark.vy * dt;
      sparkPositions[i3 + 2] += spark.vz * dt;

      const fade = Math.max(0, spark.life / spark.maxLife);
      sparkColors[i3] = spark.r * fade;
      sparkColors[i3 + 1] = spark.g * fade;
      sparkColors[i3 + 2] = spark.b * fade;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;

    // Rings
    for (const ring of rings) {
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      ring.life -= dt;
      const t = 1 - ring.life / ring.maxLife;
      ring.mesh.scale.setScalar(1.2 + t * 7 * ring.strength);
      ring.mesh.material.opacity = (1 - t) * 0.55;
    }

    if (trailActive) rebuildTrail();
    else {
      trailFilled = Math.max(0, trailFilled - 1);
      if (trailFilled < 3) trailMesh.visible = false;
      else rebuildTrail();
    }

    shake = Math.max(0, shake - dt * 3.4);
  }

  return {
    grindSparks,
    burst,
    impactRing,
    pushTrail,
    setTrailActive(active) {
      if (active && !trailActive) trailFilled = 0;
      trailActive = active;
    },
    addShake(amount) {
      shake = Math.min(1.4, shake + amount);
    },
    get shake() {
      return shake;
    },
    setAccent(color) {
      accentColor.set(color);
    },
    update,
    dispose() {
      sparkGeometry.dispose();
      sparkPoints.material.dispose();
      sparkTexture.dispose();
      trailGeometry.dispose();
      trailMesh.material.dispose();
      for (const ring of rings) {
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
      }
    },
  };
}
