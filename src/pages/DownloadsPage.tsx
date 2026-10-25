import { Copy, Play, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Artwork } from '@/components/music/Artwork';
import { playTrack } from '@/components/music/play';
import { EmptyState } from '@/components/music/States';
import { useDownloadsLibrary, type DownloadedSong } from '@/state/downloadsLibrary';

const iconButton = 'grid size-8 place-items-center rounded-full text-secondary hover:bg-quinary hover:text-primary';

function Row({ song }: { song: DownloadedSong }) {
  const remove = useDownloadsLibrary((s) => s.remove);
  return (
    <li className="group/row grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-row px-2.5 py-2 hover:bg-quinary">
      <Artwork src={song.thumbnail} displayWidth={48} radius="var(--radius-artwork-small)" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate type-body text-primary">{song.title}</span>
        <span className="truncate type-callout text-secondary">{song.artist}</span>
        <span className="truncate type-callout text-tertiary" title={song.path || undefined}>
          {song.quality}
          {song.path ? ` · ${song.path}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className={iconButton}
          aria-label={`Play ${song.title}`}
          title="Play"
          onClick={() => playTrack({ videoId: song.videoId, title: song.title, artists: song.artist ? [{ name: song.artist, id: null }] : [], album: null, durationSec: null, explicit: false, thumbnail: song.thumbnail, index: null, plays: null })}
        >
          <Play size={15} />
        </button>
        {song.path && (
          <button className={iconButton} aria-label="Copy file location" title="Copy file location" onClick={() => void navigator.clipboard?.writeText(song.path).catch(() => undefined)}>
            <Copy size={15} />
          </button>
        )}
        <button className={iconButton} aria-label={`Remove ${song.title} from this list`} title="Remove from this list (the file stays on your computer)" onClick={() => remove(song.videoId)}>
          <X size={16} />
        </button>
      </div>
    </li>
  );
}

/**
 * Downloads: the songs saved from Prismix. They are ordinary audio files in your Downloads/Prismix
 * folder; this list is Prismix's record of them. Removing a row forgets it and leaves the file.
 */
export default function DownloadsPage() {
  const songs = useDownloadsLibrary((s) => s.songs);
  const clear = useDownloadsLibrary((s) => s.clear);
  return (
    <>
      <PageHeader title="Downloads" />
      <div className="mx-(--body-gutter) -mt-1 flex flex-wrap items-center gap-3">
        <p className="type-body-reduced text-secondary">
          Songs you save go to the Prismix folder inside your Downloads folder. Use ⋯ › Download on a song, the download button on the player bar, or Download all on an album or playlist.
        </p>
        {songs.length > 0 && (
          <button className="type-callout-emphasized text-key" onClick={clear}>
            Clear list
          </button>
        )}
      </div>
      {songs.length === 0 ? (
        <EmptyState title="No downloads yet" detail="Songs you download will be listed here." />
      ) : (
        <ul className="mx-(--body-gutter) mt-3 flex flex-col pb-[120px]">
          {songs.map((song) => (
            <Row key={song.videoId} song={song} />
          ))}
        </ul>
      )}
    </>
  );
}
