import { create } from 'zustand';
import type { MusicItem } from '@/data/music/types';

/**
 * Recent searches, newest first, kept across runs; listed under the search field when it is clicked.
 * Tracks songs, videos, albums, artists, and playlists that were played or opened after a search,
 * Spotify-style, each kept whole with its cover, type, and details.
 */

const KEY = 'prismix:recent-searches';
const MAX = 12;

function isItem(value: unknown): value is MusicItem {
  const v = value as Partial<MusicItem> | null;
  return !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.title === 'string' && v.id.length > 0;
}

function load(): MusicItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const items: MusicItem[] = [];
    for (const value of raw) {
      // Earlier versions kept phrases and wrapped items as { type: 'item', item }.
      const entry = value as { type?: unknown; item?: unknown } | null;
      const item = entry && typeof entry === 'object' && entry.type === 'item' ? entry.item : value;
      if (!isItem(item) || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    return items.slice(0, MAX);
  } catch {
    return [];
  }
}

function save(list: MusicItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the list lasts for this run.
  }
}

interface RecentState {
  recent: MusicItem[];
  /** Notes an item that was selected or played after a search. */
  addItem: (item: MusicItem) => void;
  /** Backward-compatible alias for addItem. */
  addSong: (item: MusicItem) => void;
  /** Forgets one item, by its id. */
  remove: (id: string) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentState>()((set, get) => ({
  recent: load(),
  addItem: (item) => {
    if (!isItem(item)) return;
    set((s) => {
      const recent = [item, ...s.recent.filter((e) => e.id !== item.id)].slice(0, MAX);
      save(recent);
      return { recent };
    });
  },
  addSong: (item) => {
    get().addItem(item);
  },
  remove: (id) =>
    set((s) => {
      const recent = s.recent.filter((e) => e.id !== id);
      save(recent);
      return { recent };
    }),
  clear: () => {
    save([]);
    set({ recent: [] });
  },
}));

/**
 * The items the search page is showing right now (suggestions, results, the recent list), by id.
 * An item that gets opened or played from here was chosen from a search.
 * The page empties it when it closes.
 */
const shown = new Map<string, MusicItem>();
const MAX_SHOWN = 400;

export function rememberSearchItems(items: readonly MusicItem[]): void {
  for (const item of items) {
    if (!isItem(item)) continue;
    shown.delete(item.id);
    shown.set(item.id, item);
    if (shown.size > MAX_SHOWN) shown.delete(shown.keys().next().value!);
  }
}

/** Backward-compatible alias. */
export const rememberSearchSongs = rememberSearchItems;

export function forgetSearchItems(): void {
  shown.clear();
}

/** Backward-compatible alias. */
export const forgetSearchSongs = forgetSearchItems;

/** An item was chosen on purpose from the search page: kept in recent searches. */
export function noteItemSelected(id: string | undefined): void {
  const item = id ? shown.get(id) : undefined;
  if (item) useRecentSearches.getState().addItem(item);
}

/** Backward-compatible alias for noteItemSelected. */
export const noteSongPlayed = noteItemSelected;
