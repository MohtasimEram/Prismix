import { describe, expect, it } from 'vitest';
import { musicPlaylistShareUrl, musicShareUrl } from './share';

describe('musicShareUrl', () => {
  it('is the YouTube Music watch link', () => expect(musicShareUrl('dQw4w9WgXcQ')).toBe('https://music.youtube.com/watch?v=dQw4w9WgXcQ'));
  it('escapes anything odd in the id', () => expect(musicShareUrl('a&b')).toBe('https://music.youtube.com/watch?v=a%26b'));
});

describe('musicPlaylistShareUrl', () => {
  it('is the YouTube Music playlist link', () => expect(musicPlaylistShareUrl('PLabc123')).toBe('https://music.youtube.com/playlist?list=PLabc123'));
  it('drops the browse prefix', () => expect(musicPlaylistShareUrl('VLPLabc123')).toBe('https://music.youtube.com/playlist?list=PLabc123'));
});
