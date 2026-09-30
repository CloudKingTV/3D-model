import { createStore, buildShareUrl } from './lib/state.js';
import { createGame } from './game/index.js';
import { createGameHud } from './ui/gameHud.js';
import { createViewer } from './lib/viewer.js';
import { createPanel } from './ui/panel.js';
import { el, ICONS } from './ui/controls.js';
import { isTouchDevice } from './lib/device.js';
import { loadSettings, saveSettings } from './game/settings.js';
import { BACKGROUNDS, rgba } from './lib/textures.js';

const canvas = document.getElementById('viewport');
const appRoot = document.getElementById('app');
const store = createStore();

/**
 * Breakpoints keyed to the app's own width rather than the viewport's, so the
 * layout is right when the page is embedded in a frame narrower than the
 * screen. The CSS reads these attributes; so does the camera's panel offset.
 */
function syncLayout() {
  // Some hosts lay a subframe out at a legacy 980px regardless of how wide it
  // really is, so cap by the physical screen: a phone stays a phone.
  const width = Math.min(
    appRoot.clientWidth || window.innerWidth,
    window.screen?.width || Number.POSITIVE_INFINITY,
  );
  const root = document.documentElement;
  const layout = width >= 880 ? 'wide' : 'narrow';
  const compact = width < 420 ? 'true' : 'false';
  const changed = root.dataset.layout !== layout || root.dataset.compact !== compact;
  root.dataset.layout = layout;
  root.dataset.compact = compact;
  return changed;
}

syncLayout(); // before the viewer builds, so its first framing is correct

/** True inside a cross-origin frame, where downloads and URL state are blocked. */
const EMBEDDED = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // reading window.top threw, so we are cross-origin framed
  }
})();

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

tool('Skate it', ICONS.play, () => enterGame());

const spinButton = tool('Toggle auto-spin', ICONS.spin, () => {
  store.patch({ scene: { autoRotate: !store.config.scene.autoRotate } });
});

// Showing the render in the page beats a download link: it is how you save a
// picture on a phone anyway, and some embeds block downloads outright.
const shot = document.getElementById('shot');
const shotImage = document.getElementById('shot-image');

tool('Save a picture', ICONS.camera, () => {
  shotImage.src = viewer.snapshot();
  shot.hidden = false;
});

document.getElementById('shot-close').addEventListener('click', () => {
  shot.hidden = true;
  shotImage.removeAttribute('src');
});

shot.addEventListener('click', (event) => {
  if (event.target === shot) document.getElementById('shot-close').click();
});

// A share link carries its state in the URL hash, which a cross-origin embed
// does not pass through — so only offer it where it actually round-trips.
if (!EMBEDDED) {
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
}

/* -------------------------------------------------------------- game mode */

const garageStage = document.getElementById('stage-garage');
const gameStage = document.getElementById('stage-game');
let playfield = document.getElementById('playfield');

/**
 * Each trip into the park gets a new canvas. The old one's GL context is
 * released on the way out, and a canvas whose context has been released can
 * never make another, so it is replaced rather than reused.
 */
function freshPlayfield() {
  const next = document.createElement('canvas');
  next.id = 'playfield';
  next.setAttribute('aria-label', 'Fingerboard game');
  playfield.replaceWith(next);
  playfield = next;
}

let game = null;
let gameHud = null;
const gameSettings = loadSettings();

function sizeGame() {
  if (!game) return;
  game.resize(gameStage.clientWidth || window.innerWidth, gameStage.clientHeight || window.innerHeight);
}

function enterGame() {
  if (game) return;
  garageStage.hidden = true;
  gameStage.hidden = false;
  viewer.pause(); // one renderer drawing at a time

  gameHud = createGameHud(gameStage, {
    onExit: exitGame,
    onRestart: () => game?.restart(),
    onPause: () => game?.togglePause(),
    settings: gameSettings,
    onSetting(key, value) {
      gameSettings[key] = value;
      saveSettings(gameSettings);
    },
  });
  game = createGame(playfield, {
    config: store.config,
    hud: gameHud,
    comicHost: gameStage,
    settings: gameSettings,
    // Phones get lighter shadows and no MSAA; the tilt-shift stays either way.
    quality: isTouchDevice() ? 'low' : 'high',
  });
  sizeGame();
  // ?debug exposes the running game to the console and to browser tests.
  if (new URLSearchParams(location.search).has('debug')) window.__game = game;
}

function exitGame() {
  if (!game) return;
  game.dispose();
  gameHud.dispose();
  game = null;
  gameHud = null;
  gameStage.innerHTML = '';
  gameStage.append(playfield);
  freshPlayfield();
  gameStage.hidden = true;
  garageStage.hidden = false;
  viewer.resume();
}

new ResizeObserver(sizeGame).observe(gameStage);

/* ------------------------------------------------------------ bottom sheet */

const panel = document.getElementById('panel');
const grab = document.getElementById('panel-grab');
const isSheet = () => document.documentElement.dataset.layout === 'narrow';

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

hint.textContent = isTouchDevice()
  ? 'Drag to spin · pinch to zoom'
  : 'Drag to spin · scroll to zoom';
setTimeout(dismissHint, 6500);

/* ------------------------------------------------------------------ theme */

// Absent when the page is embedded in a host that supplies its own <head>.
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(config) {
  const root = document.documentElement.style;
  root.setProperty('--accent', config.deck.ink);
  root.setProperty('--accent-soft', rgba(config.deck.ink, 0.16));
  root.setProperty('--accent-glow', rgba(config.deck.ink, 0.35));
  root.setProperty('--accent-ink', luminanceOf(config.deck.ink) > 0.58 ? '#12141a' : '#ffffff');
  document.querySelector('.brand__mark').style.background =
    `linear-gradient(140deg, ${config.deck.ink}, ${config.deck.accent})`;
  themeMeta?.setAttribute('content', BACKGROUNDS[config.scene.background]?.bottom ?? '#0b0d11');
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

store.subscribe((config, sections, meta) => {
  viewer.update(config, sections, meta);
  game?.applyConfig(config);
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

// A layout flip changes what the UI covers without necessarily resizing the
// canvas, so the camera has to re-solve its framing.
new ResizeObserver(() => {
  if (syncLayout()) viewer.resize();
}).observe(appRoot);

window.addEventListener('beforeunload', () => {
  game?.dispose();
  viewer.dispose();
});

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
