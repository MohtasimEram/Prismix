import type { Track } from '@/data/music/types';
import type { QueueEntry } from '@/playback/queue/timeline';
import { getAudio, usePlayer, type NowPlaying } from './player';
import { KEEP_AFTER, KEEP_BEFORE, readSession, resumePosition, SESSION_KEY, SESSION_VERSION, type Saved } from './sessionData';

/**
 * Remembers the player between launches (the data checks are in sessionData.ts).
 * On launch the song comes back paused, with its place on the seek line and
 * in the queue; nothing is fetched until play is pressed, which then starts
 * it from where it stopped. Volume, shuffle and repeat are kept by the player
 * itself; tempo and pitch by the effects.
 */

/** Position is written this often while a song plays. */
const SAVE_EVERY_MS = 4000;

function hintOf(track: Track): NowPlaying {
  return {
    videoId: track.videoId,
    title: track.title,
    artist: track.artists.map((a) => a.name).join(', '),
    artworkUrl: track.thumbnail,
    durationSec: track.durationSec ?? 0,
    streamInfo: null,
  };
}

/** Puts the saved session back, paused. Does nothing if something is already queued. */
export function restoreSession(): boolean {
  const player = usePlayer.getState();
  if (player.nowPlaying || player.queue.length) return false;
  const saved = readSession();
  if (!saved) return false;
  const entry = saved.queue[saved.index];
  if (!entry) return false;
  usePlayer.setState({
    queue: saved.queue,
    index: saved.index,
    nowPlaying: hintOf(entry.track),
    status: 'paused',
    error: null,
    resumeAt: resumePosition(saved.positionSec, entry.track.durationSec ?? 0),
  });
  return true;
}

function save(): void {
  const { queue, index, nowPlaying, resumeAt } = usePlayer.getState();
  try {
    if (!nowPlaying || index < 0 || !queue[index]) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const from = Math.max(0, index - KEEP_BEFORE);
    const kept = queue.slice(from, index + 1 + KEEP_AFTER).map(({ entryId, track, tier, source }) => ({
      entryId,
      tier,
      source,
      // Without `unavailable`: a row still being matched when the app closed is looked up afresh, not restored half-done.
      track: { ...track, unavailable: undefined },
    }));
    const audio = getAudio();
    const saved: Saved = {
      v: SESSION_VERSION,
      queue: kept as QueueEntry[],
      index: index - from,
      positionSec: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : resumeAt,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the session just isn't kept this time.
  }
}

/**
 * Restores the last session once, then keeps it saved: when the queue or the
 * song changes, on pause and play, every few seconds while playing, and as
 * the window hides or closes. Returns its cleanup.
 */
export function startSessionMemory(): () => void {
  restoreSession();

  let queued: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (queued) clearTimeout(queued);
    queued = setTimeout(save, 400);
  };
  const unsubscribe = usePlayer.subscribe((state, previous) => {
    if (state.queue !== previous.queue || state.index !== previous.index || state.nowPlaying?.videoId !== previous.nowPlaying?.videoId || state.status !== previous.status || state.resumeAt !== previous.resumeAt) soon();
  });
  const timer = setInterval(() => {
    const { status } = usePlayer.getState();
    if (status === 'playing' || status === 'buffering') save();
  }, SAVE_EVERY_MS);
  const flush = () => save();
  const onHide = () => {
    if (document.visibilityState === 'hidden') save();
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', onHide);

  return () => {
    unsubscribe();
    clearInterval(timer);
    if (queued) clearTimeout(queued);
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('beforeunload', flush);
    document.removeEventListener('visibilitychange', onHide);
  };
}
