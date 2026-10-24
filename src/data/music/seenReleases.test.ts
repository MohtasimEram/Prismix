import { describe, expect, it } from 'vitest';
import { countNewReleases, markReleasesSeen, readSeenReleases } from './seenReleases';

function memory(initial: string | null = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_k: string, v: string) => void (value = v) };
}

describe('seen releases', () => {
  it('is null before the first visit, and nothing counts as new', () => {
    expect(readSeenReleases(memory())).toBeNull();
    expect(countNewReleases(['a', 'b'], null)).toBe(0);
  });
  it('remembers what was shown and counts only the rest as new', () => {
    const store = memory();
    markReleasesSeen(['a', 'b'], store);
    const seen = readSeenReleases(store);
    expect(seen).toEqual(new Set(['a', 'b']));
    expect(countNewReleases(['a', 'b', 'c'], seen)).toBe(1);
  });
  it('merges later visits and ignores a damaged store', () => {
    const store = memory();
    markReleasesSeen(['a'], store);
    markReleasesSeen(['b'], store);
    expect(readSeenReleases(store)).toEqual(new Set(['a', 'b']));
    expect(readSeenReleases(memory('not json'))).toBeNull();
    expect(readSeenReleases(memory('[1,"x",null]'))).toEqual(new Set(['x']));
  });
});
