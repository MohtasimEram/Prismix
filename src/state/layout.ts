import { create } from 'zustand';

/**
 * The widths of the resizable panels (left sidebar, right Up Next / Lyrics
 * panel), kept across runs. Dragging a handle calls `setSidebarWidth` /
 * `setSidePanelWidth`; the values are clamped here so no caller can store
 * one the layout can't hold.
 */

export const SIDEBAR_LIMITS = { min: 200, max: 420, fallback: 260 } as const;
export const SIDE_PANEL_LIMITS = { min: 260, max: 560, fallback: 300 } as const;

const STORAGE_KEY = 'prismix:layout';

interface Stored {
  sidebarWidth: number;
  sidePanelWidth: number;
}

export function clampWidth(value: unknown, limits: { min: number; max: number; fallback: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : limits.fallback;
  return Math.round(Math.max(limits.min, Math.min(limits.max, n)));
}

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    return {
      sidebarWidth: clampWidth(raw?.sidebarWidth, SIDEBAR_LIMITS),
      sidePanelWidth: clampWidth(raw?.sidePanelWidth, SIDE_PANEL_LIMITS),
    };
  } catch {
    return { sidebarWidth: SIDEBAR_LIMITS.fallback, sidePanelWidth: SIDE_PANEL_LIMITS.fallback };
  }
}

interface LayoutState extends Stored {
  setSidebarWidth: (width: number) => void;
  setSidePanelWidth: (width: number) => void;
  resetWidths: () => void;
}

export const useLayout = create<LayoutState>()((set) => ({
  ...load(),
  setSidebarWidth: (width) => set({ sidebarWidth: clampWidth(width, SIDEBAR_LIMITS) }),
  setSidePanelWidth: (width) => set({ sidePanelWidth: clampWidth(width, SIDE_PANEL_LIMITS) }),
  resetWidths: () => set({ sidebarWidth: SIDEBAR_LIMITS.fallback, sidePanelWidth: SIDE_PANEL_LIMITS.fallback }),
}));

useLayout.subscribe(({ sidebarWidth, sidePanelWidth }) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarWidth, sidePanelWidth }));
  } catch {
    // Storage full or blocked: the sizes last for this run.
  }
});
