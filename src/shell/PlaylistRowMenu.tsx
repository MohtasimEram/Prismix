import { ListEnd, ListPlus, ListStart, Pin, PinOff, Play, Shuffle } from 'lucide-react';
import { Menu, MenuItem } from '@/components/Menu';
import { playList, shuffleList } from '@/components/music/play';
import { announceChange, loadPlaylistTracks } from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { useAddDialog } from '@/state/addDialog';
import { usePlayer } from '@/state/player';
import type { Pin as PinData } from '@/state/pins';

/** What a playlist row's menu does with a playlist's songs; they are read (every page) when one is chosen. */
export type PlaylistAction = 'play' | 'shuffle' | 'next' | 'queue';

/** Reads the playlist's songs and plays or queues them; [onBusy] is told while that takes a moment. */
export async function runPlaylistAction(action: PlaylistAction, pin: PinData, playlistId: string, onBusy: (busy: boolean) => void): Promise<void> {
  onBusy(true);
  try {
    const tracks: Track[] = (await loadPlaylistTracks(playlistId)).filter((t) => !t.unavailable);
    if (!tracks.length) {
      announceChange({ text: `“${pin.title}” has no songs to play`, cover: pin.thumbnail, tone: 'error' });
      return;
    }
    const source = { title: pin.title, type: 'playlist' as const, id: pin.key.replace(/^ytm:/, '') };
    const player = usePlayer.getState();
    if (action === 'play') playList(tracks, 0, { source });
    else if (action === 'shuffle') shuffleList(tracks, { source });
    else if (action === 'next') {
      player.playNext(tracks, source, { replacing: true });
      announceChange({ text: `Playing “${pin.title}” next`, cover: pin.thumbnail });
    } else {
      // Down to the end of what is coming up; a Play Next of the same playlist is taken out from under the playing song.
      player.addToQueue(tracks, source, { replacing: true, toEnd: true });
      announceChange({ text: `Added “${pin.title}” to the queue`, cover: pin.thumbnail });
    }
  } catch {
    announceChange({ text: `Couldn’t load “${pin.title}”`, cover: pin.thumbnail, tone: 'error' });
  } finally {
    onBusy(false);
  }
}

const half =
  'flex min-h-7 items-center gap-2 rounded-[5px] py-1 text-start type-body text-primary hover:bg-quinary focus-visible:bg-quinary';

/**
 * The ⋯ menu of a playlist in the sidebar. A YouTube Music playlist can be played (or shuffled, from the
 * button beside Play), pinned, queued next or last, and saved into another playlist; a Spotify one can only be pinned.
 */
export function PlaylistRowMenu({
  anchor,
  pin,
  pinned,
  playlistId,
  onClose,
  onTogglePin,
  onAction,
}: {
  anchor: HTMLElement;
  pin: PinData;
  pinned: boolean;
  /** The YouTube Music playlist behind the row; null for Spotify's, which can only be pinned. */
  playlistId: string | null;
  onClose: () => void;
  onTogglePin: () => void;
  onAction: (action: PlaylistAction) => void;
}) {
  const choose = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <Menu anchor={anchor} placement="below-start" onClose={onClose} label={pin.title}>
      {playlistId && (
        <div className="flex items-center gap-1">
          <button role="menuitem" className={`${half} min-w-0 flex-1 px-2`} onClick={choose(() => onAction('play'))}>
            <span className="inline-grid w-5 flex-none place-items-center text-secondary">
              <Play size={15} />
            </span>
            <span>Play</span>
          </button>
          <button
            role="menuitem"
            className={`${half} w-7 flex-none justify-center px-0 text-secondary hover:text-primary`}
            aria-label={`Shuffle ${pin.title}`}
            title="Shuffle"
            onClick={choose(() => onAction('shuffle'))}
          >
            <Shuffle size={15} />
          </button>
        </div>
      )}
      <MenuItem icon={pinned ? <PinOff size={15} /> : <Pin size={15} />} onSelect={choose(onTogglePin)}>
        {pinned ? 'Unpin' : 'Pin to top'}
      </MenuItem>
      {playlistId && (
        <>
          <MenuItem icon={<ListStart size={15} />} onSelect={choose(() => onAction('next'))}>
            Play Next
          </MenuItem>
          <MenuItem icon={<ListEnd size={15} />} onSelect={choose(() => onAction('queue'))}>
            Add to Queue
          </MenuItem>
          <MenuItem
            icon={<ListPlus size={15} />}
            onSelect={choose(() => {
              useAddDialog.getState().openPlaylist({
                playlistId,
                title: pin.title,
                thumbnail: pin.thumbnail,
              });
            })}
          >
            Save to Playlist
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
