import { describe, expect, it } from 'vitest';
import { countsAsListen, primaryArtist } from './scrobbleRules';

describe('countsAsListen', () => {
  it('needs half the song, but never more than four minutes', () => {
    expect(countsAsListen(100, 200)).toBe(true);
    expect(countsAsListen(99, 200)).toBe(false);
    expect(countsAsListen(240, 900)).toBe(true);
    expect(countsAsListen(239, 900)).toBe(false);
  });
  it('needs at least 30 seconds, and a song longer than that', () => {
    expect(countsAsListen(20, 40)).toBe(false);
    expect(countsAsListen(30, 40)).toBe(true);
    expect(countsAsListen(30, 30)).toBe(false);
  });
});

describe('primaryArtist', () => {
  it('keeps the first credited artist', () => {
    expect(primaryArtist('Arijit Singh, Shreya Ghoshal')).toBe('Arijit Singh');
    expect(primaryArtist('Daft Punk & Pharrell')).toBe('Daft Punk');
    expect(primaryArtist('Solo')).toBe('Solo');
  });
});
