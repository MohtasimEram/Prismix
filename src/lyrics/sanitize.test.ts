import { describe, expect, it } from 'vitest';
import { keepClustersWhole, sanitizeLyricText } from './sanitize';

describe('sanitizeLyricText', () => {
  it('removes zero-width and direction marks between Bangla words', () => {
    expect(sanitizeLyricText('আমি\u200B তুমি\u200E\uFEFF ভালো\uFFFD')).toBe('আমি তুমি ভালো');
  });
  it('turns no-break and exotic spaces into plain spaces', () => {
    expect(sanitizeLyricText('আমি\u00A0তুমি\u2009ভালো')).toBe('আমি তুমি ভালো');
  });
  it('keeps a joiner inside an Indic conjunct but drops one beside a space', () => {
    expect(sanitizeLyricText('র\u200D্য')).toBe('র\u200D্য');
    expect(sanitizeLyricText('আমি \u200C তুমি')).toBe('আমি  তুমি');
    expect(sanitizeLyricText('abc\u200Cdef')).toBe('abcdef');
  });
  it('composes split two-part vowel signs', () => {
    expect(sanitizeLyricText('\u09AD\u09C7\u09BE')).toBe('\u09AD\u09CB');
  });
  it('leaves ordinary text alone', () => {
    expect(sanitizeLyricText('Hello, world\nok')).toBe('Hello, world\nok');
  });
});

describe('keepClustersWhole', () => {
  it('moves a leading vowel sign back to its consonant', () => {
    expect(keepClustersWhole(['ক', '\u09BEল'])).toEqual(['ক\u09BE', 'ল']);
  });
  it('leaves clean pieces untouched', () => {
    expect(keepClustersWhole(['ভা', 'লো'])).toEqual(['ভা', 'লো']);
  });
});
