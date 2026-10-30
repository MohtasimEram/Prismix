const STORAGE_KEY = 'prismix:playlist_in_playlist';

function loadStored(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveStored(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

const memory = loadStored();

const pairKey = (sourceId: string, targetId: string) =>
  `${sourceId.replace(/^VL/, '')}:${targetId.replace(/^VL/, '')}`;

export function rememberPlaylistInPlaylist(sourceId: string, targetId: string): void {
  memory.add(pairKey(sourceId, targetId));
  saveStored(memory);
}

export function forgetPlaylistInPlaylist(sourceId: string, targetId: string): void {
  memory.delete(pairKey(sourceId, targetId));
  saveStored(memory);
}

export function isPlaylistInPlaylist(sourceId: string, targetId: string): boolean {
  return memory.has(pairKey(sourceId, targetId));
}

