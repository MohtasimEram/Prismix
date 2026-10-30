import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlaylistCover } from '@/components/music/PlaylistCover';
import { useNotices } from '@/state/notices';
import { useUi } from '@/state/ui';

const SHOW_MS = 3600;

/**
 * "Added to Gymm", with the playlist's cover, above the player pill: where the eye
 * already is when a song is added. It goes by itself after a few seconds, and waits
 * while the pointer is over it. Over the full-screen player it sits at the bottom.
 */
export function PlayerNotice() {
  const notice = useNotices((s) => s.notice);
  const dismiss = useNotices((s) => s.dismiss);
  const sidePanel = useUi((s) => s.sidePanel);
  const fullScreen = useUi((s) => s.fullScreen);
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!notice || held) return;
    const timer = setTimeout(dismiss, notice.tone === 'error' ? SHOW_MS + 2000 : SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, held, dismiss]);

  return createPortal(
    <div
      className={`pointer-events-none fixed right-0 left-(--web-navigation-width) z-[calc(var(--z-contextual-menus)+1)] flex justify-center px-5 transition-[padding-inline-end] duration-(--duration-panel) ease-panel max-sm:left-0 ${
        sidePanel !== null && !fullScreen ? 'pe-[calc(var(--side-panel-width)+20px)]' : ''
      }`}
      style={{
        bottom: fullScreen ? 28 : 'calc(var(--player-bottom-offset) + var(--player-pill-height) + 14px)',
      }}
    >
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.id}
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex max-w-[min(420px,100%)] items-center gap-3 rounded-[12px] bg-thick-material py-2 ps-2 pe-4 shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_40px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onPointerEnter={() => setHeld(true)}
            onPointerLeave={() => setHeld(false)}
          >
            {notice.tone === 'error' ? (
              <span className="grid size-10 flex-none place-items-center rounded-[6px] bg-quaternary text-destructive">
                <TriangleAlert size={20} />
              </span>
            ) : (
              <PlaylistCover src={notice.cover.kind === 'image' ? notice.cover.src : null} liked={notice.cover.kind === 'liked'} size={40} />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate type-callout-emphasized text-primary">{notice.text}</span>
              {notice.detail && <span className="truncate type-callout text-secondary">{notice.detail}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
