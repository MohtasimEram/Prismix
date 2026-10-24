import { motion as m, useReducedMotion, useTransform } from 'framer-motion';
import { Check, Plus, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { CompactTitleBar, usePageScrollY } from '@/components/PageHeader';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { browseHref } from '@/components/music/links';
import { playList, shuffleList } from '@/components/music/play';
import { Shelves, TrackShelf } from '@/components/music/ShelfView';
import { LoadError, NeedsExtension } from '@/components/music/States';
import { useArtist, useSetArtistFollowed, useSignedIn, useYouTubeReady } from '@/data/music/queries';
import { useArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { ArtistSkeleton } from '@/skeletons/PageSkeletons';

/** The artist's name over the photograph. */
function ArtistName({ name }: { name: string }) {
  return <h1 className="type-header-emphasized text-[clamp(34px,5vw,64px)] leading-[1.05] [text-shadow:0_2px_20px_#00000059]">{name}</h1>;
}

/** Follow / Following: YouTube Music's subscribe, which puts the artist in Library › Artists. */
function FollowButton({ artistId, channelId, subscribed }: { artistId: string; channelId: string; subscribed: boolean }) {
  const set = useSetArtistFollowed();
  return (
    <button
      className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#ffffff2e] px-5 type-callout-emphasized text-white [backdrop-filter:blur(20px)_saturate(1.6)] disabled:opacity-60 enabled:hover:bg-[#ffffff47]"
      aria-pressed={subscribed}
      disabled={set.isPending}
      title={subscribed ? 'Unfollow' : 'Follow'}
      onClick={() => set.mutate({ artistId, channelId, followed: !subscribed })}
    >
      {subscribed ? <Check size={17} strokeWidth={2.4} /> : <Plus size={17} strokeWidth={2.4} />}
      {subscribed ? 'Following' : 'Follow'}
    </button>
  );
}

/** "About": the bio on a soft card over the artist's own photograph, folded to four lines until opened. */
function AboutCard({ name, description, image }: { name: string; description: string; image: string | null }) {
  const [open, setOpen] = useState(false);
  const long = description.length > 280 || description.split('\n').length > 4;
  return (
    <section className="relative isolate mx-(--body-gutter) mt-3 mb-10 overflow-hidden rounded-[18px] bg-quinary p-6 max-sm:p-4" aria-label={`About ${name}`}>
      {image && (
        // The photograph, blurred right down, tints the card with the artist's colours.
        <div className="absolute inset-0 -z-1 scale-125 opacity-30 blur-[40px] saturate-150" aria-hidden="true">
          <Artwork src={image} displayWidth={80} aspect={1165 / 604} />
        </div>
      )}
      <h2 className="type-title-2-emphasized">About {name}</h2>
      <p
        className="mt-2 max-w-[720px] type-body-tall whitespace-pre-line text-secondary data-[folded=true]:line-clamp-4"
        data-folded={long && !open}
      >
        {description}
      </p>
      {long && (
        <button className="mt-2 type-body-reduced text-key hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </section>
  );
}

/**
 * An artist (report §4): full-bleed hero with the name and Play, Top Songs,
 * then shelves. The page is tinted with the colour of the one photograph it
 * shows (YouTube's), so the picture and the colour always agree.
 */
export default function ArtistPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const artist = useArtist(id);
  const signedIn = useSignedIn();
  usePageTint(useArtworkColor(artist.data?.heroImage));
  // The photograph drifts slower than the page and swells a little as it is scrolled away.
  const scrollY = usePageScrollY();
  const reduced = useReducedMotion();
  const photoY = useTransform(scrollY, [0, 500], [0, reduced ? 0 : 120]);
  const photoScale = useTransform(scrollY, [-200, 0, 500], [reduced ? 1 : 1.12, 1, reduced ? 1 : 1.08]);

  if (missing) return <NeedsExtension />;
  if (artist.isError) return <LoadError error={artist.error} onRetry={() => void artist.refetch()} />;
  if (!artist.data) return <ArtistSkeleton />;

  const data = artist.data;
  const topSongs = { title: `${data.name}: Top Songs`, type: 'artist' as const, id: data.id };
  return (
    <>
      <CompactTitleBar title={data.name} after={260} />
      {/* The hero (report §4): full-bleed, ~1.93:1 of the content column, the name and actions centred near the bottom. */}
      <header className="relative max-h-[70vh] overflow-hidden">
        <m.div className="relative w-full origin-top will-change-transform" style={{ y: photoY, scale: photoScale }}>
          <Artwork src={data.heroImage} displayWidth={1200} aspect={1165 / 604} eager />
        </m.div>
        {/* The image melts into the page at the bottom, into the page's colour taken from it. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,color-mix(in_srgb,var(--page-tint,var(--pageBG))_70%,transparent)_80%,var(--page-tint,var(--pageBG))_100%)]"
          aria-hidden="true"
        />
        <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-1.5 px-(--body-gutter) text-center">
          <ArtistName name={data.name} />
          {data.audience && <p className="type-callout-emphasized text-secondary">{data.audience}</p>}
          <div className="mt-2.5 flex items-center gap-3">
            <button
              // The 56px key-colour play button.
              className="grid size-14 place-items-center rounded-full bg-(--keyColorBG) text-white shadow-[0_2px_6px_-4px_#0006,inset_0_0_2px_#ffffff1a] disabled:opacity-40 enabled:hover:scale-[1.04]"
              aria-label={`Play ${data.name}`}
              disabled={!data.topSongs.length}
              onClick={() => playList(data.topSongs, 0, { source: topSongs })}
            >
              <PlayIcon size={26} />
            </button>
            <button
              className="grid size-11 place-items-center rounded-full bg-[#ffffff2e] text-white [backdrop-filter:blur(20px)_saturate(1.6)] disabled:opacity-40 enabled:hover:bg-[#ffffff47]"
              aria-label={`Shuffle ${data.name}`}
              title="Shuffle"
              disabled={!data.topSongs.length}
              onClick={() => shuffleList(data.topSongs, { source: topSongs })}
            >
              <Shuffle size={18} strokeWidth={2.2} />
            </button>
            {signedIn && data.channelId && data.subscribed !== null && (
              <FollowButton artistId={data.id} channelId={data.channelId} subscribed={data.subscribed} />
            )}
          </div>
        </div>
      </header>

      {data.topSongs.length > 0 && (
        <TrackShelf
          title="Top Songs"
          to={data.topSongsSeeAll ? browseHref(data.topSongsSeeAll) : null}
          tracks={data.topSongs}
          source={topSongs}
        />
      )}

      <Shelves shelves={data.shelves} />

      {data.description && <AboutCard name={data.name} description={data.description} image={data.heroImage} />}
    </>
  );
}
