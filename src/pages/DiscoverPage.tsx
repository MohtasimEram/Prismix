import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Shelves } from '@/components/music/ShelfView';
import { EmptyState, LoadError, NeedsExtension } from '@/components/music/States';
import { useDiscover, useFollowed, useSignedIn, useYouTubeReady } from '@/data/music/queries';
import type { Shelf } from '@/data/music/types';
import { DiscoverSkeleton } from '@/skeletons/PageSkeletons';

/**
 * Discover: new music picked from your taste: artists like the ones in your
 * library, songs like the ones you've saved, then what's new on YouTube Music.
 * Refresh draws new picks.
 */
export default function DiscoverPage() {
  const { missing } = useYouTubeReady();
  const signedIn = useSignedIn();
  const discover = useDiscover();
  const followed = useFollowed();

  if (missing) {
    return (
      <>
        <PageHeader title="Discover" />
        <NeedsExtension />
      </>
    );
  }
  if (discover.isError) {
    return (
      <>
        <PageHeader title="Discover" />
        <LoadError error={discover.error} onRetry={() => void discover.refetch()} />
      </>
    );
  }
  if (!discover.data) return <DiscoverSkeleton />;

  // The artists you follow come first: what they released lately, then the artists themselves.
  const mine: Shelf[] = [];
  if (followed.data?.releases.length) {
    mine.push({ title: 'New from Artists You Follow', strapline: 'Latest releases', layout: 'square', items: followed.data.releases, seeAll: null });
  }
  if (followed.data?.artists.length) {
    mine.push({ title: 'Artists You Follow', strapline: null, layout: 'circle', items: followed.data.artists.slice(0, 30), seeAll: null });
  }
  const shelves = [...mine, ...(discover.data ?? [])];
  const followsNobody = signedIn && !!followed.data && followed.data.artists.length === 0;

  return (
    <>
      <PageHeader title="Discover" />
      <div className="mx-(--body-gutter) -mt-1 flex flex-wrap items-center gap-3">
        <p className="type-body-reduced text-secondary">
          {signedIn
            ? followsNobody
              ? 'Follow artists from their pages and their new releases will show up here.'
              : 'Picked from the artists and songs in your library.'
            : 'Sign in to YouTube Music to get picks based on your own library.'}
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-full bg-quinary px-3 py-1.5 type-callout-emphasized text-primary shadow-[inset_0_0_0_0.5px_var(--vibrantDivider)] hover:bg-quaternary disabled:opacity-50"
          disabled={discover.isFetching}
          onClick={() => void discover.refetch()}
        >
          <RefreshCw size={14} className={discover.isFetching ? 'animate-spin' : undefined} />
          Refresh picks
        </button>
      </div>
      {shelves.length ? <Shelves shelves={shelves} /> : <EmptyState title="Nothing to discover yet" detail="Try again in a moment." />}
    </>
  );
}
