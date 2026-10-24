import { create } from 'zustand';
import { getAudio, usePlayer } from '@/state/player';

/** Pause after a while, or when the current track finishes. */
type Mode = { kind: 'off' } | { kind: 'at'; endsAt: number } | { kind: 'end-of-track'; videoId: string | null };

interface SleepTimerState {
  mode: Mode;
  /** Minutes from now; 0 turns it off. */
  start: (minutes: number) => void;
  endOfTrack: () => void;
  cancel: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function pauseNow(): void {
  if (getAudio()?.paused === false) usePlayer.getState().togglePlay();
  useSleepTimer.setState({ mode: { kind: 'off' } });
}

export const useSleepTimer = create<SleepTimerState>()((set) => ({
  mode: { kind: 'off' },
  start: (minutes) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!(minutes > 0)) return set({ mode: { kind: 'off' } });
    const ms = Math.min(minutes, 24 * 60) * 60_000;
    timer = setTimeout(pauseNow, ms);
    set({ mode: { kind: 'at', endsAt: Date.now() + ms } });
  },
  endOfTrack: () => {
    if (timer) clearTimeout(timer);
    timer = null;
    set({ mode: { kind: 'end-of-track', videoId: usePlayer.getState().nowPlaying?.videoId ?? null } });
  },
  cancel: () => {
    if (timer) clearTimeout(timer);
    timer = null;
    set({ mode: { kind: 'off' } });
  },
}));

// "End of track": the moment the player moves on, stop.
usePlayer.subscribe((state, previous) => {
  const { mode } = useSleepTimer.getState();
  if (mode.kind !== 'end-of-track') return;
  const now = state.nowPlaying?.videoId ?? null;
  if (now !== (previous.nowPlaying?.videoId ?? null) && now !== mode.videoId) {
    // Let the new track's play() settle first, then pause it at 0:00.
    setTimeout(pauseNow, 50);
  }
});
