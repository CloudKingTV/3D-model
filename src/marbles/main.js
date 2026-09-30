import { createMarbleGame } from './index.js';
import { isTouchDevice } from '../lib/device.js';
import './standalone.css';

/**
 * Marble Mayhem on its own page: full screen, installable to the home
 * screen, and playable offline once it has loaded.
 */

const host = document.getElementById('mm-app');
const canvas = document.getElementById('mm-canvas');

function fatal(error) {
  const note = document.createElement('div');
  note.className = 'mm-fatal';
  note.textContent = 'This device could not start the 3D graphics (WebGL). Try another browser.';
  host.append(note);
  console.error(error);
}

let game = null;
try {
  game = createMarbleGame(canvas, { host, quality: isTouchDevice() ? 'low' : 'high' });
} catch (error) {
  fatal(error);
}

function size() {
  game?.resize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
}
new ResizeObserver(size).observe(host);
size();
document.getElementById('mm-boot')?.remove();

// ?debug exposes the running game to the console and to browser tests.
if (new URLSearchParams(location.search).has('debug')) window.__game = game;

// Offline support where it can work: a real https origin, not in a frame.
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
if ('serviceWorker' in navigator && !framed && !import.meta.env.DEV && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
