import { Download } from 'lucide-react';
import { downloadTrack, removeDownload } from '@/playback/download';
import { usePlayer } from '@/state/player';
import { useDownloads } from '@/playback/download';
import { useDownloadsLibrary } from '@/state/downloadsLibrary';

/** The player bar's Download: saves the song that is playing; once saved, a click deletes the file again. */
export function DownloadButton({ className }: { className?: string }) {
  const track = usePlayer((s) => (s.index >= 0 ? s.queue[s.index]?.track ?? null : null));
  const working = useDownloads((s) => !!track && s.entries.some((e) => e.videoId === track.videoId && e.state === 'working'));
  const saved = useDownloadsLibrary((s) => !!track && s.songs.some((x) => x.videoId === track.videoId));
  if (!track || track.unavailable) return null;
  const label = working ? 'Downloading…' : saved ? 'Downloaded. Click to delete the file' : 'Download';
  return (
    <button className={className} aria-label={label} title={label} aria-pressed={saved} disabled={working} onClick={() => void (saved ? removeDownload(track) : downloadTrack(track))}>
      <Download size={18} strokeWidth={2.2} />
    </button>
  );
}
