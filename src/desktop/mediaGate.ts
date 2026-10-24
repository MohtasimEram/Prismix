/**
 * Media keys can arrive twice: once through the webview's Media Session and
 * once through the global shortcut / tray in Rust. A press of the same action
 * inside the window counts once.
 */
const WINDOW_MS = 400;
const last = new Map<string, number>();

export function mediaGate(action: 'toggle' | 'next' | 'previous' | 'stop'): boolean {
  const now = performance.now();
  const at = last.get(action) ?? -Infinity;
  if (now - at < WINDOW_MS) return false;
  last.set(action, now);
  return true;
}
