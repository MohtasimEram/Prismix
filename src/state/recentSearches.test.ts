// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { MusicItem } from '@/data/music/types';

const item = (id: string, kind: MusicItem['kind'] = 'song'): MusicItem => ({
  kind,
  id,
  title: id,
  subtitle: 'Song • Someone',
  artists: [{ name: 'Someone', id: null }],
  album: null,
  thumbnail: null,
  wide: false,
  durationSec: null,
  explicit: false,
});

/** A fresh copy of the module, as if the app had just started with [stored] in its storage. */
async function store(stored?: unknown) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem('prismix:recent-searches', JSON.stringify(stored));
  vi.resetModules();
  return import('./recentSearches');
}

describe('recent searches', () => {
  it('keeps songs, newest first, each once', async () => {
    const { useRecentSearches: recent } = await store();
    recent.getState().addSong(item('a'));
    recent.getState().addSong(item('b'));
    recent.getState().addSong(item('a'));
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps only songs and videos', async () => {
    const { useRecentSearches: recent } = await store();
    recent.getState().addSong(item('album', 'album'));
    recent.getState().addSong(item('artist', 'artist'));
    recent.getState().addSong(item('video', 'video'));
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['video']);
  });

  it('reads earlier lists, dropping the phrases and the pages', async () => {
    const { useRecentSearches: recent } = await store([
      'a phrase',
      { type: 'query', text: 'arijit' },
      { type: 'item', item: item('s1') },
      { type: 'item', item: item('al', 'album') },
      item('s2'),
      42,
      null,
      { type: 'item', item: { nope: true } },
    ]);
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['s1', 's2']);
  });

  it('forgets one song by its id, or all of them', async () => {
    const { useRecentSearches: recent } = await store();
    recent.getState().addSong(item('a'));
    recent.getState().addSong(item('b'));
    recent.getState().remove('a');
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['b']);
    recent.getState().clear();
    expect(recent.getState().recent).toEqual([]);
  });

  it('keeps at most twelve', async () => {
    const { useRecentSearches: recent } = await store();
    for (let i = 0; i < 15; i++) recent.getState().addSong(item(`s${i}`));
    expect(recent.getState().recent).toHaveLength(12);
  });

  it('notes a played song only while the search page shows it', async () => {
    const { useRecentSearches: recent, rememberSearchSongs, forgetSearchSongs, noteSongPlayed } = await store();
    noteSongPlayed('a');
    expect(recent.getState().recent).toEqual([]);
    rememberSearchSongs([item('a')]);
    noteSongPlayed('a');
    noteSongPlayed('other');
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['a']);
    forgetSearchSongs();
    noteSongPlayed('a');
    expect(recent.getState().recent).toHaveLength(1);
  });
});
