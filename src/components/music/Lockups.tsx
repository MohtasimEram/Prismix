import { PrefetchLink } from '@/components/PrefetchLink';
import { PauseIcon, PlayIcon } from '@/components/icons/Transport';
import type { MusicItem, Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { trackDragProps } from '@/state/dragTrack';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { artistHref, hrefFor } from './links';
import { playTrack } from './play';
import { TrackMenu } from './TrackMenu';

export const isPlayable = (item: MusicItem) => item.kind === 'song' || item.kind === 'video';

export function itemToTrack(item: MusicItem): Track {
  return {
    videoId: item.id,
    title: item.title,
    artists: item.artists,
    album: item.album ?? null,
    durationSec: item.durationSec ?? null,
    explicit: !!item.explicit,
    thumbnail: item.thumbnail,
    index: null,
    plays: null,
  };
}

/** Dragging a song or video card onto a playlist in the sidebar adds it (state/dragTrack.ts). */
const dragOf = (item: MusicItem) => trackDragProps(isPlayable(item) ? { videoId: item.id, title: item.title } : null);

/* Lockups (report §2). */
const lockup = 'flex min-w-0 flex-col';
const caption = 'mt-2 flex min-w-0 flex-col gap-px';
const title = 'flex min-w-0 items-center type-callout [&>:first-child]:truncate';
const subtitle = 'truncate type-callout text-secondary';
const overlayLink = 'absolute inset-0 z-1 rounded-[inherit]';

/** Artist names as links where YouTube links them, else the given subtitle. */
function Byline({ item }: { item: MusicItem }) {
  const linked = item.artists.some((a) => a.id);
  if (!linked || item.kind === 'album' || item.kind === 'playlist') return <>{item.subtitle}</>;
  return (
    <>
      {item.artists.map((artist, i) => {
        const href = artistHref(artist.id);
        return (
          <span key={`${artist.name}-${i}`}>
            {i > 0 && ', '}
            {href ? (
              <PrefetchLink to={href} className="hover:underline">
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

/** Whether [item] is the loaded track and whether it is sounding, so its play control can show pause. */
function usePlayback(item: MusicItem) {
  const current = usePlayer((s) => isPlayable(item) && s.nowPlaying?.videoId === item.id);
  const status = usePlayer((s) => s.status);
  const playing = current && (status === 'playing' || status === 'loading' || status === 'buffering');
  return { current, playing };
}

/** Pause or resume the loaded track, else start [item] (or run [start] when given). */
function toggleOrPlay(current: boolean, item: MusicItem, start?: () => void) {
  if (current) usePlayer.getState().togglePlay();
  else if (start) start();
  else playTrack(item);
}

function PlayPlatter({ item }: { item: MusicItem }) {
  const { current, playing } = usePlayback(item);
  return (
    <button
      // Glass, lighter on hover; it stays visible on the song that is playing.
      className={`absolute bottom-2.5 left-2.5 z-3 grid size-[30px] place-items-center rounded-full bg-thin-material text-white transition-[opacity,background-color] duration-100 [backdrop-filter:saturate(180%)_blur(60px)] hover:bg-white/35 focus-visible:opacity-100 group-focus-within/art:opacity-100 group-hover/art:opacity-100 ${playing ? 'opacity-100' : 'opacity-0'}`}
      aria-label={playing ? `Pause ${item.title}` : `Play ${item.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleOrPlay(current, item);
      }}
    >
      {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
    </button>
  );
}

function MenuPlatter({ item }: { item: MusicItem }) {
  const track = itemToTrack(item);
  return (
    <div className="absolute bottom-2.5 right-2.5 z-3">
      <TrackMenu
        track={track}
        className="grid size-[30px] place-items-center rounded-full bg-thin-material text-white transition-[opacity,background-color] duration-100 [backdrop-filter:saturate(180%)_blur(60px)] hover:bg-white/35 focus-visible:opacity-100 group-focus-within/art:opacity-100 group-hover/art:opacity-100 data-open:opacity-100 opacity-0"
      />
    </div>
  );
}

/** The artwork with its hover scrim, linking to the item or playing it. */
function LockupArtwork({ item, width, aspect }: { item: MusicItem; width: number; aspect: number }) {
  const href = hrefFor(item);
  const { current } = usePlayback(item);
  return (
    <div className="group/art relative rounded-artwork-md">
      <Artwork src={item.thumbnail} displayWidth={width} aspect={aspect} radius="var(--radius-artwork-medium)" />
      {href ? (
        <PrefetchLink to={href} className={overlayLink} aria-label={item.title} />
      ) : (
        <button className={overlayLink} aria-label={`Play ${item.title}`} onClick={() => toggleOrPlay(current, item)} />
      )}
      {/* Hover scrim and platter (report §2: --lockupHoverBGColor, opacity .1s ease-in). */}
      <div className="pointer-events-none absolute inset-0 z-2 rounded-[inherit] bg-lockup-hover opacity-0 transition-opacity duration-100 ease-in group-focus-within/art:opacity-100 group-hover/art:opacity-100" />
      {isPlayable(item) && (
        <>
          <PlayPlatter item={item} />
          <MenuPlatter item={item} />
        </>
      )}
    </div>
  );
}

/** Square lockup (report §2): artwork, hover scrim with play platter, title and subtitle. */
export function SquareLockup({ item, width = 220 }: { item: MusicItem; width?: number }) {
  const href = hrefFor(item);
  return (
    <div className={lockup} {...dragOf(item)}>
      <LockupArtwork item={item} width={width} aspect={1} />
      <div className={caption}>
        <div className={title}>
          {href ? (
            <PrefetchLink to={href} className="hover:underline">
              {item.title}
            </PrefetchLink>
          ) : (
            <span>{item.title}</span>
          )}
          {item.explicit && <ExplicitBadge />}
        </div>
        <div className={subtitle}>
          <Byline item={item} />
        </div>
      </div>
    </div>
  );
}

/** 16:9 video lockup (report §2, type C). */
export function VideoLockup({ item, width = 300 }: { item: MusicItem; width?: number }) {
  return (
    <div className={lockup} {...dragOf(item)}>
      <LockupArtwork item={item} width={width} aspect={16 / 9} />
      <div className={caption}>
        <div className={title}>
          <span>{item.title}</span>
          {item.explicit && <ExplicitBadge />}
        </div>
        <div className={subtitle}>{item.subtitle}</div>
      </div>
    </div>
  );
}

/** Circular artist lockup (report §2, type H). */
export function CircleLockup({ item, width = 160 }: { item: MusicItem; width?: number }) {
  return (
    <PrefetchLink to={hrefFor(item) ?? '#'} className="group/circle flex min-w-0 flex-col items-center gap-2.5">
      <Artwork src={item.thumbnail} displayWidth={width} radius="50%" />
      <span className="max-w-full truncate text-center type-body group-hover/circle:underline">{item.title}</span>
    </PrefetchLink>
  );
}

/** A song row inside a shelf (report §2, track lockup): 40px art, title, byline, 3-dot menu. */
export function TrackLockup({ item, onPlay }: { item: MusicItem; onPlay?: () => void }) {
  const { current, playing } = usePlayback(item);
  const play = () => toggleOrPlay(current, item, onPlay);
  const track = itemToTrack(item);

  return (
    // 52px art column (40 + 12 gap), content, 32px menu; 55px tall.
    <div className="group/track relative grid h-[55px] grid-cols-[40px_minmax(0,1fr)_32px] items-center gap-x-3 py-[7.5px] pr-2 pl-0" {...dragOf(item)}>
      <button className="group/art relative w-10 rounded-artwork-sm" aria-label={`Play ${item.title}`} onClick={play}>
        <Artwork src={item.thumbnail} displayWidth={40} radius="var(--radius-artwork-small)" />
        <span
          className="absolute inset-0 grid place-items-center rounded-[inherit] bg-lockup-hover text-white transition-opacity duration-100 ease-in group-hover/track:opacity-100 group-focus-visible/art:opacity-100 opacity-0"
          aria-hidden="true"
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </span>
      </button>
      <div className="flex min-w-0 flex-col gap-px px-1">
        <div className="flex min-w-0 items-center type-body">
          <button className="min-w-0 truncate text-left" onClick={play}>
            {item.title}
          </button>
          {item.explicit && <ExplicitBadge />}
        </div>
        <div className="truncate type-callout text-secondary">
          <Byline item={item} />
        </div>
      </div>
      <div className="relative grid items-center justify-items-end">
        <TrackMenu
          track={track}
          className="hidden size-7 place-items-center rounded-full text-secondary hover:text-primary hover:bg-quaternary data-open:text-primary data-open:bg-quaternary group-hover/track:grid group-focus-within/track:grid data-open:grid"
        />
      </div>
    </div>
  );
}
