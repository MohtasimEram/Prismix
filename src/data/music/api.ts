import type { YTMusic, YTNodes } from 'youtubei.js/web';
import type { Candidate } from '@/playback/queue/builder';
import { getInnertube, getMusicClient, getSignedInnertube } from '@/playback/youtube/innertube';
import { isExactArtistMatch, normalizedArtistName } from '@/lib/artistCredits';
import { rememberPrivatePlaylist } from '@/lib/privatePlaylists';
import { LIBRARY_SECTIONS, LIKED_MUSIC_PLAYLIST, type LibrarySection } from './library';
import {
  mapAlbum,
  mapArtist,
  mapBrowse,
  mapCategories,
  mapHome,
  mapPlaylist,
  mapPlaylistTracks,
  mapSearch,
  mapShelves,
  mapSuggestions,
} from './mappers';
import type {
  AlbumPage,
  MusicItem,
  ArtistPage,
  BrowseLink,
  BrowsePage,
  CategoryGroup,
  PlaylistPage,
  SearchResults,
  Shelf,
  Suggestions,
  Track,
} from './types';

// The browse pages' requests, through YouTube.js's music namespace (prompt
// §5.1). Each returns a view model; continuations are passed back as opaque
// handles, so pages never see a YouTube.js object.

export interface Paged<T> {
  data: T;
  /** Fetches the next page; null when there isn't one. */
  next: (() => Promise<Paged<T>>) | null;
}

/**
 * YouTube often offers one more page than it has: the continuation comes back
 * empty and YouTube.js throws ("Continuation did not have any content"). That
 * is the end of the list, not a failure; anything else still is one.
 */
async function orEnd<T>(nextPage: () => Promise<Paged<T>>, empty: T): Promise<Paged<T>> {
  try {
    return await nextPage();
  } catch (error) {
    if (/did not have any content|no continuation/i.test(String(error))) return { data: empty, next: null };
    throw error;
  }
}

function homePage(feed: YTMusic.HomeFeed): Paged<Shelf[]> {
  return {
    data: mapHome(feed),
    next: feed.has_continuation ? () => orEnd(async () => homePage(await feed.getContinuation()), []) : null,
  };
}

export async function fetchHome(): Promise<Paged<Shelf[]>> {
  const yt = await getMusicClient();
  return homePage(await yt.music.getHomeFeed());
}

/** The New page: YouTube Music's Explore, minus its podcast and mood carousels (mappers drop those). */
export async function fetchExplore(): Promise<Shelf[]> {
  const yt = await getMusicClient();
  return mapShelves((await yt.music.getExplore()).sections);
}

/** Moods & genres, read raw because YouTube.js drops the tiles' colours. */
export async function fetchCategories(): Promise<CategoryGroup[]> {
  const yt = await getInnertube();
  const response = await yt.actions.execute('/browse', { browseId: 'FEmusic_moods_and_genres', client: 'YTMUSIC' });
  return mapCategories(response.data);
}

const songItem = (track: Track): MusicItem => ({
  kind: 'song',
  id: track.videoId,
  title: track.title,
  subtitle: track.album?.name ?? '',
  artists: track.artists,
  album: track.album,
  thumbnail: track.thumbnail,
  wide: false,
  durationSec: track.durationSec,
  explicit: track.explicit,
});

export async function fetchSearch(query: string): Promise<SearchResults> {
  const yt = await getMusicClient();
  const [mixed, songs, videos] = await Promise.all([
    yt.music.search(query),
    // The Songs filter lists catalogue songs only and goes deeper than the mixed page's few; best effort.
    searchSongs(query).catch(() => [] as Track[]),
    // Likewise the Videos filter, for the Videos tab.
    searchVideos(query).catch(() => [] as MusicItem[]),
  ]);
  const results = mapSearch(mixed);
  if (songs.length) {
    const have = new Set(results.songs.map((s) => s.id));
    const extra = songs.filter((t) => !have.has(t.videoId)).map(songItem);
    results.songs = [...results.songs, ...extra];
  }
  if (videos.length) {
    const have = new Set(results.videos.map((v) => v.id));
    results.videos = [...results.videos, ...videos.filter((v) => !have.has(v.id))];
  }
  return results;
}

/** YouTube Music's Videos filter for [query], as items for the Videos tab. */
async function searchVideos(query: string): Promise<MusicItem[]> {
  const yt = await getMusicClient();
  return mapSearch(await yt.music.search(query, { type: 'video' })).videos;
}

/** YouTube Music's Songs shelf for [query]: what an import or a match is chosen from. */
export async function searchSongs(query: string): Promise<Track[]> {
  const yt = await getMusicClient();
  const search = await yt.music.search(query, { type: 'song' });
  const shelf = search.songs ?? search.contents?.find((c) => c.type === 'MusicShelf');
  return mapPlaylistTracks((shelf as { contents?: readonly unknown[] } | undefined)?.contents ?? []);
}

export async function fetchSuggestions(input: string): Promise<Suggestions> {
  const yt = await getInnertube();
  return mapSuggestions(await yt.music.getSearchSuggestions(input));
}

export async function fetchAlbum(id: string): Promise<AlbumPage> {
  const yt = await getMusicClient();
  return mapAlbum(id, await yt.music.getAlbum(id));
}

/** How many top songs an artist page lists, as on the phone. */
const ARTIST_TOP_SONGS = 20;

/**
 * An artist. The landing page only lists five songs, so its linked "Top
 * songs" playlist fills the list out (YtMusicRepository.artistPage); if that
 * fails, the five stand.
 */
export async function fetchArtist(id: string): Promise<ArtistPage> {
  const yt = await getMusicClient();
  const page = mapArtist(id, await yt.music.getArtist(id));
  const playlistId = page.topSongsSeeAll?.browseId;
  if (playlistId?.startsWith('VL') && page.topSongs.length < ARTIST_TOP_SONGS) {
    try {
      const { page: playlist } = await fetchPlaylist(playlistId);
      if (playlist.tracks.length > page.topSongs.length) page.topSongs = playlist.tracks.slice(0, ARTIST_TOP_SONGS);
    } catch {
      // The landing page's songs are still the right ones, just fewer.
    }
  }
  return page;
}

function playlistTracks(page: YTMusic.Playlist): Paged<Track[]> {
  return {
    data: mapPlaylistTracks(page.items),
    next: page.has_continuation ? () => orEnd(async () => playlistTracks(await page.getContinuation()), []) : null,
  };
}

/** The header and first page of tracks; `more` fetches the rest page by page. */
export async function fetchPlaylist(id: string): Promise<{ page: PlaylistPage; more: Paged<Track[]>['next'] }> {
  const yt = await getMusicClient();
  const playlist = await yt.music.getPlaylist(id);
  return { page: mapPlaylist(id, playlist), more: playlistTracks(playlist).next };
}

/** See All, moods and genres: whatever the browse id renders as. */
export async function fetchBrowse({ browseId, params }: BrowseLink): Promise<BrowsePage> {
  const yt = await getMusicClient();
  const { YTNodes } = await import('youtubei.js/web');
  const response = await yt.actions.execute('/browse', {
    browseId,
    ...(params && { params }),
    client: 'YTMUSIC',
    parse: true,
  });
  const memo = response.contents_memo;
  const sections = [
    ...(memo?.getType(YTNodes.Grid) ?? []),
    ...(memo?.getType(YTNodes.MusicCarouselShelf) ?? []),
    ...(memo?.getType(YTNodes.MusicShelf) ?? []),
    ...(memo?.getType(YTNodes.MusicPlaylistShelf) ?? []),
  ];
  const header = memo?.getType(YTNodes.MusicHeader)?.[0] ?? (response.header as unknown);
  return mapBrowse({ header, sections }, '');
}

// ---- Signed in (prompt §5.3) ------------------------------------------------------

type Raw = Record<string, unknown>;

/** Every object stored under [key], anywhere inside a raw response. */
function collect(root: unknown, key: string, out: Raw[] = []): Raw[] {
  if (Array.isArray(root)) for (const item of root) collect(item, key, out);
  else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Raw);
      else collect(v, key, out);
    }
  }
  return out;
}

function runsText(node: unknown): string {
  const n = node as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  return n?.runs?.map((r) => r.text ?? '').join('') ?? n?.simpleText ?? '';
}

/**
 * Playlists made or deleted in this session. YouTube's library list can lag a
 * moment behind (a playlist made seconds ago isn't in it yet, a deleted one still
 * is), so these are applied over whatever it answers until it agrees.
 */
const madeHere = new Map<string, MusicItem>();
const deletedHere = new Set<string>();

/** The library item for a playlist just made, and the note that it should be listed. */
export function noteCreatedPlaylist(id: string, title: string): MusicItem {
  const item: MusicItem = {
    kind: 'playlist',
    id: `VL${bareId(id)}`,
    title,
    subtitle: 'Playlist',
    artists: [],
    album: null,
    thumbnail: null,
    wide: false,
    durationSec: null,
    explicit: false,
  };
  deletedHere.delete(bareId(id));
  madeHere.set(bareId(id), item);
  return item;
}

export function noteDeletedPlaylist(id: string): void {
  madeHere.delete(bareId(id));
  deletedHere.add(bareId(id));
}

/** YouTube's list of playlists with this session's changes applied; changes it has caught up with are dropped. */
function withLocalPlaylistChanges(items: MusicItem[]): MusicItem[] {
  const listed = new Set(items.map((item) => bareId(item.id)));
  for (const id of listed) madeHere.delete(id);
  for (const id of [...deletedHere]) if (!listed.has(id)) deletedHere.delete(id);
  const kept = items.filter((item) => !deletedHere.has(bareId(item.id)));
  return [...madeHere.values(), ...kept];
}

/** One library page, a page of it at a time: grids continue as grids, song lists as song lists. */
export async function fetchLibrary(section: LibrarySection): Promise<Paged<BrowsePage>> {
  const { title, browseId } = LIBRARY_SECTIONS[section];
  const page = await fetchLibraryBrowse(browseId, title);
  if (section !== 'playlists') return page;
  return { ...page, data: { ...page.data, grid: withLocalPlaylistChanges(page.data.grid) } };
}

async function fetchLibraryBrowse(browseId: string, title: string): Promise<Paged<BrowsePage>> {
  const yt = await getSignedInnertube();
  const { YTNodes } = await import('youtubei.js/web');
  const response = await yt.actions.execute('/browse', { browseId, client: 'YTMUSIC', parse: true });
  const memo = response.contents_memo;
  const grids = memo?.getType(YTNodes.Grid) ?? [];
  const lists = [...(memo?.getType(YTNodes.MusicShelf) ?? []), ...(memo?.getType(YTNodes.MusicPlaylistShelf) ?? [])];
  const carousels = memo?.getType(YTNodes.MusicCarouselShelf) ?? [];
  const page = mapBrowse({ sections: [...grids, ...lists, ...carousels] }, title);
  // History is several lists ("Today", "Yesterday"); the rest is one grid or one list.
  const token = (grids[0]?.continuation ?? (lists.length === 1 ? lists[0]?.continuation : null)) || null;
  return { data: { ...page, title }, next: token ? () => orEnd(() => libraryContinuation(token, title), emptyPage(title)) : null };
}

const emptyPage = (title: string): BrowsePage => ({ title, shelves: [], grid: [], tracks: [] });

async function libraryContinuation(token: string, title: string): Promise<Paged<BrowsePage>> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/browse', { continuation: token, client: 'YTMUSIC', parse: true });
  const contents = response.continuation_contents as unknown as
    | { type: string; items?: unknown[]; contents?: unknown[]; continuation?: string | null }
    | undefined;
  const section =
    contents?.type === 'GridContinuation'
      ? { type: 'Grid', items: contents.items ?? [] }
      : { type: 'MusicShelf', contents: contents?.contents ?? [] };
  const next = contents?.continuation || null;
  return {
    data: mapBrowse({ sections: [section] }, title),
    next: next ? () => orEnd(() => libraryContinuation(next, title), emptyPage(title)) : null,
  };
}

/** The user's playlists for the sidebar, in YouTube's order (most recent activity first). */
export async function fetchLibraryPlaylists(): Promise<MusicItem[]> {
  const { data } = await fetchLibrary('playlists');
  return data.grid.filter((item) => item.kind === 'playlist');
}

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

/** The thumbs state YouTube Music shows on its player for this track. */
export async function fetchLikeStatus(videoId: string): Promise<LikeStatus> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/next', { videoId, client: 'YTMUSIC' });
  const button = collect((response.data as Raw).playerOverlays, 'likeButtonRenderer')[0];
  const status = button?.likeStatus;
  return status === 'LIKE' || status === 'DISLIKE' ? status : 'INDIFFERENT';
}

/** Likes a track (it joins Liked Music) or takes the like back. */
export async function setTrackLiked(videoId: string, liked: boolean): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute(liked ? '/like/like' : '/like/removelike', { target: { videoId }, client: 'YTMUSIC' });
}

/**
 * Follows an artist (YouTube's "subscribe", which puts them in Library › Artists) or
 * unfollows. The params are the ones YouTube Music's own artist page sends.
 */
export async function setArtistFollowed(channelId: string, followed: boolean): Promise<void> {
  if (!/^UC[\w-]{10,}$/.test(channelId)) throw new Error('This artist can’t be followed');
  const yt = await getSignedInnertube();
  await yt.actions.execute(followed ? '/subscription/subscribe' : '/subscription/unsubscribe', {
    channelIds: [channelId],
    params: followed ? 'EgIIAhgA' : 'CgIIAhgA',
    client: 'YTMUSIC',
  });
}

/** Adds an album or playlist to the library, or removes it: YouTube saves both by liking the list. */
export async function setListSaved(playlistId: string, saved: boolean): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute(saved ? '/like/like' : '/like/removelike', { target: { playlistId }, client: 'YTMUSIC' });
}

export interface PlaylistOption {
  playlistId: string;
  title: string;
  /** The playlist already holds the track (YouTube's `containsSelectedVideos`). */
  contains: boolean;
}

/**
 * The playlists a track can be added to, as YouTube Music's "Save to
 * playlist" lists them. Its "Liked Music" entry is really a like, which
 * Favorite already does, so it's left out.
 *
 * YouTube's own `containsSelectedVideos` flag is unreliable for songs that
 * were added to a playlist long ago, so it is returned at once and the
 * playlists it reports as not holding the track are then checked against
 * their real contents, one by one (`playlistHasTrack`), without holding up the list.
 */
export async function fetchPlaylistOptions(videoId: string): Promise<PlaylistOption[]> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/playlist/get_add_to_playlist', { videoIds: [videoId], client: 'YTMUSIC' });
  const options = collect(response.data, 'playlistAddToOptionRenderer')
    .map((option) => ({
      playlistId: typeof option.playlistId === 'string' ? option.playlistId : '',
      title: runsText(option.title),
      contains: option.containsSelectedVideos === 'ALL' || option.containsSelectedVideos === 'SOME',
    }))
    .filter((option) => option.playlistId && option.playlistId !== LIKED_MUSIC_PLAYLIST && option.title);
  return options;
}

const bareId = (playlistId: string) => playlistId.replace(/^VL/, '');

/** The video ids each playlist held when last read, so reopening the card doesn't re-read every playlist. */
const MEMBERSHIP_TTL = 60_000;
const membership = new Map<string, { at: number; ids: Set<string>; complete: boolean }>();
const MAX_PLAYLIST_PAGES = 100;

/** Forgets what is known of a playlist's contents (after it changed). */
export function forgetPlaylistContents(playlistId: string): void {
  membership.delete(bareId(playlistId));
}

/**
 * Whether the playlist's actual contents include the track, reading it page by
 * page and stopping at the first match. A playlist that can't be read counts
 * as not holding it, as before.
 */
export async function playlistHasTrack(playlistId: string, videoId: string, fresh = false): Promise<boolean> {
  const id = bareId(playlistId);
  const cached = membership.get(id);
  if (!fresh && cached && Date.now() - cached.at < MEMBERSHIP_TTL && cached.ids.has(videoId)) return true;
  if (!fresh && cached && Date.now() - cached.at < MEMBERSHIP_TTL && cached.complete) return false;
  const ids = new Set<string>();
  let complete = false;
  try {
    const yt = await getMusicClient();
    let page: YTMusic.Playlist | null = await yt.music.getPlaylist(id);
    for (let n = 0; page && n < MAX_PLAYLIST_PAGES; n++) {
      for (const item of page.items ?? []) {
        const raw = item as { id?: unknown; video_id?: unknown };
        for (const candidate of [raw.id, raw.video_id]) if (typeof candidate === 'string') ids.add(candidate);
      }
      if (ids.has(videoId)) break;
      if (!page.has_continuation) {
        complete = true;
        break;
      }
      try {
        page = await page.getContinuation();
      } catch (error) {
        // YouTube offers one more page than it has: that is the end of the list.
        if (/did not have any content|no continuation/i.test(String(error))) complete = true;
        else throw error;
        break;
      }
    }
  } catch {
    return ids.has(videoId);
  }
  membership.set(id, { at: Date.now(), ids, complete });
  return ids.has(videoId);
}

/**
 * Adds a track to one of the account's playlists, unless it is already in it:
 * a playlist never holds the same song twice. YouTube's own "skip duplicates"
 * option is not relied on; the playlist's current contents are read first.
 * Resolves 'duplicate' when nothing had to be added.
 */
export async function addToPlaylist(playlistId: string, videoId: string): Promise<'added' | 'duplicate'> {
  const id = bareId(playlistId);
  if (await playlistHasTrack(id, videoId, true).catch(() => false)) return 'duplicate';
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: id,
    actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }],
    client: 'YTMUSIC',
  });
  forgetPlaylistContents(id);
  return 'added';
}

/** Takes a track out of a playlist (every copy of it, by video id). */
export async function removeFromPlaylist(playlistId: string, videoId: string): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: bareId(playlistId),
    actions: [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }],
    client: 'YTMUSIC',
  });
  forgetPlaylistContents(playlistId);
}

/**
 * Moves a song within one of the account's playlists, to just before another song
 * (or to the end when [beforeSetVideoId] is null). Both are the rows' own playlist ids
 * (Track.setVideoId), since a song can be in a playlist twice.
 */
export async function moveInPlaylist(playlistId: string, setVideoId: string, beforeSetVideoId: string | null): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: bareId(playlistId),
    actions: [
      beforeSetVideoId
        ? { action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId, movedSetVideoIdSuccessor: beforeSetVideoId }
        : { action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId },
    ],
    client: 'YTMUSIC',
  });
  forgetPlaylistContents(playlistId);
}

/** Deletes one of the account's playlists (InnerTube `playlist/delete`). The songs stay in the library; only the playlist goes. */
export async function deletePlaylist(playlistId: string): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/playlist/delete', { playlistId: bareId(playlistId), client: 'YTMUSIC' });
}

/** YouTube's limit on a playlist's name. */
export const PLAYLIST_NAME_MAX = 150;

/** Renames one of the account's playlists (InnerTube's ACTION_SET_PLAYLIST_NAME). */
export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean || clean.length > PLAYLIST_NAME_MAX) throw new Error('A playlist name is 1 to 150 characters');
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: bareId(playlistId),
    actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: clean }],
    client: 'YTMUSIC',
  });
}

export type PlaylistPrivacy = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

/** Changes who can see one of the account's playlists (InnerTube's ACTION_SET_PLAYLIST_PRIVACY). */
export async function setPlaylistPrivacy(playlistId: string, privacy: PlaylistPrivacy): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: bareId(playlistId),
    actions: [{ action: 'ACTION_SET_PLAYLIST_PRIVACY', playlistPrivacy: privacy }],
    client: 'YTMUSIC',
  });
}

/**
 * A new playlist holding [videoIds], as YtMusicRepository.createPlaylist makes
 * one (InnerTube `playlist/create`). Private unless [privacy] says otherwise.
 * Returns its id, without the VL.
 */
export async function createPlaylist(title: string, videoIds: string[], description = '', privacy: PlaylistPrivacy = 'PRIVATE'): Promise<string> {
  const yt = await getSignedInnertube();
  const ids = [...new Set(videoIds)];
  const response = await yt.actions.execute('/playlist/create', {
    title,
    description,
    privacyStatus: privacy,
    ...(ids.length > 0 && { videoIds: ids }),
    client: 'YTMUSIC',
  });
  const id = (response.data as { playlistId?: string } | undefined)?.playlistId;
  if (!id) throw new Error('YouTube Music did not make the playlist');
  if (privacy === 'PRIVATE') rememberPrivatePlaylist(id);
  return id;
}

// ---- AutoPlay (phase 6) -------------------------------------------------------------

/**
 * A music video rather than the catalogue song: YouTube marks each watch
 * endpoint with its type, ATV for the song and OMV/UGC for videos. (A radio
 * seeded on a video id is all videos; one seeded on a song is mostly songs.)
 */
function isMusicVideo(item: YTNodes.PlaylistPanelVideo): boolean {
  const type = (item.endpoint?.payload as { watchEndpointMusicSupportedConfigs?: { watchEndpointMusicConfig?: { musicVideoType?: string } } } | undefined)
    ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return type !== undefined ? type !== 'MUSIC_VIDEO_TYPE_ATV' : !item.album;
}

/**
 * The radio YouTube Music would play after [videoId]: its "RDAMVM" mix, as
 * Innertube.next asks for it on the phone. Signed in it's the user's own
 * station. Music videos are flagged so the station builder can prefer the
 * catalogue cut (QueueBuilder).
 */
export async function fetchRadio(videoId: string): Promise<Candidate[]> {
  const yt = await getMusicClient();
  const panel = await yt.music.getUpNext(videoId, true);
  return (panel.contents as unknown as Raw[]).map(panelCandidate).filter((c): c is Candidate => c !== null);
}

/**
 * A watch-queue row's cuts. A wrapper pairs the two cuts of one track (song
 * and music video), with either as its primary.
 */
function panelCuts(raw: Raw): YTNodes.PlaylistPanelVideo[] {
  const cuts = (raw.type === 'PlaylistPanelVideoWrapper'
    ? [raw.primary, ...((raw.counterpart as unknown[] | undefined) ?? [])]
    : [raw]) as (YTNodes.PlaylistPanelVideo | null | undefined)[];
  return cuts.filter((c): c is YTNodes.PlaylistPanelVideo => c?.type === 'PlaylistPanelVideo');
}

/** One watch-queue row as a track: the catalogue song (the cut with an album). */
function panelCandidate(raw: Raw): Candidate | null {
  const panelVideos = panelCuts(raw);
  const item = panelVideos.find((c) => !isMusicVideo(c)) ?? panelVideos[0];
  if (!item?.video_id) return null;
  const thumbs = [...(item.thumbnail ?? [])].sort((a, b) => b.width - a.width);
  return {
    track: {
      videoId: item.video_id,
      title: item.title?.toString() ?? '',
      artists: (item.artists ?? []).map((a) => ({ name: a.name, id: a.channel_id ?? null })),
      album: item.album ? { name: item.album.name, id: item.album.id ?? null } : null,
      durationSec: item.duration?.seconds || null,
      explicit: (item.badges ?? []).some((b) => /explicit/i.test(JSON.stringify(b))),
      thumbnail: thumbs[0]?.url ?? null,
      index: null,
      plays: null,
    },
    isVideo: isMusicVideo(item),
  };
}

// ---- Player links ---------------------------------------------------------------

/**
 * The album and artist pages a track links out to (YtMusicRepository.trackLinks).
 * Queue rows from home cards often lack them; the track's own watch-queue
 * entry always names both.
 */
export async function fetchTrackLinks(videoId: string): Promise<Track | null> {
  const yt = await getMusicClient();
  const panel = await yt.music.getUpNext(videoId, false);
  // The row holding this video, by either of its cuts; its catalogue cut names the album.
  const row = (panel.contents as unknown as Raw[]).find((raw) => panelCuts(raw).some((cut) => cut.video_id === videoId));
  return (row && panelCandidate(row)?.track) ?? null;
}

/**
 * The page of the artist called exactly [name] (YtMusicRepository.findArtistPageId):
 * a name is not an identity, so only a result that answers to it exactly is
 * opened, never the nearest one.
 */
export async function findArtistPageId(name: string): Promise<string | null> {
  if (!normalizedArtistName(name)) return null;
  const results = await fetchSearch(name);
  return [...results.top, ...results.artists].find((item) => item.kind === 'artist' && isExactArtistMatch(item.title, name))?.id ?? null;
}


// ---- Discover ------------------------------------------------------------------------

/** [count] random members of [list], without repeats (a partial Fisher–Yates). */
function sample<T>(list: readonly T[], count: number): T[] {
  const pool = [...list];
  const picked: T[] = [];
  while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  return picked;
}

const MIN_SHELF_ITEMS = 3;

/**
 * Discover: music you may not have heard, built from your taste. Signed in, a few
 * of the artists of your saved songs, and those songs, are picked at random as seeds, so each refresh
 * finds something different:
 * - per artist: the artists YouTube Music says fans of theirs also like (those you
 *   already have are left out);
 * - per song: the radio YouTube Music builds from it (the song itself and songs
 *   already in your library are left out).
 * YouTube Music's Explore (new albums, singles and videos) follows, and is all there
 * is for someone not signed in. A seed that fails to load is skipped, never the page.
 */
export async function fetchDiscover(signedIn: boolean): Promise<Shelf[]> {
  const personal: Shelf[] = [];
  if (signedIn) {
    const songsPage = await fetchLibrary('songs').catch(() => null);
    const libraryTracks = songsPage?.data.tracks ?? [];
    const libraryTrackIds = new Set(libraryTracks.map((t) => t.videoId));
    // Artist seeds come from the artists of your saved songs (not the ones you follow).
    const songArtists = new Map<string, { id: string; title: string }>();
    for (const track of libraryTracks) {
      for (const a of track.artists) if (a.id && !songArtists.has(a.id)) songArtists.set(a.id, { id: a.id, title: a.name });
    }
    const libraryArtists = [...songArtists.values()];
    const libraryArtistIds = new Set(songArtists.keys());

    const fromArtists = sample(libraryArtists, 3).map(async (artist): Promise<Shelf | null> => {
      const page = await fetchArtist(artist.id);
      const related = page.shelves.find((shelf) => shelf.items.some((i) => i.kind === 'artist'));
      const items = (related?.items ?? []).filter((i) => i.kind === 'artist' && i.id !== artist.id && !libraryArtistIds.has(i.id));
      return items.length >= MIN_SHELF_ITEMS
        ? { title: `Because you listen to ${artist.title}`, strapline: 'Artists to try', layout: 'circle', items: items.slice(0, 14), seeAll: null }
        : null;
    });
    const fromSongs = sample(libraryTracks, 2).map(async (seed): Promise<Shelf | null> => {
      const seen = new Set<string>([seed.videoId]);
      const items: MusicItem[] = [];
      for (const { track, isVideo } of await fetchRadio(seed.videoId)) {
        if (isVideo || seen.has(track.videoId) || libraryTrackIds.has(track.videoId)) continue;
        seen.add(track.videoId);
        items.push(songItem(track));
      }
      return items.length >= MIN_SHELF_ITEMS
        ? { title: `More like “${seed.title}”`, strapline: 'Songs to try', layout: 'tracks', items: items.slice(0, 16), seeAll: null }
        : null;
    });
    const settled = await Promise.allSettled([...fromArtists, ...fromSongs]);
    for (const result of settled) if (result.status === 'fulfilled' && result.value) personal.push(result.value);
  }
  const explore = (await fetchExplore().catch(() => [] as Shelf[])).filter((shelf) => shelf.items.length > 0);
  // The "Because you listen to…" artist shelves go right under "New albums & singles";
  // the song shelves stay on top. Without that shelf, the artist shelves keep their place up front.
  const artistShelves = personal.filter((shelf) => shelf.layout === 'circle');
  const songShelves = personal.filter((shelf) => shelf.layout !== 'circle');
  const newAt = explore.findIndex((shelf) => /new albums/i.test(shelf.title));
  if (newAt < 0) return [...artistShelves, ...songShelves, ...explore];
  return [...songShelves, ...explore.slice(0, newAt + 1), ...artistShelves, ...explore.slice(newAt + 1)];
}


// ---- Followed artists ----------------------------------------------------------------

export interface Followed {
  /** The artists the account follows, as the library lists them. */
  artists: MusicItem[];
  /** Each followed artist's latest album, single or EP from this year or last, newest first. */
  releases: MusicItem[];
}

/** How many followed artists are checked for a new release (each is one artist page). */
const RELEASE_SCAN = 15;
const RELEASE_LIMIT = 20;
const yearOf = (item: MusicItem): number => Number(/\b(19|20)\d{2}\b/.exec(item.subtitle)?.[0] ?? 0);

/**
 * The followed artists and what they released lately. YouTube Music lists a
 * release's year but not its date, so "lately" is this year or last, and an
 * artist contributes only their newest. An artist whose page fails to load is
 * skipped, never the whole list.
 */
export async function fetchFollowed(): Promise<Followed> {
  const page = await fetchLibrary('artists').catch(() => null);
  // Followed artists come as a grid, or as a list that maps to shelves; either way the artist items are taken.
  const found = [...(page?.data.grid ?? []), ...(page?.data.shelves ?? []).flatMap((shelf) => shelf.items)].filter((i) => i.kind === 'artist');
  const artists = found.filter((a, at) => found.findIndex((b) => b.id === a.id) === at);
  const since = new Date().getFullYear() - 1;
  const settled = await Promise.allSettled(
    artists.slice(0, RELEASE_SCAN).map(async (artist): Promise<MusicItem | null> => {
      const data = await fetchArtist(artist.id);
      let best: MusicItem | null = null;
      for (const shelf of data.shelves) {
        for (const item of shelf.items) {
          if (item.kind !== 'album' || yearOf(item) < since) continue;
          if (!best || yearOf(item) > yearOf(best)) best = item;
        }
      }
      return best && { ...best, artists: best.artists.length ? best.artists : [{ name: artist.title, id: artist.id }] };
    }),
  );
  const releases = settled
    .flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
    .sort((a, b) => yearOf(b) - yearOf(a))
    .slice(0, RELEASE_LIMIT);
  return { artists, releases };
}
