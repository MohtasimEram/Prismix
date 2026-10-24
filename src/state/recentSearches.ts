import { create } from 'zustand';

/** Recent searches, newest first, kept across runs; shown on the Search page before anything is typed. */

const KEY = 'prismix:recent-searches';
const MAX = 10;
const MAX_LENGTH = 100;

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_LENGTH).slice(0, MAX);
  } catch {
    return [];
  }
}

function save(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the list lasts for this run.
  }
}

interface RecentState {
  recent: string[];
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentState>()((set) => ({
  recent: load(),
  add: (query) => {
    const q = query.trim().slice(0, MAX_LENGTH);
    if (!q) return;
    set((s) => {
      const recent = [q, ...s.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
      save(recent);
      return { recent };
    });
  },
  remove: (query) =>
    set((s) => {
      const recent = s.recent.filter((r) => r !== query);
      save(recent);
      return { recent };
    }),
  clear: () => {
    save([]);
    set({ recent: [] });
  },
}));
