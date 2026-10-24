import type { Bridge } from '@/bridge';
import { desktopBridge } from '@/desktop/desktopBridge';

/** The native bridge, for code outside React. Always there in the desktop app. */
export function getBridge(): Bridge | null {
  return desktopBridge;
}
