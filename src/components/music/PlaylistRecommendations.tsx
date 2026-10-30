import { Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { PlayIcon } from '@/components/icons/Transport';
import { useAddToPlaylist, usePlaylistRecommendations, useSignedIn } from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { useAddDialog } from '@/state/addDialog';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { albumHref, artistHref } from './links';
import { playTrack } from './play';

const SHOWN = 10;

interface Props {
  playlistId: string;
  /** The playlist's own title, for the "Added to …" notice. */
  playlistTitle: string;
  /** What the playlist holds now: those songs are never suggested, and a few seed the suggestions. */
  tracks: Track[];
  /** The account's own playlist: Add puts the song straight in. Otherwise Add opens the Add to Playlist window. */
  editable: boolean;
}

function RecommendedRow({ track, editable, adding, onAdd }: { track: Track; editable: boolean; adding: boolean; onAdd: () => void }) {
  const album = track.album;
  const albumLink = album ? albumHref(album.id) : null;
  return (
    <div className="group/rec grid h-[54px] grid-cols-[minmax(0,36.5fr)_minmax(0,25.25fr)_minmax(0,25.25fr)_minmax(0,13fr)] items-center rounded-[12px] hover:bg-tracklist-hover max-md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex h-full min-w-0 items-center gap-3">
        <div className="relative ms-[7px] grid w-10 shrink-0 place-items-center">
          <Artwork src={track.thumbnail} displayWidth={40} radius="var(--radius-artwork-small)" />
          <button
            className="absolute inset-0 grid place-items-center rounded-artwork-sm bg-lockup-hover text-white opacity-0 group-hover/rec:opacity-100 focus-visible:opacity-100"
            aria-label={`Play ${track.title}`}
            onClick={() => playTrack(track)}
          >
            <PlayIcon size={18} />
          </button>
        </div>
        <div className="flex min-w-0 items-center">
          <span className="truncate type-body text-primary">{track.title}</span>
          {track.explicit && <ExplicitBadge />}
        </div>
      </div>
      <div className="flex h-full min-w-0 items-center pe-2.5 max-md:hidden">
        <span className="truncate type-body">
          {track.artists.map((artist, i) => {
            const href = artistHref(artist.id);
            return (
              <span key={`${artist.name}-${i}`}>
                {i > 0 && ', '}
                {href ? (
                  <PrefetchLink to={href} className="text-inherit hover:underline">
                    {artist.name}
                  </PrefetchLink>
                ) : (
                  artist.name
                )}
              </span>
            );
          })}
        </span>
      </div>
      <div className="flex h-full min-w-0 items-center pe-4 max-md:hidden">
        <span className="truncate type-body">
          {album &&
            (albumLink ? (
              <PrefetchLink to={albumLink} className="text-inherit hover:underline">
                {album.name}
              </PrefetchLink>
            ) : (
              album.name
            ))}
        </span>
      </div>
      <div className="flex h-full items-center justify-end pe-3">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-pill border-[0.75px] border-quaternary px-3 type-callout-emphasized text-primary hover:bg-quaternary disabled:opacity-50"
          disabled={adding}
          aria-label={`${editable ? 'Add' : 'Add to a playlist'}: ${track.title}`}
          onClick={onAdd}
        >
          <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

/**
 * "Recommended songs" under a playlist: songs in the spirit of what it holds (the radios of a
 * few of its own songs), each with an Add button. Refresh asks again with other seeds.
 */
export function PlaylistRecommendations({ playlistId, playlistTitle, tracks, editable }: Props) {
  const signedIn = useSignedIn();
  const [round, setRound] = useState(0);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const recommendations = usePlaylistRecommendations(playlistId, tracks, tracks.length > 0, round);
  const add = useAddToPlaylist();

  const inPlaylist = useMemo(() => new Set(tracks.map((t) => t.videoId)), [tracks]);
  const shown = useMemo(
    () => (recommendations.data ?? []).filter((t) => !inPlaylist.has(t.videoId) && !added.has(t.videoId)).slice(0, SHOWN),
    [recommendations.data, inPlaylist, added],
  );

  if (!signedIn || tracks.length === 0) return null;
  // Nothing to suggest, and nothing wrong: say nothing rather than leave an empty heading.
  if (!recommendations.isPending && !recommendations.isError && shown.length === 0 && !recommendations.isFetching) return null;

  const refresh = () => {
    setAdded(new Set());
    setRound((n) => n + 1);
  };

  const onAdd = (track: Track) => {
    if (!editable) {
      useAddDialog.getState().open({
        videoId: track.videoId,
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', '),
        thumbnail: track.thumbnail,
      });
      return;
    }
    setAdding((s) => new Set(s).add(track.videoId));
    add.mutate(
      { playlistId, videoId: track.videoId, title: playlistTitle },
      {
        onSuccess: () => setAdded((s) => new Set(s).add(track.videoId)),
        onSettled: () =>
          setAdding((s) => {
            const next = new Set(s);
            next.delete(track.videoId);
            return next;
          }),
      },
    );
  };

  return (
    <section className="mx-(--body-gutter) mt-8" aria-label="Recommended songs">
      <div className="flex items-end justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h2 className="type-title-2-emphasized text-primary">Recommended songs</h2>
          <p className="type-callout text-secondary">Based on what’s in this playlist</p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 flex-none items-center gap-1.5 rounded-pill px-3 type-callout-emphasized text-secondary hover:bg-quaternary hover:text-primary disabled:opacity-50"
          disabled={recommendations.isFetching}
          onClick={refresh}
        >
          <RefreshCw size={13} strokeWidth={2.4} className={recommendations.isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
          Refresh
        </button>
      </div>
      {recommendations.isPending && (
        <div className="flex flex-col" aria-busy="true" aria-label="Loading recommended songs">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex h-[54px] items-center gap-3 ps-[7px]">
              <span className="size-10 flex-none animate-shimmer rounded-artwork-sm bg-skeleton" />
              <span className="h-3 w-1/3 animate-shimmer rounded-full bg-skeleton" />
            </div>
          ))}
        </div>
      )}
      {recommendations.isError && (
        <p className="py-3 type-callout text-secondary">
          Couldn’t load suggestions.{' '}
          <button type="button" className="text-key hover:underline" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {shown.map((track) => (
        <RecommendedRow key={track.videoId} track={track} editable={editable} adding={adding.has(track.videoId)} onAdd={() => onAdd(track)} />
      ))}
    </section>
  );
}
