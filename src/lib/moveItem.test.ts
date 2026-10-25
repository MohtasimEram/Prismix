import { describe, expect, it } from 'vitest';
import { moveBefore } from './moveItem';

const abcde = ['a', 'b', 'c', 'd', 'e'];

describe('moveBefore', () => {
  it('moves an item later, to just before another', () => expect(moveBefore(abcde, 0, 3)).toEqual(['b', 'c', 'a', 'd', 'e']));
  it('moves an item earlier', () => expect(moveBefore(abcde, 3, 1)).toEqual(['a', 'd', 'b', 'c', 'e']));
  it('moves an item to the end', () => expect(moveBefore(abcde, 1, 5)).toEqual(['a', 'c', 'd', 'e', 'b']));
  it('moves an item to the start', () => expect(moveBefore(abcde, 4, 0)).toEqual(['e', 'a', 'b', 'c', 'd']));
  it('leaves the list alone when nothing would change', () => {
    expect(moveBefore(abcde, 2, 2)).toBe(abcde);
    expect(moveBefore(abcde, 2, 3)).toBe(abcde);
  });
  it('ignores indices that are out of range', () => {
    expect(moveBefore(abcde, -1, 2)).toBe(abcde);
    expect(moveBefore(abcde, 1, 9)).toBe(abcde);
    expect(moveBefore(abcde, 1.5, 2)).toBe(abcde);
  });
});
