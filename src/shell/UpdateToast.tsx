import { Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { startUpdateChecks, useUpdater } from '@/desktop/updater';

/** Checks for updates in the background and offers one when it is found. */
export function UpdateToast() {
  const status = useUpdater((s) => s.status);
  const version = useUpdater((s) => s.version);
  const progress = useUpdater((s) => s.progress);
  const dismissed = useUpdater((s) => s.dismissed);
  const install = useUpdater((s) => s.install);
  const dismiss = useUpdater((s) => s.dismiss);

  useEffect(() => startUpdateChecks(), []);

  const busy = status === 'downloading' || status === 'installing';
  if (!(status === 'available' && !dismissed) && !busy) return null;
  return (
    <div className="pointer-events-none absolute right-4 bottom-[calc(var(--player-pill-height)+var(--player-bottom-offset)+16px)] z-[calc(var(--z-web-chrome)+2)]" aria-live="polite">
      <div className="pointer-events-auto flex w-[300px] items-center gap-2.5 rounded-[10px] bg-thin-material px-3 py-2.5 shadow-glass [backdrop-filter:saturate(180%)_blur(60px)]">
        <span className="grid size-6 flex-none place-items-center text-secondary">
          <Download size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate type-callout-emphasized">{busy ? 'Updating Prismix…' : `Prismix ${version} is available`}</span>
          <span className="truncate type-callout text-secondary">
            {status === 'installing' ? 'Installing, Prismix will restart' : status === 'downloading' ? (progress === null ? 'Downloading…' : `${Math.round(progress * 100)}%`) : 'Update now and restart.'}
          </span>
          {busy && (
            <span className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-quaternary">
              <span className="block h-full bg-key transition-[width] duration-200" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </span>
          )}
        </span>
        {!busy && (
          <>
            <button className="flex-none rounded-[12px] bg-quaternary px-2.5 py-[3px] type-callout-emphasized text-primary hover:bg-tertiary" onClick={() => void install()}>
              Update
            </button>
            <button className="grid size-6 flex-none place-items-center rounded-full text-secondary hover:bg-quaternary" aria-label="Dismiss" onClick={dismiss}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
