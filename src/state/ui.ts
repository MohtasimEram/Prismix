import { create } from 'zustand';

export type SidePanel = 'up-next' | 'lyrics' | 'now-playing' | null;
type OpenPanel = Exclude<SidePanel, null>;

const PANEL_KEY = 'prismix:side-panel';
const HIDDEN_KEY = 'prismix:now-playing-hidden';
const PANELS: readonly OpenPanel[] = ['up-next', 'lyrics', 'now-playing'];

/** The panel that was open when the app was last closed (none if it was closed, or the window is too narrow to hold one). */
function restoredPanel(): SidePanel {
  try {
    // Below 640px the panel is full-width: starting with one open would hide the app.
    if (typeof window !== 'undefined' && window.innerWidth < 640) return null;
    const stored = localStorage.getItem(PANEL_KEY);
    return PANELS.find((panel) => panel === stored) ?? null;
  } catch {
    return null;
  }
}

/** Whether Now Playing was hidden by the listener (it then stays a strip at the window's edge, and doesn't reopen by itself). */
function restoredHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

interface UiState {
  /** The right-hand glass panel (report §7); one of Now Playing, Up Next or Lyrics at a time. Remembered across runs. */
  sidePanel: SidePanel;
  toggleSidePanel: (panel: OpenPanel) => void;
  setSidePanel: (panel: SidePanel) => void;
  /** Opens Lyrics or Up Next from Now Playing; closing that panel then comes back to Now Playing. */
  openFromNowPlaying: (panel: OpenPanel) => void;
  /** Closes the panel, or steps back to Now Playing when it was opened from there. */
  closeSidePanel: () => void;
  /** Set while Lyrics or Up Next was opened from Now Playing. */
  returnToNowPlaying: boolean;
  /** Now Playing hidden on purpose: no panel opens by itself when a song starts, until Now Playing is opened again. Remembered across runs. */
  nowPlayingHidden: boolean;
  /** Hides the Now Playing panel, leaving its strip at the window's edge. */
  hideNowPlaying: () => void;
  /** The full-screen player: artwork, controls and lyrics over the artwork's mesh (report §7). */
  fullScreen: boolean;
  setFullScreen: (open: boolean) => void;
  /** The sidebar as a drawer, below 484px where it's otherwise hidden. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

export const useUi = create<UiState>()((set, get) => ({
  sidePanel: restoredPanel(),
  returnToNowPlaying: false,
  nowPlayingHidden: restoredHidden(),
  hideNowPlaying: () => set({ sidePanel: get().sidePanel === 'now-playing' ? null : get().sidePanel, returnToNowPlaying: false, nowPlayingHidden: true }),
  // Moving from Now Playing to Lyrics or Up Next (by any button) remembers to step back to it on close.
  toggleSidePanel: (panel) => {
    const { sidePanel } = get();
    if (sidePanel === panel) get().closeSidePanel();
    else set({ sidePanel: panel, returnToNowPlaying: sidePanel === 'now-playing' && panel !== 'now-playing', ...(panel === 'now-playing' && { nowPlayingHidden: false }) });
  },
  setSidePanel: (panel) =>
    set({
      sidePanel: panel,
      returnToNowPlaying: get().sidePanel === 'now-playing' && panel !== null && panel !== 'now-playing',
      // Showing Now Playing again ends "hidden".
      ...(panel === 'now-playing' && { nowPlayingHidden: false }),
    }),
  openFromNowPlaying: (panel) => set({ sidePanel: panel, returnToNowPlaying: true }),
  closeSidePanel: () => set({ sidePanel: get().returnToNowPlaying ? 'now-playing' : null, returnToNowPlaying: false }),
  fullScreen: false,
  setFullScreen: (fullScreen) => set({ fullScreen }),
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));

// Which panel is open is kept, so the app comes back as it was left.
useUi.subscribe((state, previous) => {
  try {
    if (state.sidePanel !== previous.sidePanel) localStorage.setItem(PANEL_KEY, state.sidePanel ?? 'none');
    if (state.nowPlayingHidden !== previous.nowPlayingHidden) localStorage.setItem(HIDDEN_KEY, state.nowPlayingHidden ? '1' : '0');
  } catch {
    // Storage full or blocked: it lasts for this run.
  }
});

// For browser-driven tests, next to __bcPlayer.
if (import.meta.env.DEV) Object.assign(window, { __bcUi: useUi });
