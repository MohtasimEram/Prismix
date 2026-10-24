/*
 * Horizontal shelves (report §2). Each kind sets its column count per
 * breakpoint, and the list lays out as
 *   grid-auto-columns: calc((100% - (n - 1) * gap) / n)
 * Below 764px of page width columns have a fixed width and the shelf scrolls by touch.
 */

/** What a shelf holds, named after it (Apple's letters in the comments). */
export type ShelfKind = 'editorial' | 'square' | 'tracks' | 'horizontal' | 'video' | 'circle';

/**
 * A container, so a shelf's columns follow the width the page actually has
 * (sidebar and side panel taken out, both resizable) and not the window's:
 * with the viewport's breakpoints a narrowed column still held the column
 * count of the full window, and the extra items spilled past the right edge.
 */
export const shelfSection = 'pt-9 @container min-w-0 max-w-full';

export const shelfHeader = 'mx-(--body-gutter) mb-3.5 flex min-h-[22px] items-center type-title-2-emphasized';

/** The scrolling grid; a kind from `shelfKinds` fills in its rows, widths and column counts. */
export const shelfList = [
  'grid grid-flow-col grid-rows-[repeat(var(--rows),max-content)] auto-cols-(--xs-width) gap-x-2.5 gap-y-(--row-gap)',
  // 15px bleed so hover shadows aren't clipped (--standard-lockup-shadow-offset).
  '-my-[15px] px-(--body-gutter) py-[15px] scroll-px-(--body-gutter)',
  'overflow-x-auto overflow-y-hidden overscroll-x-none snap-x snap-mandatory scroll-smooth motion-reduce:scroll-auto',
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden *:min-w-0 *:snap-start',
  '[--gap:20px] [--n:var(--cols-s)] @min-[1000px]:[--n:var(--cols-m)] @min-[1320px]:[--n:var(--cols-l)] @min-[1680px]:[--n:var(--cols-xl)]',
  '@min-[764px]:auto-cols-[calc((100%-(var(--n)-1)*var(--gap))/var(--n))] @min-[764px]:gap-x-(--gap)',
].join(' ');

export const shelfKinds: Record<ShelfKind, string> = {
  // A
  editorial: '[--rows:1] [--row-gap:24px] [--xs-width:298px] [--cols-s:2] [--cols-m:2] [--cols-l:3] [--cols-xl:3]',
  // G
  square: '[--rows:1] [--row-gap:24px] [--xs-width:144px] [--cols-s:4] [--cols-m:5] [--cols-l:6] [--cols-xl:6]',
  // TrackLockupsShelf
  tracks: '[--rows:4] [--row-gap:0px] [--xs-width:270px] [--cols-s:2] [--cols-m:3] [--cols-l:4] [--cols-xl:4]',
  // B
  horizontal: '[--rows:2] [--row-gap:24px] [--xs-width:298px] [--cols-s:2] [--cols-m:3] [--cols-l:4] [--cols-xl:4]',
  // C
  video: '[--rows:1] [--row-gap:24px] [--xs-width:200px] [--cols-s:3] [--cols-m:4] [--cols-l:5] [--cols-xl:5]',
  // H
  circle: '[--rows:1] [--row-gap:24px] [--xs-width:118px] [--cols-s:6] [--cols-m:8] [--cols-l:10] [--cols-xl:10]',
};
