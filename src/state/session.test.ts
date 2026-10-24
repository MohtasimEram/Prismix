import { describe, expect, it } from 'vitest';
import { readSession, resumePosition } from './sessionData';

const track = (videoId: string, extra: Record<string, unknown> = {}) => ({
  videoId,
  title: 'Song',
  artists: [{ name: 'Artist', id: 'UC1' }],
  album: { name: 'Album', id: 'MPREb_1' },
  durationSec: 200,
  explicit: false,
  thumbnail: 'https://lh3.googleusercontent.com/x',
  index: null,
  plays: null,
  ...extra,
});
const entry = (videoId: string, extra: Record<string, unknown> = {}) => ({
  entryId: `e-${videoId}`,
  tier: 'context',
  source: { title: 'Mix', type: 'playlist', id: 'PL1' },
  track: track(videoId, extra),
});
const store = (value: unknown) => ({ getItem: () => (typeof value === 'string' ? value : JSON.stringify(value)) });

describe('readSession', () => {
  it('reads a good session back', () => {
    const s = readSession(store({ v: 1, queue: [entry('aaaaaaaaaaa'), entry('bbbbbbbbbbb')], index: 1, positionSec: 42.5 }));
    expect(s?.index).toBe(1);
    expect(s?.positionSec).toBe(42.5);
    expect(s?.queue.map((e) => e.track.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(s?.queue[1]?.entryId).toBe('e-bbbbbbbbbbb');
  });
  it('drops entries with a bad id and re-points the index', () => {
    const s = readSession(store({ v: 1, queue: [entry('not a video id'), entry('bbbbbbbbbbb')], index: 1, positionSec: 5 }));
    expect(s?.queue).toHaveLength(1);
    expect(s?.index).toBe(0);
  });
  it('rejects a session whose playing song is invalid', () => {
    expect(readSession(store({ v: 1, queue: [entry('bad'), entry('bbbbbbbbbbb')], index: 0, positionSec: 5 }))).toBeNull();
  });
  it('rejects junk, other versions and missing data', () => {
    expect(readSession(store('not json'))).toBeNull();
    expect(readSession(store({ v: 2, queue: [], index: 0 }))).toBeNull();
    expect(readSession(store({ v: 1, queue: 'x', index: 0 }))).toBeNull();
    expect(readSession({ getItem: () => null })).toBeNull();
  });
  it('only keeps https artwork and a sane position', () => {
    const s = readSession(store({ v: 1, queue: [entry('aaaaaaaaaaa', { thumbnail: 'javascript:alert(1)' })], index: 0, positionSec: -4 }));
    expect(s?.queue[0]?.track.thumbnail).toBeNull();
    expect(s?.positionSec).toBe(0);
  });
  it('replaces an unknown tier or source type', () => {
    const bad = { ...entry('aaaaaaaaaaa'), tier: 'evil', source: { title: 'x', type: 'nope' } };
    const s = readSession(store({ v: 1, queue: [bad], index: 0, positionSec: 1 }));
    expect(s?.queue[0]?.tier).toBe('context');
    expect(s?.queue[0]?.source?.type).toBe('other');
  });
});

describe('resumePosition', () => {
  it('resumes mid-song', () => expect(resumePosition(95.7, 200)).toBe(95));
  it('starts over when stopped near the start or the end', () => {
    expect(resumePosition(1, 200)).toBe(0);
    expect(resumePosition(199, 200)).toBe(0);
  });
  it('copes with an unknown length and bad numbers', () => {
    expect(resumePosition(60, 0)).toBe(60);
    expect(resumePosition(Number.NaN, 200)).toBe(0);
  });
});
