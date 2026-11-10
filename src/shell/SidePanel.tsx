import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { SIDE_PANEL_LIMITS, useLayout } from '@/state/layout';
import { useUi } from '@/state/ui';
import { NowPlayingPanel } from './NowPlayingPanel';
import { Resizer } from './Resizer';
import { UpNext } from './UpNext';

// am-lyrics is large; it loads the first time the panel opens (prompt §3).
const LyricsPanel = lazy(() => import('./LyricsPanel').then((m) => ({ default: m.LyricsPanel })));

/** The collapsed strip's width, and how wide it opens while the pointer is on it (the panel's own look peeks out). */
const STRIP_WIDTH = 44;
const STRIP_PEEK_WIDTH = 58;

/**
 * What is left at the window's right edge while no panel is open (Now Playing hidden, or Up Next / Lyrics
 * closed): a thin glass strip with a chevron, the panel's full height and flush with the edge, so a click anywhere
 * along the edge of the window reaches it. With the pointer on it, it opens a little and the Now Playing
 * panel shows through, dimmed, as a hint of what is behind; a click brings the panel back.
 */
function PanelStrip() {
  const reduced = useReducedMotion();
  const [peek, setPeek] = useState(false);
  return (
    <motion.div
      key="side-strip"
      className="absolute inset-y-0 right-0 z-(--z-web-chrome) overflow-hidden glass-material shadow-glass max-sm:hidden"
      initial={{ opacity: 0, width: STRIP_WIDTH }}
      animate={{ opacity: 1, width: peek ? STRIP_PEEK_WIDTH : STRIP_WIDTH }}
      exit={{ opacity: 0 }}
      transition={reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 460, damping: 38, mass: 0.7 }}
      onPointerEnter={() => setPeek(true)}
      onPointerLeave={() => setPeek(false)}
    >
      {peek && (
        <div aria-hidden="true" inert className="pointer-events-none absolute inset-y-0 left-0 flex w-(--side-panel-width) flex-col opacity-35">
          <NowPlayingPanel preview onHide={() => undefined} />
        </div>
      )}
      <button
        type="button"
        className="absolute inset-0 grid place-items-center text-secondary hover:text-primary focus-visible:text-primary"
        aria-label="Show Now Playing"
        title="Show Now Playing"
        onFocus={() => setPeek(true)}
        onBlur={() => setPeek(false)}
        onClick={() => useUi.getState().setSidePanel('now-playing')}
      >
        <ChevronLeft size={18} strokeWidth={2.2} />
      </button>
    </motion.div>
  );
}

/** Up Next / Lyrics glass panel (report §7). */
export function SidePanel() {
  const panel = useUi((s) => s.sidePanel);
  // Hidden under the full-screen player, which has its own lyrics: one am-lyrics at a time.
  const fullScreen = useUi((s) => s.fullScreen);
  const reduced = useReducedMotion();
  const open = !!panel && !fullScreen;
  // With no panel open a strip stays at the edge to bring Now Playing back.
  const showStrip = !panel && !fullScreen;
  const closePanel = useUi((s) => s.closeSidePanel);
  const hideNowPlaying = useUi((s) => s.hideNowPlaying);
  const width = useLayout((s) => s.sidePanelWidth);
  const setWidth = useLayout((s) => s.setSidePanelWidth);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="side-panel"
          className="absolute inset-y-0 right-0 z-(--z-web-chrome) flex w-(--side-panel-width) flex-col glass-material shadow-glass max-sm:w-full"
          aria-label={panel === 'up-next' ? 'Up Next' : panel === 'now-playing' ? 'Now Playing' : 'Lyrics'}
          initial={reduced ? { opacity: 0 } : { x: '100%', opacity: 0.4 }}
          animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { x: '100%', opacity: 0.4 }}
          transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 38, mass: 0.8 }}
        >
          <Resizer
            edge="start"
            label="Resize panel"
            value={width}
            min={SIDE_PANEL_LIMITS.min}
            max={SIDE_PANEL_LIMITS.max}
            onChange={setWidth}
            onReset={() => setWidth(SIDE_PANEL_LIMITS.fallback)}
          />
          {/* Cross-fade between Up Next and Lyrics without sliding the panel again. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panel}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.18 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              {panel === 'up-next' ? (
                <UpNext onClose={closePanel} />
              ) : panel === 'now-playing' ? (
                <NowPlayingPanel onHide={hideNowPlaying} />
              ) : (
                <Suspense fallback={null}>
                  <LyricsPanel onClose={closePanel} />
                </Suspense>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.aside>
      )}
      {showStrip && <PanelStrip key="side-strip" />}
    </AnimatePresence>
  );
}
