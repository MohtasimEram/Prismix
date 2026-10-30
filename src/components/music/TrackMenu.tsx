import { Check, Disc, Link2, ListEnd, ListMinus, ListPlus, ListStart, MoreHorizontal, Play, Star, User, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Menu, MenuItem, MenuSeparator } from '@/components/Menu';
import { useLikeStatus, useSetLiked, useSignedIn } from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { copyText, musicShareUrl } from '@/lib/share';
import { useAddDialog } from '@/state/addDialog';
import { usePlayer } from '@/state/player';
import { albumPageFor, artistPageFor } from '@/shell/nowPlayingLinks';
import { CreditsDialog } from './CreditsDialog';

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

export interface TrackMenuItemsProps {
  track: Track;
  onClose: () => void;
  onOpenCredits: () => void;
  onPlayNow?: (() => void) | undefined;
  onPlayNext?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  removeLabel?: string;
}

export function TrackMenuItems({
  track,
  onClose,
  onOpenCredits,
  onPlayNow,
  onPlayNext,
  onRemove,
  removeLabel,
}: TrackMenuItemsProps) {
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const status = useLikeStatus(track.videoId);
  const setLiked = useSetLiked();
  const liked = status.data === 'LIKE';

  const { playNext, addToQueue } = usePlayer.getState();

  const go = (resolve: () => Promise<string>) => {
    onClose();
    void resolve().then(
      (to) => navigate(to),
      () => undefined,
    );
  };

  const primaryArtist = track.artists[0] ?? { name: 'Unknown Artist', id: null };
  const fallbackAlbumQuery = [track.title, track.artists.map((a) => a.name).join(' ')].filter(Boolean).join(' ');

  return (
    <>
      {onPlayNow && (
        <MenuItem
          icon={<Play size={15} />}
          onSelect={() => {
            onClose();
            onPlayNow();
          }}
        >
          Play Now
        </MenuItem>
      )}

      {/* 1. Play next */}
      <MenuItem
        icon={<ListStart size={15} />}
        onSelect={() => {
          onClose();
          if (onPlayNext) onPlayNext();
          else playNext([track]);
        }}
      >
        Play Next
      </MenuItem>

      {/* 2. Add to queue */}
      <MenuItem
        icon={<ListEnd size={15} />}
        onSelect={() => {
          onClose();
          addToQueue([track]);
        }}
      >
        Add to Queue
      </MenuItem>

      {/* 3. Favourite */}
      <MenuItem
        icon={<Star size={15} fill={liked ? 'currentColor' : 'none'} />}
        disabled={!signedIn || status.isPending}
        onSelect={() => {
          setLiked.mutate({ videoId: track.videoId, liked: !liked });
          onClose();
        }}
      >
        {liked ? 'Unfavourite' : 'Favourite'}
      </MenuItem>

      {/* 4. Go to artist */}
      <MenuItem
        icon={<User size={15} />}
        onSelect={() => go(() => artistPageFor(track.videoId, primaryArtist))}
      >
        Go to Artist
      </MenuItem>

      {/* 5. Go to album */}
      <MenuItem
        icon={<Disc size={15} />}
        onSelect={() => go(() => albumPageFor(track.videoId, track.album ?? null, fallbackAlbumQuery))}
      >
        Go to Album
      </MenuItem>

      {/* 6. View credits */}
      <MenuItem
        icon={<Users size={15} />}
        onSelect={() => {
          onClose();
          onOpenCredits();
        }}
      >
        View credits
      </MenuItem>

      {/* 7. Share */}
      <ShareItem videoId={track.videoId} onClose={onClose} />

      {/* 8. Save to playlist */}
      <MenuItem
        icon={<ListPlus size={15} />}
        onSelect={() => {
          onClose();
          useAddDialog.getState().open({
            videoId: track.videoId,
            title: track.title,
            artist: track.artists.map((a) => a.name).join(', '),
            thumbnail: track.thumbnail,
          });
        }}
      >
        Save to Playlist
      </MenuItem>

      {/* Optional contextual remove (e.g. from playlist or queue) */}
      {onRemove && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<ListMinus size={15} />}
            destructive
            onSelect={() => {
              onClose();
              onRemove();
            }}
          >
            {removeLabel ?? 'Remove from Playlist'}
          </MenuItem>
        </>
      )}
    </>
  );
}

export interface TrackMenuProps {
  track: Track;
  className?: string;
  placement?: 'below-start' | 'below-end' | 'above-start' | 'above-end';
  onPlayNow?: (() => void) | undefined;
  onPlayNext?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  removeLabel?: string;
}

/**
 * The ⋯ button on tracks across the app (Home shelves, Track lists, Queue):
 * Play Next, Add to Queue, Favourite, Go to Artist, Go to Album, View Credits, Share, Save to Playlist.
 */
export function TrackMenu({
  track,
  className,
  placement,
  onPlayNow,
  onPlayNext,
  onRemove,
  removeLabel,
}: TrackMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
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
        <Menu anchor={anchor} placement={placement} onClose={close} label={track.title}>
          <TrackMenuItems
            track={track}
            onClose={close}
            onOpenCredits={() => setCreditsOpen(true)}
            onPlayNow={onPlayNow}
            onPlayNext={onPlayNext}
            onRemove={onRemove}
            removeLabel={removeLabel}
          />
        </Menu>
      )}

      {creditsOpen && (
        <CreditsDialog
          videoId={track.videoId}
          title={track.title}
          artist={track.artists.map((a) => a.name).join(', ') || 'Unknown Artist'}
          album={track.album?.name ?? null}
          onClose={() => setCreditsOpen(false)}
        />
      )}
    </>
  );
}
