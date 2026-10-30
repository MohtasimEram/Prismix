import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { PauseIcon, PlayIcon } from '@/components/icons/Transport';
import { useSavedSomewhere, useSignedIn } from '@/data/music/queries';
import type { ArtistRef, Track } from '@/data/music/types';
import { useAddDialog } from '@/state/addDialog';
import { beginTrackDrag, useDragTrack } from '@/state/dragTrack';
import { useDownloadsLibrary } from '@/state/downloadsLibrary';
import { removeDownload } from '@/playback/download';
import { usePlayer } from '@/state/player';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { albumHref, artistHref, formatDuration } from './links';
import { playList, playTrack, type ListContext } from './play';
import { TrackMenu } from './TrackMenu';

type Variant = 'album' | 'playlist';

const ROW_HEIGHT: Record<Variant, number> = { album: 46, playlist: 54 };
/** Below this, plain rows: an album or a short playlist gains nothing from virtualizing. */
const VIRTUALIZE_FROM = 80;

interface TrackListProps {
  tracks: Track[];
  variant: Variant;
  /** Album artwork, for rows that have none of their own (album tracks). */
  fallbackArtwork?: string | null;
  /** The album's artists, credited when a track has none of its own. */
  fallbackArtists?: ArtistRef[];
  /** Called when the list nears its end, to load the next page of a long playlist. */
  onNearEnd?: () => void;
  /** Where the list comes from: playing a row queues the list from there. Without it, a row plays alone. */
  source?: ListContext['source'];
  /** On the account's own playlist: takes a song out of it (a Remove from Playlist item in each ⋯ menu). */
  onRemove?: ((track: Track) => void) | undefined;
  /** On the account's own playlist: rows can be dragged to a new place. [before] is the row to land above (`tracks.length` = the end). */
  onReorder?: ((from: number, before: number) => void) | undefined;
  /** The list is one of the account's own playlists (or Liked Music): its songs show the badge as saved. */
  savedHere?: boolean;
}

/** What a row needs to take part in dragging songs into a new order (see TrackList). */
interface Reorder {
  /** The row being dragged, and where it would land, as indices into the list. */
  from: number | null;
  before: number | null;
  last: number;
  start: (index: number) => void;
  over: (before: number) => void;
  drop: () => void;
  end: () => void;
}

/* Track lists (report §3 album rows, §14 playlist rows). */

const cell = 'flex h-full min-w-0 items-center';
// 396 / 274 / 274 / 141 at 1440px (report §14).
const playlistColumns = 'grid-cols-[minmax(0,36.5fr)_minmax(0,25.25fr)_minmax(0,25.25fr)_minmax(0,13fr)]';
// Artist and album: playlists only, and not below 768px.
const secondary = `${cell} pe-2.5 max-md:hidden`;
const tertiary = `${cell} pe-4 max-md:hidden`;
// A row from another catalogue with no YouTube Music song (yet) is dimmed.
const dimmed = 'group-data-unavailable/row:opacity-45';
const link = 'text-inherit hover:underline group-data-current/row:text-primary';

/**
 * A hairline on top of every row, hidden on hover and around the playing row;
 * a fill on hover, a stronger one for the playing row.
 */
const row = [
  'group/row relative grid items-center bg-transparent hover:bg-tracklist-hover data-unavailable:cursor-default',
  'data-current:bg-[color-mix(in_srgb,var(--systemPrimary)_12%,transparent)]',
  'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:border-t-[0.5px] before:border-t-divider',
  'hover:before:border-t-transparent data-current:before:border-t-transparent [&:hover+&]:before:border-t-transparent [&[data-current]+&]:before:border-t-transparent',
  // Reordering: the dragged row dims, and a key-colour line shows where it would land.
  'data-dragging:opacity-40 after:pointer-events-none after:absolute after:inset-x-2 after:h-0.5 after:rounded-full after:bg-key',
  'not-data-drop-above:not-data-drop-below:after:hidden data-drop-above:after:top-0 data-drop-below:after:bottom-0',
].join(' ');

const rowVariant: Record<Variant, string> = {
  album: 'h-[46px] grid-cols-[minmax(0,1fr)_auto] rounded-row',
  playlist: `h-[54px] ${playlistColumns} rounded-[12px] max-md:grid-cols-[minmax(0,1fr)_auto]`,
};

/** A small green arrow beside a song that is saved on this computer, as Spotify marks its downloads; a click deletes the file. */
function DownloadedBadge({ track, variant }: { track: Track; variant: Variant }) {
  const saved = useDownloadsLibrary((s) => s.songs.some((x) => x.videoId === track.videoId));
  const [busy, setBusy] = useState(false);
  if (!saved) return null;
  return (
    <button
      className={`absolute top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-green text-black transition-opacity hover:opacity-75 disabled:opacity-50 ${
        // A fixed distance from the row's right edge, so every icon lines up whatever the time's width.
        variant === 'playlist' ? 'end-[92px]' : 'end-[86px]'
      }`}
      title="Downloaded. Click to delete the file"
      aria-label={`Delete the downloaded file of ${track.title}`}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void removeDownload(track).finally(() => setBusy(false));
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ArrowDown size={11} strokeWidth={3.2} aria-hidden="true" />
    </button>
  );
}

/**
 * The green badge that shows on a hovered row: a tick when the song is already in one of the
 * account's playlists, a plus when it is in none. A click opens the Add to Playlist window.
 * Which it is comes from one request, made only once the pointer has rested on the row.
 */
function AddBadge({ track, variant, hovered, savedHere }: { track: Track; variant: Variant; hovered: boolean; savedHere: boolean }) {
  const signedIn = useSignedIn();
  const [rested, setRested] = useState(false);
  useEffect(() => {
    if (!hovered) return setRested(false);
    const timer = setTimeout(() => setRested(true), 250);
    return () => clearTimeout(timer);
  }, [hovered]);
  // On one of the account's own playlists (or Liked Music) every row is, by the page itself, saved.
  const known = useSavedSomewhere(track.videoId, signedIn && rested && !savedHere);
  const saved = savedHere || known === true;
  if (!signedIn) return null;
  const label = saved ? 'Saved in a playlist. Edit playlists' : 'Add to playlist';
  return (
    <button
      type="button"
      className={`absolute top-1/2 hidden size-5 -translate-y-1/2 rounded-full p-0 group-focus-within/row:block group-hover/row:block hover:opacity-90 focus-visible:block ${
        // Just left of the ⋯ button, and right of the downloaded badge.
        variant === 'playlist' ? 'end-[62px]' : 'end-[58px]'
      }`}
      title={saved ? 'Saved in a playlist' : 'Add to playlist'}
      aria-label={`${label}: ${track.title}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.stopPropagation();
        useAddDialog.getState().open({
          videoId: track.videoId,
          title: track.title,
          artist: track.artists.map((a) => a.name).join(', '),
          thumbnail: track.thumbnail,
        });
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/*
        The circle and its tick or plus are one drawing, so they are placed together. As separate
        boxes (a round background and an icon inside it) the browser rounds each to the pixel grid
        on its own, and once the row sits at a fractional position (after the window or a panel was
        resized, or a list scrolled) the tick could land a pixel off-centre.
      */}
      <svg width="20" height="20" viewBox="0 0 20 20" className="block" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="10" className="fill-key" />
        {saved ? (
          <path d="M20 6 9 17l-5-5" transform="translate(9 10) scale(0.5417) translate(-12 -11.5)" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M5 12h14M12 5v14" transform="translate(10 10) scale(0.5833) translate(-12 -12)" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}

function Artists({ artists }: { artists: ArtistRef[] }) {
  return (
    <>
      {artists.map((artist, i) => {
        const href = artistHref(artist.id);
        return (
          <span key={`${artist.name}-${i}`}>
            {i > 0 && ', '}
            {href ? (
              <PrefetchLink to={href} className={link}>
                {artist.name}
              </PrefetchLink>
            ) : (
              artist.name
            )}
          </span>
        );
      })}
    </>
  );
}

const time: Record<Variant, string> = {
  album: 'relative justify-end pe-3 type-body tabular-nums',
  playlist: 'relative justify-end pe-[18px] type-body tabular-nums',
};

interface RowProps {
  track: Track;
  variant: Variant;
  position: number;
  fallbackArtwork: string | null | undefined;
  onPlayRow: () => void;
  onRemove?: ((track: Track) => void) | undefined;
  reorder?: Reorder | undefined;
  savedHere: boolean;
}

function Row({ track, variant, position, fallbackArtwork, onPlayRow, onRemove, reorder, savedHere }: RowProps) {
  const current = usePlayer((s) => s.nowPlaying?.videoId === track.videoId);
  const playing = usePlayer((s) => s.nowPlaying?.videoId === track.videoId && (s.status === 'playing' || s.status === 'buffering'));
  const togglePlay = usePlayer((s) => s.togglePlay);
  const unavailable = track.unavailable;
  const [hovered, setHovered] = useState(false);
  const onPlay = () => (unavailable ? undefined : current ? togglePlay() : onPlayRow());

  return (
    <div
      className={`${row} ${rowVariant[variant]}`}
      data-variant={variant}
      data-current={current || undefined}
      data-unavailable={unavailable}
      data-dragging={reorder?.from === position - 1 || undefined}
      data-drop-above={(reorder?.from != null && reorder.before === position - 1) || undefined}
      data-drop-below={(reorder?.from != null && reorder.before === position && position - 1 === reorder.last) || undefined}
      title={unavailable === 'matching' ? 'Looking for this on YouTube Music…' : unavailable === 'missing' ? 'Not found on YouTube Music' : undefined}
      onDoubleClick={onPlay}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Drag a song onto a playlist in the sidebar to add it.
      draggable={!unavailable}
      onDragStart={(event) => {
        // Dragging a link inside the row would carry its URL instead of the song.
        if (!unavailable && beginTrackDrag(event, { videoId: track.videoId, title: track.title })) reorder?.start(position - 1);
      }}
      onDragOver={(event) => {
        if (!reorder || reorder.from === null) return;
        // The row's upper half drops above it, the lower half below.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const box = event.currentTarget.getBoundingClientRect();
        reorder.over(event.clientY < box.top + box.height / 2 ? position - 1 : position);
      }}
      onDrop={(event) => {
        if (!reorder || reorder.from === null) return;
        event.preventDefault();
        reorder.drop();
      }}
      onDragEnd={() => {
        useDragTrack.getState().end();
        reorder?.end();
      }}
    >
      <div className={`${cell} gap-3`}>
        <div className={`relative grid w-10 shrink-0 place-items-center${variant === 'playlist' ? ' ms-[7px]' : ''}`}>
          {variant === 'playlist' ? (
            <>
              <Artwork src={track.thumbnail ?? fallbackArtwork ?? null} displayWidth={40} radius="var(--radius-artwork-small)" />
              {current && (
                // The playing row's marker: a pause glyph while it plays (play when paused) over the artwork (or where the number was).
                <span
                  className="absolute inset-0 grid place-items-center rounded-artwork-sm bg-[rgb(0_0_0/0.45)] text-white group-hover/row:invisible"
                  aria-label="Now playing"
                >
                  {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                </span>
              )}
            </>
          ) : (
            <span className="type-body text-secondary group-hover/row:invisible">
              {current ? (
                <span className="grid place-items-center text-primary group-hover/row:invisible" aria-label="Now playing">
                  {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                </span>
              ) : (
                (track.index ?? position)
              )}
            </span>
          )}
          <button
            className={`absolute inset-0 grid place-items-center rounded-artwork-sm opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 group-data-unavailable/row:hidden ${
              variant === 'playlist' ? 'bg-lockup-hover text-white' : 'text-primary'
            }`}
            aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
            onClick={onPlay}
            disabled={!!unavailable}
          >
            {playing ? <PauseIcon size={variant === 'playlist' ? 18 : 16} /> : <PlayIcon size={variant === 'playlist' ? 18 : 16} />}
          </button>
        </div>
        <div
          className={`flex min-w-0 flex-col ${dimmed} group-data-[unavailable=matching]/row:animate-matching motion-reduce:group-data-[unavailable=matching]/row:animate-none`}
        >
          <div className="flex min-w-0 items-center">
            <span className="truncate type-body text-primary">{track.title}</span>
            {track.explicit && <ExplicitBadge />}
          </div>
          {variant === 'album' && track.artists.length > 0 && (
            <div className="truncate type-callout">
              <Artists artists={track.artists} />
            </div>
          )}
        </div>
      </div>
      {variant === 'playlist' && (
        <>
          <div className={`${secondary} ${dimmed}`}>
            <span className="truncate type-body">
              <Artists artists={track.artists} />
            </span>
          </div>
          <div className={`${tertiary} ${dimmed}`}>
            <span className="truncate type-body">
              {track.album &&
                (albumHref(track.album.id) ? (
                  <PrefetchLink to={albumHref(track.album.id)!} className={link}>
                    {track.album.name}
                  </PrefetchLink>
                ) : (
                  track.album.name
                ))}
            </span>
          </div>
        </>
      )}
      <div className={`${cell} ${time[variant]} ${dimmed}`}>
        {/* The ⋯ button (TrackMenu) takes the time's place on hover, as Apple's rows do. */}
        {!unavailable && <DownloadedBadge track={track} variant={variant} />}
        {!unavailable && <AddBadge track={track} variant={variant} hovered={hovered} savedHere={savedHere} />}
        <span className={unavailable ? undefined : 'group-focus-within/row:invisible group-hover/row:invisible group-has-[[data-open]]/row:invisible'}>
          {unavailable === 'missing' ? 'Not found' : formatDuration(track.durationSec)}
        </span>
        {!unavailable && (
          <TrackMenu
            track={track}
            onRemove={onRemove ? () => onRemove(track) : undefined}
            className="absolute end-2.5 hidden size-7 place-items-center rounded-full text-key group-focus-within/row:grid group-hover/row:grid hover:bg-quinary data-open:grid"
          />
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className={`grid h-8 items-center ${playlistColumns} type-callout-emphasized text-secondary max-md:hidden`} aria-hidden="true">
      <div className={`${cell} gap-3 ps-[7px]`}>Song</div>
      <div className={secondary}>Artist</div>
      <div className={tertiary}>Album</div>
      <div className={`${cell} ${time.playlist}`}>Time</div>
    </div>
  );
}

/**
 * Album and playlist track lists (report §3, §14): hairline-divided rows,
 * hover fill, the number (or artwork) turning into a play button. Long lists
 * are virtualized against the page's scroll container (prompt §3).
 */
export function TrackList({ tracks, variant, fallbackArtwork, fallbackArtists, onNearEnd, source, onRemove, onReorder, savedHere = false }: TrackListProps) {
  // Dragging rows into a new order: where the drag started and where it would land.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const reorder: Reorder | undefined = onReorder
    ? {
        from: dragFrom,
        before: dropBefore,
        last: tracks.length - 1,
        start: setDragFrom,
        over: setDropBefore,
        end: () => {
          setDragFrom(null);
          setDropBefore(null);
        },
        drop: () => {
          if (dragFrom !== null && dropBefore !== null) onReorder(dragFrom, dropBefore);
          setDragFrom(null);
          setDropBefore(null);
        },
      }
    : undefined;
  const playRow = (i: number) => {
    // Rows from another catalogue that found no YouTube Music song stay out of the queue.
    if (source) {
      const playable = tracks.filter((t) => !t.unavailable);
      return playList(playable, Math.max(0, playable.indexOf(tracks[i]!)), { source, fallbackArtwork, fallbackArtists });
    }
    const track = tracks[i]!;
    playTrack(track.artists.length || !fallbackArtists ? track : { ...track, artists: fallbackArtists }, fallbackArtwork);
  };
  const container = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  useEffect(() => setScrollElement(document.getElementById('scrollable-page')), []);
  const virtual = tracks.length >= VIRTUALIZE_FROM;

  const virtualizer = useVirtualizer({
    count: virtual ? tracks.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT[variant],
    overscan: 10,
    scrollMargin: container.current?.offsetTop ?? 0,
  });

  const items = virtual ? virtualizer.getVirtualItems() : [];
  const last = items[items.length - 1];
  useEffect(() => {
    if (!onNearEnd) return;
    if (virtual ? last && last.index >= tracks.length - 20 : true) onNearEnd();
  }, [last?.index, tracks.length, virtual, onNearEnd]);

  return (
    <div className="mx-(--body-gutter) type-callout text-secondary" data-variant={variant} role="table" aria-label="Songs">
      {variant === 'playlist' && <Header />}
      <div ref={container}>
        {virtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <Row
                  track={tracks[item.index]!}
                  variant={variant}
                  position={item.index + 1}
                  fallbackArtwork={fallbackArtwork}
                  onPlayRow={() => playRow(item.index)}
                  onRemove={onRemove}
                  reorder={reorder}
                  savedHere={savedHere}
                />
              </div>
            ))}
          </div>
        ) : (
          tracks.map((track, i) => (
            <Row
              key={`${track.videoId}-${i}`}
              track={track}
              variant={variant}
              position={i + 1}
              fallbackArtwork={fallbackArtwork}
              onPlayRow={() => playRow(i)}
              onRemove={onRemove}
              reorder={reorder}
              savedHere={savedHere}
            />
          ))
        )}
      </div>
    </div>
  );
}
