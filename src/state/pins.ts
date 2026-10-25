import { create } from 'zustand';
import { moveKey } from './playlistOrder';

/**
 * Pinned playlists: kept at the top of the sidebar, in the order they were
 * pinned, across runs. Each pin stores what the sidebar needs to draw it (the
 * title and cover) so a pin shows even before its playlist has loaded.
 */

export interface Pin {
  /** `ytm:VL…` or `spotify:…`, so the two catalogues never collide. */
  key: string;
  title: string;
  thumbnail: string | null;
  href: string;
}

const STORAGE_KEY = 'prismix:pins';
const MAX_PINS = 50;

const isPin = (v: unknown): v is Pin => {
  const p = v as Partial<Pin> | null;
  return !!p && typeof p.key === 'string' && typeof p.title === 'string' && typeof p.href === 'string' && (p.thumbnail == null || typeof p.thumbnail === 'string');
};

function load(): Pin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter(isPin).filter((p) => !seen.has(p.key) && !!seen.add(p.key)).slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

interface PinsState {
  pins: Pin[];
  /** Pins the playlist, or unpins it when it already is. A pin's title and cover are refreshed when seen again. */
  toggle: (pin: Pin) => void;
  refresh: (pin: Pin) => void;
  /** Puts the pin [from] before or after the pin [to]. */
  move: (from: string, to: string, after: boolean) => void;
}

export const usePins = create<PinsState>()((set) => ({
  pins: load(),
  toggle: (pin) =>
    set((s) =>
      s.pins.some((p) => p.key === pin.key)
        ? { pins: s.pins.filter((p) => p.key !== pin.key) }
        : { pins: [...s.pins, pin].slice(-MAX_PINS) },
    ),
  move: (from, to, after) =>
    set((s) => {
      const keys = s.pins.map((p) => p.key);
      const moved = moveKey(keys, from, to, after);
      if (moved.every((key, i) => key === keys[i])) return s;
      const byKey = new Map(s.pins.map((p) => [p.key, p] as const));
      return { pins: moved.map((key) => byKey.get(key)!) };
    }),
  refresh: (pin) =>
    set((s) => {
      const current = s.pins.find((p) => p.key === pin.key);
      if (!current || (current.title === pin.title && current.thumbnail === pin.thumbnail && current.href === pin.href)) return s;
      return { pins: s.pins.map((p) => (p.key === pin.key ? pin : p)) };
    }),
}));

usePins.subscribe(({ pins }) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Storage full or blocked: the pins last for this run.
  }
});

export const ytmPinKey = (id: string) => `ytm:${id}`;
export const spotifyPinKey = (id: string) => `spotify:${id}`;
