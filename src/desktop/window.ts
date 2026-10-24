import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSyncExternalStore } from 'react';
import { invoke, isDesktop } from './tauri';

/**
 * The native window: maximise/fullscreen state for the custom title bar and
 * the full-screen player. Outside Tauri (plain `npm run dev` in a browser)
 * everything degrades to the document Fullscreen API.
 */

interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
}

let state: WindowState = { maximized: false, fullscreen: false, focused: true };
const listeners = new Set<() => void>();
let watching = false;

function set(next: Partial<WindowState>): void {
  const merged = { ...state, ...next };
  if (merged.maximized === state.maximized && merged.fullscreen === state.fullscreen && merged.focused === state.focused) return;
  state = merged;
  listeners.forEach((l) => l());
}

async function refresh(): Promise<void> {
  if (!isDesktop()) {
    set({ fullscreen: document.fullscreenElement !== null });
    return;
  }
  const w = getCurrentWindow();
  const [maximized, fullscreen] = await Promise.all([w.isMaximized(), w.isFullscreen()]).catch(() => [state.maximized, state.fullscreen]);
  set({ maximized, fullscreen });
}

function watch(): void {
  if (watching) return;
  watching = true;
  if (!isDesktop()) {
    document.addEventListener('fullscreenchange', () => void refresh());
    return;
  }
  const w = getCurrentWindow();
  void w.onResized(() => void refresh());
  void w.onFocusChanged(({ payload }) => set({ focused: payload }));
  void refresh();
}

export function useWindowState(): WindowState {
  return useSyncExternalStore(
    (onChange) => {
      watch();
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
  );
}

export const windowControls = {
  minimize: () => void getCurrentWindow().minimize(),
  toggleMaximize: () => void getCurrentWindow().toggleMaximize(),
  /** Close follows Settings › Desktop › "Keep playing in the tray" (handled in Rust). */
  close: () => void getCurrentWindow().close(),
};

export function canFullScreen(): boolean {
  return isDesktop() || document.fullscreenEnabled;
}

/** Whether the window was maximised when OS full screen began, so leaving it can put that back. */
let maximizedBeforeFullScreen = false;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function setFullScreen(on: boolean): Promise<void> {
  if (isDesktop()) {
    const w = getCurrentWindow();
    if (on) {
      // A maximised window without a native frame is sized to the desktop's work area (the taskbar
      // stays out of it); going full screen from there left a strip uncovered along the bottom. Restore it
      // first, so the full-screen window is sized from its normal state to the whole monitor.
      maximizedBeforeFullScreen = await w.isMaximized().catch(() => false);
      if (maximizedBeforeFullScreen) {
        await w.unmaximize().catch(() => undefined);
        await pause(80);
      }
      await w.setFullscreen(true);
    } else {
      await w.setFullscreen(false);
      if (maximizedBeforeFullScreen) {
        maximizedBeforeFullScreen = false;
        await pause(80);
        await w.maximize().catch(() => undefined);
      }
    }
    await refresh();
    return;
  }
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
}

export function isFullScreenNow(): boolean {
  return state.fullscreen;
}

// ---- Desktop preferences kept by Rust (src-tauri/src/prefs.rs) ---------------------

export interface DesktopPrefs {
  closeToTray: boolean;
  globalMediaKeys: boolean;
}

export function desktopPrefs(): Promise<DesktopPrefs> {
  return invoke<DesktopPrefs>('prefs_get');
}

export function setDesktopPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs> {
  return invoke<DesktopPrefs>('prefs_set', { patch });
}
