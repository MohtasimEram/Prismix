import { create } from 'zustand';
import type { MusicItem } from '@/data/music/types';

/**
 * Recent searches, newest first, kept across runs; listed under the search field when it is clicked.
 * The list is the songs (and videos) that were played after a search, whether from the suggestions or
 * from the results, each kept whole so it can be listed with its cover and artists and played again.
 * Phrases that were searched for, and albums, artists or playlists that were opened, are not kept.
 */

const KEY = 'prismix:recent-searches';
const MAX = 12;

/** Only songs and videos are listed: they are what plays. */
const isSong = (item: MusicItem): boolean => item.kind === 'song' || item.kind === 'video';

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
      // Earlier versions kept phrases and wrapped items as { type: 'item', item }: the phrases go, the songs stay.
      const entry = value as { type?: unknown; item?: unknown } | null;
      const item = entry && typeof entry === 'object' && entry.type === 'item' ? entry.item : value;
      if (!isItem(item) || !isSong(item) || seen.has(item.id)) continue;
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
  /** Notes a song that was played after a search. */
  addSong: (item: MusicItem) => void;
  /** Forgets one song, by its id. */
  remove: (id: string) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentState>()((set) => ({
  recent: load(),
  addSong: (item) => {
    if (!isItem(item) || !isSong(item)) return;
    set((s) => {
      const recent = [item, ...s.recent.filter((e) => e.id !== item.id)].slice(0, MAX);
      save(recent);
      return { recent };
    });
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
 * The songs the search page is showing right now (suggestions, results, the recent list), by video id.
 * A song that starts playing and is in here was played from a search; one that isn't (a playlist played
 * from the sidebar while the page is open) is not. The page empties it when it closes.
 */
const shown = new Map<string, MusicItem>();
const MAX_SHOWN = 400;

export function rememberSearchSongs(items: readonly MusicItem[]): void {
  for (const item of items) {
    if (!isItem(item) || !isSong(item)) continue;
    shown.delete(item.id);
    shown.set(item.id, item);
    if (shown.size > MAX_SHOWN) shown.delete(shown.keys().next().value!);
  }
}

export function forgetSearchSongs(): void {
  shown.clear();
}

/** A song was played on purpose (a click on it, not the queue moving on): kept if it came from the search page. */
export function noteSongPlayed(videoId: string | undefined): void {
  const item = videoId ? shown.get(videoId) : undefined;
  if (item) useRecentSearches.getState().addSong(item);
}
