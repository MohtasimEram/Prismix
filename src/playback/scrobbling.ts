import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getAudio, usePlayer } from '@/state/player';
import { countsAsListen, primaryArtist } from './scrobbleRules';
import { trackLog } from './trackLog';

/**
 * ListenBrainz scrobbling, ported from the phone's ListenBrainzManager.kt and
 * ScrobbleManager: a "playing now" ping when a song starts, and one listen
 * once it has played for half its length or four minutes (whichever comes
 * first), and at least 30 seconds. Needs the user token from
 * listenbrainz.org/settings. Best effort: nothing here touches playback.
 */

const API = 'https://api.listenbrainz.org/1';
/** ListenBrainz refuses listens stamped before this (the phone's MIN_LISTEN_TS). */
const MIN_LISTEN_TS = 1033430400;

export const useScrobbling = create<{
  enabled: boolean;
  token: string;
  primaryArtistOnly: boolean;
  setEnabled: (on: boolean) => void;
  setToken: (token: string) => void;
  setPrimaryArtistOnly: (on: boolean) => void;
}>()(
  persist(
    (set) => ({
      enabled: false,
      token: '',
      primaryArtistOnly: false,
      setEnabled: (enabled) => set({ enabled }),
      setToken: (token) => set({ token: token.trim() }),
      setPrimaryArtistOnly: (primaryArtistOnly) => set({ primaryArtistOnly }),
    }),
    { name: 'prismix:scrobbling', version: 1 },
  ),
);

interface Song {
  title: string;
  artist: string;
  album: string | null;
  durationSec: number;
}

function metadata(song: Song, primaryOnly: boolean, extra: Record<string, unknown>) {
  const info: Record<string, unknown> = { submission_client: 'Prismix', ...extra };
  // The API rejects a zero or negative duration; it is optional, so only a known one is sent.
  if (song.durationSec > 0) info.duration_ms = Math.round(song.durationSec * 1000);
  const meta: Record<string, unknown> = {
    artist_name: primaryOnly ? primaryArtist(song.artist) : song.artist,
    track_name: song.title,
    additional_info: info,
  };
  if (song.album) meta.release_name = song.album;
  return meta;
}

async function submit(token: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(`${API}/submit-listens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) trackLog.w(`ListenBrainz refused the submission (HTTP ${response.status})`);
    return response.ok;
  } catch (error) {
    trackLog.w(`ListenBrainz submission failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Settings › Scrobbling: checks a token with ListenBrainz; the user name when it is valid. */
export async function validateToken(token: string): Promise<{ valid: boolean; user: string | null }> {
  try {
    const response = await fetch(`${API}/validate-token`, { headers: { Authorization: `Token ${token}` } });
    if (!response.ok) return { valid: false, user: null };
    const data = (await response.json()) as { valid?: boolean; user_name?: string };
    return { valid: !!data.valid, user: data.user_name ?? null };
  } catch {
    return { valid: false, user: null };
  }
}

function startScrobbler(): () => void {
  interface Session {
    videoId: string;
    startedAt: number;
    heardSec: number;
    announced: boolean;
    sent: boolean;
  }
  let session: Session | null = null;
  let last = 0;

  const song = (): Song | null => {
    const { nowPlaying: np, queue, index } = usePlayer.getState();
    if (!np) return null;
    const audio = getAudio();
    const durationSec = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : np.durationSec;
    return { title: np.title, artist: np.artist, album: queue[index]?.track.album?.name ?? null, durationSec };
  };

  const tick = () => {
    const { status, nowPlaying: np } = usePlayer.getState();
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    last = now;
    if (!np || np.videoId.length === 0) return;
    if (!session || session.videoId !== np.videoId) {
      session = { videoId: np.videoId, startedAt: Math.floor(Date.now() / 1000), heardSec: 0, announced: false, sent: false };
    }
    if (status !== 'playing') return;
    // A long gap (the machine slept) isn't listening.
    session.heardSec += Math.min(elapsed, 2);
    const { token, primaryArtistOnly } = useScrobbling.getState();
    const current = song();
    if (!token || !current) return;
    if (!session.announced) {
      session.announced = true;
      const audio = getAudio();
      void submit(token, {
        listen_type: 'playing_now',
        payload: [{ track_metadata: metadata(current, primaryArtistOnly, { position_ms: Math.round((audio?.currentTime ?? 0) * 1000) }) }],
      });
    }
    if (!session.sent && countsAsListen(session.heardSec, current.durationSec)) {
      session.sent = true;
      const startedAt = Math.max(session.startedAt, MIN_LISTEN_TS);
      void submit(token, {
        listen_type: 'single',
        payload: [
          {
            listened_at: startedAt,
            track_metadata: metadata(current, primaryArtistOnly, {
              start_ms: startedAt * 1000,
              end_ms: Date.now(),
            }),
          },
        ],
      });
    }
  };

  last = performance.now();
  const timer = setInterval(tick, 1000);
  // A song played again straight away (repeat one) is a new listen.
  let audio: HTMLMediaElement | null = null;
  const onEnded = () => {
    session = null;
  };
  const bindAudio = () => {
    audio?.removeEventListener('ended', onEnded);
    audio = getAudio();
    audio?.addEventListener('ended', onEnded);
  };
  bindAudio();
  const off = usePlayer.subscribe((state, before) => {
    if (state.deck !== before.deck) bindAudio();
  });
  return () => {
    clearInterval(timer);
    off();
    audio?.removeEventListener('ended', onEnded);
  };
}

/** Mounted once in the shell: scrobbles while it is on and a token is set. */
export function useScrobbler(): void {
  const active = useScrobbling((s) => s.enabled && s.token.length > 0);
  useEffect(() => (active ? startScrobbler() : undefined), [active]);
}
