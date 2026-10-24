import { Check, Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { useDownloads, type DownloadEntry } from '@/playback/download';

function Toast({ entry }: { entry: DownloadEntry }) {
  const dismiss = useDownloads((s) => s.dismiss);
  // A finished download clears itself; a failure stays until it is read.
  useEffect(() => {
    if (entry.state !== 'done') return;
    const id = setTimeout(() => dismiss(entry.videoId), 6000);
    return () => clearTimeout(id);
  }, [entry.state, entry.videoId, dismiss]);
  return (
    <li className="pointer-events-auto flex w-[300px] items-center gap-2.5 rounded-[10px] bg-thin-material px-3 py-2.5 shadow-glass [backdrop-filter:saturate(180%)_blur(60px)]">
      <span className="grid size-6 flex-none place-items-center text-secondary">
        {entry.state === 'done' ? <Check size={16} /> : <Download size={16} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate type-callout-emphasized">{entry.title}</span>
        <span className={`truncate type-callout ${entry.state === 'failed' ? 'text-key' : 'text-secondary'}`}>
          {entry.state === 'working' ? `${Math.round(entry.progress * 100)}% · ${entry.detail}` : entry.state === 'done' ? `Saved · ${entry.detail}` : `Couldn’t download · ${entry.detail}`}
        </span>
        {entry.state === 'working' && (
          <span className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-quaternary">
            <span className="block h-full bg-key transition-[width] duration-200" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
          </span>
        )}
      </span>
      {entry.state !== 'working' && (
        <button className="grid size-6 flex-none place-items-center rounded-full text-secondary hover:bg-quaternary" aria-label="Dismiss" onClick={() => dismiss(entry.videoId)}>
          <X size={14} />
        </button>
      )}
    </li>
  );
}

/** Downloads in progress, finished or failed, above the player pill's corner. */
export function DownloadToasts() {
  const entries = useDownloads((s) => s.entries);
  if (!entries.length) return null;
  return (
    <ul className="pointer-events-none absolute right-4 bottom-[calc(var(--player-pill-height)+var(--player-bottom-offset)+16px)] z-[calc(var(--z-web-chrome)+1)] flex flex-col gap-2" aria-live="polite">
      {entries.map((entry) => (
        <Toast key={entry.videoId} entry={entry} />
      ))}
    </ul>
  );
}
