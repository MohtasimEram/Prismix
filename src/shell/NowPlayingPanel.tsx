import { ExternalLink, Maximize2, PanelRightClose } from 'lucide-react';
import { useState } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { Artwork } from '@/components/music/Artwork';
import { CreditsDialog } from '@/components/music/CreditsDialog';
import { FavoriteButton } from '@/components/music/FavoriteButton';
import { TrackMenu } from '@/components/music/TrackMenu';
import { albumHref, artistHref } from '@/components/music/links';
import { useArtist, useSetArtistFollowed, useSignedIn, useTrackCredits } from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { useLyrics } from '@/lyrics/useLyrics';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';

// shrink-0: the list scrolls, so no card may be squeezed (they clip their content, and were being cut off).
const card = 'shrink-0 overflow-hidden rounded-[12px] bg-quinary';
const cardTitle = 'type-callout-emphasized text-primary';
const link = 'text-secondary hover:text-primary hover:underline';
const square = 'grid size-7 flex-none place-items-center rounded-[6px] text-secondary hover:bg-quinary hover:text-primary data-open:bg-quinary';

/** The queue entry behind the song that is playing (it knows the artists' ids and the album). */
function useCurrentTrack(): Track | null {
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? null);
  return usePlayer((s) => {
    const track = s.queue[s.index]?.track;
    return track && track.videoId === videoId ? track : null;
  });
}

function Artists({ track, artist }: { track: Track | null; artist: string }) {
  const artists = track?.artists ?? [];
  if (!artists.length) return <>{artist}</>;
  return (
    <>
      {artists.map((a, i) => {
        const href = artistHref(a.id);
        return (
          <span key={`${a.name}-${i}`}>
            {i > 0 && ', '}
            {href ? (
              <PrefetchLink to={href} className="text-inherit hover:underline">
                {a.name}
              </PrefetchLink>
            ) : (
              a.name
            )}
          </span>
        );
      })}
    </>
  );
}

/** The first lines of the song's words; a click opens the Lyrics panel. */
function LyricsPreview() {
  const lyrics = useLyrics();
  const openFromNowPlaying = useUi((s) => s.openFromNowPlaying);
  const lines = (lyrics.data?.lines ?? []).map((l) => l.text.trim()).filter(Boolean).slice(0, 4);
  if (!lines.length) return null;
  return (
    <button type="button" className={`${card} block w-full p-4 text-start hover:brightness-110`} onClick={() => openFromNowPlaying('lyrics')} aria-label="Show lyrics">
      <span className={cardTitle}>Lyrics preview</span>
      <span className="mt-3 block max-h-[8.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
        {lines.map((line, i) => (
          <span key={i} className="mb-3 block type-title-3-emphasized leading-snug text-secondary">
            {line}
          </span>
        ))}
      </span>
    </button>
  );
}

function AboutArtist({ artistId, name }: { artistId: string; name: string }) {
  const artist = useArtist(artistId);
  const signedIn = useSignedIn();
  const follow = useSetArtistFollowed();
  const data = artist.data;
  const href = artistHref(artistId);
  if (!data) {
    return artist.isPending ? <div className={`${card} h-[220px] animate-shimmer bg-skeleton`} aria-busy="true" /> : null;
  }
  const canFollow = signedIn && !!data.channelId && data.subscribed !== null;
  return (
    <section className={card} aria-label="About the artist">
      <div className="relative">
        {data.heroImage ? (
          <Artwork src={data.heroImage} displayWidth={420} aspect={1.9} />
        ) : (
          <div className="aspect-[19/10] w-full bg-quaternary" />
        )}
        <span className="absolute start-4 top-3.5 type-callout-emphasized text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.55)]">About the artist</span>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            {href ? (
              <PrefetchLink to={href} className="truncate type-title-3-emphasized text-primary hover:underline">
                {data.name || name}
              </PrefetchLink>
            ) : (
              <span className="truncate type-title-3-emphasized text-primary">{data.name || name}</span>
            )}
            {data.audience && <span className="truncate type-callout text-secondary">{data.audience}</span>}
          </div>
          {canFollow && (
            <button
              type="button"
              className="h-8 flex-none rounded-pill border-[0.75px] border-tertiary px-3.5 type-callout-emphasized text-primary hover:border-primary disabled:opacity-50"
              aria-pressed={data.subscribed === true}
              disabled={follow.isPending}
              onClick={() => follow.mutate({ artistId, channelId: data.channelId!, followed: data.subscribed !== true })}
            >
              {data.subscribed ? 'Following' : 'Follow'}
            </button>
          )}
        </div>
        {data.description && <p className="line-clamp-3 break-words type-callout leading-relaxed text-secondary">{data.description}</p>}
      </div>
    </section>
  );
}

function Credits({ track, videoId, title, artist }: { track: Track | null; videoId: string; title: string; artist: string }) {
  const credits = useTrackCredits(videoId);
  const [open, setOpen] = useState(false);
  // YouTube's own credit lines when it has them, else the song's artists.
  const fromYouTube = (credits.data?.sections ?? []).flatMap((section) => section.items.map((name) => ({ name, role: section.title })));
  const fallback = (track?.artists ?? []).map((a, i) => ({ name: a.name, role: i === 0 ? 'Main Artist' : 'Artist' }));
  const shown = (fromYouTube.length ? fromYouTube : fallback).slice(0, 3);
  if (!shown.length) return null;
  return (
    <section className={`${card} p-4`} aria-label="Credits">
      <div className="mb-3.5 flex items-center justify-between">
        <h3 className={cardTitle}>Credits</h3>
        {fromYouTube.length > 0 && (
          <button type="button" className="type-callout-emphasized text-secondary hover:text-primary hover:underline" onClick={() => setOpen(true)}>
            Show all
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-3.5">
        {shown.map((credit, i) => (
          <li key={`${credit.name}-${i}`} className="flex flex-col">
            <span className="truncate type-body-emphasized text-primary">{credit.name}</span>
            <span className="truncate type-callout text-secondary">{credit.role}</span>
          </li>
        ))}
      </ul>
      {open && <CreditsDialog videoId={videoId} title={title} artist={artist} album={track?.album?.name ?? null} onClose={() => setOpen(false)} />}
    </section>
  );
}

function NextInQueue() {
  const next = usePlayer((s) => s.queue[s.index + 1]?.track ?? null);
  const openFromNowPlaying = useUi((s) => s.openFromNowPlaying);
  if (!next) return null;
  return (
    <section className={`${card} p-4`} aria-label="Next in queue">
      <div className="mb-3.5 flex items-center justify-between">
        <h3 className={cardTitle}>Next in queue</h3>
        <button type="button" className="type-callout-emphasized text-secondary hover:text-primary hover:underline" onClick={() => openFromNowPlaying('up-next')}>
          Open queue
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-10 flex-none">
          <Artwork src={next.thumbnail} displayWidth={40} radius="var(--radius-artwork-small)" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate type-body-emphasized text-primary">{next.title}</span>
          <span className="truncate type-callout text-secondary">{next.artists.map((a) => a.name).join(', ')}</span>
        </div>
      </div>
    </section>
  );
}

/**
 * The Now Playing panel: the song's cover large, its title and artists with a Favorite star, a lyrics
 * preview, about the artist (with Follow), the credits, and what is next in the queue.
 *
 * Over the panel the heading eases to the right to make room for three buttons: hide Now Playing (left),
 * and the song's ⋯ menu and the full-screen player (right). A [preview] is the dimmed look the hidden
 * panel's strip peeks with: no buttons, and nothing in it can be used.
 */
export function NowPlayingPanel({ onHide, preview = false }: { onHide: () => void; preview?: boolean }) {
  const now = usePlayer((s) => s.nowPlaying);
  const track = useCurrentTrack();
  const openFullScreen = useUi((s) => s.setFullScreen);
  const albumLink = track?.album ? albumHref(track.album.id) : null;
  const mainArtist = track?.artists.find((a) => a.id);
  // The buttons take their room from the heading, and only while the pointer (or the keyboard) is on the panel, or the ⋯ menu is open.
  const slide = 'flex flex-none items-center overflow-hidden opacity-0 transition-[width,opacity] duration-200 ease-out';

  return (
    <div className="group/panel flex min-h-0 flex-1 flex-col">
      <div className="flex items-center px-4 pt-[23px] pb-3">
        {!preview && (
          <div className={`${slide} w-0 group-focus-within/panel:w-[34px] group-focus-within/panel:opacity-100 group-hover/panel:w-[34px] group-hover/panel:opacity-100 group-has-[[data-open]]/panel:w-[34px] group-has-[[data-open]]/panel:opacity-100`}>
            <button className={`${square} me-1.5`} aria-label="Hide Now Playing" title="Hide Now Playing" onClick={onHide}>
              <PanelRightClose size={16} strokeWidth={2.2} />
            </button>
          </div>
        )}
        <h3 className="min-w-0 flex-1 truncate type-title-2-emphasized">{track?.album?.name || 'Now Playing'}</h3>
        {!preview && now && (
          <div className={`${slide} w-0 group-focus-within/panel:w-[66px] group-focus-within/panel:opacity-100 group-hover/panel:w-[66px] group-hover/panel:opacity-100 group-has-[[data-open]]/panel:w-[66px] group-has-[[data-open]]/panel:opacity-100`}>
            <div className="ms-1.5 flex gap-1">
              {track && <TrackMenu track={track} className={square} placement="below-end" />}
              <button className={square} aria-label="Open full screen player" title="Open full screen player" onClick={() => openFullScreen(true)}>
                <Maximize2 size={15} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        )}
      </div>
      {!now ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-20 text-center type-callout text-secondary">
          <p className="type-callout-emphasized">Nothing playing</p>
          <p>Play a song to see its artwork, lyrics and credits here.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[calc(var(--player-pill-height)+var(--player-bottom-offset)+16px)]">
          <div className="w-full shrink-0 overflow-hidden rounded-[12px]">
            <Artwork src={now.artworkUrl} displayWidth={440} radius="12px" eager />
          </div>
          <div className="flex shrink-0 items-center gap-3 px-1 pt-1 pb-0.5">
            <div className="flex min-w-0 flex-1 flex-col">
              {albumLink ? (
                <PrefetchLink to={albumLink} className="truncate type-title-1-emphasized text-primary hover:underline">
                  {now.title}
                </PrefetchLink>
              ) : (
                <span className="truncate type-title-1-emphasized text-primary">{now.title}</span>
              )}
              <span className="truncate type-body text-secondary">
                <Artists track={track} artist={now.artist} />
              </span>
            </div>
            <FavoriteButton videoId={now.videoId} className="grid size-8 flex-none place-items-center rounded-full text-primary aria-pressed:text-key" size={20} />
          </div>
          <LyricsPreview />
          {mainArtist?.id && <AboutArtist artistId={mainArtist.id} name={mainArtist.name} />}
          <Credits track={track} videoId={now.videoId} title={now.title} artist={now.artist} />
          <NextInQueue />
          {track?.album && albumLink && (
            <PrefetchLink to={albumLink} className={`mx-1 mb-2 inline-flex shrink-0 items-center gap-1.5 type-callout ${link}`}>
              <ExternalLink size={13} aria-hidden="true" />
              Go to album
            </PrefetchLink>
          )}
        </div>
      )}
    </div>
  );
}
