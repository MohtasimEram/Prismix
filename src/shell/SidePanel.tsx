import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense } from 'react';
import { SIDE_PANEL_LIMITS, useLayout } from '@/state/layout';
import { useUi } from '@/state/ui';
import { Resizer } from './Resizer';
import { UpNext } from './UpNext';

// am-lyrics is large; it loads the first time the panel opens (prompt §3).
const LyricsPanel = lazy(() => import('./LyricsPanel').then((m) => ({ default: m.LyricsPanel })));

/** Up Next / Lyrics glass panel (report §7). */
export function SidePanel() {
  const panel = useUi((s) => s.sidePanel);
  // Hidden under the full-screen player, which has its own lyrics: one am-lyrics at a time.
  const fullScreen = useUi((s) => s.fullScreen);
  const reduced = useReducedMotion();
  const open = !!panel && !fullScreen;
  const width = useLayout((s) => s.sidePanelWidth);
  const setWidth = useLayout((s) => s.setSidePanelWidth);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="side-panel"
          className="absolute inset-y-0 right-0 z-(--z-web-chrome) flex w-(--side-panel-width) flex-col glass-material shadow-glass max-sm:w-full"
          aria-label={panel === 'up-next' ? 'Up Next' : 'Lyrics'}
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
                <UpNext />
              ) : (
                <Suspense fallback={null}>
                  <LyricsPanel />
                </Suspense>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
