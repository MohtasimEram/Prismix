import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTrackCredits } from '@/data/music/queries';

export interface CreditsDialogProps {
  videoId: string;
  title: string;
  artist: string;
  album: string | null;
  onClose: () => void;
}

export function CreditsDialog({
  videoId,
  title,
  artist,
  album,
  onClose,
}: CreditsDialogProps) {
  const credits = useTrackCredits(videoId);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal) grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade bg-scrim" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Song credits"
        className="relative flex max-h-[min(560px,85vh)] w-[min(440px,100%)] animate-zoom flex-col overflow-hidden rounded-[14px] bg-thick-material shadow-[0_0_0_0.5px_var(--vibrantDivider),0_20px_60px_var(--glassMaterialShadowColor)] outline-none [backdrop-filter:saturate(2.2)_blur(40px)]"
      >
        <header className="flex items-center gap-3 border-b-[0.5px] border-b-vibrant-divider px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate type-title-3-emphasized text-primary">Song Credits</h2>
            <p className="truncate type-callout text-secondary">
              {title} · {artist}
            </p>
          </div>
          <button
            type="button"
            className="grid size-7 flex-none place-items-center rounded-full text-secondary hover:bg-quaternary hover:text-primary"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {credits.isPending && (
            <div className="flex flex-col gap-4 py-2" aria-busy="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <div className="h-3 w-24 animate-shimmer rounded-full bg-skeleton" />
                  <div className="h-4 w-48 animate-shimmer rounded-full bg-skeleton" />
                </div>
              ))}
            </div>
          )}

          {!credits.isPending && credits.data?.sections && credits.data.sections.length > 0 && (
            <div className="flex flex-col gap-4">
              {credits.data.sections.map((section, idx) => (
                <div key={idx} className="flex flex-col gap-1">
                  <h3 className="type-caption-1-emphasized text-secondary uppercase tracking-wider">
                    {section.title}
                  </h3>
                  <div className="flex flex-col gap-0.5">
                    {section.items.map((item, itemIdx) => (
                      <span key={itemIdx} className="type-body text-primary">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!credits.isPending && (!credits.data?.sections || credits.data.sections.length === 0) && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="type-caption-1-emphasized text-secondary uppercase tracking-wider">
                  Performed by
                </h3>
                <span className="type-body text-primary">{artist}</span>
              </div>
              {album && (
                <div className="flex flex-col gap-1">
                  <h3 className="type-caption-1-emphasized text-secondary uppercase tracking-wider">
                    Album
                  </h3>
                  <span className="type-body text-primary">{album}</span>
                </div>
              )}
              <p className="pt-2 type-callout text-tertiary">
                Detailed songwriter and producer credits aren’t available for this track.
              </p>
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t-[0.5px] border-t-vibrant-divider px-5 py-3">
          <button
            type="button"
            className="h-8 rounded-pill bg-quaternary px-4 type-callout-emphasized text-primary hover:bg-quinary"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

