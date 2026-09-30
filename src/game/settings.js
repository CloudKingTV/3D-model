import { isTouchDevice } from '../lib/device.js';

/**
 * Player settings for the game, kept between visits. Auto-push is on by
 * default on phones — one thumb is on the stick and the other on the
 * tricks, so holding forward all run is the last thing it should have to do.
 */
const KEY = 'fingerboard-3d:settings:v1';

export function loadSettings() {
  const defaults = { autoPush: isTouchDevice(), spinAssist: true, haptics: true };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or blocked storage: the setting still holds for this visit */
  }
}
