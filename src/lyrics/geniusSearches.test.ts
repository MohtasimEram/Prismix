import { describe, expect, it } from 'vitest';
import { geniusSearches } from './providers';

describe('geniusSearches', () => {
  it('tries the first artist alone and the title with its suffix', () => {
    const searches = geniusSearches('Dil | Coke Studio Nu.WAV', 'Afusic, Zoha Waseem, AliSoomroMusic');
    expect(searches[0]).toBe('Afusic Dil');
    expect(searches).toContain('Afusic Dil | Coke Studio Nu.WAV');
  });

  it('has no repeats or empty searches', () => {
    const searches = geniusSearches('Tum Hi Ho', 'Arijit Singh');
    expect(new Set(searches).size).toBe(searches.length);
    expect(searches.every((q) => q.length > 0)).toBe(true);
  });
});
