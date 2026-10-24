import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useState } from 'react';
import { useScrollContainer } from '@/shell/scrollContainer';

/**
 * The page title row (report §1, `.header-nav`), collapsing as on macOS:
 * the large title shrinks and fades as the page scrolls, and a compact,
 * blurred bar with the same title takes over at the top of the page.
 */
export function PageHeader({ title }: { title: string }) {
  const scrollY = usePageScrollY();
  const reduced = useReducedMotion();
  const scale = useTransform(scrollY, [0, 64], [1, reduced ? 1 : 0.9]);
  const opacity = useTransform(scrollY, [0, 52], [1, 0]);
  const y = useTransform(scrollY, [0, 64], [0, reduced ? 0 : 6]);

  return (
    <>
      <CompactTitleBar title={title} after={56} />
      <div className="mx-(--body-gutter) pt-8">
        <motion.h1 className="origin-left type-header-emphasized will-change-transform" style={{ scale, opacity, y }}>
          {title}
        </motion.h1>
      </div>
    </>
  );
}

/** How far #scrollable-page has scrolled, as a motion value (0 outside the shell). */
export function usePageScrollY() {
  const container = useScrollContainer();
  return useScroll(container ? { container } : undefined).scrollY;
}

/** The blurred bar with the page's title that slides in once the big title has scrolled away. */
export function CompactTitleBar({ title, after }: { title: React.ReactNode; after: number }) {
  const scrollY = usePageScrollY();
  const [compact, setCompact] = useState(() => scrollY.get() > after);
  useMotionValueEvent(scrollY, 'change', (v) => setCompact(v > after));
  return (
      /* Zero height: it sticks to the top of the scroller without pushing the page down. */
      <div className="pointer-events-none sticky top-0 z-(--z-bubbles) h-0">
        <motion.div
          className="pointer-events-auto flex h-12 items-center border-b border-transparent px-(--body-gutter) glass-material data-[on=false]:pointer-events-none"
          data-on={compact}
          initial={false}
          animate={{ opacity: compact ? 1 : 0, y: compact ? 0 : -8 }}
          transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.6 }}
          aria-hidden={!compact}
        >
          <span className="truncate type-body-emphasized">{title}</span>
        </motion.div>
      </div>
  );
}
