/**
 * Which followed-artist releases Home has already shown, so it can say how many are new
 * since the last visit. Kept in this browser only; there is nothing to sync.
 */

const KEY = 'prismix:seen-releases';
const MAX_REMEMBERED = 300;

/** The ids seen so far, or null before the first visit (when nothing can be called new yet). */
export function readSeenReleases(storage: Pick<Storage, 'getItem'> = localStorage): Set<string> | null {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    const list = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string').slice(-MAX_REMEMBERED) : []);
  } catch {
    return null;
  }
}

/** Marks [ids] as seen, keeping the most recent few hundred. */
export function markReleasesSeen(ids: readonly string[], storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    const merged = [...(readSeenReleases(storage) ?? []), ...ids];
    storage.setItem(KEY, JSON.stringify([...new Set(merged)].slice(-MAX_REMEMBERED)));
  } catch {
    // Storage full or blocked: the count just isn't kept.
  }
}

/** How many of [ids] are new: 0 on the very first visit, which only sets the baseline. */
export function countNewReleases(ids: readonly string[], seen: ReadonlySet<string> | null): number {
  return seen === null ? 0 : ids.filter((id) => !seen.has(id)).length;
}
