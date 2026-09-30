import { el } from './controls.js';

/**
 * On-screen controls for phones: a stick under the left thumb to steer and
 * push, and under the right an ollie button (hold to crouch, let go to pop)
 * with the flip tricks round it. Every control is its own touch target with
 * pointer capture, so a thumb that slides off a button still lets go of it
 * properly and two thumbs never fight over one control.
 */
const TRICK_BUTTONS = [
  { id: 'kickflip', label: 'Kick\nflip', slot: 'a' },
  { id: 'heelflip', label: 'Heel\nflip', slot: 'b' },
  { id: 'shuvit', label: 'Shuv', slot: 'c' },
  { id: 'treflip', label: '360\nflip', slot: 'd' },
];

const DEAD_ZONE = 0.14;

/** Capture where supported; a control still works without it. */
function capture(node, event) {
  try {
    node.setPointerCapture(event.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
}

export function createTouchControls(host, { onTrick }) {
  const knob = el('div', { class: 'touch__knob' });
  const stick = el('div', { class: 'touch__stick', 'aria-label': 'Steer and push' }, [
    el('div', { class: 'touch__ring' }),
    knob,
  ]);
  const ollie = el('button', { class: 'touch__ollie', type: 'button', text: 'Ollie' });
  const tricks = TRICK_BUTTONS.map(({ id, label, slot }) => el('button', {
    class: `touch__trick touch__trick--${slot}`,
    type: 'button',
    'data-trick': id,
    text: label,
  }));
  const root = el('div', { class: 'touch' }, [
    stick,
    el('div', { class: 'touch__buttons' }, [ollie, ...tricks]),
  ]);
  host.append(root);

  const state = { steer: 0, throttle: 0, ollie: false };
  let stickPointer = null;
  let centre = { x: 0, y: 0 };

  function radius() {
    return stick.getBoundingClientRect().width / 2;
  }

  function moveStick(event) {
    const r = radius();
    let dx = (event.clientX - centre.x) / r;
    let dy = (event.clientY - centre.y) / r;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    knob.style.transform = `translate(${dx * r * 0.62}px, ${dy * r * 0.62}px)`;
    const shape = (v) => (Math.abs(v) < DEAD_ZONE ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE)));
    // Steering gets a curve: small movements turn gently, so lining up a
    // rail is easy with a thumb, while a full push still turns hard.
    const steer = shape(dx);
    state.steer = Math.sign(steer) * Math.abs(steer) ** 1.5;
    state.throttle = shape(-dy);
  }

  function releaseStick() {
    stickPointer = null;
    state.steer = 0;
    state.throttle = 0;
    knob.style.transform = '';
    stick.dataset.active = 'false';
  }

  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    stickPointer = event.pointerId;
    capture(stick, event);
    const rect = stick.getBoundingClientRect();
    centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    stick.dataset.active = 'true';
    moveStick(event);
  });
  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickPointer) moveStick(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stick.addEventListener(type, (event) => {
      if (event.pointerId === stickPointer) releaseStick();
    });
  }

  ollie.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    capture(ollie, event);
    state.ollie = true;
    ollie.dataset.active = 'true';
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    ollie.addEventListener(type, () => {
      state.ollie = false;
      ollie.dataset.active = 'false';
    });
  }

  for (const button of tricks) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.dataset.active = 'true';
      onTrick(button.dataset.trick);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      button.addEventListener(type, () => { button.dataset.active = 'false'; });
    }
  }

  // Long-presses on the buttons must not open the text-selection or context
  // menu on phones.
  root.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    get steer() {
      return state.steer;
    },
    get throttle() {
      return state.throttle;
    },
    get ollie() {
      return state.ollie;
    },
    setVisible(visible) {
      root.dataset.show = String(visible);
      if (!visible) {
        releaseStick();
        state.ollie = false;
      }
    },
    dispose() {
      root.remove();
    },
  };
}
