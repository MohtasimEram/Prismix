import { ListPlus } from 'lucide-react';
import { useSignedIn } from '@/data/music/queries';
import { useAddDialog } from '@/state/addDialog';
import { isVideoId } from '@/state/dragTrack';
import { usePlayer } from '@/state/player';

/**
 * The player bar's Add to Playlist: opens the Add to Playlist window for the playing song
 * (components/music/AddToPlaylistDialog.tsx). Shown signed in only, as the track menu's is.
 */
export function AddToPlaylistButton({ videoId, className }: { videoId: string | null; className?: string }) {
  const signedIn = useSignedIn();
  if (!signedIn || !isVideoId(videoId)) return null;
  return (
    <button
      className={className}
      aria-label="Add to Playlist"
      aria-haspopup="dialog"
      title="Add to Playlist"
      onClick={() => {
        const now = usePlayer.getState().nowPlaying;
        useAddDialog.getState().open({
          videoId,
          title: now?.videoId === videoId ? now.title : '',
          artist: now?.videoId === videoId ? now.artist : '',
          thumbnail: now?.videoId === videoId ? now.artworkUrl : null,
        });
      }}
    >
      <ListPlus size={18} strokeWidth={2.2} />
    </button>
  );
}
