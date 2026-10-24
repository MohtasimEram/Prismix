import { PrefetchLink } from '@/components/PrefetchLink';

/** A page-sized message, centred: also the Spotify page's sign-in invitation. */
export const stateStyles = {
  state: 'mx-auto my-20 flex max-w-[420px] flex-col items-center gap-2 px-(--body-gutter) text-center',
  title: 'type-title-2-emphasized',
  detail: 'type-body-tall text-secondary',
  button: 'mt-3 inline-flex h-8 items-center rounded-pill bg-key-bg px-4 type-body-emphasized text-white',
};

/**
 * Shown where a YouTube page would be when Prismix runs outside its desktop
 * shell (a plain browser on `npm run dev`), which has no native network layer.
 */
export function NeedsExtension({ what = 'YouTube Music' }: { what?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Open {what} in the Prismix app</p>
      <p className={stateStyles.detail}>
        This page needs the desktop app’s network layer. Start it with <code>npm run tauri dev</code> instead of a browser tab.
      </p>
      <PrefetchLink to="/settings" className={stateStyles.button}>
        Settings
      </PrefetchLink>
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Couldn’t load this page</p>
      <p className={stateStyles.detail}>{error instanceof Error ? error.message : String(error)}</p>
      <button className={stateStyles.button} onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>{title}</p>
      {detail && <p className={stateStyles.detail}>{detail}</p>}
    </div>
  );
}

/** A later page of a long list failed: what's loaded stays, with a way to try again. */
export function LoadMoreError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center gap-2.5 px-(--body-gutter) pt-6 pb-10 type-callout text-secondary">
      <span>Couldn’t load more.</span>
      <button className="type-callout-emphasized text-key" onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}
