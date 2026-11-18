import { PageHeader } from '@/components/PageHeader';
import { Shelves } from '@/components/music/ShelfView';
import { LoadError, NeedsExtension } from '@/components/music/States';
import { useExplore, useYouTubeReady } from '@/data/music/queries';
import { NewSkeleton } from '@/skeletons/PageSkeletons';

/** New: YouTube Music's Explore and New Releases. */
export default function NewPage() {
  const { missing } = useYouTubeReady();
  const explore = useExplore();

  if (missing) {
    return (
      <>
        <PageHeader title="New Releases" />
        <NeedsExtension />
      </>
    );
  }
  if (explore.isError) {
    return (
      <>
        <PageHeader title="New Releases" />
        <LoadError error={explore.error} onRetry={() => void explore.refetch()} />
      </>
    );
  }
  if (!explore.data) return <NewSkeleton />;
  return (
    <>
      <PageHeader title="New Releases" />
      <Shelves shelves={explore.data} />
    </>
  );
}
