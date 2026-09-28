import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createFingerboard } from './fingerboard.js';
import { BACKGROUNDS, createBackgroundTexture, createFloorAlpha } from './textures.js';

/**
 * Named camera stops the UI can jump to. Distance is solved per view from the
 * board's real extents and the current viewport, so nothing is ever clipped —
 * `zoom` just says how tightly to frame it.
 */
export const VIEWS = {
  // `portrait` swings the board to run down a tall screen instead of across it,
  // which is the difference between filling a phone and a sliver in the middle.
  hero: {
    theta: -0.85,
    phi: 1.18,
    zoom: 1.0,
    portrait: { theta: -Math.PI / 2 + 0.2, phi: 0.72, zoom: 1.04 },
  },
  top: { theta: -Math.PI / 2, phi: 0.1, zoom: 1.0 },
  bottom: { theta: Math.PI / 2, phi: Math.PI - 0.1, zoom: 1.0 },
  side: { theta: 0, phi: Math.PI / 2 - 0.06, zoom: 1.0 },
  nose: {
    theta: -Math.PI / 2 + 0.2,
    phi: 1.2,
    zoom: 0.55,
    portrait: { theta: -Math.PI / 2 + 0.3, phi: 1.1 },
  },
};

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // so the screenshot button can read pixels back
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 4;
  // Generous, because framing a long board on a narrow phone needs real range.
  controls.maxDistance = 70;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.6;
  controls.target.set(0, -0.35, 0);
  // Two-finger drag pans, one finger orbits — the expected feel on a phone.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  /* ------------------------------------------------------------ lighting */

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.85;

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(5.5, 9, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 40;
  keyLight.shadow.camera.left = -9;
  keyLight.shadow.camera.right = 9;
  keyLight.shadow.camera.top = 9;
  keyLight.shadow.camera.bottom = -9;
  keyLight.shadow.bias = -0.0012;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  fillLight.position.set(-7, 3.5, -5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffd9b0, 0.5);
  rimLight.position.set(0, -4, -8);
  scene.add(rimLight);

  /* --------------------------------------------------------------- floor */

  const floorAlpha = createFloorAlpha();
  const floorMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.82,
    metalness: 0.04,
    alphaMap: floorAlpha,
    transparent: true,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(15, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  /* --------------------------------------------------------------- board */

  const board = createFingerboard();
  scene.add(board.object);

  let backgroundTexture = null;

  function applyScene(sceneConfig) {
    const preset = BACKGROUNDS[sceneConfig.background] ?? BACKGROUNDS.studio;
    if (backgroundTexture) backgroundTexture.dispose();
    backgroundTexture = createBackgroundTexture(sceneConfig.background);
    scene.background = backgroundTexture;
    floorMaterial.color.set(preset.floor);
    floor.visible = sceneConfig.floor;
    renderer.shadowMap.enabled = sceneConfig.shadows;
    keyLight.castShadow = sceneConfig.shadows;
    controls.autoRotate = sceneConfig.autoRotate;
    controls.autoRotateSpeed = sceneConfig.rotateSpeed * 2.2;
  }

  function update(config, sections, meta) {
    board.update(config, sections, meta);
    if (!sections || sections.has('shape')) {
      refreshBounds();
      if (currentView) setView(currentView, { animate: false });
    }
    if (!sections || sections.has('scene')) applyScene(config.scene);
  }

  /* ------------------------------------------------------------- framing */

  const spherical = new THREE.Spherical();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  // The eight corners of the board, checked against the frustum when framing.
  // Rebuilt whenever the shape changes, so a longer deck reframes itself.
  const CORNERS = [];

  function refreshBounds() {
    const { min, max } = board.bounds;
    CORNERS.length = 0;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) CORNERS.push(new THREE.Vector3(x, y, z));
      }
    }
    controls.target.set(0, (min.y + max.y) / 2, 0);
    floor.position.y = board.groundY - 0.001;
  }

  // Half-extents of the area the board should sit in, as a fraction of the
  // full (view-offset) frustum. Set by resize().
  const usable = { tanH: 1, tanV: 1 };

  /**
   * Smallest orbit distance along `dir` that keeps every corner on screen.
   * For each corner we split its offset from the target into the camera's
   * right/up/forward axes; the corner fits when |right| <= depth * tanH.
   */
  function solveDistance(dir, zoom) {
    const zAxis = dir.clone().normalize();
    const xAxis = new THREE.Vector3().crossVectors(WORLD_UP, zAxis);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const margin = 1.07 / Math.max(0.2, zoom);
    let distance = controls.minDistance;
    const offset = new THREE.Vector3();
    for (const corner of CORNERS) {
      offset.subVectors(corner, controls.target);
      const depth = offset.dot(zAxis);
      const right = Math.abs(offset.dot(xAxis)) * margin;
      const up = Math.abs(offset.dot(yAxis)) * margin;
      distance = Math.max(distance, depth + right / usable.tanH, depth + up / usable.tanV);
    }
    return THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance);
  }

  let currentView = 'hero';

  function setView(name, { animate = true } = {}) {
    const base = VIEWS[name] ?? VIEWS.hero;
    currentView = VIEWS[name] ? name : 'hero';
    const view = { ...base, ...(usable.tanH < usable.tanV ? base.portrait : null) };
    const dir = new THREE.Vector3().setFromSpherical(spherical.set(1, view.phi, view.theta));
    const distance = solveDistance(dir, view.zoom ?? 1);
    const destination = dir.multiplyScalar(distance).add(controls.target);
    if (!animate) {
      camera.position.copy(destination);
      controls.update();
      return;
    }
    animateCameraTo(destination);
  }

  let tween = null;

  function animateCameraTo(destination) {
    tween = {
      from: camera.position.clone(),
      to: destination,
      start: performance.now(),
      duration: 620,
    };
  }

  function stepTween(now) {
    if (!tween) return;
    const t = Math.min(1, (now - tween.start) / tween.duration);
    const eased = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(tween.from, tween.to, eased);
    if (t >= 1) tween = null;
  }

  /* ---------------------------------------------------------- resize/loop */

  /**
   * How much of the canvas the UI is covering: the side panel on desktop, the
   * collapsed sheet on phones. We widen the frustum by that much and render a
   * sub-window of it, which recentres the board in the space that is actually
   * visible instead of behind the panel.
   */
  function occlusion() {
    const styles = getComputedStyle(document.documentElement);
    // Same breakpoint attribute the stylesheet uses, so the two never disagree.
    if (document.documentElement.dataset.layout === 'wide') {
      const panelWidth = parseFloat(styles.getPropertyValue('--panel-w')) || 348;
      return { x: panelWidth + 32, y: 0 };
    }
    return { x: 0, y: (parseFloat(styles.getPropertyValue('--sheet-peek')) || 124) + 20 };
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);

    const hidden = occlusion();
    const offsetX = Math.min(hidden.x, width * 0.42);
    const offsetY = Math.min(hidden.y, height * 0.32);
    const fullWidth = width + offsetX;
    const fullHeight = height + offsetY;

    camera.aspect = fullWidth / fullHeight;
    camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, width, height);
    camera.updateProjectionMatrix();

    // Half-extents of the visible area, expressed against the full frustum.
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    usable.tanV = (tan * (height - offsetY)) / fullHeight;
    usable.tanH = (tan * (width - offsetX)) / fullHeight;

    if (currentView) setView(currentView, { animate: false });
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  let running = true;
  let frameHandle = 0;
  function loop() {
    if (!running) return;
    frameHandle = requestAnimationFrame(loop);
    stepTween(performance.now());
    controls.update();
    renderer.render(scene, camera);
  }

  /** Grab the current frame as a PNG data URL. */
  function snapshot() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  function dispose() {
    running = false;
    cancelAnimationFrame(frameHandle);
    resizeObserver.disconnect();
    controls.dispose();
    board.dispose();
    floorAlpha.dispose();
    environment.dispose();
    pmrem.dispose();
    if (backgroundTexture) backgroundTexture.dispose();
    renderer.dispose();
  }

  refreshBounds(); // CORNERS must exist before the first framing solve
  resize();
  setView('hero', { animate: false });
  loop();

  return {
    renderer,
    scene,
    camera,
    controls,
    board,
    update,
    setView,
    snapshot,
    resize,
    dispose,
    /** Stop re-framing on resize once the user has taken manual control. */
    releaseView() {
      currentView = null;
    },
    /** Stop rendering while something else owns the screen. */
    pause() {
      running = false;
      cancelAnimationFrame(frameHandle);
    },
    resume() {
      if (running) return;
      running = true;
      resize();
      loop();
    },
  };
}
