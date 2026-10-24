import { Check, ListPlus, TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAddToPlaylist, usePlaylistOptions, useSignedIn } from '@/data/music/queries';
import { isVideoId } from '@/state/dragTrack';

/**
 * The player bar's Add to Playlist: a button that opens a small list of the
 * account's playlists above it; picking one adds the playing song. Shown
 * signed in only, as the track menu's Add to Playlist is.
 */
export function AddToPlaylistButton({ videoId, className }: { videoId: string | null; className?: string }) {
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const valid = isVideoId(videoId);
  const options = usePlaylistOptions(videoId ?? '', open && valid);
  const add = useAddToPlaylist();
  // The playlist just chosen, and how it went; cleared with the panel or a different song.
  const [result, setResult] = useState<{ playlistId: string; ok: boolean } | null>(null);

  useEffect(() => {
    setOpen(false);
    setResult(null);
  }, [videoId]);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    setPosition({
      right: Math.max(8, window.innerWidth - rect.right - 8),
      bottom: window.innerHeight - rect.top + 10,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!signedIn || !valid || !videoId) return null;

  return (
    <>
      <button
        ref={button}
        className={className}
        aria-label="Add to Playlist"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add to Playlist"
        onClick={() => {
          setResult(null);
          setOpen((v) => !v);
        }}
      >
        <ListPlus size={18} strokeWidth={2.2} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Add to Playlist"
            className="fixed z-(--z-contextual-menus) flex max-h-[min(360px,60vh)] w-[272px] animate-menu-in flex-col rounded-[12px] bg-thick-material py-2 shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_40px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
            style={position}
          >
            <span className="px-4 pt-1 pb-2 type-title-3-emphasized text-primary">Add to Playlist</span>
            <div className="min-h-0 overflow-y-auto">
              {options.isPending && <p className="px-4 py-2 type-body-reduced text-secondary">Loading…</p>}
              {options.isError && <p className="px-4 py-2 type-body-reduced text-secondary">Couldn’t load your playlists</p>}
              {options.data?.length === 0 && <p className="px-4 py-2 type-body-reduced text-secondary">No playlists yet</p>}
              {options.data?.map((option) => {
                const mine = result?.playlistId === option.playlistId ? result : null;
                return (
                  <button
                    key={option.playlistId}
                    className="flex w-full items-center gap-2 px-4 py-1.5 text-start type-body-reduced hover:bg-quinary focus-visible:bg-quinary"
                    disabled={add.isPending}
                    onClick={() =>
                      add.mutate(
                        { playlistId: option.playlistId, videoId },
                        {
                          onSuccess: () => setResult({ playlistId: option.playlistId, ok: true }),
                          onError: () => setResult({ playlistId: option.playlistId, ok: false }),
                        },
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{option.title}</span>
                    {mine && (mine.ok ? <Check size={15} className="text-green" aria-label="Added" /> : <TriangleAlert size={15} className="text-destructive" aria-label="Couldn’t add" />)}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
