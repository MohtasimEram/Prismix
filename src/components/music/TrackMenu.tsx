import { Check, ChevronLeft, ChevronRight, Download, Link2, ListEnd, ListMinus, ListPlus, ListStart, MoreHorizontal, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import {
  useAddToPlaylist,
  useLikeStatus,
  usePlaylistOptions,
  useRemoveFromPlaylist,
  useSetLiked,
  useSignedIn,
} from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { copyText, musicShareUrl } from '@/lib/share';
import { downloadTrack } from '@/playback/download';
import { usePlayer } from '@/state/player';

function PlaylistChoices({ videoId, onDone, onBack }: { videoId: string; onDone: () => void; onBack: () => void }) {
  const options = usePlaylistOptions(videoId, true);
  const add = useAddToPlaylist();
  const remove = useRemoveFromPlaylist();
  return (
    <>
      <MenuItem icon={<ChevronLeft size={14} />} onSelect={onBack}>
        Back
      </MenuItem>
      <MenuSeparator />
      <MenuHeader>Add to Playlist</MenuHeader>
      {options.isPending && (
        <MenuItem disabled onSelect={() => {}}>
          Loading…
        </MenuItem>
      )}
      {options.isError && (
        <MenuItem disabled onSelect={() => {}}>
          Couldn’t load your playlists
        </MenuItem>
      )}
      {options.data?.length === 0 && (
        <MenuItem disabled onSelect={() => {}}>
          No playlists yet
        </MenuItem>
      )}
      {options.data?.map((option) => (
        <MenuItem
          key={option.playlistId}
          // Already in it: ticked, and selecting it takes the song out again.
          trailing={option.contains ? <Check size={14} className="text-green" aria-label="Added, select to remove" /> : undefined}
          onSelect={() => {
            if (option.contains) remove.mutate({ playlistId: option.playlistId, videoId });
            else add.mutate({ playlistId: option.playlistId, videoId });
            onDone();
          }}
        >
          {option.title}
        </MenuItem>
      ))}
    </>
  );
}

/** Favorite and Add to Playlist: the account's actions, signed in only. */
function AccountItems({ track, onClose, onPlaylists }: { track: Track; onClose: () => void; onPlaylists: () => void }) {
  const status = useLikeStatus(track.videoId);
  const setLiked = useSetLiked();
  const liked = status.data === 'LIKE';
  return (
    <>
      <MenuSeparator />
      <MenuItem
        icon={<Star size={15} fill={liked ? 'currentColor' : 'none'} />}
        disabled={status.isPending}
        onSelect={() => {
          setLiked.mutate({ videoId: track.videoId, liked: !liked });
          onClose();
        }}
      >
        {liked ? 'Unfavorite' : 'Favorite'}
      </MenuItem>
      <MenuItem icon={<ListPlus size={15} />} trailing={<ChevronRight size={14} />} onSelect={onPlaylists}>
        Add to Playlist
      </MenuItem>
    </>
  );
}

/**
 * Share: copies the song's YouTube Music link. The menu stays a moment to say it
 * did ("Link copied"), then closes.
 */
export function ShareItem({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <MenuItem
      icon={state === 'copied' ? <Check size={15} className="text-green" /> : <Link2 size={15} />}
      onSelect={() => {
        if (state !== 'idle') return;
        void copyText(musicShareUrl(videoId)).then((ok) => {
          setState(ok ? 'copied' : 'failed');
          timer.current = setTimeout(onClose, ok ? 900 : 1600);
        });
      }}
    >
      {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Couldn’t copy the link' : 'Share'}
    </MenuItem>
  );
}

function TrackMenuItems({ track, onClose, onRemove }: { track: Track; onClose: () => void; onRemove?: (() => void) | undefined }) {
  const [view, setView] = useState<'main' | 'playlists'>('main');
  const signedIn = useSignedIn();
  if (view === 'playlists') {
    return <PlaylistChoices videoId={track.videoId} onDone={onClose} onBack={() => setView('main')} />;
  }
  const { playNext, addToQueue } = usePlayer.getState();
  return (
    <>
      <MenuItem icon={<ListStart size={15} />} onSelect={() => (onClose(), playNext([track]))}>
        Play Next
      </MenuItem>
      <MenuItem icon={<ListEnd size={15} />} onSelect={() => (onClose(), addToQueue([track]))}>
        Add to Queue
      </MenuItem>
      {!track.unavailable && (
        <MenuItem icon={<Download size={15} />} onSelect={() => (onClose(), void downloadTrack(track))}>
          Download
        </MenuItem>
      )}
      <ShareItem videoId={track.videoId} onClose={onClose} />
      {signedIn && <AccountItems track={track} onClose={onClose} onPlaylists={() => setView('playlists')} />}
      {signedIn && onRemove && (
        <>
          <MenuSeparator />
          <MenuItem icon={<ListMinus size={15} />} onSelect={() => (onClose(), onRemove())}>
            Remove from Playlist
          </MenuItem>
        </>
      )}
    </>
  );
}

/**
 * The ⋯ button at the end of a track row (report §14): Play Next, Add to
 * Queue, Download and Share (copies the YouTube Music link) for everyone; Favorite and Add to Playlist signed in, and
 * Remove from Playlist where the list is one of the account's own playlists.
 */
export function TrackMenu({ track, className, onRemove }: { track: Track; className?: string; onRemove?: (() => void) | undefined }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      <button
        className={className}
        aria-label={`More options for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-open={anchor !== null || undefined}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : event.currentTarget);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} onClose={close} label={track.title}>
          <TrackMenuItems track={track} onClose={close} onRemove={onRemove} />
        </Menu>
      )}
    </>
  );
}
