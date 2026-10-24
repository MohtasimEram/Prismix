import { describe, expect, it } from 'vitest';
import { fileNameFor } from './download';

describe('fileNameFor', () => {
  it('joins artists and title and adds the extension', () => {
    expect(fileNameFor({ title: 'Song', artists: [{ name: 'A', id: null }, { name: 'B', id: null }] }, 'webm')).toBe('A, B - Song.webm');
  });
  it('replaces characters a file name cannot hold', () => {
    expect(fileNameFor({ title: 'AC/DC: Live?', artists: [] }, 'm4a')).toBe('AC_DC_ Live_.m4a');
  });
  it('never returns an empty name', () => {
    expect(fileNameFor({ title: '', artists: [] }, 'webm')).toBe('Prismix track.webm');
  });
});
