import { create } from 'zustand';

export type SidePanel = 'up-next' | 'lyrics' | 'now-playing' | null;
type OpenPanel = Exclude<SidePanel, null>;

const PANEL_KEY = 'prismix:side-panel';
const HIDDEN_KEY = 'prismix:now-playing-hidden';

/** Default to Now Playing on launch (none if window is too narrow to hold one). */
function restoredPanel(): SidePanel {
  try {
    // Below 640px the panel is full-width: starting with one open would hide the app.
    if (typeof window !== 'undefined' && window.innerWidth < 640) return null;
    return 'now-playing';
  } catch {
    return 'now-playing';
  }
}

/** Now Playing starts visible on launch. */
function restoredHidden(): boolean {
  return false;
}

interface UiState {
  /** The right-hand glass panel (report §7); one of Now Playing, Up Next or Lyrics at a time. */
  sidePanel: SidePanel;
  toggleSidePanel: (panel: OpenPanel) => void;
  setSidePanel: (panel: SidePanel) => void;
  /** Opens Lyrics or Up Next from Now Playing; closing that panel then comes back to Now Playing. */
  openFromNowPlaying: (panel: OpenPanel) => void;
  /** Closes the panel, always stepping back to Now Playing. */
  closeSidePanel: () => void;
  /** Set while Lyrics or Up Next was opened from Now Playing. */
  returnToNowPlaying: boolean;
  /** Now Playing hidden on purpose: no panel opens by itself when a song starts, until Now Playing is opened again. */
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
  hideNowPlaying: () =>
    set({
      sidePanel: get().sidePanel === 'now-playing' ? null : get().sidePanel,
      returnToNowPlaying: false,
      nowPlayingHidden: true,
    }),
  // Moving between panels; closing Up Next or Lyrics always returns to Now Playing.
  toggleSidePanel: (panel) => {
    const { sidePanel } = get();
    if (sidePanel === panel) {
      get().closeSidePanel();
    } else {
      set({
        sidePanel: panel,
        returnToNowPlaying: true,
        ...(panel === 'now-playing' && { nowPlayingHidden: false }),
      });
    }
  },
  setSidePanel: (panel) =>
    set({
      sidePanel: panel,
      returnToNowPlaying: panel !== null && panel !== 'now-playing',
      ...(panel === 'now-playing' && { nowPlayingHidden: false }),
    }),
  openFromNowPlaying: (panel) => set({ sidePanel: panel, returnToNowPlaying: true }),
  closeSidePanel: () =>
    set({
      sidePanel: typeof window !== 'undefined' && window.innerWidth < 640 ? null : 'now-playing',
      returnToNowPlaying: false,
      nowPlayingHidden: false,
    }),
  fullScreen: false,
  setFullScreen: (fullScreen) => set({ fullScreen }),
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));

// Keep state updated for session persistence if needed.
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
