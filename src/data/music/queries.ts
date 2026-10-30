import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DetectedExtension } from '@/bridge';
import { extensionQueryKey, useExtension } from '@/extension/useExtension';
import { useYtAuth, ytAuthSnapshot } from '@/extension/useYtAuth';
import { forgetPrivatePlaylist, rememberPrivatePlaylist } from '@/lib/privatePlaylists';
import { queryClient } from '@/lib/queryClient';
import { notify } from '@/state/notices';
import { isVideoId } from '@/state/dragTrack';
import {
  addPlaylistToPlaylist,
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  removePlaylistFromPlaylist,
  noteCreatedPlaylist,
  noteDeletedPlaylist,
  setPlaylistPrivacy,
  removeFromPlaylist,
  fetchAllLibraryPlaylists,
  fetchPlaylistRecommendations,
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
  fetchTrackCredits,
  forgetPlaylistContents,
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
  type TrackCredits,
  type TrackCreditSection,
} from './api';
import { moveBefore } from '@/lib/moveItem';
import { isLibrarySection, LIKED_MUSIC_PLAYLIST, type LibrarySection } from './library';
import type { AlbumPage, ArtistPage, BrowseLink, BrowsePage, HeaderInfo, MusicItem, PlaylistPage, Shelf, Track } from './types';

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
      const liked = id.replace(/^VL/, '') === LIKED_MUSIC_PLAYLIST;
      if (pageParam) {
        const page = await pageParam();
        // Every song of Liked Music is a liked song: its star must say so.
        if (liked) noteLikedTracks(page.data.map((t) => t.videoId));
        return { header: null, tracks: page.data, next: page.next };
      }
      const { page, more } = await fetchPlaylist(id);
      if (liked) noteLikedTracks(page.tracks.map((t) => t.videoId));
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
    queryFn: async ({ pageParam }: { pageParam: LibraryPageParam }) => {
      const page = await (pageParam ? pageParam() : fetchLibrary(section));
      // The Songs page is the liked songs: each is a favourite.
      if (section === 'songs') noteLikedTracks(page.data.tracks.map((t) => t.videoId));
      return page;
    },
    initialPageParam: null as LibraryPageParam,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 2 * 60_000,
  });

export function useLibrary(section: LibrarySection) {
  const signedIn = useSignedIn();
  return useInfiniteQuery({ ...libraryQuery(section), enabled: signedIn });
}

const SIDEBAR_PLAYLISTS_KEY = ['music', 'library', 'sidebar-playlists'] as const;

/** The sidebar's playlist list. */
export function useLibraryPlaylists() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: SIDEBAR_PLAYLISTS_KEY,
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

/** Songs unliked a moment ago: a Liked Music page read before YouTube caught up must not bring their star back. */
const unlikedHere = new Map<string, number>();
const RECENT_UNLIKE_MS = 2 * 60_000;

/** Marks songs known to be in Liked Music as favourites, whatever a per-song read said before. */
export function noteLikedTracks(videoIds: string[]): void {
  const now = Date.now();
  for (const id of videoIds) {
    const unliked = unlikedHere.get(id);
    if (unliked !== undefined && now - unliked < RECENT_UNLIKE_MS) continue;
    if (queryClient.getQueryData<LikeStatus>(likeKey(id)) !== 'LIKE') queryClient.setQueryData<LikeStatus>(likeKey(id), 'LIKE');
  }
}

export function useLikeStatus(videoId: string | null) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: likeKey(videoId ?? ''),
    queryFn: () => fetchLikeStatus(videoId!),
    enabled: signedIn && !!videoId,
    staleTime: 5 * 60_000,
  });
}

export function useTrackCredits(videoId: string | null) {
  const { ready } = useYouTubeReady();
  return useQuery({
    queryKey: ['music', 'credits', videoId ?? ''],
    queryFn: () => (videoId ? fetchTrackCredits(videoId) : null),
    enabled: ready && !!videoId,
    staleTime: 60 * 60_000,
  });
}

const LIKED_PAGES = { queryKey: ['music', 'playlist'] as const };
const isLikedPage = (key: readonly unknown[]) => typeof key[2] === 'string' && key[2].replace(/^VL/, '') === LIKED_MUSIC_PLAYLIST;

/**
 * Like or unlike, shown at once and put back if YouTube refuses; a small notice above the
 * player says it was done. [silent] leaves that to the caller (the Add to Playlist window
 * reports all its changes in one).
 */
export function useSetLiked() {
  return useMutation({
    mutationFn: ({ videoId, liked }: { videoId: string; liked: boolean; silent?: boolean }) => setTrackLiked(videoId, liked),
    onMutate: ({ videoId, liked }) => {
      const previous = queryClient.getQueryData<LikeStatus>(likeKey(videoId));
      queryClient.setQueryData<LikeStatus>(likeKey(videoId), liked ? 'LIKE' : 'INDIFFERENT');
      if (liked) unlikedHere.delete(videoId);
      else {
        unlikedHere.set(videoId, Date.now());
        // Gone from the Liked Music page at once.
        queryClient.setQueriesData<InfiniteData<PlaylistChunk>>({ ...LIKED_PAGES, predicate: (q) => isLikedPage(q.queryKey) }, (data) =>
          data && { ...data, pages: data.pages.map((page) => ({ ...page, tracks: page.tracks.filter((t) => t.videoId !== videoId) })) },
        );
      }
      return { previous };
    },
    onSuccess: (_result, { liked, silent }) => {
      if (!silent) void announceLiked(liked ? 'Added to Liked Music' : 'Removed from Liked Music');
    },
    onError: (_error, { videoId, liked, silent }, context) => {
      queryClient.setQueryData(likeKey(videoId), context?.previous);
      unlikedHere.delete(videoId);
      forgetPlaylistContents(LIKED_MUSIC_PLAYLIST);
      if (!silent) void announceLiked(liked ? 'Couldn’t add to Liked Music' : 'Couldn’t remove from Liked Music', 'error');
    },
    onSettled: (_data, error, { liked }) => {
      // A like adds a row the page doesn't have; an unlike already took its row out (YouTube's list may lag behind).
      if (liked || error) {
        void queryClient.invalidateQueries({ queryKey: ['music', 'library', 'songs'] });
        void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', LIKED_MUSIC_PLAYLIST] });
        void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', `VL${LIKED_MUSIC_PLAYLIST}`] });
      }
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

/** Whether a playlist holds the song, as far as YouTube's flag, the real contents and this session's changes say. */
function optionContains(option: PlaylistOption, videoId: string, found?: Set<string>): boolean {
  const key = addedKey(option.playlistId, videoId);
  const contains = option.contains || (found?.has(bareId(option.playlistId)) ?? false);
  // Songs added or removed here stay as they were left, however often the panel is reopened.
  return (contains && !removedHere.has(key)) || addedHere.has(key);
}

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
  const data = base.data?.map((o) => ({ ...o, contains: optionContains(o, videoId, found) }));
  // Still reading some playlists' contents: a playlist shown as not holding the song may yet turn out to.
  const checking = checks.some((c) => c.isLoading);
  return { ...base, data, checking };
}

/**
 * Whether the song is in any playlist yet, for the green badge on a track row: null until known.
 * Only YouTube's own flag is read (one request), not every playlist's contents.
 */
export function useSavedSomewhere(videoId: string, enabled: boolean): boolean | null {
  const signedIn = useSignedIn();
  const query = useQuery({
    queryKey: ['music', 'playlist-options', videoId],
    queryFn: () => fetchPlaylistOptions(videoId),
    enabled: signedIn && enabled && isVideoId(videoId),
    staleTime: 30_000,
  });
  if (!query.data) return null;
  if (query.data.some((o) => optionContains(o, videoId))) return true;
  // YouTube's flag misses old songs; any playlist already read in full (the Add to Playlist window does) and found to hold it counts.
  return queryClient
    .getQueriesData<boolean>({ queryKey: ['music', 'playlist-has'] })
    .some(([key, found]) => key[3] === videoId && found === true && !removedHere.has(addedKey(String(key[2]), videoId)));
}

const COVERS_KEY = ['music', 'library', 'playlist-covers'] as const;
const coversQuery = () => ({ queryKey: COVERS_KEY, queryFn: fetchAllLibraryPlaylists, staleTime: 5 * 60_000 });

export interface PlaylistInfo {
  title: string;
  cover: string | null;
}

function infoMap(...lists: (MusicItem[] | undefined)[]): Map<string, PlaylistInfo> {
  const map = new Map<string, PlaylistInfo>();
  for (const list of lists) {
    for (const item of list ?? []) {
      if (item.kind !== 'playlist') continue;
      const key = bareId(item.id);
      const known = map.get(key);
      map.set(key, { title: item.title, cover: item.thumbnail ?? known?.cover ?? null });
    }
  }
  return map;
}

/** Every playlist of the account by id, with its title and cover. [enabled] false reads only what is already loaded. */
export function usePlaylistInfos(enabled = true): Map<string, PlaylistInfo> {
  const signedIn = useSignedIn();
  const sidebar = useLibraryPlaylists();
  const covers = useQuery({ ...coversQuery(), enabled: signedIn && enabled });
  return useMemo(() => infoMap(covers.data, sidebar.data), [covers.data, sidebar.data]);
}

/** A playlist's title and cover from whatever is loaded now (the cover is fetched if it is not). */
async function playlistInfo(playlistId: string, title?: string): Promise<PlaylistInfo> {
  const bare = bareId(playlistId);
  const loaded = () => infoMap(queryClient.getQueryData<MusicItem[]>(SIDEBAR_PLAYLISTS_KEY), queryClient.getQueryData<MusicItem[]>(COVERS_KEY)).get(bare);
  let info = loaded();
  if (!info?.cover) {
    // A playlist beyond the sidebar's first page: the full list is read, but never waited on for long.
    await Promise.race([queryClient.fetchQuery(coversQuery()).catch(() => null), new Promise((resolve) => setTimeout(resolve, 1500))]);
    info = loaded() ?? info;
  }
  return { title: title ?? info?.title ?? 'playlist', cover: info?.cover ?? null };
}

/** Liked Music's own cover, as its playlist page and the library list show it: null until either is loaded. */
function likedCoverLoaded(): string | null {
  const listed = infoMap(queryClient.getQueryData<MusicItem[]>(SIDEBAR_PLAYLISTS_KEY), queryClient.getQueryData<MusicItem[]>(COVERS_KEY)).get(LIKED_MUSIC_PLAYLIST)?.cover;
  if (listed) return listed;
  for (const [, data] of queryClient.getQueriesData<InfiniteData<PlaylistChunk>>({ queryKey: ['music', 'playlist'], predicate: (q) => isLikedPage(q.queryKey) })) {
    const cover = data?.pages[0]?.header?.thumbnail;
    if (cover) return cover;
  }
  return null;
}

/** The cover for Liked Music, for the Add to Playlist window. */
export function useLikedCover(): string | null {
  usePlaylistInfos(true);
  return likedCoverLoaded();
}

/** Says Liked Music changed, with the cover its playlist has (the plain liked tile if none has loaded). */
async function announceLiked(text: string, tone?: 'ok' | 'error'): Promise<void> {
  let cover = likedCoverLoaded();
  if (!cover) {
    await playlistInfo(LIKED_MUSIC_PLAYLIST);
    cover = likedCoverLoaded();
  }
  notify({ text, cover: cover ? { kind: 'image', src: cover } : { kind: 'liked' }, ...(tone && { tone }) });
}

/** Says a song went into a playlist (or was already there), with the playlist's cover. */
async function announceAdded(playlistId: string, result: 'added' | 'duplicate', title?: string): Promise<void> {
  const info = await playlistInfo(playlistId, title);
  notify({ text: result === 'added' ? `Added to ${info.title}` : `Already in ${info.title}`, cover: { kind: 'image', src: info.cover } });
}

/** The same, for a playlist and cover already in hand. */
export function announceChange(input: { text: string; detail?: string | undefined; cover: string | null | 'liked'; tone?: 'ok' | 'error' }): void {
  notify({
    text: input.text,
    detail: input.detail,
    cover: input.cover === 'liked' ? { kind: 'liked' } : { kind: 'image', src: input.cover },
    ...(input.tone && { tone: input.tone }),
  });
}

/** Notes that a song is now in a playlist, for a list that YouTube's own flag may lag behind. */
export function noteAddedHere(playlistId: string, videoId: string): void {
  addedHere.add(addedKey(playlistId, videoId));
  removedHere.delete(addedKey(playlistId, videoId));
  queryClient.setQueryData(hasKey(playlistId, videoId), true);
}

/**
 * Songs to suggest under a playlist: the radios of a few of its own songs. [round] picks new
 * seeds (the Refresh button). Nothing is asked until [enabled] (the playlist has songs).
 */
export function usePlaylistRecommendations(playlistId: string, tracks: Track[], enabled: boolean, round: number) {
  const signedIn = useSignedIn();
  const { ready } = useYouTubeReady();
  const latest = useRef(tracks);
  latest.current = tracks;
  return useQuery({
    queryKey: ['music', 'playlist-recs', bareId(playlistId), round],
    queryFn: () => {
      const all = latest.current.filter((t) => isVideoId(t.videoId) && !t.unavailable);
      // Prefer music catalogue tracks (those with album info) as seeds: their radios return
      // music song recommendations. Fall back to any available track only when the playlist
      // holds no music tracks at all.
      const musicTracks = all.filter((t) => t.album !== null);
      const pool = musicTracks.length > 0 ? musicTracks : all;
      const seeds: string[] = [];
      const left = [...pool];
      while (seeds.length < 4 && left.length) seeds.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]!.videoId);
      return fetchPlaylistRecommendations([...new Set(seeds)]);
    },
    enabled: ready && signedIn && enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** Adds a song to a playlist once: a second try resolves 'duplicate' and changes nothing. */
/** Every song of a playlist, all pages read (from what is already loaded where it can be). */
export async function loadPlaylistTracks(playlistId: string): Promise<Track[]> {
  const data = await queryClient.fetchInfiniteQuery(playlistQuery(playlistId));
  const tracks = data.pages.flatMap((page) => page.tracks);
  let next = data.pages.at(-1)?.next ?? null;
  for (let n = 0; next && n < 200; n++) {
    const page = await next();
    tracks.push(...page.data);
    next = page.next;
  }
  return tracks;
}

/** Saves a whole playlist's songs into another of the account's playlists, and says so. */
export function useAddPlaylistToPlaylist() {
  return useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; targetTitle: string; sourceId: string; sourceTitle: string }) =>
      addPlaylistToPlaylist(targetId, sourceId),
    onSuccess: async (_result, { targetId, targetTitle, sourceTitle }) => {
      const info = await playlistInfo(targetId, targetTitle);
      announceChange({ text: `Added “${sourceTitle}” to ${info.title}`, cover: info.cover });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', targetId] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', `VL${bareId(targetId)}`] });
    },
    onError: async (_error, { targetId, targetTitle, sourceTitle }) => {
      const info = await playlistInfo(targetId, targetTitle);
      announceChange({ text: `Couldn’t add “${sourceTitle}” to ${info.title}`, cover: info.cover, tone: 'error' });
    },
  });
}

export function useRemovePlaylistFromPlaylist() {
  return useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; targetTitle: string; sourceId: string; sourceTitle: string }) =>
      removePlaylistFromPlaylist(targetId, sourceId),
    onSuccess: async (_result, { targetId, targetTitle, sourceTitle }) => {
      const info = await playlistInfo(targetId, targetTitle);
      announceChange({ text: `Removed “${sourceTitle}” from ${info.title}`, cover: info.cover });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', targetId] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist', `VL${bareId(targetId)}`] });
    },
    onError: async (_error, { targetId, targetTitle, sourceTitle }) => {
      const info = await playlistInfo(targetId, targetTitle);
      announceChange({ text: `Couldn’t remove “${sourceTitle}” from ${info.title}`, cover: info.cover, tone: 'error' });
    },
  });
}

export function useAddToPlaylist() {
  return useMutation({
    // [title] names the playlist in the notice when the caller knows it; [silent] leaves the notice to the caller.
    mutationFn: ({ playlistId, videoId }: { playlistId: string; videoId: string; title?: string; silent?: boolean }) => addToPlaylist(playlistId, videoId),
    onError: (_error, { playlistId, title, silent }) => {
      if (silent) return;
      if (bareId(playlistId) === LIKED_MUSIC_PLAYLIST) return void announceLiked('Couldn’t add to Liked Music', 'error');
      void playlistInfo(playlistId, title).then((info) =>
        notify({ text: `Couldn’t add to ${info.title}`, cover: { kind: 'image', src: info.cover }, tone: 'error' }),
      );
    },
    onSuccess: (result, { playlistId, videoId, title, silent }) => {
      // Dropping a song on Liked Music likes it: the star follows.
      if (bareId(playlistId) === LIKED_MUSIC_PLAYLIST) {
        unlikedHere.delete(videoId);
        queryClient.setQueryData<LikeStatus>(likeKey(videoId), 'LIKE');
        void queryClient.invalidateQueries({ queryKey: ['music', 'library', 'songs'] });
        if (!silent) void announceLiked('Added to Liked Music');
        return;
      }
      if (!silent) void announceAdded(playlistId, result, title);
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
    mutationFn: ({ playlistId, videoId }: { playlistId: string; videoId: string; title?: string; silent?: boolean }) => removeFromPlaylist(playlistId, videoId),
    onSuccess: (_result, { playlistId, title, silent }) => {
      if (silent) return;
      void playlistInfo(playlistId, title).then((info) => notify({ text: `Removed from ${info.title}`, cover: { kind: 'image', src: info.cover } }));
    },
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
    onError: (_error, { playlistId, videoId, title, silent }, context) => {
      if (!silent) void playlistInfo(playlistId, title).then((info) => notify({ text: `Couldn’t remove from ${info.title}`, cover: { kind: 'image', src: info.cover }, tone: 'error' }));
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

/** A new, empty, private playlist on the account (it can be made public from its page); the sidebar and Playlists page pick it up. */
export function useCreatePlaylist() {
  return useMutation({
    // [videoIds] go into it as it is made (the Add to Playlist window's New playlist).
    mutationFn: (input: string | { title: string; videoIds?: string[] }) =>
      typeof input === 'string' ? createPlaylist(input, []) : createPlaylist(input.title, input.videoIds ?? []),
    onSuccess: (id, input) => {
      const title = (typeof input === 'string' ? input : input.title).replace(/[\u0000-\u001f\u007f]/g, '').trim();
      // In the sidebar at once; YouTube's own list catches up a moment later (see noteCreatedPlaylist).
      const item = noteCreatedPlaylist(id, title);
      queryClient.setQueryData<MusicItem[]>(SIDEBAR_PLAYLISTS_KEY, (list) =>
        list ? [item, ...list.filter((p) => p.id.replace(/^VL/, '') !== id.replace(/^VL/, ''))] : list,
      );
      void queryClient.invalidateQueries({ queryKey: ['music', 'library'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist-options'] });
    },
  });
}

/** Makes one of the account's playlists private, unlisted (anyone with the link) or public. */
export function useSetPlaylistPrivacy() {
  return useMutation({
    mutationFn: ({ playlistId, privacy }: { playlistId: string; privacy: 'private' | 'unlisted' | 'public' }) =>
      setPlaylistPrivacy(playlistId, privacy.toUpperCase() as 'PRIVATE' | 'UNLISTED' | 'PUBLIC'),
    onSuccess: (_result, { playlistId, privacy }) => {
      if (privacy === 'private') rememberPrivatePlaylist(playlistId);
      else forgetPrivatePlaylist(playlistId);
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'library'] });
    },
  });
}

/** Renames one of the account's playlists; its page, the sidebar and the Playlists page show the new name at once. */
export function useRenamePlaylist() {
  return useMutation({
    mutationFn: ({ playlistId, name }: { playlistId: string; name: string }) => renamePlaylist(playlistId, name),
    onSuccess: (_result, { playlistId, name }) => {
      const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      const bare = playlistId.replace(/^VL/, '');
      const same = (key: readonly unknown[]) => typeof key[2] === 'string' && key[2].replace(/^VL/, '') === bare;
      queryClient.setQueriesData<InfiniteData<PlaylistChunk>>(
        { queryKey: ['music', 'playlist'], predicate: (query) => same(query.queryKey) },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => (page.header ? { ...page, header: { ...page.header, title: clean } } : page)),
          },
      );
      queryClient.setQueryData<MusicItem[]>(SIDEBAR_PLAYLISTS_KEY, (list) => list?.map((p) => (p.id.replace(/^VL/, '') === bare ? { ...p, title: clean } : p)));
      void queryClient.invalidateQueries({ queryKey: ['music', 'library'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist-options'] });
    },
  });
}

/** Deletes one of the account's playlists; the sidebar and Playlists page drop it. */
export function useDeletePlaylist() {
  return useMutation({
    mutationFn: (playlistId: string) => deletePlaylist(playlistId),
    onSuccess: (_result, playlistId) => {
      forgetPrivatePlaylist(playlistId);
      noteDeletedPlaylist(playlistId);
      queryClient.setQueryData<MusicItem[]>(SIDEBAR_PLAYLISTS_KEY, (list) => list?.filter((p) => p.id.replace(/^VL/, '') !== playlistId.replace(/^VL/, '')));
      void queryClient.invalidateQueries({ queryKey: ['music', 'library'] });
      void queryClient.invalidateQueries({ queryKey: ['music', 'playlist-options'] });
    },
  });
}
