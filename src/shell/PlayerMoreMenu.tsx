import { Disc, Download, Gauge, MoreVertical, Trash2, User, Video, VideoOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { Menu, MenuItem, MenuSeparator } from '@/components/Menu';
import { ShareItem } from '@/components/music/TrackMenu';
import { artistCredits, normalizedArtistName } from '@/lib/artistCredits';
import { downloadTrack, removeDownload, useDownloads } from '@/playback/download';
import { usePlayer } from '@/state/player';
import { useDownloadsLibrary } from '@/state/downloadsLibrary';
import { isVideoId } from '@/state/dragTrack';
import { useVideo, useWatchVideo } from '@/state/video';
import { albumPageFor, artistPageFor } from './nowPlayingLinks';
import { TempoPitchPanel } from './TempoPitchButton';

/**
 * The player bar's ⋮ menu, after the volume: Go to Album and Go to Artist, Download (saves
 * the playing song; once saved, deletes the file again), Watch Video (when the song has one), Tempo & Pitch and Share.
 */
export function PlayerMoreMenu({ className, onActivate }: { className?: string; /** Pointer or focus arrives on the button: the volume level next to it can slide away. */ onActivate?: (() => void) | undefined }) {
  const track = usePlayer((s) => (s.index >= 0 ? s.queue[s.index]?.track ?? null : null));
  const working = useDownloads((s) => !!track && s.entries.some((e) => e.videoId === track.videoId && e.state === 'working'));
  const saved = useDownloadsLibrary((s) => !!track && s.songs.some((x) => x.videoId === track.videoId));
  // A track with a picture to offer can be watched instead of just heard (state/video.ts).
  const videoOffered = useVideo((s) => !!track && s.offered === track.videoId);
  const watch = useWatchVideo((s) => s.watch);
  const toggleWatch = useWatchVideo((s) => s.toggle);
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  // The queue's row for what's playing: it carries the album and each artist's channel.
  const entry = usePlayer((s) => {
    const row = s.queue[s.index]?.track;
    return row && row.videoId === s.nowPlaying?.videoId ? row : null;
  });
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // The element the tempo panel hangs from, kept after the menu closes.
  const [tempoAnchor, setTempoAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setAnchor(null), []);
  const closeTempo = useCallback(() => setTempoAnchor(null), []);

  // Each credited artist once, as the player's own credit line reads them.
  const seen = new Set<string>();
  const credits = nowPlaying
    ? artistCredits(nowPlaying.artist, entry?.artists ?? [])
        .filter((credit) => {
          const key = normalizedArtistName(credit.name);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 4)
    : [];
  // Works out where the page is (nowPlayingLinks.ts), then goes; a failure leaves the page as it is.
  const go = (resolve: () => Promise<string>) => {
    closeMenu();
    void resolve().then(
      (to) => navigate(to),
      () => undefined,
    );
  };

  return (
    <>
      <button
        className={className}
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onPointerEnter={onActivate}
        onFocus={onActivate}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <MoreVertical size={18} strokeWidth={2.2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} placement="above-end" onClose={closeMenu} label="More">
          {nowPlaying && (
            <>
              <MenuItem
                icon={<Disc size={15} />}
                onSelect={() =>
                  go(() => albumPageFor(nowPlaying.videoId, entry?.album ?? null, [nowPlaying.title, nowPlaying.artist].filter(Boolean).join(' ')))
                }
              >
                Go to Album
              </MenuItem>
              {credits.map((credit) => (
                <MenuItem key={`${credit.id ?? ''}${credit.name}`} icon={<User size={15} />} onSelect={() => go(() => artistPageFor(nowPlaying.videoId, credit))}>
                  {credits.length === 1 ? 'Go to Artist' : `Go to ${credit.name}`}
                </MenuItem>
              ))}
              <MenuSeparator />
            </>
          )}
          {track && !track.unavailable && (
            <MenuItem
              icon={saved ? <Trash2 size={15} /> : <Download size={15} />}
              disabled={working}
              destructive={saved && !working}
              onSelect={() => {
                closeMenu();
                void (saved ? removeDownload(track) : downloadTrack(track));
              }}
            >
              {working ? 'Downloading…' : saved ? 'Remove Download' : 'Download'}
            </MenuItem>
          )}
          {videoOffered && (
            <MenuItem
              icon={watch ? <VideoOff size={15} /> : <Video size={15} />}
              onSelect={() => {
                closeMenu();
                toggleWatch();
              }}
            >
              {watch ? 'Listen Only' : 'Watch Video'}
            </MenuItem>
          )}
          <MenuItem
            icon={<Gauge size={15} />}
            onSelect={() => {
              setTempoAnchor(anchor);
              closeMenu();
            }}
          >
            Tempo &amp; Pitch
          </MenuItem>
          {track && isVideoId(track.videoId) && <ShareItem videoId={track.videoId} onClose={closeMenu} />}
        </Menu>
      )}
      {tempoAnchor && <TempoPitchPanel anchor={tempoAnchor} onClose={closeTempo} />}
    </>
  );
}
