import { Download } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { appVersion, startUpdateChecks, useUpdater } from '@/desktop/updater';

/** Inline markdown: **bold**, `code`, and [text](url) shown as its text. Nothing is ever injected as HTML. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  let n = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={key} className="text-primary">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={key} className="rounded-[4px] bg-quaternary px-1 text-[0.92em]">{m[2]}</code>);
    else out.push(m[3]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The release notes as headings, bullets and paragraphs. */
function Changelog({ notes }: { notes: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (at: number) => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${at}`} className="flex list-disc flex-col gap-1 ps-5">
        {items.map((item, i) => <li key={i}>{inline(item, `li-${at}-${i}`)}</li>)}
      </ul>,
    );
  };
  notes.split(/\r?\n/).forEach((raw, at) => {
    const line = raw.trim();
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]!);
      return;
    }
    flush(at);
    if (heading) blocks.push(<h3 key={at} className="mt-1 type-callout-emphasized text-primary">{inline(heading[1]!, `h-${at}`)}</h3>);
    else if (line) blocks.push(<p key={at}>{inline(line, `p-${at}`)}</p>);
  });
  flush(notes.length);
  return <div className="flex flex-col gap-2 type-callout text-secondary">{blocks}</div>;
}

/** Checks for updates in the background and offers one in a centred window, like Add to Playlist. */
export function UpdateDialog() {
  const status = useUpdater((s) => s.status);
  const version = useUpdater((s) => s.version);
  const notes = useUpdater((s) => s.notes);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const dismissed = useUpdater((s) => s.dismissed);
  const install = useUpdater((s) => s.install);
  const dismiss = useUpdater((s) => s.dismiss);
  const panel = useRef<HTMLDivElement>(null);
  const current = useQuery({ queryKey: ['desktop', 'version'], queryFn: appVersion, staleTime: Infinity });

  useEffect(() => startUpdateChecks(), []);

  const busy = status === 'downloading' || status === 'installing';
  // An error only shows here once a download was under way (version is set); a failed check stays quiet.
  const failed = status === 'error' && !!version && !dismissed;
  const open = busy || failed || (status === 'available' && !dismissed);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!useUpdater.getState().status.match(/downloading|installing/)) dismiss();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open, dismiss]);

  if (!open) return null;
  const percent = Math.round((progress ?? 0) * 100);
  return createPortal(
    <div className="fixed inset-0 z-(--z-modal) grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade bg-scrim" onPointerDown={() => !busy && dismiss()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Update available"
        className="relative flex max-h-[min(560px,100%)] w-[min(440px,100%)] animate-zoom flex-col overflow-hidden rounded-[14px] bg-thick-material shadow-[0_0_0_0.5px_var(--vibrantDivider),0_20px_60px_var(--glassMaterialShadowColor)] outline-none [backdrop-filter:saturate(2.2)_blur(40px)]"
      >
        <header className="flex items-center gap-3 px-4 pt-4 pb-2">
          <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-key text-white">
            <Download size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate type-title-3-emphasized text-primary">Prismix {version} is available</h2>
            <p className="truncate type-callout text-secondary">{current.data ? `You have ${current.data}` : 'A new version is ready'}</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <p className="mb-1.5 type-callout-emphasized text-primary">What’s new</p>
          {notes?.trim() ? <Changelog notes={notes} /> : <p className="type-callout text-secondary">No release notes were provided.</p>}
        </div>

        {(busy || failed) && (
          <div className="px-4 pt-1 pb-2" aria-live="polite">
            {busy ? (
              <>
                <p className="mb-1 type-callout text-secondary">
                  {status === 'installing' ? 'Installing. Prismix will restart.' : progress === null ? 'Downloading…' : `Downloading… ${percent}%`}
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-quaternary">
                  <div className="h-full bg-key transition-[width] duration-200" style={{ width: `${percent}%` }} />
                </div>
              </>
            ) : (
              <p role="alert" className="type-callout text-key">Couldn’t update: {error}</p>
            )}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 px-4 pt-2 pb-4">
          <button
            type="button"
            className="h-8 rounded-pill bg-quaternary px-4 type-callout-emphasized text-primary disabled:opacity-40 enabled:hover:bg-tertiary"
            disabled={busy}
            onClick={dismiss}
          >
            Remind me later
          </button>
          <button
            type="button"
            className="h-8 rounded-pill bg-key px-4 type-callout-emphasized text-white disabled:opacity-60 enabled:hover:opacity-90"
            disabled={busy}
            onClick={() => void install()}
          >
            {busy ? 'Updating…' : failed ? 'Try again' : 'Download now'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
