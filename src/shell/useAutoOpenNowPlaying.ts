import { useEffect } from 'react';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';

/**
 * Every time a song starts playing, the Now Playing panel opens, unless some panel is open already (Up Next
 * or Lyrics stay as the listener left them), Now Playing was hidden on purpose, or the window is too narrow for a side panel.
 */
export function useAutoOpenNowPlaying(): void {
  useEffect(() => {
    let last: string | null = null;
    const check = () => {
      const { status, nowPlaying } = usePlayer.getState();
      if ((status !== 'playing' && status !== 'buffering') || !nowPlaying) return;
      if (nowPlaying.videoId === last) return;
      last = nowPlaying.videoId;
      const ui = useUi.getState();
      // Hidden on purpose (the hide button): it stays a strip until the listener opens it.
      if (ui.sidePanel === null && !ui.nowPlayingHidden && window.innerWidth >= 640) ui.setSidePanel('now-playing');
    };
    check();
    return usePlayer.subscribe(check);
  }, []);
}
