import { motion as m, useReducedMotion, useTransform } from 'framer-motion';
import { Shuffle } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router';
import { CompactTitleBar, usePageScrollY } from '@/components/PageHeader';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { browseHref } from '@/components/music/links';
import { playList, shuffleList } from '@/components/music/play';
import { Shelves, TrackShelf } from '@/components/music/ShelfView';
import { LoadError, NeedsExtension } from '@/components/music/States';
import { requestAppleAccess, useAppleArtistArt, useUngrantedAppleOrigins, type AppleArtistArt } from '@/data/apple/artistArt';
import { useArtist, useYouTubeReady } from '@/data/music/queries';
import type { ArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { ArtistSkeleton } from '@/skeletons/PageSkeletons';

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The name, or Apple's title logo in its place (AppleArtistArt.kt). Until the
 * logo has drawn, the name stands in, so the header is never left empty; a
 * logo that fails to load leaves the name.
 */
function ArtistName({ name, apple }: { name: string; apple: AppleArtistArt | null }) {
  const logo = apple?.logoUrl ?? null;
  const [shown, setShown] = useState<string | null>(null);
  const logoShown = !!logo && shown === logo;
  return (
    <h1
      className="type-header-emphasized text-[clamp(34px,5vw,64px)] leading-[1.05] [text-shadow:0_2px_20px_#00000059] data-logo:w-full data-logo:[text-shadow:none]"
      data-logo={logoShown || undefined}
    >
      {!logoShown && name}
      {logo && (
        <img
          key={logo}
          // Apple's title logo in place of the name: at most 82% of the page's width and 30% of the
          // photo's height (the photo is the column's width over 1.93, and never taller than 70vh).
          className="mx-auto mt-0 mb-1.5 block h-auto max-h-[min(calc((100vw-var(--web-navigation-width))/1.93*0.3),21vh)] w-auto max-w-[min(82%,640px)] [filter:drop-shadow(0_2px_16px_#00000040)]"
          src={logo}
          alt={logoShown ? name : ''}
          hidden={!logoShown}
          // Its proportions are known before it decodes; the CSS caps its size.
          style={{ aspectRatio: String(apple!.logoAspect) }}
          decoding="async"
          onLoad={() => setShown(logo)}
        />
      )}
    </h1>
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
 * then shelves. Where Apple Music has the artist, the page takes Apple's
 * header as the phone does: its photograph, its title logo over it, its
 * colour behind the whole page, and its colour on the Play button.
 */
export default function ArtistPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const artist = useArtist(id);
  const apple = useAppleArtistArt(artist.data?.name);
  const appleUngranted = useUngrantedAppleOrigins();
  const tint = useMemo<ArtworkColor | null>(
    () => (apple ? { background: apple.background, dark: luminance(apple.background) < 0.6 } : null),
    [apple],
  );
  usePageTint(tint);
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
          {/* Apple's photograph fades in over YouTube's once it arrives. */}
          {apple && (
            <img
              key={apple.heroUrl}
              className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-400 ease-in data-loaded:opacity-100"
              src={apple.heroUrl}
              alt=""
              decoding="async"
              onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
            />
          )}
        </m.div>
        {/* The image melts into the page at the bottom (Apple's masked blur frame), into Apple's colour when the page is tinted with it. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,color-mix(in_srgb,var(--page-tint,var(--pageBG))_70%,transparent)_80%,var(--page-tint,var(--pageBG))_100%)]"
          aria-hidden="true"
        />
        <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-1.5 px-(--body-gutter) text-center">
          <ArtistName name={data.name} apple={apple} />
          {data.audience && <p className="type-callout-emphasized text-secondary">{data.audience}</p>}
          <div className="mt-2.5 flex items-center gap-3">
            <button
              // The 56px key-colour play button.
              className="grid size-14 place-items-center rounded-full bg-(--play-fill,var(--keyColorBG)) text-(--play-glyph,#fff) shadow-[0_2px_6px_-4px_#0006,inset_0_0_2px_#ffffff1a] disabled:opacity-40 enabled:hover:scale-[1.04]"
              // Apple's fill for the Play circle, with the triangle in the page's colour,
              // as the phone cuts it out of the circle; white without a key colour.
              style={
                apple
                  ? ({ '--play-fill': apple.keyColor ?? '#ffffff', '--play-glyph': apple.background } as CSSProperties)
                  : undefined
              }
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
          </div>
          {!apple && appleUngranted.length > 0 && (
            // The lyrics panel's permission notice, as a pill over the photograph.
            <div className="mt-3 flex items-center gap-2.5 rounded-[999px] bg-[#0000004d] py-1.5 pr-2 pl-3.5 type-callout text-[#ffffffcc] [backdrop-filter:blur(20px)_saturate(1.6)]">
              <span>Apple Music artist art needs the extension’s permission.</span>
              <button
                className="flex-none rounded-[999px] bg-[#ffffff26] px-2.5 py-1 type-callout-emphasized text-white hover:bg-[#ffffff40]"
                // Stays until the extension confirms the grant (checked when this tab comes back).
                onClick={requestAppleAccess}
              >
                Allow
              </button>
            </div>
          )}
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
