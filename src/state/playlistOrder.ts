import { create } from 'zustand';

/**
 * The order of the playlists in the left sidebar, as the listener dragged them
 * into. The order is kept across runs as a list of playlist keys (`ytm:…`,
 * `spotify:…`); a playlist that isn't in it yet (a new one) shows first, and the
 * ones that are keep the order they were given. The pinned playlists have
 * their own order (state/pins.ts).
 */

const STORAGE_KEY = 'prismix:playlist-order';
const MAX_KEYS = 1000;
const MAX_KEY_LENGTH = 200;

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const key of raw) {
      if (typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (keys.length >= MAX_KEYS) break;
    }
    return keys;
  } catch {
    return [];
  }
}

/** [keys] with [from] taken out and put before or after [to]; [keys] itself when either isn't in it. */
export function moveKey(keys: readonly string[], from: string, to: string, after: boolean): string[] {
  if (from === to || !keys.includes(from) || !keys.includes(to)) return [...keys];
  const rest = keys.filter((key) => key !== from);
  rest.splice(rest.indexOf(to) + (after ? 1 : 0), 0, from);
  return rest;
}

/** [rows] in the saved [order]; rows it doesn't know come first, in the order they were given. */
export function sortByOrder<T extends { key: string }>(rows: readonly T[], order: readonly string[]): T[] {
  const index = new Map(order.map((key, i) => [key, i] as const));
  const known = rows.filter((row) => index.has(row.key)).sort((a, b) => index.get(a.key)! - index.get(b.key)!);
  const fresh = rows.filter((row) => !index.has(row.key));
  return [...fresh, ...known];
}

interface OrderState {
  order: string[];
  /** Puts [from] before or after [to], within [sectionKeys] (the section's keys as they show now). */
  move: (sectionKeys: readonly string[], from: string, to: string, after: boolean) => void;
}

export const usePlaylistOrder = create<OrderState>()((set) => ({
  order: load(),
  move: (sectionKeys, from, to, after) =>
    set((s) => {
      const moved = moveKey(sectionKeys, from, to, after);
      if (moved.every((key, i) => key === sectionKeys[i])) return s;
      const inSection = new Set(moved);
      return { order: [...moved, ...s.order.filter((key) => !inSection.has(key))].slice(0, MAX_KEYS) };
    }),
}));

usePlaylistOrder.subscribe(({ order }) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage full or blocked: the order lasts for this run.
  }
});

/**
 * A playlist row being dragged to a new place. Browsers hide a drag's payload
 * until the drop, so the row and the section it belongs to are kept here; only
 * rows of the same section take the drop.
 */
export const PLAYLIST_MIME = 'application/x-prismix-playlist';

interface DragState {
  key: string | null;
  section: string | null;
  /** The row the pointer is over, and whether the drop would land after it. */
  over: { key: string; after: boolean } | null;
  start: (key: string, section: string) => void;
  hover: (key: string, after: boolean) => void;
  end: () => void;
}

export const usePlaylistDrag = create<DragState>()((set, get) => ({
  key: null,
  section: null,
  over: null,
  start: (key, section) => set({ key, section, over: null }),
  hover: (key, after) => {
    const over = get().over;
    if (over?.key === key && over.after === after) return;
    set({ over: { key, after } });
  },
  end: () => set({ key: null, section: null, over: null }),
}));

// A row that unmounts mid-drag never gets its own dragend: these catch the end of any drag.
if (typeof window !== 'undefined') {
  const clear = () => {
    if (usePlaylistDrag.getState().key !== null) usePlaylistDrag.getState().end();
  };
  window.addEventListener('dragend', clear, true);
  window.addEventListener('drop', () => setTimeout(clear, 0), true);
}
