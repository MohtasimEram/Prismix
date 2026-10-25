import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { DetectedExtension } from '@/bridge';
import { extensionQueryKey, useExtension } from '@/extension/useExtension';
import { useYtAuth, ytAuthSnapshot } from '@/extension/useYtAuth';
import { queryClient } from '@/lib/queryClient';
import {
  addToPlaylist,
  removeFromPlaylist,
  fetchAlbum,
  fetchArtist,
  fetchBrowse,
  fetchCategories,
  fetchDiscover,
  fetchExplore,
  fetchFollowed,
  fetchHome,
  fetchLibrary,
  fetchLibraryPlaylists,
  fetchLikeStatus,
  fetchPlaylist,
  fetchPlaylistOptions,
  playlistHasTrack,
  fetchSearch,
  fetchSuggestions,
  moveInPlaylist,
  setArtistFollowed,
  setListSaved,
  setTrackLiked,
  type LikeStatus,
  type Paged,
  type PlaylistOption,
} from './api';
import { moveBefore } from '@/lib/moveItem';
import { isLibrarySection, LIKED_MUSIC_PLAYLIST, type LibrarySection } from './library';
import type { AlbumPage, ArtistPage, BrowseLink, BrowsePage, HeaderInfo, PlaylistPage, Shelf, Track } from './types';

// TanStack Query for every browse request (prompt §1: caching, dedupe,
// retries). YouTube requests need the extension, so every query waits for it;
// pages render their install prompt instead when it's missing.

const STALE = 10 * 60_000;

export const albumQuery = (id: string) =>
  queryOptions({ queryKey: ['music', 'album', id], queryFn: () => fetchAlbum(id), staleTime: STALE });
export const artistQuery = (id: string) =>
  queryOptions({ queryKey: ['music', 'artist', id], queryFn: () => fetchArtist(id), staleTime: STALE });
export const exploreQuery = () =>
  queryOptions({ queryKey: ['music', 'explore'], queryFn: fetchExplore, staleTime: STALE });
export const categoriesQuery = () =>
  queryOptions({ queryKey: ['music', 'categories'], queryFn: fetchCategories, staleTime: 60 * 60_000 });
export const searchQuery = (query: string) =>
  queryOptions({ queryKey: ['music', 'search', query], queryFn: () => fetchSearch(query), staleTime: STALE });
export const browseQuery = (link: BrowseLink) =>
  queryOptions({ queryKey: ['music', 'browse', link.browseId, link.params], queryFn: () => fetchBrowse(link), staleTime: STALE });

type HomePageParam = (() => Promise<Paged<Shelf[]>>) | null;
export const homeQuery = () =>
  infiniteQueryOptions({
    queryKey: ['music', 'home'],
    queryFn: ({ pageParam }: { pageParam: HomePageParam }) => (pageParam ? pageParam() : fetchHome()),
    initialPageParam: null as HomePageParam,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: STALE,
  });

interface PlaylistChunk {
  header: PlaylistPage | null;
  tracks: Track[];
  next: (() => Promise<Paged<Track[]>>) | null;
}
type PlaylistPageParam = (() => Promise<Paged<Track[]>>) | null;
export const playlistQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: ['music', 'playlist', id],
    queryFn: async ({ pageParam }: { pageParam: PlaylistPageParam }): Promise<PlaylistChunk> => {
      if (pageParam) {
        const page = await pageParam();
        return { header: null, tracks: page.data, next: page.next };
      }
      const { page, more } = await fetchPlaylist(id);
      return { header: page, tracks: page.tracks, next: more };
    },
    initialPageParam: null as PlaylistPageParam,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: STALE,
  });

/** True once the extension has answered; queries wait on it. */
export function useYouTubeReady(): { ready: boolean; missing: boolean } {
  const extension = useExtension();
  return {
    ready: extension.state === 'present' && extension.extension.info.capabilities.includes('yt'),
    missing: extension.state === 'missing',
  };
}

export function useAlbum(id: string) {
  const { ready } = useYouTubeReady();
  return useQuery({ ...albumQuery(id), enabled: ready });
}
export function useArtist(id: string) {
  const { ready } = useYouTubeReady();
  return useQuery({ ...artistQuery(id), enabled: ready });
}
export function useExplore() {
  const { ready } = useYouTubeReady();
  return useQuery({ ...exploreQuery(), enabled: ready });
}
/** Discover: picks built from the library when signed in, else Explore. A refetch picks new seeds. */
export function useDiscover() {
  const { ready } = useYouTubeReady();
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: ['music', 'discover', signedIn],
    queryFn: () => fetchDiscover(signedIn),
    enabled: ready,
    staleTime: 30 * 60_000,
  });
}
export function useCategories() {
  const { ready } = useYouTubeReady();
  return useQuery({ ...categoriesQuery(), enabled: ready });
}
export function useSearch(query: string) {
  const { ready } = useYouTubeReady();
  return useQuery({ ...searchQuery(query), enabled: ready && query.trim().length > 0 });
}
export function useBrowse(link: BrowseLink) {
  const { ready } = useYouTubeReady();
  return useQuery({ ...browseQuery(link), enabled: ready });
}
export function useHome() {
  const { ready } = useYouTubeReady();
  return useInfiniteQuery({ ...homeQuery(), enabled: ready });
}
export function usePlaylist(id: string) {
  const { ready } = useYouTubeReady();
  return useInfiniteQuery({ ...playlistQuery(id), enabled: ready });
}

/** Typeahead: debounced, and anonymous like the app's (Innertube.searchTypeahead). */
export function useSuggestions(input: string) {
  const { ready } = useYouTubeReady();
  const [debounced, setDebounced] = useState(input);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input.trim()), 150);
    return () => clearTimeout(timer);
  }, [input]);
  return useQuery({
    queryKey: ['music', 'suggestions', debounced],
    queryFn: () => fetchSuggestions(debounced),
    enabled: ready && debounced.length > 0,
    staleTime: STALE,
    placeholderData: (previous) => previous,
  });
}

/** Warms the first query of a page, for links' hover/focus prefetch (prompt §3). */
export function prefetchPageData(pathname: string): void {
  const detected = queryClient.getQueryData<DetectedExtension | null>(extensionQueryKey);
  if (!detected?.info.capabilities.includes('yt')) return;
  const [, kind, id] = pathname.split('/');
  if (!id) {
    if (kind === 'home') void queryClient.prefetchInfiniteQuery(homeQuery());
    if (kind === 'new') void queryClient.prefetchQuery(exploreQuery());
    return;
  }
  const decoded = decodeURIComponent(id);
  if (kind === 'album') void queryClient.prefetchQuery(albumQuery(decoded));
  else if (kind === 'artist') void queryClient.prefetchQuery(artistQuery(decoded));
  else if (kind === 'playlist') void queryClient.prefetchInfiniteQuery(playlistQuery(decoded));
  else if (kind === 'library' && isLibrarySection(decoded) && ytAuthSnapshot().signedIn) {
    void queryClient.prefetchInfiniteQuery(libraryQuery(decoded));
  }
}

// ---- Signed in (prompt §5.3) ------------------------------------------------------

/** True when YouTube requests are made as the user (the extension reports a chosen channel). */
export function useSignedIn(): boolean {
  const auth = useYtAuth();
  return auth.state === 'ready' && auth.auth.signedIn;
}

type LibraryPageParam = (() => Promise<Paged<BrowsePage>>) | null;
export const libraryQuery = (section: LibrarySection) =>
  infiniteQueryOptions({
    queryKey: ['music', 'library', section],
    queryFn: ({ pageParam }: { pageParam: LibraryPageParam }) => (pageParam ? pageParam() : fetchLibrary(section)),
    initialPageParam: null as LibraryPageParam,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 2 * 60_000,
  });

export function useLibrary(section: LibrarySection) {
  const signedIn = useSignedIn();
  return useInfiniteQuery({ ...libraryQuery(section), enabled: signedIn });
}

/** The sidebar's playlist list. */
export function useLibraryPlaylists() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: ['music', 'library', 'sidebar-playlists'],
    queryFn: fetchLibraryPlaylists,
    enabled: signedIn,
    staleTime: 2 * 60_000,
  });
}

/** The artists the account follows and their latest releases (Home and Discover). */
export function useFollowed() {
  const signedIn = useSignedIn();
  const { ready } = useYouTubeReady();
  return useQuery({
    queryKey: ['music', 'followed'],
    queryFn: fetchFollowed,
    enabled: signedIn && ready,
    staleTime: 15 * 60_000,
  });
}

/** Follow or unfollow an artist, shown at once on their page and put back if YouTube refuses. */
export function useSetArtistFollowed() {
  const mark = (artistId: string, subscribed: boolean | null) =>
    queryClient.setQueryData<ArtistPage>(['music', 'artist', artistId], (page) => page && { ...page, subscribed });
  return useMutation({
    mutationFn: ({ channelId, followed }: { artistId: string; channelId: string; followed: boolean }) => setArtistFollowed(channelId, followed),
    onMutate: ({ artistId, followed }) => mark(artistId, followed),
    onError: (_error, { artistId, followed }) => mark(artistId, !followed),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['music', 'followed'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'library'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'discover'] });
    },
  });
}

const likeKey = (videoId: string) => ['music', 'like', videoId] as const;

export function useLikeStatus(videoId: string | null) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: likeKey(videoId ?? ''),
    queryFn: () => fetchLikeStatus(videoId!),
    enabled: signedIn && !!videoId,
    staleTime: 5 * 60_000,
  });
}

/** Like or unlike, shown at once and put back if YouTube refuses. */
export function useSetLiked() {
  return useMutation({
    mutationFn: ({ videoId, liked }: { videoId: string; liked: boolean }) => setTrackLiked(videoId, liked),
    onMutate: ({ videoId, liked }) => {
      const previous = queryClient.getQueryData<LikeStatus>(likeKey(videoId));
      queryClient.setQueryData<LikeStatus>(likeKey(videoId), liked ? 'LIKE' : 'INDIFFERENT');
      return { previous };
    },
    onError: (_error, { videoId }, context) => queryClient.setQueryData(likeKey(videoId), context?.previous),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['music', 'library', 'songs'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', LIKED_MUSIC_PLAYLIST] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', `VL${LIKED_MUSIC_PLAYLIST}`] });
    },
  });
}

/** Writes an album's or playlist's "in library" state into whichever cached page shows it. */
function markSaved(playlistId: string, saved: boolean) {
  const apply = <T extends { library: HeaderInfo['library'] }>(page: T | null | undefined): T | null | undefined =>
    page?.library?.playlistId === playlistId ? { ...page, library: { playlistId, saved } } : page;
  queryClient.setQueriesData<AlbumPage>({ queryKey: ['music', 'album'] }, (page) => apply(page) ?? undefined);
  queryClient.setQueriesData<InfiniteData<PlaylistChunk>>({ queryKey: ['music', 'playlist'] }, (data) =>
    data && { ...data, pages: data.pages.map((chunk) => ({ ...chunk, header: apply(chunk.header) ?? null })) },
  );
}

/** "Add to Library" on an album or playlist header. */
export function useSetListSaved() {
  return useMutation({
    mutationFn: ({ playlistId, saved }: { playlistId: string; saved: boolean }) => setListSaved(playlistId, saved),
    onMutate: ({ playlistId, saved }) => markSaved(playlistId, saved),
    onError: (_error, { playlistId, saved }) => markSaved(playlistId, !saved),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['music', 'library'] });
    },
  });
}

/** Songs added this session, as `playlist:video`: kept in case YouTube's own "already in" flag lags behind. */
const addedHere = new Set<string>();
const addedKey = (playlistId: string, videoId: string) => `${playlistId.replace(/^VL/, '')}:${videoId}`;

/** Songs taken out this session, same key: kept in case YouTube's flag still says they're in. Forgotten after a while. */
const removedHere = new Set<string>();
const REMOVED_MEMORY_MS = 2 * 60_000;
function markRemoved(key: string): void {
  removedHere.add(key);
  setTimeout(() => removedHere.delete(key), REMOVED_MEMORY_MS);
}

/** Whether a playlist's real contents include the song; checked per playlist so the list needn't wait for it. */
const hasKey = (playlistId: string, videoId: string) => ['music', 'playlist-has', bareId(playlistId), videoId] as const;
const bareId = (playlistId: string) => playlistId.replace(/^VL/, '');

export function usePlaylistOptions(videoId: string, enabled: boolean) {
  const signedIn = useSignedIn();
  const base = useQuery({
    queryKey: ['music', 'playlist-options', videoId],
    queryFn: () => fetchPlaylistOptions(videoId),
    enabled: signedIn && enabled,
    staleTime: 0,
  });
  // YouTube's flag misses songs added long ago: the playlists it calls empty are read, a few at a time.
  const unflagged = (base.data ?? []).filter((o) => !o.contains);
  const checks = useQueries({
    queries: unflagged.map((o) => ({
      queryKey: hasKey(o.playlistId, videoId),
      queryFn: () => playlistHasTrack(o.playlistId, videoId),
      enabled: signedIn && enabled,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const found = new Set<string>();
  unflagged.forEach((o, i) => {
    if (checks[i]?.data === true) found.add(bareId(o.playlistId));
  });
  const data = base.data?.map((o) => {
    const key = addedKey(o.playlistId, videoId);
    const contains = o.contains || found.has(bareId(o.playlistId));
    // Songs added or removed here stay as they were left, however often the panel is reopened.
    return { ...o, contains: (contains && !removedHere.has(key)) || addedHere.has(key) };
  });
  return { ...base, data };
}

/** Adds a song to a playlist once: a second try resolves 'duplicate' and changes nothing. */
export function useAddToPlaylist() {
  return useMutation({
    mutationFn: ({ playlistId, videoId }: { playlistId: string; videoId: string }) => addToPlaylist(playlistId, videoId),
    onSuccess: (_result, { playlistId, videoId }) => {
      addedHere.add(addedKey(playlistId, videoId));
      removedHere.delete(addedKey(playlistId, videoId));
      queryClient.setQueryData(hasKey(playlistId, videoId), true);
      queryClient.setQueryData<PlaylistOption[]>(['music', 'playlist-options', videoId], (options) =>
        options?.map((o) => (o.playlistId.replace(/^VL/, '') === playlistId.replace(/^VL/, '') ? { ...o, contains: true } : o)),
      );
    },
    onSettled: (_data, _error, { playlistId }) => {
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', playlistId] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', `VL${playlistId.replace(/^VL/, '')}`] });
    },
  });
}

/** Removes a song from one of the account's playlists; the page drops it at once and puts it back if that fails. */
/**
 * Reorders a song within a playlist: the list is rearranged on screen at once, and put back if
 * YouTube refuses. [tracks] is the list as shown; [from] and [before] index into it.
 */
export function useReorderPlaylist() {
  return useMutation({
    mutationFn: ({ playlistId, tracks, from, before }: { playlistId: string; tracks: Track[]; from: number; before: number }) => {
      const moving = tracks[from]?.setVideoId;
      if (!moving) throw new Error('This song can’t be moved');
      return moveInPlaylist(playlistId, moving, tracks[before]?.setVideoId ?? null);
    },
    onMutate: ({ playlistId, tracks, from, before }) => {
      const same = (key: readonly unknown[]) => typeof key[2] === 'string' && key[2].replace(/^VL/, '') === playlistId.replace(/^VL/, '');
      const filter = { queryKey: ['music', 'playlist'], predicate: (query: { queryKey: readonly unknown[] }) => same(query.queryKey) };
      const previous = queryClient.getQueriesData<InfiniteData<PlaylistChunk>>(filter);
      const reordered = moveBefore(tracks, from, before);
      queryClient.setQueriesData<InfiniteData<PlaylistChunk>>(filter, (data) => {
        if (!data) return data;
        // The same pages, refilled in the new order: each keeps the number of songs it had.
        let at = 0;
        return { ...data, pages: data.pages.map((page) => ({ ...page, tracks: reordered.slice(at, (at += page.tracks.length)) })) };
      });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
  });
}

export function useRemoveFromPlaylist() {
  return useMutation({
    mutationFn: ({ playlistId, videoId }: { playlistId: string; videoId: string }) => removeFromPlaylist(playlistId, videoId),
    onMutate: async ({ playlistId, videoId }) => {
      const same = (key: readonly unknown[]) => typeof key[2] === 'string' && key[2].replace(/^VL/, '') === playlistId.replace(/^VL/, '');
      const filter = { queryKey: ['music', 'playlist'], predicate: (query: { queryKey: readonly unknown[] }) => same(query.queryKey) };
      const before = queryClient.getQueriesData<InfiniteData<PlaylistChunk>>(filter);
      queryClient.setQueriesData<InfiniteData<PlaylistChunk>>(filter, (data) =>
        data && { ...data, pages: data.pages.map((page) => ({ ...page, tracks: page.tracks.filter((t) => t.videoId !== videoId) })) },
      );
      addedHere.delete(addedKey(playlistId, videoId));
      markRemoved(addedKey(playlistId, videoId));
      queryClient.setQueryData(hasKey(playlistId, videoId), false);
      // The playlist-options card drops its tick at once too.
      const optionsKey = ['music', 'playlist-options', videoId];
      const optionsBefore = queryClient.getQueryData<PlaylistOption[]>(optionsKey);
      queryClient.setQueryData<PlaylistOption[]>(optionsKey, (options) =>
        options?.map((o) => (o.playlistId.replace(/^VL/, '') === playlistId.replace(/^VL/, '') ? { ...o, contains: false } : o)),
      );
      return { before, optionsBefore };
    },
    onError: (_error, { playlistId, videoId }, context) => {
      for (const [key, data] of context?.before ?? []) queryClient.setQueryData(key, data);
      removedHere.delete(addedKey(playlistId, videoId));
      void queryClient.invalidateQueries({ queryKey: hasKey(playlistId, videoId) });
      if (context?.optionsBefore) queryClient.setQueryData(['music', 'playlist-options', videoId], context.optionsBefore);
    },
    onSettled: (_data, _error, { videoId }) => {
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist-options', videoId] });
    },
  });
}
