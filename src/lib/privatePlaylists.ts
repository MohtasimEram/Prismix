/**
 * Playlists this app made private. Prismix only ever makes private playlists
 * (createPlaylist), and remembering them means their page can say so even if
 * YouTube's page for them doesn't state it. YouTube's own word wins when it gives one.
 */
const KEY = 'prismix:private-playlists';
const MAX = 500;

const bare = (id: string) => id.replace(/^VL/, '');

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberPrivatePlaylist(id: string): void {
  try {
    const ids = [bare(id), ...load().filter((x) => x !== bare(id))].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the page just won't know */
  }
}

/** The playlist is no longer private (it was made public or unlisted), so the app stops saying it is. */
export function forgetPrivatePlaylist(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(load().filter((x) => x !== bare(id))));
  } catch {
    /* storage unavailable */
  }
}

export const isRememberedPrivate = (id: string): boolean => load().includes(bare(id));
