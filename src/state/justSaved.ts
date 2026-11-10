import { create } from 'zustand';

/**
 * What this session has just done to songs' playlist membership, so a song row's badge turns from "+" to a
 * tick (or back) the moment the add or removal is made, without waiting on YouTube's own answer (which lags
 * behind, and which is not even asked for a song nobody hovered). true: put into a playlist; false: taken out
 * of the last one it was in; absent: nothing done here, so the badge follows YouTube. Reactive.
 */
interface JustSavedState {
  marks: ReadonlyMap<string, boolean>;
  mark: (videoIds: readonly string[], saved: boolean | undefined) => void;
}

export const useJustSaved = create<JustSavedState>()((set) => ({
  marks: new Map<string, boolean>(),
  mark: (videoIds, saved) =>
    set((state) => {
      const next = new Map(state.marks);
      for (const id of videoIds) {
        if (saved === undefined) next.delete(id);
        else next.set(id, saved);
      }
      return { marks: next };
    }),
}));

/** Marks songs saved in a playlist (true), left in none (false), or back to what YouTube says (undefined). */
export function markSaved(videoIds: readonly string[], saved: boolean | undefined): void {
  useJustSaved.getState().mark(videoIds, saved);
}

/** The mark a song carries now, to put back if its change fails. */
export function markOf(videoId: string): boolean | undefined {
  return useJustSaved.getState().marks.get(videoId);
}
