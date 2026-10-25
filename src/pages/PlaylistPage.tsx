import { useCallback, useEffect } from 'react';
import { useParams } from 'react-router';
import { DetailHeader } from '@/components/music/DetailHeader';
import { playList, shuffleList } from '@/components/music/play';
import { DownloadAllButton } from '@/components/music/DownloadAllButton';
import { PinButton } from '@/components/music/PinButton';
import { LoadError, LoadMoreError, NeedsExtension } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { LIKED_MUSIC_PLAYLIST } from '@/data/music/library';
import { useLibraryPlaylists, usePlaylist, useRemoveFromPlaylist, useReorderPlaylist, useYouTubeReady } from '@/data/music/queries';
import { ytmPinKey } from '@/state/pins';
import { useArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { PlaylistSkeleton } from '@/skeletons/PageSkeletons';
import { detailFooter } from './pageStyles';

/** A playlist (report §14): header, then the full track list loaded eagerly. */
export default function PlaylistPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const playlist = usePlaylist(id);
  const header = playlist.data?.pages[0]?.header ?? null;
  // Only the account's own playlists can lose a song (Liked Music is un-liked, not edited).
  const mine = useLibraryPlaylists();
  const bare = id.replace(/^VL/, '');
  const editable = bare !== LIKED_MUSIC_PLAYLIST.replace(/^VL/, '') && (mine.data ?? []).some((p) => p.id.replace(/^VL/, '') === bare);
  const remove = useRemoveFromPlaylist();
  const reorder = useReorderPlaylist();
  usePageTint(useArtworkColor(header?.thumbnail));

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = playlist;

  // Eagerly fetch every page so the whole playlist is available at once and the
  // scrollbar reflects the full length (Spotify-style one-shot loading).
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // Still call onNearEnd as a safety net for virtualiser scroll (no-op once all loaded).
  const onNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (missing) return <NeedsExtension />;
  if (playlist.isError && !playlist.data) return <LoadError error={playlist.error} onRetry={() => void playlist.refetch()} />;
  if (!playlist.data || !header) return <PlaylistSkeleton />;

  const tracks = playlist.data.pages.flatMap((page) => page.tracks);
  const context = { source: { title: header.title, type: 'playlist' as const, id } };
  // Rows can be dragged into a new order on the account's own playlists, once every song is loaded
  // and each row carries the id YouTube needs to move it.
  const canReorder = editable && !hasNextPage && tracks.length > 1 && tracks.every((t) => !!t.setVideoId);
  return (
    <>
      <DetailHeader
        info={header}
        canPlay={tracks.length > 0}
        onPlay={() => playList(tracks, 0, context)}
        onShuffle={() => shuffleList(tracks, context)}
        extra={
          <>
            <DownloadAllButton tracks={tracks} label={header.title} />
            <PinButton pin={{ key: ytmPinKey(id), title: header.title, thumbnail: header.thumbnail, href: `/playlist/${encodeURIComponent(id)}` }} />
          </>
        }
      />
      <TrackList
        tracks={tracks}
        variant="playlist"
        onNearEnd={onNearEnd}
        source={context.source}
        onRemove={editable ? (track) => remove.mutate({ playlistId: id, videoId: track.videoId }) : undefined}
        onReorder={canReorder ? (from, before) => reorder.mutate({ playlistId: id, tracks, from, before }) : undefined}
      />
      {isFetchingNextPage && <div className="flex justify-center py-5 type-callout text-secondary">Loading more songs…</div>}
      {playlist.isFetchNextPageError && <LoadMoreError onRetry={() => void fetchNextPage()} />}
      <footer className={detailFooter}>
        <p>{header.meta}</p>
      </footer>
    </>
  );
}
