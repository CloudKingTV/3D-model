/**
 * Is this a phone or tablet, driven by touch?
 *
 * `(pointer: coarse)` alone is not enough: some in-app browsers and
 * embedded web views report a fine pointer on a phone, and then the game
 * would render at desktop quality with no on-screen controls. So also trust
 * a touch screen with no hover, and the platform names as a last resort.
 */
export function isTouchDevice() {
  const media = (query) => typeof matchMedia === 'function' && matchMedia(query).matches;
  if (media('(pointer: coarse)')) return true;
  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  if (touchPoints > 0 && media('(hover: none)')) return true;
  const agent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Android|iPhone|iPod|Mobile/i.test(agent)) return true;
  // iPadOS reports itself as a Mac, but Macs have no touch screen.
  return /Macintosh/.test(agent) && touchPoints > 1;
}
