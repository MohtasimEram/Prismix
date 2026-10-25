import { describe, expect, it } from 'vitest';
import { parseDownloads } from './downloadsLibrary';

const song = (videoId: string, extra: Record<string, unknown> = {}) => ({
  videoId,
  title: 'Song',
  artist: 'Artist',
  thumbnail: 'https://lh3.googleusercontent.com/x',
  path: 'C:\\Users\\me\\Downloads\\Prismix\\Artist - Song.webm',
  quality: 'opus · 139 kbps',
  at: 1,
  ...extra,
});

describe('parseDownloads', () => {
  it('reads a good list back', () => {
    const list = parseDownloads(JSON.stringify([song('aaaaaaaaaaa'), song('bbbbbbbbbbb')]));
    expect(list.map((s) => s.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });
  it('drops bad ids and repeats', () => {
    expect(parseDownloads(JSON.stringify([song('nope'), song('aaaaaaaaaaa'), song('aaaaaaaaaaa')]))).toHaveLength(1);
  });
  it('keeps only https artwork', () => {
    expect(parseDownloads(JSON.stringify([song('aaaaaaaaaaa', { thumbnail: 'javascript:alert(1)' })]))[0]?.thumbnail).toBeNull();
  });
  it('copes with junk', () => {
    expect(parseDownloads(null)).toEqual([]);
    expect(parseDownloads('not json')).toEqual([]);
    expect(parseDownloads('{"a":1}')).toEqual([]);
  });
});
