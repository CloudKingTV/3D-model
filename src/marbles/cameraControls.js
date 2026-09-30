/**
 * Hands-on camera for the marble races.
 *
 * Following a marble (yours or the leader): the camera orbits it. Drag or
 * swipe to swing round — right round to look behind at the pack — and tilt
 * up and down; pinch or scroll to zoom. The angle is kept relative to the run,
 * so it stays put as the track twists. Double-tap (or double-click) to snap
 * back to the normal chase view.
 *
 * Overview: fly anywhere. Drag to look; pinch (or scroll) to fly forward and
 * back; slide two fingers to move sideways and up and down. On a keyboard,
 * WASD / arrows fly, Q and E go down and up, Shift is faster.
 */

export const FOLLOW_DEFAULT = { yaw: 0, pitch: 0.55, distance: 10.5 };

export function createCameraControls(element) {
  const follow = { ...FOLLOW_DEFAULT };
  const fly = { x: 0, y: 0, z: 0, yaw: 0, pitch: -0.4, ready: false, home: false };
  const keys = new Set();
  const pointers = new Map();
  let mode = 'follow'; // follow | fly
  let enabled = false;
  let lastTap = 0;
  let pinch = null; // { distance, mx, my }
  let interacting = 0; // seconds since the last touch, for camera snappiness
  let moved = 0;

  const clampPitch = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function look(dx, dy) {
    if (mode === 'follow') {
      follow.yaw -= dx * 0.009;
      follow.pitch = clampPitch(follow.pitch + dy * 0.007, -0.15, 1.45);
    } else {
      fly.yaw -= dx * 0.005;
      fly.pitch = clampPitch(fly.pitch - dy * 0.005, -1.5, 1.5);
    }
  }

  /** Move the flying camera: forward along the view, sideways, and up. */
  function flyBy(forward, right, up) {
    const cp = Math.cos(fly.pitch);
    fly.x += Math.cos(fly.yaw) * cp * forward - Math.sin(fly.yaw) * right;
    fly.y += Math.sin(fly.pitch) * forward + up;
    fly.z += Math.sin(fly.yaw) * cp * forward + Math.cos(fly.yaw) * right;
  }

  function zoom(factor) {
    if (mode === 'follow') {
      follow.distance = Math.max(3, Math.min(70, follow.distance * factor));
    } else {
      // Pinching out flies you in, the way zooming in on a map does.
      flyBy((1 - factor) * 60, 0, 0);
    }
  }

  function reset() {
    if (mode === 'follow') Object.assign(follow, FOLLOW_DEFAULT);
    else {
      // The scene puts it back over the whole run.
      fly.ready = false;
      fly.home = true;
    }
  }

  const onDown = (event) => {
    if (!enabled) return;
    element.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };

  const onMove = (event) => {
    if (!enabled || !pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved += Math.abs(dx) + Math.abs(dy);
    interacting = 0;
    if (pointers.size === 1) {
      look(dx, dy);
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (distance > 0 && pinch.distance > 0) zoom(pinch.distance / distance);
      if (mode === 'fly') flyBy(0, -(mx - pinch.mx) * 0.12, (my - pinch.my) * 0.12);
      pinch = { distance, mx, my };
    }
  };

  const onUp = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && moved < 6) {
      // The event's own time stamp, so a slow frame between taps doesn't
      // stretch the gap.
      const now = event.timeStamp;
      if (now - lastTap < 350) reset();
      lastTap = now;
    }
  };

  const onWheel = (event) => {
    if (!enabled) return;
    event.preventDefault();
    zoom(Math.exp(event.deltaY * 0.0012));
  };

  const onKey = (event) => {
    if (event.target?.closest?.('input, textarea')) return;
    if (event.type === 'keydown') keys.add(event.code);
    else keys.delete(event.code);
  };
  const onBlur = () => keys.clear();

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  return {
    follow,
    fly,
    get mode() {
      return mode;
    },
    setMode(next) {
      mode = next;
      pointers.clear();
      pinch = null;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) pointers.clear();
    },
    /** True shortly after a touch, so the camera tracks fingers without lag. */
    get hands() {
      return interacting < 0.25;
    },
    reset,
    /** Keyboard flying; call once a frame. */
    update(dt) {
      interacting += dt;
      if (mode !== 'fly' || !enabled) return;
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 90 : 35) * dt;
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const u = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      if (f || r || u) {
        flyBy(f * speed, r * speed, u * speed);
        interacting = 0;
      }
    },
    dispose() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    },
  };
}
