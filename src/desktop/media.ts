import { getAudio, usePlayer } from '@/state/player';
import { mediaGate } from './mediaGate';
import { invoke, isDesktop, onNative } from './tauri';

/**
 * Tray menu and global media keys (src-tauri/src/tray.rs, shortcuts.rs) arrive
 * as `media://command`. They go through the store like any other press so a
 * Listen Together party hears about them.
 */
type MediaCommand = 'play-pause' | 'play' | 'pause' | 'next' | 'previous' | 'stop';

function run(command: MediaCommand): void {
  const player = usePlayer.getState();
  const paused = getAudio()?.paused ?? true;
  switch (command) {
    case 'play-pause':
      if (mediaGate('toggle')) player.togglePlay();
      break;
    case 'play':
      if (paused && mediaGate('toggle')) player.togglePlay();
      break;
    case 'pause':
    case 'stop':
      if (!paused && mediaGate('toggle')) player.togglePlay();
      break;
    case 'next':
      if (mediaGate('next')) player.next();
      break;
    case 'previous':
      if (mediaGate('previous')) player.previous();
      break;
  }
}

let started = false;

export function startDesktopMedia(): void {
  if (started || !isDesktop()) return;
  started = true;
  onNative<MediaCommand>('media://command', run);

  // Keep the tray tooltip / menu label in step with what's playing.
  let lastKey = '';
  const sync = () => {
    const { nowPlaying } = usePlayer.getState();
    const playing = getAudio()?.paused === false;
    const title = nowPlaying ? `${nowPlaying.title} — ${nowPlaying.artist}`.slice(0, 120) : null;
    const key = `${title}|${playing}`;
    if (key === lastKey) return;
    lastKey = key;
    void invoke('tray_set_now_playing', { title, playing }).catch(() => undefined);
  };
  usePlayer.subscribe(sync);
  setInterval(sync, 1500);
}
