import { Download } from 'lucide-react';
import { useState } from 'react';
import type { Track } from '@/data/music/types';
import { downloadMany, removeMany } from '@/playback/download';
import { useDownloadsLibrary } from '@/state/downloadsLibrary';
import { detailButton } from './DetailHeader';

/**
 * Saves every song of an album or playlist, two at a time; those already saved are skipped.
 * Once every song is saved the button turns the key colour, like the player bar's Download, and
 * a click deletes all of those files again. Progress shows in the download toasts.
 */
export function DownloadAllButton({ tracks, label = 'Songs' }: { tracks: readonly Track[]; label?: string }) {
  const [busy, setBusy] = useState(false);
  const downloadable = tracks.filter((t) => !t.unavailable);
  const allSaved = useDownloadsLibrary((s) => {
    if (!downloadable.length) return false;
    const have = new Set(s.songs.map((x) => x.videoId));
    return downloadable.every((t) => have.has(t.videoId));
  });
  const title = busy ? (allSaved ? 'Deleting…' : 'Downloading…') : allSaved ? 'Downloaded. Click to delete all the files' : 'Download all';
  return (
    <button
      className={`${detailButton.circle} aria-pressed:text-key`}
      aria-label={allSaved ? 'Delete all downloads' : 'Download all'}
      aria-pressed={allSaved}
      title={title}
      disabled={busy || downloadable.length === 0}
      onClick={() => {
        setBusy(true);
        const job = allSaved ? removeMany(downloadable, label) : downloadMany(tracks);
        void job.finally(() => setBusy(false));
      }}
    >
      <Download size={16} strokeWidth={2.2} />
    </button>
  );
}
