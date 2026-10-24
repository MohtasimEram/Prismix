import { createContext, useContext, type RefObject } from 'react';

/** The page's scroll container (#scrollable-page), for scroll-linked headers. */
export const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useScrollContainer(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollContainerContext);
}
