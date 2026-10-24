import { describe, expect, it } from 'vitest';
import { pickAudio, type AudioChoice } from './quality';

const ladder: AudioChoice[] = [
  { codec: 'opus', kbps: 50 },
  { codec: 'opus', kbps: 70 },
  { codec: 'opus', kbps: 140 },
  { codec: 'mp4a.40.2', kbps: 128 },
  { codec: 'mp4a.40.2', kbps: 256 },
];
const preferred = ['opus', 'mp4a'];

describe('pickAudio', () => {
  it('automatic takes the best of the preferred codec', () => {
    expect(pickAudio(ladder, 'auto', preferred)).toBe(2);
  });
  it('automatic falls to AAC when Opus is not decodable', () => {
    expect(pickAudio(ladder.filter((c) => c.codec !== 'opus'), 'auto', ['mp4a'])).toBe(1);
  });
  it('low takes the best rung under the ceiling', () => {
    expect(pickAudio(ladder, 'low', preferred)).toBe(1);
  });
  it('normal stays under 135 kbps, preferred codec first', () => {
    expect(pickAudio(ladder, 'normal', preferred)).toBe(1);
    expect(pickAudio(ladder, 'standard', ['mp4a'])).toBe(3);
  });
  it('takes the cheapest rung when all are over the ceiling', () => {
    expect(pickAudio([{ codec: 'mp4a.40.2', kbps: 256 }, { codec: 'mp4a.40.2', kbps: 192 }], 'low', preferred)).toBe(1);
  });
  it('maximum takes the highest bitrate of any codec', () => {
    expect(pickAudio(ladder, 'max', preferred)).toBe(4);
  });
  it('maximum takes lossless, then Atmos, when offered', () => {
    expect(pickAudio([...ladder, { codec: 'ec-3', kbps: 768 }], 'max', preferred)).toBe(5);
    expect(pickAudio([...ladder, { codec: 'ec-3', kbps: 768 }, { codec: 'flac', kbps: 900 }], 'max', preferred)).toBe(6);
  });
  it('returns -1 with nothing to choose from', () => {
    expect(pickAudio([], 'auto', preferred)).toBe(-1);
  });
});
