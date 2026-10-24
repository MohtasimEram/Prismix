import { Video, VideoOff } from 'lucide-react';
import { usePlayer } from '@/state/player';
import { useVideo, useWatchVideo } from '@/state/video';

/**
 * Switches between watching a track's video and just listening. Shown only
 * for a track that has a picture to offer; off by default, and while it is
 * off the picture is not streamed at all (playback/youtube/videoDeck.ts).
 */
export function WatchVideoButton({ className, size = 18 }: { className?: string; size?: number }) {
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? null);
  const offered = useVideo((s) => s.offered);
  const watch = useWatchVideo((s) => s.watch);
  const toggle = useWatchVideo((s) => s.toggle);
  if (!videoId || offered !== videoId) return null;
  return (
    <button
      className={className}
      aria-label={watch ? 'Stop watching the video' : 'Watch the video'}
      aria-pressed={watch}
      title={watch ? 'Listen only' : 'Watch the video'}
      onClick={toggle}
    >
      {watch ? <Video size={size} strokeWidth={2.2} /> : <VideoOff size={size} strokeWidth={2.2} />}
    </button>
  );
}
