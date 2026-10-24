import { asEntry, type QueueEntry, type QueueSource, type QueueSourceType, type QueueTier } from '@/playback/queue/timeline';
import type { ArtistRef, Track } from '@/data/music/types';
import { isVideoId } from './dragTrack';

/**
 * Remembers the player between launches: the queue, the song that was
 * playing and where it stopped. (Volume, shuffle and repeat are kept by the
 * player itself; tempo and pitch by the effects.)
 *
 * On launch the song comes back paused, with its place on the seek line and
 * in the queue; nothing is fetched until play is pressed, which then starts
 * it from where it stopped. What is read back is checked field by field, as
 * the store is only ever as trustworthy as whatever last wrote to it.
 */

export const SESSION_KEY = 'prismix:session';
export const SESSION_VERSION = 1;
/** How much of the queue is kept: what played just before, and what comes next. */
export const KEEP_BEFORE = 20;
export const KEEP_AFTER = 150;
/** A song stopped this close to its start or end comes back from the beginning. */
const NEAR_EDGE_SEC = 3;

export interface Saved {
  v: number;
  queue: QueueEntry[];
  /** The playing entry within `queue`. */
  index: number;
  positionSec: number;
}

const TIERS: QueueTier[] = ['context', 'user', 'autoplay'];
const SOURCE_TYPES: QueueSourceType[] = ['album', 'playlist', 'artist', 'library', 'search', 'home', 'radio', 'queue', 'other'];

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const nullableText = (value: unknown, max: number): string | null => (typeof value === 'string' && value ? value.slice(0, max) : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
/** Artwork is shown from https only; anything else read back is dropped. */
const imageUrl = (value: unknown): string | null => (typeof value === 'string' && /^https:\/\//i.test(value) && value.length < 2048 ? value : null);

function cleanTrack(raw: unknown): Track | null {
  const t = raw as Partial<Track> | null;
  if (!t || typeof t !== 'object' || !isVideoId(t.videoId)) return null;
  const artists = Array.isArray(t.artists)
    ? t.artists
        .filter((a): a is ArtistRef => !!a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string')
        .slice(0, 20)
        .map((a): ArtistRef => ({ name: text(a.name, 200), id: nullableText(a.id, 100) }))
    : [];
  const album = t.album && typeof t.album === 'object' && typeof t.album.name === 'string' ? { name: text(t.album.name, 300), id: nullableText(t.album.id, 100) } : null;
  return {
    videoId: t.videoId,
    title: text(t.title, 300),
    artists,
    album,
    durationSec: num(t.durationSec),
    explicit: t.explicit === true,
    thumbnail: imageUrl(t.thumbnail),
    index: num(t.index),
    plays: nullableText(t.plays, 60),
  } as Track;
}

function cleanSource(raw: unknown): QueueSource | null {
  const s = raw as Partial<QueueSource> | null;
  if (!s || typeof s !== 'object' || typeof s.title !== 'string') return null;
  const type = SOURCE_TYPES.includes(s.type as QueueSourceType) ? (s.type as QueueSourceType) : 'other';
  return { title: text(s.title, 200), type, id: nullableText(s.id, 200) };
}

/** The saved session, validated; null when there is none or it can't be trusted. */
export function readSession(storage: Pick<Storage, 'getItem'> = localStorage): Saved | null {
  try {
    const raw = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw || raw.v !== SESSION_VERSION || !Array.isArray(raw.queue) || typeof raw.index !== 'number') return null;
    const queue: QueueEntry[] = [];
    let index = -1;
    raw.queue.slice(0, KEEP_BEFORE + KEEP_AFTER + 1).forEach((item, at) => {
      const e = item as Partial<QueueEntry> | null;
      const track = cleanTrack(e?.track);
      if (!track) return;
      if (at === raw.index) index = queue.length;
      const tier = TIERS.includes(e?.tier as QueueTier) ? (e!.tier as QueueTier) : 'context';
      queue.push(asEntry(track, tier, cleanSource(e?.source), typeof e?.entryId === 'string' ? e.entryId.slice(0, 80) : undefined));
    });
    // The playing song itself must have survived the check.
    if (index < 0) return null;
    return { v: SESSION_VERSION, queue, index, positionSec: num(raw.positionSec) ?? 0 };
  } catch {
    return null;
  }
}

/** A position worth resuming from: not the first seconds, not the last. */
export function resumePosition(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec) || positionSec < NEAR_EDGE_SEC) return 0;
  if (durationSec > 0 && positionSec > durationSec - NEAR_EDGE_SEC) return 0;
  return Math.floor(positionSec);
}

