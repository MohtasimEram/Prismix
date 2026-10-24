import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useOutlet } from 'react-router';
import { resumeSession } from '@/party/listenTogether';
import { startPartySync } from '@/party/partySync';
import { useDiscordPresence } from '@/playback/discordPresence';
import { startHistoryReporting } from '@/playback/historyReporting';
import { useScrobbler } from '@/playback/scrobbling';
import { useLayout } from '@/state/layout';
import { startSessionMemory } from '@/state/session';
import { useUi } from '@/state/ui';
import { DownloadToasts } from './DownloadToasts';
import { MobileTopBar } from './MobileTopBar';
import { PlayerBar } from './PlayerBar';
import { ScrollContainerContext } from './scrollContainer';
import { SidePanel } from './SidePanel';
import { Sidebar } from './Sidebar';
import { isDesktop } from '@/desktop/tauri';
import { useWindowState } from '@/desktop/window';
import { BackButton } from './NavButtons';
import { TitleBar } from './TitleBar';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

// It carries am-lyrics; loaded the first time it opens, as the side panel's lyrics are.
const FullScreenPlayer = lazy(() => import('./FullScreenPlayer').then((m) => ({ default: m.FullScreenPlayer })));

/** Apple's page change: the old page fades out quickly, the new one rises in. */
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  // Transforms end at none, so sticky headers and fixed menus inside behave.
  enter: { opacity: 1, y: 0, transitionEnd: { transform: 'none' }, transition: { duration: 0.28, ease: [0.215, 0.61, 0.355, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
} as const;

const reducedVariants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transitionEnd: { transform: 'none' }, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
} as const;

/** The route's page, animated in and out; each new page starts at the top. */
function AnimatedOutlet({ scroller }: { scroller: React.RefObject<HTMLElement | null> }) {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false} onExitComplete={() => scroller.current?.scrollTo({ top: 0 })}>
      <motion.div
        key={pathname}
        variants={reduced ? reducedVariants : pageVariants}
        initial="initial"
        animate="enter"
        exit="exit"
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

/** The full-screen player slides up from the mini player like Apple Music's. */
function FullScreenLayer() {
  const fullScreen = useUi((s) => s.fullScreen);
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {fullScreen && (
        <motion.div
          key="full-screen"
          className="fixed inset-x-0 top-(--titlebar-height) bottom-0 z-[calc(var(--z-contextual-menus)-2)]"
          initial={reduced ? { opacity: 0 } : { y: '100%', borderRadius: 28, opacity: 0.6 }}
          animate={reduced ? { opacity: 1 } : { y: 0, borderRadius: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: '100%', borderRadius: 28, opacity: 0.6 }}
          transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }}
          style={{ overflow: 'hidden', willChange: 'transform' }}
        >
          <Suspense fallback={null}>
            <FullScreenPlayer />
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Publishes the user's panel widths as the CSS variables the layout reads.
 * From 768px up only: below that the sidebar is a drawer or a vw-based column
 * (tokens.css) and the side panel is full width, so the saved sizes don't apply.
 */
function usePanelWidths() {
  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const sidePanelWidth = useLayout((s) => s.sidePanelWidth);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const query = window.matchMedia('(min-width: 768px)');
    const apply = () => {
      if (query.matches) {
        root.style.setProperty('--web-navigation-width', `${sidebarWidth}px`);
        root.style.setProperty('--side-panel-width', `${sidePanelWidth}px`);
      } else {
        root.style.removeProperty('--web-navigation-width');
        root.style.removeProperty('--side-panel-width');
      }
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
      root.style.removeProperty('--web-navigation-width');
      root.style.removeProperty('--side-panel-width');
    };
  }, [sidebarWidth, sidePanelWidth]);
}

/**
 * The app frame (report §1): the window's title bar, glass sidebar, the
 * scrolling page, the floating player pill and the side panel.
 */
export function AppShell() {
  useKeyboardShortcuts();
  // In OS full screen the title bar is gone: the grid must drop its row (or the page sinks into
  // the wrong one) and the full-screen layer must start at the very top, not below a bar that isn't there.
  const windowFullscreen = useWindowState().fullscreen;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (windowFullscreen) root.setAttribute('data-window-fullscreen', '');
    else root.removeAttribute('data-window-fullscreen');
    return () => root.removeAttribute('data-window-fullscreen');
  }, [windowFullscreen]);
  useDiscordPresence();
  useScrobbler();
  usePanelWidths();
  // The side panel takes its width out of the page, so shelves never run under it.
  const panelOpen = useUi((s) => !!s.sidePanel && !s.fullScreen);
  const fullScreen = useUi((s) => s.fullScreen);
  // Listen Together: pick a party back up after a reload, and keep the player in step with it.
  useEffect(() => {
    resumeSession();
    return startPartySync();
  }, []);
  // Plays into the account's YouTube Music history (Settings › Share Listening Activity).
  useEffect(() => startHistoryReporting(), []);
  // The queue, the song and where it stopped come back as they were (state/session.ts).
  useEffect(() => startSessionMemory(), []);
  const scroller = useRef<HTMLElement | null>(null);
  // Browser-style scroll restoration would fight the page transitions.
  useLayoutEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  return (
    <div className={`grid h-full ${isDesktop() && windowFullscreen ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'}`}>
      <TitleBar />
      {/* The side panel slides in from beyond the right edge; never let it scroll the page. */}
      <div className="relative min-h-0 overflow-hidden">
        <Sidebar />
        <MobileTopBar />
        {/* Outside the desktop shell there is no title bar to hold it. */}
        {!isDesktop() && (
          <div className="absolute top-2 left-[calc(var(--web-navigation-width)+8px)] z-(--z-web-chrome) max-sm:hidden">
            <BackButton className="grid size-8 place-items-center rounded-full bg-thick-material text-primary shadow-[0_0_0_0.5px_var(--vibrantDivider)] enabled:hover:bg-quinary disabled:opacity-35" />
          </div>
        )}
        {/* The page scrolls under the fixed sidebar and the floating player. */}
        <main
          ref={scroller}
          id="scrollable-page"
          data-panel-open={panelOpen}
          className="absolute inset-y-0 left-0 min-w-0 overflow-x-hidden overflow-y-auto pl-(--web-navigation-width) transition-[right] duration-(--duration-panel) ease-panel data-tint:bg-(--page-tint) data-tint:transition-[background-color,right] data-tint:duration-300 data-tint:ease-in max-sm:pt-(--mobile-top-bar-height) max-sm:pl-0"
          style={{
            right: panelOpen ? 'var(--side-panel-width)' : 0,
            ...(fullScreen ? {} : { scrollbarGutter: 'stable' }),
          }}
        >
          {/* Clears the floating pill: its height, its offset, and some air. */}
          <div className="min-h-full pb-[calc(var(--player-pill-height)+var(--player-bottom-offset)+40px)]">
            <ScrollContainerContext.Provider value={scroller}>
              <AnimatedOutlet scroller={scroller} />
            </ScrollContainerContext.Provider>
          </div>
        </main>
        <PlayerBar />
        <SidePanel />
        <DownloadToasts />
      </div>
      <FullScreenLayer />
    </div>
  );
}
