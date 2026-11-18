// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { MusicItem } from '@/data/music/types';

const item = (id: string, kind: MusicItem['kind'] = 'song'): MusicItem => ({
  kind,
  id,
  title: id,
  subtitle: `${kind} • Someone`,
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
    recent.getState().addItem(item('a'));
    recent.getState().addItem(item('b'));
    recent.getState().addItem(item('a'));
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps songs, videos, albums, and artists', async () => {
    const { useRecentSearches: recent } = await store();
    recent.getState().addItem(item('album', 'album'));
    recent.getState().addItem(item('artist', 'artist'));
    recent.getState().addItem(item('video', 'video'));
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['video', 'artist', 'album']);
  });

  it('reads earlier lists, dropping phrases and invalid items while keeping music items', async () => {
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
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['s1', 'al', 's2']);
  });

  it('forgets one item by its id, or all of them', async () => {
    const { useRecentSearches: recent } = await store();
    recent.getState().addItem(item('a'));
    recent.getState().addItem(item('b'));
    recent.getState().remove('a');
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['b']);
    recent.getState().clear();
    expect(recent.getState().recent).toEqual([]);
  });

  it('keeps at most twelve', async () => {
    const { useRecentSearches: recent } = await store();
    for (let i = 0; i < 15; i++) recent.getState().addItem(item(`s${i}`));
    expect(recent.getState().recent).toHaveLength(12);
  });

  it('notes a selected item only while the search page shows it', async () => {
    const { useRecentSearches: recent, rememberSearchItems, forgetSearchItems, noteItemSelected } = await store();
    noteItemSelected('a');
    expect(recent.getState().recent).toEqual([]);
    rememberSearchItems([item('a', 'album')]);
    noteItemSelected('a');
    noteItemSelected('other');
    expect(recent.getState().recent.map((e) => e.id)).toEqual(['a']);
    forgetSearchItems();
    noteItemSelected('a');
    expect(recent.getState().recent).toHaveLength(1);
  });
});
