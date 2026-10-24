import { Clock, Play, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useRecentSearches } from '@/state/recentSearches';
import { PrefetchLink } from '@/components/PrefetchLink';
import { Artwork } from '@/components/music/Artwork';
import { CategoryTiles } from '@/components/music/CategoryTiles';
import { hrefFor } from '@/components/music/links';
import { playTrack } from '@/components/music/play';
import { SearchField } from '@/components/music/SearchField';
import { VideoLockup } from '@/components/music/Lockups';
import { Shelves } from '@/components/music/ShelfView';
import { EmptyState, LoadError, NeedsExtension } from '@/components/music/States';
import { useCategories, useSearch, useYouTubeReady } from '@/data/music/queries';
import type { MusicItem, SearchResults, Shelf } from '@/data/music/types';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';
import { ShelfSkeleton } from '@/skeletons/ShelfSkeleton';

const KIND_LABEL: Record<MusicItem['kind'], string> = {
  song: 'Song',
  video: 'Video',
  album: 'Album',
  playlist: 'Playlist',
  'spotify-playlist': 'Spotify Playlist',
  artist: 'Artist',
  episode: 'Episode',
  podcast: 'Podcast',
  unknown: '',
};

/** Apple's result shelves, in its order, from results grouped by kind. */
function shelvesFor(results: SearchResults): Shelf[] {
  const shelf = (title: string, items: MusicItem[], layout: Shelf['layout']): Shelf | null =>
    items.length ? { title, strapline: null, layout, items, seeAll: null } : null;
  return [
    shelf('Artists', results.artists, 'circle'),
    shelf('Albums', results.albums, 'square'),
    shelf('Songs', results.songs, 'tracks'),
    shelf('Playlists', results.playlists, 'square'),
  ].filter((s): s is Shelf => !!s);
}

type Tab = 'all' | 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

/** The result tabs, Videos right after Songs; a tab shows only when the search found something of its kind. */
function tabsFor(results: SearchResults): { id: Tab; label: string }[] {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: 1 },
    { id: 'songs', label: 'Songs', count: results.songs.length },
    { id: 'videos', label: 'Videos', count: results.videos.length },
    { id: 'albums', label: 'Albums', count: results.albums.length },
    { id: 'artists', label: 'Artists', count: results.artists.length },
    { id: 'playlists', label: 'Playlists', count: results.playlists.length },
  ];
  return tabs.filter((t) => t.count > 0);
}

const isTab = (value: string | null): value is Tab => ['all', 'songs', 'videos', 'albums', 'artists', 'playlists'].includes(value ?? '');

function TabBar({ tabs, current, onSelect }: { tabs: { id: Tab; label: string }[]; current: Tab; onSelect: (tab: Tab) => void }) {
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" aria-label="Result types" className="mx-(--body-gutter) mt-1 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === current}
          className="rounded-full bg-quinary px-3.5 py-1.5 type-callout-emphasized text-primary shadow-[inset_0_0_0_0.5px_var(--vibrantDivider)] transition-colors duration-100 hover:bg-quaternary aria-selected:bg-key aria-selected:text-white aria-selected:shadow-none"
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

const sectionTitle = 'mx-(--body-gutter) mt-3 type-title-2-emphasized';
// Top Results: 3 columns, gap 20px; 118px cards with 90px artwork.
const topGrid =
  'mx-(--body-gutter) mt-3 mb-8 grid grid-cols-3 gap-5 max-lg:grid-cols-2 max-[607px]:grid-cols-[minmax(0,1fr)] max-[607px]:gap-1';
const top =
  'group/top relative grid min-h-[118px] grid-cols-[90px_minmax(0,1fr)] items-center gap-x-3.5 rounded-[12px] bg-quinary px-3 py-3.5 text-left shadow-[inset_0_0_0_0.5px_var(--vibrantDivider)] transition-[background-color,translate,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:bg-quaternary hover:shadow-[inset_0_0_0_0.5px_var(--vibrantDivider),0_6px_20px_#00000026] motion-reduce:transition-none';
const topText = 'flex min-w-0 flex-col gap-0.5';

function TopResult({ item }: { item: MusicItem }) {
  const href = hrefFor(item);
  const body = (
    <>
      <div className="relative w-[90px]">
        <Artwork src={item.thumbnail} displayWidth={90} radius={item.kind === 'artist' ? '50%' : 'var(--radius-artwork-small)'} />
        {/* A song or video plays on click: say so with a play glyph over its cover on hover. */}
        {!href && (
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center rounded-artwork-sm bg-[rgb(0_0_0/0.45)] text-white opacity-0 transition-opacity duration-150 group-hover/top:opacity-100 group-focus-visible/top:opacity-100"
          >
            <Play size={24} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </div>
      <div className={topText}>
        {KIND_LABEL[item.kind] && (
          <span className="w-fit rounded-full bg-quaternary px-2 py-px type-[600_10px/14px] tracking-[0.04em] text-secondary uppercase">
            {KIND_LABEL[item.kind]}
          </span>
        )}
        <span className="line-clamp-2 type-title-3">{item.title}</span>
        {item.kind !== 'artist' && item.artists.length > 0 && (
          <span className="truncate type-callout text-secondary">{item.artists.map((a) => a.name).join(', ')}</span>
        )}
      </div>
    </>
  );
  return href ? (
    <PrefetchLink to={href} className={top}>
      {body}
    </PrefetchLink>
  ) : (
    <button className={top} onClick={() => playTrack(item)}>
      {body}
    </button>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-busy="true">
      <div className={sectionTitle}>
        <SkeletonLine lineHeight={22} fontSize={17} width={130} />
      </div>
      <div className={topGrid} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={top}>
            <SkeletonBlock width={90} height={90} radius="var(--radius-artwork-small)" />
            <div className={topText}>
              <SkeletonLine lineHeight={20} fontSize={15} width="70%" />
              <SkeletonLine lineHeight={15} fontSize={12} width="40%" />
            </div>
          </div>
        ))}
      </div>
      <ShelfSkeleton kind="circle" />
      <ShelfSkeleton kind="square" />
    </div>
  );
}

function Results({ query }: { query: string }) {
  const search = useSearch(query);
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  if (search.isError) return <LoadError error={search.error} onRetry={() => void search.refetch()} />;
  if (!search.data) return <ResultsSkeleton />;
  const results = search.data;
  const shelves = shelvesFor(results);
  if (!results.top.length && !shelves.length && !results.videos.length) {
    return <EmptyState title="No Results" detail={`Try a new search for something other than “${query}”.`} />;
  }
  const tabs = tabsFor(results);
  // A tab the results don't have (a stale link) falls back to All.
  const current: Tab = isTab(requested) && tabs.some((t) => t.id === requested) ? requested : 'all';
  const select = (tab: Tab) => setParams(tab === 'all' ? { q: query } : { q: query, tab }, { replace: true });
  const only = (title: string, items: MusicItem[], layout: Shelf['layout']): Shelf[] =>
    items.length ? [{ title, strapline: null, layout, items, seeAll: null }] : [];
  return (
    <>
      <TabBar tabs={tabs} current={current} onSelect={select} />
      {current === 'all' && (
        <>
          {results.top.length > 0 && (
            <section aria-label="Top Results">
              <h2 className={sectionTitle}>Top Results</h2>
              <div className={topGrid}>
                {results.top.map((item) => (
                  <TopResult key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
          <Shelves shelves={shelves} />
        </>
      )}
      {current === 'songs' && <Shelves shelves={only('Songs', results.songs, 'tracks')} />}
      {current === 'albums' && <Shelves shelves={only('Albums', results.albums, 'square')} />}
      {current === 'artists' && <Shelves shelves={only('Artists', results.artists, 'circle')} />}
      {current === 'playlists' && <Shelves shelves={only('Playlists', results.playlists, 'square')} />}
      {current === 'videos' && (
        <section aria-label="Videos" className="mt-3 pb-4">
          <h2 className="mx-(--body-gutter) mb-3 type-title-2-emphasized">Videos</h2>
          <div className="mx-(--body-gutter) grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-5 gap-y-7">
            {results.videos.map((item) => (
              <VideoLockup key={item.id} item={item} width={320} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** The page's opening: a title, and the searches made before, to run again or forget. */
function Hero({ onSearch }: { onSearch: (query: string) => void }) {
  const recent = useRecentSearches((s) => s.recent);
  const remove = useRecentSearches((s) => s.remove);
  const clear = useRecentSearches((s) => s.clear);
  return (
    <header className="mx-(--body-gutter) pt-4 pb-2">
      <h1 className="type-[700_34px/40px] tracking-[-0.02em]">Search</h1>
      <p className="mt-1 type-body text-secondary">Find artists, songs, videos, albums and playlists, or browse by mood and genre.</p>
      {recent.length > 0 && (
        <section className="mt-5" aria-label="Recent searches">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="type-callout-emphasized text-secondary">Recent Searches</h2>
            <button type="button" className="type-callout text-key hover:underline" onClick={clear}>
              Clear
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((query) => (
              <li key={query} className="group/chip flex items-center rounded-full bg-quinary shadow-[inset_0_0_0_0.5px_var(--vibrantDivider)] transition-[background-color] duration-100 hover:bg-quaternary">
                <button
                  type="button"
                  className="flex max-w-[260px] items-center gap-1.5 rounded-full py-1.5 ps-3 pe-1.5 type-callout text-primary"
                  onClick={() => onSearch(query)}
                >
                  <Clock size={13} strokeWidth={2.2} className="flex-none text-secondary" aria-hidden="true" />
                  <span className="truncate">{query}</span>
                </button>
                <button
                  type="button"
                  className="mr-1.5 grid size-5 flex-none place-items-center rounded-full text-secondary hover:bg-quaternary hover:text-primary"
                  aria-label={`Remove ${query} from recent searches`}
                  onClick={() => remove(query)}
                >
                  <X size={12} strokeWidth={2.6} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </header>
  );
}

function Landing({ onSearch }: { onSearch: (query: string) => void }) {
  const categories = useCategories();
  const body = categories.isError ? (
    <LoadError error={categories.error} onRetry={() => void categories.refetch()} />
  ) : !categories.data ? (
    <div className="mx-(--body-gutter) mt-8 mb-8 grid grid-cols-4 gap-5 max-lg:grid-cols-3 max-[607px]:grid-cols-2" aria-busy="true">
      {Array.from({ length: 12 }, (_, i) => (
        <SkeletonBlock key={i} aspectRatio="16 / 9" radius="var(--radius-artwork-large)" />
      ))}
    </div>
  ) : (
    <CategoryTiles groups={categories.data.map((g) => ({ ...g, title: g.title || 'Browse Categories' }))} />
  );
  return (
    <>
      <Hero onSearch={onSearch} />
      {body}
    </>
  );
}

/** Search (report §6): a sticky bar with the field, then categories or grouped results. */
export default function SearchPage() {
  const { missing } = useYouTubeReady();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const addRecent = useRecentSearches((s) => s.add);
  const search = (q: string) => {
    const trimmed = q.trim();
    if (trimmed) addRecent(trimmed);
    setParams(trimmed ? { q: trimmed } : {});
  };

  return (
    <>
      {/*
        The sticky scope bar holding the field (report §6: 62px, padding 12px 0). Its glass sits on
        a layer behind it, not on the bar: an element with a backdrop-filter is a backdrop root, so
        the suggestions inside it could only blur the bar itself and showed the page underneath unblurred.
      */}
      <div className="sticky top-0 z-[calc(var(--z-default)+5)] flex justify-center px-(--body-gutter) py-3 before:absolute before:inset-0 before:-z-1 before:bg-header-material before:[backdrop-filter:saturate(180%)_blur(20px)]">
        <SearchField initial={query} onSearch={search} />
      </div>
      {missing ? <NeedsExtension what="and search YouTube Music" /> : query ? <Results query={query} /> : <Landing onSearch={search} />}
    </>
  );
}
