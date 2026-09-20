import { createStore, buildShareUrl } from './lib/state.js';
import { createViewer } from './lib/viewer.js';
import { createPanel } from './ui/panel.js';
import { el, ICONS } from './ui/controls.js';
import { BACKGROUNDS, rgba } from './lib/textures.js';

const canvas = document.getElementById('viewport');
const store = createStore();

let viewer;
try {
  viewer = createViewer(canvas);
} catch (error) {
  showFatal(error);
  throw error;
}

/* ------------------------------------------------------------------ toast */

const toastNode = document.getElementById('toast');
let toastTimer = null;

function toast(message) {
  toastNode.textContent = message;
  toastNode.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastNode.dataset.show = 'false';
  }, 1900);
}

/* ------------------------------------------------------------ camera views */

const viewsHost = document.getElementById('views');
const VIEW_LABELS = [
  ['hero', 'Hero'],
  ['top', 'Top'],
  ['bottom', 'Graphic'],
  ['side', 'Side'],
  ['nose', 'Nose'],
];
let activeView = 'hero';

const viewButtons = VIEW_LABELS.map(([id, label]) => {
  const button = el('button', {
    type: 'button',
    text: label,
    onclick: () => {
      activeView = id;
      viewer.setView(id);
      syncViewButtons();
    },
  });
  viewsHost.append(button);
  return [id, button];
});

function syncViewButtons() {
  for (const [id, button] of viewButtons) {
    button.setAttribute('aria-pressed', String(id === activeView));
  }
}

// Once you drag the board yourself, no preset view is "current" any more.
viewer.controls.addEventListener('start', () => {
  activeView = null;
  viewer.releaseView();
  syncViewButtons();
  dismissHint();
});
syncViewButtons();

/* ------------------------------------------------------------------ tools */

const toolsHost = document.getElementById('tools');

function tool(label, iconHtml, onClick) {
  const button = el('button', {
    type: 'button',
    class: 'tool',
    'aria-label': label,
    title: label,
    html: iconHtml,
    onclick: onClick,
  });
  toolsHost.append(button);
  return button;
}

const spinButton = tool('Toggle auto-spin', ICONS.spin, () => {
  store.patch({ scene: { autoRotate: !store.config.scene.autoRotate } });
});

tool('Save a picture', ICONS.camera, () => {
  const url = viewer.snapshot();
  const link = el('a', { href: url, download: `fingerboard-${Date.now()}.png` });
  document.body.append(link);
  link.click();
  link.remove();
  toast('Picture saved');
});

tool('Share this board', ICONS.share, async () => {
  const url = buildShareUrl(store.config);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Fingerboard Studio', text: 'Check out this board', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (error) {
    if (error?.name === 'AbortError') return; // user dismissed the share sheet
    window.prompt('Copy this link', url);
  }
});

/* ------------------------------------------------------------ bottom sheet */

const panel = document.getElementById('panel');
const grab = document.getElementById('panel-grab');
const isSheet = () => window.matchMedia('(max-width: 879px)').matches;

function setSheetOpen(open) {
  panel.dataset.open = String(open);
  grab.setAttribute('aria-expanded', String(open));
}

setSheetOpen(false);

let drag = null;

grab.addEventListener('pointerdown', (event) => {
  if (!isSheet()) return;
  grab.setPointerCapture(event.pointerId);
  drag = {
    startY: event.clientY,
    lastY: event.clientY,
    open: panel.dataset.open === 'true',
    moved: 0,
    height: panel.getBoundingClientRect().height,
  };
  panel.dataset.dragging = 'true';
});

grab.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const delta = event.clientY - drag.startY;
  drag.moved = Math.max(drag.moved, Math.abs(delta));
  drag.lastY = event.clientY;
  const closedOffset = drag.height - sheetPeek();
  const base = drag.open ? 0 : closedOffset;
  const offset = Math.min(closedOffset, Math.max(0, base + delta));
  panel.style.transform = `translateY(${offset}px)`;
});

function sheetPeek() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek');
  return parseFloat(value) || 124;
}

function endDrag(event) {
  if (!drag) return;
  panel.style.transform = '';
  panel.dataset.dragging = 'false';
  const delta = event.clientY - drag.startY;
  if (drag.moved < 6) setSheetOpen(!drag.open); // a tap, not a drag
  else setSheetOpen(drag.open ? delta < 70 : delta < -40);
  drag = null;
}

grab.addEventListener('pointerup', endDrag);
grab.addEventListener('pointercancel', endDrag);

window.addEventListener('resize', () => {
  if (!isSheet()) {
    panel.style.transform = '';
    panel.dataset.dragging = 'false';
  }
});

/* ------------------------------------------------------------------- hint */

const hint = document.getElementById('hint');
let hintDismissed = false;

function dismissHint() {
  if (hintDismissed) return;
  hintDismissed = true;
  hint.dataset.hidden = 'true';
}

hint.textContent = matchMedia('(pointer: coarse)').matches
  ? 'Drag to spin · pinch to zoom'
  : 'Drag to spin · scroll to zoom';
setTimeout(dismissHint, 6500);

/* ------------------------------------------------------------------ theme */

const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(config) {
  const root = document.documentElement.style;
  root.setProperty('--accent', config.deck.ink);
  root.setProperty('--accent-soft', rgba(config.deck.ink, 0.16));
  root.setProperty('--accent-glow', rgba(config.deck.ink, 0.35));
  root.setProperty('--accent-ink', luminanceOf(config.deck.ink) > 0.58 ? '#12141a' : '#ffffff');
  document.querySelector('.brand__mark').style.background =
    `linear-gradient(140deg, ${config.deck.ink}, ${config.deck.accent})`;
  themeMeta.setAttribute('content', BACKGROUNDS[config.scene.background]?.bottom ?? '#0b0d11');
  spinButton.setAttribute('aria-pressed', String(config.scene.autoRotate));
}

function luminanceOf(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = parseInt(full, 16);
  return (0.2126 * ((int >> 16) & 255) + 0.7152 * ((int >> 8) & 255) + 0.0722 * (int & 255)) / 255;
}

/* ------------------------------------------------------------------- wire */

const ui = createPanel({ store, viewer, toast });

store.subscribe((config, sections) => {
  viewer.update(config, sections);
  applyTheme(config);
  ui.sync();
});

viewer.update(store.config, null);
applyTheme(store.config);
ui.sync();

// A shared link should land on the graphic, since that is what was shared.
if (window.location.hash.startsWith('#b=')) {
  activeView = 'bottom';
  viewer.setView('bottom', { animate: false });
  syncViewButtons();
  toast('Shared board loaded');
}

window.addEventListener('beforeunload', () => viewer.dispose());

/* ------------------------------------------------------------------ fatal */

function showFatal(error) {
  const message = /webgl/i.test(String(error?.message))
    ? 'This browser could not start WebGL. Try a different browser, or turn on hardware acceleration.'
    : 'Something went wrong starting the 3D view.';
  document.getElementById('app').innerHTML =
    `<div style="display:grid;place-items:center;height:100%;padding:2rem;text-align:center;
       font:15px/1.6 ui-sans-serif,system-ui;color:#9aa3b2">
       <div><p style="color:#eef1f6;font-size:17px;font-weight:600">Fingerboard Studio</p>
       <p>${message}</p></div></div>`;
}
